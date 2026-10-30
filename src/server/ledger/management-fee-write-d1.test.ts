import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ReconcileD1 } from "./reconcile-d1";

const tmp = mkdtempSync(path.join(os.tmpdir(), "fee-write-d1-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
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

describe("D1 management fee writes", () => {
  it("matches SQLite when adding, updating and deleting actual fees", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-02T04:00:00Z"));
      const { getDb, kvSet } = await import("../db");
      const { saveManagementFeeEntry, deleteManagementFeeEntry } = await import("./actions");
      const { saveManagementFeeEntryD1, deleteManagementFeeEntryD1 } = await import("./management-fee-write-d1");
      const db = getDb(); kvSet("holdings.managementFeeStartDate", "2026-10-01");
      db.prepare(`INSERT INTO positions (account,exposure,symbol,shares,cost,status,recorded_on,updated_at) VALUES ('alipay','nasdaq','016452',100,800,'settled','2026-10-01','2026-10-01')`).run();
      db.prepare(`INSERT INTO nav_snapshots(symbol,as_of,nav,source) VALUES ('016452','2026-10-01',10,'auto'),('016452','2026-10-02',10,'auto')`).run();
      db.prepare(`INSERT INTO fund_management_fee_rates(code,effective_on,annual_rate_pct,source_url,source_provider,observed_at,status)
        VALUES ('016452','2026-10-01',0.5,'https://example.com','test','2026-10-01','valid'),('016452','2026-10-02',0.5,'https://example.com','test','2026-10-02','valid')`).run();
      db.pragma("journal_mode = DELETE");
      const cloud = new Database(db.serialize());
      const fee = { symbol: "016452", account: "alipay" as const, feeDate: "2026-10-02", amount: 0.02 };
      const check = () => {
        const entries = "SELECT symbol,account,fee_date,amount,note FROM holding_management_fee_entries ORDER BY id";
        const totals = "SELECT symbol,account,estimated_amount,actual_amount,last_nav_date FROM holding_management_fee_totals ORDER BY symbol,account";
        expect(cloud.prepare(entries).all()).toEqual(db.prepare(entries).all());
        expect(cloud.prepare(totals).all()).toEqual(db.prepare(totals).all());
      };
      expect(await saveManagementFeeEntryD1(binding(cloud), fee)).toEqual(await saveManagementFeeEntry(fee)); check();
      expect(await saveManagementFeeEntryD1(binding(cloud), { ...fee, amount: 0.03 })).toEqual(await saveManagementFeeEntry({ ...fee, amount: 0.03 })); check();
      const id = (db.prepare("SELECT id FROM holding_management_fee_entries").get() as { id: number }).id;
      expect(await deleteManagementFeeEntryD1(binding(cloud), id)).toEqual(await deleteManagementFeeEntry(id)); check();
      cloud.close();
    } finally { vi.useRealTimers(); }
  });

  it("rejects a concurrent fee change without overwriting it", async () => {
    const { getDb } = await import("../db");
    const { saveManagementFeeEntryD1 } = await import("./management-fee-write-d1");
    const cloud = new Database(getDb().serialize());
    const input = { symbol: "016452", account: "alipay" as const, feeDate: "2099-10-02", amount: 1 };
    const d1 = binding(cloud, () => cloud.prepare(`INSERT INTO holding_management_fee_entries(symbol,account,fee_date,amount,created_at,updated_at) VALUES ('016452','alipay','2099-10-02',2,'x','x')`).run());
    expect(await saveManagementFeeEntryD1(d1, input)).toMatchObject({ ok: false });
    expect(cloud.prepare("SELECT amount FROM holding_management_fee_entries WHERE fee_date='2099-10-02'").get()).toEqual({ amount: 2 });
    cloud.close();
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
