import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmp = mkdtempSync(path.join(os.tmpdir(), "dca-"));
const dbPath = path.join(tmp, "ledger.sqlite");

vi.stubEnv("P0_TEST_DB", dbPath);

describe("定投计划", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("过去起始日按有效记录推进，失败或取消后重新待补录", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    const { upsertDcaPlan, listDcaPlans, listDcaFeeDetails } = await import("@/server/dca");
    const { createPendingSubscription, resolvePendingSubscription } = await import("@/server/ledger/pending");
    const result = upsertDcaPlan({ symbol: "019547", shareClass: "A", channelKind: "agency", account: "alipay", amount: 10, frequency: "daily", startDate: "2026-10-08" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const nextDate = () => listDcaPlans().find((plan) => plan.id === result.id)?.nextDebitDate;
    expect(nextDate()).toBe("2026-10-08");
    expect(db.prepare("SELECT COUNT(*) AS n FROM positions").get()).toEqual({ n: 0 });
    const record = (date: string) => createPendingSubscription({ symbol: "019547", account: "alipay", dcaPlanId: result.id, executionOn: date, cutoffPeriod: "before_15", cashDebited: 10, feeAmount: 0 });
    const later = record("2026-10-09");
    expect(later.ok).toBe(true);
    expect(nextDate()).toBe("2026-10-08");
    const first = record("2026-10-08");
    expect(first.ok).toBe(true);
    expect(nextDate()).toBe("2026-10-12");
    if (!first.ok) throw new Error(first.error);
    expect(resolvePendingSubscription({ id: first.id, outcome: "failed" }).ok).toBe(true);
    expect(nextDate()).toBe("2026-10-08");
    expect(listDcaFeeDetails()).toHaveLength(1);
  });

  it("额度 API 写入的当前状态统一用于雷达、定投和持仓查询", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    const { listDcaShareCandidates } = await import("@/server/dca");
    const { candidatesForChannel } = await import("@/lib/dca");
    const { listNasdaqFunds } = await import("@/server/funds/catalog");
    const { getQuotaBoard } = await import("@/server/quota");
    const { lookupNasdaqFundSync } = await import("@/server/holdings/lookup");
    db.prepare(`INSERT OR REPLACE INTO quota_current
      (code, share_class, channel_kind, status, daily_limit, currency, quota_scope, effective_on, observed_at, source_url, source_provider, updated_at)
      VALUES ('016452', 'A', 'agency', 'paused', NULL, 'CNY', '016452:A:agency', '2026-10-10', ?, 'https://example.com/quota', 'test', ?)`).run(new Date().toISOString(), new Date().toISOString());
    expect(listNasdaqFunds(db).find((row) => row.code === "016452")?.agencyTradeStatus).toBe("paused");
    expect(getQuotaBoard().rows.find((row) => row.symbol === "016452")?.buyableAgency).toBe(false);
    expect(lookupNasdaqFundSync("016452")?.remainingAgency).toEqual({ kind: "amount", value: 0 });
    expect(candidatesForChannel(listDcaShareCandidates(), "agency").some((row) => row.symbol === "016452")).toBe(false);
    db.prepare("UPDATE quota_current SET status='limited', daily_limit=10 WHERE code='016452' AND channel_kind='agency'").run();
    expect(getQuotaBoard().rows.find((row) => row.symbol === "016452")?.agency?.dailyLimit).toBe(10);
    expect(candidatesForChannel(listDcaShareCandidates(), "agency").some((row) => row.symbol === "016452")).toBe(true);
    // Missing real NAV must never expose the bundled demonstration price.
    expect(lookupNasdaqFundSync("016452")?.nav).toBeNull();
  });

  it("仅直销份额即使残留代销报价也不能进入代销候选", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    db.prepare(`INSERT INTO nasdaq_tiantian_agency_quotes
      (code, status, daily_limit, source_url, updated_at)
      VALUES ('021000', 'limited', 200, 'https://fund.eastmoney.com/021000.html', '2026-10-10')`).run();
    const { listDcaShareCandidates } = await import("@/server/dca");
    const { candidatesForChannel } = await import("@/lib/dca");
    expect(candidatesForChannel(listDcaShareCandidates(), "agency").some((row) => row.symbol === "021000")).toBe(false);
    const { lookupNasdaqFundSync } = await import("@/server/holdings/lookup");
    expect(lookupNasdaqFundSync("021000")).toMatchObject({ hasDirect: true, hasAgency: false });
  });

  it("空仓也能写入 021778 F 直销每周三，列表能读到", async () => {
    const { getDb } = await import("@/server/db");
    getDb();
    const { listPositions } = await import("@/server/ledger");
    expect(listPositions()).toHaveLength(0);

    const { getDcaBoard, upsertDcaPlan } = await import("@/server/dca");
    const saved = upsertDcaPlan({
      symbol: "021778",
      shareClass: "F",
      channelKind: "direct",
      amount: 1000,
      frequency: "weekly",
      weekday: 3,
      startDate: "2026-08-27",
    });
    expect(saved.ok).toBe(true);

    const board = getDcaBoard();
    expect(board.plans).toHaveLength(1);
    expect(board.activeCount).toBe(1);
    expect(board.totalInvested).toBe(0);
    expect(board.plans[0]?.symbol).toBe("021778");
    expect(board.plans[0]?.channelKind).toBe("direct");
    expect(board.plans[0]?.account).toBe("gf_direct");
    expect(board.plans[0]?.amount).toBe(1000);
    expect(board.plans[0]?.fundInvestedTotal).toBe(0);
    expect(board.plans[0]?.frequencyLabel).toBe("每周三");
    expect(board.plans[0]?.channelWarning).toBe("no_cell");
    expect(listPositions()).toHaveLength(0);
  });

  it("所选渠道暂停则行内标 paused；无格标 no_cell", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR REPLACE INTO quota_current (
         code, share_class, channel_kind, status, daily_limit, currency,
         quota_scope, effective_on, observed_at, source_url, source_provider, updated_at
       ) VALUES ('021778', 'F', 'direct', 'paused', NULL, 'CNY', '021778:F:direct', '2026-08-27', ?, 'https://example.com/quota', 'test', ?)`,
    ).run(now, now);

    const { getDcaBoard, upsertDcaPlan } = await import("@/server/dca");
    upsertDcaPlan({
      symbol: "021778",
      shareClass: "F",
      channelKind: "direct",
      amount: 1000,
      frequency: "weekly",
      weekday: 3,
      startDate: "2026-08-27",
    });
    expect(getDcaBoard().plans[0]?.channelWarning).toBe("paused");

    upsertDcaPlan({
      symbol: "000834",
      shareClass: "A",
      channelKind: "agency",
      amount: 200,
      frequency: "monthly",
      monthDay: 8,
      startDate: "2026-08-27",
    });
    const none = getDcaBoard().plans.find((row) => row.symbol === "000834");
    expect(none?.channelWarning).toBe("no_cell");
  });

  it("暂停 / 恢复 / 删除生效；金额 0 不写入", async () => {
    const { getDb } = await import("@/server/db");
    getDb();
    const { getDcaBoard, removeDcaPlan, setDcaPlanStatus, upsertDcaPlan } =
      await import("@/server/dca");

    const zero = upsertDcaPlan({
      symbol: "021778",
      shareClass: "F",
      channelKind: "direct",
      amount: 0,
      frequency: "weekly",
      weekday: 3,
      startDate: "2099-08-27",
    });
    expect(zero).toEqual({ ok: false, error: "金额必须大于 0" });
    expect(getDcaBoard().plans).toHaveLength(0);

    const saved = upsertDcaPlan({
      symbol: "021778",
      shareClass: "F",
      channelKind: "direct",
      amount: 1000,
      frequency: "weekly",
      weekday: 3,
      startDate: "2099-08-27",
    });
    expect(saved.ok).toBe(true);
    const id = saved.ok ? saved.id : 0;

    setDcaPlanStatus(id, "paused");
    expect(getDcaBoard().plans[0]?.status).toBe("paused");
    expect(getDcaBoard().activeCount).toBe(0);

    setDcaPlanStatus(id, "active");
    expect(getDcaBoard().plans[0]?.status).toBe("active");

    removeDcaPlan(id);
    expect(getDcaBoard().plans).toHaveLength(0);
  });

  it("结束计划保留历史并禁止恢复、编辑和新增执行", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-02T04:00:00Z"));
    const { getDcaBoard, recordPlanExecution, setDcaPlanStatus, upsertDcaPlan } = await import("@/server/dca");
    const input = { symbol: "021778", shareClass: "F", channelKind: "direct", amount: 100, frequency: "weekly", weekday: 3, startDate: "2026-08-27" };
    const saved = upsertDcaPlan(input);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(recordPlanExecution(saved.id, { status: "bought_before_cutoff", executionDate: "2026-09-02" }).ok).toBe(true);
    expect(setDcaPlanStatus(saved.id, "ended").ok).toBe(true);
    expect(getDcaBoard().plans[0]).toMatchObject({ status: "ended", investedTotal: 100 });
    expect(setDcaPlanStatus(saved.id, "active").ok).toBe(false);
    expect(upsertDcaPlan({ ...input, id: saved.id }).ok).toBe(false);
    expect(recordPlanExecution(saved.id, { status: "bought_before_cutoff", executionDate: "2026-09-09" }).ok).toBe(false);
    const { createPendingSubscription } = await import("@/server/ledger/pending");
    expect(createPendingSubscription({ symbol: input.symbol, account: "gf_direct", executionOn: "2026-09-09", cutoffPeriod: "before_15", cashDebited: 100, feeAmount: 0, dcaPlanId: saved.id }).ok).toBe(false);
  });

  it("选基随渠道联动：只列可申购且有额度的份额", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    const { listDcaShareCandidates } = await import("@/server/dca");
    const { candidatesForChannel } = await import("@/lib/dca");
    const all = listDcaShareCandidates();
    const row = all.find((item) => item.symbol === "016452");
    expect(row?.shareClass).toBe("A");

    const agency = candidatesForChannel(all, "agency");
    const direct = candidatesForChannel(all, "direct");
    expect(agency.some((item) => item.symbol === "016452")).toBe(true);
    expect(agency.some((item) => item.agencyStatus != null)).toBe(true);
    expect(direct.some((item) => item.symbol === "016452")).toBe(false);
    expect(direct.some((item) => item.symbol === "021778")).toBe(false);
    db.prepare("INSERT OR REPLACE INTO quota_current (code, share_class, channel_kind, status, daily_limit, currency, quota_scope, effective_on, observed_at, source_url, source_provider, updated_at) VALUES ('016452', 'A', 'direct', 'limited', 10, 'CNY', '016452:A:direct', '2026-08-27', ?, 'test', 'test', ?)").run(new Date().toISOString(), new Date().toISOString());
    expect(candidatesForChannel(listDcaShareCandidates(), "direct").some((item) => item.symbol === "016452")).toBe(true);
    const { upsertDcaPlan, getDcaBoard } = await import("@/server/dca");
    expect(upsertDcaPlan({ symbol: "016452", shareClass: "A", channelKind: "direct", amount: 10, frequency: "weekly", weekday: 3, startDate: "2026-08-27" }).ok).toBe(true);
    expect(getDcaBoard().plans[0]?.account).toBe("gf_direct");
    expect(agency.every((item) => item.agencyStatus === "open" || (item.agencyStatus === "limited" && (item.agencyDailyLimit ?? 0) > 0))).toBe(true);
    expect(direct.every((item) => item.directStatus === "open" || (item.directStatus === "limited" && (item.directDailyLimit ?? 0) > 0))).toBe(true);
  });

  it("定投计划按购买平台和基金判重，暂停计划仍占用，结束后可新建", async () => {
    const { upsertDcaPlan, setDcaPlanStatus, getDcaBoard } = await import("@/server/dca");
    const input = { symbol: "016452", shareClass: "A", channelKind: "agency", account: "alipay", amount: 100, frequency: "weekly", weekday: 3, startDate: "2099-01-01" };
    const first = upsertDcaPlan(input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(upsertDcaPlan({ ...input, amount: 500 })).toEqual({ ok: false, error: "该购买平台已存在此基金的定投计划，请编辑或恢复已有计划" });
    const other = upsertDcaPlan({ ...input, account: "jd" });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(upsertDcaPlan({ ...input, id: other.id })).toMatchObject({ ok: false });
    expect(setDcaPlanStatus(first.id, "paused").ok).toBe(true);
    expect(upsertDcaPlan(input)).toMatchObject({ ok: false });
    expect(setDcaPlanStatus(first.id, "ended").ok).toBe(true);
    expect(upsertDcaPlan(input).ok).toBe(true);
    expect(getDcaBoard().plans).toHaveLength(3);
  });

  it("非法渠道-账户组合不能保存；空账户落到渠道默认", async () => {
    const { getDb } = await import("@/server/db");
    getDb();
    const { getDcaBoard, upsertDcaPlan } = await import("@/server/dca");

    expect(
      upsertDcaPlan({
        symbol: "016452",
        shareClass: "A",
        channelKind: "direct",
        account: "alipay",
        amount: 1000,
        frequency: "weekly",
        weekday: 3,
        startDate: "2026-08-27",
      }),
    ).toEqual({ ok: false, error: "渠道与账户不匹配" });

    expect(
      upsertDcaPlan({
        symbol: "016452",
        shareClass: "A",
        channelKind: "agency",
        account: "gf_direct",
        amount: 1000,
        frequency: "weekly",
        weekday: 3,
        startDate: "2026-08-27",
      }),
    ).toEqual({ ok: false, error: "渠道与账户不匹配" });

    const agency = upsertDcaPlan({
      symbol: "016452",
      shareClass: "A",
      channelKind: "agency",
      amount: 1000,
      frequency: "weekly",
      weekday: 3,
      startDate: "2026-08-27",
    });
    expect(agency.ok).toBe(true);
    expect(getDcaBoard().plans[0]?.account).toBe("alipay");

    const jd = upsertDcaPlan({
      symbol: "016452",
      shareClass: "A",
      channelKind: "agency",
      account: "jd",
      amount: 500,
      frequency: "weekly",
      weekday: 3,
      startDate: "2026-08-27",
    });
    expect(jd.ok).toBe(true);
    expect(getDcaBoard().plans.find((row) => row.id === (jd.ok ? jd.id : -1))?.account).toBe("jd");

    const direct = upsertDcaPlan({
      symbol: "021778",
      shareClass: "F",
      channelKind: "direct",
      amount: 200,
      frequency: "monthly",
      monthDay: 8,
      startDate: "2026-08-27",
    });
    expect(direct.ok).toBe(true);
    const savedDirect = getDcaBoard().plans.find((row) => row.symbol === "021778");
    expect(savedDirect?.account).toBe("gf_direct");
  });

  it("手续费费率与固定金额能写入并回显；未填为 —", async () => {
    const { getDb } = await import("@/server/db");
    getDb();
    const { getDcaBoard, upsertDcaPlan } = await import("@/server/dca");
    const { formatDcaFee } = await import("@/lib/dca");

    const rate = upsertDcaPlan({
      symbol: "016452",
      shareClass: "A",
      channelKind: "agency",
      account: "alipay",
      amount: 1000,
      feeKind: "rate",
      feeValue: 0.15,
      frequency: "weekly",
      weekday: 3,
      startDate: "2026-08-27",
    });
    expect(rate.ok).toBe(true);
    const first = getDcaBoard().plans[0];
    expect(first?.feeKind).toBe("rate");
    expect(first?.feeValue).toBe(0.15);
    expect(formatDcaFee(first?.feeKind, first?.feeValue)).toBe("0.15%");

    const id = rate.ok ? rate.id : 0;
    const fixed = upsertDcaPlan({
      id,
      symbol: "016452",
      shareClass: "A",
      channelKind: "agency",
      account: "cmb",
      amount: 1000,
      feeKind: "fixed",
      feeValue: 5,
      frequency: "weekly",
      weekday: 3,
      startDate: "2026-08-27",
    });
    expect(fixed.ok).toBe(true);
    const updated = getDcaBoard().plans[0];
    expect(updated?.account).toBe("cmb");
    expect(updated?.feeKind).toBe("fixed");
    expect(updated?.feeValue).toBe(5);
    expect(formatDcaFee(updated?.feeKind, updated?.feeValue)).toBe("¥5.00");

    const blank = upsertDcaPlan({
      symbol: "021778",
      shareClass: "F",
      channelKind: "direct",
      account: "gf_direct",
      amount: 800,
      frequency: "weekly",
      weekday: 3,
      startDate: "2026-08-27",
    });
    expect(blank.ok).toBe(true);
    const emptyFee = getDcaBoard().plans.find((row) => row.symbol === "021778");
    expect(emptyFee?.feeKind).toBeNull();
    expect(emptyFee?.feeValue).toBeNull();
    expect(formatDcaFee(emptyFee?.feeKind, emptyFee?.feeValue)).toBeNull();
  });

  it("定投候选只包含人民币场外份额，D/E 归代销", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    const { listDcaShareCandidates } = await import("@/server/dca");
    const candidates = listDcaShareCandidates();
    expect(candidates.every((row) => ["A", "C", "D", "E", "F", "I"].includes(row.shareClass))).toBe(true);
    expect(candidates.some((row) => row.shareClass === "D")).toBe(true);
    expect(candidates.some((row) => row.shareClass === "E")).toBe(true);
    const { candidatesForChannel } = await import("@/lib/dca");
    const extra = candidates.find((row) => ["D", "E"].includes(row.shareClass))!;
    expect(candidatesForChannel(candidates, "agency").some((row) => row.key === extra.key)).toBe(false);
    db.prepare("INSERT OR REPLACE INTO quota_current (code, share_class, channel_kind, status, daily_limit, currency, quota_scope, effective_on, observed_at, source_url, source_provider, updated_at) SELECT ?, share_class, 'agency', 'limited', 10, currency, ?, '2026-08-27', ?, 'test', 'test', ? FROM nasdaq_funds WHERE code=?").run(extra.symbol, `${extra.symbol}:${extra.shareClass}:agency`, new Date().toISOString(), new Date().toISOString(), extra.symbol);
    expect(candidatesForChannel(listDcaShareCandidates(), "agency").some((row) => row.key === extra.key)).toBe(true);
    db.prepare("INSERT OR REPLACE INTO quota_current (code, share_class, channel_kind, status, daily_limit, currency, quota_scope, effective_on, observed_at, source_url, source_provider, updated_at) SELECT ?, share_class, 'direct', 'limited', 10, currency, ?, '2026-08-27', ?, 'test', 'test', ? FROM nasdaq_funds WHERE code=?").run(extra.symbol, `${extra.symbol}:${extra.shareClass}:direct`, new Date().toISOString(), new Date().toISOString(), extra.symbol);
    expect(candidatesForChannel(listDcaShareCandidates(), "direct").some((row) => row.key === extra.key)).toBe(true);
  });

  it("实际扣款拆分手续费；未买入不创建在途或手续费明细", async () => {
    const { getDb } = await import("@/server/db");
    getDb();
    const { getDcaFeeTotal, listDcaFeeDetails, upsertDcaPlan } = await import("@/server/dca");
    const { listPositions } = await import("@/server/ledger");

    const notBought = upsertDcaPlan({
      symbol: "016452",
      shareClass: "A",
      channelKind: "agency",
      account: "alipay",
      amount: 1000,
      feeKind: "rate",
      feeValue: 0.15,
      frequency: "weekly",
      weekday: 3,
      startDate: "2026-08-27",
      execution: { status: "not_bought" },
    });
    expect(notBought.ok).toBe(true);
    expect(listPositions()).toHaveLength(0);
    expect(getDcaFeeTotal()).toBe(0);

    const bought = upsertDcaPlan({
      id: notBought.ok ? notBought.id : undefined,
      symbol: "016452",
      shareClass: "A",
      channelKind: "agency",
      account: "alipay",
      amount: 1000,
      feeKind: "rate",
      feeValue: 0.15,
      frequency: "weekly",
      weekday: 3,
      startDate: "2026-08-27",
      execution: {
        status: "bought_before_cutoff",
        executionDate: "2026-08-27",
        tDate: "2026-08-27",
        actualFeeAmount: 8,
      },
    });
    expect(bought.ok).toBe(true);
    const position = listPositions()[0];
    expect(position?.cashDebited).toBe(1000);
    expect(position?.feeAmount).toBe(8);
    expect(position?.cost).toBe(992);
    expect(position?.executionOn).toBe("2026-08-27");
    expect(getDcaFeeTotal()).toBe(8);
    expect(listDcaFeeDetails()[0]).toMatchObject({
      executionOn: "2026-08-27",
      recordedOn: "2026-08-27",
      cashDebited: 1000,
      feeAmount: 8,
      subscriptionAmount: 992,
      status: "pending",
    });
  });

  it("小额定投按扣费后的分值进入持仓成本", async () => {
    const { getDb } = await import("@/server/db");
    getDb();
    const { upsertDcaPlan, listDcaFeeDetails } = await import("@/server/dca");
    const { listPositions } = await import("@/server/ledger");
    const saved = upsertDcaPlan({
      symbol: "016452",
      shareClass: "A",
      channelKind: "agency",
      account: "alipay",
      amount: 10,
      feeKind: "rate",
      feeValue: 0.15,
      frequency: "weekly",
      weekday: 3,
      startDate: "2026-08-27",
      execution: { status: "bought_before_cutoff", executionDate: "2026-08-27" },
    });
    expect(saved.ok).toBe(true);
    expect(listPositions()[0]).toMatchObject({ cashDebited: 10, feeAmount: 0.01, cost: 9.99 });
    expect(listDcaFeeDetails()[0]).toMatchObject({ cashDebited: 10, feeAmount: 0.01, subscriptionAmount: 9.99 });
  });

  it("计划金额变更后，购买手续费汇总保留历史执行记录", async () => {
    const { getDb } = await import("@/server/db");
    getDb();
    const { getDcaFeeTotal, listDcaFeeDetails, upsertDcaPlan } = await import("@/server/dca");
    const first = upsertDcaPlan({
      symbol: "016452", shareClass: "A", channelKind: "agency", account: "alipay",
      amount: 10, feeKind: "rate", feeValue: 0.15, frequency: "weekly", weekday: 3, startDate: "2026-08-27",
      execution: { status: "bought_before_cutoff", executionDate: "2026-08-27" },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = upsertDcaPlan({
      id: first.id, symbol: "016452", shareClass: "A", channelKind: "agency", account: "alipay",
      amount: 100, feeKind: "rate", feeValue: 0.15, frequency: "weekly", weekday: 3, startDate: "2026-08-27",
      execution: { status: "bought_before_cutoff", executionDate: "2026-09-03" },
    });
    expect(second.ok).toBe(true);
    expect(listDcaFeeDetails().map((row) => row.feeAmount)).toEqual([0.15, 0.01]);
    expect(getDcaFeeTotal()).toBe(0.16);
  });

  it("15:00 后扣款先记在途，确认时再填写 T 日", async () => {
    const { getDb } = await import("@/server/db");
    getDb();
    const { upsertDcaPlan } = await import("@/server/dca");
    expect(
      upsertDcaPlan({
        symbol: "016452",
        shareClass: "A",
        channelKind: "agency",
        account: "alipay",
        amount: 1000,
        frequency: "weekly",
        weekday: 3,
        startDate: "2026-08-27",
        execution: {
          status: "bought_after_cutoff",
          executionDate: "2026-08-27",
        },
      }),
    ).toMatchObject({ ok: true });
    const { listPositions } = await import("@/server/ledger");
    expect(listPositions()[0]).toMatchObject({ status: "pending", cutoffPeriod: "after_15", tDate: null });
  });

  it("补录关联计划不重复记账；失败后撤出在途与累计投入", async () => {
    const { getDb } = await import("@/server/db"); getDb();
    const { upsertDcaPlan, getDcaBoard, listDcaExecutionHistory, listDcaFeeDetails } = await import("@/server/dca");
    const { createPendingSubscription, resolvePendingSubscription } = await import("@/server/ledger/pending");
    const { listPositions, getExposureSummary } = await import("@/server/ledger");
    const plan = upsertDcaPlan({ symbol: "016452", shareClass: "A", channelKind: "agency", account: "alipay", amount: 100, frequency: "weekly", weekday: 3, startDate: "2026-08-27" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const order = { symbol: "016452", account: "alipay" as const, executionOn: "2026-08-27", cutoffPeriod: "after_15" as const, cashDebited: 100, feeAmount: 1, dcaPlanId: plan.id };
    const created = createPendingSubscription(order);
    expect(created.ok).toBe(true);
    expect(createPendingSubscription(order)).toMatchObject({ ok: false });
    expect(getDcaBoard().totalInvested).toBe(99);
    expect(getExposureSummary("nasdaq").pending?.cost).toBe(99);
    if (!created.ok) return;
    expect(resolvePendingSubscription({ id: created.id, outcome: "settled", shares: 90, tDate: "2026-08-27", confirmedOn: "2026-08-28" })).toMatchObject({ ok: false });
    expect(resolvePendingSubscription({ id: created.id, outcome: "failed" }).ok).toBe(true);
    expect(listPositions()[0].status).toBe("failed");
    expect(listDcaExecutionHistory()).toMatchObject([{ status: "failed", cashDebited: 100 }]);
    expect(listDcaFeeDetails()).toHaveLength(0);
    expect(getDcaBoard().totalInvested).toBe(0);
    expect(getExposureSummary("nasdaq").pending).toBeNull();
  });

  it("计划创建后独立记录扣款，不修改计划配置", async () => {
    const { getDb } = await import("@/server/db"); getDb();
    const { upsertDcaPlan, recordPlanExecution, getDcaBoard } = await import("@/server/dca");
    const { listPositions } = await import("@/server/ledger");
    const saved = upsertDcaPlan({ symbol: "016452", shareClass: "A", channelKind: "agency", account: "alipay", amount: 100, frequency: "weekly", weekday: 3, startDate: "2026-08-27" });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(listPositions()).toHaveLength(0);
    const result = recordPlanExecution(saved.id, { status: "bought_after_cutoff", executionDate: "2026-08-27", actualCashDebited: 90, actualFeeAmount: 1 });
    expect(result.ok).toBe(true);
    expect(listPositions()[0]).toMatchObject({ status: "pending", cashDebited: 90, cost: 89, cutoffPeriod: "after_15", dcaPlanId: saved.id });
    expect(getDcaBoard().plans[0]).toMatchObject({ amount: 100, frequency: "weekly", account: "alipay", investedTotal: 89 });
    expect(recordPlanExecution(saved.id, { status: "bought_after_cutoff", executionDate: "2026-08-27", actualCashDebited: 90 }).ok).toBe(false);
  });
});
