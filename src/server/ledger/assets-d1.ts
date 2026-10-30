import { beijingTodayISO } from "@/lib/format";
import { portfolioSnapshotStatement } from "../market/nav-d1";
import type { Deposit, Mortgage } from "./index";
import type { D1Statement, ReconcileD1 } from "./reconcile-d1";

export async function readAssetsD1(db: ReconcileD1): Promise<{ deposits: Deposit[]; mortgage: Mortgage | null; cash: number }> {
  const [deposits, mortgage, cash] = await db.batch([
    db.prepare("SELECT id,bank,principal,rate,start_date,maturity_date,can_prepay FROM deposits ORDER BY id").bind(),
    db.prepare("SELECT remaining_principal,monthly_payment,remaining_terms,rate_type,payment_day FROM mortgage WHERE id=1").bind(),
    db.prepare("SELECT amount FROM cash_balance WHERE id=1").bind(),
  ]);
  const rows = deposits.results as Array<{ id: number; bank: string; principal: number; rate: number | null; start_date: string | null; maturity_date: string | null; can_prepay: number }>;
  const row = mortgage.results[0] as { remaining_principal: number; monthly_payment: number | null; remaining_terms: number | null; rate_type: "fixed" | "floating" | null; payment_day: number | null } | undefined;
  return {
    deposits: rows.map((item) => ({ id: item.id, bank: item.bank, principal: item.principal, rate: item.rate,
      startDate: item.start_date, maturityDate: item.maturity_date, canPrepay: item.can_prepay === 1 })),
    mortgage: row ? { remainingPrincipal: row.remaining_principal, monthlyPayment: row.monthly_payment, remainingTerms: row.remaining_terms, rateType: row.rate_type, paymentDay: row.payment_day } : null,
    cash: (cash.results[0] as { amount: number } | undefined)?.amount ?? 0,
  };
}

/** The mutation and same-day investment snapshot commit together. */
export async function writeAssetD1(db: ReconcileD1, sql: string, values: (string | number | null)[]) {
  await db.batch([db.prepare(sql).bind(...values), portfolioSnapshotStatement(db, beijingTodayISO()) as D1Statement]);
}
