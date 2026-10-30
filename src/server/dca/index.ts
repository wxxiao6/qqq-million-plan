import { importPastPlanPending, reconcileDueDcaPlan } from "../ledger/recent-pending";
/** 纳指定投计划。借额度宇宙与渠道状态；P0 只做计划与额度预留。 */

import {
  dcaChannelWarning,
  dcaFrequencyLabel,
  deriveNextDebitDate,
  calculateDcaFee,
  dcaPostNote,
  normalizeDcaFee,
  roundDcaMoney,
  resolveDcaAccount,
  validateDcaInput,
  type DcaBoard,
  type DcaChannelKind,
  type DcaFeeKind,
  type DcaFrequency,
  type DcaInput,
  type DcaExecutionInput,
  type DcaPlanStatus,
  type DcaPlanView,
  type DcaShareCandidate,
  type DcaShareClass,
} from "@/lib/dca";
import { getDb } from "../db";
import { listEffectiveQuotaCells } from "../funds/effective-quotes";
import { beijingTodayISO, isISODate, shiftISO, todayISO } from "@/lib/format";
import { createPendingSubscription } from "../ledger/pending";
import { listPositions, type Account } from "../ledger";

export type { DcaBoard, DcaPlanView as DcaPlan, DcaShareCandidate };

function validateExecution(input: DcaExecutionInput | null | undefined): string | null {
  if (!input || input.status === "not_bought") return null;
  if (!isISODate(input.executionDate ?? "")) return "请输入实际买入日期";
  if (input.actualCashDebited != null && (!Number.isFinite(input.actualCashDebited) || input.actualCashDebited <= 0)) return "实际扣款金额不合法";
  if (input.actualFeeAmount != null && (!Number.isFinite(input.actualFeeAmount) || input.actualFeeAmount < 0)) {
    return "实际手续费不合法";
  }
  return null;
}

export type PlanRow = {
  id: number;
  exposure: "nasdaq";
  symbol: string;
  share_class: DcaShareClass;
  name: string | null;
  channel_kind: DcaChannelKind;
  account: string | null;
  amount: number;
  invested_total: number;
  fee_kind: DcaFeeKind | null;
  fee_value: number | null;
  frequency: DcaFrequency;
  weekday: number | null;
  month_day: number | null;
  start_date: string;
  next_debit_date: string | null;
  imported_through: string | null;
  cutoff_period: "before_15" | "after_15";
  status: "active" | "paused";
  ended_at: string | null;
  note: string | null;
};

export type UniverseRow = {
  symbol: string;
  share_class: DcaShareClass;
  name: string;
  currency: "CNY" | "USD";
  market_type: "otc" | "etf" | "lof";
};

export type CellRow = {
  symbol: string;
  share_class: string;
  channel_kind: DcaChannelKind;
  status: string;
  daily_limit: number | null;
};

export const DCA_UNIVERSE_SQL = `SELECT code AS symbol, share_class, name
       FROM nasdaq_funds
       WHERE currency = 'CNY' AND market_type = 'otc'
       ORDER BY code, share_class`;

function loadCandidates(): DcaShareCandidate[] {
  const universe = getDb().prepare(DCA_UNIVERSE_SQL).all() as UniverseRow[];
  return buildDcaCandidates(universe, listEffectiveQuotaCells(getDb()));
}

export function buildDcaCandidates(universe: UniverseRow[], cells: CellRow[]): DcaShareCandidate[] {
  const cellMap = new Map<string, CellRow>();
  for (const cell of cells) {
    cellMap.set(
      `${cell.symbol}:${cell.share_class}:${cell.channel_kind}`,
      cell,
    );
  }
  return universe.map((row) => ({
    symbol: row.symbol,
    shareClass: row.share_class,
    name: row.name,
    key: `${row.symbol}:${row.share_class}`,
    directStatus:
      cellMap.get(`${row.symbol}:${row.share_class}:direct`)?.status ?? null,
    agencyStatus:
      cellMap.get(`${row.symbol}:${row.share_class}:agency`)?.status ?? null,
    directDailyLimit: cellMap.get(`${row.symbol}:${row.share_class}:direct`)?.daily_limit ?? null,
    agencyDailyLimit: cellMap.get(`${row.symbol}:${row.share_class}:agency`)?.daily_limit ?? null,
  }));
}

function cellStatusFor(
  candidates: DcaShareCandidate[],
  symbol: string,
  shareClass: string,
  channelKind: DcaChannelKind,
): string | null {
  const found = candidates.find(
    (row) => row.symbol === symbol && row.shareClass === shareClass,
  );
  if (!found) return null;
  return channelKind === "direct" ? found.directStatus : found.agencyStatus;
}

function mapPlan(row: PlanRow, candidates: DcaShareCandidate[], recordedDates: string[]): DcaPlanView {
  const status = cellStatusFor(
    candidates,
    row.symbol,
    row.share_class,
    row.channel_kind,
  );
  const nextDebitDate = deriveNextDebitDate({
    frequency: row.frequency,
    startDate: row.start_date,
    weekday: row.weekday,
    monthDay: row.month_day,
    recordedDates,
    accountedThrough: row.imported_through,
  });
  return {
    id: row.id,
    exposure: row.exposure ?? "nasdaq",
    symbol: row.symbol,
    shareClass: row.share_class,
    name: row.name,
    channelKind: row.channel_kind,
    account: row.account,
    amount: row.amount,
    investedTotal: row.invested_total,
    fundInvestedTotal: row.invested_total,
    feeKind: row.fee_kind,
    feeValue: row.fee_value,
    frequency: row.frequency,
    weekday: row.weekday,
    monthDay: row.month_day,
    startDate: row.start_date,
    nextDebitDate,
    cutoffPeriod: row.cutoff_period,
    dueToday: row.status === "active" && nextDebitDate === todayISO(),
    status: row.ended_at ? "ended" : row.status,
    note: row.note,
    frequencyLabel: dcaFrequencyLabel(row.frequency, row.weekday, row.month_day),
    channelWarning:
      (row.exposure ?? "nasdaq") === "nasdaq" ? dcaChannelWarning(status) : null,
  };
}

export function listDcaShareCandidates(): DcaShareCandidate[] {
  return loadCandidates();
}

export const DCA_PLANS_SQL = `SELECT p.id, p.exposure, p.symbol, p.share_class, f.name, p.channel_kind, p.account,
              p.amount, p.invested_total, p.fee_kind, p.fee_value, p.frequency, p.weekday,
              p.month_day, p.start_date, p.next_debit_date, p.imported_through, p.cutoff_period, p.status, p.ended_at, p.note
       FROM dca_plans p LEFT JOIN nasdaq_funds f ON f.code = p.symbol
       WHERE p.exposure = 'nasdaq' ORDER BY p.id`;
export const DCA_RECORDED_DATES_SQL = `SELECT dca_plan_id, COALESCE(execution_on, recorded_on) AS date
    FROM positions WHERE dca_plan_id IS NOT NULL AND status IN ('pending', 'settled')`;
export type DcaRecordedDate = { dca_plan_id: number; date: string | null };

export function listDcaPlans(): DcaPlanView[] {
  const candidates = loadCandidates();
  const rows = getDb().prepare(DCA_PLANS_SQL).all() as PlanRow[];
  const executions = getDb().prepare(DCA_RECORDED_DATES_SQL).all() as DcaRecordedDate[];
  return buildDcaPlans(rows, candidates, executions);
}

export function buildDcaPlans(rows: PlanRow[], candidates: DcaShareCandidate[], executions: DcaRecordedDate[]): DcaPlanView[] {
  const recordedDates = new Map<number, string[]>();
  for (const execution of executions) {
    if (!execution.date) continue;
    const dates = recordedDates.get(execution.dca_plan_id) ?? [];
    dates.push(execution.date);
    recordedDates.set(execution.dca_plan_id, dates);
  }
  const plans = rows.map((row) => mapPlan(row, candidates, recordedDates.get(row.id) ?? []));
  const totals = new Map<string, number>();
  for (const plan of plans) {
    const key = `${plan.exposure}:${plan.symbol}:${plan.shareClass}`;
    totals.set(key, (totals.get(key) ?? 0) + plan.investedTotal);
  }
  return plans.map((plan) => ({
    ...plan,
    fundInvestedTotal:
      totals.get(`${plan.exposure}:${plan.symbol}:${plan.shareClass}`) ?? 0,
  }));
}

export function getDcaBoard(): DcaBoard {
  const candidates = loadCandidates();
  const plans = listDcaPlans();
  return {
    plans,
    candidates,
    activeCount: plans.filter((plan) => plan.status === "active").length,
    totalInvested: plans.reduce((sum, plan) => sum + plan.investedTotal, 0),
    emptyUniverse: candidates.length === 0,
  };
}

export type DcaFeeDetail = {
  positionId: number;
  planId: number;
  symbol: string;
  account: string;
  recordedOn: string | null;
  tDate: string | null;
  executionOn: string | null;
  cashDebited: number;
  feeAmount: number;
  subscriptionAmount: number;
  autoGenerated: boolean;
  cutoffPeriod: "before_15" | "after_15" | null;
  status: "pending" | "settled" | "failed" | "cancelled";
};

export function listDcaFeeDetails(): DcaFeeDetail[] {
  return listDcaExecutionHistory().filter((record) => record.status === "pending" || record.status === "settled");
}

export const DCA_HISTORY_SQL = `SELECT p.id AS position_id, p.dca_plan_id, p.symbol, p.account,
              p.recorded_on, p.t_date, p.execution_on, COALESCE(p.cash_debited, p.cost) AS cash_debited,
              COALESCE(p.fee_amount, 0) AS fee_amount, p.cost AS subscription_amount,
              p.status, p.auto_generated, p.cutoff_period
       FROM positions p
       JOIN dca_plans d ON d.id = p.dca_plan_id AND d.exposure = 'nasdaq'
       WHERE p.status IN ('pending', 'settled', 'failed', 'cancelled')
       ORDER BY COALESCE(p.execution_on, p.recorded_on) DESC, p.id DESC`;

export function listDcaExecutionHistory(): DcaFeeDetail[] {
  return mapDcaHistory(getDb().prepare(DCA_HISTORY_SQL).all());
}

export function mapDcaHistory(rows: unknown[]): DcaFeeDetail[] {
  return rows.map((row) => {
      const value = row as {
        position_id: number;
        dca_plan_id: number;
        symbol: string;
        account: string;
        recorded_on: string | null;
        t_date: string | null;
        execution_on: string | null;
        cash_debited: number;
        fee_amount: number;
        subscription_amount: number;
        auto_generated: number;
        cutoff_period: "before_15" | "after_15" | null;
        status: DcaFeeDetail["status"];
      };
      return {
        positionId: value.position_id,
        planId: value.dca_plan_id,
        symbol: value.symbol,
        account: value.account,
        recordedOn: value.recorded_on,
        tDate: value.t_date,
        executionOn: value.execution_on,
        cashDebited: value.cash_debited,
        feeAmount: value.fee_amount,
        subscriptionAmount: value.subscription_amount,
        autoGenerated: value.auto_generated === 1,
        cutoffPeriod: value.cutoff_period,
        status: value.status,
      };
    });
}

export function getDcaFeeTotal(): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(p.fee_amount, 0)), 0) AS total
       FROM positions p JOIN dca_plans d ON d.id = p.dca_plan_id AND d.exposure = 'nasdaq'
       WHERE p.status IN ('pending', 'settled')`,
    )
    .get() as { total: number };
  return row.total;
}

export type DcaWriteResult =
  | { ok: true; id: number }
  | { ok: false; error: string };

export function upsertDcaPlan(
  input: DcaInput & { id?: number },
  options?: { importPastPending: boolean },
): DcaWriteResult {
  try {
    return getDb().transaction(() => {
      // Settle due periods under the old terms before changing a running plan.
      if (input.id && options) reconcileDueDcaPlan(input.id);
      const result = upsertDcaPlanInternal(input);
      if (!result.ok) throw new Error(result.error);
      getDb().prepare('UPDATE dca_plans SET cutoff_period=? WHERE id=?').run(input.cutoffPeriod ?? 'before_15', result.id);
      if (!input.id && options?.importPastPending) {
        importPastPlanPending(result.id);
        reconcileDueDcaPlan(result.id);
      }
      return result;
    }).immediate();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "定投计划保存失败" };
  }
}

function upsertDcaPlanInternal(
  input: DcaInput & { id?: number },
): DcaWriteResult {
  const error = validateDcaInput(input);
  if (error) return { ok: false, error };
  const executionError = validateExecution(input.execution);
  if (executionError) return { ok: false, error: executionError };

  const channelKind = input.channelKind as DcaChannelKind;
  const resolvedAccount = resolveDcaAccount(channelKind, input.account);
  if (!resolvedAccount.ok) return { ok: false, error: resolvedAccount.error };
  const fee = normalizeDcaFee(input.feeKind, input.feeValue);
  if (!fee.ok) return { ok: false, error: fee.error };

  const candidates = loadCandidates();
  const inUniverse = candidates.some(
    (row) =>
      row.symbol === input.symbol.trim() && row.shareClass === input.shareClass,
  );
  if (!inUniverse) {
    return { ok: false, error: "请选择支持定投的人民币场外份额" };
  }

  const duplicate = getDb().prepare(
    "SELECT id FROM dca_plans WHERE exposure = 'nasdaq' AND symbol = ? AND account = ? AND ended_at IS NULL AND id <> ? LIMIT 1",
  ).get(input.symbol.trim(), resolvedAccount.account, input.id ?? -1);
  if (duplicate) return { ok: false, error: "该购买平台已存在此基金的定投计划，请编辑或恢复已有计划" };

  const frequency = input.frequency as DcaFrequency;
  const weekday =
    frequency === "weekly" || frequency === "biweekly"
      ? (input.weekday ?? null)
      : null;
  const monthDay = frequency === "monthly" ? (input.monthDay ?? null) : null;
  const nextDebitDate = deriveNextDebitDate({
    frequency,
    startDate: input.startDate,
    weekday,
    monthDay,
  });
  const now = new Date().toISOString();
  const account = resolvedAccount.account;
  const note = input.note?.trim() || null;

  if (input.id) {
    const existing = getDb()
      .prepare("SELECT id, symbol, share_class, ended_at FROM dca_plans WHERE id = ? AND exposure = 'nasdaq'")
      .get(input.id) as { id: number; symbol: string; share_class: string; ended_at: string | null } | undefined;
    if (!existing) return { ok: false, error: "找不到该定投计划" };
    if (existing.ended_at) return { ok: false, error: "已结束的计划不可修改" };
    if ((existing.symbol !== input.symbol.trim() || existing.share_class !== input.shareClass) && getDb().prepare("SELECT 1 FROM positions WHERE dca_plan_id = ? LIMIT 1").get(input.id)) {
      return { ok: false, error: "已有扣款记录的计划不可修改基金或份额" };
    }
    getDb()
      .prepare(
        `UPDATE dca_plans
         SET exposure = 'nasdaq', symbol = ?, share_class = ?, channel_kind = ?, account = ?,
             amount = ?, fee_kind = ?, fee_value = ?, frequency = ?,
             weekday = ?, month_day = ?, start_date = ?, next_debit_date = ?,
             note = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.symbol.trim(),
        input.shareClass,
        channelKind,
        account,
        input.amount,
        fee.feeKind,
        fee.feeValue,
        frequency,
        weekday,
        monthDay,
        input.startDate,
        nextDebitDate,
        note,
        now,
        input.id,
      );
    // The plan and all its historical records represent one account assignment.
    getDb().prepare("UPDATE positions SET account = ?, updated_at = ? WHERE dca_plan_id = ? AND account <> ?")
      .run(account, now, input.id, account);
    const execution = recordDcaExecution({
      planId: input.id,
      symbol: input.symbol.trim(),
      account,
      amount: input.amount,
      feeKind: fee.feeKind,
      feeValue: fee.feeValue,
      execution: input.execution,
      frequency,
      monthDay,
    });
    return execution.ok ? { ok: true, id: input.id } : execution;
  }

  const result = getDb()
    .prepare(
      `INSERT INTO dca_plans (
         exposure, symbol, share_class, channel_kind, account, amount, fee_kind, fee_value,
         frequency, weekday, month_day, start_date, next_debit_date, status,
         note, updated_at
       ) VALUES ('nasdaq', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run(
      input.symbol.trim(),
      input.shareClass,
      channelKind,
      account,
      input.amount,
      fee.feeKind,
      fee.feeValue,
      frequency,
      weekday,
      monthDay,
      input.startDate,
      nextDebitDate,
      note,
      now,
    );
  const id = Number(result.lastInsertRowid);
  const execution = recordDcaExecution({
    planId: id,
    symbol: input.symbol.trim(),
    account,
    amount: input.amount,
    feeKind: fee.feeKind,
    feeValue: fee.feeValue,
    execution: input.execution,
    frequency,
    monthDay,
  });
  return execution.ok ? { ok: true, id } : execution;
}

function recordDcaExecution(input: {
  planId: number;
  symbol: string;
  account: string;
  amount: number;
  feeKind: DcaFeeKind | null;
  feeValue: number | null;
  execution: DcaExecutionInput | null | undefined;
  frequency: DcaFrequency;
  monthDay: number | null;
}): DcaWriteResult {
  const execution = input.execution;
  if (!execution || execution.status === "not_bought") return { ok: true, id: input.planId };
  const executionDate = execution.executionDate as string;
  const cashDebited = execution.actualCashDebited ?? input.amount;
  const feeAmount = calculateDcaFee(
    cashDebited,
    input.feeKind,
    input.feeValue,
    execution.actualFeeAmount,
  );
  const subscriptionAmount = roundDcaMoney(cashDebited - feeAmount);
  if (subscriptionAmount <= 0) return { ok: false, error: "手续费不能大于等于定投金额" };
  return createPendingSubscription({
    symbol: input.symbol, account: input.account as "alipay" | "gf_direct" | "cmb" | "jd" | "other",
    executionOn: executionDate,
    cutoffPeriod: execution.status === "bought_before_cutoff" ? "before_15" : "after_15",
    cashDebited, feeAmount, dcaPlanId: input.planId,
    note: dcaPostNote(executionDate),
  });
}

/** 已有计划的真实扣款单独记录，不触碰计划配置。 */
export function recordPlanExecution(planId: number, execution: DcaExecutionInput): DcaWriteResult {
  if (execution.status !== "bought_before_cutoff" && execution.status !== "bought_after_cutoff") {
    return { ok: false, error: "请选择 15:00 前或后" };
  }
  const error = validateExecution(execution);
  if (error) return { ok: false, error };
  const plan = getDb().prepare(
    `SELECT id, symbol, account, amount, fee_kind, fee_value, frequency, month_day, ended_at
     FROM dca_plans WHERE id = ? AND exposure = 'nasdaq'`,
  ).get(planId) as {
    id: number; symbol: string; account: string | null; amount: number;
    fee_kind: DcaFeeKind | null; fee_value: number | null;
    frequency: DcaFrequency; month_day: number | null; ended_at: string | null;
  } | undefined;
  if (!plan || !plan.account) return { ok: false, error: "找不到该纳指定投计划" };
  if (plan.ended_at) return { ok: false, error: "已结束的计划不可记录扣款" };
  return recordDcaExecution({
    planId: plan.id, symbol: plan.symbol, account: plan.account,
    amount: plan.amount, feeKind: plan.fee_kind, feeValue: plan.fee_value,
    execution, frequency: plan.frequency, monthDay: plan.month_day,
  });
}

export function setDcaPlanStatus(
  id: number,
  status: DcaPlanStatus,
): DcaWriteResult {
  if (status !== "active" && status !== "paused" && status !== "ended") {
    return { ok: false, error: "状态不合法" };
  }
  const db = getDb();
  const existing = db.prepare("SELECT id, status, ended_at FROM dca_plans WHERE id = ? AND exposure = 'nasdaq'")
    .get(id) as { id: number; status: "active" | "paused"; ended_at: string | null } | undefined;
  if (!existing) return { ok: false, error: "找不到该定投计划" };
  if (existing.ended_at) return { ok: false, error: "计划已结束，无法更改状态" };
  try {
    db.transaction(() => {
      if (existing.status === "active" && status !== "active") reconcileDueDcaPlan(id);
      const now = new Date().toISOString();
      if (existing.status === "paused" && status === "active") {
        const duplicate = db.prepare(`SELECT 1 FROM dca_plans other JOIN dca_plans current ON current.id = ?
          WHERE other.id <> current.id AND other.exposure = 'nasdaq' AND other.symbol = current.symbol
            AND other.account = current.account AND other.ended_at IS NULL LIMIT 1`).get(id);
        if (duplicate) throw new Error("该购买平台已存在此基金的定投计划，请先处理重复计划");
        const yesterday = shiftISO(beijingTodayISO(), -1);
        db.prepare("UPDATE dca_plans SET imported_through = CASE WHEN imported_through IS NULL OR imported_through < ? THEN ? ELSE imported_through END WHERE id = ?").run(yesterday, yesterday, id);
      }
      db.prepare("UPDATE dca_plans SET status = ?, ended_at = ?, updated_at = ? WHERE id = ?")
        .run(status === "active" ? "active" : "paused", status === "ended" ? now : null, now, id);
      if (existing.status === "paused" && status === "active") reconcileDueDcaPlan(id);
    })();
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "计划状态更新失败" }; }
  return { ok: true, id };
}

export function removeDcaPlan(id: number): DcaWriteResult {
  const existing = getDb()
    .prepare("SELECT id FROM dca_plans WHERE id = ? AND exposure = 'nasdaq'")
    .get(id) as { id: number } | undefined;
  if (!existing) return { ok: false, error: "找不到该定投计划" };
  if (getDb().prepare("SELECT 1 FROM positions WHERE dca_plan_id = ? LIMIT 1").get(id)) {
    return { ok: false, error: "计划已有扣款记录，请暂停计划以保留账本关联" };
  }
  getDb().prepare("DELETE FROM dca_plans WHERE id = ?").run(id);
  return { ok: true, id };
}

/** 修正已自动记账的金额，或将该笔标为失败／撤单。 */
export function correctDcaExecution(input: { id: number; cashDebited: number; feeAmount: number; outcome: "keep" | "failed" | "cancelled" }): DcaWriteResult {
  if (!Number.isFinite(input.cashDebited) || input.cashDebited <= 0) return { ok: false, error: "记账金额必须大于 0" };
  if (!Number.isFinite(input.feeAmount) || input.feeAmount < 0 || input.feeAmount >= input.cashDebited) return { ok: false, error: "手续费须小于记账金额" };
  if (!["keep", "failed", "cancelled"].includes(input.outcome)) return { ok: false, error: "处理方式不合法" };
  const db = getDb();
  try {
    return db.transaction(() => {
      const row = db.prepare(`SELECT dca_plan_id, status, cost, auto_generated, t_nav, shares
        FROM positions WHERE id=? AND dca_plan_id IS NOT NULL`).get(input.id) as {
          dca_plan_id: number; status: string; cost: number; auto_generated: number; t_nav: number | null; shares: number | null;
        } | undefined;
      if (!row || (row.status !== "pending" && row.status !== "settled")) return { ok: false as const, error: "找不到可修正的定投记录" };
      const cost = roundDcaMoney(input.cashDebited - input.feeAmount);
      const removed = input.outcome !== "keep";
      const shares = row.auto_generated && row.t_nav && row.t_nav > 0 ? Math.round((cost / row.t_nav + Number.EPSILON) * 100) / 100 : row.shares;
      db.prepare(`UPDATE positions SET cash_debited=?, fee_amount=?, cost=?, shares=?, status=?, closed_on=?, updated_at=? WHERE id=?`)
        .run(input.cashDebited, input.feeAmount, cost, shares, removed ? input.outcome : row.status, removed ? beijingTodayISO() : null, new Date().toISOString(), input.id);
      db.prepare("UPDATE dca_plans SET invested_total=MAX(0, invested_total + ?), updated_at=? WHERE id=?")
        .run(removed ? -row.cost : cost - row.cost, new Date().toISOString(), row.dca_plan_id);
      return { ok: true as const, id: input.id };
    })();
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "修正记账失败" }; }
}
