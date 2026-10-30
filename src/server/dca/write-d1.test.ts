import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it, vi } from "vitest";
import { correctDcaExecutionD1, recordPlanExecutionD1, removeDcaPlanD1 } from "./write-d1";
import type { ReconcileD1 } from "../ledger/reconcile-d1";

const tmp = mkdtempSync(path.join(os.tmpdir(), "dca-write-d1-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));

function binding(db: Database.Database, beforeWrite?: () => void): ReconcileD1 {
  let calls = 0;
  return {
    prepare(sql) { return { bind(...values) { return { sql, values } as unknown as ReturnType<ReconcileD1["prepare"]>; } }; },
    async batch(statements) {
      if (++calls === 2) beforeWrite?.();
      return db.transaction(() => statements.map((item) => {
        const { sql, values } = item as unknown as { sql: string; values: (string | number | null)[] };
        const statement = db.prepare(sql);
        return { results: statement.reader ? statement.all(...values) : (statement.run(...values), []) };
      }))();
    },
  };
}

describe("D1 DCA writes", () => {
  it("corrects an execution and plan total identically to SQLite", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    const { upsertDcaPlan, correctDcaExecution } = await import("./index");
    const { createPendingSubscription } = await import("../ledger/pending");
    const plan = upsertDcaPlan({ symbol: "019547", shareClass: "A", channelKind: "agency", account: "alipay", amount: 10, frequency: "daily", startDate: "2026-10-08" });
    if (!plan.ok) throw new Error(plan.error);
    const record = createPendingSubscription({ symbol: "019547", account: "alipay", dcaPlanId: plan.id, executionOn: "2026-10-08", cutoffPeriod: "before_15", cashDebited: 10, feeAmount: 0 });
    if (!record.ok) throw new Error(record.error);
    db.pragma("journal_mode = DELETE");
    const cloud = new Database(db.serialize());
    const input = { id: record.id, cashDebited: 25, feeAmount: 1, outcome: "keep" as const };
    expect(await correctDcaExecutionD1(binding(cloud), input)).toEqual(correctDcaExecution(input));
    const position = "SELECT cost,cash_debited,fee_amount,shares,status,closed_on FROM positions WHERE id=?";
    expect(cloud.prepare(position).get(record.id)).toEqual(db.prepare(position).get(record.id));
    expect(cloud.prepare("SELECT invested_total FROM dca_plans WHERE id=?").get(plan.id)).toEqual(db.prepare("SELECT invested_total FROM dca_plans WHERE id=?").get(plan.id));
    expect(await correctDcaExecutionD1(binding(cloud), { ...input, outcome: "cancelled" })).toMatchObject({ ok: true });
    expect(cloud.prepare("SELECT invested_total FROM dca_plans WHERE id=?").get(plan.id)).toEqual({ invested_total: 0 });
    expect(await correctDcaExecutionD1(binding(cloud), input)).toMatchObject({ ok: false });
    cloud.close();
  });

  it("rejects stale edits and refuses deletion of plans with history", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    const { upsertDcaPlan } = await import("./index");
    const { createPendingSubscription } = await import("../ledger/pending");
    const plan = upsertDcaPlan({ symbol: "016452", shareClass: "A", channelKind: "agency", account: "alipay", amount: 10, frequency: "daily", startDate: "2026-10-08" });
    if (!plan.ok) throw new Error(plan.error);
    const record = createPendingSubscription({ symbol: "016452", account: "alipay", dcaPlanId: plan.id, executionOn: "2026-10-08", cutoffPeriod: "before_15", cashDebited: 10, feeAmount: 0 });
    if (!record.ok) throw new Error(record.error);
    const cloud = new Database(db.serialize());
    const d1 = binding(cloud, () => cloud.prepare("UPDATE positions SET cost=8 WHERE id=?").run(record.id));
    expect(await correctDcaExecutionD1(d1, { id: record.id, cashDebited: 20, feeAmount: 0, outcome: "keep" })).toMatchObject({ ok: false });
    expect(cloud.prepare("SELECT cost FROM positions WHERE id=?").get(record.id)).toEqual({ cost: 8 });
    expect(await removeDcaPlanD1(binding(cloud), plan.id)).toMatchObject({ ok: false });
    const empty = upsertDcaPlan({ symbol: "021778", shareClass: "F", channelKind: "direct", account: "gf_direct", amount: 10, frequency: "daily", startDate: "2026-10-08" });
    if (!empty.ok) throw new Error(empty.error);
    // A fresh isolated copy contains the new empty plan.
    const another = new Database(db.serialize());
    expect(await removeDcaPlanD1(binding(another), empty.id)).toEqual({ ok: true, id: empty.id });
    expect(await removeDcaPlanD1(binding(another), empty.id)).toMatchObject({ ok: false });
    cloud.close(); another.close();
  });

  it("records a debit with SQLite parity and refuses duplicate concurrent writes", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    const { upsertDcaPlan, recordPlanExecution } = await import("./index");
    const plan = upsertDcaPlan({ symbol: "019547", shareClass: "A", channelKind: "direct", account: "gf_direct", amount: 100, feeKind: "fixed", feeValue: 1, frequency: "daily", startDate: "2026-10-08" });
    if (!plan.ok) throw new Error(plan.error);
    const cloud = new Database(db.serialize());
    const execution = { status: "bought_after_cutoff" as const, executionDate: "2026-10-08", actualCashDebited: 25, actualFeeAmount: 0.5 };
    const result = await recordPlanExecutionD1(binding(cloud), plan.id, execution);
    expect(result).toEqual(recordPlanExecution(plan.id, execution));
    const position = "SELECT symbol,account,cost,cash_debited,fee_amount,execution_on,cutoff_period,note,status FROM positions WHERE dca_plan_id=?";
    expect(cloud.prepare(position).all(plan.id)).toEqual(db.prepare(position).all(plan.id));
    expect(cloud.prepare("SELECT invested_total,next_debit_date FROM dca_plans WHERE id=?").get(plan.id)).toEqual(db.prepare("SELECT invested_total,next_debit_date FROM dca_plans WHERE id=?").get(plan.id));
    const next = { ...execution, executionDate: "2026-10-09" };
    const results = await Promise.all([recordPlanExecutionD1(binding(cloud), plan.id, next), recordPlanExecutionD1(binding(cloud), plan.id, next)]);
    expect(results.filter((item) => item.ok)).toHaveLength(1);
    expect(cloud.prepare("SELECT count(*) AS n FROM positions WHERE dca_plan_id=? AND execution_on='2026-10-09'").get(plan.id)).toEqual({ n: 1 });
    cloud.close();
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
