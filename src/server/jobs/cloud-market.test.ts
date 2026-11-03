import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { localFundDatabase } from "../funds/database";
import { runCloudMarket, handleMarketJob } from "./cloud-market";
const dir = mkdtempSync(path.join(os.tmpdir(), "cloud-market-"));
vi.stubEnv("P0_TEST_DB", path.join(dir, "test.sqlite"));
const at = new Date("2026-11-03T10:00:00Z"), token = "x".repeat(43);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(at); });
afterEach(() => vi.useRealTimers());
afterAll(() => rmSync(dir, { recursive: true, force: true }));
async function fixture() {
  const { getDb } = await import("../db");
  const sqlite = getDb(); sqlite.exec("DELETE FROM scheduled_job_runs");
  return { sqlite, db: localFundDatabase(sqlite) };
}
const chunk = { requested: 4, success: 4, updated: 1, unchanged: 3, failed: [], next: null };
it("chunks through the binding, saves counts and skips repeated successful slots", async () => {
  const { db, sqlite } = await fixture();
  const service = { fetch: vi.fn(async (request: Request) => {
    const input = await request.json() as { kind: string; after: string };
    expect(request.headers.get("Authorization")).toBe(`Bearer ${token}`);
    return Response.json(input.kind === "snapshot" ? { ok: true } : { ...chunk, next: input.after ? null : "016452" });
  }) };
  await runCloudMarket(db, service, token, "nav", at);
  expect(service.fetch).toHaveBeenCalledTimes(3);
  expect(sqlite.prepare("SELECT status,success_count,updated_count,unchanged_count FROM scheduled_job_runs").get()).toEqual({ status: "succeeded", success_count: 8, updated_count: 2, unchanged_count: 6 });
  expect(await runCloudMarket(db, service, token, "nav", at)).toEqual({ skipped: true });
  expect(service.fetch).toHaveBeenCalledTimes(3);
});
it("finalizes snapshot network failures and allows retrying partial slots", async () => {
  const { db, sqlite } = await fixture();
  const service = { fetch: vi.fn(async (request: Request) => {
    if ((await request.json() as { kind: string }).kind === "snapshot") throw new Error("offline");
    return Response.json(chunk);
  }) };
  await expect(runCloudMarket(db, service, token, "nav", at)).rejects.toThrow("incomplete");
  expect(sqlite.prepare("SELECT status,failure_count FROM scheduled_job_runs").get()).toEqual({ status: "partial", failure_count: 1 });
  service.fetch.mockImplementation(async () => Response.json(chunk));
  await runCloudMarket(db, service, token, "nav", at);
});
it("does not fetch NAV outside the evening window, including delayed delivery", async () => {
  const { db, sqlite } = await fixture(); const service = { fetch: vi.fn() };
  const morning = new Date("2026-11-03T23:00:00Z");
  expect(await runCloudMarket(db, service, token, "nav", morning)).toEqual({ skipped: true });
  expect(await runCloudMarket(db, service, token, "nav", at, morning)).toEqual({ skipped: true });
  expect(service.fetch).not.toHaveBeenCalled();
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM scheduled_job_runs").get()).toEqual({ count: 0 });
});
it("rejects backwards cursors and unauthorized internal calls", async () => {
  const { db } = await fixture();
  const service = { fetch: vi.fn(async () => Response.json({ ...chunk, next: "016452" })) };
  await expect(runCloudMarket(db, service, token, "nav", at)).rejects.toThrow("incomplete");
  const request = new Request("https://example.com/api/internal/scheduled-market", { method: "POST", headers: { Authorization: `Bearer ${"y".repeat(43)}` }, body: "{}" });
  expect((await handleMarketJob(request, db, token)).status).toBe(401);
  const invalid = new Request(request.url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: "null" });
  expect((await handleMarketJob(invalid, db, token)).status).toBe(400);
});
