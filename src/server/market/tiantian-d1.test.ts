import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MarketD1 } from "./tiantian-d1";
import type Database from "better-sqlite3";

const tmp = mkdtempSync(path.join(os.tmpdir(), "tiantian-d1-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));
let saveAgencyQuotaD1: typeof import("./tiantian-d1").saveAgencyQuotaD1;
let syncAgencyQuotaChunkD1: typeof import("./tiantian-d1").syncAgencyQuotaChunkD1;
beforeAll(async () => { ({ saveAgencyQuotaD1, syncAgencyQuotaChunkD1 } = await import("./tiantian-d1")); });

function binding(db: Database.Database, failAt = -1): MarketD1 {
  return {
    prepare(sql) { return { bind(...values) { return { sql, values }; } }; },
    async batch(statements) {
      return db.transaction(() => statements.map((item, index) => {
        if (index === failAt) throw new Error("simulated batch failure");
        const statement = item as { sql: string; values: (string | number | null)[] };
        return db.prepare(statement.sql).run(...statement.values);
      }))();
    },
  };
}

const update = {
  fund: { code: "016452", shareClass: "A", currency: "CNY" as const },
  quota: { code: "016452", status: "limited" as const, dailyLimit: 10, purchaseFeePct: 0.12,
    purchaseFeeJson: null, managementFeePct: 0.5, managementFeeRaw: "0.50%", managementFeeStatus: "valid" as const,
    sourceUrl: "https://example.com/rate", rawStatus: "限大额" },
};

describe("D1 agency quota batch", () => {
  it("updates agency data and fee date, preserves direct data, and supports retries", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    db.prepare("INSERT INTO nav_snapshots (symbol,as_of,nav,source) VALUES ('016452','2026-10-27',10,'auto')").run();
    db.prepare(`INSERT INTO quota_current
      (code,share_class,channel_kind,status,daily_limit,currency,quota_scope,effective_on,observed_at,source_url,source_provider,updated_at)
      VALUES ('016452','A','direct','limited',123,'CNY','test','2026-10-28','2026-10-28','https://example.com','bot','2026-10-28')`).run();
    const input = { key: "tiantian-test:chunk-1", bizDate: "2026-10-28", observedAt: "2026-10-28T14:00:00Z", requested: 1, updates: [update] };
    await saveAgencyQuotaD1(binding(db), input);
    await saveAgencyQuotaD1(binding(db), input);
    expect(db.prepare("SELECT count(*) AS n FROM quota_observations WHERE idempotency_key=?").get(input.key)).toEqual({ n: 1 });
    expect(db.prepare("SELECT daily_limit,source_provider,purchase_fee_pct FROM quota_current WHERE code='016452' AND channel_kind='agency'").get()).toEqual({ daily_limit: 10, source_provider: "tiantian-fund", purchase_fee_pct: 0.12 });
    expect(db.prepare("SELECT daily_limit,source_provider FROM quota_current WHERE code='016452' AND channel_kind='direct'").get()).toEqual({ daily_limit: 123, source_provider: "bot" });
    expect(db.prepare("SELECT annual_rate_pct FROM fund_management_fee_rates WHERE code='016452' AND effective_on='2026-10-27'").get()).toEqual({ annual_rate_pct: 0.5 });
  });

  it("rolls back the run and all observations when any statement fails", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    const key = "tiantian-test:failed";
    await expect(saveAgencyQuotaD1(binding(db, 2), { key, bizDate: "2026-10-28", observedAt: "2026-10-28T14:00:00Z", requested: 1, updates: [update] })).rejects.toThrow("simulated batch failure");
    expect(db.prepare("SELECT * FROM quota_ingestion_runs WHERE idempotency_key=?").get(key)).toBeUndefined();
    expect(db.prepare("SELECT count(*) AS n FROM quota_observations WHERE idempotency_key=?").get(key)).toEqual({ n: 0 });
  });

  it("fetches a bounded chunk and records partial failures", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const code = new URL(String(input)).searchParams.get("FCODE");
      if (code === "021000") return new Response("error", { status: 503 });
      return Response.json({ Datas: { SGZT: "限大额", MAXSG: "10", MGREXP: "0.50%" } });
    });
    const result = await syncAgencyQuotaChunkD1(binding(db), {
      key: "tiantian-test:partial", bizDate: "2026-10-28", observedAt: "2026-10-28T14:00:00Z",
      funds: [update.fund, { code: "021000", shareClass: "A", currency: "CNY" }],
    }, fetcher);
    expect(result).toMatchObject({ requested: 2, success: 1, failed: [{ code: "021000" }] });
    expect(db.prepare("SELECT accepted_count FROM quota_ingestion_runs WHERE idempotency_key=?").get("tiantian-test:partial")).toEqual({ accepted_count: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects oversized chunks before making any requests", async () => {
    const { getDb } = await import("../db");
    const fetcher = vi.fn<typeof fetch>();
    const funds = Array.from({ length: 26 }, (_, index) => ({ ...update.fund, code: String(index).padStart(6, "0") }));
    await expect(syncAgencyQuotaChunkD1(binding(getDb()), { key: "too-large", bizDate: "2026-10-28", observedAt: "2026-10-28T14:00:00Z", funds }, fetcher)).rejects.toThrow("Too many funds");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
