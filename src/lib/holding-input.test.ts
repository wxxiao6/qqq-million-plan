import { describe, expect, it } from "vitest";
import { createHoldingDraft, editHoldingDraft, holdingDraftInput, resolveHoldingNumbers } from "./holding-input";

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
    expect(resolveHoldingNumbers({ cost: 100, unitCost: 3 })).toMatchObject({ shares: 33.33333333, cost: 100 });
    expect(resolveHoldingNumbers({ shares: 100, cost: 0 })).toMatchObject({ ok: true, unitCost: 0 });
  });
});

describe("持仓编辑回填", () => {
  const modes = [["unitCost", "shares"], ["cost", "shares"], ["cost", "unitCost"]] as const;
  it("反算单价最多显示八位，原始成本与份额用于保存", () => {
    const draft = createHoldingDraft({ cost: 170, shares: 73.86 });
    expect(draft.amounts).toEqual({ cost: "170", shares: "73.86", unitCost: "2.30165177" });
    for (const mode of modes) expect(holdingDraftInput(draft, mode)).toEqual({ cost: 170, shares: 73.86 });
  });
  it("切换录入方式不会用舍入单价覆盖大额成本或高精度确认份额", () => {
    const original = { cost: 1234567.89, shares: 987654321.123456 };
    let draft = createHoldingDraft(original);
    for (const mode of [...modes, ...modes]) {
      const resolved = resolveHoldingNumbers(holdingDraftInput(draft, mode));
      expect(resolved).toMatchObject({ ok: true, ...original });
      if (!resolved.ok) throw new Error(resolved.error);
      draft = createHoldingDraft(resolved);
    }
  });
  it("用户实际修改金额后，使用输入值重新计算，不保留旧成本", () => {
    const draft = editHoldingDraft(createHoldingDraft({ cost: 170, shares: 73.86 }), "unitCost", "3.123456789");
    expect(draft.amounts.unitCost).toBe("3.123456789");
    expect(holdingDraftInput(draft, modes[0])).toEqual({ unitCost: 3.123456789, shares: 73.86 });
    expect(resolveHoldingNumbers(holdingDraftInput(draft, modes[0]))).toMatchObject({ ok: true, cost: 230.7 });
  });
  it("新增表单、零成本和清空输入仍遵守原有校验", () => {
    expect(holdingDraftInput(createHoldingDraft(), modes[0])).toEqual({ unitCost: null, shares: null });
    const zero = createHoldingDraft({ cost: 0, shares: 10 });
    expect(zero.amounts.unitCost).toBe("0");
    expect(resolveHoldingNumbers(holdingDraftInput(zero, modes[0]))).toMatchObject({ ok: true, cost: 0, shares: 10 });
    expect(resolveHoldingNumbers(holdingDraftInput(editHoldingDraft(zero, "shares", ""), modes[0])).ok).toBe(false);
  });
});
