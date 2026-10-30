import { DcaDashboard } from "@/components/dca/dca-dashboard";
import { DcaPlanForm } from "@/components/holdings/dca-forms";
import { PageHeader } from "@/components/region";
import { reconcileDueDcaPlans } from "@/server/ledger/recent-pending";
import { todayISO } from "@/lib/format";
import { getDcaBoard, listDcaExecutionHistory } from "@/server/dca";
import { listNasdaqHoldingManagers } from "@/server/ledger";
import { reconcileDueDcaPlansD1, type ReconcileD1 } from "@/server/ledger/reconcile-d1";
import { readDcaDashboardD1, type ReadD1 } from "@/server/dca/read-d1";

export const dynamic = "force-dynamic";

export default async function DcaPage() {
  let data: Awaited<ReturnType<typeof readDcaDashboardD1>>;
  let syncErrors: string[];
  if (process.env.CLOUDFLARE_RUNTIME === "1") {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const db = (getCloudflareContext().env as unknown as { DB: ReconcileD1 & ReadD1 }).DB;
    syncErrors = await reconcileDueDcaPlansD1(db);
    data = await readDcaDashboardD1(db);
  } else {
    syncErrors = reconcileDueDcaPlans();
    const board = getDcaBoard();
    const planIds = new Set(board.plans.map((plan) => plan.id));
    data = { board, records: listDcaExecutionHistory().filter((record) => planIds.has(record.planId)), managers: listNasdaqHoldingManagers() };
  }
  const { board, records, managers } = data;
  return <>
    <PageHeader title="定投管理" lead="按计划自动生成记账记录，实际扣款以购买渠道为准。"
      aside={<DcaPlanForm candidates={board.candidates} emptyUniverse={board.emptyUniverse} triggerLabel="＋ 新增定投" prominent />} />
    <DcaDashboard plans={board.plans} candidates={board.candidates} emptyUniverse={board.emptyUniverse} records={records} managers={managers} syncErrors={syncErrors} today={todayISO()} />
  </>;
}
