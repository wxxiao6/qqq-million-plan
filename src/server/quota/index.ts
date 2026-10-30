/** 纳指雷达。只读决策页；用户不维护额度。口径见 docs/spec-quota.md。 */

import {
  beijingDateISOFromInstant,
  beijingTodayISO,
  formatBeijingDateTime,
} from "@/lib/format";
import { MIN_ORDER_DEFAULT } from "@/lib/formulas";
import {
  cellInvestable,
  cellRemaining,
  collapseScopes,
  compareQuotaDetailRows,
  coverageOf,
  isBuyableAmount,
  quotaResultLabel,
  resolveQuotaScope,
  scopesForChannel,
  sumQuotaAmounts,
  type ChannelKind,
  type CollapsedScope,
  type QuotaAmount,
  type QuotaDataStatus,
  type QuotaResultLabel,
  type QuotaScopeCell,
  type QuotaShareTag,
} from "@/lib/quota-math";
import { getDb } from "../db";
import { listEffectiveQuotaCells } from "../funds/effective-quotes";
import { readJob } from "../jobs/status";
import { listHeldSymbols } from "../ledger";

export type { ChannelKind };
export type SubscribeStatus = "open" | "limited" | "paused";

/** 当前阶段购买记录未接入，已购买统一按 0。 */
export const QUOTA_PURCHASES_CONNECTED = false;

export type QuotaCell = {
  symbol: string;
  shareClass: string;
  channelKind: ChannelKind;
  status: SubscribeStatus;
  dailyLimit: number | null;
  quotaScope: string;
  source: string | null;
  bizDate: string | null;
  updatedAt: string;
  stale: boolean;
  investable: QuotaAmount;
  purchased: number;
  remaining: QuotaAmount;
  shareTag: QuotaShareTag;
};

export type QuotaRow = {
  symbol: string;
  shareClass: string;
  name: string;
  manager: string | null;
  minOrder: number;
  held: boolean;
  hasActiveDca: boolean;
  direct: QuotaCell | null;
  agency: QuotaCell | null;
  buyableDirect: boolean;
  buyableAgency: boolean;
  purchased: number;
  remaining: QuotaAmount;
  updatedAt: string | null;
  stale: boolean;
  allPaused: boolean;
  currency: "CNY" | "USD";
  marketType: "otc" | "etf" | "lof";
  nav: number | null;
  navDate: string | null;
  navChangePct: number | null;
  marketPrice: number | null;
  marketPriceAt: string | null;
  premiumPct: number | null;
};

export type ChannelSummary = {
  investable: QuotaAmount;
  purchased: QuotaAmount;
  remaining: QuotaAmount;
  buyableCount: number;
  coverageCovered: number;
  coverageTotal: number;
};

export type QuotaOverview = {
  investable: QuotaAmount;
  purchased: QuotaAmount;
  remaining: QuotaAmount;
  channelTotal: QuotaAmount;
  coverageCovered: number;
  coverageTotal: number;
  direct: ChannelSummary;
  agency: ChannelSummary;
  resultLabel: QuotaResultLabel;
  dataStatus: QuotaDataStatus;
  asOf: string | null;
  asOfLabel: string | null;
  isStale: boolean;
  purchasesConnected: boolean;
};

export type QuotaBoard = {
  emptyUniverse: boolean;
  rows: QuotaRow[];
  overview: QuotaOverview;
};

type UniverseRow = {
  symbol: string;
  share_class: string;
  name: string;
  manager: string | null;
  min_order: number;
  currency: "CNY" | "USD";
  market_type: "otc" | "etf" | "lof";
};

type CellRow = {
  symbol: string;
  share_class: string;
  channel_kind: ChannelKind;
  status: SubscribeStatus;
  daily_limit: number | null;
  quota_scope: string | null;
  source: string | null;
  biz_date: string | null;
  updated_at: string;
};

function loadUniverse(): UniverseRow[] {
  return getDb()
    .prepare(
      `SELECT code AS symbol, share_class, name, manager, min_order, currency, market_type
       FROM nasdaq_funds ORDER BY code, share_class`,
    )
    .all() as UniverseRow[];
}

function loadCells(): CellRow[] {
  return listEffectiveQuotaCells(getDb());
}

function toQuotaCell(row: CellRow, shareTag: QuotaShareTag, today: string): QuotaCell {
  const investable = cellInvestable(row.status, row.daily_limit);
  const purchased = 0;
  return {
    symbol: row.symbol,
    shareClass: row.share_class,
    channelKind: row.channel_kind,
    status: row.status,
    dailyLimit: row.daily_limit,
    quotaScope: resolveQuotaScope(
      row.symbol,
      row.share_class,
      row.channel_kind,
      row.quota_scope,
    ),
    source: row.source,
    bizDate: row.biz_date,
    updatedAt: row.updated_at,
    stale: isStaleStamp(row.updated_at, row.biz_date, today),
    investable,
    purchased,
    remaining: cellRemaining(investable, purchased),
    shareTag,
  };
}

function loadActiveDcaSymbols(): Set<string> {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT symbol FROM dca_plans
       WHERE exposure = 'nasdaq' AND status = 'active'`,
    )
    .all() as Array<{ symbol: string }>;
  return new Set(rows.map((row) => row.symbol));
}

function cellFromMap(
  map: Map<string, CellRow>,
  symbol: string,
  shareClass: string,
  channel: ChannelKind,
  shareTagByScope: Map<string, QuotaShareTag>,
  today: string,
): QuotaCell | null {
  const row = map.get(`${symbol}:${shareClass}:${channel}`);
  if (!row) return null;
  const scope = resolveQuotaScope(symbol, shareClass, channel, row.quota_scope);
  return toQuotaCell(
    row,
    scope.endsWith(":fund") ? "all-channel" : (shareTagByScope.get(scope) ?? "none"),
    today,
  );
}

function rowRemaining(
  direct: QuotaCell | null,
  agency: QuotaCell | null,
  scopes: CollapsedScope[],
): QuotaAmount {
  const keys = new Set<string>();
  if (direct) keys.add(direct.quotaScope);
  if (agency) keys.add(agency.quotaScope);
  const matched = scopes.filter((scope) => keys.has(scope.scopeId));
  if (matched.length === 0) {
    return sumQuotaAmounts([
      direct?.remaining ?? { kind: "unknown" },
      agency?.remaining ?? { kind: "unknown" },
    ]);
  }
  return sumQuotaAmounts(matched.map((scope) => scope.remaining));
}

function latestUpdatedAt(values: Array<string | null | undefined>): string | null {
  const stamps = values.filter((value): value is string => Boolean(value));
  if (stamps.length === 0) return null;
  return stamps.reduce((latest, value) => (value > latest ? value : latest));
}

function isStaleStamp(updatedAt: string | null, bizDate: string | null, today: string) {
  if (bizDate && bizDate !== today) return true;
  if (!updatedAt) return false;
  const day = beijingDateISOFromInstant(updatedAt);
  return day != null && day !== today;
}

function dataStatusFor(asOf: string | null, today: string): {
  dataStatus: QuotaDataStatus;
  isStale: boolean;
} {
  if (!asOf) return { dataStatus: "已更新", isStale: false };
  const day = beijingDateISOFromInstant(asOf);
  if (day != null && day !== today) {
    return { dataStatus: "非今日数据", isStale: true };
  }
  return { dataStatus: "已更新", isStale: false };
}

function channelSummary(
  scopes: CollapsedScope[],
  buyableCount: number,
): ChannelSummary {
  const investables = scopes.map((scope) => scope.investable);
  const remainings = scopes.map((scope) => scope.remaining);
  const coverage = coverageOf(investables);
  return {
    investable: sumQuotaAmounts(investables),
    purchased: {
      kind: "amount",
      value: scopes.reduce((sum, scope) => sum + scope.purchased, 0),
    },
    remaining: sumQuotaAmounts(remainings),
    buyableCount,
    coverageCovered: coverage.covered,
    coverageTotal: coverage.total,
  };
}

function buildScopeCells(
  universe: UniverseRow[],
  cellMap: Map<string, CellRow>,
): QuotaScopeCell[] {
  const cells: QuotaScopeCell[] = [];
  for (const fund of universe) {
    // 美元金额不能与人民币相加，ETF/LOF 的公开净值也不等于申购额度。
    // 它们保留在明细中展示真实净值，不进入人民币额度总览。
    if (fund.currency !== "CNY" || fund.market_type !== "otc") continue;
    for (const channel of ["direct", "agency"] as const) {
      const row = cellMap.get(`${fund.symbol}:${fund.share_class}:${channel}`);
      const scopeId = resolveQuotaScope(
        fund.symbol,
        fund.share_class,
        channel,
        row?.quota_scope,
      );
      cells.push({
        scopeId,
        symbol: fund.symbol,
        shareClass: fund.share_class,
        channelKind: channel,
        investable: cellInvestable(row?.status, row?.daily_limit),
        purchased: 0,
      });
    }
  }
  return cells;
}

function rowAllPaused(direct: QuotaCell | null, agency: QuotaCell | null): boolean {
  const cells = [direct, agency].filter((cell): cell is QuotaCell => cell != null);
  return cells.length > 0 && cells.every((cell) => cell.status === "paused");
}

export function getQuotaBoard(): QuotaBoard {
  const universe = loadUniverse();
  const rawCells = loadCells();
  const today = beijingTodayISO();
  const cellMap = new Map<string, CellRow>();
  for (const row of rawCells) {
    cellMap.set(`${row.symbol}:${row.share_class}:${row.channel_kind}`, row);
  }

  const collapsed = collapseScopes(buildScopeCells(universe, cellMap));
  const shareTagByScope = new Map(
    collapsed.map((scope) => [scope.scopeId, scope.shareTag]),
  );
  const held = new Set(listHeldSymbols());
  const activeDcaSymbols = loadActiveDcaSymbols();
  const quotaJob = readJob("tiantian_quota");
  const navRows = getDb()
    .prepare(`
      SELECT n.symbol, n.as_of, n.nav, n.nav_change_pct, n.market_price, n.market_price_at
      FROM nav_snapshots n
      INNER JOIN (SELECT symbol, MAX(as_of) AS as_of FROM nav_snapshots GROUP BY symbol) latest
        ON latest.symbol = n.symbol AND latest.as_of = n.as_of
    `)
    .all() as Array<{
      symbol: string;
      as_of: string;
      nav: number;
      nav_change_pct: number | null;
      market_price: number | null;
      market_price_at: string | null;
    }>;
  const navBySymbol = new Map(navRows.map((row) => [row.symbol, row]));

  const rows: QuotaRow[] = universe.map((fund) => {
    const direct = cellFromMap(cellMap, fund.symbol, fund.share_class, "direct", shareTagByScope, today);
    const agency = cellFromMap(cellMap, fund.symbol, fund.share_class, "agency", shareTagByScope, today);
    const minOrder = fund.min_order || MIN_ORDER_DEFAULT;
    const remaining = rowRemaining(direct, agency, collapsed);
    const updatedAt = latestUpdatedAt([direct?.updatedAt, agency?.updatedAt]);
    const stale = (!direct && !agency) || Boolean(direct?.stale || agency?.stale);

    const nav = navBySymbol.get(fund.symbol);
    return {
      symbol: fund.symbol,
      shareClass: fund.share_class,
      name: fund.name,
      manager: fund.manager,
      minOrder,
      held: held.has(fund.symbol),
      hasActiveDca: activeDcaSymbols.has(fund.symbol),
      direct,
      agency,
      buyableDirect: isBuyableAmount(
        direct?.remaining ?? { kind: "unknown" },
        minOrder,
      ),
      buyableAgency: isBuyableAmount(
        agency?.remaining ?? { kind: "unknown" },
        minOrder,
      ),
      purchased: 0,
      remaining,
      updatedAt,
      stale,
      allPaused: rowAllPaused(direct, agency),
      currency: fund.currency,
      marketType: fund.market_type,
      nav: nav?.nav ?? null,
      navDate: nav?.as_of ?? null,
      navChangePct: nav?.nav_change_pct ?? null,
      marketPrice: nav?.market_price ?? null,
      marketPriceAt: nav?.market_price_at ?? null,
      premiumPct:
        nav?.market_price != null && nav.nav > 0
          ? (nav.market_price / nav.nav - 1) * 100
          : null,
    };
  });

  rows.sort(compareQuotaDetailRows);

  const investables = collapsed.map((scope) => scope.investable);
  const remainings = collapsed.map((scope) => scope.remaining);
  const coverage = coverageOf(investables);
  const remaining = sumQuotaAmounts(remainings);
  const asOf = latestUpdatedAt(rawCells.map((row) => row.updated_at));
  const freshness =
    quotaJob?.partial
      ? { dataStatus: "部分更新" as const, isStale: true }
      : quotaJob && !quotaJob.ok
      ? { dataStatus: "更新失败" as const, isStale: true }
      : dataStatusFor(asOf, today);
  const directSummary = channelSummary(
    scopesForChannel(collapsed, "direct"),
    rows.filter((row) => row.buyableDirect).length,
  );
  const agencySummary = channelSummary(
    scopesForChannel(collapsed, "agency"),
    rows.filter((row) => row.buyableAgency).length,
  );

  const overview: QuotaOverview = {
    investable: sumQuotaAmounts(investables),
    purchased: {
      kind: "amount",
      value: collapsed.reduce((sum, scope) => sum + scope.purchased, 0),
    },
    remaining,
    channelTotal: sumQuotaAmounts([directSummary.remaining, agencySummary.remaining]),
    coverageCovered: coverage.covered,
    coverageTotal: coverage.total,
    direct: directSummary,
    agency: agencySummary,
    resultLabel: quotaResultLabel({
      scopeInvestables: investables,
      remaining,
    }),
    dataStatus: freshness.dataStatus,
    asOf,
    asOfLabel: asOf ? formatBeijingDateTime(asOf) : null,
    isStale: freshness.isStale,
    purchasesConnected: QUOTA_PURCHASES_CONNECTED,
  };

  return {
    emptyUniverse: universe.length === 0,
    rows,
    overview,
  };
}

export function listQuotaMatrix(): QuotaRow[] {
  return getQuotaBoard().rows;
}

export function getBuyableShareCount(): number {
  return listQuotaMatrix().filter((row) => row.buyableDirect || row.buyableAgency)
    .length;
}

export function hasBuyableCell(): boolean {
  return listQuotaMatrix().some((row) => row.buyableDirect || row.buyableAgency);
}

export function allPaused(): boolean {
  const rows = listQuotaMatrix();
  if (rows.length === 0) return false;
  return rows.every((row) => {
    const cells = [row.direct, row.agency].filter(Boolean);
    return cells.length > 0 && cells.every((cell) => cell?.status === "paused");
  });
}
