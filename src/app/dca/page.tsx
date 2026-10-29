import { DcaDashboard } from "@/components/dca/dca-dashboard";
import { DcaPlanForm } from "@/components/holdings/dca-forms";
import { PageHeader } from "@/components/region";
import { reconcileDueDcaPlans } from "@/server/ledger/recent-pending";
import { todayISO } from "@/lib/format";
import { getDcaBoard, listDcaExecutionHistory } from "@/server/dca";
import { listNasdaqHoldingManagers } from "@/server/ledger";

export const dynamic = "force-dynamic";

export default function DcaPage() {
  const syncErrors = reconcileDueDcaPlans();
  const board = getDcaBoard();
  const planIds = new Set(board.plans.map((plan) => plan.id));
  const records = listDcaExecutionHistory().filter((record) => planIds.has(record.planId));
  return <>
    <PageHeader title="定投管理" lead="按计划自动生成记账记录，实际扣款以购买渠道为准。"
      aside={<DcaPlanForm candidates={board.candidates} emptyUniverse={board.emptyUniverse} triggerLabel="＋ 新增定投" prominent />} />
    <DcaDashboard plans={board.plans} candidates={board.candidates} emptyUniverse={board.emptyUniverse} records={records} managers={listNasdaqHoldingManagers()} syncErrors={syncErrors} today={todayISO()} />
  </>;
}
