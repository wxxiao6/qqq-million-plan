/** 展示与本地自然日。金额人民币；缺失显示由调用方写成「—」。 */

const MONEY_OPTS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

const BEIJING_TZ = "Asia/Shanghai";

export function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 北京时间 HH:mm，用于 07:00 / 22:00 产品时刻。 */
export function beijingHourMinute(now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BEIJING_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

/** 额度统计周期：北京时间自然日。 */
export function beijingTodayISO(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BEIJING_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function beijingDateISOFromInstant(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return beijingTodayISO(date);
}

/** 数据截至展示：YYYY-MM-DD HH:mm（北京时间）。 */
export function formatBeijingDateTime(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const day = beijingTodayISO(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: BEIJING_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${day} ${time}`;
}

export function shiftISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** 工作日近似：周一至周五。节假日及中美共同休市以正式净值确认作为最终边界。 */
export function isWeekdayISO(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).getDay();
  return weekday >= 1 && weekday <= 5;
}

/** 从 T 日起向后推进指定工作日数；T+2 例：周二→周四、周四→周一、周五→周二。 */
export function advanceWeekdays(iso: string, days: number): string {
  let cursor = iso;
  let remaining = days;
  while (remaining > 0) {
    cursor = shiftISO(cursor, 1);
    if (isWeekdayISO(cursor)) remaining -= 1;
  }
  return cursor;
}

export function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function formatMoney(n: number, fractionDigits = 2): string {
  return `¥${n.toLocaleString("zh-CN", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

export function formatSignedMoney(n: number, fractionDigits = 2): string {
  const body = Math.abs(n).toLocaleString("zh-CN", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  if (n > 0) return `+¥${body}`;
  if (n < 0) return `-¥${body}`;
  return `¥${body}`;
}

export function formatQty(n: number): string {
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatNav(n: number): string {
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export function formatLimit(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString("zh-CN", MONEY_OPTS);
}

export function thisMonthPaymentDate(day: number, from = todayISO()): string | null {
  if (day < 1 || day > 28) return null;
  const [y, m] = from.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
