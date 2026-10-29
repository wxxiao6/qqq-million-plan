import { sumVerifiedQuota, type QuotaSummaryRow } from "./nasdaq-quota-summary";

export type FundSort = "quota" | "quota_asc" | "tracking_asc" | "tracking_desc";
export type SalesChannel = "agency" | "direct";

type SortableFund = {
  agencyStatus: "verified" | "unverified" | "unavailable" | null;
  directStatus: "verified" | "unverified" | "unavailable" | null;
  agencyTradeStatus: "open" | "limited" | "paused" | null;
  directTradeStatus: "open" | "limited" | "paused" | null;
  agencyDailyLimit: number | null;
  directDailyLimit: number | null;
  trackingErrorPct: number | null;
};

export function isPaused(fund: SortableFund, channel: SalesChannel): boolean {
  return channel === "agency"
    ? fund.agencyTradeStatus === "paused"
    : fund.directTradeStatus === "paused";
}

function quotaRank(fund: SortableFund, channel: SalesChannel): [number, number] {
  if (isPaused(fund, channel)) return [3, 0];
  const verified = channel === "agency" ? fund.agencyStatus === "verified" : fund.directStatus === "verified";
  const status = channel === "agency" ? fund.agencyTradeStatus : fund.directTradeStatus;
  const limit = channel === "agency" ? fund.agencyDailyLimit : fund.directDailyLimit;
  if (verified && status === "limited" && limit != null && Number.isFinite(limit) && limit >= 0) return [0, -limit];
  if (verified && status === "open") return [1, 0];
  return [2, 0];
}

export function sortOtcFunds<T extends SortableFund>(funds: T[], channel: SalesChannel, sort: FundSort): T[] {
  return [...funds].sort((a, b) => {
    if (sort === "quota" || sort === "quota_asc") {
      const [aGroup, aValue] = quotaRank(a, channel);
      const [bGroup, bValue] = quotaRank(b, channel);
      return aGroup - bGroup || (sort === "quota_asc" ? bValue - aValue : aValue - bValue);
    }
    const aPaused = isPaused(a, channel);
    const bPaused = isPaused(b, channel);
    if (aPaused !== bPaused) return Number(aPaused) - Number(bPaused);
    const aMissing = a.trackingErrorPct == null;
    const bMissing = b.trackingErrorPct == null;
    if (aMissing !== bMissing) return Number(aMissing) - Number(bMissing);
    if (aMissing || bMissing) return 0;
    return sort === "tracking_asc"
      ? a.trackingErrorPct! - b.trackingErrorPct!
      : b.trackingErrorPct! - a.trackingErrorPct!;
  });
}

/** Preserve the selected sort and keep paused shares at the end of the table. */
export function groupFundsByManager<T extends SortableFund & { code: string; manager: string | null }>(
  funds: T[], channel?: SalesChannel,
) {
  const groups = new Map<string, { manager: string | null; rows: T[] }>();
  for (const fund of funds) {
    // An unknown manager must not merge unrelated funds into one company.
    const key = `${fund.manager ?? fund.code}:${channel && isPaused(fund, channel) ? "paused" : "other"}`;
    let group = groups.get(key);
    if (!group) {
      group = { manager: fund.manager, rows: [] };
      groups.set(key, group);
    }
    group.rows.push(fund);
  }
  return [...groups.values()];
}

/** Order companies by their deduplicated quota; keep each company's shares together. */
export function sortOtcFundGroups<T extends SortableFund & QuotaSummaryRow & { manager: string | null }>(
  funds: T[], channel: SalesChannel, sort: FundSort,
) {
  const groups = groupFundsByManager(sortOtcFunds(funds, channel, sort), channel);
  if (sort !== "quota" && sort !== "quota_asc") return groups;
  const rank = (rows: T[]) => Math.min(...rows.map((row) => quotaRank(row, channel)[0]));
  return groups.sort((a, b) => {
    const tier = rank(a.rows) - rank(b.rows);
    if (tier) return tier;
    const aTotal = sumVerifiedQuota(a.rows, channel).total;
    const bTotal = sumVerifiedQuota(b.rows, channel).total;
    return sort === "quota_asc" ? aTotal - bTotal : bTotal - aTotal;
  });
}
