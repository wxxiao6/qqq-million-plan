/** 纳指代码拉取：统一目录决定成员资格，额度与净值单独读取。 */

import type { ChannelKind } from "@/lib/quota-math";
import { getDb } from "../db";
import { listNasdaqFunds } from "../funds/catalog";
import { getQuotaBoard } from "../quota";
import type { QuotaAmount } from "@/lib/quota-math";

export type NasdaqFundLookup = {
  symbol: string;
  name: string;
  shareClass: string;
  shareClasses: string[];
  hasDirect: boolean;
  hasAgency: boolean;
  nav: number | null;
  navDate: string | null;
  remainingDirect: QuotaAmount;
  remainingAgency: QuotaAmount;
};

type UniverseHit = {
  symbol: string;
  shareClass: string;
  name: string;
};

function latestNav(symbol: string): { nav: number; asOf: string } | null {
  const row = getDb()
    .prepare(
      `SELECT nav, as_of AS asOf FROM nav_snapshots
       WHERE symbol = ? ORDER BY as_of DESC LIMIT 1`,
    )
    .get(symbol) as { nav: number; asOf: string } | undefined;
  return row ?? null;
}

function remainingOf(
  symbol: string,
  shareClass: string,
  channel: ChannelKind,
): QuotaAmount {
  const row = getQuotaBoard().rows.find(
    (item) => item.symbol === symbol && item.shareClass === shareClass,
  );
  if (!row) return { kind: "unknown" };
  const cell = channel === "direct" ? row.direct : row.agency;
  return cell?.remaining ?? { kind: "unknown" };
}

function channelFlags(symbol: string): { hasDirect: boolean; hasAgency: boolean } {
  // Historical holdings are allowed even when today's quota is unknown or paused.
  // Explicit channel restrictions, such as 021000 being direct-only, still apply.
  const fund = listNasdaqFunds(getDb()).find((item) => item.code === symbol);
  return {
    hasDirect: Boolean(fund && fund.venue === "otc" && fund.directStatus !== "unavailable"),
    hasAgency: Boolean(fund && fund.agencyStatus !== "unavailable"),
  };
}

export function lookupNasdaqFundSync(symbolRaw: string): NasdaqFundLookup | null {
  const symbol = symbolRaw.trim();
  if (!symbol) return null;

  const universe = getDb()
    .prepare(
      `SELECT code AS symbol, share_class AS shareClass, name
       FROM nasdaq_funds WHERE code = ?
       ORDER BY share_class`,
    )
    .all(symbol) as UniverseHit[];

  const hits = universe;
  if (hits.length === 0) return null;

  const preferred =
    hits.find((row) => row.shareClass === "A") ?? hits[0];
  const shareClasses = hits.map((row) => row.shareClass);
  const flags = channelFlags(preferred.symbol);
  const stored = latestNav(symbol);

  return {
    symbol: preferred.symbol,
    name: preferred.name,
    shareClass: preferred.shareClass,
    shareClasses,
    hasDirect: flags.hasDirect,
    hasAgency: flags.hasAgency,
    nav: stored?.nav ?? null,
    navDate: stored?.asOf ?? null,
    remainingDirect: remainingOf(preferred.symbol, preferred.shareClass, "direct"),
    remainingAgency: remainingOf(preferred.symbol, preferred.shareClass, "agency"),
  };
}
