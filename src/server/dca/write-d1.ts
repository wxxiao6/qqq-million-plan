import { advanceDebitDate, calculateDcaFee, dcaPostNote, roundDcaMoney, type DcaExecutionInput, type DcaFeeKind, type DcaFrequency } from "@/lib/dca";
import { beijingTodayISO, isISODate } from "@/lib/format";
import { reconcileDueDcaPlanD1, type ReconcileD1 } from "../ledger/reconcile-d1";
import type { DcaWriteResult } from "./index";

type Correction = { id: number; cashDebited: number; feeAmount: number; outcome: "keep" | "failed" | "cancelled" };
type Position = { dca_plan_id: number; status: string; cost: number; auto_generated: number; t_nav: number | null; shares: number | null; updated_at: string; cash_debited: number | null; fee_amount: number | null; closed_on: string | null };

export async function setDcaPlanStatusD1(db: ReconcileD1, id: number, status: "active" | "paused" | "ended"): Promise<DcaWriteResult> {
  if (!["active", "paused", "ended"].includes(status)) return { ok: false, error: "状态不合法" };
  try {
    await reconcileDueDcaPlanD1(db, id, beijingTodayISO(), status);
    return { ok: true, id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const expected = ["找不到该定投计划", "计划已结束，无法更改状态", "该购买平台已存在此基金的定投计划，请先处理重复计划"];
    return { ok: false, error: expected.includes(message) || message.includes("定投计划缺少购买账户") || message.includes("定投计划数据不合法") || message.includes("待补记期数过多") ? message : "计划状态更新失败，请刷新后重试" };
  }
}

type ExecutionPlan = { symbol: string; account: string | null; amount: number; fee_kind: DcaFeeKind | null;
  fee_value: number | null; frequency: DcaFrequency; month_day: number | null; ended_at: string | null; updated_at: string };

/** Record a manual debit and advance the plan within the same transaction. */
export async function recordPlanExecutionD1(db: ReconcileD1, planId: number, execution: DcaExecutionInput): Promise<DcaWriteResult> {
  if (!execution || (execution.status !== "bought_before_cutoff" && execution.status !== "bought_after_cutoff")) return { ok: false, error: "请选择 15:00 前或后" };
  if (!isISODate(execution.executionDate ?? "")) return { ok: false, error: "请输入实际买入日期" };
  if (execution.actualCashDebited != null && (!Number.isFinite(execution.actualCashDebited) || execution.actualCashDebited <= 0)) return { ok: false, error: "实际扣款金额不合法" };
  if (execution.actualFeeAmount != null && (!Number.isFinite(execution.actualFeeAmount) || execution.actualFeeAmount < 0)) return { ok: false, error: "实际手续费不合法" };
  if (!Number.isInteger(planId) || planId <= 0) return { ok: false, error: "找不到该纳指定投计划" };
  const bind = (sql: string, ...values: (number | string | null)[]) => db.prepare(sql).bind(...values);
  const date = execution.executionDate!;
  const [plans, duplicates] = await db.batch([
    bind(`SELECT symbol,account,amount,fee_kind,fee_value,frequency,month_day,ended_at,updated_at FROM dca_plans WHERE id=? AND exposure='nasdaq'`, planId),
    bind(`SELECT 1 FROM positions WHERE dca_plan_id=? AND execution_on=? AND status IN ('pending','settled') LIMIT 1`, planId, date),
  ]);
  const plan = plans.results[0] as ExecutionPlan | undefined;
  if (!plan?.account) return { ok: false, error: "找不到该纳指定投计划" };
  if (plan.ended_at) return { ok: false, error: "已结束的计划不可记录扣款" };
  if (duplicates.results.length) return { ok: false, error: "本期扣款已有待确认或持仓记录" };
  if (!["alipay", "gf_direct", "cmb", "jd", "other"].includes(plan.account)) return { ok: false, error: "账户不合法" };
  const cash = execution.actualCashDebited ?? plan.amount;
  const fee = calculateDcaFee(cash, plan.fee_kind, plan.fee_value, execution.actualFeeAmount);
  const cost = roundDcaMoney(cash - fee);
  if (cost <= 0) return { ok: false, error: "手续费不能大于等于定投金额" };
  const now = new Date().toISOString();
  const cutoff = execution.status === "bought_before_cutoff" ? "before_15" : "after_15";
  try {
    const result = await db.batch([
      bind(`INSERT INTO app_kv(key,value) SELECT '__dca_record_guard__', NULL WHERE NOT EXISTS
        (SELECT 1 FROM dca_plans p JOIN nasdaq_funds f ON f.code=p.symbol AND f.currency='CNY'
         WHERE p.id=? AND p.exposure='nasdaq' AND p.ended_at IS NULL AND p.symbol IS ? AND p.account IS ?
           AND p.amount IS ? AND p.fee_kind IS ? AND p.fee_value IS ? AND p.frequency IS ? AND p.month_day IS ? AND p.updated_at IS ?
           AND NOT EXISTS (SELECT 1 FROM positions WHERE dca_plan_id=p.id AND execution_on=? AND status IN ('pending','settled')))`,
      planId, plan.symbol, plan.account, plan.amount, plan.fee_kind, plan.fee_value, plan.frequency, plan.month_day, plan.updated_at, date),
      bind(`INSERT INTO positions (account,exposure,symbol,shares,cost,status,note,recorded_on,execution_on,updated_at,dca_plan_id,cash_debited,fee_amount,cutoff_period,order_origin)
        VALUES (?, 'nasdaq', ?, NULL, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, 'dca') RETURNING id`,
      plan.account, plan.symbol, cost, dcaPostNote(date), date, date, now, planId, cash, fee, cutoff),
      bind(`UPDATE dca_plans SET invested_total=invested_total+?,next_debit_date=?,updated_at=? WHERE id=?`,
      cost, advanceDebitDate({ frequency: plan.frequency, lastDue: date, monthDay: plan.month_day }), now, planId),
    ]);
    return { ok: true, id: (result[1].results[0] as { id: number }).id };
  } catch {
    return { ok: false, error: "记录扣款失败，请刷新后重试" };
  }
}

/** Read, validate and update the execution and its plan as an atomic batch.
 * Optimistic guards reject stale input instead of overwriting another update. */
export async function correctDcaExecutionD1(db: ReconcileD1, input: Correction): Promise<DcaWriteResult> {
  if (!Number.isFinite(input.cashDebited) || input.cashDebited <= 0) return { ok: false, error: "记账金额必须大于 0" };
  if (!Number.isFinite(input.feeAmount) || input.feeAmount < 0 || input.feeAmount >= input.cashDebited) return { ok: false, error: "手续费须小于记账金额" };
  if (!["keep", "failed", "cancelled"].includes(input.outcome)) return { ok: false, error: "处理方式不合法" };
  if (!Number.isInteger(input.id) || input.id <= 0) return { ok: false, error: "找不到可修正的定投记录" };
  const bind = (sql: string, ...values: (number | string | null)[]) => db.prepare(sql).bind(...values);
  const result = await db.batch([bind(`SELECT dca_plan_id,status,cost,auto_generated,t_nav,shares,updated_at,cash_debited,fee_amount,closed_on
    FROM positions WHERE id=? AND dca_plan_id IS NOT NULL`, input.id)]);
  const row = result[0].results[0] as Position | undefined;
  if (!row || (row.status !== "pending" && row.status !== "settled")) return { ok: false, error: "找不到可修正的定投记录" };
  const cost = roundDcaMoney(input.cashDebited - input.feeAmount);
  const removed = input.outcome !== "keep";
  const shares = row.auto_generated && row.t_nav && row.t_nav > 0
    ? Math.round((cost / row.t_nav + Number.EPSILON) * 100) / 100 : row.shares;
  const now = new Date().toISOString();
  try {
    await db.batch([
      // A NOT NULL violation aborts the batch if a concurrent update changed the record.
      bind(`INSERT INTO app_kv(key,value) SELECT '__dca_execution_guard__', NULL WHERE NOT EXISTS
        (SELECT 1 FROM positions WHERE id=? AND dca_plan_id IS ? AND status IS ? AND cost IS ?
        AND auto_generated IS ? AND t_nav IS ? AND shares IS ? AND updated_at IS ? AND cash_debited IS ? AND fee_amount IS ? AND closed_on IS ?)`,
        input.id, row.dca_plan_id, row.status, row.cost, row.auto_generated, row.t_nav, row.shares, row.updated_at, row.cash_debited, row.fee_amount, row.closed_on),
      bind(`UPDATE positions SET cash_debited=?, fee_amount=?, cost=?, shares=?, status=?, closed_on=?, updated_at=? WHERE id=?`,
        input.cashDebited, input.feeAmount, cost, shares, removed ? input.outcome : row.status, removed ? beijingTodayISO() : null, now, input.id),
      bind(`UPDATE dca_plans SET invested_total=MAX(0,invested_total+?), updated_at=? WHERE id=?`,
        removed ? -row.cost : cost - row.cost, now, row.dca_plan_id),
    ]);
    return { ok: true, id: input.id };
  } catch {
    return { ok: false, error: "修正记账失败，请刷新后重试" };
  }
}

/** Delete only if no history exists, with the check and delete in one batch. */
export async function removeDcaPlanD1(db: ReconcileD1, id: number): Promise<DcaWriteResult> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "找不到该定投计划" };
  const result = await db.batch([
    db.prepare("SELECT id FROM dca_plans WHERE id=? AND exposure='nasdaq'").bind(id),
    db.prepare(`DELETE FROM dca_plans WHERE id=? AND exposure='nasdaq'
      AND NOT EXISTS (SELECT 1 FROM positions WHERE dca_plan_id=?) RETURNING id`).bind(id, id),
  ]);
  if (!result[0].results.length) return { ok: false, error: "找不到该定投计划" };
  if (!result[1].results.length) return { ok: false, error: "计划已有扣款记录，请暂停计划以保留账本关联" };
  return { ok: true, id };
}
