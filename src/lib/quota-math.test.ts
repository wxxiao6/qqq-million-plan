import { describe, expect, it } from "vitest";
import { MIN_ORDER_DEFAULT } from "./formulas";
import {
  cellInvestable,
  cellRemaining,
  collapseScopes,
  compareQuotaDetailRows,
  coverageOf,
  defaultQuotaScope,
  quotaResultLabel,
  remainingSortScore,
  resolveQuotaScope,
  sumQuotaAmounts,
  type QuotaAmount,
  type QuotaScopeCell,
  type SortableQuotaRow,
} from "./quota-math";

function amount(value: number): QuotaAmount {
  return { kind: "amount", value };
}

describe("cellInvestable", () => {
  it("暂停为 0", () => {
    expect(cellInvestable("paused", 100)).toEqual(amount(0));
    expect(cellInvestable("paused", null)).toEqual(amount(0));
  });

  it("限额且日限额有效 → 日限额", () => {
    expect(cellInvestable("limited", 500)).toEqual(amount(500));
  });

  it("限额但日限额无效 → 未知", () => {
    expect(cellInvestable("limited", null)).toEqual({ kind: "unknown" });
    expect(cellInvestable("limited", Number.NaN)).toEqual({ kind: "unknown" });
    expect(cellInvestable("limited", -1)).toEqual({ kind: "unknown" });
  });

  it("开放且有日限额 → 日限额", () => {
    expect(cellInvestable("open", 200)).toEqual(amount(200));
  });

  it("开放且没有日限额 → 不限额", () => {
    expect(cellInvestable("open", null)).toEqual({ kind: "unlimited" });
  });

  it("未知或无效 → 未知", () => {
    expect(cellInvestable(null, 100)).toEqual({ kind: "unknown" });
    expect(cellInvestable("", 100)).toEqual({ kind: "unknown" });
    expect(cellInvestable("unknown", 100)).toEqual({ kind: "unknown" });
    expect(cellInvestable("weird", 100)).toEqual({ kind: "unknown" });
  });
});

describe("cellRemaining", () => {
  it("有限额度 = max(可投 − 今日已购买, 0)", () => {
    expect(cellRemaining(amount(500), 120)).toEqual(amount(380));
    expect(cellRemaining(amount(100), 200)).toEqual(amount(0));
  });

  it("已购买按 0 时剩余等于可投", () => {
    expect(cellRemaining(amount(500), 0)).toEqual(amount(500));
    expect(cellRemaining({ kind: "unlimited" }, 0)).toEqual({ kind: "unlimited" });
    expect(cellRemaining(amount(0), 0)).toEqual(amount(0));
  });

  it("不限额保持不限额", () => {
    expect(cellRemaining({ kind: "unlimited" }, 999)).toEqual({
      kind: "unlimited",
    });
  });

  it("暂停为 0", () => {
    expect(cellRemaining(cellInvestable("paused", null), 0)).toEqual(amount(0));
  });

  it("未知保持未知", () => {
    expect(cellRemaining({ kind: "unknown" }, 0)).toEqual({ kind: "unknown" });
  });
});

describe("sumQuotaAmounts / coverage", () => {
  it("任一不限额则汇总为不限额", () => {
    expect(
      sumQuotaAmounts([amount(500), { kind: "unlimited" }, amount(0)]),
    ).toEqual({ kind: "unlimited" });
  });

  it("未知不按 0 计入合计", () => {
    expect(sumQuotaAmounts([amount(500), { kind: "unknown" }])).toEqual(
      amount(500),
    );
    expect(sumQuotaAmounts([{ kind: "unknown" }, { kind: "unknown" }])).toEqual({
      kind: "unknown",
    });
  });

  it("全部暂停合计为 0", () => {
    expect(sumQuotaAmounts([amount(0), amount(0)])).toEqual(amount(0));
  });

  it("覆盖数为非未知作用域数", () => {
    expect(
      coverageOf([amount(500), amount(0), { kind: "unknown" }, { kind: "unlimited" }]),
    ).toEqual({ covered: 3, total: 4 });
  });
});

describe("collapseScopes", () => {
  it("默认基金代码+份额+渠道为独立作用域", () => {
    const cells: QuotaScopeCell[] = [
      {
        scopeId: defaultQuotaScope("016452", "A", "agency"),
        symbol: "016452",
        shareClass: "A",
        channelKind: "agency",
        investable: amount(500),
        purchased: 0,
      },
      {
        scopeId: defaultQuotaScope("016452", "A", "direct"),
        symbol: "016452",
        shareClass: "A",
        channelKind: "direct",
        investable: amount(200),
        purchased: 0,
      },
    ];
    const scopes = collapseScopes(cells);
    expect(scopes).toHaveLength(2);
    expect(sumQuotaAmounts(scopes.map((scope) => scope.investable))).toEqual(
      amount(700),
    );
  });

  it("同基金多份额共享时汇总只计一次", () => {
    const cells: QuotaScopeCell[] = [
      {
        scopeId: "015299:AC:agency",
        symbol: "015299",
        shareClass: "A",
        channelKind: "agency",
        investable: amount(1000),
        purchased: 0,
      },
      {
        scopeId: "015299:AC:agency",
        symbol: "015300",
        shareClass: "C",
        channelKind: "agency",
        investable: amount(1000),
        purchased: 0,
      },
    ];
    const scopes = collapseScopes(cells);
    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.investable).toEqual(amount(1000));
    expect(scopes[0]?.shareTag).toBe("shared");
    expect(sumQuotaAmounts(scopes.map((scope) => scope.investable))).toEqual(
      amount(1000),
    );
  });

  it("直销代销共享时总计只计一次", () => {
    const cells: QuotaScopeCell[] = [
      {
        scopeId: "016452:A:all",
        symbol: "016452",
        shareClass: "A",
        channelKind: "direct",
        investable: amount(300),
        purchased: 0,
      },
      {
        scopeId: "016452:A:all",
        symbol: "016452",
        shareClass: "A",
        channelKind: "agency",
        investable: amount(300),
        purchased: 0,
      },
    ];
    const scopes = collapseScopes(cells);
    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.shareTag).toBe("all-channel");
    expect(scopes[0]?.channels).toEqual(["agency", "direct"]);
    expect(sumQuotaAmounts(scopes.map((scope) => scope.remaining))).toEqual(
      amount(300),
    );
  });

  it("共享金额冲突视为未知，不得重复累计", () => {
    const cells: QuotaScopeCell[] = [
      {
        scopeId: "016452:A:all",
        symbol: "016452",
        shareClass: "A",
        channelKind: "direct",
        investable: amount(300),
        purchased: 0,
      },
      {
        scopeId: "016452:A:all",
        symbol: "016452",
        shareClass: "A",
        channelKind: "agency",
        investable: amount(100),
        purchased: 0,
      },
    ];
    const scopes = collapseScopes(cells);
    expect(scopes[0]?.investable).toEqual({ kind: "unknown" });
    expect(sumQuotaAmounts(scopes.map((scope) => scope.investable))).toEqual({
      kind: "unknown",
    });
  });
});

describe("compareQuotaDetailRows", () => {
  function row(
    symbol: string,
    remaining: QuotaAmount,
    allPaused = false,
    shareClass = "A",
  ): SortableQuotaRow {
    return { symbol, shareClass, remaining, allPaused };
  }

  it("有剩余置顶，不限额高于有限额，暂停沉底，同级代码升序", () => {
    const rows = [
      row("270042", amount(0), true),
      row("000834", { kind: "unknown" }),
      row("016452", amount(500)),
      row("015299", { kind: "unlimited" }),
      row("040046", amount(200)),
      row("015300", amount(200)),
    ];
    rows.sort(compareQuotaDetailRows);
    expect(rows.map((item) => item.symbol)).toEqual([
      "015299",
      "016452",
      "015300",
      "040046",
      "000834",
      "270042",
    ]);
  });

  it("不限额排序分高于有限额", () => {
    expect(remainingSortScore({ kind: "unlimited" })).toBeGreaterThan(
      remainingSortScore(amount(9999)),
    );
  });
});

describe("quotaResultLabel", () => {
  it("全部未知 → 额度待更新", () => {
    expect(
      quotaResultLabel({
        scopeInvestables: [{ kind: "unknown" }, { kind: "unknown" }],
        remaining: { kind: "unknown" },
      }),
    ).toBe("额度待更新");
  });

  it("剩余达到最小下单额或存在不限额 → 有可买额度", () => {
    expect(
      quotaResultLabel({
        scopeInvestables: [amount(500)],
        remaining: amount(500),
        minOrder: MIN_ORDER_DEFAULT,
      }),
    ).toBe("有可买额度");
    expect(
      quotaResultLabel({
        scopeInvestables: [{ kind: "unlimited" }],
        remaining: { kind: "unlimited" },
      }),
    ).toBe("有可买额度");
  });

  it("全部暂停 → 今日无可买额度", () => {
    expect(
      quotaResultLabel({
        scopeInvestables: [amount(0), amount(0)],
        remaining: amount(0),
      }),
    ).toBe("今日无可买额度");
  });
});

describe("resolveQuotaScope", () => {
  it("缺省时用基金代码+份额+渠道", () => {
    expect(resolveQuotaScope("016452", "A", "agency", null)).toBe("016452:A:agency");
    expect(resolveQuotaScope("016452", "A", "agency", "  ")).toBe("016452:A:agency");
    expect(resolveQuotaScope("016452", "A", "agency", "shared-1")).toBe("shared-1");
  });
});
