import { beijingTodayISO } from "@/lib/format";
import { NAV_CHUNK_SIZE, syncNavChunkD1, updatePortfolioSnapshotD1 } from "./nav-d1";
import { AGENCY_QUOTA_CHUNK_SIZE, syncAgencyQuotaChunkD1, type AgencyQuotaFund, type MarketD1 } from "./tiantian-d1";
import { tiantianNavSource } from "./tiantian";

type CatalogDb = MarketD1;
export type RefreshPhase = "nav" | "quota";
export type RefreshFailure = { code: string; error: string };
export type RefreshTotals = { requested: number; success: number; failed: RefreshFailure[] };

export function newRefreshRun(now = new Date()) {
  return { chunked: true as const, runId: crypto.randomUUID(), observedAt: now.toISOString(), bizDate: beijingTodayISO(now) };
}

/** Cursor is a catalog code, not a client-supplied URL or SQL fragment. */
export async function refreshCloudChunk(db: CatalogDb, input: {
  phase: RefreshPhase; after: string; runId: string; bizDate: string; observedAt: string;
}, fetcher: typeof fetch = fetch) {
  const limit = input.phase === "nav" ? NAV_CHUNK_SIZE : AGENCY_QUOTA_CHUNK_SIZE;
  const sql = input.phase === "nav"
    ? "SELECT code, share_class AS shareClass, currency FROM nasdaq_funds WHERE code > ? ORDER BY code LIMIT ?"
    : "SELECT code, share_class AS shareClass, currency FROM nasdaq_funds WHERE venue='otc' AND code > ? ORDER BY code LIMIT ?";
  const statement = db.prepare(sql).bind(input.after, limit + 1) as { all<T>(): Promise<{ results: T[] }> };
  const rows = (await statement.all<AgencyQuotaFund>()).results;
  const funds = rows.slice(0, limit);
  const result = input.phase === "nav"
    ? await syncNavChunkD1(db, { codes: funds.map((fund) => fund.code), observedAt: input.observedAt }, tiantianNavSource, fetcher)
    : await syncAgencyQuotaChunkD1(db, { key: `tiantian-agency:${input.bizDate}:${input.runId}:${input.after || "start"}`, bizDate: input.bizDate, observedAt: input.observedAt, funds }, fetcher);
  return { ...result, next: rows.length > limit ? funds[funds.length - 1].code : null };
}

export async function finishCloudRefresh(db: MarketD1, input: {
  bizDate: string; observedAt: string; nav: RefreshTotals; quota: RefreshTotals;
}) {
  await updatePortfolioSnapshotD1(db, input.bizDate);
  const statements = ([("nav"), ("quota")] as const).map((phase) => {
    const totals = input[phase];
    const record = { ok: totals.failed.length === 0, partial: totals.failed.length > 0 && totals.success > 0,
      at: input.observedAt, bizDate: input.bizDate, error: totals.failed.length ? JSON.stringify(totals.failed) : undefined };
    return db.prepare(`INSERT INTO app_kv (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
      .bind(`job:tiantian_${phase}:last`, JSON.stringify(record));
  });
  const nav = input.nav;
  statements.push(db.prepare(`INSERT INTO fund_ingestion_runs (job_name,biz_date,started_at,finished_at,requested_count,success_count,failure_count,error_json,status)
    VALUES ('tiantian_nav',?,?,?,?,?,?,?,?) ON CONFLICT(job_name,biz_date) DO UPDATE SET
    started_at=excluded.started_at,finished_at=excluded.finished_at,requested_count=excluded.requested_count,
    success_count=excluded.success_count,failure_count=excluded.failure_count,error_json=excluded.error_json,status=excluded.status`)
    .bind(input.bizDate, input.observedAt, new Date().toISOString(), nav.requested, nav.success, nav.failed.length,
      nav.failed.length ? JSON.stringify(nav.failed) : null, nav.failed.length === 0 ? "succeeded" : nav.success ? "partial" : "failed"));
  await db.batch(statements);
}

export function validRefreshRun(input: Record<string, unknown>): boolean {
  if (typeof input.runId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.runId)) return false;
  if (typeof input.observedAt !== "string" || !Number.isFinite(Date.parse(input.observedAt))) return false;
  if (typeof input.bizDate !== "string" || input.bizDate !== beijingTodayISO(new Date(input.observedAt))) return false;
  // Runs cannot be fabricated for far-past or far-future dates.
  return Math.abs(Date.now() - Date.parse(input.observedAt)) <= 24 * 60 * 60 * 1000;
}
