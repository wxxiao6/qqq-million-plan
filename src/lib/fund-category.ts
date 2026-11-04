import { FUND_THEME_LABELS } from "./fund-theme";

export const HOLDING_FUND_LABELS = {
  nasdaq: "纳指基金",
  sp500: FUND_THEME_LABELS.sp500,
  gold: FUND_THEME_LABELS.gold,
  fund: "其他基金",
} as const;
export type HoldingFundCategory = keyof typeof HOLDING_FUND_LABELS;
export type HoldingFundScope = "all" | HoldingFundCategory;

export const HOLDING_FUND_SCOPES: { value: HoldingFundScope; label: string }[] = [
  { value: "all", label: "全部基金" },
  { value: "nasdaq", label: "纳指基金" },
  { value: "sp500", label: "标普 500 基金" },
  { value: "gold", label: "黄金基金" },
  { value: "fund", label: "其他基金" },
];

/** Display category only; ledger exposure and QDII rules stay independent. */
export function classifyHoldingFund(name: string, fundType: string | null = null, isNasdaq = false): HoldingFundCategory {
  const identity = `${name} ${fundType ?? ""}`;
  if (/黄金|上海金/.test(identity)) return "gold";
  if (/标普\s*500|S&P\s*500/i.test(identity)) return "sp500";
  if (isNasdaq || /纳斯达克|纳指/.test(identity)) return "nasdaq";
  return "fund";
}
