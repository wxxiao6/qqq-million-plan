import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createDcaPlanD1 } from "./create-d1";
import type { ReconcileD1 } from "../ledger/reconcile-d1";

const tmp = mkdtempSync(path.join(os.tmpdir(), "dca-create-d1-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));

function binding(db: Database.Database, failAt = -1): ReconcileD1 {
  let calls = 0;
  return {
    prepare(sql) { return { bind(...values) { return { sql, values } as unknown as ReturnType<ReconcileD1["prepare"]>; } }; },
    async batch(statements) { const attempt = ++calls; return db.transaction(() => statements.map((item, index) => {
      if (attempt === 2 && index === failAt) throw new Error("simulated failure");
      const { sql, values } = item as unknown as { sql: string; values: (string | number | null)[] };
      const statement = db.prepare(sql);
      return { results: statement.reader ? statement.all(...values) : (statement.run(...values), []) };
    }))(); },
  };
}

describe("D1 plan creation", () => {
  it("matches SQLite backfill and manual execution, and prevents duplicate plans", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-12T04:00:00Z"));
      const { getDb } = await import("../db");
      const { upsertDcaPlan } = await import("./index");
      const db = getDb();
      for (const date of ["2026-10-08", "2026-10-09", "2026-10-12"]) db.prepare("INSERT INTO nav_snapshots (symbol,as_of,nav,source) VALUES ('019547',?,2,'real')").run(date);
      db.pragma("journal_mode = DELETE");
      const cloud = new Database(db.serialize());
      const input = { symbol: "019547", shareClass: "A", channelKind: "agency", account: "alipay", amount: 10, frequency: "daily", startDate: "2026-10-08", cutoffPeriod: "before_15" as const,
        execution: { status: "bought_after_cutoff" as const, executionDate: "2026-10-09", actualCashDebited: 20, actualFeeAmount: 1 } };
      const result = await createDcaPlanD1(binding(cloud), input, "2026-10-12");
      const expected = upsertDcaPlan(input, { importPastPending: true });
      expect(result).toEqual(expected);
      const planSql = "SELECT symbol,account,amount,invested_total,imported_through,next_debit_date,cutoff_period FROM dca_plans";
      const positionsSql = "SELECT symbol,account,cost,status,note,recorded_on,execution_on,cash_debited,fee_amount,cutoff_period,order_origin,auto_generated,shares,t_date,t_nav,confirmed_on FROM positions ORDER BY id";
      expect(cloud.prepare(planSql).all()).toEqual(db.prepare(planSql).all());
      expect(cloud.prepare(positionsSql).all()).toEqual(db.prepare(positionsSql).all());
      expect(await createDcaPlanD1(binding(cloud), input, "2026-10-12")).toMatchObject({ ok: false });
      cloud.close();
    } finally { vi.useRealTimers(); }
  });

  it("rolls back the plan if any backfill statement fails", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    const cloud = new Database(db.serialize());
    const input = { symbol: "016452", shareClass: "A", channelKind: "agency", account: "alipay", amount: 10, frequency: "daily", startDate: "2026-10-12" };
    expect(await createDcaPlanD1(binding(cloud, 3), input, "2026-10-12")).toMatchObject({ ok: false });
    expect(cloud.prepare("SELECT count(*) AS n FROM dca_plans WHERE symbol='016452'").get()).toEqual({ n: 0 });
    cloud.close();
  });

  it("does not create duplicate plans when two requests race", async () => {
    const { getDb } = await import("../db");
    const cloud = new Database(getDb().serialize());
    const input = { symbol: "016452", shareClass: "A", channelKind: "agency", account: "alipay", amount: 10, frequency: "daily", startDate: "2026-10-12" };
    const results = await Promise.all([createDcaPlanD1(binding(cloud), input, "2026-10-12"), createDcaPlanD1(binding(cloud), input, "2026-10-12")]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(cloud.prepare("SELECT count(*) AS n FROM dca_plans WHERE symbol='016452' AND account='alipay'").get()).toEqual({ n: 1 });
    expect(cloud.prepare("SELECT count(*) AS n FROM positions WHERE symbol='016452'").get()).toEqual({ n: 1 });
    cloud.close();
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
