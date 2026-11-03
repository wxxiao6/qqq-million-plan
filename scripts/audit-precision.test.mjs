import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { auditPrecision, parseRemoteSnapshot, QUERIES, readLocalSnapshot, reportMarkdown } from "./audit-precision.mjs";

const empty = () => ({ positions: [], plans: [], snapshots: [], navs: [], navHistory: [] });

describe("read-only precision audit", () => {
  it("separates sub-cent entries, binary tails and valid extra share decimals", () => {
    const data = empty();
    data.positions = [
      { id: 1, symbol: "001", account: "alipay", cost: 1.005, shares: 1.2345, status: "settled", cash_debited: null, fee_amount: 0 },
      { id: 2, symbol: "002", account: "alipay", cost: 0.3, shares: 1, status: "settled", cash_debited: 0.30000000000000004, fee_amount: 0 },
    ];
    const report = auditPrecision(data);
    expect(report.summary).toMatchObject({ subCentAmounts: 1, binaryTails: 1, cashBalance: 0, extraConfirmedSharePrecision: 1 });
    expect(report.issues.subCentAmounts[0]).toMatchObject({ id: 1, value: 1.005, rounded: 1.01 });
    expect(data.positions[0].cost).toBe(1.005);
    expect(data.positions[0].shares).toBe(1.2345);
    expect(reportMarkdown(report)).toContain("数据库未作修改");
  });

  it("finds cash, estimated shares and stored-plan discrepancies without claiming platform error", () => {
    const data = empty();
    data.positions = [{ id: 1, symbol: "001", account: "alipay", cost: 1, cash_debited: 2, fee_amount: 0, shares: 1, status: "settled", auto_generated: 1, t_nav: 2, dca_plan_id: 1 }];
    data.plans = [{ id: 1, symbol: "001", amount: 2, invested_total: 2 }];
    const report = auditPrecision(data);
    expect(report.summary).toMatchObject({ cashBalance: 1, automaticShareReview: 1, planTotalReview: 1 });
    expect(report.issues.automaticShareReview[0]).toMatchObject({ defaultEstimate: 0.5 });
  });

  it("quantifies account rounding while keeping different owners separate", () => {
    const data = empty();
    data.navs = [{ symbol: "001", as_of: "2026-11-03", nav: 1.005, source: "test" }];
    data.navHistory = [{ code: "001", nav_date: "2026-11-03", nav: 1.005, source: "test" }];
    data.positions = ["a", "b"].map((user_id, index) => ({ id: index + 1, user_id, symbol: "001", account: "alipay", cost: 1, shares: 1, status: "settled" }));
    const report = auditPrecision(data);
    expect(report.aggregation).toMatchObject({ legacyMarketValueDisplay: 2.01, accountRoundedMarketValue: 2.02, marketValueBoundaryDelta: 0.01, valuedAccounts: 2 });
    expect(report.navPrecision.comparableSourceNavs).toBe(1);
    expect(report.summary.sourceNavMismatch).toBe(0);
  });

  it("reads a database without changing file contents and refuses to create a missing database", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "precision-read-only-"));
    const filename = path.join(tmp, "audit.sqlite");
    try {
      const db = new Database(filename);
      for (const [, sql] of QUERIES) {
        const [, columns, table] = sql.match(/^SELECT (.+) FROM (\w+)/);
        db.exec(`CREATE TABLE ${table} (${columns.split(",").map((name) => `${name} TEXT`).join(",")})`);
      }
      db.close();
      const hash = () => createHash("sha256").update(readFileSync(filename)).digest("hex");
      const before = hash();
      expect(readLocalSnapshot(filename).integrity).toEqual(["ok"]);
      expect(hash()).toBe(before);
      expect(() => readLocalSnapshot(path.join(tmp, "missing.sqlite"))).toThrow();
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  it("rejects incomplete remote results and reported writes", () => {
    expect(() => parseRemoteSnapshot([])).toThrow();
    const good = QUERIES.map(() => ({ success: true, results: [], meta: { changed_db: false, rows_written: 0 } }));
    expect(parseRemoteSnapshot(good)).toEqual(empty());
    expect(() => parseRemoteSnapshot(good.map((row, index) => index === 0 ? { ...row, meta: { rows_written: 1 } } : row))).toThrow();
  });
});
