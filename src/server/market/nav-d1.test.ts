import { isolatedLedger } from "@/test/isolated-ledger";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { saveNavChunkD1, syncNavChunkD1, updatePortfolioSnapshotD1 } from "./nav-d1";
import type { MarketD1 } from "./tiantian-d1";
import type { ReconcileD1 } from "../ledger/reconcile-d1";

isolatedLedger();

function binding(db: Database.Database, failAt = -1): MarketD1 {
  return {
    prepare(sql) { return { bind(...values) { return { sql, values }; } }; },
    async batch(statements) {
      return db.transaction(() => statements.map((item, index) => {
        if (index === failAt) throw new Error("simulated failure");
        const statement = item as { sql: string; values: (string | number | null)[] };
        return db.prepare(statement.sql).run(...statement.values);
      }))();
    },
  };
}

const record = { code: "016452", navDate: "2026-10-28", nav: 2, dailyChangePct: 1, sourceUrl: "https://example.com" };

describe("D1 NAV chunk", () => {
  it("settles automatic orders with their NAV on refresh while leaving later and manual orders pending", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    const insert = db.prepare(`INSERT INTO positions (account,exposure,symbol,cost,status,execution_on,cutoff_period,auto_generated,updated_at)
      VALUES ('gf_direct','nasdaq','021000',200,'pending',?,?,?,'2026-10-30')`);
    for (const day of ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']) insert.run(day, 'before_15', 1);
    insert.run('2026-10-28', 'before_15', 0);
    insert.run('2026-10-28', 'after_15', 1);
    db.prepare("INSERT INTO nav_snapshots(symbol,as_of,nav,source) VALUES ('021000','2026-10-27',2,'real')").run();
    await saveNavChunkD1(binding(db), [{ ...record, code: '021000' }], 'tiantian', '2026-10-30T06:00:00Z');
    expect(db.prepare("SELECT execution_on,cutoff_period,auto_generated,status,shares FROM positions WHERE symbol='021000' ORDER BY id").all()).toEqual([
      { execution_on: '2026-10-27', cutoff_period: 'before_15', auto_generated: 1, status: 'settled', shares: 100 },
      { execution_on: '2026-10-28', cutoff_period: 'before_15', auto_generated: 1, status: 'settled', shares: 100 },
      { execution_on: '2026-10-29', cutoff_period: 'before_15', auto_generated: 1, status: 'pending', shares: null },
      { execution_on: '2026-10-30', cutoff_period: 'before_15', auto_generated: 1, status: 'pending', shares: null },
      { execution_on: '2026-10-28', cutoff_period: 'before_15', auto_generated: 0, status: 'pending', shares: null },
      { execution_on: '2026-10-28', cutoff_period: 'after_15', auto_generated: 1, status: 'pending', shares: null },
    ]);
    db.prepare("DELETE FROM positions WHERE symbol='021000'").run();
    db.prepare("DELETE FROM nav_snapshots WHERE symbol='021000'").run();
    db.prepare("DELETE FROM fund_nav_history WHERE code='021000'").run();
  });
  it("confirms non-QDII pending cash regardless of origin and respects cutoff dates on both runtimes", async () => {
    const { getDb } = await import("../db");
    const { updateAutoPendingEstimates } = await import("../ledger/recent-pending");
    const db = getDb();
    db.prepare(`INSERT INTO funds(code,name,fund_type,currency,venue,is_nasdaq,source_url,updated_at) VALUES
      ('008986','广发上海金ETF联接A','黄金','CNY','otc',0,'source','2026-11-04'),
      ('999991','海外基金(QDII)A',NULL,'CNY','otc',0,'source','2026-11-04'),
      ('999992','全球指数','qdii-股票','CNY','otc',0,'source','2026-11-04')`).run();
    const insert = db.prepare(`INSERT INTO positions(account,exposure,symbol,cost,cash_debited,fee_amount,status,
      execution_on,cutoff_period,auto_generated,order_origin,updated_at)
      VALUES('gf_direct','fund',?,499,500,1,'pending',?,?,?,?,'2026-11-04')`);
    insert.run('008986','2026-11-02','before_15',0,'manual');
    insert.run('008986','2026-11-02','before_15',1,'dca');
    insert.run('008986','2026-11-02','after_15',0,'manual');
    insert.run('008986','2026-11-03','after_15',0,'manual');
    insert.run('008986','2026-11-01','before_15',0,'manual'); // Incomplete history: no invented T day.
    insert.run('008986',null,null,0,'manual');
    insert.run('999991','2026-11-02','before_15',0,'manual');
    insert.run('999992','2026-11-02','before_15',0,'manual');
    const cloud = new Database(db.serialize());
    const records = ['008986','999991','999992'].map((code) => ({ ...record, code, navDate: '2026-11-03', nav: 4,
      recentHistory: [
        { navDate: '2026-11-03', nav: 4, dailyChangePct: null },
        { navDate: '2026-11-02', nav: 2, dailyChangePct: null },
      ] }));
    try {
      await saveNavChunkD1(binding(cloud), records, 'tiantian', '2026-11-04T06:00:00Z');
      for (const item of records) {
        for (const nav of item.recentHistory) db.prepare("INSERT INTO nav_snapshots(symbol,as_of,nav,source) VALUES (?,?,?,'tiantian')").run(item.code,nav.navDate,nav.nav);
        updateAutoPendingEstimates(item.code, '2026-11-04');
      }
      const sql = "SELECT status,shares,t_date,t_nav,cost,cash_debited,fee_amount,auto_generated,order_origin FROM positions ORDER BY id";
      expect(cloud.prepare(sql).all()).toEqual(db.prepare(sql).all());
      expect(cloud.prepare("SELECT status,shares,t_date FROM positions ORDER BY id").all()).toEqual([
        { status: 'settled', shares: 249.5, t_date: '2026-11-02' },
        { status: 'settled', shares: 249.5, t_date: '2026-11-02' },
        { status: 'settled', shares: 124.75, t_date: '2026-11-03' },
        ...Array.from({ length: 5 }, () => ({ status: 'pending', shares: null, t_date: null })),
      ]);
      await saveNavChunkD1(binding(cloud), records, 'tiantian', '2026-11-04T06:30:00Z');
      expect(cloud.prepare(sql).all()).toEqual(db.prepare(sql).all());
    } finally { cloud.close(); }
  });

  it("saves history and held snapshots, preserves manual NAV, and does not create unheld snapshots", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    db.prepare("INSERT INTO positions (account,exposure,symbol,shares,cost,status,updated_at) VALUES ('alipay','nasdaq','016452',1,1,'settled','2026-10-28')").run();
    db.prepare("INSERT INTO nav_snapshots (symbol,as_of,nav,source) VALUES ('016452','2026-10-28',3,'manual')").run();
    const d1 = binding(db);
    await saveNavChunkD1(d1, [record, { ...record, code: "021000" }], "tiantian", "2026-10-28T14:00:00Z");
    expect(db.prepare("SELECT nav,nav_date FROM nasdaq_fund_observations WHERE code='016452'").get()).toEqual({ nav: 2, nav_date: "2026-10-28" });
    expect(db.prepare("SELECT nav FROM fund_nav_history WHERE code='016452' AND source='tiantian'").get()).toEqual({ nav: 2 });
    expect(db.prepare("SELECT nav,source FROM nav_snapshots WHERE symbol='016452' AND as_of='2026-10-28'").get()).toEqual({ nav: 3, source: "manual" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM nav_snapshots WHERE symbol='021000'").get()).toEqual({ n: 0 });
    await saveNavChunkD1(d1, [{ ...record, navDate: "2026-10-29" }], "tiantian", "2026-10-29T14:00:00Z");
    expect(db.prepare("SELECT nav,source FROM nav_snapshots WHERE symbol='016452' AND as_of='2026-10-29'").get()).toEqual({ nav: 2, source: "tiantian" });
    await updatePortfolioSnapshotD1(d1, "2026-10-29");
    expect(db.prepare("SELECT dynamic_mv FROM portfolio_snapshots WHERE as_of='2026-10-29'").get()).toEqual({ dynamic_mv: 2 });
  });

  it("rolls back all records when the batch fails", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    await expect(saveNavChunkD1(binding(db, 1), [{ ...record, navDate: "2026-10-30" }], "tiantian", "2026-10-30T14:00:00Z")).rejects.toThrow("simulated failure");
    expect(db.prepare("SELECT * FROM fund_nav_history WHERE code='016452' AND nav_date='2026-10-30'").get()).toBeUndefined();
  });

  it("matches decimal half-up estimates at cent ties and account-level valuation rounding", async () => {
    const { getDb } = await import("../db");
    const { updateAutoPendingEstimates } = await import("../ledger/recent-pending");
    const { autoEstimateStatement } = await import("../ledger/reconcile-d1");
    const db = getDb();
    const cases = [[2.01, 2, 1.01], [10.01, 2, 5.01], [0.29, 2, 0.15], [985.22, 1.2345, 798.07]];
    for (const [index, [cost, nav]] of cases.entries()) {
      const symbol = `99000${index}`;
      db.prepare("INSERT INTO nav_snapshots(symbol,as_of,nav,source) VALUES (?,'2026-11-02',?,'precision-test')").run(symbol, nav);
      db.prepare(`INSERT INTO positions(account,exposure,symbol,cost,status,execution_on,cutoff_period,auto_generated,updated_at)
        VALUES ('alipay','nasdaq',?,?,'pending','2026-11-02','before_15',1,'2026-11-02')`).run(symbol, cost);
    }

    const cloud = new Database(db.serialize());
    try {
      for (const [index, [, , shares]] of cases.entries()) {
        const symbol = `99000${index}`;
        updateAutoPendingEstimates(symbol, "2026-11-03");
        await binding(cloud).batch([autoEstimateStatement(binding(cloud) as unknown as ReconcileD1, symbol, "2026-11-03", "2026-11-03")]);
        for (const database of [db, cloud]) expect(database.prepare("SELECT status,shares FROM positions WHERE symbol=?").get(symbol)).toEqual({ status: "settled", shares });
      }
      cloud.exec("DELETE FROM positions; DELETE FROM nav_snapshots");
      cloud.prepare("INSERT INTO nav_snapshots(symbol,as_of,nav,source) VALUES ('990009','2026-11-02',1.005,'precision-test')").run();
      for (const account of ["alipay", "alipay", "jd"]) cloud.prepare(`INSERT INTO positions(account,exposure,symbol,shares,cost,status,updated_at)
        VALUES (?,'nasdaq','990009',1,1,'settled','2026-11-03')`).run(account);
      await updatePortfolioSnapshotD1(binding(cloud), "2026-11-03");
      expect(cloud.prepare("SELECT dynamic_mv FROM portfolio_snapshots WHERE as_of='2026-11-03'").get()).toEqual({ dynamic_mv: 3.02 });
    } finally {
      cloud.close();
      db.exec("DELETE FROM positions WHERE symbol LIKE '99000%'; DELETE FROM nav_snapshots WHERE symbol LIKE '99000%'");
    }
  });

  it("reports source errors and enforces the per-request limit", async () => {
    const { getDb } = await import("../db");
    const source = { name: "tiantian", fetchNav: vi.fn(async (code: string) => { if (code === "021000") throw new Error("offline"); return { ...record, code, navDate: "2026-10-31" }; }) };
    const d1 = binding(getDb());
    expect(await syncNavChunkD1(d1, { codes: ["016452", "021000"], observedAt: "2026-10-31T14:00:00Z" }, source)).toMatchObject({ requested: 2, success: 1, failed: [{ code: "021000", error: "净值暂时无法获取，稍后自动重试" }] });
    await expect(syncNavChunkD1(d1, { codes: Array.from({ length: 26 }, (_, i) => String(i)), observedAt: "2026-10-31" }, source)).rejects.toThrow("Too many funds");
  });
});
