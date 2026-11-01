import { NextResponse } from "next/server";
import { endSession } from "@/server/auth/session";
import { getAuthDatabase } from "@/server/auth/store";

export const runtime = "nodejs";

export async function POST() {
  await endSession(await getAuthDatabase());
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
