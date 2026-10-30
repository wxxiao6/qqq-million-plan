import { advanceDebitDate, calculateDcaFee, dcaPostNote, deriveNextDebitDate, normalizeDcaFee, resolveDcaAccount, roundDcaMoney, validateDcaInput,
  type DcaChannelKind, type DcaFrequency, type DcaInput } from "@/lib/dca";
import { beijingTodayISO, isISODate } from "@/lib/format";
import { autoEstimateStatement, type ReconcileD1 } from "../ledger/reconcile-d1";
import type { DcaWriteResult } from "./index";

/** Create, backfill and book today's due period atomically. */
export async function createDcaPlanD1(db: ReconcileD1, input: DcaInput, today = beijingTodayISO()): Promise<DcaWriteResult> {
  const error = validateDcaInput(input);
  if (error) return { ok: false, error };
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
  if (!isISODate(today)) return { ok: false, error: "日期不合法" };
  const symbol = input.symbol.trim();
  const frequency = input.frequency as DcaFrequency;
  const weekday = frequency === "weekly" || frequency === "biweekly" ? input.weekday ?? null : null;
  const monthDay = frequency === "monthly" ? input.monthDay ?? null : null;
  const bind = (sql: string, ...values: (number | string | null)[]) => db.prepare(sql).bind(...values);
  const [funds, duplicates, history] = await db.batch([
    bind("SELECT 1 FROM nasdaq_funds WHERE code=? AND share_class=? AND currency='CNY' AND market_type='otc'", symbol, input.shareClass),
    bind("SELECT 1 FROM dca_plans WHERE exposure='nasdaq' AND symbol=? AND account=? AND ended_at IS NULL LIMIT 1", symbol, account.account),
    bind("SELECT as_of FROM nav_snapshots WHERE symbol=? AND as_of<=? AND nav>0 ORDER BY as_of DESC LIMIT 3", symbol, today),
  ]);
  if (!funds.results.length) return { ok: false, error: "请选择支持定投的人民币场外份额" };
  if (duplicates.results.length) return { ok: false, error: "该购买平台已存在此基金的定投计划，请编辑或恢复已有计划" };
  let date = deriveNextDebitDate({ frequency, startDate: input.startDate, weekday, monthDay });
  if (date < today && history.results.length !== 3) return { ok: false, error: `${symbol} 纳指雷达净值数据异常：最近三个净值日不完整，请更新纳指雷达` };
  const due: string[] = [];
  while (date <= today) {
    due.push(date);
    if (due.length > 1000) return { ok: false, error: "待补记期数过多，请分批处理" };
    date = advanceDebitDate({ frequency, lastDue: date, monthDay });
  }
  const initialDate = deriveNextDebitDate({ frequency, startDate: input.startDate, weekday, monthDay });
  const now = new Date().toISOString();
  const autoFee = calculateDcaFee(input.amount, fee.feeKind, fee.feeValue);
  const autoCost = roundDcaMoney(input.amount - autoFee);
  const key = [symbol, account.account] as const;
  // The active plan is unique under this guard, so later statements can find
  // its ID without relying on connection-scoped last_insert_rowid().
  const planId = `(SELECT id FROM dca_plans WHERE exposure='nasdaq' AND symbol=? AND account=? AND ended_at IS NULL)`;
  const statements = [bind(`INSERT INTO app_kv(key,value) SELECT '__dca_create_guard__',NULL WHERE
    EXISTS (SELECT 1 FROM dca_plans WHERE exposure='nasdaq' AND symbol=? AND account=? AND ended_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM nasdaq_funds WHERE code=? AND share_class=? AND currency='CNY' AND market_type='otc')
    OR (?=1 AND (SELECT COUNT(*) FROM (SELECT 1 FROM nav_snapshots WHERE symbol=? AND as_of<=? AND nav>0 LIMIT 3))<>3)`,
  symbol, account.account, symbol, input.shareClass, initialDate < today ? 1 : 0, symbol, today),
  bind(`INSERT INTO dca_plans (exposure,symbol,share_class,channel_kind,account,amount,fee_kind,fee_value,frequency,weekday,month_day,start_date,next_debit_date,status,note,updated_at,cutoff_period)
    VALUES ('nasdaq',?,?,?,?,?,?,?,?,?,?,?,?, 'active',?,?,?) RETURNING id`,
  symbol, input.shareClass, input.channelKind, account.account, input.amount, fee.feeKind, fee.feeValue, frequency, weekday, monthDay,
  input.startDate, initialDate, input.note?.trim() || null, now, input.cutoffPeriod ?? "before_15")];
  if (execution && execution.status !== "not_bought") {
    const executionDate = execution.executionDate!;
    const cash = execution.actualCashDebited ?? input.amount;
    const manualFee = calculateDcaFee(cash, fee.feeKind, fee.feeValue, execution.actualFeeAmount);
    const cost = roundDcaMoney(cash - manualFee);
    if (cost <= 0) return { ok: false, error: "手续费不能大于等于定投金额" };
    statements.push(bind(`INSERT INTO positions (account,exposure,symbol,shares,cost,status,note,recorded_on,execution_on,updated_at,dca_plan_id,cash_debited,fee_amount,cutoff_period,order_origin)
      VALUES (?,'nasdaq',?,NULL,?,'pending',?,?,?,?,${planId},?,?,?,'dca')`,
    account.account, symbol, cost, dcaPostNote(executionDate), executionDate, executionDate, now, ...key, cash, manualFee,
    execution.status === "bought_before_cutoff" ? "before_15" : "after_15"));
    statements.push(bind(`UPDATE dca_plans SET invested_total=invested_total+?,updated_at=? WHERE id=${planId}`, cost, now, ...key));
  }
  for (const dueDate of due) {
    statements.push(bind(`INSERT INTO positions (account,exposure,symbol,shares,cost,status,note,recorded_on,execution_on,updated_at,dca_plan_id,cash_debited,fee_amount,cutoff_period,order_origin,auto_generated)
      SELECT ?,'nasdaq',?,NULL,?,'pending',?,?,?,?,${planId},?,?,?,'dca',1
      WHERE NOT EXISTS (SELECT 1 FROM positions WHERE dca_plan_id=${planId} AND execution_on=?)`,
    account.account, symbol, autoCost, dueDate < today ? "定投初始化自动补录" : "定投计划自动记账", dueDate, dueDate, now, ...key,
    input.amount, autoFee, input.cutoffPeriod ?? "before_15", ...key, dueDate));
    statements.push(bind(`UPDATE dca_plans SET invested_total=invested_total+?,updated_at=? WHERE id=${planId} AND changes()=1`, autoCost, now, ...key));
  }
  statements.push(bind(`UPDATE dca_plans SET imported_through=?,next_debit_date=? WHERE id=${planId}`, today, date, ...key));
  statements.push(autoEstimateStatement(db, symbol, today, now));
  try {
    const result = await db.batch(statements);
    return { ok: true, id: (result[1].results[0] as { id: number }).id };
  } catch {
    return { ok: false, error: "定投计划保存失败，请刷新后重试" };
  }
}
