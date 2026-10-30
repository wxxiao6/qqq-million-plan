import { beijingTodayISO, isISODate } from "@/lib/format";
import {
  calculateDailyManagementFee,
  managementFeeCoverage,
  type ManagementFeeCoverage,
  type ManagementFeeEntry,
  type ManagementFeeRate,
} from "@/lib/management-fee";
import { getDb, kvGet, kvSet } from "../db";
import type { Account, Position } from "./index";

const START_DATE_KEY = "holdings.managementFeeStartDate";

export type ManagementFeeSummary = {
  symbol: string | null;
  rawMarketValue: number | null;
  managementFeeEstimated: number;
  managementFeeActual: number;
  managementFeeTotal: number;
  managementFeeCoverage: ManagementFeeCoverage;
  reconciledMarketValue: number | null;
  reconciledHoldingPnl: number | null;
  lastRateObservedAt: string | null;
  lastRateSourceUrl: string | null;
};

export type NavRow = { symbol: string; as_of: string; nav: number };
type RateRow = {
  code: string;
  effective_on: string;
  annual_rate_pct: number | null;
  raw_value: string | null;
  source_url: string;
  source_provider: string;
  observed_at: string;
  status: "valid" | "missing" | "invalid";
};
export type FeeState = {
  symbol: string;
  account: Account;
  estimatedAmount: number;
  actualAmount: number;
  lastNavDate: string | null;
};

function startDate(): string {
  const saved = kvGet(START_DATE_KEY);
  if (saved && isISODate(saved)) return saved;
  const today = beijingTodayISO();
  kvSet(START_DATE_KEY, today);
  return today;
}

function positionStartDate(position: Position): string | null {
  const value = position.tDate ?? position.recordedOn ?? position.confirmedOn;
  return value && isISODate(value) ? value : null;
}

function mapRate(row: RateRow): ManagementFeeRate {
  return {
    code: row.code,
    effectiveOn: row.effective_on,
    annualRatePct: row.annual_rate_pct,
    rawValue: row.raw_value,
    sourceUrl: row.source_url,
    sourceProvider: row.source_provider,
    observedAt: row.observed_at,
    status: row.status,
  };
}

function listRates(start: string, asOf: string): ManagementFeeRate[] {
  return (getDb().prepare(`SELECT code, effective_on, annual_rate_pct, raw_value,
      source_url, source_provider, observed_at, status
      FROM fund_management_fee_rates
      WHERE effective_on >= ? AND effective_on <= ?
      ORDER BY code, effective_on`).all(start, asOf) as RateRow[]).map(mapRate);
}

function listNavs(start: string, asOf: string, symbol?: string): NavRow[] {
  const params: string[] = [start, asOf];
  const symbolClause = symbol ? " AND symbol = ?" : "";
  if (symbol) params.push(symbol);
  return getDb().prepare(`SELECT symbol, as_of, nav FROM nav_snapshots
    WHERE as_of >= ? AND as_of <= ? AND nav > 0${symbolClause}
    ORDER BY as_of, symbol`).all(...params) as NavRow[];
}

function listEntries(start: string, asOf: string, symbol?: string, account?: Account): ManagementFeeEntry[] {
  const clauses = ["fee_date >= ?", "fee_date <= ?"];
  const params: string[] = [start, asOf];
  if (symbol) { clauses.push("symbol = ?"); params.push(symbol); }
  if (account) { clauses.push("account = ?"); params.push(account); }
  const rows = getDb().prepare(`SELECT id, symbol, account, fee_date, amount, note, created_at, updated_at
    FROM holding_management_fee_entries WHERE ${clauses.join(" AND ")}
    ORDER BY fee_date, id`).all(...params) as Array<{
      id: number; symbol: string; account: string; fee_date: string; amount: number;
      note: string | null; created_at: string; updated_at: string;
    }>;
  return rows.map((row) => ({
    id: row.id,
    symbol: row.symbol,
    account: row.account,
    feeDate: row.fee_date,
    amount: row.amount,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function readState(symbol: string, account: Account): FeeState | null {
  const row = getDb().prepare(`SELECT symbol, account, estimated_amount, actual_amount, last_nav_date
    FROM holding_management_fee_totals WHERE symbol = ? AND account = ?`).get(symbol, account) as {
      symbol: string; account: Account; estimated_amount: number; actual_amount: number; last_nav_date: string | null;
    } | undefined;
  if (!row) return null;
  return {
    symbol: row.symbol,
    account: row.account,
    estimatedAmount: row.estimated_amount,
    actualAmount: row.actual_amount,
    lastNavDate: row.last_nav_date,
  };
}

function writeState(state: FeeState, now = new Date().toISOString()) {
  getDb().prepare(`INSERT INTO holding_management_fee_totals
      (symbol, account, estimated_amount, actual_amount, last_nav_date, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol, account) DO UPDATE SET
        estimated_amount = excluded.estimated_amount,
        actual_amount = excluded.actual_amount,
        last_nav_date = excluded.last_nav_date,
        updated_at = excluded.updated_at`)
    .run(state.symbol, state.account, state.estimatedAmount, state.actualAmount, state.lastNavDate, now);
}

function deleteState(symbol: string, account: Account) {
  getDb().prepare("DELETE FROM holding_management_fee_totals WHERE symbol = ? AND account = ?").run(symbol, account);
}

function rateMap(rates: ManagementFeeRate[]) {
  return new Map(rates.map((rate) => [`${rate.code}:${rate.effectiveOn}`, rate]));
}

function actualMap(entries: ManagementFeeEntry[]) {
  return new Map(entries.map((entry) => [`${entry.symbol}:${entry.account}:${entry.feeDate}`, entry]));
}

/** 增量处理一个基金账户，只推进到最后一条有完整净值和费率的净值日。 */
function accrueGroup(
  positions: Position[],
  symbol: string,
  account: Account,
  asOf: string,
  rates: ManagementFeeRate[],
  navs: NavRow[],
  entries: ManagementFeeEntry[],
): FeeState | null {
  const result = calculateGroupAccrual(positions, symbol, account, asOf, rates, navs, entries, readState(symbol, account));
  if (!result) return null;
  if (result.changed) writeState(result.state);
  return result.state;
}

/** Pure accrual shared by SQLite and D1 callers; persistence is handled by the caller. */
export function calculateGroupAccrual(
  positions: Position[], symbol: string, account: Account, asOf: string,
  rates: ManagementFeeRate[], navs: NavRow[], entries: ManagementFeeEntry[], initial: FeeState | null,
): { state: FeeState; changed: boolean } | null {
  const groupPositions = positions.filter((position) =>
    position.exposure === "nasdaq" && position.status === "settled" &&
    position.symbol === symbol && position.account === account,
  );
  if (!groupPositions.length) return null;
  const start = groupPositions.map(positionStartDate).filter((date): date is string => Boolean(date)).sort()[0];
  if (!start) return null;
  const state: FeeState = initial ? { ...initial } : {
    symbol,
    account,
    estimatedAmount: 0,
    actualAmount: 0,
    lastNavDate: null,
  };
  const ratesByDate = rateMap(rates);
  const actualByDate = actualMap(entries);
  const pendingNavs = navs.filter((nav) => nav.symbol === symbol && nav.as_of >= start && (!state.lastNavDate || nav.as_of > state.lastNavDate));
  let changed = false;
  for (const nav of pendingNavs) {
    const active = groupPositions.filter((position) => (positionStartDate(position) ?? asOf) <= nav.as_of && position.shares != null);
    if (!active.length) {
      state.lastNavDate = nav.as_of;
      changed = true;
      continue;
    }
    const actual = actualByDate.get(`${symbol}:${account}:${nav.as_of}`);
    if (actual) {
      state.actualAmount += actual.amount;
      state.lastNavDate = nav.as_of;
      changed = true;
      continue;
    }
    const rate = ratesByDate.get(`${symbol}:${nav.as_of}`);
    if (!rate || rate.status !== "valid" || rate.annualRatePct == null) break;
    const marketValue = active.reduce((sum, position) => sum + (position.shares ?? 0) * nav.nav, 0);
    const fee = calculateDailyManagementFee(marketValue, rate.annualRatePct, nav.as_of);
    if (fee == null) break;
    state.estimatedAmount += fee;
    state.lastNavDate = nav.as_of;
    changed = true;
  }
  return { state, changed };
}

function groupKeys(positions: Position[]) {
  return [...new Set(positions
    .filter((position) => position.exposure === "nasdaq" && position.status === "settled")
    .map((position) => `${position.symbol}:${position.account}`))];
}

function groupsFromKeys(keys: string[]) {
  return keys.map((key) => {
    const [symbol, account] = key.split(":");
    return { symbol, account: account as Account };
  });
}

function accrueAll(positions: Position[], asOf: string) {
  const start = startDate();
  const rates = listRates(start, asOf);
  const navs = listNavs(start, asOf);
  const entries = listEntries(start, asOf);
  const result = new Map<string, FeeState>();
  const run = getDb().transaction(() => {
    for (const group of groupsFromKeys(groupKeys(positions))) {
      const state = accrueGroup(positions, group.symbol, group.account, asOf, rates, navs, entries);
      if (state) result.set(`${group.symbol}:${group.account}`, state);
    }
  });
  run();
  return { rates, navs, entries, result };
}

/** 手工修正后重建该基金账户的累计结果；不产生逐日扣除记录。 */
export function rebuildManagementFeeGroup(positions: Position[], symbol: string, account: Account, asOf = beijingTodayISO()) {
  const db = getDb();
  const run = db.transaction(() => {
    deleteState(symbol, account);
    const start = startDate();
    return accrueGroup(
      positions,
      symbol,
      account,
      asOf,
      listRates(start, asOf),
      listNavs(start, asOf, symbol),
      listEntries(start, asOf, symbol, account),
    );
  });
  return run();
}

function latestMarketValue(positions: Position[], asOf: string): number | null {
  const rows = getDb().prepare("SELECT symbol, as_of, nav FROM nav_snapshots WHERE as_of <= ? ORDER BY as_of DESC").all(asOf) as NavRow[];
  const navs = new Map<string, number>();
  for (const row of rows) if (!navs.has(row.symbol)) navs.set(row.symbol, row.nav);
  let total = 0;
  let any = false;
  for (const position of positions) {
    const nav = navs.get(position.symbol);
    if (position.shares == null || nav == null) continue;
    any = true;
    total += position.shares * nav;
  }
  return any ? total : null;
}

export function getManagementFeeStartDate() {
  return startDate();
}

export function listManagementFeeEntries(symbol?: string, account?: Account) {
  return listEntries(startDate(), beijingTodayISO(), symbol, account);
}

export function getManagementFeeSummary(input: {
  positions: Position[];
  symbol?: string;
  account?: Account;
  asOf?: string;
  rawMarketValue?: number | null;
  cost?: number;
}): ManagementFeeSummary {
  const asOf = input.asOf ?? beijingTodayISO();
  const positions = input.positions.filter((position) =>
    position.exposure === "nasdaq" && position.status === "settled" &&
    (!input.symbol || position.symbol === input.symbol) &&
    (!input.account || position.account === input.account),
  );
  const accumulated = accrueAll(positions, asOf);
  const keys = groupKeys(positions);
  const states = keys.map((key) => {
    const [symbol, account] = key.split(":");
    return accumulated.result.get(key) ?? readState(symbol, account as Account);
  }).filter((state): state is FeeState => Boolean(state));
  const rawMarketValue = input.rawMarketValue ?? latestMarketValue(positions, asOf);
  return buildManagementFeeSummary(input, positions, states, accumulated.navs, accumulated.rates, rawMarketValue);
}

/** Assemble a summary from a consistent snapshot without accessing storage. */
export function buildManagementFeeSummary(
  input: { symbol?: string; cost?: number }, positions: Position[], states: FeeState[], navs: NavRow[],
  rates: ManagementFeeRate[], rawMarketValue: number | null,
): ManagementFeeSummary {
  const keys = groupKeys(positions);
  const eligibleGroups = keys.length;
  const latestBySymbol = new Map<string, string>();
  for (const nav of navs) {
    const current = latestBySymbol.get(nav.symbol);
    if (!current || nav.as_of > current) latestBySymbol.set(nav.symbol, nav.as_of);
  }
  const covered = new Set<string>();
  const missing = new Set<string>();
  for (const key of keys) {
    const [symbol] = key.split(":");
    const state = states.find((row) => `${row.symbol}:${row.account}` === key);
    const latest = latestBySymbol.get(symbol);
    if (state?.lastNavDate && (!latest || state.lastNavDate >= latest)) covered.add(key);
    else missing.add(key);
  }
  const coverage = managementFeeCoverage(eligibleGroups, covered.size, missing.size);
  const managementFeeEstimated = states.reduce((sum, state) => sum + state.estimatedAmount, 0);
  const managementFeeActual = states.reduce((sum, state) => sum + state.actualAmount, 0);
  const managementFeeTotal = managementFeeEstimated + managementFeeActual;
  const reconciledMarketValue = coverage.status === "covered" && rawMarketValue != null ? rawMarketValue - managementFeeTotal : null;
  const reconciledHoldingPnl = reconciledMarketValue != null && input.cost != null ? reconciledMarketValue - input.cost : null;
  const lastRate = [...rates].sort((a, b) => a.observedAt.localeCompare(b.observedAt)).at(-1);
  return {
    symbol: input.symbol ?? null,
    rawMarketValue,
    managementFeeEstimated,
    managementFeeActual,
    managementFeeTotal,
    managementFeeCoverage: coverage,
    reconciledMarketValue,
    reconciledHoldingPnl,
    lastRateObservedAt: lastRate?.observedAt ?? null,
    lastRateSourceUrl: lastRate?.sourceUrl ?? null,
  };
}
