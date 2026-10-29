export const ACCOUNT_LABELS = {
  alipay: "支付宝",
  gf_direct: "基金公司",
  cmb: "招行",
  jd: "京东",
  other: "其他",
} as const;

/** 持仓概览纳指明细按购买平台分组。直销不写管理人品牌。 */
export const PLATFORM_LABELS = {
  alipay: "支付宝",
  cmb: "招行",
  jd: "京东",
  gf_direct: "基金公司",
  other: "其他",
} as const;

export const PLATFORM_ORDER = ["alipay", "cmb", "jd", "gf_direct", "other"] as const;

export type AccountKey = keyof typeof ACCOUNT_LABELS;

export const CHANNEL_LABELS = {
  direct: "直销",
  agency: "代销",
} as const;

export type ChannelKind = keyof typeof CHANNEL_LABELS;

export const SUBSCRIBE_LABELS = {
  open: "开放",
  limited: "限额",
  paused: "暂停",
} as const;

export type SubscribeStatus = keyof typeof SUBSCRIBE_LABELS;

export const POSITION_STATUS_LABELS = {
  settled: "已确认",
  pending: "待确认",
} as const;

export const DCA_FREQUENCY_LABELS = {
  daily: "每日",
  weekly: "每周",
  biweekly: "每两周",
  monthly: "每月",
} as const;

export const DCA_STATUS_LABELS = {
  active: "进行中",
  paused: "已暂停",
  ended: "已结束",
} as const;

export const WEEKDAY_LABELS = {
  1: "周一",
  2: "周二",
  3: "周三",
  4: "周四",
  5: "周五",
  6: "周六",
  7: "周日",
} as const;

export type PositionStatus = keyof typeof POSITION_STATUS_LABELS;

export const DCA_ACCOUNT_LABELS = {
  alipay: "支付宝",
  gf_direct: "基金公司",
  cmb: "招行",
  jd: "京东",
} as const;

export const DCA_FEE_KIND_LABELS = {
  rate: "费率 %",
  fixed: "固定金额",
} as const;

export function accountLabel(account: string) {
  return ACCOUNT_LABELS[account as AccountKey] ?? account;
}

export function platformLabel(account: string) {
  return PLATFORM_LABELS[account as keyof typeof PLATFORM_LABELS] ?? accountLabel(account);
}

export function dcaAccountLabel(account: string) {
  return DCA_ACCOUNT_LABELS[account as keyof typeof DCA_ACCOUNT_LABELS]
    ?? accountLabel(account);
}

export function channelLabel(kind: string) {
  return CHANNEL_LABELS[kind as ChannelKind] ?? kind;
}

export function subscribeLabel(status: string) {
  return SUBSCRIBE_LABELS[status as SubscribeStatus] ?? status;
}

export function positionStatusLabel(status: string) {
  return POSITION_STATUS_LABELS[status as PositionStatus] ?? status;
}

export function dcaStatusLabel(status: string) {
  return DCA_STATUS_LABELS[status as keyof typeof DCA_STATUS_LABELS] ?? status;
}

export function formatRatio(ratio: number) {
  return `${ratio.toFixed(1)}x`;
}
