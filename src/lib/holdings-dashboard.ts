import { decimal, roundMoney, sumDecimal, sumMoney } from "./decimal";
import type { PositionDetail } from "@/server/ledger";
import { advanceWeekdays } from "./format";
import { classifyHoldingFund, type HoldingFundCategory, type HoldingFundScope } from "./fund-category";

export function holdingFundCategory(position: Pick<PositionDetail, "symbol" | "exposure">, names: Record<string, string>, categories: Record<string, HoldingFundCategory> = {}): HoldingFundCategory {
  return categories[position.symbol] ?? classifyHoldingFund(names[position.symbol] ?? "", null, position.exposure === "nasdaq");
}

export function filterHoldingFundScope(positions: PositionDetail[], names: Record<string, string>, scope: HoldingFundScope, categories: Record<string, HoldingFundCategory> = {}): PositionDetail[] {
  return positions.filter((position) => scope === "all" || holdingFundCategory(position, names, categories) === scope);
}

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
  category: HoldingFundCategory;
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
      ? sumDecimal(settledPositions.map((row) => row.shares!))
      : null;
    const cost = sumMoney(settledPositions.map((row) => row.cost));
    return {
      account,
      positions: rows,
      settledPositions,
      pendingPositions,
      shares,
      unitCost: shares != null && shares > 0 ? decimal(cost).div(shares).toNumber() : null,
      cost,
      pendingCash: sumMoney(pendingPositions.map((row) => row.cashDebited)),
      marketValue: valued.length ? sumMoney(valued.map((row) => row.marketValue!)) : null,
      holdingPnl: valued.length ? roundMoney(decimal(sumMoney(valued.map((row) => row.marketValue!))).minus(sumMoney(valued.map((row) => row.cost)))) : null,
      today: dayValued.length ? sumMoney(dayValued.map((row) => row.today!)) : null,
      nav: navs.length > 0 && navs.every((value) => value === navs[0]) ? navs[0] : null,
      navAsOf: navDates.length > 0 && navDates.every((value) => value === navDates[0]) ? navDates[0] : null,
    };
  });
}

export function groupNasdaqHoldings(positions: PositionDetail[], names: Record<string, string>, qdiiFunds: Record<string, boolean> = {}, categories: Record<string, HoldingFundCategory> = {}): HoldingGroup[] {
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
    const channels = groupHoldingChannels(rows);
    const valuedChannels = channels.filter((channel) => channel.marketValue != null);
    const dayChannels = channels.filter((channel) => channel.today != null);
    const navAsOf = settled.map((row) => row.navAsOf).filter((date): date is string => Boolean(date)).sort().at(0) ?? null;
    const isQdii = qdiiFunds[symbol] ?? isQdiiFund(names[symbol] ?? "", null, rows.some((row) => row.exposure === "nasdaq"));
    return {
      symbol,
      name: names[symbol] ?? symbol,
      category: holdingFundCategory(rows[0], names, categories),
      isQdii,
      incomeDate: fundIncomeDate(navAsOf, isQdii),
      positions: rows.sort((a, b) => Number(a.status === "pending") - Number(b.status === "pending") || a.id - b.id),
      settledCount: settled.length,
      pendingCount: pending.length,
      cost: sumMoney(channels.map((channel) => channel.cost)),
      marketValue: valuedChannels.length ? sumMoney(valuedChannels.map((channel) => channel.marketValue!)) : null,
      holdingPnl: valuedChannels.length ? sumMoney(valuedChannels.map((channel) => channel.holdingPnl ?? 0)) : null,
      today: dayChannels.length ? sumMoney(dayChannels.map((channel) => channel.today!)) : null,
      pendingCash: sumMoney(pending.map((row) => row.cashDebited)),
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
    cost: sumMoney(groups.map((group) => group.cost)),
    marketValue: valued.length ? sumMoney(valued.map((group) => group.marketValue!)) : null,
    holdingPnl: valued.length ? sumMoney(valued.map((group) => group.holdingPnl ?? 0)) : null,
    today: incomeGroups.length ? sumMoney(incomeGroups.map((group) => group.today!)) : null,
    incomeDate,
    incomeFundCount: incomeGroups.length,
    datedIncomeFundCount: todayValued.length,
    pendingCash: sumMoney(groups.map((group) => group.pendingCash)),
    unvaluedCount: groups.reduce((sum, group) => sum + group.unvaluedCount, 0),
  };
}

export function marketValueIncludingPending(marketValue: number | null, pendingCash: number): number | null {
  return marketValue == null ? (pendingCash > 0 ? pendingCash : null) : roundMoney(decimal(marketValue).plus(pendingCash));
}
