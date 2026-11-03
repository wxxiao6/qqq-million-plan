import { sumMoney, roundMoney, decimal } from "./decimal";
import { advanceDebitDate, type DcaPlanView } from "./dca";
import { filterBySalesChannel, type SalesChannelFilter } from "./sales-channel-filter";

type Execution = { planId: number; executionOn: string | null; recordedOn: string | null };

/** Pending includes earlier months and paused/ended plans; failed/cancelled never count as assets. */
export function summarizeDcaProgress(records: Array<{ status: string; executionOn: string | null; recordedOn: string | null; cashDebited: number }>, today: string) {
  const pending = records.filter((record) => record.status === "pending");
  const monthlyConfirmed = sumMoney(records.filter((record) => record.status === "settled" && (record.executionOn ?? record.recordedOn)?.startsWith(today.slice(0, 7))).map((record) => record.cashDebited));
  return { monthlyConfirmed, pendingCount: pending.length, pendingAmount: sumMoney(pending.map((record) => record.cashDebited)) };
}

export function filterDcaBySalesChannel<T extends { planId: number }>(
  plans: DcaPlanView[],
  records: T[],
  managers: Record<string, string>,
  channel: SalesChannelFilter,
  detail: string,
) {
  const selectedPlans = filterBySalesChannel(plans, managers, channel, detail);
  const planIds = new Set(selectedPlans.map((plan) => plan.id));
  return { plans: selectedPlans, records: records.filter((record) => planIds.has(record.planId)) };
}

export function summarizeDcaSchedule(plans: DcaPlanView[], executions: Execution[], today: string) {
  const active = plans.filter((plan) => plan.status === "active");
  const completedIds = new Set(executions
    .filter((item) => item.executionOn === today || (!item.executionOn && item.recordedOn === today))
    .map((item) => item.planId));
  const scheduledToday = active.filter((plan) => plan.nextDebitDate === today);
  const due = scheduledToday.filter((plan) => !completedIds.has(plan.id));
  const overdue = active.filter((plan) => plan.nextDebitDate && plan.nextDebitDate < today);
  const pending = [...overdue, ...due].sort((a, b) => a.nextDebitDate!.localeCompare(b.nextDebitDate!) || a.id - b.id);
  const completed = active.filter((plan) => completedIds.has(plan.id));
  const next = active.filter((plan) => plan.nextDebitDate && plan.nextDebitDate > today)
    .sort((a, b) => a.nextDebitDate!.localeCompare(b.nextDebitDate!) || a.id - b.id);
  return {
    active,
    due,
    overdue,
    pending,
    pendingAmount: sumMoney(pending.map((plan) => plan.amount)),
    completed,
    next,
    dueAmount: sumMoney(due.map((plan) => plan.amount)),
  };
}

/** Outstanding plan dates within a month, using the same recurrence as the ledger. */
export function plannedDcaDates(plan: DcaPlanView, month: string, recordedDates: readonly string[] = []): string[] {
  if (plan.status !== "active" || !plan.nextDebitDate) return [];
  const first = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonth = monthNumber === 12 ? `${year + 1}-01-01` : `${year}-${String(monthNumber + 1).padStart(2, "0")}-01`;
  let date = plan.nextDebitDate;
  const dates: string[] = [];
  const recorded = new Set(recordedDates);
  while (date < nextMonth) {
    if (date >= first && !recorded.has(date)) dates.push(date);
    date = advanceDebitDate({ frequency: plan.frequency, lastDue: date, monthDay: plan.monthDay });
  }
  return dates;
}


/** 已记账金额与当前计划中本月尚未记账的期次合计；不折算日均。 */
export function summarizeDcaAmounts(
  plans: DcaPlanView[],
  records: Array<{ planId: number; executionOn: string | null; recordedOn: string | null; cashDebited: number; status: string }>,
  today: string,
) {
  const valid = records.filter((record) => record.status === "pending" || record.status === "settled");
  const month = today.slice(0, 7);
  let daily = 0;
  let monthly = 0;
  let total = 0;
  for (const record of valid) {
    const date = record.executionOn ?? record.recordedOn;
    total = decimal(total).plus(record.cashDebited).toNumber();
    if (date?.startsWith(month)) monthly = decimal(monthly).plus(record.cashDebited).toNumber();
    if (date === today) daily = decimal(daily).plus(record.cashDebited).toNumber();
  }
  for (const plan of plans) {
    const recordedDates = valid.filter((record) => record.planId === plan.id)
      .map((record) => record.executionOn ?? record.recordedOn)
      .filter((date): date is string => Boolean(date));
    for (const date of plannedDcaDates(plan, month, recordedDates)) {
      monthly = decimal(monthly).plus(plan.amount).toNumber();
      if (date === today) daily = decimal(daily).plus(plan.amount).toNumber();
    }
  }
  return { daily: roundMoney(daily), monthly: roundMoney(monthly), total: roundMoney(total) };
}
