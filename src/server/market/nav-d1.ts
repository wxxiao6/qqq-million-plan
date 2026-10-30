import type { MarketD1 } from "./tiantian-d1";
import type { FundNavRecord, FundNavSource } from "./source";
import { beijingTodayISO } from "@/lib/format";
import { autoEstimateStatement, type ReconcileD1 } from "../ledger/reconcile-d1";

export const NAV_CHUNK_SIZE = 25;

/** The caller orchestrates chunks and records overall job status. */
export async function syncNavChunkD1(
  db: MarketD1,
  input: { codes: string[]; observedAt: string },
  source: FundNavSource,
  fetcher: typeof fetch = fetch,
) {
  if (input.codes.length > NAV_CHUNK_SIZE) throw new Error("Too many funds in NAV chunk");
  if (new Set(input.codes).size !== input.codes.length) throw new Error("Duplicate fund in NAV chunk");
  const good: FundNavRecord[] = [];
  const failed: Array<{ code: string; error: string }> = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, input.codes.length) }, async () => {
    while (cursor < input.codes.length) {
      const code = input.codes[cursor++];
      try { good.push(await source.fetchNav(code, fetcher)); }
      catch (error) { failed.push({ code, error: error instanceof Error ? error.message : String(error) }); }
    }
  }));
  await saveNavChunkD1(db, good, source.name, input.observedAt);
  return { requested: input.codes.length, success: good.length, failed };
}

/** Write all records in one transaction. The existence test and manual-source
 * guard run inside that transaction rather than on a stale pre-read. */
export async function saveNavChunkD1(db: MarketD1, records: FundNavRecord[], source: string, observedAt: string) {
  const statements: unknown[] = [];
  for (const item of records) {
    statements.push(db.prepare(`INSERT INTO fund_nav_history (code,nav_date,nav,daily_change_pct,source,source_url,fetched_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(code,nav_date,source) DO UPDATE SET nav=excluded.nav,
      daily_change_pct=excluded.daily_change_pct,source_url=excluded.source_url,fetched_at=excluded.fetched_at`)
      .bind(item.code, item.navDate, item.nav, item.dailyChangePct, source, item.sourceUrl, observedAt));
    statements.push(db.prepare(`INSERT INTO nasdaq_fund_observations (code,nav,nav_date,daily_change_pct,source_url,updated_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET nav=excluded.nav,nav_date=excluded.nav_date,
      daily_change_pct=excluded.daily_change_pct,source_url=excluded.source_url,updated_at=excluded.updated_at`)
      .bind(item.code, item.nav, item.navDate, item.dailyChangePct, item.sourceUrl, observedAt));
    statements.push(db.prepare(`INSERT INTO nav_snapshots (symbol,as_of,nav,source,nav_change_pct,source_url)
      SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM positions WHERE symbol=? AND exposure='nasdaq')
        OR EXISTS (SELECT 1 FROM dca_plans WHERE symbol=? AND status='active' AND exposure='nasdaq')
      ON CONFLICT(symbol,as_of) DO UPDATE SET nav=excluded.nav,source=excluded.source,
      nav_change_pct=excluded.nav_change_pct,source_url=excluded.source_url WHERE nav_snapshots.source <> 'manual'`)
      .bind(item.code, item.navDate, item.nav, source, item.dailyChangePct, item.sourceUrl, item.code, item.code));
    statements.push(autoEstimateStatement(db as unknown as ReconcileD1, item.code, beijingTodayISO(new Date(observedAt)), observedAt));
  }
  if (statements.length) await db.batch(statements);
}

/** Called after all NAV chunks have finished. Like getDynamicMarketValue, this
 * includes settled positions with a usable latest NAV and leaves a missing
 * total untouched instead of recording zero. */
export function portfolioSnapshotStatement(db: MarketD1, bizDate: string) {
  return db.prepare(`INSERT INTO portfolio_snapshots (as_of, dynamic_mv)
    SELECT ?, SUM(p.shares * n.nav)
    FROM positions p JOIN nav_snapshots n ON n.symbol=p.symbol
      AND n.as_of=(SELECT MAX(latest.as_of) FROM nav_snapshots latest WHERE latest.symbol=p.symbol)
    WHERE p.status='settled' AND p.exposure IN ('nasdaq','gold','crypto')
      AND p.shares IS NOT NULL AND (p.t_date IS NULL OR n.as_of >= p.t_date)
    HAVING COUNT(p.shares * n.nav) > 0
    ON CONFLICT(as_of) DO UPDATE SET dynamic_mv=excluded.dynamic_mv`).bind(bizDate);
}

export async function updatePortfolioSnapshotD1(db: MarketD1, bizDate: string) {
  await db.batch([portfolioSnapshotStatement(db, bizDate)]);
}
