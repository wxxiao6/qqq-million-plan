import { beijingTodayISO } from "@/lib/format";
import { beijingClock } from "@/lib/job-schedule";
import type { ReconcileD1 } from "../ledger/reconcile-d1";

export type QuotaDailyStatus = {
  date: string; expected: number; accepted: number; receivedAt: string | null;
  state: "scheduled" | "collecting" | "collected" | "uploaded" | "partial" | "failed" | "missing";
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/** This endpoint records collection progress, never upload acceptance. */
export async function recordQuotaCollection(db: ReconcileD1, raw: unknown, now = new Date()) {
  if (!raw || typeof raw !== "object") throw new Error("invalid_request");
  const input = raw as Record<string, unknown>;
  if (typeof input.runId !== "string" || !UUID.test(input.runId)) throw new Error("invalid_run_id");
  const at = now.toISOString();
  const started = typeof input.startedAt === "string" ? new Date(input.startedAt) : now;
  if (!Number.isFinite(started.getTime()) || started.getTime() > now.getTime()+300_000 || now.getTime()-started.getTime() > 7*86400_000) throw new Error("invalid_request");
  const day = beijingTodayISO(started);
  if (input.action === "start") {
    await db.batch([db.prepare(`INSERT INTO quota_collection_runs(run_id,biz_date,started_at,expected_count,collection_status,updated_at)
      SELECT ?,?,?,COALESCE(SUM(CASE WHEN venue='exchange' THEN 1 ELSE 2 END),0),'collecting',? FROM nasdaq_funds WHERE 1
      ON CONFLICT(run_id) DO NOTHING`).bind(input.runId, day, started.toISOString(), at)]);
  } else if (input.action === "finish" && (input.status === "collected" || input.status === "failed") &&
    typeof input.collectedCount === "number" && Number.isInteger(input.collectedCount) && input.collectedCount >= 0 && input.collectedCount <= 1000) {
    const [updated] = await db.batch([db.prepare(`UPDATE quota_collection_runs SET collection_status=?,collected_count=?,finished_at=?,updated_at=?
      WHERE run_id=? RETURNING run_id`).bind(input.status, input.collectedCount, at, at, input.runId)]);
    if (!updated.results.length) throw new Error("unknown_run_id");
  } else throw new Error("invalid_request");
  return { ok: true, runId: input.runId };
}

export async function readQuotaDailyStatus(db: ReconcileD1, now = new Date()): Promise<QuotaDailyStatus> {
  const date = beijingTodayISO(now);
  const [expectedRows, runs, receipts] = await db.batch([
    db.prepare("SELECT COALESCE(SUM(CASE WHEN venue='exchange' THEN 1 ELSE 2 END),0) AS count FROM nasdaq_funds").bind(),
    db.prepare("SELECT collection_status AS status FROM quota_collection_runs WHERE biz_date=? ORDER BY started_at DESC LIMIT 1").bind(date),
    // Count distinct current-catalog channels from genuine accepted uploads.
    // A retry or a late upload from yesterday cannot satisfy today's receipt.
    db.prepare(`WITH observations AS (
      SELECT idempotency_key,code,share_class,channel_kind FROM quota_observations
      UNION SELECT idempotency_key,code,share_class,'exchange' FROM quota_exchange_observations
    ), accepted AS (
      SELECT DISTINCT o.code,o.share_class,o.channel_kind FROM observations o
      JOIN quota_ingestion_runs r USING(idempotency_key)
      JOIN quota_collection_runs c ON c.run_id=r.collection_run_id
      JOIN nasdaq_funds f ON f.code=o.code AND f.share_class=o.share_class
      WHERE c.biz_date=? AND r.status='accepted' AND date(r.observed_at,'+8 hours')=c.biz_date
        AND ((f.venue='exchange' AND o.channel_kind='exchange') OR (f.venue='otc' AND o.channel_kind IN ('direct','agency')))
    ) SELECT (SELECT COUNT(*) FROM accepted) AS count,
      (SELECT MAX(created_at) FROM quota_ingestion_runs WHERE status='accepted') AS receivedAt`).bind(date),
  ]);
  const expected = Number((expectedRows.results[0] as { count: number }).count);
  const receipt = receipts.results[0] as { count: number; receivedAt: string | null };
  const run = runs.results[0] as { status: string } | undefined;
  const hour = beijingClock(now).hour;
  const state = receipt.count >= expected && expected > 0 ? "uploaded" : receipt.count > 0 ? "partial" :
    run?.status === "failed" ? "failed" : run?.status === "collected" ? "collected" :
    run?.status === "collecting" && hour < 7 ? "collecting" : hour >= 7 ? "missing" : "scheduled";
  return { date, expected, accepted: receipt.count, receivedAt: receipt.receivedAt, state };
}

/** Receipt-only audit. No collector, NAV fetch or quota update is invoked here. */
export async function checkQuotaReceipt(db: ReconcileD1, scheduledTime: Date) {
  const status = await readQuotaDailyStatus(db, scheduledTime);
  await db.batch([db.prepare(`INSERT INTO scheduled_job_runs(job_name,slot,run_id,biz_date,status,started_at,finished_at,
    requested_count,success_count,failure_count) VALUES('quota_receipt',?,?,?, ?,?,?, ?,?,?)
    ON CONFLICT(job_name,slot) DO UPDATE SET status=excluded.status,finished_at=excluded.finished_at,
    requested_count=excluded.requested_count,success_count=excluded.success_count,failure_count=excluded.failure_count`)
    .bind(status.date, crypto.randomUUID(), status.date, status.state === "uploaded" ? "succeeded" : status.accepted ? "partial" : "failed",
      scheduledTime.toISOString(), new Date().toISOString(), status.expected, status.accepted, Math.max(0,status.expected-status.accepted))]);
  console.log(JSON.stringify({ job: "quota_receipt", ...status }));
  return status;
}
