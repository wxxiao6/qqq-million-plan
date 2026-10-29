import { advanceDebitDate, type DcaPlanView } from "./dca";
import { filterBySalesChannel, type SalesChannelFilter } from "./sales-channel-filter";

type Execution = { planId: number; executionOn: string | null; recordedOn: string | null };

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
    pendingAmount: pending.reduce((sum, plan) => sum + plan.amount, 0),
    completed,
    next,
    dueAmount: due.reduce((sum, plan) => sum + plan.amount, 0),
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
    total += record.cashDebited;
    if (date?.startsWith(month)) monthly += record.cashDebited;
    if (date === today) daily += record.cashDebited;
  }
  for (const plan of plans) {
    const recordedDates = valid.filter((record) => record.planId === plan.id)
      .map((record) => record.executionOn ?? record.recordedOn)
      .filter((date): date is string => Boolean(date));
    for (const date of plannedDcaDates(plan, month, recordedDates)) {
      monthly += plan.amount;
      if (date === today) daily += plan.amount;
    }
  }
  return { daily, monthly, total };
}
