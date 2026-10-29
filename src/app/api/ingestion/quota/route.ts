import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { authorizeQuotaToken, ingestQuotaPayload, QuotaIngestionError } from "@/server/funds/quota-ingestion";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!authorizeQuotaToken(request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? request.headers.get("X-Quota-Ingest-Token"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const key = request.headers.get("Idempotency-Key");
  if (!key) return NextResponse.json({ error: "missing_idempotency_key" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  try {
    const result = ingestQuotaPayload(getDb(), body, key);
    return NextResponse.json({ ok: true, ...result }, { status: result.reused ? 200 : 201 });
  } catch (error) {
    if (error instanceof QuotaIngestionError) return NextResponse.json({ error: error.code, message: error.message, details: error.details }, { status: error.code === "idempotency_conflict" ? 409 : 422 });
    return NextResponse.json({ error: "ingestion_failed" }, { status: 500 });
  }
}
