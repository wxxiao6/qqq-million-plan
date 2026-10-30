import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";

const tmp = mkdtempSync(path.join(os.tmpdir(), "refresh-d1-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));

function binding(db: Database.Database) {
  return {
    prepare(sql: string) { return { bind(...values: (string | number | null)[]) {
      return { sql, values, async all<T>() { return { results: db.prepare(sql).all(...values) as T[] }; } };
    } }; },
    async batch(statements: unknown[]) {
      return db.transaction(() => statements.map((item) => {
        const statement = item as { sql: string; values: (string | number | null)[] };
        return db.prepare(statement.sql).run(...statement.values);
      }))();
    },
  };
}

describe("D1 market refresh", () => {
  it("processes the complete catalog across chunks and records partial results", async () => {
    const { getDb } = await import("../db");
    const { refreshCloudChunk, finishCloudRefresh } = await import("./refresh-d1");
    const sqlite = getDb();
    const db = binding(sqlite);
    const run = { runId: "a98bc822-1234-4123-8123-123456789abc", bizDate: "2026-10-28", observedAt: "2026-10-28T14:00:00.000Z" };
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const parsed = new URL(String(url));
      if (parsed.searchParams.get("FCODE") === "016452") return new Response("failure", { status: 503 });
      return Response.json(parsed.pathname.includes("FundVPageDiagram")
        ? { data: [{ FSRQ: "2026-10-28", DWJZ: "2", JZZZL: "1" }] }
        : { Datas: { SGZT: "限大额", MAXSG: "10", MGREXP: "0.50%" } });
    });
    const totals = { nav: { requested: 0, success: 0, failed: [] as Array<{ code: string; error: string }> }, quota: { requested: 0, success: 0, failed: [] as Array<{ code: string; error: string }> } };
    let batches = 0;
    for (const phase of ["nav", "quota"] as const) {
      let after = "";
      do {
        const result = await refreshCloudChunk(db, { ...run, phase, after }, fetcher);
        expect(result.requested).toBeLessThanOrEqual(25);
        totals[phase].requested += result.requested;
        totals[phase].success += result.success;
        totals[phase].failed.push(...result.failed);
        after = result.next ?? "";
        batches++;
      } while (after);
    }
    expect(batches).toBeGreaterThan(2);
    expect(totals.nav.requested).toEqual((sqlite.prepare("SELECT count(*) n FROM nasdaq_funds").get() as { n: number }).n);
    expect(totals.quota.requested).toEqual((sqlite.prepare("SELECT count(*) n FROM nasdaq_funds WHERE venue='otc'").get() as { n: number }).n);
    expect(totals.nav.failed).toHaveLength(1);
    await finishCloudRefresh(db, { ...run, ...totals });
    expect(sqlite.prepare("SELECT status FROM fund_ingestion_runs WHERE job_name='tiantian_nav' AND biz_date=?").get(run.bizDate)).toEqual({ status: "partial" });
    expect(JSON.parse((sqlite.prepare("SELECT value FROM app_kv WHERE key='job:tiantian_quota:last'").get() as { value: string }).value)).toMatchObject({ ok: false, partial: true });
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
