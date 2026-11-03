import { authorizeQuotaToken } from "@/server/funds/quota-ingestion";
import { fundDatabase } from "@/server/funds/database";
import { recordQuotaCollection } from "@/server/jobs/quota-status";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!authorizeQuotaToken(request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? null)) return Response.json({ error: "unauthorized" }, { status: 401 });
  let input: unknown;
  try { input = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  try { return Response.json(await recordQuotaCollection(await fundDatabase(), input)); }
  catch (error) {
    if (error instanceof Error && ["invalid_request", "invalid_run_id", "unknown_run_id"].includes(error.message)) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: "collection_status_failed" }, { status: 500 });
  }
}
