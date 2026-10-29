/** P0 公式。口径见 docs/spec-p0.md 第 6 节，语义不得改。 */

export const MIN_ORDER_DEFAULT = 10;

/** 可买格 = 状态 ≠ 暂停 且 日限额 ≥ 最小下单额。开放且未填限额视为可买。未填状态不可买。 */
export function isBuyableCell(
  status: string | null | undefined,
  dailyLimit: number | null | undefined,
  minOrder = MIN_ORDER_DEFAULT,
): boolean {
  if (status == null || status === "") return false;
  if (status === "paused") return false;
  if (status !== "open" && status !== "limited") return false;
  if (status === "open" && (dailyLimit == null || Number.isNaN(dailyLimit))) {
    return true;
  }
  if (dailyLimit == null || Number.isNaN(dailyLimit)) return false;
  return dailyLimit >= minOrder;
}

/** 用于排序：开放不限额视为无限大。 */
export function buyableLimitScore(
  status: string | null | undefined,
  dailyLimit: number | null | undefined,
  minOrder = MIN_ORDER_DEFAULT,
): number {
  if (!isBuyableCell(status, dailyLimit, minOrder)) return Number.NEGATIVE_INFINITY;
  if (status === "open" && dailyLimit == null) return Number.POSITIVE_INFINITY;
  return dailyLimit ?? Number.NEGATIVE_INFINITY;
}

export function roundShares(value: number): number {
  return Math.round(value * 100) / 100;
}

export function lotMarketValue(
  shares: number | null | undefined,
  nav: number | null | undefined,
): number | null {
  if (shares == null || !Number.isFinite(shares) || nav == null || !Number.isFinite(nav)) {
    return null;
  }
  return shares * nav;
}

/** 缺净值的笔不计入合计，也不当 0。全部缺净值则合计为空。 */
export function sumMarketValue(
  lots: Array<{ shares: number | null | undefined; nav: number | null | undefined }>,
): number | null {
  let sum = 0;
  let any = false;
  for (const lot of lots) {
    const mv = lotMarketValue(lot.shares, lot.nav);
    if (mv == null) continue;
    any = true;
    sum += mv;
  }
  return any ? sum : null;
}

export function holdingGain(
  marketValue: number | null,
  settledCost: number,
): number | null {
  if (marketValue == null) return null;
  return marketValue - settledCost;
}

export function todayEstimate(
  todayMv: number | null,
  priorMv: number | null,
): number | null {
  if (todayMv == null || priorMv == null) return null;
  return todayMv - priorMv;
}

/** 单笔当日：份额 ×（最近净值 − 上一净值日净值）。缺任一则空。 */
export function lotDayPnl(
  shares: number | null | undefined,
  nav: number | null | undefined,
  priorNav: number | null | undefined,
): number | null {
  return todayEstimate(lotMarketValue(shares, nav), lotMarketValue(shares, priorNav));
}

/** 有数的项相加；全部缺失则空，不当 0。 */
export function sumNullable(
  values: Array<number | null | undefined>,
): number | null {
  let sum = 0;
  let any = false;
  for (const value of values) {
    if (value == null || !Number.isFinite(value)) continue;
    any = true;
    sum += value;
  }
  return any ? sum : null;
}
