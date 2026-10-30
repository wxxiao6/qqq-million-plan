import { PositionForm } from "@/components/holdings/holdings-forms";
import { PendingSubscriptionForm } from "@/components/holdings/pending-forms";
import { HoldingsExplorer } from "@/components/holdings/holdings-explorer";
import { PageHeader } from "@/components/region";
import { getManagementFeeSummary, listNasdaqHoldingManagers, listNasdaqHoldingNames, listPositionDetails } from "@/server/ledger";
import { listDcaPlans } from "@/server/dca";
import { readHoldingsManagementD1 } from "@/server/holdings/read-d1";

export const dynamic = "force-dynamic";

function readLocalHoldings() {
  const positions = listPositionDetails().filter((position) => position.exposure === "nasdaq");
  const names = listNasdaqHoldingNames();
  const managers = listNasdaqHoldingManagers();
  const managementFees = Object.fromEntries(
    [...new Set(positions.map((position) => position.symbol))].map((symbol) => {
      const fundPositions = positions.filter((position) => position.symbol === symbol);
      const fee = getManagementFeeSummary({
        positions: fundPositions,
        symbol,
        rawMarketValue: fundPositions.reduce((sum, position) => sum + (position.marketValue ?? 0), 0) || null,
        cost: fundPositions.filter((position) => position.status === "settled").reduce((sum, position) => sum + position.cost, 0),
      });
      return [symbol, fee];
    }),
  );
  const platformManagementFees = Object.fromEntries(
    [...new Set(positions.map((position) => `${position.symbol}:${position.account}`))].map((key) => {
      const [symbol, account] = key.split(":");
      const platformPositions = positions.filter((position) => position.symbol === symbol && position.account === account);
      return [key, getManagementFeeSummary({
        positions: platformPositions,
        symbol,
        account: account as Parameters<typeof getManagementFeeSummary>[0]["account"],
        rawMarketValue: platformPositions.reduce((sum, position) => sum + (position.marketValue ?? 0), 0) || null,
        cost: platformPositions.filter((position) => position.status === "settled").reduce((sum, position) => sum + position.cost, 0),
      })];
    }),
  );

  return { positions, names, managers, managementFees, platformManagementFees, plans: listDcaPlans() };
}

export default async function HoldingsManagePage() {
  const data = process.env.CLOUDFLARE_RUNTIME === "1"
    ? await (async () => {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      return readHoldingsManagementD1((getCloudflareContext().env as unknown as { DB: Parameters<typeof readHoldingsManagementD1>[0] }).DB);
    })()
    : readLocalHoldings();
  const { positions, names, managers, managementFees, platformManagementFees, plans } = data;
  return <>
    <PageHeader
      title="持仓管理"
      lead="按基金查看市值与收益，展开后按销售渠道查看实际持有。"
      aside={<div className="flex gap-2"><PendingSubscriptionForm names={names} plans={plans} /><PositionForm fundOptions={names} fundManagers={managers} /></div>}
    />

    <div className="space-y-6">
      <HoldingsExplorer positions={positions} names={names} managers={managers} managementFees={managementFees} platformManagementFees={platformManagementFees} />
    </div>
  </>;
}

