import { describe, expect, it } from "vitest";
import { filterBySalesChannel, salesDetails, UNKNOWN_SALES_DETAIL } from "./sales-channel-filter";

const managers = { "001": "甲基金", "002": "乙基金" };
const rows = [
  { id: 1, symbol: "001", account: "gf_direct" },
  { id: 2, symbol: "002", account: "gf_direct" },
  { id: 3, symbol: "001", account: "jd" },
  { id: 4, symbol: "002", account: "alipay" },
  { id: 5, symbol: "003", account: "gf_direct" },
];

describe("渠道联动筛选", () => {
  it("直销按基金公司区分，代销按平台区分，未知公司仍可筛选", () => {
    expect(salesDetails(rows, managers, "direct")).toEqual(expect.arrayContaining(["甲基金", "乙基金", UNKNOWN_SALES_DETAIL]));
    expect(salesDetails(rows, managers, "agency")).toEqual(["alipay", "jd"]);
    expect(filterBySalesChannel(rows, managers, "direct", "all").map((row) => row.id)).toEqual([1, 2, 5]);
    expect(filterBySalesChannel(rows, managers, "direct", "甲基金").map((row) => row.id)).toEqual([1]);
    expect(filterBySalesChannel(rows, managers, "direct", UNKNOWN_SALES_DETAIL).map((row) => row.id)).toEqual([5]);
    expect(filterBySalesChannel(rows, managers, "agency", "jd").map((row) => row.id)).toEqual([3]);
    expect(filterBySalesChannel(rows, managers, "all", "all")).toHaveLength(5);
  });
  it("计划使用明确的渠道，即使账户缺失也不会误归类", () => {
    const plans = [{ symbol: "001", account: null, channelKind: "direct" as const }];
    expect(filterBySalesChannel(plans, managers, "direct", "甲基金")).toHaveLength(1);
    expect(filterBySalesChannel(plans, managers, "agency", "all")).toHaveLength(0);
  });
});
