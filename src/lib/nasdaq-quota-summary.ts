export type QuotaSummaryRow = {
  code: string;
  directStatus: "verified" | "unverified" | "unavailable" | null;
  agencyStatus: "verified" | "unverified" | "unavailable" | null;
  directTradeStatus: "open" | "limited" | "paused" | null;
  agencyTradeStatus: "open" | "limited" | "paused" | null;
  directDailyLimit: number | null;
  agencyDailyLimit: number | null;
  directLimitScope: string | null;
  agencyLimitScope: string | null;
  agencyScopeSourceUrl?: string | null;
  directQuoteSourceUrl: string | null;
  agencyQuoteSourceUrl: string | null;
};

export function sumVerifiedQuota(rows: QuotaSummaryRow[], channel: "direct" | "agency") {
  const limits = new Map<string, number>();
  let coveredShares = 0;
  for (const row of rows) {
    const verified = channel === "direct" ? row.directStatus : row.agencyStatus;
    if (verified === "unavailable") continue;
    const status = channel === "direct" ? row.directTradeStatus : row.agencyTradeStatus;
    const limit = channel === "direct" ? row.directDailyLimit : row.agencyDailyLimit;
    if (status === "paused") {
      coveredShares++;
      continue;
    }
    if (verified !== "verified" || status !== "limited" || limit == null ||
        !Number.isFinite(limit) || limit < 0) continue;
    coveredShares++;
    const scope = channel === "direct" ? row.directLimitScope : row.agencyLimitScope;
    const source = channel === "direct" ? row.directQuoteSourceUrl : row.agencyScopeSourceUrl ?? row.agencyQuoteSourceUrl;
    const key = scope && source ? `${channel}:${source}:${scope}` : `${channel}:${row.code}`;
    limits.set(key, limits.has(key) ? Math.min(limits.get(key)!, limit) : limit);
  }
  return {
    total: [...limits.values()].reduce((sum, value) => sum + value, 0),
    quotaGroups: limits.size,
    coveredShares,
    totalShares: rows.length,
  };
}

/** A conservative single-account estimate: shared share-class groups count once across channels. */
export function estimatePurchasableQuota(rows: QuotaSummaryRow[]) {
  const parent = rows.map((_, index) => index);
  const root = (index: number): number => {
    while (parent[index] !== index) index = parent[index];
    return index;
  };
  const scopedGroups = new Map<string, number>();
  rows.forEach((row, index) => {
    for (const channel of ["direct", "agency"] as const) {
      const scope = channel === "direct" ? row.directLimitScope : row.agencyLimitScope;
      const source = channel === "direct" ? row.directQuoteSourceUrl : row.agencyScopeSourceUrl ?? row.agencyQuoteSourceUrl;
      if (!scope || !source) continue;
      const key = `${source}:${scope}`;
      const first = scopedGroups.get(key);
      if (first == null) scopedGroups.set(key, index);
      else parent[root(index)] = root(first);
    }
  });

  const groups = new Map<number, QuotaSummaryRow[]>();
  rows.forEach((row, index) => {
    const key = root(index);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  });
  let total = 0;
  for (const group of groups.values()) {
    total += Math.max(sumVerifiedQuota(group, "direct").total, sumVerifiedQuota(group, "agency").total);
  }
  const coveredShares = rows.filter((row) =>
    ["direct", "agency"].some((channel) => {
      const status = channel === "direct" ? row.directTradeStatus : row.agencyTradeStatus;
      const verified = channel === "direct" ? row.directStatus : row.agencyStatus;
      const limit = channel === "direct" ? row.directDailyLimit : row.agencyDailyLimit;
      return verified !== "unavailable" && (status === "paused" ||
        (verified === "verified" && status === "limited" && limit != null && Number.isFinite(limit) && limit >= 0));
    })).length;
  return { total, coveredShares, totalShares: rows.length };
}
