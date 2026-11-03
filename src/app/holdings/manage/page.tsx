import { getDb } from "@/server/db";
import { HOLDING_FUNDS_SQL, PENDING_FUNDS_SQL } from "@/server/funds/personal";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/context";
import { PositionForm } from "@/components/holdings/holdings-forms";
import { PendingSubscriptionForm } from "@/components/holdings/pending-forms";
import { HoldingsExplorer } from "@/components/holdings/holdings-explorer";
import { PageHeader } from "@/components/region";
import { listNasdaqHoldingManagers, listPositionDetails } from "@/server/ledger";
import { listDcaPlans } from "@/server/dca";
import { readHoldingsManagementD1 } from "@/server/holdings/read-d1";
import { isQdiiFund } from "@/lib/holdings-dashboard";

export const dynamic = "force-dynamic";

function readLocalHoldings() {
  const positions = listPositionDetails().filter((position) => (position.exposure === "nasdaq" || position.exposure === "fund"));
  const funds = getDb().prepare(HOLDING_FUNDS_SQL).all() as Array<{ code: string; name: string; manager: string | null; fundType: string | null; isNasdaq: number; syncError: string | null }>;
  const pendingFunds = getDb().prepare(PENDING_FUNDS_SQL).all() as Array<{ code: string; name: string; manager: string | null }>;
  const names = Object.fromEntries(funds.map((fund) => [fund.code, fund.name]));
  const managers = { ...Object.fromEntries(pendingFunds.filter((fund) => fund.manager).map((fund) => [fund.code, fund.manager!])), ...Object.fromEntries(funds.filter((fund) => fund.manager).map((fund) => [fund.code, fund.manager!])), ...listNasdaqHoldingManagers() };
  const syncErrors = Object.fromEntries(funds.filter((fund) => fund.syncError).map((fund) => [fund.code, fund.syncError!]));
  const qdiiFunds = Object.fromEntries(funds.map((fund) => [fund.code, isQdiiFund(fund.name, fund.fundType, Boolean(fund.isNasdaq))]));
  return { positions, names, managers, syncErrors, qdiiFunds, pendingNames: Object.fromEntries(pendingFunds.map((fund) => [fund.code, fund.name])), plans: listDcaPlans() };
}

export default async function HoldingsManagePage() {
  if (!await getCurrentUser()) redirect("/quota");
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
      aside={<div className="flex gap-2"><PendingSubscriptionForm names={data.pendingNames} plans={plans} managers={managers} /><PositionForm fundOptions={names} fundManagers={managers} existingPositions={positions.map(({ id, account, symbol, status, dcaPlanId }) => ({ id, account, symbol, status, dcaPlanId }))} /></div>}
    />

    <div className="space-y-6">
      <HoldingsExplorer positions={positions} names={names} managers={managers} syncErrors={data.syncErrors} qdiiFunds={data.qdiiFunds} />
    </div>
  </>;
}

