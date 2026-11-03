import { describe, expect, it } from "vitest";
import { decimal, estimateFundShares, roundDecimal, roundMoney, sumMoney } from "./decimal";
import { formatMoney, formatNav, formatPercent, formatQty, formatSignedMoney } from "./format";
import { resolveHoldingNumbers } from "./holding-input";
import { lotDayPnl, lotMarketValue } from "./formulas";
import { calculateDcaFee } from "./dca";
import { summarizeDcaAmounts } from "./dca-dashboard";
import { groupHoldingChannels, groupNasdaqHoldings, summarizeNasdaqHoldings } from "./holdings-dashboard";
import { parseMarketShare } from "./market";
import type { PositionDetail } from "@/server/ledger";

describe("统一基金计算精度", () => {
  it.each([[1.005, 1.01], [2.675, 2.68], [-1.005, -1.01], [-2.675, -2.68], [0.0049, 0], [-0.0049, 0]])("金额 %s 按十进制四舍五入为 %s", (input, expected) => {
    expect(roundMoney(input)).toBe(expected);
    expect(Object.is(roundMoney(input), -0)).toBe(false);
  });

  it("019441 总成本 1900 元与 1008.23 份互算不丢失成本", () => {
    const result = resolveHoldingNumbers({ cost: 1900, shares: 1008.23 });
    expect(result).toMatchObject({ ok: true, cost: 1900, shares: 1008.23 });
    if (!result.ok) throw new Error(result.error);
    expect(roundDecimal(result.unitCost, 8)).toBe(1.88449064);
    expect(resolveHoldingNumbers({ shares: result.shares, unitCost: roundDecimal(result.unitCost, 8) })).toMatchObject({ ok: true, cost: 1900 });
    expect(roundMoney(decimal(1805.71).minus(-94.29))).toBe(1900);
  });

  it("保留确认份额和来源净值的额外精度，显示精度不反写原值", () => {
    expect(resolveHoldingNumbers({ shares: 1008.23456789, cost: 1900 })).toMatchObject({ shares: 1008.23456789 });
    expect(formatQty(1008.23456789)).toBe("1,008.23456789");
    expect(formatNav(1.234567)).toBe("1.234567");
    expect(parseMarketShare({ symbol: "008971", shareClass: "C", name: "大成", nav: 1.234567, navDate: "2026-11-02" })?.nav).toBe(1.234567);
  });

  it("小额收益不显示 +0.00 或 -0.00，百分比采用相同舍入规则", () => {
    expect(formatSignedMoney(-0.004)).toBe("¥0.00");
    expect(formatSignedMoney(0.004)).toBe("¥0.00");
    expect(formatMoney(1.005)).toBe("¥1.01");
    expect(formatPercent(-0.004, true)).toBe("0.00%");
    expect(formatPercent(-4.9626315789)).toBe("-4.96%");
  });

  it("申购费用分拆守恒，份额支持四舍五入和截位两种明确口径", () => {
    const fee = calculateDcaFee(1000, "rate", 1.5);
    expect(fee).toBe(14.78);
    expect(roundMoney(decimal(1000).minus(fee))).toBe(985.22);
    expect(estimateFundShares(2.01, 2)).toBe(1.01);
    expect(estimateFundShares(2.01, 2, "truncate")).toBe(1);
    expect(estimateFundShares(985.22, 1.2345)).toBe(798.07);
  });

  it("中间估值和净值差保持精度，在账户汇总时才计到分", () => {
    expect(lotMarketValue(1, 1.005)).toBe(1.005);
    expect(lotDayPnl(1000, 1.12345, 1.12344)).toBe(0.01);
    const row = (id: number, account: string) => ({ id, account, symbol: "019441", exposure: "nasdaq", status: "settled", cost: 1,
      shares: 1, marketValue: 1.005, holdingPnl: 0.005, today: 0.005, nav: 1.005, navAsOf: "2026-11-02" }) as PositionDetail;
    const rows = [row(1, "alipay"), row(2, "alipay"), row(3, "jd")];
    const channels = groupHoldingChannels(rows);
    expect(channels.map((channel) => channel.marketValue)).toEqual([2.01, 1.01]);
    const groups = groupNasdaqHoldings(rows, { "019441": "万家纳指" });
    expect(groups[0]).toMatchObject({ marketValue: 3.02, cost: 3, holdingPnl: 0.02, today: 0.02 });
    expect(summarizeNasdaqHoldings(groups)).toMatchObject({ marketValue: 3.02, cost: 3, holdingPnl: 0.02, today: 0.02 });
  });

  it("大量分金额定投累计保持精确", () => {
    expect(sumMoney(Array(10000).fill(0.01))).toBe(100);
    const records = Array.from({ length: 1000 }, () => ({ planId: 1, executionOn: "2026-11-03", recordedOn: "2026-11-03", cashDebited: 0.01, status: "settled" }));
    expect(summarizeDcaAmounts([], records, "2026-11-03")).toEqual({ daily: 10, monthly: 10, total: 10 });
  });
});
