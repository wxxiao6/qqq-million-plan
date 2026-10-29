import { describe, expect, it } from "vitest";
import { estimatePurchasableQuota, sumVerifiedQuota, type QuotaSummaryRow } from "./nasdaq-quota-summary";

const notice = "http://eid.csrc.gov.cn/fund/disclose/instance_show_pdf_id.do?instanceid=1";

function row(code: string, limit: number, scope: string | null = null): QuotaSummaryRow {
  return {
    code, directStatus: "verified", agencyStatus: "verified",
    directTradeStatus: "limited", agencyTradeStatus: "limited",
    directDailyLimit: limit, agencyDailyLimit: limit,
    directLimitScope: scope, agencyLimitScope: scope,
    directQuoteSourceUrl: notice, agencyQuoteSourceUrl: notice,
  };
}

describe("人民币场外基金渠道额度合计", () => {
  it("同一份额的直销和代销上限不相加，A/C 各自限额仍分别计算", () => {
    const a = row("016452", 10);
    const c = row("016453", 10);
    expect(estimatePurchasableQuota([a])).toEqual({ total: 10, coveredShares: 1, totalShares: 1 });
    expect(estimatePurchasableQuota([a, c]).total).toBe(20);
  });

  it("跨渠道共用的 A/C/I 额度只计一次；仅直销份额也计入", () => {
    const shared = ["019524", "019525", "022664"].map((code) => row(code, 5, "A/C/I 份额合并"));
    const directOnly = { ...row("021000", 200), agencyStatus: "unavailable" as const,
      agencyTradeStatus: null, agencyDailyLimit: null };
    expect(estimatePurchasableQuota([...shared, directOnly]))
      .toEqual({ total: 205, coveredShares: 4, totalShares: 4 });
  });

  it("渠道上限不同时取较高的可用额度，避免未经证实就相加", () => {
    const different = { ...row("000834", 100), agencyDailyLimit: 10 };
    expect(estimatePurchasableQuota([different]).total).toBe(100);
  });

  it("合并份额只计一次，暂停申购计入覆盖但不计入额度", () => {
    const a = row("019441", 100, "A/C 份额合并");
    const c = row("019442", 100, "A/C 份额合并");
    const separate = row("000834", 50);
    const paused = { ...row("016055", 200), directTradeStatus: "paused" as const,
      agencyTradeStatus: "paused" as const };
    const unverified = { ...row("021000", 200), directStatus: "unverified" as const,
      agencyStatus: "unverified" as const };
    expect(sumVerifiedQuota([a, c, separate, paused, unverified], "direct"))
      .toEqual({ total: 150, quotaGroups: 2, coveredShares: 4, totalShares: 5 });
  });

  it("公告确认暂停申购时，即使销售渠道待核验也计入覆盖", () => {
    const paused = { ...row("016055", 200), directStatus: "unverified" as const,
      directTradeStatus: "paused" as const, directDailyLimit: null };
    expect(sumVerifiedQuota([paused], "direct"))
      .toEqual({ total: 0, quotaGroups: 0, coveredShares: 1, totalShares: 1 });
  });

  it("仅直销份额即使留有旧代销暂停记录也不计入代销覆盖", () => {
    const directOnly = { ...row("021000", 200), agencyStatus: "unavailable" as const,
      agencyTradeStatus: "paused" as const };
    expect(sumVerifiedQuota([directOnly], "agency"))
      .toEqual({ total: 0, quotaGroups: 0, coveredShares: 0, totalShares: 1 });
    expect(sumVerifiedQuota([directOnly], "direct"))
      .toEqual({ total: 200, quotaGroups: 1, coveredShares: 1, totalShares: 1 });
  });

  it("同名的合并范围在不同公告中分别计算", () => {
    const first = row("019441", 100, "A/C 份额合并");
    const second = { ...row("019524", 5, "A/C 份额合并"),
      agencyQuoteSourceUrl: `${notice}2` };
    expect(sumVerifiedQuota([first, second], "agency")).toMatchObject({ total: 105, quotaGroups: 2 });
  });

  it("A/C/I 份额共用一组额度，各渠道分别统计", () => {
    const shares = ["019524", "019525", "022664"].map((code) => row(code, 5, "A/C/I 份额合并"));
    expect(sumVerifiedQuota(shares, "direct")).toMatchObject({ total: 5, quotaGroups: 1, coveredShares: 3 });
    expect(sumVerifiedQuota(shares, "agency")).toMatchObject({ total: 5, quotaGroups: 1, coveredShares: 3 });
  });

  it("代销改用天天基金报价后仍按公告共用范围去重", () => {
    const shares = ["019441", "019442"].map((code) => ({
      ...row(code, 100, "A/C 份额合并"),
      agencyQuoteSourceUrl: `https://fund.eastmoney.com/${code}.html`,
      agencyScopeSourceUrl: notice,
    }));
    expect(sumVerifiedQuota(shares, "agency")).toMatchObject({ total: 100, quotaGroups: 1 });
    expect(estimatePurchasableQuota(shares).total).toBe(100);
  });
});
