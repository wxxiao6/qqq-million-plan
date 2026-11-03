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

  it("基金公司简称与全称合并为一个选项，筛选包含两种来源的持仓", () => {
    const mixedManagers = { "001": " 广发基金 ", "002": "广发基金管理有限公司", "003": "南方基金管理股份有限公司" };
    expect(salesDetails(rows, mixedManagers, "direct")).toEqual(["广发基金", "南方基金"]);
    expect(filterBySalesChannel(rows, mixedManagers, "direct", "广发基金").map((row) => row.id)).toEqual([1, 2]);
    expect(filterBySalesChannel(rows, mixedManagers, "direct", "广发基金管理有限公司").map((row) => row.id)).toEqual([1, 2]);
    expect(filterBySalesChannel(rows, mixedManagers, "direct", "南方基金").map((row) => row.id)).toEqual([5]);
    expect(salesDetails(rows, mixedManagers, "agency")).toEqual(["alipay", "jd"]);
  });

  it("兼容有限责任公司后缀，保留不同公司的名称和未知公司", () => {
    const mixedManagers = { "001": "华夏基金管理有限责任公司", "002": "华泰柏瑞基金管理有限公司", "003": "  " };
    expect(salesDetails(rows, mixedManagers, "direct")).toEqual(expect.arrayContaining(["华夏基金", "华泰柏瑞基金", UNKNOWN_SALES_DETAIL]));
    expect(filterBySalesChannel(rows, mixedManagers, "direct", UNKNOWN_SALES_DETAIL).map((row) => row.id)).toEqual([5]);
  });

  it("大成上海、深圳直销中心与公司名称合并，旧名称筛选也覆盖所有份额", () => {
    const mixedManagers = {
      "001": "大成基金上海投资理财中心",
      "002": " 大成基金深圳投资理财中心 ",
      "003": "大成基金管理有限公司",
      "004": "大成基金",
      "005": "南方基金",
    };
    const directRows = Object.keys(mixedManagers).map((symbol) => ({ symbol, account: null, channelKind: "direct" as const }));
    expect(salesDetails(directRows, mixedManagers, "direct")).toEqual(["大成基金", "南方基金"]);
    for (const name of ["大成基金", "大成基金上海投资理财中心", "大成基金深圳投资理财中心", "大成基金管理有限公司"]) {
      expect(filterBySalesChannel(directRows, mixedManagers, "direct", name).map((row) => row.symbol)).toEqual(["001", "002", "003", "004"]);
    }
    // Agency platforms remain separate from manager aliases.
    const agencyRows = [{ symbol: "001", account: "大成基金上海投资理财中心", channelKind: "agency" as const }];
    expect(salesDetails(agencyRows, mixedManagers, "agency")).toEqual(["大成基金上海投资理财中心"]);
  });
});
