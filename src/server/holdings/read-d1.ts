import { beijingTodayISO } from "@/lib/format";
import { readDcaDashboardD1, type ReadD1 } from "../dca/read-d1";
import { buildPositionDetails, LATEST_NAV_SQL, PRIOR_NAV_SQL, NASDAQ_HOLDING_NAMES_SQL,
  type Account, type NavSnapshot, type PositionDetail } from "../ledger";
import { buildManagementFeeSummary } from "../ledger/management-fees";
import { accrueManagementFeesD1, readManagementFeesD1 } from "../ledger/management-fees-d1";
import type { ReconcileD1 } from "../ledger/reconcile-d1";

/** Build the holdings view from D1 using the same valuation and fee functions
 * as local SQLite. The guarded fee write fails on concurrent changes. */
export async function readHoldingsManagementD1(db: ReconcileD1 & ReadD1, asOf = beijingTodayISO()) {
  const snapshot = await readManagementFeesD1(db, asOf);
  const states = await accrueManagementFeesD1(db, snapshot);
  const [latest, prior, namesRows] = await db.batch([
    db.prepare(LATEST_NAV_SQL).bind(), db.prepare(PRIOR_NAV_SQL).bind(), db.prepare(NASDAQ_HOLDING_NAMES_SQL).bind(),
  ]);
  const dca = await readDcaDashboardD1(db);
  const positions = buildPositionDetails(snapshot.positions, latest.results as NavSnapshot[], prior.results as NavSnapshot[])
    .filter((position) => position.exposure === "nasdaq");
  const names = Object.fromEntries((namesRows.results as Array<{ code: string; name: string }>).map((row) => [row.code, row.name]));
  const summary = (symbol: string, group: PositionDetail[]) => {
    const settled = group.filter((position) => position.status === "settled");
    const total = group.reduce((sum, position) => sum + (position.marketValue ?? 0), 0) || null;
    const latestNav = new Map<string, number>();
    for (const row of snapshot.allNavs) latestNav.set(row.symbol, row.nav);
    let fallback: number | null = null;
    for (const position of settled) {
      const nav = latestNav.get(position.symbol);
      if (position.shares == null || nav == null) continue;
      fallback = (fallback ?? 0) + position.shares * nav;
    }
    const relevant = new Set(settled.map((position) => `${position.symbol}:${position.account}`));
    return buildManagementFeeSummary({ symbol, cost: settled.reduce((sum, position) => sum + position.cost, 0) },
      settled, states.filter((state) => relevant.has(`${state.symbol}:${state.account}`)), snapshot.navs, snapshot.rates, total ?? fallback);
  };
  const managementFees = Object.fromEntries([...new Set(positions.map((position) => position.symbol))]
    .map((symbol) => [symbol, summary(symbol, positions.filter((position) => position.symbol === symbol))]));
  const platformManagementFees = Object.fromEntries([...new Set(positions.map((position) => `${position.symbol}:${position.account}`))]
    .map((key) => { const [symbol, account] = key.split(":") as [string, Account];
      return [key, summary(symbol, positions.filter((position) => position.symbol === symbol && position.account === account))]; }));
  return { positions, names, managers: dca.managers, plans: dca.board.plans, managementFees, platformManagementFees };
}
