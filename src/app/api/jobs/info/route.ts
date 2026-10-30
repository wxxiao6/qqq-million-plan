import { authorizeCloudJob } from "@/server/jobs/cloud-auth";
import { syncInfoChunkD1 } from "@/server/market/info-d1";
import { newRefreshRun, validRefreshRun } from "@/server/market/refresh-d1";

export async function POST(request: Request) {
  if (!await authorizeCloudJob(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (process.env.CLOUDFLARE_RUNTIME !== "1") return Response.json({ error: "cloud_only" }, { status: 404 });
  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "invalid_request" }, { status: 400 }); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return Response.json({ error: "invalid_request" }, { status: 400 });
  if (input.phase === "init") return Response.json(newRefreshRun());
  if (!validRefreshRun(input)) return Response.json({ error: "invalid_request" }, { status: 400 });
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const db = (getCloudflareContext().env as unknown as { DB: Parameters<typeof syncInfoChunkD1>[0] }).DB;
  if (input.phase === "chunk" && typeof input.after === "string" && /^(?:\d{6})?$/.test(input.after)) {
    return Response.json(await syncInfoChunkD1(db, { after: input.after, observedAt: input.observedAt as string }));
  }
  if (input.phase === "finish" && Number.isInteger(input.requested) && Number.isInteger(input.success) && Number.isInteger(input.failure) &&
    (input.requested as number) >= 0 && (input.requested as number) <= 10000 && (input.success as number) >= 0 && (input.failure as number) >= 0 && (input.success as number) + (input.failure as number) === input.requested) {
    const requested = input.requested as number, success = input.success as number, failure = input.failure as number;
    const status = failure === 0 ? "succeeded" : success ? "partial" : "failed";
    await db.batch([
      db.prepare(`INSERT INTO fund_ingestion_runs (job_name,biz_date,started_at,finished_at,requested_count,success_count,failure_count,error_json,status)
        VALUES ('biying_info',?,?,?,?,?,?,?,?) ON CONFLICT(job_name,biz_date) DO UPDATE SET started_at=excluded.started_at,finished_at=excluded.finished_at,
        requested_count=excluded.requested_count,success_count=excluded.success_count,failure_count=excluded.failure_count,error_json=excluded.error_json,status=excluded.status`)
        .bind(input.bizDate as string, input.observedAt as string, new Date().toISOString(), requested, success, failure, failure ? JSON.stringify({ failure }) : null, status),
      db.prepare("INSERT INTO app_kv (key,value) VALUES ('job:biying_info:last',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .bind(JSON.stringify({ ok: !failure, partial: !!failure && !!success, at: input.observedAt, bizDate: input.bizDate })),
    ]);
    return Response.json({ ok: !failure });
  }
  return Response.json({ error: "invalid_request" }, { status: 400 });
}
