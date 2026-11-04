import { buildPersonalQuota, type PersonalQuotaFund, type QuotaOrder, type QuotaPlan } from "@/lib/personal-quota";
import { beijingTodayISO, shiftISO } from "@/lib/format";
import { sumMoney } from "@/lib/decimal";
import type { ReconcileD1 } from "../ledger/reconcile-d1";

/** User-scoped, bounded reads only. Opening the radar never posts DCA entries. */
export async function readPersonalQuota(db: ReconcileD1, userId: string, funds: PersonalQuotaFund[], today = beijingTodayISO()) {
  const results = await db.batch([
    db.prepare(`SELECT p.id,p.symbol,f.currency,p.channel_kind AS channel,p.account,p.amount,p.frequency,p.weekday,
      p.month_day AS monthDay,p.start_date AS startDate,p.imported_through AS importedThrough,p.cutoff_period AS cutoff
      FROM dca_plans p JOIN nasdaq_funds f ON f.code=p.symbol
      WHERE p.user_id=? AND p.status='active' AND p.ended_at IS NULL AND f.venue='otc'`).bind(userId),
    db.prepare(`SELECT p.id,p.symbol,f.currency,p.account,p.dca_plan_id AS planId,
      COALESCE(p.execution_on,CASE WHEN p.dca_plan_id IS NOT NULL THEN p.recorded_on END) AS executionOn,
      p.t_date AS tDate,p.cutoff_period AS cutoff,p.cash_debited,p.cost,p.fee_amount,p.status
      FROM positions p JOIN nasdaq_funds f ON f.code=p.symbol
      WHERE p.user_id=? AND COALESCE(p.execution_on,CASE WHEN p.dca_plan_id IS NOT NULL THEN p.recorded_on END) IS NOT NULL
      AND (p.t_date=? OR COALESCE(p.execution_on,CASE WHEN p.dca_plan_id IS NOT NULL THEN p.recorded_on END) BETWEEN ? AND ?)
      ORDER BY p.id`).bind(userId, today, shiftISO(today, -3), today),
  ]);
  const orders = (results[1].results as (Omit<QuotaOrder, "cash"> & { cash_debited: number | null; cost: number; fee_amount: number })[])
    .map((row) => ({ ...row, cash: row.cash_debited ?? sumMoney([row.cost, row.fee_amount]) }));
  return buildPersonalQuota(funds, results[0].results as QuotaPlan[], orders, today);
}
