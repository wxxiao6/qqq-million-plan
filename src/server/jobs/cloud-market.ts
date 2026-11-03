import { beijingTodayISO } from "@/lib/format";
import { navPublicationSlot } from "@/lib/job-schedule";
import type { ReconcileD1 } from "../ledger/reconcile-d1";
import { NAV_CHUNK_SIZE, syncNavChunkD1, updatePortfolioSnapshotD1 } from "../market/nav-d1";
import { syncInfoChunkD1 } from "../market/info-d1";
import { tiantianNavSource } from "../market/tiantian";

export const MARKET_JOB_PATH = "/api/internal/scheduled-market";
type Kind = "nav" | "info";
type Failure = { code: string; error: string };
type Totals = { requested: number; success: number; updated: number; unchanged: number; failed: Failure[] };
type Chunk = Totals & { next: string | null };
type SelfService = { fetch(request: Request): Promise<Response> };

/** Called through the existing machine credential, in a separate invocation
 * for each chunk so each has its own D1/subrequest budget. */
export async function runMarketChunk(db: ReconcileD1, input: { kind: Kind; after: string; observedAt: string }, fetcher: typeof fetch = fetch): Promise<Chunk> {
  if (input.kind === "info") {
    const result = await syncInfoChunkD1(db, input, fetcher);
    return { ...result, updated: result.success, unchanged: 0 };
  }
  const [catalog] = await db.batch([db.prepare(`SELECT f.code,s.nav_date AS navDate FROM nav_sync_funds f
    LEFT JOIN fund_nav_sync s ON s.code=f.code WHERE f.code>? ORDER BY f.code LIMIT ?`).bind(input.after, NAV_CHUNK_SIZE + 1)]);
  const rows = catalog.results as Array<{ code: string; navDate: string | null }>;
  const funds = rows.slice(0, NAV_CHUNK_SIZE);
  const result = await syncNavChunkD1(db, { codes: funds.map((fund) => fund.code), observedAt: input.observedAt }, tiantianNavSource, fetcher);
  let updated = 0;
  if (funds.length) {
    const [synced] = await db.batch([db.prepare(`SELECT code,nav_date AS navDate FROM fund_nav_sync WHERE code IN (${funds.map(() => "?").join(",")})`).bind(...funds.map((fund) => fund.code))]);
    const dates = new Map((synced.results as Array<{ code: string; navDate: string | null }>).map((fund) => [fund.code, fund.navDate]));
    const failed = new Set(result.failed.map((item) => item.code));
    updated = funds.filter((fund) => !failed.has(fund.code) && dates.get(fund.code) && (!fund.navDate || dates.get(fund.code)! > fund.navDate)).length;
  }
  return { ...result, updated, unchanged: result.success - updated, next: rows.length > NAV_CHUNK_SIZE ? funds.at(-1)!.code : null };
}

export async function runCloudMarket(db: ReconcileD1, service: SelfService, token: string, kind: Kind, scheduledTime: Date, now = new Date()) {
  const slot = kind === "nav" ? navPublicationSlot(scheduledTime) : beijingTodayISO(scheduledTime);
  // A delayed delivery must not start a NAV crawl outside the agreed hours.
  if (!slot || (kind === "nav" && !navPublicationSlot(now))) return { skipped: true };
  if (!/^[A-Za-z0-9_-]{43,}$/.test(token)) throw new Error("Cloud job credential is unavailable");
  const runId = crypto.randomUUID(), at = now.toISOString(), bizDate = beijingTodayISO(scheduledTime);
  const job = kind === "nav" ? "fund_nav" : "fund_info";
  const [claim] = await db.batch([db.prepare(`INSERT INTO scheduled_job_runs(job_name,slot,run_id,biz_date,status,started_at)
    VALUES (?,?,?,?,'running',?) ON CONFLICT(job_name,slot) DO UPDATE SET run_id=excluded.run_id,
    status='running',started_at=excluded.started_at,finished_at=NULL
    WHERE scheduled_job_runs.status IN ('failed','partial') OR
      (scheduled_job_runs.status='running' AND scheduled_job_runs.started_at<?)
    RETURNING run_id`).bind(job, slot, runId, bizDate, at, new Date(now.getTime() - 20 * 60_000).toISOString())]);
  if (!claim.results.length) return { skipped: true };
  const totals: Totals = { requested: 0, success: 0, updated: 0, unchanged: 0, failed: [] };
  let fatal: string | null = null;
  try {
    let after = "";
    let chunks = 0;
    do {
      if (++chunks > 30 || Date.now() - now.getTime() > 10 * 60_000) throw new Error("Market invocation budget exceeded; catalog needs further partitioning");
      if (kind === "nav" && !navPublicationSlot(new Date())) throw new Error("NAV publication window ended");
      const response = await service.fetch(new Request(`https://jobs.internal${MARKET_JOB_PATH}`, {
        method: "POST", signal: AbortSignal.timeout(180_000), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ kind, after, observedAt: at }),
      }));
      if (!response.ok) throw new Error(`Market chunk returned HTTP ${response.status}`);
      const result = await response.json() as Chunk;
      if (!Number.isInteger(result.requested) || !Number.isInteger(result.success) || !Number.isInteger(result.updated) ||
        !Number.isInteger(result.unchanged) || [result.requested,result.success,result.updated,result.unchanged].some((n) => n < 0) || !Array.isArray(result.failed) || result.success + result.failed.length !== result.requested ||
        result.updated + result.unchanged !== result.success || (result.next != null && (!/^\d{6}$/.test(result.next) || result.next <= after))) throw new Error("Invalid market chunk result");
      totals.requested += result.requested; totals.success += result.success;
      totals.updated += result.updated; totals.unchanged += result.unchanged; totals.failed.push(...result.failed);
      after = result.next ?? "";
    } while (after);
    // Snapshot uses its own invocation and must also finalize failed runs.
    if (kind === "nav") {
      const response = await service.fetch(new Request(`https://jobs.internal${MARKET_JOB_PATH}`, {
        method: "POST", signal: AbortSignal.timeout(180_000), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "snapshot", bizDate }),
      }));
      if (!response.ok) throw new Error(`Snapshot returned HTTP ${response.status}`);
    }
  } catch (error) { fatal = error instanceof Error ? error.message : "Market job failed"; }
  const status = fatal || totals.failed.length ? (totals.success ? "partial" : "failed") : "succeeded";
  await db.batch([db.prepare(`UPDATE scheduled_job_runs SET status=?,finished_at=?,requested_count=?,success_count=?,
    updated_count=?,unchanged_count=?,failure_count=?,error_json=? WHERE job_name=? AND slot=? AND run_id=?`).bind(
    status, new Date().toISOString(), totals.requested, totals.success,
    totals.updated, totals.unchanged, totals.failed.length + Number(Boolean(fatal)),
    fatal || totals.failed.length ? JSON.stringify({ error: fatal, funds: totals.failed }) : null, job, slot, runId)]);
  console.log(JSON.stringify({ job, slot, status, ...totals, error: fatal }));
  if (fatal || totals.failed.length) throw new Error(`${job} incomplete; next scheduled window will retry`);
  return totals;
}

export async function handleMarketJob(request: Request, db: ReconcileD1, token: string | undefined) {
  const supplied = request.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (request.method !== "POST" || !token || !/^[A-Za-z0-9_-]{43,}$/.test(token) || !supplied || supplied.length > 4096) return new Response(null, { status: 401 });
  const [left, right] = await Promise.all([token, supplied].map((value) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
  let difference = 0;
  const rightBytes = new Uint8Array(right);
  for (const [index, byte] of new Uint8Array(left).entries()) difference |= byte ^ rightBytes[index];
  if (difference) return new Response(null, { status: 401 });
  try {
    const input = await request.json() as Record<string, unknown>;
    if (!input || typeof input !== "object") return Response.json({ error: "invalid_request" }, { status: 400 });
    if (input.kind === "snapshot" && typeof input.bizDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.bizDate)) {
      await updatePortfolioSnapshotD1(db, input.bizDate);
      return Response.json({ ok: true });
    }
    if ((input.kind !== "nav" && input.kind !== "info") || typeof input.after !== "string" || !/^(\d{6})?$/.test(input.after) ||
      typeof input.observedAt !== "string" || !Number.isFinite(Date.parse(input.observedAt)) || Math.abs(Date.now() - Date.parse(input.observedAt)) > 24 * 60 * 60_000) return Response.json({ error: "invalid_request" }, { status: 400 });
    return Response.json(await runMarketChunk(db, { kind: input.kind, after: input.after, observedAt: input.observedAt }));
  } catch { return Response.json({ error: "market_job_failed" }, { status: 500 }); }
}
