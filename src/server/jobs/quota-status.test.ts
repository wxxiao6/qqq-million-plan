import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { recordQuotaCollection, readQuotaDailyStatus, checkQuotaReceipt } from "./quota-status";
import { localFundDatabase } from "../funds/database";
import { ingestQuotaPayload } from "../funds/quota-ingestion";
const dir = mkdtempSync(path.join(os.tmpdir(), "quota-status-"));
vi.stubEnv("P0_TEST_DB", path.join(dir, "test.sqlite"));
vi.stubEnv("QUOTA_SOURCE_HOSTS", "pdf.dfcfw.com");
afterAll(() => rmSync(dir, { recursive: true, force: true }));
it("separates collection, partial and complete real receipts; retries never inflate coverage", async () => {
  const { getDb } = await import("../db"); const sqlite = getDb(), db = localFundDatabase(sqlite);
  const now = new Date("2026-11-03T22:00:00Z"), runId = crypto.randomUUID(); // Nov 4, 06:00
  expect((await readQuotaDailyStatus(db, now)).state).toBe("scheduled");
  await recordQuotaCollection(db, { action: "start", runId }, now);
  expect((await readQuotaDailyStatus(db, now)).state).toBe("collecting");
  await recordQuotaCollection(db, { action: "finish", runId, status: "collected", collectedCount: 999 }, now);
  expect((await readQuotaDailyStatus(db, now)).state).toBe("collected");
  const funds = sqlite.prepare("SELECT code,share_class AS shareClass,currency,venue FROM nasdaq_funds").all() as Array<{ code: string; shareClass: string; currency: string; venue: string }>;
  const items = funds.flatMap((f) => (f.venue === "exchange" ? ["exchange"] : ["direct", "agency"]).map((channel) => ({ fundCode: f.code, shareClass: f.shareClass, currency: f.currency, channel, status: "limited", dailyLimit: 10, effectiveOn: "2026-11-04", sourceUrl: "https://pdf.dfcfw.com/evidence.pdf" })));
  const partial = { schemaVersion: 1, sourceProvider: "test", observedAt: now.toISOString(), collectionRunId: runId, items: items.slice(0,1) };
  ingestQuotaPayload(sqlite, partial, "partial", now);
  ingestQuotaPayload(sqlite, partial, "partial", now);
  expect(await readQuotaDailyStatus(db, now)).toMatchObject({ state: "partial", accepted: 1 });
  const before = sqlite.prepare("SELECT * FROM quota_current ORDER BY code,channel_kind").all();
  expect((await checkQuotaReceipt(db, new Date("2026-11-03T23:00:00Z"))).state).toBe("partial");
  expect(sqlite.prepare("SELECT * FROM quota_current ORDER BY code,channel_kind").all()).toEqual(before);
  ingestQuotaPayload(sqlite, { ...partial, items }, "complete", now);
  expect(await readQuotaDailyStatus(db, now)).toMatchObject({ state: "uploaded", accepted: items.length, expected: items.length });
  expect(await readQuotaDailyStatus(db, new Date("2026-11-04T23:00:00Z"))).toMatchObject({ state: "missing", accepted: 0 });
  // Late old evidence is retained as history, and cannot overwrite fresh values.
  ingestQuotaPayload(sqlite, { ...partial, observedAt: "2026-11-02T22:00:00Z", items: [{ ...items[0], dailyLimit: 99 }] }, "old-late", now);
  const table = items[0].channel === "exchange" ? "quota_exchange_current" : "quota_current";
  expect(sqlite.prepare(`SELECT daily_limit FROM ${table} WHERE code=?`).get(items[0].fundCode)).toEqual({ daily_limit: 10 });
  await expect(recordQuotaCollection(db, { action: "start", runId: "bad" }, now)).rejects.toThrow("invalid_run_id");
});
