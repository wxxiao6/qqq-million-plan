import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { getDb, getDbPath } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.CLOUDFLARE_RUNTIME === "1") {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = getCloudflareContext();
    const db = (env as unknown as { DB: { prepare(sql: string): { first(): Promise<{ n: number }> } } }).DB;
    const result = await db.prepare("SELECT COUNT(*) AS n FROM nasdaq_funds").first();
    return NextResponse.json({ ok: true, database: "D1", quotaUniverseRows: result?.n ?? 0 });
  }
  const db = getDb();
  const universe = db
    .prepare("SELECT COUNT(*) AS n FROM nasdaq_funds")
    .get() as { n: number };
  return NextResponse.json({
    ok: true,
    sqlite: getDbPath(),
    sqliteExists: existsSync(getDbPath()),
    quotaUniverseRows: universe.n,
  });
}
