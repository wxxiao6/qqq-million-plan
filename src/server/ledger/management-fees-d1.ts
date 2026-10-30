import { beijingTodayISO, isISODate } from "@/lib/format";
import type { ManagementFeeEntry, ManagementFeeRate } from "@/lib/management-fee";
import { mapPosition, POSITIONS_SQL, type Account } from "./index";
import { calculateGroupAccrual, type FeeState, type NavRow } from "./management-fees";
import type { ReconcileD1 } from "./reconcile-d1";

type RateRow = { code: string; effective_on: string; annual_rate_pct: number | null; raw_value: string | null; source_url: string; source_provider: string; observed_at: string; status: "valid" | "missing" | "invalid" };
type EntryRow = { id: number; symbol: string; account: string; fee_date: string; amount: number; note: string | null; created_at: string; updated_at: string };
type StateRow = { symbol: string; account: Account; estimated_amount: number; actual_amount: number; last_nav_date: string | null };

// Compute the same deterministic representation inside each transaction. It is
// used only as an optimistic concurrency guard and is never returned to users.
const FINGERPRINTS = [
  `SELECT json_group_array(json_array(id,account,exposure,symbol,shares,cost,status,recorded_on,t_date,t_nav,confirmed_on,execution_on,cutoff_period,auto_generated,dca_plan_id)) AS value FROM (SELECT * FROM positions ORDER BY id)`,
  `SELECT json_group_array(json_array(symbol,as_of,nav)) AS value FROM (SELECT * FROM nav_snapshots WHERE as_of<=? ORDER BY symbol,as_of)`,
  `SELECT json_group_array(json_array(code,effective_on,annual_rate_pct,raw_value,source_url,source_provider,observed_at,status)) AS value FROM (SELECT * FROM fund_management_fee_rates WHERE effective_on<=? ORDER BY code,effective_on,source_provider)`,
  `SELECT json_group_array(json_array(id,symbol,account,fee_date,amount,note,created_at,updated_at)) AS value FROM (SELECT * FROM holding_management_fee_entries ORDER BY id)`,
  `SELECT json_group_array(json_array(symbol,account,estimated_amount,actual_amount,last_nav_date,updated_at)) AS value FROM (SELECT * FROM holding_management_fee_totals ORDER BY symbol,account)`,
] as const;

/** Read a consistent snapshot for calculating management fees. No fee state is
 * changed here: callers must commit calculations with their related writes. */
export async function readManagementFeesD1(db: ReconcileD1, asOf = beijingTodayISO()) {
  const prepare = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).bind(...args);
  const [startRows, positionRows, navRows, rateRows, entryRows, stateRows, ...fingerprintRows] = await db.batch([
    prepare("SELECT value FROM app_kv WHERE key='holdings.managementFeeStartDate'"),
    prepare(POSITIONS_SQL),
    prepare("SELECT symbol,as_of,nav FROM nav_snapshots WHERE as_of<=? ORDER BY as_of,symbol", asOf),
    prepare(`SELECT code,effective_on,annual_rate_pct,raw_value,source_url,source_provider,observed_at,status FROM fund_management_fee_rates WHERE effective_on<=? ORDER BY code,effective_on`, asOf),
    prepare(`SELECT id,symbol,account,fee_date,amount,note,created_at,updated_at FROM holding_management_fee_entries WHERE fee_date<=? ORDER BY fee_date,id`, asOf),
    prepare("SELECT symbol,account,estimated_amount,actual_amount,last_nav_date FROM holding_management_fee_totals"),
    ...FINGERPRINTS.map((sql, index) => index === 1 || index === 2 ? prepare(sql, asOf) : prepare(sql)),
  ]);
  const saved = (startRows.results[0] as { value: string } | undefined)?.value;
  const start = saved && isISODate(saved) ? saved : beijingTodayISO();
  const positions = (positionRows.results as Array<Parameters<typeof mapPosition>[0]>).map(mapPosition);
  const allNavs = navRows.results as NavRow[];
  const navs = allNavs.filter((row) => row.as_of >= start && row.nav > 0);
  const rates: ManagementFeeRate[] = (rateRows.results as RateRow[]).filter((row) => row.effective_on >= start).map((row) => ({
    code: row.code, effectiveOn: row.effective_on, annualRatePct: row.annual_rate_pct, rawValue: row.raw_value,
    sourceUrl: row.source_url, sourceProvider: row.source_provider, observedAt: row.observed_at, status: row.status,
  }));
  const entries: ManagementFeeEntry[] = (entryRows.results as EntryRow[]).filter((row) => row.fee_date >= start).map((row) => ({
    id: row.id, symbol: row.symbol, account: row.account, feeDate: row.fee_date, amount: row.amount,
    note: row.note, createdAt: row.created_at, updatedAt: row.updated_at,
  }));
  const states: FeeState[] = (stateRows.results as StateRow[]).map((row) => ({ symbol: row.symbol, account: row.account,
    estimatedAmount: row.estimated_amount, actualAmount: row.actual_amount, lastNavDate: row.last_nav_date }));
  const fingerprints = fingerprintRows.map((result) => (result.results[0] as { value: string }).value);
  return { start, savedStart: saved ?? null, asOf, positions, navs, allNavs, rates, entries, states, fingerprints };
}

function feeSnapshotGuard(db: ReconcileD1, snapshot: Awaited<ReturnType<typeof readManagementFeesD1>>) {
  const checks = FINGERPRINTS.map((sql) => `(${sql}) IS NOT ?`);
  const args: (string | number | null)[] = [];
  FINGERPRINTS.forEach((_, index) => { if (index === 1 || index === 2) args.push(snapshot.asOf); args.push(snapshot.fingerprints[index]); });
  return db.prepare(`INSERT INTO app_kv(key,value) SELECT '__fee_snapshot_guard__',NULL WHERE
    (SELECT value FROM app_kv WHERE key='holdings.managementFeeStartDate') IS NOT ? OR ${checks.join(" OR ")}`).bind(snapshot.savedStart, ...args);
}

/** Build a guarded rebuild for use in the same batch as an account change.
 * The snapshot may have transformed positions for the calculation, but the
 * original fingerprints must be retained to detect concurrent mutations. */
export function managementFeeRebuildStatements(db: ReconcileD1, snapshot: Awaited<ReturnType<typeof readManagementFeesD1>>, groups: Array<{ symbol: string; account: Account }>, now = new Date().toISOString()) {
  const bind = (sql: string, ...values: (string | number | null)[]) => db.prepare(sql).bind(...values);
  const statements = [feeSnapshotGuard(db, snapshot)];
  if (!snapshot.savedStart || !isISODate(snapshot.savedStart)) {
    statements.push(bind(`INSERT INTO app_kv(key,value) VALUES ('holdings.managementFeeStartDate',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, snapshot.start));
  }
  for (const { symbol, account } of groups) {
    const calculated = calculateManagementFeeD1Group(snapshot, symbol, account, true);
    statements.push(bind("DELETE FROM holding_management_fee_totals WHERE symbol=? AND account=?", symbol, account));
    if (calculated?.changed) {
      const state = calculated.state;
      statements.push(bind(`INSERT INTO holding_management_fee_totals (symbol,account,estimated_amount,actual_amount,last_nav_date,updated_at)
        VALUES (?,?,?,?,?,?)`, symbol, account, state.estimatedAmount, state.actualAmount, state.lastNavDate, now));
    }
  }
  return statements;
}

export async function accrueManagementFeesD1(db: ReconcileD1, snapshot: Awaited<ReturnType<typeof readManagementFeesD1>>) {
  const keys = [...new Set(snapshot.positions.filter((p) => p.exposure === "nasdaq" && p.status === "settled").map((p) => `${p.symbol}:${p.account}`))];
  const states = new Map(snapshot.states.map((state) => [`${state.symbol}:${state.account}`, state]));
  const writes = [];
  for (const key of keys) {
    const [symbol, account] = key.split(":") as [string, Account];
    const result = calculateManagementFeeD1Group(snapshot, symbol, account);
    if (!result) continue;
    states.set(key, result.state);
    if (result.changed) {
      const state = result.state;
      writes.push(db.prepare(`INSERT INTO holding_management_fee_totals (symbol,account,estimated_amount,actual_amount,last_nav_date,updated_at)
        VALUES (?,?,?,?,?,?) ON CONFLICT(symbol,account) DO UPDATE SET estimated_amount=excluded.estimated_amount,
        actual_amount=excluded.actual_amount,last_nav_date=excluded.last_nav_date,updated_at=excluded.updated_at`).bind(
        symbol, account, state.estimatedAmount, state.actualAmount, state.lastNavDate, new Date().toISOString()));
    }
  }
  if (snapshot.positions.some((p) => p.exposure === "nasdaq") && (!snapshot.savedStart || !isISODate(snapshot.savedStart))) {
    writes.unshift(db.prepare(`INSERT INTO app_kv(key,value) VALUES ('holdings.managementFeeStartDate',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(snapshot.start));
  }
  if (writes.length) await db.batch([feeSnapshotGuard(db, snapshot), ...writes]);
  return [...states.values()];
}

export async function rebuildManagementFeeGroupD1(db: ReconcileD1, symbol: string, account: Account, asOf = beijingTodayISO()) {
  const snapshot = await readManagementFeesD1(db, asOf);
  const result = calculateManagementFeeD1Group(snapshot, symbol, account, true);
  await db.batch(managementFeeRebuildStatements(db, snapshot, [{ symbol, account }]));
  return result?.state ?? null;
}

export function calculateManagementFeeD1Group(snapshot: Awaited<ReturnType<typeof readManagementFeesD1>>, symbol: string, account: Account, rebuild = false) {
  const state = rebuild ? null : snapshot.states.find((row) => row.symbol === symbol && row.account === account) ?? null;
  return calculateGroupAccrual(snapshot.positions, symbol, account, snapshot.asOf, snapshot.rates, snapshot.navs, snapshot.entries, state);
}
