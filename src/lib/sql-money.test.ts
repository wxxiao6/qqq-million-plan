import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { investedTotalDeltaSql } from "./sql-money";

it("accumulates and reverses cent amounts in SQL without drifting", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE totals(invested_total REAL NOT NULL); INSERT INTO totals VALUES(0)");
    const add = db.prepare(`UPDATE totals SET invested_total=${investedTotalDeltaSql()}`);
    const subtract = db.prepare(`UPDATE totals SET invested_total=${investedTotalDeltaSql("subtract")}`);
    db.transaction(() => { for (let i = 0; i < 10000; i++) add.run(0.01); })();
    expect(db.prepare("SELECT invested_total FROM totals").get()).toEqual({ invested_total: 100 });
    subtract.run(99.99);
    expect(db.prepare("SELECT invested_total FROM totals").get()).toEqual({ invested_total: 0.01 });
    add.run(0.1 + 0.2);
    expect(db.prepare("SELECT invested_total FROM totals").get()).toEqual({ invested_total: 0.31 });
  } finally { db.close(); }
});
