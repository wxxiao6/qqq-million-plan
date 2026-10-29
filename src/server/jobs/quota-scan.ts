import { saveRecentNavHistory } from "../ledger/recent-pending";
/** 任务 A：按份额与渠道保存公开申购额度。 */

import { beijingTodayISO } from "@/lib/format";
import type { NasdaqShareSituation } from "@/lib/market";
import { getDb } from "../db";
import { fetchMockMarket } from "../market/mock";
import { writeJob } from "./status";

export type JobResult = { ok: true; bizDate: string } | { ok: false; error: string };

const CHANNELS = ["direct", "agency"] as const;

export function runQuotaScan(input?: {
  now?: Date;
  shares?: NasdaqShareSituation[];
  error?: string;
  source?: string;
}): JobResult {
  const now = input?.now ?? new Date();
  const bizDate = beijingTodayISO(now);
  const at = now.toISOString();

  if (input?.error) {
    writeJob("quota_scan", { ok: false, at, bizDate, error: input.error });
    return { ok: false, error: input.error };
  }

  const fetched =
    input?.shares != null
      ? { ok: true as const, shares: input.shares }
      : fetchMockMarket();

  if (!fetched.ok) {
    writeJob("quota_scan", { ok: false, at, bizDate, error: fetched.error });
    return { ok: false, error: fetched.error };
  }

  const db = getDb();
  const catalogCodes = new Set((db.prepare("SELECT code FROM nasdaq_funds").all() as Array<{ code: string }>).map((row) => row.code));
  try {
    const run = db.transaction(() => {
      const upsertUniverse = db.prepare(`
        INSERT INTO quota_universe (
          symbol, share_class, name, manager, min_order, active, currency, market_type,
          fund_status, fund_daily_limit, fund_source, fund_biz_date, fund_updated_at
        ) VALUES (
          @symbol, @shareClass, @name, @manager, 10, 1, @currency, @marketType,
          @fundStatus, @fundDailyLimit, @fundSource, @bizDate, @updatedAt
        )
        ON CONFLICT(symbol, share_class) DO UPDATE SET
          name = excluded.name,
          manager = excluded.manager,
          currency = excluded.currency,
          market_type = excluded.market_type,
          fund_status = COALESCE(excluded.fund_status, quota_universe.fund_status),
          fund_daily_limit = CASE WHEN excluded.fund_status IS NOT NULL THEN excluded.fund_daily_limit ELSE quota_universe.fund_daily_limit END,
          fund_source = COALESCE(excluded.fund_source, quota_universe.fund_source),
          fund_biz_date = CASE WHEN excluded.fund_status IS NOT NULL OR excluded.fund_daily_limit IS NOT NULL THEN excluded.fund_biz_date ELSE quota_universe.fund_biz_date END,
          fund_updated_at = CASE WHEN excluded.fund_status IS NOT NULL OR excluded.fund_daily_limit IS NOT NULL THEN excluded.fund_updated_at ELSE quota_universe.fund_updated_at END,
          active = 1
      `);
      const upsertCell = db.prepare(`
        INSERT INTO quota_cells (
          symbol, share_class, channel_kind, status, daily_limit,
          quota_scope, source, biz_date, updated_at
        ) VALUES (
          @symbol, @shareClass, @channelKind, @status, @dailyLimit,
          @quotaScope, @source, @bizDate, @updatedAt
        )
        ON CONFLICT(symbol, share_class, channel_kind) DO UPDATE SET
          status = excluded.status,
          daily_limit = excluded.daily_limit,
          quota_scope = excluded.quota_scope,
          source = excluded.source,
          biz_date = excluded.biz_date,
          updated_at = excluded.updated_at
      `);
      const readCell = db.prepare(
        `SELECT status FROM quota_cells
         WHERE symbol = ? AND share_class = ? AND channel_kind = ?`,
      );
      const logStatus = db.prepare(
        `INSERT INTO quota_status_log (
           symbol, share_class, channel_kind, from_status, to_status, at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      );

      for (const share of fetched.shares) {
        if (!catalogCodes.has(share.symbol)) continue;
        if (share.navHistory?.length) saveRecentNavHistory(share.symbol, share.navHistory);
        upsertUniverse.run({
          symbol: share.symbol,
          shareClass: share.shareClass,
          name: share.name,
          manager: share.manager,
          currency: share.currency ?? "CNY",
          marketType: share.marketType ?? "otc",
          fundStatus: share.fundStatus ?? null,
          fundDailyLimit: share.fundDailyLimit ?? null,
          fundSource: share.fundStatus != null || share.fundDailyLimit != null
            ? share.quotaSource ?? input?.source ?? "unknown"
            : null,
          bizDate,
          updatedAt: at,
        });

        const directLimit = share.directStatus === "paused" ? null : share.directDailyLimit;
        const agencyLimit = share.agencyStatus === "paused" ? null : share.agencyDailyLimit;
        for (const channel of CHANNELS) {
          const status =
            channel === "direct"
              ? share.directStatus
              : share.agencyStatus;
          const dailyLimit =
            channel === "direct"
              ? directLimit
              : agencyLimit;
          if (!status) {
            // 源没有给出新状态时保留上次读数，由日期标记其新鲜度。
            continue;
          }
          const previous = readCell.get(
            share.symbol,
            share.shareClass,
            channel,
          ) as { status: string } | undefined;
          upsertCell.run({
            symbol: share.symbol,
            shareClass: share.shareClass,
            channelKind: channel,
            status,
            dailyLimit: status === "paused" ? null : dailyLimit,
            quotaScope: `${share.symbol}:${share.shareClass}:${channel}`,
            source: share.quotaSource ?? input?.source ?? "mock",
            bizDate,
            updatedAt: at,
          });
          if (previous?.status !== status) {
            logStatus.run(
              share.symbol,
              share.shareClass,
              channel,
              previous?.status ?? null,
              status,
              at,
            );
          }
        }
      }
    });
    run();
    const upsertNav = db.prepare(
      `INSERT INTO nav_snapshots (
         symbol, as_of, nav, source, nav_change_pct, source_url, market_price, market_price_at
       ) VALUES (?, ?, ?, 'real', ?, ?, ?, ?)
       ON CONFLICT(symbol, as_of) DO UPDATE SET nav = excluded.nav, source = excluded.source,
         nav_change_pct = excluded.nav_change_pct, source_url = excluded.source_url,
         market_price = excluded.market_price, market_price_at = excluded.market_price_at`,
    );
    const writeNav = db.transaction(() => {
      for (const share of fetched.shares) {
        if (!catalogCodes.has(share.symbol)) continue;
        if (share.navHistory?.length) saveRecentNavHistory(share.symbol, share.navHistory);
        if (share.priorNav != null && Number.isFinite(share.priorNav) && share.priorNav > 0 &&
            share.priorNavDate && share.navDate && share.priorNavDate < share.navDate) {
          upsertNav.run(share.symbol, share.priorNavDate, share.priorNav, null,
            share.sourceUrl ?? null, null, null);
        }
        if (share.nav != null && Number.isFinite(share.nav) && share.nav > 0 && share.navDate) {
          upsertNav.run(
            share.symbol,
            share.navDate,
            share.nav,
            share.navChangePct ?? null,
            share.sourceUrl ?? null,
            share.marketPrice ?? null,
            share.marketPriceAt ?? null,
          );
        }
      }
    });
    writeNav();
  } catch (error) {
    const message = error instanceof Error ? error.message : "额度覆盖失败";
    writeJob("quota_scan", { ok: false, at, bizDate, error: message });
    return { ok: false, error: message };
  }

  writeJob("quota_scan", { ok: true, at, bizDate });
  return { ok: true, bizDate };
}
