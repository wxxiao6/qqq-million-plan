import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmp = mkdtempSync(path.join(os.tmpdir(), "holdings-"));
const dbPath = path.join(tmp, "ledger.sqlite");

vi.stubEnv("P0_TEST_DB", dbPath);
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
}));

describe("动态仓资产类型", () => {
  it("缺少上一交易日时不能把跨日涨跌当作单日收益，刷新补齐真实前值", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    db.prepare(`INSERT INTO positions (account, exposure, symbol, shares, cost, status, updated_at)
      VALUES ('gf_direct', 'nasdaq', '021778', 2852.51, 23480, 'settled', '2026-10-10')`).run();
    db.prepare("INSERT INTO nav_snapshots (symbol, as_of, nav, nav_change_pct) VALUES ('021778', '2026-09-29', 8.3108, 0.21), ('021778', '2026-10-08', 8.4083, 1.02)").run();
    const { listPositionDetails, getExposureSummary } = await import("@/server/ledger");
    expect(listPositionDetails()[0].today).toBeCloseTo(2852.51 * 8.4083 * 1.02 / 101.02);
    expect(getExposureSummary("nasdaq").today).toBeCloseTo(2852.51 * 8.4083 * 1.02 / 101.02);
    const { runQuotaScan } = await import("@/server/jobs/quota-scan");
    runQuotaScan({ shares: [{ symbol: "021778", shareClass: "F", name: "广发", manager: "广发基金",
      directStatus: null, directDailyLimit: null, agencyStatus: null, agencyDailyLimit: null,
      nav: 8.4083, navDate: "2026-10-08", navChangePct: 1.02, priorNav: 8.3234, priorNavDate: "2026-09-30" }] });
    expect(listPositionDetails()[0].today).toBeCloseTo(242.18, 2);
    expect(listPositionDetails()[0].marketValue).toBeCloseTo(23984.76, 2);
    db.prepare("DELETE FROM nav_snapshots WHERE symbol='021778' AND as_of='2026-09-30'").run();
    const { runNavScan } = await import("@/server/jobs/nav-scan");
    runNavScan({ shares: [{ symbol: "021778", shareClass: "F", name: "广发", manager: "广发基金",
      directStatus: null, directDailyLimit: null, agencyStatus: null, agencyDailyLimit: null,
      nav: 8.4083, navDate: "2026-10-08", priorNav: 8.3234, priorNavDate: "2026-09-30" }] });
    expect(db.prepare("SELECT nav FROM nav_snapshots WHERE symbol='021778' AND as_of='2026-09-30'").get()).toEqual({ nav: 8.3234 });
  });
  it("保存端计算缺失项并拒绝冲突数据，适用于所有购买账户", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    const { savePosition } = await import("@/server/ledger/actions");
    expect(await savePosition({ account: "gf_direct", symbol: "021778", cost: 100, unitCost: 3, status: "settled" })).toEqual({ ok: true });
    expect(await savePosition({ account: "alipay", symbol: "016452", shares: 100, unitCost: 2, status: "settled" })).toEqual({ ok: true });
    expect(await savePosition({ account: "cmb", symbol: "016452", shares: 100, cost: 200, unitCost: 3, status: "settled" })).toMatchObject({ ok: false });
    expect(db.prepare("SELECT account, shares, cost FROM positions ORDER BY id").all()).toEqual([
      { account: "gf_direct", shares: 33.3333, cost: 100 }, { account: "alipay", shares: 100, cost: 200 },
    ]);
  });

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("持仓按购买平台和基金判重，允许其他平台及编辑原持仓", async () => {
    const { getDb } = await import("@/server/db");
    const { savePosition, importPositionsCsv } = await import("@/server/ledger/actions");
    const base = { account: "alipay" as const, symbol: "016452", shares: 100, cost: 200, status: "settled" as const };
    expect(await savePosition(base)).toEqual({ ok: true });
    expect(await savePosition({ ...base, shares: 20, cost: 50 })).toEqual({ ok: false, error: "该购买平台已有此基金的持仓，请在持仓管理中编辑已有持仓" });
    expect(await savePosition({ ...base, account: "jd" })).toEqual({ ok: true });
    const db = getDb();
    const first = db.prepare("SELECT id FROM positions WHERE account='alipay' AND symbol='016452'").get() as { id: number };
    expect(await savePosition({ ...base, id: first.id, shares: 120 })).toEqual({ ok: true });
    expect(await savePosition({ ...base, id: first.id, account: "jd" })).toMatchObject({ ok: false });
    expect(await importPositionsCsv("account,symbol,shares,cost,status\ncmb,021778,10,100,settled\nalipay,016452,10,100,settled")).toMatchObject({ ok: false });
    expect(db.prepare("SELECT count(*) AS n FROM positions").get()).toEqual({ n: 2 });
  });

  it("定投在途记录也构成同平台同基金的已有持仓", async () => {
    const { addPendingSubscription, savePosition } = await import("@/server/ledger/actions");
    expect(await addPendingSubscription({ symbol: "016452", account: "alipay", executionOn: "2026-10-10", cutoffPeriod: "before_15", cashDebited: 10, feeAmount: 0 })).toEqual({ ok: true });
    expect(await savePosition({ symbol: "016452", account: "alipay", shares: 5, cost: 10, status: "settled" })).toMatchObject({ ok: false, error: expect.stringContaining("已有此基金的待确认申购") });
    expect(await savePosition({ symbol: "016452", account: "jd", shares: 5, cost: 10, status: "settled" })).toEqual({ ok: true });
  });

  it("已有定投持仓时提示到定投执行记录调整", async () => {
    const { upsertDcaPlan, recordPlanExecution } = await import("@/server/dca");
    const { savePosition } = await import("@/server/ledger/actions");
    const plan = upsertDcaPlan({ symbol: "016452", shareClass: "A", channelKind: "agency", account: "alipay", amount: 10, frequency: "weekly", weekday: 3, startDate: "2026-10-01" });
    if (!plan.ok) throw new Error(plan.error);
    expect(recordPlanExecution(plan.id, { status: "bought_before_cutoff", executionDate: "2026-10-07" }).ok).toBe(true);
    expect(await savePosition({ symbol: "016452", account: "alipay", shares: 10, cost: 20, status: "settled" }))
      .toEqual({ ok: false, error: "该购买平台已有此基金的定投持仓，请在定投管理的执行记录中调整" });
  });

  it("空仓不启用任何类型；点选纳指后出现该区且无持仓大数", async () => {
    const { getDb } = await import("@/server/db");
    getDb();
    const { getHoldingsView, enableAssetTypeSync } = await import("@/server/holdings");
    expect(getHoldingsView().empty).toBe(true);
    expect(getHoldingsView().enabled).toEqual([]);

    enableAssetTypeSync("nasdaq");
    const view = getHoldingsView();
    expect(view.empty).toBe(false);
    expect(view.enabled).toEqual(["nasdaq"]);
    expect(view.nasdaq.hasSettled).toBe(false);
    expect(view.remainingTypes).toEqual(["gold", "deposit", "crypto"]);
  });

  it("016452 能拉到简称和代销剩余额度；未知代码找不到", async () => {
    const { getDb } = await import("@/server/db");
    getDb();
    const { lookupNasdaqFundSync } = await import("@/server/holdings/lookup");
    const found = lookupNasdaqFundSync("016452");
    expect(found?.name).toMatch(/南方/);
    expect(found?.shareClass).toBe("A");
    expect(found?.hasAgency).toBe(true);
    expect(found?.remainingAgency).toEqual({ kind: "amount", value: 500 });

    expect(lookupNasdaqFundSync("999999")).toBeNull();
  });

  it("记下纳指后有总成本；无昨日快照则昨日收益为空", async () => {
    const { getDb } = await import("@/server/db");
    getDb();
    const { saveNasdaqHolding } = await import("@/server/holdings/actions");
    const saved = await saveNasdaqHolding({
      symbol: "016452",
      channelKind: "agency",
      platform: "alipay",
      shares: 100,
      unitCost: 8,
    });
    expect(saved.ok).toBe(true);

    const { getHoldingsView } = await import("@/server/holdings");
    const view = getHoldingsView();
    expect(view.nasdaq.hasSettled).toBe(true);
    expect(view.nasdaq.cost).toBe(800);
    expect(view.nasdaq.today).toBeNull();
    expect(view.enabled).toContain("nasdaq");
    expect(view.nasdaqGroups).toHaveLength(1);
    expect(view.nasdaqGroups[0]?.account).toBe("alipay");
    expect(view.nasdaqGroups[0]?.lots[0]?.symbol).toBe("016452");
    expect(view.nasdaqGroups[0]?.lots[0]?.name).toMatch(/南方/);
  });

  it("纳指明细按平台分组，在途不进该组小计", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO positions (account, exposure, symbol, shares, cost, status, note, recorded_on, updated_at)
       VALUES
         ('alipay', 'nasdaq', '016452', 100, 800, 'settled', NULL, '2026-08-27', ?),
         ('cmb', 'nasdaq', '016452', 50, 400, 'settled', NULL, '2026-08-27', ?),
         ('cmb', 'nasdaq', '016452', NULL, 200, 'pending', NULL, '2026-08-27', ?)`,
    ).run(now, now, now);
    db.prepare(
      `INSERT INTO nav_snapshots (symbol, as_of, nav, source) VALUES
         ('016452', '2026-08-26', 9, 'auto'),
         ('016452', '2026-08-27', 10, 'auto')`,
    ).run();

    const { listNasdaqPlatformGroups } = await import("@/server/ledger");
    const groups = listNasdaqPlatformGroups();
    expect(groups.map((row) => row.account)).toEqual(["alipay", "cmb"]);
    expect(groups[0]?.cost).toBe(800);
    expect(groups[0]?.marketValue).toBe(1000);
    expect(groups[0]?.holdingPnl).toBe(200);
    expect(groups[0]?.today).toBe(100);
    expect(groups[0]?.lots[0]?.today).toBe(100);
    expect(groups[1]?.lots).toHaveLength(2);
    expect(groups[1]?.cost).toBe(400);
    expect(groups[1]?.marketValue).toBe(500);
    expect(groups[1]?.holdingPnl).toBe(100);
    expect(groups[1]?.today).toBe(50);
    expect(groups[1]?.lots.find((lot) => lot.status === "pending")?.today).toBeNull();
  });

  it("在途须经扣款入口录入，已确认持仓须提供足够计算的数据", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    const { savePosition, addPendingSubscription } = await import("@/server/ledger/actions");
    expect(await savePosition({ account: "alipay", symbol: "016452", shares: null, cost: 50, status: "pending" })).toMatchObject({ ok: false });
    expect(await addPendingSubscription({ account: "alipay", symbol: "016452", executionOn: "2026-08-27", cutoffPeriod: "before_15", cashDebited: 50, feeAmount: 0 })).toEqual({ ok: true });
    expect(db.prepare("SELECT shares FROM positions WHERE symbol = '016452'").get()).toEqual({ shares: null });
    expect(await savePosition({ account: "alipay", symbol: "016452", shares: null, cost: 50, status: "settled" })).toEqual({ ok: false, error: "请至少填写持仓总成本、持有份额、持仓成本单价中的两项" });
  });

  it("京东代销持仓独立保存，直销账户关联基金公司", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    const { savePosition } = await import("@/server/ledger/actions");
    const { listNasdaqHoldingManagers } = await import("@/server/ledger");
    expect(listNasdaqHoldingManagers()["016452"]).toBe("南方基金管理股份有限公司");
    expect(await savePosition({ account: "jd", symbol: "016452", shares: 100, cost: 50, status: "settled" })).toEqual({ ok: true });
    expect(db.prepare("SELECT account, symbol FROM positions WHERE account = 'jd'").get()).toEqual({ account: "jd", symbol: "016452" });
  });

  it("只有最近净值时，使用公开源日涨跌计算该净值日的当日收益", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO positions (account, exposure, symbol, shares, cost, status, note, recorded_on, updated_at)
       VALUES ('alipay', 'nasdaq', '016452', 100, 800, 'settled', NULL, '2026-08-27', ?)`,
    ).run(now);
    db.prepare(
      `INSERT INTO nav_snapshots (symbol, as_of, nav, source, nav_change_pct)
       VALUES ('016452', '2026-08-27', 10, 'auto', 1)`,
    ).run();

    const { listNasdaqPlatformGroups } = await import("@/server/ledger");
    const lot = listNasdaqPlatformGroups()[0]?.lots[0];
    expect(lot?.navAsOf).toBe("2026-08-27");
    expect(lot?.today).toBeCloseTo(100 * (10 - 10 / 1.01));
  });

  it("加密货币计入动态市值；存款进固收不进动态", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO positions (account, exposure, symbol, shares, cost, status, note, recorded_on, updated_at)
       VALUES ('other', 'crypto', 'BTC', 1, 10000, 'settled', NULL, '2026-08-27', ?)`,
    ).run(now);
    db.prepare(
      `INSERT INTO nav_snapshots (symbol, as_of, nav, source) VALUES ('BTC', '2026-08-27', 12000, 'auto')`,
    ).run();
    db.prepare(
      `INSERT INTO deposits (bank, principal, rate, start_date, maturity_date, can_prepay)
       VALUES ('招行', 5000, NULL, NULL, NULL, 0)`,
    ).run();

    const { getDynamicMarketValue } = await import("@/server/ledger");
    expect(getDynamicMarketValue()).toBe(12000);

    const { getHoldingsView } = await import("@/server/holdings");
    const view = getHoldingsView();
    expect(view.enabled).toContain("crypto");
    expect(view.enabled).toContain("deposit");
    expect(view.crypto.marketValue).toBe(12000);
    expect(view.dynamic.marketValue).toBe(12000);
    expect(view.dynamic.cost).toBe(10000);
    expect(view.depositPv).toBe(5000);
  });

});
