import { readDcaDashboardD1, type ReadD1 } from "../dca/read-d1";
import { buildPositionDetails, LATEST_NAV_SQL, PRIOR_NAV_SQL, NASDAQ_HOLDING_NAMES_SQL, POSITIONS_SQL,
  mapPosition, type NavSnapshot } from "../ledger";
import type { ReconcileD1 } from "../ledger/reconcile-d1";

export async function readHoldingsManagementD1(db: ReconcileD1 & ReadD1) {
  const [rows, latest, prior, namesRows] = await db.batch([
    db.prepare(POSITIONS_SQL).bind(), db.prepare(LATEST_NAV_SQL).bind(),
    db.prepare(PRIOR_NAV_SQL).bind(), db.prepare(NASDAQ_HOLDING_NAMES_SQL).bind(),
  ]);
  const dca = await readDcaDashboardD1(db);
  const positions = buildPositionDetails(rows.results.map((row) => mapPosition(row as Parameters<typeof mapPosition>[0])),
    latest.results as NavSnapshot[], prior.results as NavSnapshot[]).filter((position) => position.exposure === "nasdaq");
  const names = Object.fromEntries((namesRows.results as Array<{ code: string; name: string }>).map((row) => [row.code, row.name]));
  return { positions, names, managers: dca.managers, plans: dca.board.plans };
}
