import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createPendingSubscriptionD1, resolvePendingSubscriptionD1 } from "./pending-d1";
import type { ReconcileD1 } from "./reconcile-d1";

const tmp = mkdtempSync(path.join(os.tmpdir(), "pending-d1-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));
function binding(db: Database.Database): ReconcileD1 {
  return {
    prepare(sql) { return { bind(...values) { return { sql, values } as unknown as ReturnType<ReconcileD1["prepare"]>; } }; },
    async batch(statements) { return db.transaction(() => statements.map((item) => {
      const { sql, values } = item as unknown as { sql: string; values: (string | number | null)[] };
      const stmt = db.prepare(sql);
      return { results: stmt.reader ? stmt.all(...values) : (stmt.run(...values), []) };
    }))(); },
  };
}

describe("D1 pending subscriptions", () => {
  it("matches SQLite for linked debit and confirmed shares", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-29T04:00:00Z"));
      const { getDb } = await import("../db");
      const { upsertDcaPlan } = await import("../dca");
      const { createPendingSubscription, resolvePendingSubscription } = await import("./pending");
      const db = getDb();
      const plan = upsertDcaPlan({ symbol: "019547", shareClass: "A", channelKind: "agency", account: "alipay", amount: 10, frequency: "daily", startDate: "2026-10-28" });
      if (!plan.ok) throw new Error(plan.error);
      db.pragma("journal_mode = DELETE");
      const cloud = new Database(db.serialize());
      const input = { symbol: "019547", account: "alipay" as const, dcaPlanId: plan.id, executionOn: "2026-10-28", cutoffPeriod: "after_15" as const, cashDebited: 10, feeAmount: 1 };
      const actual = await createPendingSubscriptionD1(binding(cloud), input);
      expect(actual).toEqual(createPendingSubscription(input));
      if (!actual.ok) throw new Error(actual.error);
      expect(await createPendingSubscriptionD1(binding(cloud), input)).toMatchObject({ ok: false });
      const invalid = { id: actual.id, outcome: "settled" as const, shares: 5, tDate: "2026-10-28", confirmedOn: "2026-10-29" };
      expect(await resolvePendingSubscriptionD1(binding(cloud), invalid)).toEqual(resolvePendingSubscription(invalid));
      const confirmed = { ...invalid, tDate: "2026-10-29" };
      expect(await resolvePendingSubscriptionD1(binding(cloud), confirmed)).toEqual(resolvePendingSubscription(confirmed));
      const sql = "SELECT account,symbol,shares,cost,status,recorded_on,execution_on,cutoff_period,t_date,confirmed_on,dca_plan_id,cash_debited,fee_amount FROM positions ORDER BY id";
      expect(cloud.prepare(sql).all()).toEqual(db.prepare(sql).all());
      expect(cloud.prepare("SELECT invested_total,next_debit_date FROM dca_plans WHERE id=?").get(plan.id)).toEqual(db.prepare("SELECT invested_total,next_debit_date FROM dca_plans WHERE id=?").get(plan.id));
      cloud.close();
    } finally { vi.useRealTimers(); }
  });

  it("handles concurrent linked creation and rolls back totals on cancellation", async () => {
    const { getDb } = await import("../db");
    const db = getDb(); const cloud = new Database(db.serialize());
    const plan = cloud.prepare("SELECT id FROM dca_plans LIMIT 1").get() as { id: number };
    const input = { symbol: "019547", account: "alipay" as const, dcaPlanId: plan.id, executionOn: "2026-10-30", cutoffPeriod: "before_15" as const, cashDebited: 10, feeAmount: 0 };
    const results = await Promise.all([createPendingSubscriptionD1(binding(cloud), input), createPendingSubscriptionD1(binding(cloud), input)]);
    const success = results.filter((result) => result.ok);
    expect(success).toHaveLength(1);
    const inserted = success[0];
    expect(await resolvePendingSubscriptionD1(binding(cloud), { id: inserted.id, outcome: "cancelled" })).toMatchObject({ ok: true });
    expect(cloud.prepare("SELECT invested_total FROM dca_plans WHERE id=?").get(plan.id)).toEqual({ invested_total: 9 });
    expect(await resolvePendingSubscriptionD1(binding(cloud), { id: inserted.id, outcome: "failed" })).toMatchObject({ ok: false });
    cloud.close();
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
