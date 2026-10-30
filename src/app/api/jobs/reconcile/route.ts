import { authorizeCloudJob } from "@/server/jobs/cloud-auth";
import { reconcileDueDcaPlansD1, type ReconcileD1 } from "@/server/ledger/reconcile-d1";

export async function POST(request: Request) {
  if (!await authorizeCloudJob(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (process.env.CLOUDFLARE_RUNTIME !== "1") return Response.json({ error: "cloud_only" }, { status: 404 });
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const db = (getCloudflareContext().env as unknown as { DB: ReconcileD1 }).DB;
  const errors = await reconcileDueDcaPlansD1(db);
  return Response.json({ ok: errors.length === 0, errors }, { status: errors.length ? 500 : 200 });
}
