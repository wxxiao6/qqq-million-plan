import { describe, expect, it } from "vitest";
import type { PositionDetail } from "@/server/ledger";
import { filterHoldingPositions, fundIncomeDate, groupHoldingChannels, groupNasdaqHoldings, isQdiiFund, marketValueIncludingPending, summarizeNasdaqHoldings } from "./holdings-dashboard";

function row(input: Partial<PositionDetail> & Pick<PositionDetail, "id" | "symbol" | "status">): PositionDetail {
  return {
    account: "alipay", exposure: "nasdaq", shares: 10, cost: 100, note: null,
    recordedOn: null, expectedConfirmOn: null, dcaPlanId: null, cashDebited: 100,
    feeAmount: 0, tNav: null, confirmedOn: null, executionOn: null, nav: 12,
    cutoffPeriod: null, tDate: null, orderOrigin: null, closedOn: null,
    navAsOf: "2026-10-08", marketValue: 120, holdingPnl: 20, today: 2,
    ...input,
  };
}

describe("持仓管理汇总", () => {
  it("组合单日收益按展示日期归集，不混加不同日期的收益", () => {
    const groups = groupNasdaqHoldings([
      row({ id: 1, symbol: "021778", status: "settled", navAsOf: "2026-10-08", today: 242.18 }),
      row({ id: 2, symbol: "016452", status: "settled", navAsOf: "2026-10-09", today: 10 }),
    ], {});
    expect(summarizeNasdaqHoldings(groups)).toMatchObject({ incomeDate: "2026-10-12", today: 10, incomeFundCount: 1, datedIncomeFundCount: 2 });
    expect(summarizeNasdaqHoldings([])).toMatchObject({ incomeDate: null, today: null });
  });

  it("008986 的收益日期与当日净值一致，QDII 仍顺延到下一个工作日", () => {
    const groups = groupNasdaqHoldings([
      row({ id: 1, symbol: "008986", exposure: "fund", status: "settled", navAsOf: "2026-11-02", today: -333.18 }),
      row({ id: 2, symbol: "016452", status: "settled", navAsOf: "2026-10-30", today: -901.90 }),
    ], { "008986": "广发上海金ETF联接A", "016452": "南方纳斯达克100指数发起(QDII)A" }, { "008986": false, "016452": true });
    expect(groups[0]).toMatchObject({ isQdii: false, navAsOf: "2026-11-02", incomeDate: "2026-11-02", today: -333.18, marketValue: 120 });
    expect(groups[1]).toMatchObject({ isQdii: true, navAsOf: "2026-10-30", incomeDate: "2026-11-02", today: -901.90 });
    expect(summarizeNasdaqHoldings(groups)).toMatchObject({ incomeDate: "2026-11-02", incomeFundCount: 2 });
    expect(summarizeNasdaqHoldings(groups).today).toBeCloseTo(-1235.08);
  });

  it("相同净值日期的 QDII 与非 QDII 收益不归到同一个展示日", () => {
    const groups = groupNasdaqHoldings([
      row({ id: 1, symbol: "008986", exposure: "fund", status: "settled", navAsOf: "2026-11-02", today: -333.18 }),
      row({ id: 2, symbol: "016452", status: "settled", navAsOf: "2026-11-02", today: 10 }),
    ], {}, { "008986": false, "016452": true });
    expect(summarizeNasdaqHoldings(groups)).toMatchObject({ incomeDate: "2026-11-03", today: 10, incomeFundCount: 1, datedIncomeFundCount: 2 });
    expect(summarizeNasdaqHoldings(groups.slice(0, 1))).toMatchObject({ incomeDate: "2026-11-02", today: -333.18, incomeFundCount: 1 });
  });

  it("QDII 根据基金类型、名称与已知纳指目录识别，不把其他基金一律视作非 QDII", () => {
    expect(isQdiiFund("广发上海金ETF联接A", "指数型-其他", false)).toBe(false);
    expect(isQdiiFund("南方中证500ETF联接(LOF)A", "指数型-股票", false)).toBe(false);
    expect(isQdiiFund("全球股票指数", "QDII-股票", false)).toBe(true);
    expect(isQdiiFund("海外指数(QDII)A", null, false)).toBe(true);
    expect(isQdiiFund("国泰纳斯达克100指数", "index", true)).toBe(true);
    expect(fundIncomeDate(null, true)).toBeNull();
    expect(fundIncomeDate(null, false)).toBeNull();
    expect(fundIncomeDate("2026-10-30", false)).toBe("2026-10-30");
    expect(fundIncomeDate("2026-10-30", true)).toBe("2026-11-02");
    const [otherQdii] = groupNasdaqHoldings([
      row({ id: 1, symbol: "999993", exposure: "fund", status: "settled", navAsOf: "2026-10-30" }),
    ], { "999993": "全球股票指数" }, { "999993": true });
    expect(otherQdii.incomeDate).toBe("2026-11-02");
  });
  it("按基金合并账户，区分已确认市值和在途资金", () => {
    const groups = groupNasdaqHoldings([
      row({ id: 1, symbol: "016452", status: "settled" }),
      row({ id: 2, symbol: "016452", status: "pending", marketValue: null, holdingPnl: null, today: null, cashDebited: 50 }),
      row({ id: 3, symbol: "019441", status: "settled", nav: null, navAsOf: null, marketValue: null, holdingPnl: null, today: null }),
      row({ id: 4, symbol: "GOLD", status: "settled", exposure: "gold" }),
    ], { "016452": "南方纳指" });
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ name: "南方纳指", settledCount: 1, pendingCount: 1, marketValue: 120, pendingCash: 50 });
    expect(summarizeNasdaqHoldings(groups)).toMatchObject({ cost: 200, marketValue: 120, holdingPnl: 20, pendingCash: 50, unvaluedCount: 1 });
  });

  it("展开基金按销售渠道汇总实际持有，在途记录留在对应渠道", () => {
    const channels = groupHoldingChannels([
      row({ id: 1, symbol: "016452", account: "alipay", status: "settled", shares: 10, cost: 100, marketValue: 120, holdingPnl: 20, today: 2 }),
      row({ id: 2, symbol: "016452", account: "alipay", status: "settled", shares: 5, cost: 50, marketValue: 60, holdingPnl: 10, today: 1 }),
      row({ id: 3, symbol: "016452", account: "jd", status: "pending", shares: null, cost: 40, cashDebited: 40, marketValue: null, holdingPnl: null, today: null }),
    ]);
    expect(channels).toHaveLength(2);
    expect(channels[0]).toMatchObject({ account: "alipay", settledPositions: expect.anything(), shares: 15, cost: 150, marketValue: 180, holdingPnl: 30, pendingCash: 0 });
    expect(channels[1]).toMatchObject({ account: "jd", settledPositions: [], pendingPositions: expect.anything(), shares: null, cost: 0, pendingCash: 40 });
  });

  it("持仓单价按已确认成本与总份额加权，待确认和失败记录不参与", () => {
    const [channel] = groupHoldingChannels([
      row({ id: 1, symbol: "016452", status: "settled", cost: 100, shares: 10 }),
      row({ id: 2, symbol: "016452", status: "settled", cost: 100, shares: 5 }),
      row({ id: 3, symbol: "016452", status: "pending", cost: 400, shares: null, cashDebited: 410, marketValue: null }),
      row({ id: 4, symbol: "016452", status: "failed", cost: 900, shares: 900, cashDebited: 900 }),
    ]);
    expect(channel).toMatchObject({ cost: 200, shares: 15, pendingCash: 410 });
    expect(channel.unitCost).toBeCloseTo(200 / 15);
  });

  it("未确认、缺份额或零份额时不显示误导性的持仓单价", () => {
    for (const position of [
      row({ id: 1, symbol: "016452", status: "pending", shares: null }),
      row({ id: 2, symbol: "016452", status: "settled", shares: null }),
      row({ id: 3, symbol: "016452", status: "settled", shares: 0 }),
    ]) expect(groupHoldingChannels([position])[0].unitCost).toBeNull();
  });

  it("只有待确认资金时仍展示已知资产金额，不凭空估值缺失的净值", () => {
    expect(marketValueIncludingPending(null, 40)).toBe(40);
    expect(marketValueIncludingPending(120, 40)).toBe(160);
    expect(marketValueIncludingPending(null, 0)).toBeNull();
    const [channel] = groupHoldingChannels([
      row({ id: 1, symbol: "016452", status: "pending", shares: null, cashDebited: 40, marketValue: null, holdingPnl: null, today: null }),
    ]);
    expect(channel).toMatchObject({ cost: 0, unitCost: null, shares: null, marketValue: null, holdingPnl: null, today: null });
    expect(marketValueIncludingPending(channel.marketValue, channel.pendingCash)).toBe(40);
  });
});


describe("持仓筛选与总览", () => {
  const positions = [
    row({ id: 1, symbol: "016452", account: "alipay", status: "settled", cost: 100, marketValue: 120, holdingPnl: 20, today: 2 }),
    row({ id: 2, symbol: "016452", account: "jd", status: "settled", cost: 200, marketValue: 230, holdingPnl: 30, today: 3 }),
    row({ id: 3, symbol: "016452", account: "jd", status: "pending", shares: null, cost: 40, cashDebited: 40, marketValue: null, holdingPnl: null, today: null }),
    row({ id: 4, symbol: "021778", account: "jd", status: "settled", cost: 300, marketValue: 340, holdingPnl: 40, today: 4 }),
  ];
  const names = { "016452": "南方纳指", "021778": "广发纳指" };
  it("按账户筛选后汇总仅包含该账户的持仓和在途资金", () => {
    const filtered = filterHoldingPositions(positions, names, "", "jd");
    const summary = summarizeNasdaqHoldings(groupNasdaqHoldings(filtered, names));
    expect(summary).toMatchObject({ fundCount: 2, settledCount: 2, cost: 500, marketValue: 570, holdingPnl: 70, today: 7, pendingCash: 40, pendingCount: 1 });
  });
  it("基金名称或代码与账户共同筛选，空结果不会保留旧的汇总", () => {
    const byName = filterHoldingPositions(positions, names, " 南方 ", "jd");
    expect(summarizeNasdaqHoldings(groupNasdaqHoldings(byName, names))).toMatchObject({ fundCount: 1, cost: 200, marketValue: 230, pendingCash: 40 });
    expect(filterHoldingPositions(positions, names, "016452", "jd")).toEqual(byName);
    const empty = summarizeNasdaqHoldings(groupNasdaqHoldings(filterHoldingPositions(positions, names, "不存在", "jd"), names));
    expect(empty).toMatchObject({ fundCount: 0, settledCount: 0, cost: 0, marketValue: null, holdingPnl: null, pendingCash: 0 });
  });
});
