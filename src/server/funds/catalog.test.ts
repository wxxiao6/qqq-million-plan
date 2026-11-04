import { describe, expect, it } from "vitest";
import { classifyFund, loadNasdaqCatalog, parseSearchSnapshot } from "./catalog";

describe("纳斯达克 QDII 目录", () => {
  it("保留已配置目录并正确分类基金", () => {
    expect(classifyFund("123456", "普通纳斯达克公司债券")).toBeNull();
    expect(classifyFund("513290", "纳指生物科技ETF汇添富")).toMatchObject({ theme: "nasdaq_biotech", productType: "etf", venue: "exchange", currency: "CNY" });
    expect(classifyFund("017436", "华宝纳斯达克精选股票发起式(QDII)A")).toMatchObject({ theme: "nasdaq_selected", productType: "active", venue: "otc" });
    expect(() => parseSearchSnapshot("code\tname\n513290\t纳指生物科技ETF汇添富\n513290\t纳指生物科技ETF汇添富")).toThrow("重复基金代码");
    expect(loadNasdaqCatalog()).toHaveLength(90);
  });

  it("adds S&P 500 A/C shares without reclassifying the existing Nasdaq share", () => {
    const funds = loadNasdaqCatalog();
    expect(funds.filter((fund) => fund.theme === "sp500").map(({ code, shareClass, currency }) => ({ code, shareClass, currency }))).toEqual([
      { code: "007721", shareClass: "A", currency: "CNY" },
      { code: "007722", shareClass: "C", currency: "CNY" },
    ]);
    expect(classifyFund("007721", "天弘标普500发起(QDII-FOF)A")).toMatchObject({ theme: "sp500", manager: "天弘基金", productType: "index", venue: "otc" });
    expect(funds.find((fund) => fund.code === "018044")?.theme).toBe("nasdaq_100");
  });

  it("recognizes gold and Shanghai Gold funds as a distinct theme", () => {
    expect(classifyFund("008986", "广发上海金ETF联接A")).toMatchObject({ theme: "gold", productType: "etf_feeder", manager: "广发基金" });
    expect(classifyFund("002611", "博时黄金ETF联接C")).toMatchObject({ theme: "gold", productType: "etf_feeder" });
  });
});
