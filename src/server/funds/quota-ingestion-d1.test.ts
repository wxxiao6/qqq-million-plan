import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { QuotaD1 } from "./quota-ingestion-d1";

const tmp = mkdtempSync(path.join(os.tmpdir(), "quota-d1-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));
vi.stubEnv("QUOTA_SOURCE_HOSTS", "fund.eastmoney.com");
let ingestQuotaPayloadD1: typeof import("./quota-ingestion-d1").ingestQuotaPayloadD1;
beforeAll(async () => { ({ ingestQuotaPayloadD1 } = await import("./quota-ingestion-d1")); });

// Model D1's transactional batch using an isolated SQLite database. The local
// Workers test separately exercises the Cloudflare binding itself.
function binding(sqlite: Database.Database, failAt = -1): QuotaD1 {
  type Statement = { sql: string; args: unknown[]; all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null> };
  return {
    prepare(sql) {
      return { bind(...args) {
        return {
          sql, args,
          async all<T>() { return { results: sqlite.prepare(sql).all(...args) as T[] }; },
          async first<T>() { return (sqlite.prepare(sql).get(...args) as T | undefined) ?? null; },
        };
      } };
    },
    async batch(statements) {
      return sqlite.transaction(() => statements.map((statement, index) => {
        if (index === failAt) throw new Error("simulated failure");
        const { sql, args } = statement as Statement;
        return sqlite.prepare(sql).run(...args);
      }))();
    },
  };
}

const payload = {
  schemaVersion: 1, observedAt: "2026-10-28T02:00:00.000Z", sourceProvider: "test",
  items: [{ fundCode: "016452", shareClass: "A", channel: "direct", status: "limited", dailyLimit: 123,
    currency: "CNY", effectiveOn: "2026-10-28", sourceUrl: "https://fund.eastmoney.com/016452.html" }],
};

describe("D1 quota ingestion", () => {
  it("writes history and current values, then handles retries and conflicts", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    const d1 = binding(db);
    expect(await ingestQuotaPayloadD1(d1, payload, "d1-run")).toMatchObject({ reused: false, accepted: 1 });
    expect(await ingestQuotaPayloadD1(d1, payload, "d1-run")).toMatchObject({ reused: true, accepted: 1 });
    await expect(ingestQuotaPayloadD1(d1, { ...payload, sourceProvider: "other" }, "d1-run")).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(db.prepare("SELECT count(*) AS n FROM quota_observations WHERE idempotency_key=?").get("d1-run")).toEqual({ n: 1 });
    expect(db.prepare("SELECT daily_limit FROM quota_current WHERE code=? AND channel_kind='direct'").get("016452")).toEqual({ daily_limit: 123 });
  });

  it("records validation failure without writing observations", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    await expect(ingestQuotaPayloadD1(binding(db), { ...payload, items: [{ ...payload.items[0], fundCode: "999999" }] }, "d1-invalid")).rejects.toMatchObject({ code: "validation_failed" });
    expect(db.prepare("SELECT status FROM quota_ingestion_runs WHERE idempotency_key=?").get("d1-invalid")).toEqual({ status: "rejected" });
    expect(db.prepare("SELECT count(*) AS n FROM quota_observations WHERE idempotency_key=?").get("d1-invalid")).toEqual({ n: 0 });
  });

  it("rolls back all writes if a statement in the batch fails", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    await expect(ingestQuotaPayloadD1(binding(db, 2), payload, "d1-failed")).rejects.toThrow("simulated failure");
    expect(db.prepare("SELECT * FROM quota_ingestion_runs WHERE idempotency_key=?").get("d1-failed")).toBeUndefined();
    expect(db.prepare("SELECT count(*) AS n FROM quota_observations WHERE idempotency_key=?").get("d1-failed")).toEqual({ n: 0 });
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
