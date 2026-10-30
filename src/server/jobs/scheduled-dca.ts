import { beijingTodayISO } from "../../lib/format";
import { reconcileDueDcaPlansD1, type ReconcileD1 } from "../ledger/reconcile-d1";

/** Cloudflare Cron runs at 18:00 UTC, or 02:00 the next day in Beijing. */
export async function runScheduledDca(db: ReconcileD1, scheduledTime: Date) {
  const bizDate = beijingTodayISO(scheduledTime);
  const errors = await reconcileDueDcaPlansD1(db, bizDate);
  if (errors.length) throw new Error(`定投自动记账失败（${bizDate}）：${errors.join("；")}`);
  console.log(JSON.stringify({ job: "dca_reconcile", bizDate, ok: true }));
}
