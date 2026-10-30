import { assembleNasdaqFunds, CATALOG_ROWS_SQL, CATALOG_SELLERS_SQL, type CatalogRow } from "../funds/catalog";
import { effectiveQuotaCells } from "../funds/effective-quotes";
import { NASDAQ_HOLDING_MANAGERS_SQL } from "../ledger";
import { buildDcaCandidates, buildDcaPlans, DCA_HISTORY_SQL, DCA_PLANS_SQL, DCA_RECORDED_DATES_SQL, DCA_UNIVERSE_SQL,
  mapDcaHistory, type DcaRecordedDate, type PlanRow, type UniverseRow } from "./index";

type Seller = { code: string; seller: string; sourceUrl: string | null };
type Manager = { code: string; manager: string };
export type ReadD1 = { prepare(sql: string): unknown; batch(statements: unknown[]): Promise<Array<{ results: unknown[] }>> };

/** One D1 transaction supplies the inputs for all calculations in the view. */
export async function readDcaDashboardD1(db: ReadD1) {
  const results = await db.batch([
    DCA_UNIVERSE_SQL, CATALOG_ROWS_SQL, CATALOG_SELLERS_SQL, DCA_PLANS_SQL,
    DCA_RECORDED_DATES_SQL, DCA_HISTORY_SQL, NASDAQ_HOLDING_MANAGERS_SQL,
  ].map((sql) => db.prepare(sql)));
  const [universe, catalogRows, sellerRows, planRows, dateRows, historyRows, managerRows] = results.map((result) => result.results);
  const catalog = assembleNasdaqFunds(catalogRows as CatalogRow[], sellerRows as Seller[]);
  const candidates = buildDcaCandidates(universe as UniverseRow[], effectiveQuotaCells(catalog));
  const plans = buildDcaPlans(planRows as PlanRow[], candidates, dateRows as DcaRecordedDate[]);
  const board = { plans, candidates, activeCount: plans.filter((plan) => plan.status === "active").length,
    totalInvested: plans.reduce((sum, plan) => sum + plan.investedTotal, 0), emptyUniverse: candidates.length === 0 };
  const planIds = new Set(plans.map((plan) => plan.id));
  const records = mapDcaHistory(historyRows).filter((record) => planIds.has(record.planId));
  const managers = Object.fromEntries((managerRows as Manager[]).map((row) => [row.code, row.manager]));
  return { board, records, managers };
}
