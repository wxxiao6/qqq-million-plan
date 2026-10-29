import { isISODate } from "@/lib/format";
import { advanceDebitDate, roundDcaMoney, type DcaFrequency } from "@/lib/dca";
import { getDb } from "../db";
import type { Account, CutoffPeriod } from "./index";

export type PendingResult = { ok: true; id: number } | { ok: false; error: string };
export type PendingInput = {
  symbol: string;
  account: Account;
  executionOn: string;
  cutoffPeriod: CutoffPeriod;
  cashDebited: number;
  feeAmount: number;
  dcaPlanId?: number | null;
  note?: string;
};

export function createPendingSubscription(input: PendingInput): PendingResult {
  const db = getDb();
  if (!["alipay", "gf_direct", "cmb", "jd", "other"].includes(input.account)) return { ok: false, error: "账户不合法" };
  if (!isISODate(input.executionOn)) return { ok: false, error: "请输入实际申购日期" };
  if (input.cutoffPeriod !== "before_15" && input.cutoffPeriod !== "after_15") return { ok: false, error: "请选择 15:00 前或后" };
  if (!Number.isFinite(input.cashDebited) || input.cashDebited <= 0) return { ok: false, error: "实际扣款金额必须大于 0" };
  if (!Number.isFinite(input.feeAmount) || input.feeAmount < 0 || input.feeAmount >= input.cashDebited) return { ok: false, error: "手续费须小于扣款金额" };
  const symbol = input.symbol.trim();
  if (!symbol) return { ok: false, error: "请选择基金" };
  const fund = db.prepare("SELECT 1 FROM nasdaq_funds WHERE code = ? AND currency = 'CNY'").get(symbol);
  if (!fund) return { ok: false, error: "请选择目录中的人民币纳指基金" };

  try {
    const id = db.transaction(() => {
      let plan: { symbol: string; account: string | null; frequency: DcaFrequency; month_day: number | null; ended_at: string | null } | undefined;
      if (input.dcaPlanId != null) {
        plan = db.prepare("SELECT symbol, account, frequency, month_day, ended_at FROM dca_plans WHERE id = ? AND exposure = 'nasdaq'").get(input.dcaPlanId) as typeof plan;
        if (!plan || plan.symbol !== symbol || plan.account !== input.account) throw new Error("定投计划的基金或账户不一致");
        if (plan.ended_at) throw new Error("已结束的计划不可记录扣款");
        const duplicate = db.prepare("SELECT id FROM positions WHERE dca_plan_id = ? AND execution_on = ? AND status IN ('pending', 'settled') LIMIT 1").get(input.dcaPlanId, input.executionOn);
        if (duplicate) throw new Error("本期扣款已有待确认或持仓记录");
      }
      const now = new Date().toISOString();
      const cost = roundDcaMoney(input.cashDebited - input.feeAmount);
      const result = db.prepare(`INSERT INTO positions
        (account, exposure, symbol, shares, cost, status, note, recorded_on, execution_on,
         updated_at, dca_plan_id, cash_debited, fee_amount, cutoff_period, order_origin)
         VALUES (?, 'nasdaq', ?, NULL, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.account, symbol, cost, input.note?.trim() || null, input.executionOn,
          input.executionOn, now, input.dcaPlanId ?? null, input.cashDebited, input.feeAmount,
          input.cutoffPeriod, input.dcaPlanId == null ? "manual" : "dca");
      if (plan && input.dcaPlanId != null) {
        db.prepare("UPDATE dca_plans SET invested_total = invested_total + ?, next_debit_date = ?, updated_at = ? WHERE id = ?")
          .run(cost, advanceDebitDate({ frequency: plan.frequency, lastDue: input.executionOn, monthDay: plan.month_day }), now, input.dcaPlanId);
      }
      return Number(result.lastInsertRowid);
    })();
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "待确认记录保存失败" };
  }
}

export function resolvePendingSubscription(input: { id: number; outcome: "settled" | "failed" | "cancelled"; shares?: number; confirmedOn?: string; tDate?: string; executionOn?: string; cutoffPeriod?: CutoffPeriod }): PendingResult {
  const db = getDb();
  if (!["settled", "failed", "cancelled"].includes(input.outcome)) return { ok: false, error: "处理结果不合法" };
  const row = db.prepare("SELECT id, execution_on, cutoff_period FROM positions WHERE id = ? AND status = 'pending'").get(input.id) as { id: number; execution_on: string | null; cutoff_period: CutoffPeriod | null } | undefined;
  if (!row) return { ok: false, error: "找不到这笔待确认申购，或已处理" };
  if (input.outcome === "settled") {
    const executionOn = row.execution_on ?? input.executionOn;
    const cutoffPeriod = row.cutoff_period ?? input.cutoffPeriod;
    if (!isISODate(executionOn ?? "")) return { ok: false, error: "请补齐实际申购日期" };
    if (cutoffPeriod !== "before_15" && cutoffPeriod !== "after_15") return { ok: false, error: "请补齐 15:00 前后信息" };
    if (!Number.isFinite(input.shares) || (input.shares ?? 0) <= 0) return { ok: false, error: "确认份额必须大于 0" };
    if (!isISODate(input.tDate ?? "") || !isISODate(input.confirmedOn ?? "")) return { ok: false, error: "请填写 T 日和份额确认日期" };
    if (input.tDate! < executionOn!) return { ok: false, error: "T 日不能早于申购日期" };
    if (cutoffPeriod === "after_15" && input.tDate! <= executionOn!) return { ok: false, error: "15:00 后申购的 T 日须晚于申购日期" };
    if (input.confirmedOn! < input.tDate!) return { ok: false, error: "确认日期不能早于 T 日" };
    db.prepare("UPDATE positions SET status = 'settled', shares = ?, execution_on = ?, cutoff_period = ?, t_date = ?, recorded_on = ?, confirmed_on = ?, updated_at = ? WHERE id = ?")
      .run(input.shares, executionOn, cutoffPeriod, input.tDate, input.tDate, input.confirmedOn, new Date().toISOString(), input.id);
  } else {
    db.transaction(() => {
      const position = db.prepare("SELECT dca_plan_id, cost FROM positions WHERE id = ?").get(input.id) as { dca_plan_id: number | null; cost: number };
      db.prepare("UPDATE positions SET status = ?, closed_on = ?, updated_at = ? WHERE id = ?")
        .run(input.outcome, new Date().toISOString().slice(0, 10), new Date().toISOString(), input.id);
      if (position.dca_plan_id != null) db.prepare("UPDATE dca_plans SET invested_total = MAX(0, invested_total - ?) WHERE id = ?")
        .run(position.cost, position.dca_plan_id);
    })();
  }
  return { ok: true, id: input.id };
}
