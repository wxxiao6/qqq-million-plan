import { describe, expect, it } from "vitest";
import { resolveHoldingNumbers } from "./holding-input";

describe("持仓任意两项录入", () => {
  it.each([{ shares: 100, unitCost: 2 }, { cost: 200, unitCost: 2 }, { shares: 100, cost: 200 }])("支持两项计算：%j", (input) => {
    expect(resolveHoldingNumbers(input)).toEqual({ ok: true, shares: 100, cost: 200, unitCost: 2 });
  });
  it("拒绝不足两项、非法数字、零除和三项冲突", () => {
    for (const input of [{ cost: 200 }, {}, { cost: NaN, shares: 100 }, { cost: 200, unitCost: 0 },
      { cost: 0, unitCost: 2 }, { shares: -1, cost: 200 }, { shares: 100, cost: 200, unitCost: 3 }]) {
      expect(resolveHoldingNumbers(input).ok).toBe(false);
    }
  });
  it("接受显示单价的四位小数误差，保留计算份额的小数", () => {
    expect(resolveHoldingNumbers({ shares: 300, cost: 100, unitCost: 0.3333 }).ok).toBe(true);
    expect(resolveHoldingNumbers({ cost: 100, unitCost: 3 })).toMatchObject({ shares: 33.3333, cost: 100 });
    expect(resolveHoldingNumbers({ shares: 100, cost: 0 })).toMatchObject({ ok: true, unitCost: 0 });
  });
});
