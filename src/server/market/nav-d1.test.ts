import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterAll, describe, expect, it, vi } from "vitest";
import { saveNavChunkD1, syncNavChunkD1, updatePortfolioSnapshotD1 } from "./nav-d1";
import type { MarketD1 } from "./tiantian-d1";

const tmp = mkdtempSync(path.join(os.tmpdir(), "nav-d1-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));

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
  it("saves history and held snapshots, preserves manual NAV, and does not create unheld snapshots", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    db.prepare("INSERT INTO positions (account,exposure,symbol,shares,cost,status,updated_at) VALUES ('alipay','nasdaq','016452',1,1,'settled','2026-10-28')").run();
    db.prepare("INSERT INTO nav_snapshots (symbol,as_of,nav,source) VALUES ('016452','2026-10-28',3,'manual')").run();
    const d1 = binding(db);
    await saveNavChunkD1(d1, [record, { ...record, code: "021000" }], "tiantian", "2026-10-28T14:00:00Z");
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

  it("reports source errors and enforces the per-request limit", async () => {
    const { getDb } = await import("../db");
    const source = { name: "tiantian", fetchNav: vi.fn(async (code: string) => { if (code === "021000") throw new Error("offline"); return { ...record, code, navDate: "2026-10-31" }; }) };
    const d1 = binding(getDb());
    expect(await syncNavChunkD1(d1, { codes: ["016452", "021000"], observedAt: "2026-10-31T14:00:00Z" }, source)).toMatchObject({ requested: 2, success: 1, failed: [{ code: "021000", error: "offline" }] });
    await expect(syncNavChunkD1(d1, { codes: Array.from({ length: 26 }, (_, i) => String(i)), observedAt: "2026-10-31" }, source)).rejects.toThrow("Too many funds");
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
