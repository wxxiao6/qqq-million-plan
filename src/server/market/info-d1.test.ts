import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
const tmp = mkdtempSync(path.join(os.tmpdir(), "info-d1-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));
vi.stubEnv("BIYING_LICENCE", "sensitive-test-license");
function binding(db: Database.Database) {
  return { prepare(sql: string) { return { bind(...values: (string | number | null)[]) {
    return { sql, values, async all<T>() { return { results: db.prepare(sql).all(...values) as T[] }; } };
  } }; }, async batch(statements: unknown[]) { return db.transaction(() => statements.map((item) => {
    const stmt = item as { sql: string; values: (string | number | null)[] }; return db.prepare(stmt.sql).run(...stmt.values);
  }))(); } };
}
it("batches weekly fund info, handles failure, protects credentials, and retries idempotently", async () => {
  const { getDb } = await import("../db");
  const { syncInfoChunkD1 } = await import("./info-d1");
  const sqlite = getDb(), db = binding(sqlite), at = "2026-10-26T01:00:00.000Z";
  const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).includes("016452")
    ? new Response("failure", { status: 503 }) : Response.json({ data: [{ qc: "完整名称", jc: "名称", lx: "基金", glr: "管理人" }] }));
  let after = "", requested = 0, success = 0, failures = 0;
  do {
    const input = { after, observedAt: at };
    const result = await syncInfoChunkD1(db, input, fetcher);
    expect(result.requested).toBeLessThanOrEqual(25);
    expect(await syncInfoChunkD1(db, input, fetcher)).toEqual(result);
    requested += result.requested; success += result.success; failures += result.failed.length; after = result.next ?? "";
  } while (after);
  expect(requested).toBeGreaterThan(25);
  expect(failures).toBe(1);
  expect((sqlite.prepare("SELECT count(*) AS n FROM fund_info_snapshots").get() as { n: number }).n).toBe(success);
  expect((sqlite.prepare("SELECT count(*) AS n FROM fund_info_snapshots WHERE source_url LIKE '%sensitive-test-license%'").get() as { n: number }).n).toBe(0);
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
