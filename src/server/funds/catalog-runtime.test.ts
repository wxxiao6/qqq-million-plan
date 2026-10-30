import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const tmp = mkdtempSync(path.join(os.tmpdir(), "catalog-d1-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));

describe("D1 catalog", () => {
  it("matches the local SQLite catalog, including seller and quota projections", async () => {
    // Load DB-dependent modules only after setting the isolated database path.
    const { getDb } = await import("../db");
    const { listNasdaqFunds } = await import("./catalog");
    const { listNasdaqFundsD1 } = await import("./catalog-runtime");
    const db = getDb();
    db.prepare(`INSERT INTO quota_current (code, share_class, channel_kind, status, daily_limit, currency, quota_scope, effective_on, observed_at, source_url, source_provider, updated_at)
      VALUES ('016452','A','direct','limited',123,'CNY','test','2026-10-29','2026-10-29T00:00:00Z','https://example.com','test','2026-10-29T00:00:00Z')
      ON CONFLICT(code,share_class,channel_kind) DO UPDATE SET status=excluded.status, daily_limit=excluded.daily_limit`).run();
    const d1 = {
      prepare(sql: string) { return sql; },
      async batch(statements: unknown[]) {
        return db.transaction(() => statements.map((sql) => ({ results: db.prepare(sql as string).all() })))();
      },
    };
    const expected = listNasdaqFunds(db);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.find((fund) => fund.code === "016452")?.directDailyLimit).toBe(123);
    expect(await listNasdaqFundsD1(d1)).toEqual(expected);
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
