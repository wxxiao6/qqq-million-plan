import { advanceDebitDate, roundDcaMoney, type DcaFrequency } from "@/lib/dca";
import { beijingTodayISO, isISODate } from "@/lib/format";
import { portfolioSnapshotStatement } from "../market/nav-d1";
import type { CutoffPeriod } from "./index";
import type { PendingInput, PendingResult } from "./pending";
import type { D1Statement, ReconcileD1 } from "./reconcile-d1";

type Plan = { symbol: string; account: string | null; frequency: DcaFrequency; month_day: number | null; ended_at: string | null; updated_at: string };
type ResolveInput = { id: number; outcome: "settled" | "failed" | "cancelled"; shares?: number; confirmedOn?: string; tDate?: string; executionOn?: string; cutoffPeriod?: CutoffPeriod };
const POSITION_SIGNATURE = `SELECT json_array(id,status,execution_on,cutoff_period,dca_plan_id,cost,shares,updated_at) FROM positions WHERE id=?`;

export async function createPendingSubscriptionD1(db: ReconcileD1, input: PendingInput): Promise<PendingResult> {
  if (!["alipay", "gf_direct", "cmb", "jd", "other"].includes(input.account)) return { ok: false, error: "账户不合法" };
  if (!isISODate(input.executionOn)) return { ok: false, error: "请输入实际申购日期" };
  if (input.cutoffPeriod !== "before_15" && input.cutoffPeriod !== "after_15") return { ok: false, error: "请选择 15:00 前或后" };
  if (!Number.isFinite(input.cashDebited) || input.cashDebited <= 0) return { ok: false, error: "实际扣款金额必须大于 0" };
  if (!Number.isFinite(input.feeAmount) || input.feeAmount < 0 || input.feeAmount >= input.cashDebited) return { ok: false, error: "手续费须小于扣款金额" };
  const symbol = input.symbol.trim();
  if (!symbol) return { ok: false, error: "请选择基金" };
  const planId = input.dcaPlanId ?? null;
  if (planId != null && (!Number.isInteger(planId) || planId <= 0)) return { ok: false, error: "定投计划的基金或账户不一致" };
  const bind = (sql: string, ...values: (string | number | null)[]) => db.prepare(sql).bind(...values);
  const [funds, plans, duplicates] = await db.batch([
    bind("SELECT 1 FROM nasdaq_funds WHERE code=? AND currency='CNY'", symbol),
    bind("SELECT symbol,account,frequency,month_day,ended_at,updated_at FROM dca_plans WHERE id=? AND exposure='nasdaq'", planId),
    bind("SELECT 1 FROM positions WHERE dca_plan_id=? AND execution_on=? AND status IN ('pending','settled') LIMIT 1", planId, input.executionOn),
  ]);
  if (!funds.results.length) return { ok: false, error: "请选择目录中的人民币纳指基金" };
  const plan = plans.results[0] as Plan | undefined;
  if (planId != null && (!plan || plan.symbol !== symbol || plan.account !== input.account)) return { ok: false, error: "定投计划的基金或账户不一致" };
  if (plan?.ended_at) return { ok: false, error: "已结束的计划不可记录扣款" };
  if (planId != null && duplicates.results.length) return { ok: false, error: "本期扣款已有待确认或持仓记录" };
  const now = new Date().toISOString();
  const cost = roundDcaMoney(input.cashDebited - input.feeAmount);
  const statements = [bind(`INSERT INTO app_kv(key,value) SELECT '__pending_guard__',NULL WHERE
    NOT EXISTS (SELECT 1 FROM nasdaq_funds WHERE code=? AND currency='CNY') OR (? IS NOT NULL AND (
      NOT EXISTS (SELECT 1 FROM dca_plans WHERE id=? AND exposure='nasdaq' AND symbol IS ? AND account IS ? AND frequency IS ? AND month_day IS ? AND ended_at IS NULL AND updated_at IS ?)
      OR EXISTS (SELECT 1 FROM positions WHERE dca_plan_id=? AND execution_on=? AND status IN ('pending','settled'))))`,
  symbol, planId, planId, plan?.symbol ?? null, plan?.account ?? null, plan?.frequency ?? null, plan?.month_day ?? null, plan?.updated_at ?? null, planId, input.executionOn),
  bind(`INSERT INTO positions (account,exposure,symbol,shares,cost,status,note,recorded_on,execution_on,updated_at,dca_plan_id,cash_debited,fee_amount,cutoff_period,order_origin)
    VALUES (?,'nasdaq',?,NULL,?,'pending',?,?,?,?,?,?,?,?,?) RETURNING id`, input.account, symbol, cost, input.note?.trim() || null,
  input.executionOn, input.executionOn, now, planId, input.cashDebited, input.feeAmount, input.cutoffPeriod, planId == null ? "manual" : "dca")];
  if (plan && planId != null) statements.push(bind("UPDATE dca_plans SET invested_total=invested_total+?,next_debit_date=?,updated_at=? WHERE id=?",
    cost, advanceDebitDate({ frequency: plan.frequency, lastDue: input.executionOn, monthDay: plan.month_day }), now, planId));
  statements.push(portfolioSnapshotStatement(db, beijingTodayISO()) as D1Statement);
  try {
    const result = await db.batch(statements);
    return { ok: true, id: (result[1].results[0] as { id: number }).id };
  } catch { return { ok: false, error: "待确认记录保存失败，请刷新后重试" }; }
}

export async function resolvePendingSubscriptionD1(db: ReconcileD1, input: ResolveInput): Promise<PendingResult> {
  if (!["settled", "failed", "cancelled"].includes(input.outcome)) return { ok: false, error: "处理结果不合法" };
  const [rows] = await db.batch([db.prepare(`SELECT id,execution_on,cutoff_period,dca_plan_id,cost,(${POSITION_SIGNATURE}) AS fingerprint
    FROM positions WHERE id=? AND status='pending'`).bind(input.id, input.id)]);
  const row = rows.results[0] as { id: number; execution_on: string | null; cutoff_period: CutoffPeriod | null; dca_plan_id: number | null; cost: number; fingerprint: string } | undefined;
  if (!row) return { ok: false, error: "找不到这笔待确认申购，或已处理" };
  const executionOn = row.execution_on ?? input.executionOn;
  const cutoff = row.cutoff_period ?? input.cutoffPeriod;
  if (input.outcome === "settled") {
    if (!isISODate(executionOn ?? "")) return { ok: false, error: "请补齐实际申购日期" };
    if (cutoff !== "before_15" && cutoff !== "after_15") return { ok: false, error: "请补齐 15:00 前后信息" };
    if (!Number.isFinite(input.shares) || (input.shares ?? 0) <= 0) return { ok: false, error: "确认份额必须大于 0" };
    if (!isISODate(input.tDate ?? "") || !isISODate(input.confirmedOn ?? "")) return { ok: false, error: "请填写 T 日和份额确认日期" };
    if (input.tDate! < executionOn!) return { ok: false, error: "T 日不能早于申购日期" };
    if (cutoff === "after_15" && input.tDate! <= executionOn!) return { ok: false, error: "15:00 后申购的 T 日须晚于申购日期" };
    if (input.confirmedOn! < input.tDate!) return { ok: false, error: "确认日期不能早于 T 日" };
  }
  const now = new Date().toISOString();
  const statements = [db.prepare(`INSERT INTO app_kv(key,value) SELECT '__pending_resolve_guard__',NULL WHERE (${POSITION_SIGNATURE}) IS NOT ?`).bind(input.id, row.fingerprint)];
  if (input.outcome === "settled") {
    statements.push(db.prepare(`UPDATE positions SET status='settled',shares=?,execution_on=?,cutoff_period=?,t_date=?,recorded_on=?,confirmed_on=?,updated_at=? WHERE id=?`)
      .bind(input.shares!, executionOn!, cutoff!, input.tDate!, input.tDate!, input.confirmedOn!, now, input.id));
  } else {
    statements.push(db.prepare("UPDATE positions SET status=?,closed_on=?,updated_at=? WHERE id=?").bind(input.outcome, now.slice(0, 10), now, input.id));
    if (row.dca_plan_id != null) statements.push(db.prepare("UPDATE dca_plans SET invested_total=MAX(0,invested_total-?) WHERE id=?").bind(row.cost, row.dca_plan_id));
  }
  statements.push(portfolioSnapshotStatement(db, beijingTodayISO()) as D1Statement);
  try { await db.batch(statements); return { ok: true, id: input.id }; }
  catch { return { ok: false, error: "处理待确认申购失败，请刷新后重试" }; }
}
