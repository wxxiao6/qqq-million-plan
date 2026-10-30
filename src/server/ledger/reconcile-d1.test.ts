import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it, vi } from "vitest";
import { reconcileDueDcaPlanD1, reconcileDueDcaPlansD1, type ReconcileD1 } from "./reconcile-d1";

const tmp = mkdtempSync(path.join(os.tmpdir(), "reconcile-d1-"));
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

describe("D1 automatic DCA reconciliation", () => {
  it("matches SQLite's generated records, totals and NAV estimates; replay is idempotent", async () => {
    const { getDb } = await import("../db");
    const source = getDb();
    const { upsertDcaPlan } = await import("../dca");
    const { reconcileDueDcaPlan } = await import("./recent-pending");
    const saved = upsertDcaPlan({ symbol: "019547", shareClass: "A", channelKind: "agency", account: "alipay", amount: 10, frequency: "daily", startDate: "2026-10-08", feeKind: "fixed", feeValue: 0.1 });
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.error);
    for (const day of ["2026-10-08", "2026-10-09", "2026-10-12"]) source.prepare("INSERT INTO nav_snapshots (symbol,as_of,nav,source) VALUES ('019547',?,2,'real')").run(day);
    source.pragma("journal_mode = DELETE");
    const target = new Database(source.serialize());
    const d1 = binding(target);
    reconcileDueDcaPlan(saved.id, "2026-10-12");
    await reconcileDueDcaPlanD1(d1, saved.id, "2026-10-12");
    const positionSql = "SELECT account,symbol,shares,cost,status,note,recorded_on,execution_on,dca_plan_id,cash_debited,fee_amount,cutoff_period,order_origin,auto_generated,t_date,t_nav,confirmed_on FROM positions ORDER BY id";
    const planSql = "SELECT invested_total,imported_through,next_debit_date FROM dca_plans WHERE id=?";
    expect(target.prepare(positionSql).all()).toEqual(source.prepare(positionSql).all());
    expect(target.prepare("SELECT execution_on,status FROM positions WHERE dca_plan_id=? ORDER BY execution_on").all(saved.id)).toEqual([
      { execution_on: "2026-10-08", status: "settled" },
      { execution_on: "2026-10-09", status: "settled" },
      { execution_on: "2026-10-12", status: "settled" },
    ]);
    expect(target.prepare(planSql).get(saved.id)).toEqual(source.prepare(planSql).get(saved.id));
    await reconcileDueDcaPlanD1(d1, saved.id, "2026-10-12");
    expect(target.prepare(positionSql).all()).toEqual(source.prepare(positionSql).all());
    expect(target.prepare(planSql).get(saved.id)).toEqual(source.prepare(planSql).get(saved.id));
    target.close();
  });

  it("rejects a plan changed after reading without creating records", async () => {
    const { getDb } = await import("../db");
    const source = getDb();
    const { upsertDcaPlan } = await import("../dca");
    const saved = upsertDcaPlan({ symbol: "016452", shareClass: "A", channelKind: "agency", account: "alipay", amount: 10, frequency: "daily", startDate: "2026-10-08" });
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.error);
    source.pragma("journal_mode = DELETE");
    const target = new Database(source.serialize());
    const d1 = binding(target, () => target.prepare("UPDATE dca_plans SET amount=20 WHERE id=?").run(saved.id));
    await expect(reconcileDueDcaPlanD1(d1, saved.id, "2026-10-08")).rejects.toThrow();
    expect(target.prepare("SELECT count(*) AS n FROM positions WHERE dca_plan_id=?").get(saved.id)).toEqual({ n: 0 });
    target.close();
  });

  it("allows at most one writer to record a due period concurrently", async () => {
    const { getDb } = await import("../db");
    const source = getDb();
    const { upsertDcaPlan } = await import("../dca");
    const saved = upsertDcaPlan({ symbol: "021778", shareClass: "F", channelKind: "direct", account: "gf_direct", amount: 20, frequency: "daily", startDate: "2026-10-08" });
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.error);
    const target = new Database(source.serialize());
    const outcomes = await Promise.allSettled([
      reconcileDueDcaPlanD1(binding(target), saved.id, "2026-10-08"),
      reconcileDueDcaPlanD1(binding(target), saved.id, "2026-10-08"),
    ]);
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    expect(target.prepare("SELECT count(*) AS n FROM positions WHERE dca_plan_id=? AND execution_on='2026-10-08'").get(saved.id)).toEqual({ n: 1 });
    expect(target.prepare("SELECT invested_total FROM dca_plans WHERE id=?").get(saved.id)).toEqual({ invested_total: 20 });
    target.close();
  });

  it("reconciles many plans with three D1 calls and reports invalid plans", async () => {
    const { getDb } = await import("../db");
    const source = getDb();
    const target = new Database(source.serialize());
    target.exec("DELETE FROM positions; DELETE FROM dca_plans");
    const insert = target.prepare(`INSERT INTO dca_plans (symbol,share_class,channel_kind,account,amount,frequency,start_date,status,updated_at)
      VALUES ('016452','A','agency',?,10,'daily','2099-01-01','active','2026-10-01')`);
    for (let i = 0; i < 26; i++) insert.run(i === 25 ? null : "alipay");
    const d1 = binding(target);
    const batch = vi.spyOn(d1, "batch");
    const errors = await reconcileDueDcaPlansD1(d1, "2026-10-14");
    expect(batch).toHaveBeenCalledTimes(3);
    expect(errors).toHaveLength(1);
    expect(target.prepare("SELECT count(*) AS n FROM dca_plans WHERE imported_through='2026-10-14'").get()).toEqual({ n: 25 });
    target.close();
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
