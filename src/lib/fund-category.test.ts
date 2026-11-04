import { describe, expect, it } from "vitest";
import { classifyHoldingFund } from "./fund-category";
import { filterHoldingFundScope, groupNasdaqHoldings, summarizeNasdaqHoldings } from "./holdings-dashboard";
import type { PositionDetail } from "@/server/ledger";

describe("fund display categories", () => {
  it.each([
    ["广发上海金ETF联接A", null, false, "gold"],
    ["博时黄金ETF联接C", null, false, "gold"],
    ["易方达黄金主题(QDII-LOF)A", null, false, "gold"],
    ["匿名基金", "黄金基金", false, "gold"],
    ["天弘标普500发起(QDII-FOF)A", null, false, "sp500"],
    ["南方纳斯达克100指数发起A", null, true, "nasdaq"],
    ["南方中证500ETF联接A", null, false, "fund"],
  ] as const)("classifies %s", (name, type, isNasdaq, expected) => {
    expect(classifyHoldingFund(name, type, isNasdaq)).toBe(expected);
  });

  it("partitions existing fund lots and pending cash without changing the portfolio total or QDII dates", () => {
    const names = { "008986": "广发上海金ETF联接A", "002611": "博时黄金ETF联接C", "007721": "天弘标普500发起(QDII-FOF)A", "016452": "南方纳斯达克100指数发起A", "160119": "南方中证500ETF联接A" };
    const positions = Object.keys(names).map((symbol, index): PositionDetail => ({
      id: index + 1, account: "alipay", exposure: symbol === "016452" ? "nasdaq" : "fund", symbol, shares: 10, cost: 100,
      status: "settled", note: null, recordedOn: null, expectedConfirmOn: null, dcaPlanId: null, cashDebited: 100, feeAmount: 0,
      tNav: null, confirmedOn: null, executionOn: null, cutoffPeriod: null, tDate: null, orderOrigin: null, closedOn: null,
      nav: 12, navAsOf: "2026-11-02", marketValue: 120, holdingPnl: 20, today: 2,
    }));
    positions.push({ ...positions.find((row) => row.symbol === "008986")!, id: 99, status: "pending", shares: null, cost: 40, cashDebited: 40, marketValue: null, holdingPnl: null, today: null });
    const before = structuredClone(positions);
    const qdii = { "008986": false, "002611": false, "007721": true, "016452": true, "160119": false };
    const all = summarizeNasdaqHoldings(groupNasdaqHoldings(positions, names, qdii));
    const goldRows = filterHoldingFundScope(positions, names, "gold");
    expect(goldRows.map((row) => row.symbol)).toEqual(["008986", "002611", "008986"]);
    expect(filterHoldingFundScope(positions, names, "fund").map((row) => row.symbol)).toEqual(["160119"]);
    const goldGroups = groupNasdaqHoldings(goldRows, names, qdii);
    expect(goldGroups.every((group) => group.category === "gold" && group.incomeDate === "2026-11-02")).toBe(true);
    expect(summarizeNasdaqHoldings(goldGroups)).toMatchObject({ fundCount: 2, settledCount: 2, pendingCount: 1, marketValue: 240, cost: 200, holdingPnl: 40, pendingCash: 40 });
    const categories = (["nasdaq", "sp500", "gold", "fund"] as const).map((scope) => summarizeNasdaqHoldings(groupNasdaqHoldings(filterHoldingFundScope(positions, names, scope), names, qdii)));
    for (const key of ["marketValue", "cost", "holdingPnl", "pendingCash", "fundCount", "pendingCount"] as const) {
      expect(categories.reduce((sum, item) => sum + (item[key] ?? 0), 0)).toBe(all[key]);
    }
    const [sp500] = groupNasdaqHoldings(filterHoldingFundScope(positions, names, "sp500"), names, qdii);
    expect(sp500.incomeDate).toBe("2026-11-03");
    expect(positions).toEqual(before);
    // Server classification also works when only the fund type identified gold.
    expect(filterHoldingFundScope(positions, {}, "gold", { "008986": "gold", "002611": "gold" })).toHaveLength(3);
  });
});
