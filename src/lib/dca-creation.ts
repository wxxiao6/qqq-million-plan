import { advanceDebitDate, deriveNextDebitDate, DCA_FREQUENCIES, roundDcaMoney, type DcaFrequency, type DcaInput } from "./dca";
import { isISODate } from "./format";

export type DcaCreationMode = "now" | "history";
type Schedule = Pick<DcaInput, "frequency" | "startDate" | "weekday" | "monthDay" | "amount">;

/** Uses the ledger recurrence, including today's due period. Weekends only; no holiday calendar. */
export function previewDcaCreation(input: Schedule, today: string) {
  if (!isISODate(input.startDate) || !isISODate(today)) return { ok: false as const, error: "请选择有效的起始日期" };
  if (!DCA_FREQUENCIES.includes(input.frequency as DcaFrequency)) return { ok: false as const, error: "请选择投入频率" };
  if ((input.frequency === "weekly" || input.frequency === "biweekly") && (!Number.isInteger(input.weekday) || input.weekday! < 1 || input.weekday! > 7)) return { ok: false as const, error: "请选择周几" };
  if (input.frequency === "monthly" && (!Number.isInteger(input.monthDay) || input.monthDay! < 1 || input.monthDay! > 28)) return { ok: false as const, error: "请选择每月 1–28 号" };
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { ok: false as const, error: "请填写每期投入金额" };
  const frequency = input.frequency as DcaFrequency;
  const firstDate = deriveNextDebitDate({ ...input, frequency });
  let date = firstDate;
  const dates: string[] = [];
  while (date <= today) {
    dates.push(date);
    if (dates.length > 1000) return { ok: false as const, error: "待补记期数超过 1000 笔，请缩小补录范围" };
    date = advanceDebitDate({ frequency, lastDue: date, monthDay: input.monthDay });
  }
  const total = roundDcaMoney(dates.length * input.amount);
  if (!Number.isFinite(total)) return { ok: false as const, error: "合计金额超出有效范围" };
  return { ok: true as const, dates, count: dates.length, historicalCount: dates.filter((item) => item < today).length, total, firstDate, nextDate: date };
}

export function validateDcaCreation(input: Schedule & { creationMode?: DcaCreationMode; confirmedBackfill?: { count: number; total: number; through: string } }, today: string): string | null {
  if (input.creationMode !== "now" && input.creationMode !== "history") return "请选择从现在开始或补录已有定投";
  const preview = previewDcaCreation(input, today);
  if (!preview.ok) return preview.error;
  if (input.creationMode === "now" && input.startDate < today) return "从现在开始的起始日不能早于今天，请重新选择日期";
  if (input.creationMode === "history" && input.startDate > today) return "补录起始日不能晚于今天";
  if (input.creationMode === "history" && preview.count > 0 &&
    (input.confirmedBackfill?.count !== preview.count || input.confirmedBackfill.total !== preview.total || input.confirmedBackfill.through !== today)) return "补录预览已变化，请重新核对笔数和金额后保存";
  return null;
}
