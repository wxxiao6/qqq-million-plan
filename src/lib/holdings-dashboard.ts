import type { PositionDetail } from "@/server/ledger";
import { advanceWeekdays } from "./format";

/** Nasdaq catalog names sometimes omit QDII; other funds expose it in their type or name. */
export function isQdiiFund(name: string, fundType: string | null, isNasdaq: boolean): boolean {
  return isNasdaq || /QDII/i.test(`${name} ${fundType ?? ""}`);
}

/** Display dates only: valuation always uses the original published NAV. */
export function fundIncomeDate(navDate: string | null, isQdii: boolean): string | null {
  return navDate && isQdii ? advanceWeekdays(navDate, 1) : navDate;
}

/** Apply the same fund and account filters to both the list and the overview. */
export function filterHoldingPositions(positions: PositionDetail[], names: Record<string, string>, query: string, account: string): PositionDetail[] {
  const normalized = query.trim().toLocaleLowerCase();
  return positions.filter((position) =>
    (account === "all" || position.account === account) &&
    (!normalized || `${position.symbol} ${names[position.symbol] ?? ""}`.toLocaleLowerCase().includes(normalized)),
  );
}

export type HoldingGroup = {
  symbol: string;
  name: string;
  isQdii: boolean;
  incomeDate: string | null;
  positions: PositionDetail[];
  settledCount: number;
  pendingCount: number;
  cost: number;
  marketValue: number | null;
  holdingPnl: number | null;
  today: number | null;
  pendingCash: number;
  unvaluedCount: number;
  navAsOf: string | null;
};

export type HoldingSortOrder = "gain" | "gainRate" | "value" | "dayGain" | "navDate";

function holdingSortValue(group: HoldingGroup, sort: Exclude<HoldingSortOrder, "navDate">): number | null {
  switch (sort) {
    case "gain": return group.holdingPnl;
    case "gainRate": return group.cost > 0 && group.holdingPnl != null && group.unvaluedCount === 0
      ? group.holdingPnl / group.cost : null;
    case "value": return marketValueIncludingPending(group.marketValue, group.pendingCash);
    case "dayGain": return group.today;
  }
}

/** Match the amounts displayed on the cards; missing values follow all known values. */
export function sortHoldingGroups(groups: HoldingGroup[], sort: HoldingSortOrder): HoldingGroup[] {
  return [...groups].sort((a, b) => {
    if (sort === "navDate") return (b.navAsOf ?? "").localeCompare(a.navAsOf ?? "") || a.symbol.localeCompare(b.symbol);
    const aValue = holdingSortValue(a, sort);
    const bValue = holdingSortValue(b, sort);
    if (aValue == null && bValue != null) return 1;
    if (bValue == null && aValue != null) return -1;
    return (bValue ?? 0) - (aValue ?? 0) || a.symbol.localeCompare(b.symbol);
  });
}

export type HoldingChannelGroup = {
  account: PositionDetail["account"];
  positions: PositionDetail[];
  settledPositions: PositionDetail[];
  pendingPositions: PositionDetail[];
  shares: number | null;
  unitCost: number | null;
  cost: number;
  pendingCash: number;
  marketValue: number | null;
  holdingPnl: number | null;
  today: number | null;
  nav: number | null;
  navAsOf: string | null;
};

/** 展开基金时按销售渠道汇总实际持有；在途记录保留在对应渠道下。 */
export function groupHoldingChannels(positions: PositionDetail[]): HoldingChannelGroup[] {
  const byAccount = new Map<PositionDetail["account"], PositionDetail[]>();
  for (const position of positions) {
    const rows = byAccount.get(position.account) ?? [];
    rows.push(position);
    byAccount.set(position.account, rows);
  }

  return [...byAccount].map(([account, rows]) => {
    const settledPositions = rows.filter((row) => row.status === "settled");
    const pendingPositions = rows.filter((row) => row.status === "pending");
    const valued = settledPositions.filter((row) => row.marketValue != null);
    const dayValued = settledPositions.filter((row) => row.today != null);
    const navs = settledPositions.filter((row) => row.nav != null).map((row) => row.nav!);
    const navDates = settledPositions.map((row) => row.navAsOf).filter((date): date is string => Boolean(date));
    const shares = settledPositions.length > 0 && settledPositions.every((row) => row.shares != null)
      ? settledPositions.reduce((sum, row) => sum + row.shares!, 0)
      : null;
    const cost = settledPositions.reduce((sum, row) => sum + row.cost, 0);
    return {
      account,
      positions: rows,
      settledPositions,
      pendingPositions,
      shares,
      unitCost: shares != null && shares > 0 ? cost / shares : null,
      cost,
      pendingCash: pendingPositions.reduce((sum, row) => sum + row.cashDebited, 0),
      marketValue: valued.length ? valued.reduce((sum, row) => sum + row.marketValue!, 0) : null,
      holdingPnl: valued.length ? valued.reduce((sum, row) => sum + (row.holdingPnl ?? 0), 0) : null,
      today: dayValued.length ? dayValued.reduce((sum, row) => sum + row.today!, 0) : null,
      nav: navs.length > 0 && navs.every((value) => value === navs[0]) ? navs[0] : null,
      navAsOf: navDates.length > 0 && navDates.every((value) => value === navDates[0]) ? navDates[0] : null,
    };
  });
}

export function groupNasdaqHoldings(positions: PositionDetail[], names: Record<string, string>, qdiiFunds: Record<string, boolean> = {}): HoldingGroup[] {
  const bySymbol = new Map<string, PositionDetail[]>();
  for (const position of positions.filter((item) => (item.exposure === "nasdaq" || item.exposure === "fund"))) {
    const rows = bySymbol.get(position.symbol) ?? [];
    rows.push(position);
    bySymbol.set(position.symbol, rows);
  }
  return [...bySymbol].map(([symbol, rows]) => {
    const settled = rows.filter((row) => row.status === "settled");
    const pending = rows.filter((row) => row.status === "pending");
    const valued = settled.filter((row) => row.marketValue != null);
    const dayValued = settled.filter((row) => row.today != null);
    const navAsOf = settled.map((row) => row.navAsOf).filter((date): date is string => Boolean(date)).sort().at(0) ?? null;
    const isQdii = qdiiFunds[symbol] ?? isQdiiFund(names[symbol] ?? "", null, rows.some((row) => row.exposure === "nasdaq"));
    return {
      symbol,
      name: names[symbol] ?? symbol,
      isQdii,
      incomeDate: fundIncomeDate(navAsOf, isQdii),
      positions: rows.sort((a, b) => Number(a.status === "pending") - Number(b.status === "pending") || a.id - b.id),
      settledCount: settled.length,
      pendingCount: pending.length,
      cost: settled.reduce((sum, row) => sum + row.cost, 0),
      marketValue: valued.length ? valued.reduce((sum, row) => sum + row.marketValue!, 0) : null,
      holdingPnl: valued.length ? valued.reduce((sum, row) => sum + (row.holdingPnl ?? 0), 0) : null,
      today: dayValued.length ? dayValued.reduce((sum, row) => sum + row.today!, 0) : null,
      pendingCash: pending.reduce((sum, row) => sum + row.cashDebited, 0),
      unvaluedCount: settled.length - valued.length,
      navAsOf,
    };
  });
}

export function summarizeNasdaqHoldings(groups: HoldingGroup[]) {
  const settledCount = groups.reduce((sum, group) => sum + group.settledCount, 0);
  const pendingCount = groups.reduce((sum, group) => sum + group.pendingCount, 0);
  const valued = groups.filter((group) => group.marketValue != null);
  const todayValued = groups.filter((group) => group.today != null);
  const incomeDate = todayValued.map((group) => group.incomeDate).filter((date): date is string => Boolean(date)).sort().at(-1) ?? null;
  const incomeGroups = todayValued.filter((group) => group.incomeDate === incomeDate);
  return {
    fundCount: groups.length,
    settledCount,
    pendingCount,
    cost: groups.reduce((sum, group) => sum + group.cost, 0),
    marketValue: valued.length ? valued.reduce((sum, group) => sum + group.marketValue!, 0) : null,
    holdingPnl: valued.length ? valued.reduce((sum, group) => sum + (group.holdingPnl ?? 0), 0) : null,
    today: incomeGroups.length ? incomeGroups.reduce((sum, group) => sum + group.today!, 0) : null,
    incomeDate,
    incomeFundCount: incomeGroups.length,
    datedIncomeFundCount: todayValued.length,
    pendingCash: groups.reduce((sum, group) => sum + group.pendingCash, 0),
    unvaluedCount: groups.reduce((sum, group) => sum + group.unvaluedCount, 0),
  };
}

export function marketValueIncludingPending(marketValue: number | null, pendingCash: number): number | null {
  return marketValue == null ? (pendingCash > 0 ? pendingCash : null) : marketValue + pendingCash;
}
