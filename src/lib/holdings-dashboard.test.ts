import { describe, expect, it } from "vitest";
import type { PositionDetail } from "@/server/ledger";
import { filterHoldingPositions, groupHoldingChannels, groupNasdaqHoldings, summarizeNasdaqHoldings } from "./holdings-dashboard";

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
  it("组合单日收益显示实际净值日期，不混加不同日期的收益", () => {
    const groups = groupNasdaqHoldings([
      row({ id: 1, symbol: "021778", status: "settled", navAsOf: "2026-10-08", today: 242.18 }),
      row({ id: 2, symbol: "016452", status: "settled", navAsOf: "2026-10-09", today: 10 }),
    ], {});
    expect(summarizeNasdaqHoldings(groups)).toMatchObject({ incomeDate: "2026-10-09", today: 10, incomeFundCount: 1, datedIncomeFundCount: 2 });
    expect(summarizeNasdaqHoldings([])).toMatchObject({ incomeDate: null, today: null });
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
