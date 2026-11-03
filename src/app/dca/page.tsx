import { DcaDashboard } from "@/components/dca/dca-dashboard";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/context";
import { DcaPlanForm } from "@/components/holdings/dca-forms";
import { PageHeader } from "@/components/region";
import { todayISO } from "@/lib/format";
import { getDcaBoard, listDcaExecutionHistory } from "@/server/dca";
import { listNasdaqHoldingManagers } from "@/server/ledger";
import { readDcaDashboardD1, type ReadD1 } from "@/server/dca/read-d1";

export const dynamic = "force-dynamic";

export default async function DcaPage({ searchParams }: { searchParams: Promise<{ record?: string | string[] }> }) {
  if (!await getCurrentUser()) redirect("/quota");
  const { record } = await searchParams;
  const requestedRecordId = typeof record === "string" && /^\d+$/.test(record) && Number.isSafeInteger(Number(record)) && Number(record) > 0 ? Number(record) : null;
  let data: Awaited<ReturnType<typeof readDcaDashboardD1>>;
  if (process.env.CLOUDFLARE_RUNTIME === "1") {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const db = (getCloudflareContext().env as unknown as { DB: ReadD1 }).DB;
    data = await readDcaDashboardD1(db);
  } else {
    const board = getDcaBoard();
    const planIds = new Set(board.plans.map((plan) => plan.id));
    data = { board, records: listDcaExecutionHistory().filter((record) => planIds.has(record.planId)), managers: listNasdaqHoldingManagers() };
  }
  const { board, records, managers } = data;
  return <>
    <PageHeader title="定投管理" lead="按计划自动生成记账记录，实际扣款以购买渠道为准。"
      aside={<DcaPlanForm candidates={board.candidates} emptyUniverse={board.emptyUniverse} managers={managers} existingPlans={board.plans} triggerLabel="新增定投" prominent />} />
    <DcaDashboard key={requestedRecordId ?? "overview"} requestedRecordId={requestedRecordId} plans={board.plans} candidates={board.candidates} emptyUniverse={board.emptyUniverse} records={records} managers={managers} syncErrors={[]} today={todayISO()} />
  </>;
}
