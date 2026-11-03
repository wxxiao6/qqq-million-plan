import type { MarketD1 } from "./tiantian-d1";
import type { FundNavRecord, FundNavSource } from "./source";
import { beijingTodayISO } from "@/lib/format";
import { autoEstimateStatement, type ReconcileD1 } from "../ledger/reconcile-d1";

// Three history dates require up to nine D1 statements per fund. Four funds
// leave room for reads and fetches within a small Workers request budget.
export const NAV_CHUNK_SIZE = 4;

export async function syncNavChunkD1(db: MarketD1, input: { codes: string[]; observedAt: string }, source: FundNavSource, fetcher: typeof fetch = fetch) {
  if (input.codes.length > NAV_CHUNK_SIZE) throw new Error("Too many funds in NAV chunk");
  if (new Set(input.codes).size !== input.codes.length) throw new Error("Duplicate fund in NAV chunk");
  const good: FundNavRecord[] = [];
  const failed: Array<{ code: string; error: string }> = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, input.codes.length) }, async () => {
    while (cursor < input.codes.length) {
      const code = input.codes[cursor++];
      try { good.push(await source.fetchNav(code, fetcher)); }
      catch { failed.push({ code, error: "净值暂时无法获取，稍后自动重试" }); }
    }
  }));
  await saveNavChunkD1(db, good, source.name, input.observedAt);
  if (failed.length) await db.batch(failed.map((item) => failedNavStatement(db, item.code, input.observedAt, item.error)));
  return { requested: input.codes.length, success: good.length, failed };
}

export function failedNavStatement(db: MarketD1, code: string, observedAt: string, error: string) {
  return db.prepare(`INSERT INTO fund_nav_sync(code,attempted_at,error) VALUES (?,?,?)
    ON CONFLICT(code) DO UPDATE SET attempted_at=excluded.attempted_at,error=excluded.error
    WHERE excluded.attempted_at>=fund_nav_sync.attempted_at`).bind(code, observedAt, error);
}

/** Shared quotes are independent of radar membership. forHolding also prices a
 * confirmed selection before the new position exists. Manual prices survive. */
export async function saveNavChunkD1(db: MarketD1, records: FundNavRecord[], source: string, observedAt: string, forHolding = false) {
  const statements: unknown[] = [];
  for (const item of records) {
    const recent = item.recentHistory?.length ? item.recentHistory : [item];
    for (const entry of recent) {
      statements.push(db.prepare(`INSERT INTO fund_nav_history(code,nav_date,nav,daily_change_pct,source,source_url,fetched_at)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(code,nav_date,source) DO UPDATE SET nav=excluded.nav,
        daily_change_pct=excluded.daily_change_pct,source_url=excluded.source_url,fetched_at=excluded.fetched_at
        WHERE excluded.fetched_at>=fund_nav_history.fetched_at`)
        .bind(item.code, entry.navDate, entry.nav, entry.dailyChangePct, source, item.sourceUrl, observedAt));
      statements.push(db.prepare(`INSERT INTO nav_snapshots(symbol,as_of,nav,source,nav_change_pct,source_url)
        SELECT h.code,h.nav_date,h.nav,h.source,h.daily_change_pct,h.source_url FROM fund_nav_history h
        WHERE h.code=? AND h.nav_date=? AND h.source=?
          AND NOT EXISTS(SELECT 1 FROM fund_nav_history newer WHERE newer.code=h.code AND newer.nav_date=h.nav_date AND newer.fetched_at>h.fetched_at)
          AND (?=1 OR EXISTS (SELECT 1 FROM positions WHERE symbol=? AND exposure IN ('nasdaq','fund') AND status IN ('settled','pending'))
          OR EXISTS (SELECT 1 FROM dca_plans WHERE symbol=? AND status='active' AND exposure='nasdaq' AND ended_at IS NULL))
        ON CONFLICT(symbol,as_of) DO UPDATE SET nav=excluded.nav,source=excluded.source,
        nav_change_pct=excluded.nav_change_pct,source_url=excluded.source_url WHERE nav_snapshots.source<>'manual'`)
        .bind(item.code, entry.navDate, source, forHolding ? 1 : 0, item.code, item.code));
    }
    statements.push(db.prepare(`INSERT INTO nasdaq_fund_observations(code,nav,nav_date,daily_change_pct,source_url,updated_at)
      SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM nasdaq_funds WHERE code=?)
      ON CONFLICT(code) DO UPDATE SET nav=excluded.nav,nav_date=excluded.nav_date,daily_change_pct=excluded.daily_change_pct,
      source_url=excluded.source_url,updated_at=excluded.updated_at
      WHERE excluded.nav_date>nasdaq_fund_observations.nav_date OR nasdaq_fund_observations.nav_date IS NULL
        OR (excluded.nav_date=nasdaq_fund_observations.nav_date AND excluded.updated_at>=nasdaq_fund_observations.updated_at)`)
      .bind(item.code, item.nav, item.navDate, item.dailyChangePct, item.sourceUrl, observedAt, item.code));
    statements.push(db.prepare(`INSERT INTO fund_nav_sync(code,attempted_at,succeeded_at,nav_date,error) VALUES (?,?,?,?,NULL)
      ON CONFLICT(code) DO UPDATE SET attempted_at=excluded.attempted_at,succeeded_at=excluded.succeeded_at,
      nav_date=MAX(COALESCE(fund_nav_sync.nav_date,''),excluded.nav_date),error=NULL
      WHERE excluded.attempted_at>=fund_nav_sync.attempted_at`).bind(item.code, observedAt, observedAt, item.navDate));
    statements.push(autoEstimateStatement(db as unknown as ReconcileD1, item.code, beijingTodayISO(new Date(observedAt)), observedAt));
  }
  if (statements.length) await db.batch(statements);
}

/** Missing prices are excluded, and never persisted as zero. */
export function portfolioSnapshotStatement(db: MarketD1, bizDate: string) {
  // Split fixed-point operands into integer limbs before multiplying. A REAL
  // ROUND(SUM(shares*nav),2) loses half-cent ties such as 1 * 1.005.
  return db.prepare(`WITH units AS MATERIALIZED (
    SELECT p.symbol,p.account,CAST(ROUND(p.shares*100000000,0) AS INTEGER) AS s,
      CAST(ROUND(n.nav*100000000,0) AS INTEGER) AS n FROM positions p JOIN nav_snapshots n ON n.symbol=p.symbol
      AND n.as_of=(SELECT MAX(latest.as_of) FROM nav_snapshots latest WHERE latest.symbol=p.symbol)
    WHERE p.status='settled' AND p.exposure IN ('nasdaq','fund','gold','crypto')
      AND p.shares IS NOT NULL AND (p.t_date IS NULL OR n.as_of>=p.t_date)
    ), limbs AS MATERIALIZED (
      SELECT symbol,account,s/100000000 AS sh,s%100000000 AS sl,n/100000000 AS nh,n%100000000 AS nl FROM units
    ), products AS MATERIALIZED (
      SELECT symbol,account,sh*nh*100+(sh*nl+sl*nh)/1000000+(sl*nl)/100000000000000 AS cents,
        ((sh*nl+sl*nh)%1000000)*100000000+(sl*nl)%100000000000000 AS tail FROM limbs
    ), accounts AS (
      SELECT SUM(cents)+SUM(tail)/100000000000000+
        CASE WHEN SUM(tail)%100000000000000>=50000000000000 THEN 1 ELSE 0 END AS cents
      FROM products GROUP BY symbol,account
    )
    INSERT INTO portfolio_snapshots(as_of,dynamic_mv) SELECT ?,SUM(cents)/100.0 FROM accounts
    HAVING COUNT(cents)>0
    ON CONFLICT(as_of) DO UPDATE SET dynamic_mv=excluded.dynamic_mv`).bind(bizDate);
}

export async function updatePortfolioSnapshotD1(db: MarketD1, bizDate: string) {
  await db.batch([portfolioSnapshotStatement(db, bizDate)]);
}
