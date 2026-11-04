import { decimal, roundMoney } from "./decimal";

export type HoldingNumbers = { shares?: number | null; cost?: number | null; unitCost?: number | null };

export type HoldingDraft = {
  amounts: Record<keyof HoldingNumbers, string>;
  preserved?: HoldingNumbers;
};

/** Round derived prices for editing, retaining the authoritative cost and shares. */
export function createHoldingDraft(initial?: { shares: number | null; cost: number }): HoldingDraft {
  return {
    amounts: {
      shares: initial?.shares?.toString() ?? "",
      cost: initial?.cost.toString() ?? "",
      unitCost: initial?.shares && initial.shares > 0
        ? decimal(initial.cost).div(initial.shares).toDecimalPlaces(8).toString() : "",
    },
    preserved: initial && initial.shares != null && initial.shares > 0
      ? { shares: initial.shares, cost: initial.cost } : undefined,
  };
}

export function holdingDraftInput(draft: HoldingDraft, fields: readonly (keyof HoldingNumbers)[]): HoldingNumbers {
  return draft.preserved ?? Object.fromEntries(fields.map((key) => [
    key, draft.amounts[key].trim() === "" ? null : Number(draft.amounts[key]),
  ]));
}

export function editHoldingDraft(draft: HoldingDraft, key: keyof HoldingNumbers, value: string): HoldingDraft {
  return { amounts: { ...draft.amounts, [key]: value } };
}

/** Resolve any two values. A missing value is distinct from an explicit zero. */
export function resolveHoldingNumbers(input: HoldingNumbers):
  { ok: true; shares: number; cost: number; unitCost: number } | { ok: false; error: string } {
  const { shares, cost, unitCost } = input;
  for (const [label, value] of [["持有份额", shares], ["持仓总成本", cost], ["持仓单价", unitCost]] as const) {
    if (value != null && (!Number.isFinite(value) || value < 0)) return { ok: false, error: `${label}须为有效的非负数` };
  }
  if ([shares, cost, unitCost].filter((value) => value != null).length < 2) {
    return { ok: false, error: "请至少填写持仓总成本、持有份额、持仓单价中的两项" };
  }
  if (shares != null && shares <= 0) return { ok: false, error: "持有份额必须大于 0" };
  if (shares == null && (unitCost === 0 || cost === 0)) return { ok: false, error: "无法计算有效份额，请填写持有份额" };
  if (shares != null && cost != null && unitCost != null &&
      decimal(cost).minus(decimal(shares).times(unitCost)).abs().gt(decimal(shares).times("0.00005").plus("0.01"))) {
    return { ok: false, error: "三项数据不一致：持仓总成本应等于持有份额 × 持仓单价，请核对" };
  }
  // Never replace platform-confirmed shares with a value reconstructed from a rounded price.
  const roundedShares = shares ?? decimal(cost!).div(unitCost!).toDecimalPlaces(8).toNumber();
  const roundedCost = roundMoney(cost ?? decimal(roundedShares).times(unitCost!));
  if (!Number.isFinite(roundedShares) || roundedShares <= 0 || !Number.isFinite(roundedCost)) {
    return { ok: false, error: "计算结果超出有效范围，请核对输入" };
  }
  return { ok: true, shares: roundedShares, cost: roundedCost, unitCost: decimal(roundedCost).div(roundedShares).toNumber() };
}
