import { HOLDING_FUNDS_SQL, PENDING_FUNDS_SQL } from "../funds/personal";
import { readDcaDashboardD1, type ReadD1 } from "../dca/read-d1";
import { buildPositionDetails, LATEST_NAV_SQL, PRIOR_NAV_SQL, POSITIONS_SQL,
  mapPosition, type NavSnapshot } from "../ledger";
import type { ReconcileD1 } from "../ledger/reconcile-d1";
import { isQdiiFund } from "@/lib/holdings-dashboard";
import { classifyHoldingFund } from "@/lib/fund-category";

export async function readHoldingsManagementD1(db: ReconcileD1 & ReadD1) {
  const [rows, latest, prior, namesRows, fundsRows] = await db.batch([
    db.prepare(POSITIONS_SQL).bind(), db.prepare(LATEST_NAV_SQL).bind(),
    db.prepare(PRIOR_NAV_SQL).bind(), db.prepare(PENDING_FUNDS_SQL).bind(), db.prepare(HOLDING_FUNDS_SQL).bind(),
  ]);
  const dca = await readDcaDashboardD1(db);
  const positions = buildPositionDetails(rows.results.map((row) => mapPosition(row as Parameters<typeof mapPosition>[0])),
    latest.results as NavSnapshot[], prior.results as NavSnapshot[]).filter((position) => (position.exposure === "nasdaq" || position.exposure === "fund"));
  const pendingFunds = namesRows.results as Array<{ code: string; name: string; manager: string | null }>;
  const pendingNames = Object.fromEntries(pendingFunds.map((row) => [row.code, row.name]));
  const funds = fundsRows.results as Array<{ code: string; name: string; manager: string | null; fundType: string | null; isNasdaq: number; syncError: string | null }>;
  const names = Object.fromEntries(funds.map((fund) => [fund.code, fund.name]));
  const managers = { ...Object.fromEntries(pendingFunds.filter((fund) => fund.manager).map((fund) => [fund.code, fund.manager!])), ...Object.fromEntries(funds.filter((fund) => fund.manager).map((fund) => [fund.code, fund.manager!])), ...dca.managers };
  const syncErrors = Object.fromEntries(funds.filter((fund) => fund.syncError).map((fund) => [fund.code, fund.syncError!]));
  const qdiiFunds = Object.fromEntries(funds.map((fund) => [fund.code, isQdiiFund(fund.name, fund.fundType, Boolean(fund.isNasdaq))]));
  const fundCategories = Object.fromEntries(funds.map((fund) => [fund.code, classifyHoldingFund(fund.name, fund.fundType, Boolean(fund.isNasdaq))]));
  return { positions, names, managers, syncErrors, qdiiFunds, fundCategories, pendingNames, plans: dca.board.plans };
}
