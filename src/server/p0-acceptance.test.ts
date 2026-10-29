import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmp = mkdtempSync(path.join(os.tmpdir(), "p0-"));
const dbPath = path.join(tmp, "ledger.sqlite");

vi.stubEnv("P0_TEST_DB", dbPath);

describe("P0 验收口径", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("空仓也能看额度；动态仓可读取持仓与资产管理数据", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    const now = new Date().toISOString();

    const { listQuotaMatrix, hasBuyableCell } = await import("@/server/quota");
    const matrix = listQuotaMatrix();
    const row = matrix.find((item) => item.symbol === "016452");
    expect(row).toBeTruthy();
    expect(row?.held).toBe(false);
    expect(row?.buyableAgency).toBe(true);
    expect(hasBuyableCell()).toBe(true);
    expect(matrix[0]?.symbol).toBe("016452");

    db.prepare(
      `INSERT INTO positions (account, exposure, symbol, shares, cost, status, note, recorded_on, updated_at)
       VALUES ('alipay', 'nasdaq', '016452', 100, 800, 'settled', NULL, '2026-08-26', ?)`,
    ).run(now);
    db.prepare(
      `INSERT INTO nav_snapshots (symbol, as_of, nav) VALUES ('016452', '2026-08-27', 10)`,
    ).run();
    db.prepare(
      `INSERT INTO deposits (bank, principal, rate, start_date, maturity_date, can_prepay)
       VALUES ('招行', 20000, NULL, NULL, NULL, 0)`,
    ).run();
    db.prepare(
      `INSERT INTO mortgage (id, remaining_principal, monthly_payment, remaining_terms, rate_type, payment_day)
       VALUES (1, 5000, 3000, 120, 'fixed', NULL)`,
    ).run();

    const { getExposureSummary, listHeldSymbols, listDeposits, getMortgage } = await import(
      "@/server/ledger"
    );
    const nasdaq = getExposureSummary("nasdaq");
    expect(nasdaq.marketValue).toBe(1000);
    expect(nasdaq.cost).toBe(800);
    expect(nasdaq.holdingPnl).toBe(200);
    expect(listHeldSymbols()).toContain("016452");

    expect(listDeposits()).toHaveLength(1);
    expect(getMortgage()?.remainingPrincipal).toBe(5000);
  });
});

describe("纳指雷达看板", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("无已核验额度时不虚构可投金额；共享额度去重并标注过期", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    const { getQuotaBoard } = await import("@/server/quota");

    db.prepare("DELETE FROM quota_current").run();
    db.prepare("UPDATE quota_universe SET fund_status=NULL, fund_daily_limit=NULL").run();

    const board = getQuotaBoard();
    expect(board.emptyUniverse).toBe(false);
    expect(board.overview.purchasesConnected).toBe(false);
    expect(board.overview.purchased).toEqual({ kind: "amount", value: 0 });
    expect(board.overview.remaining).toEqual(board.overview.investable);
    expect(board.overview.investable).toEqual({ kind: "unknown" });
    expect(board.overview.coverageCovered).toBe(0);
    expect(board.overview.coverageTotal).toBeGreaterThanOrEqual(14);
    expect(board.overview.direct.investable).toEqual({ kind: "unknown" });
    expect(board.overview.agency.investable).toEqual({ kind: "unknown" });

    const unknown = board.rows.find((row) => row.symbol === "000834");
    expect(unknown?.direct).toBeNull();
    expect(unknown?.agency).toBeNull();
    expect(unknown?.remaining).toEqual({ kind: "unknown" });

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO quota_current (
         code, share_class, channel_kind, status, daily_limit, currency,
         quota_scope, effective_on, observed_at, source_url, source_provider, updated_at
       ) VALUES (?, 'A', 'agency', 'limited', 1000, 'CNY', '015299:AC:agency', '2026-10-28', ?, 'https://example.com/quota', 'test', ?)`,
    ).run("015299", now, now);
    db.prepare(
      `INSERT INTO quota_current (
         code, share_class, channel_kind, status, daily_limit, currency,
         quota_scope, effective_on, observed_at, source_url, source_provider, updated_at
       ) VALUES (?, 'C', 'agency', 'limited', 1000, 'CNY', '015299:AC:agency', '2026-10-28', ?, 'https://example.com/quota', 'test', ?)`,
    ).run("015300", now, now);

    const shared = getQuotaBoard();
    expect(shared.overview.investable).toEqual({ kind: "amount", value: 1000 });
    expect(shared.overview.coverageCovered).toBe(1);
    const sharedRow = shared.rows.find((row) => row.symbol === "015299");
    expect(sharedRow?.agency?.shareTag).toBe("shared");

    db.prepare(
      `UPDATE quota_current SET updated_at = '2020-01-01T01:00:00.000Z'`,
    ).run();
    const stale = getQuotaBoard();
    expect(stale.overview.dataStatus).toBe("非今日数据");
    expect(stale.overview.isStale).toBe(true);
  });

  it("未实际扣款的定投不从所属渠道额度中扣减", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    const { beijingTodayISO } = await import("@/lib/format");
    const today = beijingTodayISO();
    db.prepare(
      `INSERT INTO dca_plans (
         exposure, symbol, share_class, channel_kind, account, amount, frequency,
         weekday, month_day, start_date, next_debit_date, status, note, updated_at
       ) VALUES ('nasdaq', '016452', 'A', 'agency', 'alipay', 200, 'daily', NULL, NULL, ?, ?, 'active', NULL, ?)`,
    ).run(today, today, new Date().toISOString());

    const { getQuotaBoard } = await import("@/server/quota");
    const board = getQuotaBoard();
    const south = board.rows.find((row) => row.symbol === "016452");
    expect(south?.purchased).toBe(0);
    expect(south?.remaining).toEqual({ kind: "amount", value: 500 });
    expect(board.overview.purchased).toEqual({ kind: "amount", value: 0 });
  });

  it("标记已持有和仅定投中的基金行", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO positions (account, exposure, symbol, shares, cost, status, note, recorded_on, updated_at)
       VALUES ('alipay', 'nasdaq', '016452', 100, 800, 'settled', NULL, '2026-08-26', ?)`,
    ).run(now);
    db.prepare(
      `INSERT INTO dca_plans (
         exposure, symbol, share_class, channel_kind, account, amount, frequency,
         weekday, month_day, start_date, next_debit_date, status, note, updated_at
       ) VALUES ('nasdaq', '015299', 'A', 'agency', 'alipay', 100, 'monthly', NULL, 1, '2026-01-01', NULL, 'active', NULL, ?)`,
    ).run(now);

    const { getQuotaBoard } = await import("@/server/quota");
    const board = getQuotaBoard();
    expect(board.rows.find((row) => row.symbol === "016452")?.held).toBe(true);
    expect(board.rows.find((row) => row.symbol === "016452")?.hasActiveDca).toBe(false);
    expect(board.rows.find((row) => row.symbol === "015299")?.held).toBe(false);
    expect(board.rows.find((row) => row.symbol === "015299")?.hasActiveDca).toBe(true);
  });
});
