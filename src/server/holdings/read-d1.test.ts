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
  it("matches local positions, names, managers and plans", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-02T04:00:00Z"));
      const { getDb } = await import("../db");
      const ledger = await import("../ledger");
      const { listDcaPlans } = await import("../dca");
      const { readHoldingsManagementD1 } = await import("./read-d1");
      const db = getDb();
      db.prepare(`INSERT INTO funds(code,name,manager,fund_type,currency,venue,is_nasdaq,source_url,updated_at) VALUES
        ('008986','广发上海金ETF联接A','广发基金','指数型-其他','CNY','otc',0,'source','2026-10-01'),
        ('999991','美元基金',NULL,NULL,'USD','otc',0,'source','2026-10-01'),
        ('999992','场内基金',NULL,NULL,'CNY','exchange',0,'source','2026-10-01'),
        ('999993','全球股票指数',NULL,'QDII-股票','CNY','otc',0,'source','2026-10-01')`).run();
      db.prepare(`INSERT INTO positions (account,exposure,symbol,shares,cost,status,recorded_on,updated_at)
        VALUES ('alipay','nasdaq','016452',100,800,'settled','2026-10-01','2026-10-01'),
          ('jd','nasdaq','016452',NULL,100,'pending','2026-10-02','2026-10-02'),
          ('gf_direct','fund','008986',100,800,'settled','2026-10-01','2026-10-01'),
          ('alipay','fund','999993',100,800,'settled','2026-10-01','2026-10-01')`).run();
      db.prepare(`INSERT INTO nav_snapshots (symbol,as_of,nav,source) VALUES ('016452','2026-10-01',10,'auto'),('016452','2026-10-02',11,'auto')`).run();
      db.pragma("journal_mode = DELETE");
      const cloud = new Database(db.serialize());
      const result = await readHoldingsManagementD1(binding(cloud));
      const { HOLDING_FUNDS_SQL } = await import("../funds/personal");
      const funds = db.prepare(HOLDING_FUNDS_SQL).all() as Array<{ code: string; name: string }>;
      const positions = ledger.listPositionDetails().filter((position) => position.exposure === "nasdaq" || position.exposure === "fund");
      expect(result.positions).toEqual(positions);
      expect(result.names).toEqual(Object.fromEntries(funds.map((fund) => [fund.code, fund.name])));
      expect(result.pendingNames["008986"]).toBe("广发上海金ETF联接A");
      expect(result.pendingNames["016452"]).toBeDefined();
      expect(result.pendingNames["999991"]).toBeUndefined();
      expect(result.pendingNames["999992"]).toBeUndefined();
      expect(result.names["008986"]).toBe("广发上海金ETF联接A");
      expect(result.qdiiFunds).toMatchObject({ "008986": false, "016452": true, "160213": true, "999993": true });
      expect(result.fundCategories).toMatchObject({ "008986": "gold", "016452": "nasdaq", "007721": "sp500", "999993": "fund" });
      expect(result.managers).toEqual({ ...ledger.listNasdaqHoldingManagers(), "008986": "广发基金" });
      expect(result.plans).toEqual(listDcaPlans());
      cloud.close();
    } finally { vi.useRealTimers(); }
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
