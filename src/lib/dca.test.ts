import { describe, expect, it } from "vitest";
import {
  advanceDebitDate,
  calculateDcaFee,
  candidatesForChannel,
  dcaChannelWarning,
  dcaFrequencyLabel,
  defaultDcaAccount,
  deriveNextDebitDate,
  formatDcaFee,
  isDcaShareSelectable,
  isLegalDcaAccount,
  isoWeekday,
  normalizeDcaFee,
  resolveDcaAccount,
  validateDcaInput,
  type DcaShareCandidate,
} from "./dca";
import { advanceWeekdays } from "./format";

const TODAY = "2026-08-27"; // 周四

describe("isoWeekday", () => {
  it("周一=1 周日=7", () => {
    expect(isoWeekday("2026-08-24")).toBe(1);
    expect(isoWeekday("2026-08-27")).toBe(4);
    expect(isoWeekday("2026-08-30")).toBe(7);
  });
});

describe("advanceWeekdays", () => {
  it("QDII 预计确认按工作日 T+2 跳过周末", () => {
    expect(advanceWeekdays("2026-08-25", 2)).toBe("2026-08-27");
    expect(advanceWeekdays("2026-08-27", 2)).toBe("2026-08-31");
    expect(advanceWeekdays("2026-08-28", 2)).toBe("2026-09-01");
  });
});

describe("deriveNextDebitDate", () => {
  it("过去的起始日不会因时间流逝被跳过", () => {
    expect(deriveNextDebitDate({ frequency: "daily", startDate: "2026-10-08", today: "2026-10-11" })).toBe("2026-10-08");
    expect(deriveNextDebitDate({ frequency: "daily", startDate: "2026-10-12", today: TODAY })).toBe("2026-10-12");
  });
  it("每日记录逐期推进并跳过周末，保留补录缺口", () => {
    const base = { frequency: "daily" as const, startDate: "2026-10-08" };
    expect(deriveNextDebitDate({ ...base, recordedDates: ["2026-10-08"] })).toBe("2026-10-09");
    expect(deriveNextDebitDate({ ...base, recordedDates: ["2026-10-09"] })).toBe("2026-10-08");
    expect(deriveNextDebitDate({ ...base, recordedDates: ["2026-10-09", "2026-10-08"] })).toBe("2026-10-12");
    expect(deriveNextDebitDate({ ...base, startDate: "2026-10-10" })).toBe("2026-10-12");
  });
  it("周、双周和月计划保持起始日的周期锚点", () => {
    expect(deriveNextDebitDate({ frequency: "weekly", startDate: "2026-08-01", weekday: 3 })).toBe("2026-08-05");
    expect(deriveNextDebitDate({ frequency: "biweekly", startDate: "2026-08-19", weekday: 3, recordedDates: ["2026-08-19"] })).toBe("2026-09-02");
    expect(deriveNextDebitDate({ frequency: "monthly", startDate: "2026-08-11", monthDay: 10 })).toBe("2026-09-10");
    expect(deriveNextDebitDate({ frequency: "monthly", startDate: "2026-08-01", monthDay: 10, recordedDates: ["2026-08-10"] })).toBe("2026-09-10");
  });
});

describe("advanceDebitDate", () => {
  it("从到期日 T 推下一期，不回跳到今天", () => {
    expect(advanceDebitDate({ frequency: "daily", lastDue: "2026-08-08" })).toBe(
      "2026-08-10",
    );
    expect(advanceDebitDate({ frequency: "weekly", lastDue: "2026-08-08" })).toBe(
      "2026-08-15",
    );
    expect(
      advanceDebitDate({ frequency: "monthly", lastDue: "2026-08-08", monthDay: 8 }),
    ).toBe("2026-09-08");
  });
});

describe("validateDcaInput", () => {
  const base = {
    symbol: "016452",
    shareClass: "A",
    channelKind: "direct",
    amount: 1000,
    frequency: "weekly",
    weekday: 3,
    startDate: "2026-08-27",
  };

  it("金额 ≤ 0 或非数字不通过", () => {
    expect(validateDcaInput({ ...base, amount: 0 })).toBe("金额必须大于 0");
    expect(validateDcaInput({ ...base, amount: Number.NaN })).toBe(
      "金额必须大于 0",
    );
  });

  it("每周缺周几不通过", () => {
    expect(validateDcaInput({ ...base, weekday: null })).toBe("请选择周几");
  });

  it("每月缺几号不通过", () => {
    expect(
      validateDcaInput({
        ...base,
        frequency: "monthly",
        weekday: null,
        monthDay: null,
      }),
    ).toBe("请选择几号（1–28）");
  });

  it("合法每周三通过", () => {
    expect(validateDcaInput(base)).toBeNull();
  });

  it("直销不能配支付宝/招行/京东；代销支持支付宝、招行和京东", () => {
    expect(validateDcaInput({ ...base, account: "alipay" })).toBe(
      "渠道与账户不匹配",
    );
    expect(validateDcaInput({ ...base, account: "cmb" })).toBe(
      "渠道与账户不匹配",
    );
    expect(validateDcaInput({ ...base, account: "jd" })).toBe(
      "渠道与账户不匹配",
    );
    expect(
      validateDcaInput({
        ...base,
        channelKind: "agency",
        account: "gf_direct",
      }),
    ).toBe("渠道与账户不匹配");
    expect(
      validateDcaInput({
        ...base,
        channelKind: "agency",
        account: "jd",
      }),
    ).toBeNull();
  });

  it("空账户通过（保存时落到渠道默认）", () => {
    expect(validateDcaInput({ ...base, account: null })).toBeNull();
    expect(
      validateDcaInput({ ...base, channelKind: "agency", account: null }),
    ).toBeNull();
  });

  it("手续费为负不通过；未填通过", () => {
    expect(
      validateDcaInput({ ...base, feeKind: "rate", feeValue: -1 }),
    ).toBe("手续费不能为负");
    expect(validateDcaInput({ ...base, feeKind: "rate", feeValue: 0.15 })).toBeNull();
    expect(validateDcaInput({ ...base, feeKind: null, feeValue: null })).toBeNull();
  });
});

describe("dcaFrequencyLabel / dcaChannelWarning", () => {
  it("每周三 / 每月8日", () => {
    expect(dcaFrequencyLabel("weekly", 3, null)).toBe("每周三");
    expect(dcaFrequencyLabel("monthly", null, 8)).toBe("每月8日");
    expect(dcaFrequencyLabel("daily", null, null)).toBe("每日");
  });

  it("无格 / 暂停", () => {
    expect(dcaChannelWarning(null)).toBe("no_cell");
    expect(dcaChannelWarning("paused")).toBe("paused");
    expect(dcaChannelWarning("open")).toBeNull();
    expect(dcaChannelWarning("limited")).toBeNull();
  });
});

describe("渠道联动候选 / 账户默认 / 手续费", () => {
  const agencyOnly: DcaShareCandidate = {
    symbol: "016452",
    shareClass: "A",
    name: "南方",
    key: "016452:A",
    directStatus: null,
    agencyStatus: "limited",
    agencyDailyLimit: 10,
  };
  const directOnly: DcaShareCandidate = {
    symbol: "015299",
    shareClass: "F",
    name: "华夏",
    key: "015299:A",
    directStatus: "open",
    agencyStatus: null,
  };
  const both: DcaShareCandidate = {
    symbol: "270042",
    shareClass: "I",
    name: "广发",
    key: "270042:A",
    directStatus: "paused",
    agencyStatus: "paused",
  };
  const none: DcaShareCandidate = {
    symbol: "000834",
    shareClass: "A",
    name: "大成",
    key: "000834:A",
    directStatus: null,
    agencyStatus: null,
  };

  it("按所选渠道的额度筛选；同一份额可同时进入直销与代销", () => {
    const all = [agencyOnly, directOnly, both, none];
    const direct = candidatesForChannel(all, "direct");
    const agency = candidatesForChannel(all, "agency");
    expect(direct.map((row) => row.symbol)).toEqual(["015299"]);
    expect(agency.map((row) => row.symbol)).toEqual(["016452"]);
    expect(isDcaShareSelectable(agencyOnly, "direct")).toBe(false);
    expect(isDcaShareSelectable(agencyOnly, "agency")).toBe(true);
    expect(isDcaShareSelectable({ ...agencyOnly, agencyDailyLimit: 0 }, "agency")).toBe(false);
    expect(candidatesForChannel([{ ...agencyOnly, directStatus: "limited", directDailyLimit: 20 }], "direct").map((row) => row.symbol)).toEqual(["016452"]);
  });

  it("代销默认支付宝，直销默认基金公司；切渠道后旧账户不合法", () => {
    expect(defaultDcaAccount("agency")).toBe("alipay");
    expect(defaultDcaAccount("direct")).toBe("gf_direct");
    expect(isLegalDcaAccount("agency", "alipay")).toBe(true);
    expect(isLegalDcaAccount("agency", "cmb")).toBe(true);
    expect(isLegalDcaAccount("agency", "jd")).toBe(true);
    expect(isLegalDcaAccount("agency", "gf_direct")).toBe(false);
    expect(isLegalDcaAccount("direct", "gf_direct")).toBe(true);
    expect(isLegalDcaAccount("direct", "alipay")).toBe(false);
    expect(resolveDcaAccount("agency", null)).toEqual({
      ok: true,
      account: "alipay",
    });
    expect(resolveDcaAccount("direct", "alipay")).toEqual({
      ok: false,
      error: "渠道与账户不匹配",
    });
  });

  it("手续费费率或固定金额可格式化；未填为 null（页面 —）", () => {
    expect(formatDcaFee(null, null)).toBeNull();
    expect(formatDcaFee("rate", 0.15)).toBe("0.15%");
    expect(formatDcaFee("fixed", 5)).toBe("¥5.00");
    expect(normalizeDcaFee("rate", 0.15)).toEqual({
      ok: true,
      feeKind: "rate",
      feeValue: 0.15,
    });
    expect(normalizeDcaFee("none", null)).toEqual({
      ok: true,
      feeKind: null,
      feeValue: null,
    });
    expect(normalizeDcaFee("fixed", -1)).toEqual({
      ok: false,
      error: "手续费不能为负",
    });
  });

  it("手续费从定投总额拆出；按人民币分四舍五入", () => {
    expect(calculateDcaFee(1000, "rate", 0.15)).toBeCloseTo(1.5, 10);
    expect(calculateDcaFee(10, "rate", 0.15)).toBe(0.01);
    expect(calculateDcaFee(1000, "fixed", 5)).toBe(5);
    expect(calculateDcaFee(1000, "rate", 0.15, 8)).toBe(8);
    expect(calculateDcaFee(1000, "rate", 0.15, 2000)).toBe(1000);
  });
});
