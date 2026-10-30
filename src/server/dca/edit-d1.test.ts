import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ReconcileD1 } from "../ledger/reconcile-d1";

const tmp = mkdtempSync(path.join(os.tmpdir(), "dca-edit-d1-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));

function binding(db: Database.Database, beforeWrite?: () => void): ReconcileD1 {
  let calls = 0;
  return {
    prepare(sql) { return { bind(...values) { return { sql, values } as unknown as ReturnType<ReconcileD1["prepare"]>; } }; },
    async batch(statements) { if (++calls === 3) beforeWrite?.(); return db.transaction(() => statements.map((item) => {
      const { sql, values } = item as unknown as { sql: string; values: (string | number | null)[] };
      const stmt = db.prepare(sql);
      return { results: stmt.reader ? stmt.all(...values) : (stmt.run(...values), []) };
    }))(); },
  };
}

describe("D1 plan editing", () => {
  it("matches SQLite when changing account with settled history and overdue records", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-14T04:00:00Z"));
      const { getDb } = await import("../db");
      const { upsertDcaPlan } = await import("./index");
      const { createPendingSubscription, resolvePendingSubscription } = await import("../ledger/pending");
      const { editDcaPlanD1 } = await import("./edit-d1");
      const db = getDb();
      const input = { symbol: "019547", shareClass: "A", channelKind: "agency", account: "alipay", amount: 10, frequency: "daily", startDate: "2026-10-12" };
      const plan = upsertDcaPlan(input); if (!plan.ok) throw new Error(plan.error);
      const record = createPendingSubscription({ symbol: input.symbol, account: "alipay", dcaPlanId: plan.id, executionOn: "2026-10-12", cutoffPeriod: "before_15", cashDebited: 10, feeAmount: 0 });
      if (!record.ok) throw new Error(record.error);
      expect(resolvePendingSubscription({ id: record.id, outcome: "settled", shares: 5, tDate: "2026-10-12", confirmedOn: "2026-10-13" }).ok).toBe(true);
      db.prepare(`INSERT INTO positions (account,exposure,symbol,shares,cost,status,note,recorded_on,execution_on,updated_at,dca_plan_id,cash_debited,fee_amount,cutoff_period,order_origin,auto_generated,t_date,t_nav)
        VALUES ('alipay','nasdaq','019547',5,10,'pending','old','2026-10-09','2026-10-09','2026-10-09',?,10,0,'before_15','dca',1,'2026-10-08',2)`).run(plan.id);
      db.prepare("UPDATE dca_plans SET invested_total=invested_total+10 WHERE id=?").run(plan.id);
      for (const date of ["2026-10-12", "2026-10-13", "2026-10-14"]) {
        db.prepare("INSERT INTO nav_snapshots (symbol,as_of,nav,source) VALUES ('019547',?,2,'real')").run(date);
      }
      db.pragma("journal_mode = DELETE");
      const cloud = new Database(db.serialize());
      const edit = { ...input, id: plan.id, account: "jd", amount: 20 };
      expect(await editDcaPlanD1(binding(cloud), edit, "2026-10-14")).toEqual(upsertDcaPlan(edit, { importPastPending: false }));
      const planSql = "SELECT symbol,account,amount,invested_total,imported_through,next_debit_date,status FROM dca_plans WHERE id=?";
      const positionSql = "SELECT account,symbol,shares,cost,status,note,recorded_on,execution_on,dca_plan_id,cash_debited,fee_amount,cutoff_period,auto_generated,t_date,t_nav,confirmed_on FROM positions ORDER BY id";
      expect(cloud.prepare(planSql).get(plan.id)).toEqual(db.prepare(planSql).get(plan.id));
      expect(cloud.prepare(positionSql).all()).toEqual(db.prepare(positionSql).all());
      cloud.close();
    } finally { vi.useRealTimers(); }
  });

  it("rolls back old-term reconciliation if editing the fund is disallowed", async () => {
    const { getDb } = await import("../db");
    const { upsertDcaPlan } = await import("./index");
    const { editDcaPlanD1 } = await import("./edit-d1");
    const db = getDb();
    const input = { symbol: "016452", shareClass: "A", channelKind: "agency", account: "alipay", amount: 10, frequency: "daily", startDate: "2026-10-12" };
    const plan = upsertDcaPlan(input); if (!plan.ok) throw new Error(plan.error);
    const cloud = new Database(db.serialize());
    const result = await editDcaPlanD1(binding(cloud), { ...input, id: plan.id, symbol: "019547" }, "2026-10-14");
    expect(result.ok).toBe(false);
    expect(cloud.prepare("SELECT count(*) AS n FROM positions WHERE dca_plan_id=?").get(plan.id)).toEqual({ n: 0 });
    expect(cloud.prepare("SELECT symbol FROM dca_plans WHERE id=?").get(plan.id)).toEqual({ symbol: "016452" });
    cloud.close();
  });

  it("rejects an edit when the plan changes concurrently", async () => {
    const { getDb } = await import("../db");
    const { upsertDcaPlan } = await import("./index");
    const { editDcaPlanD1 } = await import("./edit-d1");
    const db = getDb();
    const input = { symbol: "021778", shareClass: "F", channelKind: "direct", account: "gf_direct", amount: 10, frequency: "daily", startDate: "2099-01-01" };
    const plan = upsertDcaPlan(input); if (!plan.ok) throw new Error(plan.error);
    const cloud = new Database(db.serialize());
    const d1 = binding(cloud, () => cloud.prepare("UPDATE dca_plans SET amount=30 WHERE id=?").run(plan.id));
    expect(await editDcaPlanD1(d1, { ...input, id: plan.id, amount: 20 }, "2026-10-14")).toMatchObject({ ok: false });
    expect(cloud.prepare("SELECT amount FROM dca_plans WHERE id=?").get(plan.id)).toEqual({ amount: 30 });
    cloud.close();
  });

  it("includes a manual execution in the edit transaction", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-14T04:00:00Z"));
      const { getDb } = await import("../db");
      const { upsertDcaPlan } = await import("./index");
      const { editDcaPlanD1 } = await import("./edit-d1");
      const db = getDb();
      const input = { symbol: "016452", shareClass: "A", channelKind: "agency", account: "jd", amount: 10, frequency: "daily", startDate: "2099-01-01" };
      const plan = upsertDcaPlan(input); if (!plan.ok) throw new Error(plan.error);
      const cloud = new Database(db.serialize());
      const edit = { ...input, id: plan.id, execution: { status: "bought_before_cutoff" as const, executionDate: "2026-10-14", actualCashDebited: 15, actualFeeAmount: 1 } };
      expect(await editDcaPlanD1(binding(cloud), edit, "2026-10-14")).toEqual(upsertDcaPlan(edit, { importPastPending: false }));
      const sql = "SELECT account,cost,cash_debited,fee_amount,status,execution_on,cutoff_period,note FROM positions WHERE dca_plan_id=?";
      expect(cloud.prepare(sql).all(plan.id)).toEqual(db.prepare(sql).all(plan.id));
      expect(cloud.prepare("SELECT invested_total,next_debit_date FROM dca_plans WHERE id=?").get(plan.id)).toEqual(db.prepare("SELECT invested_total,next_debit_date FROM dca_plans WHERE id=?").get(plan.id));
      cloud.close();
    } finally { vi.useRealTimers(); }
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
