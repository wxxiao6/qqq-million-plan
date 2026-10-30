import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ReconcileD1 } from "../ledger/reconcile-d1";
import type { ReadD1 } from "../dca/read-d1";

const tmp = mkdtempSync(path.join(os.tmpdir(), "holdings-read-d1-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));

function binding(db: Database.Database): ReconcileD1 & ReadD1 {
  return {
    prepare(sql) { return { sql, values: [], bind(...values: (string | number | null)[]) { return { sql, values } as never; } }; },
    async batch(statements) { return db.transaction(() => statements.map((item) => {
      const { sql, values } = item as unknown as { sql: string; values: (string | number | null)[] };
      const stmt = db.prepare(sql);
      return { results: stmt.reader ? stmt.all(...values) : (stmt.run(...values), []) };
    }))(); },
  } as ReconcileD1 & ReadD1;
}

describe("D1 holdings page read", () => {
  it("matches local positions, fee summaries, names, managers and plans", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-02T04:00:00Z"));
      const { getDb, kvSet } = await import("../db");
      const ledger = await import("../ledger");
      const { listDcaPlans } = await import("../dca");
      const { readHoldingsManagementD1 } = await import("./read-d1");
      const db = getDb(); kvSet("holdings.managementFeeStartDate", "2026-10-01");
      db.prepare(`INSERT INTO positions (account,exposure,symbol,shares,cost,status,recorded_on,updated_at)
        VALUES ('alipay','nasdaq','016452',100,800,'settled','2026-10-01','2026-10-01'),
          ('jd','nasdaq','016452',NULL,100,'pending','2026-10-02','2026-10-02')`).run();
      db.prepare(`INSERT INTO nav_snapshots (symbol,as_of,nav,source) VALUES ('016452','2026-10-01',10,'auto'),('016452','2026-10-02',11,'auto')`).run();
      db.prepare(`INSERT INTO fund_management_fee_rates (code,effective_on,annual_rate_pct,source_url,source_provider,observed_at,status)
        VALUES ('016452','2026-10-01',0.5,'https://example.com','test','2026-10-01','valid'),('016452','2026-10-02',0.5,'https://example.com','test','2026-10-02','valid')`).run();
      db.pragma("journal_mode = DELETE");
      const cloud = new Database(db.serialize());
      const result = await readHoldingsManagementD1(binding(cloud), "2026-10-02");
      const positions = ledger.listPositionDetails().filter((position) => position.exposure === "nasdaq");
      const group = positions.filter((position) => position.symbol === "016452");
      const summary = (subset: typeof positions, account?: "alipay" | "jd") => ledger.getManagementFeeSummary({
        positions: subset, symbol: "016452", account,
        rawMarketValue: subset.reduce((sum, position) => sum + (position.marketValue ?? 0), 0) || null,
        cost: subset.filter((position) => position.status === "settled").reduce((sum, position) => sum + position.cost, 0),
      });
      expect(result.positions).toEqual(positions);
      expect(result.names).toEqual(ledger.listNasdaqHoldingNames());
      expect(result.managers).toEqual(ledger.listNasdaqHoldingManagers());
      expect(result.plans).toEqual(listDcaPlans());
      expect(result.managementFees["016452"]).toEqual(summary(group));
      expect(result.platformManagementFees["016452:alipay"]).toEqual(summary(group.filter((position) => position.account === "alipay"), "alipay"));
      expect(result.platformManagementFees["016452:jd"]).toEqual(summary(group.filter((position) => position.account === "jd"), "jd"));
      cloud.close();
    } finally { vi.useRealTimers(); }
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
