export const FUND_THEME_LABELS = {
  nasdaq_100: "纳指 100",
  sp500: "标普 500",
  gold: "黄金",
  nasdaq_biotech: "纳指生物科技",
  nasdaq_technology: "纳斯达克科技",
  nasdaq_selected: "纳斯达克精选",
} as const;

export type FundTheme = keyof typeof FUND_THEME_LABELS;
