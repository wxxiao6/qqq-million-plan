import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it, vi } from "vitest";
import { deletePositionD1, savePositionD1 } from "./positions-d1";
import type { ReconcileD1 } from "./reconcile-d1";

const tmp = mkdtempSync(path.join(os.tmpdir(), "position-d1-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));
vi.mock("../auth/context", () => ({ requireUser: async () => ({ id: "test-owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

function binding(db: Database.Database, beforeWrite?: () => void): ReconcileD1 {
  let calls = 0;
  return {
    prepare(sql) { return { bind(...values) { return { sql, values } as unknown as ReturnType<ReconcileD1["prepare"]>; } }; },
    async batch(statements) { if (++calls === 2) beforeWrite?.(); return db.transaction(() => statements.map((item) => {
      const { sql, values } = item as unknown as { sql: string; values: (string | number | null)[] };
      const stmt = db.prepare(sql);
      return { results: stmt.reader ? stmt.all(...values) : (stmt.run(...values), []) };
    }))(); },
  };
}

describe("D1 positions", () => {
  it("matches SQLite for creation, duplicate rejection, editing and deletion", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-29T04:00:00Z"));
      const { getDb } = await import("../db");
      const { savePosition, deletePosition } = await import("./actions");
      const db = getDb();
      db.prepare("INSERT INTO nav_snapshots(symbol,as_of,nav,source) VALUES ('016452','2026-10-29',2,'auto')").run();
      db.pragma("journal_mode = DELETE");
      const cloud = new Database(db.serialize());
      const input = { account: "alipay" as const, symbol: "016452", shares: 5, cost: 9, status: "settled" as const };
      expect(await savePositionD1(binding(cloud), input)).toEqual(await savePosition(input));
      const sql = "SELECT id,account,exposure,symbol,shares,cost,status,note,recorded_on FROM positions ORDER BY id";
      expect(cloud.prepare(sql).all()).toEqual(db.prepare(sql).all());
      expect(await savePositionD1(binding(cloud), input)).toEqual(await savePosition(input));
      const edit = { ...input, id: 1, shares: 8, cost: 14 };
      expect(await savePositionD1(binding(cloud), edit)).toEqual(await savePosition(edit));
      expect(cloud.prepare(sql).all()).toEqual(db.prepare(sql).all());
      expect(cloud.prepare("SELECT dynamic_mv FROM portfolio_snapshots WHERE as_of='2026-10-29'").get()).toEqual({ dynamic_mv: 16 });
      expect(await deletePositionD1(binding(cloud), 1)).toEqual(await deletePosition(1));
      expect(cloud.prepare(sql).all()).toEqual(db.prepare(sql).all());
      cloud.close();
    } finally { vi.useRealTimers(); }
  });

  it("rejects stale edits and concurrent duplicate creation", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    db.pragma("journal_mode = DELETE");
    const cloud = new Database(db.serialize());
    const input = { account: "alipay" as const, symbol: "016452", shares: 1, cost: 1, status: "settled" as const };
    const outcomes = await Promise.all([savePositionD1(binding(cloud), input), savePositionD1(binding(cloud), input)]);
    expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
    const row = cloud.prepare("SELECT id FROM positions WHERE symbol='016452'").get() as { id: number };
    const changed = binding(cloud, () => cloud.prepare("UPDATE positions SET cost=5 WHERE id=?").run(row.id));
    expect(await savePositionD1(changed, { ...input, id: row.id, cost: 2 })).toMatchObject({ ok: false });
    expect(cloud.prepare("SELECT cost FROM positions WHERE id=?").get(row.id)).toEqual({ cost: 5 });
    cloud.close();
  });

  it("allows a separate holding alongside DCA records in both databases without altering DCA", async () => {
    const { getDb } = await import("../db");
    const { upsertDcaPlan, recordPlanExecution } = await import("../dca");
    const { savePosition, deletePosition } = await import("./actions");
    const db = getDb();
    const plan = upsertDcaPlan({ symbol: "008971", shareClass: "C", channelKind: "direct", amount: 100, frequency: "weekly", weekday: 3, startDate: "2026-10-01" });
    if (!plan.ok) throw new Error(plan.error);
    expect(recordPlanExecution(plan.id, { status: "bought_before_cutoff", executionDate: "2026-10-07" }).ok).toBe(true);
    expect(recordPlanExecution(plan.id, { status: "bought_before_cutoff", executionDate: "2026-10-14" }).ok).toBe(true);
    const [settled] = db.prepare("SELECT id FROM positions WHERE dca_plan_id=? ORDER BY id").all(plan.id) as { id: number }[];
    db.prepare("UPDATE positions SET status='settled',shares=20 WHERE id=?").run(settled.id);
    const original = db.prepare("SELECT * FROM positions WHERE dca_plan_id=? ORDER BY id").all(plan.id);
    db.pragma("journal_mode = DELETE");
    const cloud = new Database(db.serialize());
    try {
      const input = { symbol: "008971", account: "gf_direct" as const, shares: 10, cost: 50, status: "settled" as const };
      expect(await savePositionD1(binding(cloud), input)).toEqual({ ok: true });
      expect(await savePosition(input)).toEqual({ ok: true });
      expect(await savePositionD1(binding(cloud), input)).toEqual(await savePosition(input));
      const row = cloud.prepare("SELECT id FROM positions WHERE symbol='008971' AND dca_plan_id IS NULL").get() as { id: number };
      expect(await savePositionD1(binding(cloud), { ...input, id: row.id, shares: 15 })).toEqual(await savePosition({ ...input, id: row.id, shares: 15 }));
      expect(await savePositionD1(binding(cloud), { ...input, id: settled.id })).toMatchObject({ ok: false });
      expect(await deletePositionD1(binding(cloud), settled.id)).toMatchObject({ ok: false });
      expect(await deletePositionD1(binding(cloud), row.id)).toEqual(await deletePosition(row.id));
      expect(cloud.prepare("SELECT * FROM positions WHERE dca_plan_id=? ORDER BY id").all(plan.id)).toEqual(original);
      expect(db.prepare("SELECT * FROM positions WHERE dca_plan_id=? ORDER BY id").all(plan.id)).toEqual(original);

      // A DCA execution arriving after validation must not trigger the manual-holding guard.
      const concurrent = binding(cloud, () => cloud.prepare(`INSERT INTO positions
        (account,exposure,symbol,shares,cost,status,updated_at,dca_plan_id)
        VALUES ('gf_direct','nasdaq','008971',NULL,100,'pending','2026-11-03',?)`).run(plan.id));
      expect(await savePositionD1(concurrent, input)).toEqual({ ok: true });
    } finally { cloud.close(); }
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
