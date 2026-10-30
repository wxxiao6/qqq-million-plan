import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it, vi } from "vitest";
import { setDcaPlanStatusD1 } from "./write-d1";
import type { ReconcileD1 } from "../ledger/reconcile-d1";

const tmp = mkdtempSync(path.join(os.tmpdir(), "dca-status-d1-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));

function binding(db: Database.Database, beforeWrite?: () => void): ReconcileD1 {
  let calls = 0;
  return {
    prepare(sql) { return { bind(...values) { return { sql, values } as unknown as ReturnType<ReconcileD1["prepare"]>; } }; },
    async batch(statements) { if (++calls === 2) beforeWrite?.(); return db.transaction(() => statements.map((item) => {
      const { sql, values } = item as unknown as { sql: string; values: (string | number | null)[] };
      const statement = db.prepare(sql);
      return { results: statement.reader ? statement.all(...values) : (statement.run(...values), []) };
    }))(); },
  };
}

describe("D1 DCA plan status", () => {
  it("matches SQLite through pause, resume and end without recording paused days", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-12T04:00:00Z"));
      const { getDb } = await import("../db");
      const { upsertDcaPlan, setDcaPlanStatus } = await import("./index");
      const db = getDb();
      const plan = upsertDcaPlan({ symbol: "019547", shareClass: "A", channelKind: "agency", account: "alipay", amount: 10, frequency: "daily", startDate: "2026-10-12" });
      if (!plan.ok) throw new Error(plan.error);
      db.pragma("journal_mode = DELETE");
      const cloud = new Database(db.serialize());
      const d1 = binding(cloud);
      const check = () => {
        const planSql = "SELECT status,ended_at,imported_through,next_debit_date,invested_total FROM dca_plans WHERE id=?";
        const positionsSql = "SELECT execution_on,cost,status,auto_generated FROM positions WHERE dca_plan_id=? ORDER BY execution_on";
        expect(cloud.prepare(planSql).get(plan.id)).toEqual(db.prepare(planSql).get(plan.id));
        expect(cloud.prepare(positionsSql).all(plan.id)).toEqual(db.prepare(positionsSql).all(plan.id));
      };
      vi.setSystemTime(new Date("2026-10-14T04:00:00Z"));
      expect(await setDcaPlanStatusD1(d1, plan.id, "paused")).toEqual(setDcaPlanStatus(plan.id, "paused"));
      check();
      vi.setSystemTime(new Date("2026-10-19T04:00:00Z"));
      expect(await setDcaPlanStatusD1(d1, plan.id, "active")).toEqual(setDcaPlanStatus(plan.id, "active"));
      check();
      expect(cloud.prepare("SELECT execution_on FROM positions WHERE dca_plan_id=? ORDER BY execution_on").all(plan.id)).toEqual(
        ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-19"].map((execution_on) => ({ execution_on })));
      expect(await setDcaPlanStatusD1(d1, plan.id, "ended")).toEqual(setDcaPlanStatus(plan.id, "ended"));
      check();
      expect(await setDcaPlanStatusD1(d1, plan.id, "active")).toMatchObject({ ok: false });
      cloud.close();
    } finally { vi.useRealTimers(); }
  });

  it("rolls back when the plan changes between read and pause", async () => {
    const { getDb } = await import("../db");
    const { upsertDcaPlan } = await import("./index");
    const source = getDb();
    const plan = upsertDcaPlan({ symbol: "016452", shareClass: "A", channelKind: "agency", account: "alipay", amount: 10, frequency: "daily", startDate: "2099-01-01" });
    if (!plan.ok) throw new Error(plan.error);
    const db = new Database(source.serialize());
    const d1 = binding(db, () => db.prepare("UPDATE dca_plans SET amount=20 WHERE id=?").run(plan.id));
    expect(await setDcaPlanStatusD1(d1, plan.id, "paused")).toMatchObject({ ok: false });
    expect(db.prepare("SELECT status,amount FROM dca_plans WHERE id=?").get(plan.id)).toEqual({ status: "active", amount: 20 });
    expect(db.prepare("SELECT count(*) AS n FROM positions WHERE dca_plan_id=?").get(plan.id)).toEqual({ n: 0 });
    db.close();
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
