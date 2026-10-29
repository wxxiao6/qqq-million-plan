import { describe, expect, it } from "vitest";
import {
  buyableLimitScore,
  holdingGain,
  isBuyableCell,
  lotDayPnl,
  lotMarketValue,
  sumMarketValue,
  sumNullable,
  todayEstimate,
} from "./formulas";

describe("isBuyableCell", () => {
  it("暂停不可买", () => {
    expect(isBuyableCell("paused", 100)).toBe(false);
  });

  it("未填状态不可买", () => {
    expect(isBuyableCell(null, 100)).toBe(false);
    expect(isBuyableCell("", 10)).toBe(false);
  });

  it("开放且未填限额视为可买", () => {
    expect(isBuyableCell("open", null)).toBe(true);
  });

  it("开放但限额低于最小下单额不可买", () => {
    expect(isBuyableCell("open", 5, 10)).toBe(false);
  });

  it("限额达到最小下单额可买", () => {
    expect(isBuyableCell("limited", 10, 10)).toBe(true);
  });

  it("null 份额不进市值", () => {
    expect(lotMarketValue(null, 1.01)).toBeNull();
    expect(lotMarketValue(100, 1.01)).toBeCloseTo(101);
  });

  it("限额状态未填日限额不可买", () => {
    expect(isBuyableCell("limited", null)).toBe(false);
  });
});

describe("buyableLimitScore", () => {
  it("开放不限额排在有限额之前", () => {
    expect(buyableLimitScore("open", null)).toBe(Number.POSITIVE_INFINITY);
    expect(buyableLimitScore("limited", 100)).toBe(100);
  });
});

describe("market value", () => {
  it("缺净值则该笔市值为空", () => {
    expect(lotMarketValue(100, null)).toBeNull();
  });

  it("合计跳过缺净值的笔，不当 0", () => {
    expect(
      sumMarketValue([
        { shares: 10, nav: 2 },
        { shares: 5, nav: null },
      ]),
    ).toBe(20);
  });

  it("全部缺净值则合计为空", () => {
    expect(sumMarketValue([{ shares: 10, nav: null }])).toBeNull();
  });

  it("sumNullable 跳过空值，全空则空", () => {
    expect(sumNullable([1000, null, 200])).toBe(1200);
    expect(sumNullable([null, undefined])).toBeNull();
  });
});

describe("holdingGain / todayEstimate / netWorth", () => {
  it("持有收益 = 动态市值 − 已确认成本", () => {
    expect(holdingGain(120, 100)).toBe(20);
    expect(holdingGain(null, 100)).toBeNull();
  });

  it("无昨日快照则今日估算为空", () => {
    expect(todayEstimate(120, null)).toBeNull();
    expect(todayEstimate(120, 100)).toBe(20);
  });

  it("单笔当日 = 份额 × 净值差；缺上一净值则空", () => {
    expect(lotDayPnl(100, 10, 9)).toBe(100);
    expect(lotDayPnl(100, 10, null)).toBeNull();
    expect(lotDayPnl(null, 10, 9)).toBeNull();
  });

});
