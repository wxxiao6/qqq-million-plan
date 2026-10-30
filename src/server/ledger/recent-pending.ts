import { advanceDebitDate, calculateDcaFee, deriveNextDebitDate, type DcaFrequency, type DcaFeeKind } from '@/lib/dca';
import { beijingTodayISO, isISODate } from '@/lib/format';
import { getDb } from '../db';
import { createPendingSubscription } from './pending';
import type { Account, CutoffPeriod } from './index';

type Nav = { asOf: string; nav: number };

export function saveRecentNavHistory(symbol: string, history: Nav[]) {
  const rows = [...new Map(history.filter((row) => isISODate(row.asOf) && Number.isFinite(row.nav) && row.nav > 0)
    .map((row) => [row.asOf, row])).values()].sort((a, b) => b.asOf.localeCompare(a.asOf)).slice(0, 3);
  if (rows.length !== 3) throw new Error(`${symbol} 纳指雷达净值数据异常：最近三个净值日不完整`);
  const db = getDb();
  const write = db.prepare(`INSERT INTO nav_snapshots (symbol, as_of, nav, source)
    VALUES (?, ?, ?, 'real') ON CONFLICT(symbol, as_of) DO UPDATE SET nav=excluded.nav
    WHERE nav_snapshots.source != 'manual'`);
  db.transaction(() => {
    for (const row of rows) write.run(symbol, row.asOf, row.nav);
    updateAutoPendingEstimates(symbol);
  })();
}

/** 只初始化新计划的已到期部分；未来日期仍等待实际扣款记录。 */
export function importPastPlanPending(planId: number, today = beijingTodayISO()) {
  const db = getDb();
  const plan = db.prepare(`SELECT symbol, account, start_date, frequency, weekday, month_day,
    amount, fee_kind, fee_value, cutoff_period, imported_through FROM dca_plans WHERE id=?`).get(planId) as {
    symbol: string; account: Account; start_date: string; frequency: DcaFrequency;
    weekday: number | null; month_day: number | null; amount: number;
    fee_kind: DcaFeeKind | null; fee_value: number | null; cutoff_period: CutoffPeriod; imported_through: string | null;
  } | undefined;
  if (!plan || plan.imported_through) return;
  // 补录范围由起始日与录入日决定；净值完整性属于雷达数据前提。
  let date = deriveNextDebitDate({ frequency: plan.frequency, startDate: plan.start_date,
    weekday: plan.weekday, monthDay: plan.month_day });
  if (date < today && recentHistory(plan.symbol, today).length !== 3) {
    throw new Error(`${plan.symbol} 纳指雷达净值数据异常：最近三个净值日不完整，请更新纳指雷达`);
  }
  while (date < today) {
    const exists = db.prepare('SELECT id FROM positions WHERE dca_plan_id=? AND execution_on=?').get(planId, date);
    if (!exists) {
      const result = createPendingSubscription({ symbol: plan.symbol, account: plan.account,
        dcaPlanId: planId, executionOn: date, cutoffPeriod: plan.cutoff_period,
        cashDebited: plan.amount, feeAmount: calculateDcaFee(plan.amount, plan.fee_kind, plan.fee_value),
        note: '定投初始化自动补录' });
      if (!result.ok) throw new Error(result.error);
      db.prepare('UPDATE positions SET auto_generated=1 WHERE id=?').run(result.id);
    }
    date = advanceDebitDate({ frequency: plan.frequency, lastDue: date, monthDay: plan.month_day });
  }
  db.prepare('UPDATE dca_plans SET imported_through=?, next_debit_date=? WHERE id=?').run(previousDay(today), date, planId);
  updateAutoPendingEstimates(plan.symbol, today);
}

function previousDay(date: string) {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function recentHistory(symbol: string, today: string): Nav[] {
  return getDb().prepare(`SELECT as_of AS asOf, nav FROM nav_snapshots
    WHERE symbol=? AND as_of<=? AND nav>0 ORDER BY as_of DESC LIMIT 3`).all(symbol, today) as Nav[];
}

/** 净值只确定预计份额；申购净值后有两个净值日时，同一笔记录结转。 */
export function updateAutoPendingEstimates(symbol: string, today = beijingTodayISO()) {
  const db = getDb();
  const history = recentHistory(symbol, today);
  if (!history.length) return;
  const rows = db.prepare(`SELECT id, cost, execution_on, cutoff_period, t_date, t_nav
    FROM positions WHERE symbol=? AND status='pending' AND auto_generated=1`).all(symbol) as {
    id: number; cost: number; execution_on: string; cutoff_period: CutoffPeriod; t_date: string | null; t_nav: number | null;
  }[];
  for (const row of rows) {
    const nav = row.t_date && row.t_nav ? history.find((item) => item.asOf === row.t_date) ?? { asOf: row.t_date, nav: row.t_nav } : row.execution_on < history[history.length - 1].asOf ? undefined : [...history].reverse().find((item) =>
      row.cutoff_period === 'after_15' ? item.asOf > row.execution_on : item.asOf >= row.execution_on);
    if (!nav || !Number.isFinite(nav.nav) || nav.nav <= 0) continue;
    const shares = Math.round((row.cost / nav.nav + Number.EPSILON) * 100) / 100;
    const aged = history.length === 3 && nav.asOf <= history[2].asOf;
    db.prepare(`UPDATE positions SET shares=?, t_nav=?, t_date=?, status=?,
      recorded_on=CASE WHEN ? THEN ? ELSE recorded_on END,
      confirmed_on=CASE WHEN ? THEN ? ELSE confirmed_on END, updated_at=? WHERE id=?`)
      .run(shares, nav.nav, nav.asOf, aged ? 'settled' : 'pending', aged ? 1 : 0, nav.asOf,
        aged ? 1 : 0, today, new Date().toISOString(), row.id);
  }
}

/** 按计划将已到期的期次自动记入账本；不向购买渠道发起交易。 */
export function reconcileDueDcaPlan(planId: number, today = beijingTodayISO()): void {
  const db = getDb();
  db.transaction(() => {
    const plan = db.prepare(`SELECT symbol, account, start_date, frequency, weekday, month_day, amount,
      fee_kind, fee_value, cutoff_period, imported_through, status, ended_at
      FROM dca_plans WHERE id=? AND exposure='nasdaq'`).get(planId) as {
        symbol: string; account: Account | null; start_date: string; frequency: DcaFrequency;
        weekday: number | null; month_day: number | null; amount: number;
        fee_kind: DcaFeeKind | null; fee_value: number | null; cutoff_period: CutoffPeriod;
        imported_through: string | null; status: string; ended_at: string | null;
      } | undefined;
    if (!plan || plan.status !== 'active' || plan.ended_at) return;
    if (!plan.account) throw new Error(`${plan.symbol} 定投计划缺少购买账户`);
    const existing = db.prepare('SELECT execution_on AS date FROM positions WHERE dca_plan_id=? AND execution_on IS NOT NULL').all(planId) as { date: string }[];
    const dates = new Set(existing.map((row) => row.date));
    let date = deriveNextDebitDate({ frequency: plan.frequency, startDate: plan.start_date,
      weekday: plan.weekday, monthDay: plan.month_day, accountedThrough: plan.imported_through });
    while (date <= today) {
      if (!dates.has(date)) {
        const result = createPendingSubscription({ symbol: plan.symbol, account: plan.account,
          dcaPlanId: planId, executionOn: date, cutoffPeriod: plan.cutoff_period,
          cashDebited: plan.amount, feeAmount: calculateDcaFee(plan.amount, plan.fee_kind, plan.fee_value),
          note: '定投计划自动记账' });
        if (!result.ok) throw new Error(result.error);
        db.prepare('UPDATE positions SET auto_generated=1 WHERE id=?').run(result.id);
      }
      date = advanceDebitDate({ frequency: plan.frequency, lastDue: date, monthDay: plan.month_day });
    }
    db.prepare('UPDATE dca_plans SET imported_through=?, next_debit_date=? WHERE id=?')
      .run(plan.imported_through && plan.imported_through > today ? plan.imported_through : today, date, planId);
    updateAutoPendingEstimates(plan.symbol, today);
  })();
}

export function reconcileDueDcaPlans(today = beijingTodayISO()): string[] {
  const rows = getDb().prepare("SELECT id, symbol FROM dca_plans WHERE exposure='nasdaq' AND status='active' AND ended_at IS NULL").all() as { id: number; symbol: string }[];
  const errors: string[] = [];
  for (const row of rows) {
    try { reconcileDueDcaPlan(row.id, today); }
    catch (error) { errors.push(`${row.symbol}：${error instanceof Error ? error.message : '自动记账失败'}`); }
  }
  return errors;
}
