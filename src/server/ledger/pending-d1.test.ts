import { isolatedLedger } from "@/test/isolated-ledger";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { createPendingSubscriptionD1, resolvePendingSubscriptionD1 } from "./pending-d1";
import type { ReconcileD1 } from "./reconcile-d1";

isolatedLedger();
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
    const db = getDb();
    const { upsertDcaPlan } = await import("../dca");
    const { createPendingSubscription, resolvePendingSubscription } = await import("./pending");
    const plan = upsertDcaPlan({ symbol: "019547", shareClass: "A", channelKind: "agency", account: "alipay", amount: 10, frequency: "daily", startDate: "2026-10-28" });
    if (!plan.ok) throw new Error(plan.error);
    const previous = createPendingSubscription({ symbol: "019547", account: "alipay", dcaPlanId: plan.id, executionOn: "2026-10-28", cutoffPeriod: "after_15", cashDebited: 10, feeAmount: 1 });
    if (!previous.ok) throw new Error(previous.error);
    expect(resolvePendingSubscription({ id: previous.id, outcome: "settled", shares: 5, tDate: "2026-10-29", confirmedOn: "2026-10-29" }).ok).toBe(true);
    const cloud = new Database(db.serialize());
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

  it("backfills an existing ordinary fund, preserves its category and confirms shares on both runtimes", async () => {
    const { getDb } = await import("../db");
    const { createPendingSubscription, resolvePendingSubscription } = await import("./pending");
    const { listPositionDetails } = await import("./index");
    const db = getDb();
    db.prepare(`INSERT INTO funds(code,name,manager,currency,venue,is_nasdaq,source_url,updated_at)
      VALUES('008986','广发上海金ETF联接A','广发基金','CNY','otc',0,'source','2026-11-03')`).run();
    db.prepare("INSERT INTO nav_snapshots(symbol,as_of,nav,source) VALUES('008986','2026-11-03',2.2,'auto')").run();
    const cloud = new Database(db.serialize());
    try {
      const input = { symbol: "008986", account: "gf_direct" as const, executionOn: "2026-11-03", cutoffPeriod: "before_15" as const, cashDebited: 500, feeAmount: 1 };
      const actual = await createPendingSubscriptionD1(binding(cloud), input);
      expect(actual).toEqual(createPendingSubscription(input));
      if (!actual.ok) throw new Error(actual.error);
      const sql = "SELECT exposure,symbol,status,shares,cost,cash_debited,fee_amount,order_origin FROM positions WHERE id=?";
      const pending = { exposure: "fund", symbol: "008986", status: "pending", shares: null, cost: 499, cash_debited: 500, fee_amount: 1, order_origin: "manual" };
      for (const database of [db, cloud]) {
        expect(database.prepare(sql).get(actual.id)).toEqual(pending);
        expect(database.prepare("SELECT code FROM nasdaq_funds WHERE code='008986'").get()).toBeUndefined();
        expect(database.prepare("SELECT code FROM nav_sync_funds WHERE code='008986'").get()).toEqual({ code: "008986" });
      }
      const confirm = { id: actual.id, outcome: "settled" as const, shares: 250, tDate: "2026-11-03", confirmedOn: "2026-11-04" };
      expect(await resolvePendingSubscriptionD1(binding(cloud), confirm)).toEqual(resolvePendingSubscription(confirm));
      expect(cloud.prepare(sql).get(actual.id)).toEqual({ ...pending, status: "settled", shares: 250 });
      expect(cloud.prepare(sql).get(actual.id)).toEqual(db.prepare(sql).get(actual.id));
      expect(listPositionDetails().find((row) => row.id === actual.id)).toMatchObject({ exposure: "fund", marketValue: 550, holdingPnl: 51 });
    } finally { cloud.close(); }
  });

  it("rejects unregistered, foreign currency and exchange funds without creating records", async () => {
    const { getDb } = await import("../db");
    const { createPendingSubscription } = await import("./pending");
    const db = getDb();
    db.prepare(`INSERT INTO funds(code,name,currency,venue,is_nasdaq,source_url,updated_at) VALUES
      ('999991','美元基金','USD','otc',0,'source','2026-11-03'),
      ('999992','场内基金','CNY','exchange',0,'source','2026-11-03')`).run();
    const { upsertDcaPlan } = await import("../dca");
    const plan = upsertDcaPlan({ symbol: "019547", shareClass: "A", channelKind: "agency", account: "alipay", amount: 10, frequency: "daily", startDate: "2026-10-28" });
    if (!plan.ok) throw new Error(plan.error);
    db.prepare("INSERT INTO funds(code,name,currency,venue,is_nasdaq,source_url,updated_at) VALUES('008986','上海金','CNY','otc',0,'source','2026-11-03')").run();
    const cloud = new Database(db.serialize());
    try {
      for (const symbol of ["999991", "999992", "999993"]) {
        const input = { symbol, account: "alipay" as const, executionOn: "2026-11-03", cutoffPeriod: "before_15" as const, cashDebited: 500, feeAmount: 0 };
        const error = { ok: false, error: "请选择已添加的人民币场外基金" };
        expect(await createPendingSubscriptionD1(binding(cloud), input)).toEqual(error);
        expect(createPendingSubscription(input)).toEqual(error);
        for (const database of [db, cloud]) expect(database.prepare("SELECT id FROM positions WHERE symbol=?").get(symbol)).toBeUndefined();
      }
      const mismatched = { symbol: "008986", account: "alipay" as const, dcaPlanId: plan.id, executionOn: "2026-11-03", cutoffPeriod: "before_15" as const, cashDebited: 500, feeAmount: 0 };
      expect(await createPendingSubscriptionD1(binding(cloud), mismatched)).toEqual(createPendingSubscription(mismatched));
      expect(createPendingSubscription(mismatched)).toMatchObject({ ok: false });
    } finally { cloud.close(); }
  });
});
