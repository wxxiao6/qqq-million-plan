import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";

it("expands radar themes without cascading away existing quotes, identities or holdings", () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys = ON");
    const dir = path.join(process.cwd(), "db/migrations");
    for (const file of readdirSync(dir).filter((file) => file.endsWith(".sql") && file < "047_").sort()) {
      db.exec(readFileSync(path.join(dir, file), "utf8"));
    }
    const insert = db.prepare(`INSERT INTO nasdaq_funds(code,name,theme,product_type,venue,currency,source_url,detail_url,observed_on,manager)
      VALUES(?,?,?,'index','otc','CNY','https://example.com','https://example.com','2026-11-03','天弘基金')`);
    insert.run("018044", "天弘纳斯达克100指数发起(QDII)C", "nasdaq_100");
    db.prepare(`INSERT INTO nasdaq_fund_sales_channels(code,channel_kind,seller,verification_status) VALUES('018044','direct','test','verified')`).run();
    db.prepare(`INSERT INTO nasdaq_fund_observations(code,nav,nav_date,source_url,updated_at) VALUES('018044',2,'2026-11-02','https://example.com','2026-11-03')`).run();
    db.prepare(`INSERT INTO quota_current(code,share_class,channel_kind,status,daily_limit,currency,effective_on,observed_at,source_url,source_provider,updated_at)
      VALUES('018044','C','direct','limited',100,'CNY','2026-11-03','2026-11-03','https://example.com','test','2026-11-03')`).run();
    db.prepare(`INSERT INTO positions(account,exposure,symbol,shares,cost,status,updated_at)
      VALUES('alipay','nasdaq','018044',100,100,'settled','2026-11-03')`).run();
    const tables = ["nasdaq_fund_sales_channels", "nasdaq_fund_observations", "quota_current", "positions", "funds"];
    const before = tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all());
    db.transaction(() => db.exec(readFileSync(path.join(dir, "047_sp500_radar_theme.sql"), "utf8")))();
    expect(tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
    const insertNew = db.prepare(`INSERT INTO nasdaq_funds(code,name,theme,product_type,venue,currency,source_url,detail_url,observed_on,manager)
      VALUES(?,?,'sp500','index','otc','CNY','https://example.com','https://example.com','2026-11-03','天弘基金')`);
    insertNew.run("007721", "天弘标普500发起(QDII-FOF)A");
    expect(db.prepare("SELECT code,is_nasdaq FROM funds ORDER BY code").all()).toEqual([{ code: "007721", is_nasdaq: 0 }, { code: "018044", is_nasdaq: 1 }]);
    expect(db.prepare("SELECT code FROM nav_sync_funds WHERE code='007721'").get()).toEqual({ code: "007721" });
    expect(() => db.prepare("UPDATE nasdaq_funds SET theme='unknown' WHERE code='007721'").run()).toThrow();
    db.prepare("UPDATE nasdaq_funds SET name='天弘标普500发起A' WHERE code='007721'").run();
    expect(db.prepare("SELECT is_nasdaq FROM funds WHERE code='007721'").get()).toEqual({ is_nasdaq: 0 });
    db.prepare("UPDATE nasdaq_funds SET theme='gold' WHERE code='007721'").run();
    expect(db.prepare("SELECT is_nasdaq FROM funds WHERE code='007721'").get()).toEqual({ is_nasdaq: 0 });
    expect(db.pragma("foreign_key_check")).toEqual([]);
  } finally { db.close(); }
});
