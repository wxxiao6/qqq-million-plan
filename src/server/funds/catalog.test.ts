import { describe, expect, it } from "vitest";
import { classifyFund, loadNasdaqCatalog, parseSearchSnapshot } from "./catalog";

describe("纳斯达克 QDII 目录", () => {
  it("保留已配置目录并正确分类基金", () => {
    expect(classifyFund("123456", "普通纳斯达克公司债券")).toBeNull();
    expect(classifyFund("513290", "纳指生物科技ETF汇添富")).toMatchObject({ theme: "nasdaq_biotech", productType: "etf", venue: "exchange", currency: "CNY" });
    expect(classifyFund("017436", "华宝纳斯达克精选股票发起式(QDII)A")).toMatchObject({ theme: "nasdaq_selected", productType: "active", venue: "otc" });
    expect(() => parseSearchSnapshot("code\tname\n513290\t纳指生物科技ETF汇添富\n513290\t纳指生物科技ETF汇添富")).toThrow("重复基金代码");
    expect(loadNasdaqCatalog()).toHaveLength(88);
  });
});
