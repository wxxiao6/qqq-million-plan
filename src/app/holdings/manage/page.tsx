import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/context";
import { PositionForm } from "@/components/holdings/holdings-forms";
import { PendingSubscriptionForm } from "@/components/holdings/pending-forms";
import { HoldingsExplorer } from "@/components/holdings/holdings-explorer";
import { PageHeader } from "@/components/region";
import { listNasdaqHoldingManagers, listNasdaqHoldingNames, listPositionDetails } from "@/server/ledger";
import { listDcaPlans } from "@/server/dca";
import { readHoldingsManagementD1 } from "@/server/holdings/read-d1";

export const dynamic = "force-dynamic";

function readLocalHoldings() {
  const positions = listPositionDetails().filter((position) => position.exposure === "nasdaq");
  const names = listNasdaqHoldingNames();
  const managers = listNasdaqHoldingManagers();
  return { positions, names, managers, plans: listDcaPlans() };
}

export default async function HoldingsManagePage() {
  if (!await getCurrentUser()) redirect("/login");
  const data = process.env.CLOUDFLARE_RUNTIME === "1"
    ? await (async () => {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      return readHoldingsManagementD1((getCloudflareContext().env as unknown as { DB: Parameters<typeof readHoldingsManagementD1>[0] }).DB);
    })()
    : readLocalHoldings();
  const { positions, names, managers, plans } = data;
  return <>
    <PageHeader
      title="持仓管理"
      lead="按基金查看市值与收益，展开后按销售渠道查看实际持有。"
      aside={<div className="flex gap-2"><PendingSubscriptionForm names={names} plans={plans} /><PositionForm fundOptions={names} fundManagers={managers} /></div>}
    />

    <div className="space-y-6">
      <HoldingsExplorer positions={positions} names={names} managers={managers} />
    </div>
  </>;
}

