import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const tmp = mkdtempSync(path.join(os.tmpdir(), "management-fee-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

describe("纳指持有管理费对账", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { getDb, kvSet } = await import("@/server/db");
    const db = getDb();
    db.exec("DELETE FROM holding_management_fee_entries; DELETE FROM holding_management_fee_totals; DELETE FROM fund_management_fee_rates; DELETE FROM nav_snapshots; DELETE FROM positions;");
    kvSet("holdings.managementFeeStartDate", "2026-10-01");
  });

  it("按日估算并由同日实际扣费覆盖，原始市值保持不变", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    db.prepare(`INSERT INTO positions (account, exposure, symbol, shares, cost, status, recorded_on, updated_at)
      VALUES ('alipay', 'nasdaq', '016452', 100, 800, 'settled', '2026-10-01', '2026-10-01T00:00:00Z')`).run();
    db.prepare(`INSERT INTO nav_snapshots (symbol, as_of, nav, source) VALUES
      ('016452', '2026-10-01', 10, 'auto'), ('016452', '2026-10-02', 10, 'auto')`).run();
    db.prepare(`INSERT INTO fund_management_fee_rates
      (code, effective_on, annual_rate_pct, raw_value, source_url, source_provider, observed_at, status)
      VALUES ('016452', '2026-10-01', 0.5, '0.50%', 'https://example.com/rate', 'test', '2026-10-01T00:00:00Z', 'valid'),
             ('016452', '2026-10-02', 0.5, '0.50%', 'https://example.com/rate', 'test', '2026-10-02T00:00:00Z', 'valid')`).run();

    const { getExposureSummary } = await import("@/server/ledger");
    const before = getExposureSummary("nasdaq", "2026-10-02");
    expect(before.marketValue).toBe(1000);
    expect(before.managementFeeEstimated).toBeCloseTo(1000 * 0.5 / 100 / 365 * 2, 8);
    expect(before.managementFeeActual).toBe(0);
    expect(before.reconciledMarketValue).toBeCloseTo(1000 - before.managementFeeEstimated, 8);
    expect(db.prepare("SELECT estimated_amount, actual_amount, last_nav_date FROM holding_management_fee_totals WHERE symbol='016452' AND account='alipay'").get()).toMatchObject({
      estimated_amount: before.managementFeeEstimated,
      actual_amount: 0,
      last_nav_date: "2026-10-02",
    });
    expect(getExposureSummary("nasdaq", "2026-10-02").managementFeeEstimated).toBeCloseTo(before.managementFeeEstimated, 8);

    const { saveManagementFeeEntry } = await import("@/server/ledger/actions");
    expect(await saveManagementFeeEntry({ symbol: "016452", account: "alipay", feeDate: "2026-10-02", amount: 0.02 })).toEqual({ ok: true });
    const after = getExposureSummary("nasdaq", "2026-10-02");
    expect(after.marketValue).toBe(1000);
    expect(after.managementFeeActual).toBe(0.02);
    expect(after.managementFeeEstimated).toBeCloseTo(1000 * 0.5 / 100 / 365, 8);
    expect(after.reconciledMarketValue).toBeCloseTo(1000 - after.managementFeeActual - after.managementFeeEstimated, 8);
    expect(db.prepare("SELECT estimated_amount, actual_amount, last_nav_date FROM holding_management_fee_totals WHERE symbol='016452' AND account='alipay'").get()).toMatchObject({
      estimated_amount: after.managementFeeEstimated,
      actual_amount: 0.02,
      last_nav_date: "2026-10-02",
    });

    expect(await saveManagementFeeEntry({ symbol: "016452", account: "alipay", feeDate: "2026-10-02", amount: 0.03 })).toEqual({ ok: true });
    expect(db.prepare("SELECT COUNT(*) AS count, amount FROM holding_management_fee_entries WHERE symbol='016452' AND account='alipay' AND fee_date='2026-10-02'").get()).toEqual({ count: 1, amount: 0.03 });
    const entry = db.prepare("SELECT id FROM holding_management_fee_entries WHERE symbol='016452' AND account='alipay' AND fee_date='2026-10-02'").get() as { id: number };
    const { deleteManagementFeeEntry } = await import("@/server/ledger/actions");
    expect(await deleteManagementFeeEntry(entry.id)).toEqual({ ok: true });
    expect(db.prepare("SELECT COUNT(*) AS count FROM holding_management_fee_entries WHERE id=?").get(entry.id)).toEqual({ count: 0 });
  });

  it("没有费率时不生成对账后市值", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    db.prepare(`INSERT INTO positions (account, exposure, symbol, shares, cost, status, recorded_on, updated_at)
      VALUES ('alipay', 'nasdaq', '016452', 100, 800, 'settled', '2026-10-01', '2026-10-01T00:00:00Z')`).run();
    db.prepare("INSERT INTO nav_snapshots (symbol, as_of, nav, source) VALUES ('016452', '2026-10-01', 10, 'auto')").run();
    const { getExposureSummary } = await import("@/server/ledger");
    const summary = getExposureSummary("nasdaq", "2026-10-01");
    expect(summary.managementFeeTotal).toBe(0);
    expect(summary.managementFeeCoverage.status).toBe("missing");
    expect(summary.reconciledMarketValue).toBeNull();
  });

  it("费率缺失时停在缺口，下一次补齐后只累计缺失日期", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    db.prepare(`INSERT INTO positions (account, exposure, symbol, shares, cost, status, recorded_on, updated_at)
      VALUES ('alipay', 'nasdaq', '016452', 100, 800, 'settled', '2026-10-01', '2026-10-01T00:00:00Z')`).run();
    db.prepare(`INSERT INTO nav_snapshots (symbol, as_of, nav, source) VALUES
      ('016452', '2026-10-01', 10, 'auto'), ('016452', '2026-10-02', 10, 'auto')`).run();
    db.prepare(`INSERT INTO fund_management_fee_rates
      (code, effective_on, annual_rate_pct, raw_value, source_url, source_provider, observed_at, status)
      VALUES ('016452', '2026-10-01', 0.5, '0.50%', 'https://example.com/rate', 'test', '2026-10-01T00:00:00Z', 'valid')`).run();

    const { getExposureSummary } = await import("@/server/ledger");
    const first = getExposureSummary("nasdaq", "2026-10-02");
    expect(first.managementFeeEstimated).toBeCloseTo(1000 * 0.5 / 100 / 365, 8);
    expect(db.prepare("SELECT last_nav_date FROM holding_management_fee_totals WHERE symbol='016452' AND account='alipay'").get()).toEqual({ last_nav_date: "2026-10-01" });

    db.prepare(`INSERT INTO fund_management_fee_rates
      (code, effective_on, annual_rate_pct, raw_value, source_url, source_provider, observed_at, status)
      VALUES ('016452', '2026-10-02', 0.5, '0.50%', 'https://example.com/rate', 'test', '2026-10-02T00:00:00Z', 'valid')`).run();
    const second = getExposureSummary("nasdaq", "2026-10-02");
    expect(second.managementFeeEstimated).toBeCloseTo(1000 * 0.5 / 100 / 365 * 2, 8);
    expect(db.prepare("SELECT last_nav_date FROM holding_management_fee_totals WHERE symbol='016452' AND account='alipay'").get()).toEqual({ last_nav_date: "2026-10-02" });
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
