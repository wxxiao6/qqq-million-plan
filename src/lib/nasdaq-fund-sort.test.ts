import { describe, expect, it } from "vitest";
import { groupFundsByManager, sortOtcFundGroups, sortOtcFunds } from "./nasdaq-fund-sort";

const base = {
  agencyStatus: "verified" as const,
  directStatus: "verified" as const,
  agencyTradeStatus: "limited" as const,
  directTradeStatus: null,
  fundTradeStatus: "limited" as const,
  agencyDailyLimit: 10,
  directDailyLimit: null,
  agencyLimitScope: null,
  directLimitScope: null,
  agencyQuoteSourceUrl: null,
  directQuoteSourceUrl: null,
  trackingErrorPct: 1,
};

describe("场外基金排序", () => {
  it("默认按已确认代销额度降序，未知额度和暂停申购排在后面", () => {
    const funds = [
      { ...base, code: "paused", agencyTradeStatus: "paused" as const, fundTradeStatus: "paused" as const },
      { ...base, code: "unknown", agencyStatus: "unverified" as const, agencyDailyLimit: 1000 },
      { ...base, code: "small", agencyDailyLimit: 10 },
      { ...base, code: "open", agencyTradeStatus: "open" as const, agencyDailyLimit: null },
      { ...base, code: "large", agencyDailyLimit: 100 },
    ];
    expect(sortOtcFunds(funds, "agency", "quota").map((fund) => fund.code))
      .toEqual(["large", "small", "open", "unknown", "paused"]);
    expect(sortOtcFunds(funds, "agency", "quota_asc").map((fund) => fund.code))
      .toEqual(["small", "large", "open", "unknown", "paused"]);
  });

  it("跟踪误差支持升降序，缺数据和暂停申购始终靠后", () => {
    const funds = [
      { ...base, code: "paused", agencyTradeStatus: "paused" as const, fundTradeStatus: "paused" as const, trackingErrorPct: 0.1 },
      { ...base, code: "high", trackingErrorPct: 2.1 },
      { ...base, code: "missing", trackingErrorPct: null },
      { ...base, code: "low", trackingErrorPct: 0.8 },
    ];
    expect(sortOtcFunds(funds, "agency", "tracking_asc").map((fund) => fund.code))
      .toEqual(["low", "high", "missing", "paused"]);
    expect(sortOtcFunds(funds, "agency", "tracking_desc").map((fund) => fund.code))
      .toEqual(["high", "low", "missing", "paused"]);
  });

  it("按已排序份额的首个位置排列公司，同公司份额相邻且保留组内顺序", () => {
    const funds = [
      { ...base, code: "wanjia-c", manager: "万家基金", agencyDailyLimit: 10 },
      { ...base, code: "south-a", manager: "南方基金", agencyDailyLimit: 50 },
      { ...base, code: "wanjia-a", manager: "万家基金", agencyDailyLimit: 100 },
      { ...base, code: "south-c", manager: "南方基金", agencyTradeStatus: "paused" as const },
    ];
    const groups = groupFundsByManager(sortOtcFunds(funds, "agency", "quota"), "agency");
    expect(groups.map(({ manager, rows }) => [manager, rows.map((row) => row.code)]))
      .toEqual([
        ["万家基金", ["wanjia-a", "wanjia-c"]],
        ["南方基金", ["south-a"]],
        ["南方基金", ["south-c"]],
      ]);
  });

  it("按公司去重后的额度排序，共用份额额度只计一次，暂停申购仍在末尾", () => {
    const funds = [
      { ...base, code: "a1", manager: "甲基金", agencyDailyLimit: 70 },
      { ...base, code: "a2", manager: "甲基金", agencyDailyLimit: 60 },
      { ...base, code: "b1", manager: "乙基金", agencyDailyLimit: 110 },
      { ...base, code: "c1", manager: "丙基金", agencyDailyLimit: 100,
        agencyLimitScope: "A/C 份额合并", agencyQuoteSourceUrl: "notice-c" },
      { ...base, code: "c2", manager: "丙基金", agencyDailyLimit: 100,
        agencyLimitScope: "A/C 份额合并", agencyQuoteSourceUrl: "notice-c" },
      { ...base, code: "a3", manager: "甲基金", agencyTradeStatus: "paused" as const,
        agencyDailyLimit: 1000 },
    ];
    expect(sortOtcFundGroups(funds, "agency", "quota").map(({ manager, rows }) =>
      [manager, rows.map((row) => row.code)]))
      .toEqual([
        ["甲基金", ["a1", "a2"]],
        ["乙基金", ["b1"]],
        ["丙基金", ["c1", "c2"]],
        ["甲基金", ["a3"]],
      ]);
    expect(sortOtcFundGroups(funds, "agency", "quota_asc").map(({ manager }) => manager))
      .toEqual(["丙基金", "乙基金", "甲基金", "甲基金"]);
  });
});
