export type HoldingNumbers = { shares?: number | null; cost?: number | null; unitCost?: number | null };

/** Resolve any two values. A missing value is distinct from an explicit zero. */
export function resolveHoldingNumbers(input: HoldingNumbers):
  { ok: true; shares: number; cost: number; unitCost: number } | { ok: false; error: string } {
  const { shares, cost, unitCost } = input;
  for (const [label, value] of [["持有份额", shares], ["持仓总成本", cost], ["持仓成本单价", unitCost]] as const) {
    if (value != null && (!Number.isFinite(value) || value < 0)) return { ok: false, error: `${label}须为有效的非负数` };
  }
  if ([shares, cost, unitCost].filter((value) => value != null).length < 2) {
    return { ok: false, error: "请至少填写持仓总成本、持有份额、持仓成本单价中的两项" };
  }
  if (shares != null && shares <= 0) return { ok: false, error: "持有份额必须大于 0" };
  if (shares == null && (unitCost === 0 || cost === 0)) return { ok: false, error: "无法计算有效份额，请填写持有份额" };
  if (shares != null && cost != null && unitCost != null &&
      Math.abs(cost - shares * unitCost) > 0.01 + shares * 0.00005) {
    return { ok: false, error: "三项数据不一致：持仓总成本应等于持有份额 × 持仓成本单价，请核对" };
  }
  const resolvedShares = shares ?? cost! / unitCost!;
  const resolvedCost = cost ?? resolvedShares * unitCost!;
  const roundedShares = Math.round(resolvedShares * 10000) / 10000;
  const roundedCost = Math.round(resolvedCost * 10000) / 10000;
  if (!Number.isFinite(roundedShares) || roundedShares <= 0 || !Number.isFinite(roundedCost)) {
    return { ok: false, error: "计算结果超出有效范围，请核对输入" };
  }
  return { ok: true, shares: roundedShares, cost: roundedCost, unitCost: roundedCost / roundedShares };
}
