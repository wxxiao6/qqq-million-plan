import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ReconcileD1 } from "./reconcile-d1";

const tmp = mkdtempSync(path.join(os.tmpdir(), "fees-d1-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));

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

describe("D1 management fee calculation", () => {
  it("reads a consistent snapshot and matches the SQLite rebuild and incremental results", async () => {
    const { getDb, kvSet } = await import("../db");
    const db = getDb();
    kvSet("holdings.managementFeeStartDate", "2026-10-01");
    db.prepare(`INSERT INTO positions (account,exposure,symbol,shares,cost,status,recorded_on,updated_at)
      VALUES ('alipay','nasdaq','016452',100,800,'settled','2026-10-01','2026-10-01')`).run();
    db.prepare(`INSERT INTO nav_snapshots (symbol,as_of,nav,source) VALUES ('016452','2026-10-01',10,'auto'),('016452','2026-10-02',10,'auto')`).run();
    db.prepare(`INSERT INTO fund_management_fee_rates (code,effective_on,annual_rate_pct,raw_value,source_url,source_provider,observed_at,status)
      VALUES ('016452','2026-10-01',0.5,'0.50%','https://example.com','test','2026-10-01','valid'),('016452','2026-10-02',0.5,'0.50%','https://example.com','test','2026-10-02','valid')`).run();
    db.prepare(`INSERT INTO holding_management_fee_entries (symbol,account,fee_date,amount,created_at,updated_at) VALUES ('016452','alipay','2026-10-02',0.02,'2026-10-02','2026-10-02')`).run();
    const { readManagementFeesD1, calculateManagementFeeD1Group, rebuildManagementFeeGroupD1 } = await import("./management-fees-d1");
    const { rebuildManagementFeeGroup } = await import("./management-fees");
    const { listPositions } = await import("./index");
    const snapshot = await readManagementFeesD1(binding(db), "2026-10-02");
    const computed = calculateManagementFeeD1Group(snapshot, "016452", "alipay", true);
    expect(computed?.state).toEqual(rebuildManagementFeeGroup(listPositions(), "016452", "alipay", "2026-10-02"));
    expect(computed?.state.actualAmount).toBe(0.02);
    const second = await readManagementFeesD1(binding(db), "2026-10-02");
    expect(calculateManagementFeeD1Group(second, "016452", "alipay")).toMatchObject({ changed: false, state: computed?.state });
    // Model a plan moving its settled records to another platform, then
    // compare the rebuilt destination group with the existing SQLite logic.
    const moved = { ...second, positions: second.positions.map((position) => ({ ...position, account: "jd" as const })) };
    const movedResult = calculateManagementFeeD1Group(moved, "016452", "jd", true);
    db.prepare("UPDATE positions SET account='jd' WHERE symbol='016452'").run();
    expect(movedResult?.state).toEqual(rebuildManagementFeeGroup(listPositions(), "016452", "jd", "2026-10-02"));
    const d1Result = await rebuildManagementFeeGroupD1(binding(db), "016452", "jd", "2026-10-02");
    expect(d1Result).toEqual(movedResult?.state);
    expect(db.prepare("SELECT estimated_amount,actual_amount,last_nav_date FROM holding_management_fee_totals WHERE symbol='016452' AND account='jd'").get()).toEqual({
      estimated_amount: movedResult?.state.estimatedAmount, actual_amount: movedResult?.state.actualAmount, last_nav_date: movedResult?.state.lastNavDate,
    });
    const prior = db.prepare("SELECT estimated_amount,actual_amount,last_nav_date FROM holding_management_fee_totals WHERE symbol='016452' AND account='jd'").get();
    await expect(rebuildManagementFeeGroupD1(binding(db, () => db.prepare("UPDATE nav_snapshots SET nav=11 WHERE symbol='016452' AND as_of='2026-10-01'").run()), "016452", "jd", "2026-10-02")).rejects.toThrow();
    expect(db.prepare("SELECT estimated_amount,actual_amount,last_nav_date FROM holding_management_fee_totals WHERE symbol='016452' AND account='jd'").get()).toEqual(prior);
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
