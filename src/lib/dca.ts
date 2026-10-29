/** 纳指定投频率与校验。口径见 docs/spec-dca.md。 */

import { formatMoney, isISODate, shiftISO } from "@/lib/format";

export type DcaFrequency = "daily" | "weekly" | "biweekly" | "monthly";
export type DcaPlanStatus = "active" | "paused" | "ended";
export type DcaChannelKind = "direct" | "agency";
export type DcaShareClass = "A" | "C" | "D" | "E" | "I" | "F";
export type DcaChannelWarning = "paused" | "no_cell";
export type DcaAccount = "alipay" | "gf_direct" | "cmb" | "jd";
export type DcaFeeKind = "rate" | "fixed";
export type DcaExecutionStatus = "not_bought" | "bought_before_cutoff" | "bought_after_cutoff";

/** 代销账户：支付宝（默认）/ 招行 / 京东。 */
export const DCA_AGENCY_ACCOUNTS: readonly DcaAccount[] = ["alipay", "cmb", "jd"];
/** 直销账户：基金公司（账本 gf_direct）。 */
export const DCA_DIRECT_ACCOUNTS: readonly DcaAccount[] = ["gf_direct"];

export const DCA_FREQUENCIES: DcaFrequency[] = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
];

export const DCA_SHARE_CLASSES: DcaShareClass[] = ["A", "C", "D", "E", "I", "F"];

/** 周一 = 1 … 周日 = 7。 */
export const WEEKDAY_CN = ["", "一", "二", "三", "四", "五", "六", "日"] as const;

export type DcaInput = {
  symbol: string;
  shareClass: string;
  channelKind: string;
  account?: string | null;
  amount: number;
  investedTotal?: number;
  fundInvestedTotal?: number;
  feeKind?: string | null;
  feeValue?: number | null;
  frequency: string;
  weekday?: number | null;
  monthDay?: number | null;
  startDate: string;
  nextDebitDate?: string | null;
  note?: string | null;
  execution?: DcaExecutionInput | null;
  cutoffPeriod?: "before_15" | "after_15";
};

export type DcaExecutionInput = {
  status: DcaExecutionStatus;
  executionDate?: string | null;
  tDate?: string | null;
  actualCashDebited?: number | null;
  actualFeeAmount?: number | null;
};

export type DcaShareCandidate = {
  symbol: string;
  shareClass: DcaShareClass;
  name: string;
  key: string;
  directStatus: string | null;
  agencyStatus: string | null;
  directDailyLimit?: number | null;
  agencyDailyLimit?: number | null;
};

export type DcaPlanView = {
  id: number;
  exposure: "nasdaq";
  symbol: string;
  shareClass: DcaShareClass;
  name: string | null;
  channelKind: DcaChannelKind;
  account: string | null;
  amount: number;
  investedTotal: number;
  fundInvestedTotal: number;
  feeKind: DcaFeeKind | null;
  feeValue: number | null;
  frequency: DcaFrequency;
  weekday: number | null;
  monthDay: number | null;
  startDate: string;
  nextDebitDate: string | null;
  cutoffPeriod?: "before_15" | "after_15";
  dueToday: boolean;
  status: DcaPlanStatus;
  note: string | null;
  frequencyLabel: string;
  channelWarning: DcaChannelWarning | null;
};

export type DcaBoard = {
  plans: DcaPlanView[];
  candidates: DcaShareCandidate[];
  activeCount: number;
  totalInvested: number;
  emptyUniverse: boolean;
};

export function isoWeekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const js = new Date(y, m - 1, d).getDay();
  return js === 0 ? 7 : js;
}

export function nextOnOrAfterWeekday(from: string, weekday: number): string {
  const current = isoWeekday(from);
  const delta = (weekday - current + 7) % 7;
  return shiftISO(from, delta);
}

function nextMonthlyOnOrAfter(from: string, monthDay: number): string {
  const [y, m, d] = from.split("-").map(Number);
  if (d <= monthDay) {
    return `${y}-${String(m).padStart(2, "0")}-${String(monthDay).padStart(2, "0")}`;
  }
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(monthDay).padStart(2, "0")}`;
}

/** 从起始日保留最早未记录的一期；时间流逝不会视为已经扣款。 */
export function deriveNextDebitDate(input: {
  frequency: DcaFrequency;
  startDate: string;
  weekday?: number | null;
  monthDay?: number | null;
  recordedDates?: readonly string[];
  accountedThrough?: string | null;
  today?: string;
}): string {
  let cursor = input.frequency === "daily"
    ? nextWeekday(input.startDate)
    : input.frequency === "monthly"
      ? nextMonthlyOnOrAfter(input.startDate, input.monthDay ?? 1)
      : nextOnOrAfterWeekday(input.startDate, input.weekday ?? 1);
  const recorded = new Set(input.recordedDates ?? []);
  while (recorded.has(cursor) || (input.accountedThrough != null && cursor <= input.accountedThrough)) {
    cursor = advanceDebitDate({ frequency: input.frequency, lastDue: cursor, monthDay: input.monthDay });
  }
  return cursor;
}

/** 目前只排除周末；基金节假日须按实际扣款记录处理。 */
function nextWeekday(date: string): string {
  const day = isoWeekday(date);
  return day === 6 ? shiftISO(date, 2) : day === 7 ? shiftISO(date, 1) : date;
}

export function defaultDcaAccount(channelKind: DcaChannelKind): DcaAccount {
  return channelKind === "direct" ? "gf_direct" : "alipay";
}

export function accountsForChannel(
  channelKind: DcaChannelKind,
): readonly DcaAccount[] {
  return channelKind === "direct" ? DCA_DIRECT_ACCOUNTS : DCA_AGENCY_ACCOUNTS;
}

export function isLegalDcaAccount(
  channelKind: DcaChannelKind,
  account: string | null | undefined,
): boolean {
  if (!account) return false;
  return accountsForChannel(channelKind).includes(account as DcaAccount);
}

/** 空账户落到渠道默认；非法组合报错。 */
export function resolveDcaAccount(
  channelKind: DcaChannelKind,
  account?: string | null,
): { ok: true; account: DcaAccount } | { ok: false; error: string } {
  if (!account || account === "none") {
    return { ok: true, account: defaultDcaAccount(channelKind) };
  }
  if (!isLegalDcaAccount(channelKind, account)) {
    return { ok: false, error: "渠道与账户不匹配" };
  }
  return { ok: true, account: account as DcaAccount };
}

/** 新建计划按该份额在所选渠道的实际状态与额度筛选。 */
export function isDcaShareSelectable(
  row: DcaShareCandidate,
  channelKind: DcaChannelKind,
): boolean {
  const status = channelKind === "direct" ? row.directStatus : row.agencyStatus;
  const limit = channelKind === "direct" ? row.directDailyLimit : row.agencyDailyLimit;
  return status === "open" || (status === "limited" && limit != null && Number.isFinite(limit) && limit > 0);
}

export function candidatesForChannel(
  candidates: DcaShareCandidate[],
  channelKind: DcaChannelKind,
): DcaShareCandidate[] {
  return candidates.filter((row) => isDcaShareSelectable(row, channelKind));
}

export function normalizeDcaFee(
  feeKind?: string | null,
  feeValue?: number | null,
):
  | { ok: true; feeKind: DcaFeeKind | null; feeValue: number | null }
  | { ok: false; error: string } {
  const kind = feeKind === "rate" || feeKind === "fixed" ? feeKind : null;
  const hasValue = feeValue != null && Number.isFinite(feeValue);
  if (kind == null) {
    if (!hasValue) return { ok: true, feeKind: null, feeValue: null };
    return { ok: false, error: "请选择手续费类型" };
  }
  if (!hasValue) return { ok: true, feeKind: null, feeValue: null };
  if (feeValue < 0) return { ok: false, error: "手续费不能为负" };
  return { ok: true, feeKind: kind, feeValue };
}

/** 金额按人民币分四舍五入；定投金额是实际扣款总额，手续费从中拆出。 */
export function calculateDcaFee(
  grossAmount: number,
  feeKind: DcaFeeKind | null | undefined,
  feeValue: number | null | undefined,
  actualFeeAmount?: number | null,
): number {
  if (actualFeeAmount != null && Number.isFinite(actualFeeAmount)) {
    return roundDcaMoney(Math.max(0, Math.min(grossAmount, actualFeeAmount)));
  }
  if (feeKind === "rate" && feeValue != null && Number.isFinite(feeValue)) {
    const rate = Math.max(0, feeValue) / 100;
    const netAmount = grossAmount / (1 + rate);
    return roundDcaMoney(Math.min(grossAmount, Math.max(0, grossAmount - netAmount)));
  }
  if (feeKind === "fixed" && feeValue != null && Number.isFinite(feeValue)) {
    return roundDcaMoney(Math.min(grossAmount, Math.max(0, feeValue)));
  }
  return 0;
}

export function roundDcaMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** 未填返回 null，页面写成「—」。 */
export function formatDcaFee(
  feeKind: DcaFeeKind | null | undefined,
  feeValue: number | null | undefined,
): string | null {
  if (feeKind == null || feeValue == null || !Number.isFinite(feeValue)) {
    return null;
  }
  if (feeKind === "rate") return `${feeValue}%`;
  return formatMoney(feeValue);
}

export function validateDcaInput(input: DcaInput): string | null {
  if (input.cutoffPeriod && !["before_15", "after_15"].includes(input.cutoffPeriod)) return "请选择 15:00 前或后";
  const symbol = input.symbol.trim();
  if (!symbol) return "基金代码不能为空";
  if (!DCA_SHARE_CLASSES.includes(input.shareClass as DcaShareClass)) {
    return "份额类别不合法";
  }
  if (input.channelKind !== "direct" && input.channelKind !== "agency") {
    return "渠道不合法";
  }
  const account = resolveDcaAccount(
    input.channelKind,
    input.account,
  );
  if (!account.ok) return account.error;
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return "金额必须大于 0";
  }
  const fee = normalizeDcaFee(input.feeKind, input.feeValue);
  if (!fee.ok) return fee.error;
  if (roundDcaMoney(input.amount - calculateDcaFee(input.amount, fee.feeKind, fee.feeValue)) <= 0) return "手续费不能大于等于定投金额";
  if (!DCA_FREQUENCIES.includes(input.frequency as DcaFrequency)) {
    return "频率不合法";
  }
  const frequency = input.frequency as DcaFrequency;
  if (frequency === "weekly" || frequency === "biweekly") {
    const weekday = input.weekday;
    if (weekday == null || weekday < 1 || weekday > 7) {
      return "请选择周几";
    }
  }
  if (frequency === "monthly") {
    const monthDay = input.monthDay;
    if (monthDay == null || monthDay < 1 || monthDay > 28) {
      return "请选择几号（1–28）";
    }
  }
  if (!isISODate(input.startDate)) return "起始日格式须为 YYYY-MM-DD";
  if (input.nextDebitDate && !isISODate(input.nextDebitDate)) {
    return "下次扣款日格式须为 YYYY-MM-DD";
  }
  return null;
}

/** 过账成功后从到期日 T 推下一期，不按「今天」回跳。 */
export function advanceDebitDate(input: {
  frequency: DcaFrequency;
  lastDue: string;
  monthDay?: number | null;
}): string {
  if (input.frequency === "daily") return nextWeekday(shiftISO(input.lastDue, 1));
  if (input.frequency === "weekly") return shiftISO(input.lastDue, 7);
  if (input.frequency === "biweekly") return shiftISO(input.lastDue, 14);
  const monthDay = input.monthDay ?? 1;
  const [y, m] = input.lastDue.split("-").map(Number);
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(monthDay).padStart(2, "0")}`;
}

export const DCA_POST_NOTE_PREFIX = "定投过账 · 到期日 ";

export function dcaPostNote(dueDate: string): string {
  return `${DCA_POST_NOTE_PREFIX}${dueDate}`;
}

export function dcaFrequencyLabel(
  frequency: DcaFrequency,
  weekday: number | null,
  monthDay: number | null,
): string {
  if (frequency === "daily") return "每日";
  if (frequency === "weekly") {
    return weekday ? `每周${WEEKDAY_CN[weekday]}` : "每周";
  }
  if (frequency === "biweekly") {
    return weekday ? `每两周（周${WEEKDAY_CN[weekday]}）` : "每两周";
  }
  return monthDay ? `每月${monthDay}日` : "每月";
}

export function dcaChannelWarning(
  status: string | null | undefined,
): DcaChannelWarning | null {
  if (status == null || status === "") return "no_cell";
  if (status === "paused") return "paused";
  return null;
}

export function dcaChannelWarningLabel(warning: DcaChannelWarning | null): string | null {
  if (warning === "paused") return "该渠道当前暂停";
  if (warning === "no_cell") return "该渠道暂无额度记录";
  return null;
}
