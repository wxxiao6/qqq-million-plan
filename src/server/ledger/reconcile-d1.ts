import { advanceDebitDate, calculateDcaFee, deriveNextDebitDate, roundDcaMoney, type DcaFeeKind, type DcaFrequency } from "@/lib/dca";
import { beijingTodayISO, isISODate, shiftISO } from "@/lib/format";

export type D1Statement = { bind(...values: (string | number | null)[]): D1Statement };
export type ReconcileD1 = { prepare(sql: string): D1Statement; batch(statements: D1Statement[]): Promise<Array<{ results: unknown[] }>> };
export type ReconcilePlan = {
  id: number; symbol: string; account: string | null; start_date: string; frequency: DcaFrequency;
  weekday: number | null; month_day: number | null; amount: number; fee_kind: DcaFeeKind | null;
  fee_value: number | null; cutoff_period: string; imported_through: string | null;
  status: string; ended_at: string | null; invested_total: number; updated_at: string;
};

type QueryResult = { results: unknown[] };

function reconciliationQueries(db: ReconcileD1, planId: number): D1Statement[] {
  return [
    db.prepare(`SELECT id,symbol,account,start_date,frequency,weekday,month_day,amount,fee_kind,fee_value,cutoff_period,imported_through,status,ended_at,invested_total,updated_at
      FROM dca_plans WHERE id=? AND exposure='nasdaq'`).bind(planId),
    db.prepare("SELECT f.code FROM nasdaq_funds f JOIN dca_plans p ON p.symbol=f.code WHERE p.id=? AND f.currency='CNY'").bind(planId),
    db.prepare(`SELECT 1 FROM dca_plans other JOIN dca_plans current ON current.id=?
      WHERE other.id<>current.id AND other.exposure='nasdaq' AND other.symbol=current.symbol
      AND other.account=current.account AND other.ended_at IS NULL LIMIT 1`).bind(planId),
  ];
}

/** Reconcile one plan in a D1 transaction. A stale plan causes the batch to
 * abort rather than applying a calculation based on outdated plan terms. */
export async function prepareDcaReconciliationD1(db: ReconcileD1, planId: number, today = beijingTodayISO(), transition?: "active" | "paused" | "ended", loaded?: QueryResult[]) {
  if (!Number.isInteger(planId) || planId <= 0 || !isISODate(today)) throw new Error("定投计划或日期不合法");
  const prepare = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).bind(...args);
  const [plans, funds, duplicates] = loaded ?? await db.batch(reconciliationQueries(db, planId));
  const original = plans.results[0] as ReconcilePlan | undefined;
  if (!original) { if (transition) throw new Error("找不到该定投计划"); return; }
  if (original.ended_at) { if (transition) throw new Error("计划已结束，无法更改状态"); return; }
  if (!transition && original.status !== "active") return;
  const resume = original.status === "paused" && transition === "active";
  if (resume && duplicates.results.length) throw new Error("该购买平台已存在此基金的定投计划，请先处理重复计划");
  const reconcile = !transition || (original.status === "active" && transition !== "active") || resume;
  const yesterday = shiftISO(today, -1);
  const plan = resume ? { ...original, imported_through: original.imported_through && original.imported_through > yesterday ? original.imported_through : yesterday } : original;
  if (reconcile && !plan.account) throw new Error(`${plan.symbol} 定投计划缺少购买账户`);
  let date = deriveNextDebitDate({ frequency: plan.frequency, startDate: plan.start_date,
    weekday: plan.weekday, monthDay: plan.month_day, accountedThrough: plan.imported_through });
  const due: string[] = [];
  let periods = 0;
  while (reconcile && date <= today) {
    due.push(date);
    if (++periods > 1000) throw new Error("待补记期数过多，请分批处理");
    date = advanceDebitDate({ frequency: plan.frequency, lastDue: date, monthDay: plan.month_day });
  }
  const fee = calculateDcaFee(plan.amount, plan.fee_kind, plan.fee_value);
  if (due.length && (!funds.results.length || !plan.account || !["alipay", "gf_direct", "cmb", "jd", "other"].includes(plan.account) ||
      !Number.isFinite(plan.amount) || plan.amount <= 0 || !Number.isFinite(fee) || fee < 0 || fee >= plan.amount ||
      !["before_15", "after_15"].includes(plan.cutoff_period))) throw new Error(`${plan.symbol} 定投计划数据不合法`);

  const now = new Date().toISOString();
  const cost = roundDcaMoney(plan.amount - fee);
  // value is NOT NULL. This statement writes nothing when the plan matches;
  // otherwise the constraint violation rolls back the entire batch.
  const statements = [prepare(`INSERT INTO app_kv(key,value) SELECT '__dca_plan_guard__', NULL
    WHERE NOT EXISTS (SELECT 1 FROM dca_plans WHERE id=? AND exposure='nasdaq' AND symbol IS ? AND account IS ?
      AND start_date IS ? AND frequency IS ? AND weekday IS ? AND month_day IS ? AND amount IS ?
      AND fee_kind IS ? AND fee_value IS ? AND cutoff_period IS ? AND imported_through IS ?
      AND status IS ? AND ended_at IS NULL AND invested_total IS ? AND updated_at IS ?
      AND (?=0 OR EXISTS (SELECT 1 FROM nasdaq_funds WHERE code=? AND currency='CNY')))`,
    planId, original.symbol, original.account, original.start_date, original.frequency, original.weekday, original.month_day, original.amount,
    original.fee_kind, original.fee_value, original.cutoff_period, original.imported_through, original.status, original.invested_total, original.updated_at, due.length, original.symbol)];
  if (resume) {
    statements.push(prepare(`INSERT INTO app_kv(key,value) SELECT '__dca_duplicate_guard__', NULL WHERE EXISTS (
      SELECT 1 FROM dca_plans other WHERE other.id<>? AND other.exposure='nasdaq' AND other.symbol=? AND other.account IS ? AND other.ended_at IS NULL)`,
      planId, plan.symbol, plan.account));
    statements.push(prepare("UPDATE dca_plans SET status='active',ended_at=NULL,imported_through=?,updated_at=? WHERE id=?", plan.imported_through, now, planId));
  }
  for (const executionOn of due) {
    statements.push(prepare(`INSERT INTO positions (account,exposure,symbol,shares,cost,status,note,recorded_on,execution_on,
      updated_at,dca_plan_id,cash_debited,fee_amount,cutoff_period,order_origin,auto_generated)
      SELECT ?, 'nasdaq', ?, NULL, ?, 'pending', '定投计划自动记账', ?, ?, ?, ?, ?, ?, ?, 'dca', 1
      WHERE NOT EXISTS (SELECT 1 FROM positions WHERE dca_plan_id=? AND execution_on=?)
        AND EXISTS (SELECT 1 FROM nasdaq_funds WHERE code=? AND currency='CNY')`,
    plan.account, plan.symbol, cost, executionOn, executionOn, now, planId, plan.amount, fee, plan.cutoff_period,
    planId, executionOn, plan.symbol));
    statements.push(prepare(`UPDATE dca_plans SET invested_total=invested_total+?, next_debit_date=?, updated_at=? WHERE id=? AND changes()=1`,
      cost, advanceDebitDate({ frequency: plan.frequency, lastDue: executionOn, monthDay: plan.month_day }), now, planId));
  }
  if (reconcile) {
    statements.push(prepare("UPDATE dca_plans SET imported_through=?, next_debit_date=? WHERE id=?",
      plan.imported_through && plan.imported_through > today ? plan.imported_through : today, date, planId));
    statements.push(autoEstimateStatement(db, plan.symbol, today, now));
  }
  if (transition && !resume) statements.push(prepare("UPDATE dca_plans SET status=?,ended_at=?,updated_at=? WHERE id=?",
    transition === "active" ? "active" : "paused", transition === "ended" ? now : null, now, planId));
  return { statements, original, due, nextDebitDate: date };
}

/** Execute the prepared statements together; callers may compose them with
 * other guarded writes in one D1 batch. */
export async function reconcileDueDcaPlanD1(db: ReconcileD1, planId: number, today = beijingTodayISO(), transition?: "active" | "paused" | "ended") {
  const prepared = await prepareDcaReconciliationD1(db, planId, today, transition);
  if (prepared) await db.batch(prepared.statements);
}

/** Read and apply all active plans using a bounded number of D1 calls. A
 * changed plan aborts the shared batch and is reported for a later retry. */
export async function reconcileDueDcaPlansD1(db: ReconcileD1, today = beijingTodayISO()): Promise<string[]> {
  const [active] = await db.batch([db.prepare("SELECT id,symbol FROM dca_plans WHERE exposure='nasdaq' AND status='active' AND ended_at IS NULL ORDER BY id").bind()]);
  const plans = active.results as Array<{ id: number; symbol: string }>;
  if (!plans.length) return [];
  const loaded = await db.batch(plans.flatMap((plan) => reconciliationQueries(db, plan.id)));
  const errors: string[] = [];
  const statements: D1Statement[] = [];
  for (let i = 0; i < plans.length; i++) {
    try {
      const prepared = await prepareDcaReconciliationD1(db, plans[i].id, today, undefined, loaded.slice(i * 3, i * 3 + 3));
      if (prepared) statements.push(...prepared.statements);
    } catch (error) {
      errors.push(`${plans[i].symbol}：${error instanceof Error ? error.message : "自动记账失败"}`);
    }
  }
  if (statements.length) {
    try { await db.batch(statements); }
    catch { errors.push("自动记账遇到并发修改或数据库错误，请刷新页面重试"); }
  }
  return errors;
}

/** Recalculate all automatic pending lots for a symbol inside the caller's batch. */
export function autoEstimateStatement(db: ReconcileD1, symbol: string, today: string, now: string): D1Statement {
  return db.prepare(`WITH history AS MATERIALIZED (
      SELECT as_of,nav FROM nav_snapshots WHERE symbol=? AND as_of<=? AND nav>0 ORDER BY as_of DESC LIMIT 3
    ), chosen AS MATERIALIZED (
      SELECT p.id,p.cost,p.t_date,p.t_nav,
        CASE WHEN p.t_date IS NOT NULL AND p.t_date<>'' AND p.t_nav IS NOT NULL AND p.t_nav<>0 THEN p.t_date
          WHEN p.execution_on < (SELECT MIN(as_of) FROM history) THEN NULL
          ELSE (SELECT MIN(as_of) FROM history WHERE CASE WHEN p.cutoff_period='after_15' THEN as_of>p.execution_on ELSE as_of>=p.execution_on END) END AS selected_date
      FROM positions p WHERE p.symbol=? AND p.status='pending' AND p.auto_generated=1 AND EXISTS (SELECT 1 FROM history)
    ), resolved AS MATERIALIZED (
      SELECT chosen.*, COALESCE((SELECT nav FROM history WHERE as_of=selected_date),
        CASE WHEN selected_date=t_date THEN t_nav END) AS selected_nav,
        (SELECT COUNT(*) FROM history)=3 AND selected_date<=(SELECT MIN(as_of) FROM history) AS aged
      FROM chosen
    )
    UPDATE positions SET shares=ROUND(resolved.cost/resolved.selected_nav,2), t_nav=resolved.selected_nav,
      t_date=resolved.selected_date, status=CASE WHEN resolved.aged THEN 'settled' ELSE 'pending' END,
      recorded_on=CASE WHEN resolved.aged THEN resolved.selected_date ELSE positions.recorded_on END,
      confirmed_on=CASE WHEN resolved.aged THEN ? ELSE positions.confirmed_on END, updated_at=?
    FROM resolved WHERE positions.id=resolved.id AND resolved.selected_nav>0`).bind(symbol, today, symbol, today, now);
}
