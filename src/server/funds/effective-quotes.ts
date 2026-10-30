import type Database from "better-sqlite3";
import { listNasdaqFunds, type CatalogRow } from "./catalog";

/** All consumers read the current structured quota projection. */
export function listEffectiveQuotaCells(database: Database.Database) {
  return effectiveQuotaCells(listNasdaqFunds(database));
}

export function effectiveQuotaCells(funds: CatalogRow[]) {
  return funds.flatMap((fund) => {
    return (["direct", "agency"] as const).flatMap((channel) => {
      const direct = channel === "direct";
      const availability = direct ? fund.directStatus : fund.agencyStatus;
      const status = direct ? fund.directTradeStatus : fund.agencyTradeStatus;
      const updatedAt = direct ? fund.directQuoteUpdatedAt : fund.agencyQuoteUpdatedAt;
      if (availability === "unavailable" || !status || !updatedAt) return [];
      const scope = direct ? fund.directLimitScope : fund.agencyLimitScope;
      const scopeSource = direct ? fund.directQuoteSourceUrl : fund.agencyScopeSourceUrl;
      return [{
        symbol: fund.code,
        share_class: fund.shareClass,
        channel_kind: channel,
        status,
        daily_limit: status === "paused" ? null : direct ? fund.directDailyLimit : fund.agencyDailyLimit,
        quota_scope: scope && scopeSource ? `${scopeSource}:${channel}:${scope}` : `${fund.code}:${fund.shareClass}:${channel}`,
        source: direct ? fund.directQuoteSourceUrl : fund.agencyQuoteSourceUrl,
        biz_date: null,
        updated_at: updatedAt,
      }];
    });
  });
}
