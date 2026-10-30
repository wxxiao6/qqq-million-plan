import { advanceDebitDate, calculateDcaFee, dcaPostNote, deriveNextDebitDate, normalizeDcaFee, resolveDcaAccount, roundDcaMoney, validateDcaInput,
  type DcaChannelKind, type DcaFrequency, type DcaInput } from "@/lib/dca";
import { beijingTodayISO, isISODate } from "@/lib/format";
import { prepareDcaReconciliationD1, type ReconcileD1 } from "../ledger/reconcile-d1";
import type { Account } from "../ledger";
import type { DcaWriteResult } from "./index";

const PLAN_JSON = `SELECT json_array(id,symbol,share_class,channel_kind,account,amount,fee_kind,fee_value,frequency,weekday,month_day,start_date,next_debit_date,status,ended_at,note,updated_at,invested_total,imported_through,cutoff_period) FROM dca_plans WHERE id=? AND exposure='nasdaq'`;
type Plan = { id: number; symbol: string; share_class: string; account: Account | null; status: string; ended_at: string | null; fingerprint: string };
export async function editDcaPlanD1(db: ReconcileD1, input: DcaInput & { id: number }, today = beijingTodayISO()): Promise<DcaWriteResult> {
  const error = validateDcaInput(input);
  if (error) return { ok: false, error };
  if (!Number.isInteger(input.id) || input.id <= 0 || !isISODate(today)) return { ok: false, error: "找不到该定投计划" };
  const execution = input.execution;
  if (execution && execution.status !== "not_bought") {
    if (!isISODate(execution.executionDate ?? "")) return { ok: false, error: "请输入实际买入日期" };
    if (execution.actualCashDebited != null && (!Number.isFinite(execution.actualCashDebited) || execution.actualCashDebited <= 0)) return { ok: false, error: "实际扣款金额不合法" };
    if (execution.actualFeeAmount != null && (!Number.isFinite(execution.actualFeeAmount) || execution.actualFeeAmount < 0)) return { ok: false, error: "实际手续费不合法" };
  }
  const account = resolveDcaAccount(input.channelKind as DcaChannelKind, input.account);
  if (!account.ok) return account;
  const fee = normalizeDcaFee(input.feeKind, input.feeValue);
  if (!fee.ok) return fee;
  const symbol = input.symbol.trim();
  const bind = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).bind(...args);
  const [plans, funds, duplicates, history] = await db.batch([
    bind(`SELECT id,symbol,share_class,account,status,ended_at,(${PLAN_JSON}) AS fingerprint FROM dca_plans WHERE id=? AND exposure='nasdaq'`, input.id, input.id),
    bind("SELECT 1 FROM nasdaq_funds WHERE code=? AND share_class=? AND currency='CNY' AND market_type='otc'", symbol, input.shareClass),
    bind("SELECT 1 FROM dca_plans WHERE exposure='nasdaq' AND symbol=? AND account=? AND ended_at IS NULL AND id<>? LIMIT 1", symbol, account.account, input.id),
    bind("SELECT 1 FROM positions WHERE dca_plan_id=? LIMIT 1", input.id),
  ]);
  const plan = plans.results[0] as Plan | undefined;
  if (!funds.results.length) return { ok: false, error: "请选择支持定投的人民币场外份额" };
  if (duplicates.results.length) return { ok: false, error: "该购买平台已存在此基金的定投计划，请编辑或恢复已有计划" };
  if (!plan) return { ok: false, error: "找不到该定投计划" };
  if (plan.ended_at) return { ok: false, error: "已结束的计划不可修改" };
  const changedFund = plan.symbol !== symbol || plan.share_class !== input.shareClass;
  if (changedFund && history.results.length > 0) return { ok: false, error: "已有扣款记录的计划不可修改基金或份额" };
  let prepared;
  try { prepared = await prepareDcaReconciliationD1(db, input.id, today); }
  catch { return { ok: false, error: "补记到期计划失败，请刷新后重试" }; }
  const frequency = input.frequency as DcaFrequency;
  const weekday = frequency === "weekly" || frequency === "biweekly" ? input.weekday ?? null : null;
  const monthDay = frequency === "monthly" ? input.monthDay ?? null : null;
  const nextDate = deriveNextDebitDate({ frequency, startDate: input.startDate, weekday, monthDay });
  const now = new Date().toISOString();
  const statements = [bind(`INSERT INTO app_kv(key,value) SELECT '__dca_edit_guard__',NULL WHERE (${PLAN_JSON}) IS NOT ?
      OR NOT EXISTS (SELECT 1 FROM nasdaq_funds WHERE code=? AND share_class=? AND currency='CNY' AND market_type='otc')
      OR EXISTS (SELECT 1 FROM dca_plans WHERE exposure='nasdaq' AND symbol=? AND account=? AND ended_at IS NULL AND id<>?)`,
    input.id, plan.fingerprint, symbol, input.shareClass, symbol, account.account, input.id),
    ...(prepared?.statements ?? [])];
  if (changedFund) statements.push(bind(`INSERT INTO app_kv(key,value) SELECT '__dca_edit_history_guard__',NULL WHERE EXISTS (SELECT 1 FROM positions WHERE dca_plan_id=?)`, input.id));
  if (execution && execution.status !== "not_bought") statements.push(bind(`INSERT INTO app_kv(key,value) SELECT '__dca_edit_execution_guard__',NULL WHERE EXISTS
    (SELECT 1 FROM positions WHERE dca_plan_id=? AND execution_on=? AND status IN ('pending','settled'))`, input.id, execution.executionDate!));
  statements.push(bind(`UPDATE dca_plans SET symbol=?,share_class=?,channel_kind=?,account=?,amount=?,fee_kind=?,fee_value=?,frequency=?,weekday=?,month_day=?,
    start_date=?,next_debit_date=?,note=?,updated_at=?,cutoff_period=? WHERE id=?`,
  symbol, input.shareClass, input.channelKind, account.account, input.amount, fee.feeKind, fee.feeValue, frequency, weekday, monthDay,
  input.startDate, nextDate, input.note?.trim() || null, now, input.cutoffPeriod ?? "before_15", input.id));
  statements.push(bind("UPDATE positions SET account=?,updated_at=? WHERE dca_plan_id=? AND account<>?", account.account, now, input.id, account.account));
  if (execution && execution.status !== "not_bought") {
    const executionDate = execution.executionDate!;
    const cash = execution.actualCashDebited ?? input.amount;
    const manualFee = calculateDcaFee(cash, fee.feeKind, fee.feeValue, execution.actualFeeAmount);
    const cost = roundDcaMoney(cash - manualFee);
    if (cost <= 0) return { ok: false, error: "手续费不能大于等于定投金额" };
    statements.push(bind(`INSERT INTO positions (account,exposure,symbol,shares,cost,status,note,recorded_on,execution_on,updated_at,dca_plan_id,cash_debited,fee_amount,cutoff_period,order_origin)
      VALUES (?,'nasdaq',?,NULL,?,'pending',?,?,?,?,?,?,?,?,'dca')`,
    account.account, symbol, cost, dcaPostNote(executionDate), executionDate, executionDate, now, input.id, cash, manualFee,
    execution.status === "bought_before_cutoff" ? "before_15" : "after_15"));
    statements.push(bind("UPDATE dca_plans SET invested_total=invested_total+?,next_debit_date=?,updated_at=? WHERE id=?",
      cost, advanceDebitDate({ frequency, lastDue: executionDate, monthDay }), now, input.id));
  }
  try { await db.batch(statements); return { ok: true, id: input.id }; }
  catch { return { ok: false, error: "定投计划保存失败，请刷新后重试" }; }
}
