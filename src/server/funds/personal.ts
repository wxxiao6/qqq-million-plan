import type { ReconcileD1, D1Statement } from "../ledger/reconcile-d1";
import { fetchFundIdentity, type DiscoveredFund } from "./discovery";
import { tiantianNavSource } from "../market/tiantian";
import { failedNavStatement, saveNavChunkD1 } from "../market/nav-d1";
import type { FundNavSource } from "../market/source";

export type PersonalFund = {
  code: string; name: string; manager: string | null; fundType: string | null;
  currency: string; venue: string; isNasdaq: boolean;
  nav: number | null; navDate: string | null; navError: string | null;
};
type FundRow = Omit<PersonalFund, "isNasdaq"> & { isNasdaq: number; succeededAt: string | null };
const READ_FUND = `SELECT f.code,f.name,f.manager,f.fund_type AS fundType,f.currency,f.venue,f.is_nasdaq AS isNasdaq,
  n.nav,n.as_of AS navDate,s.error AS navError,s.succeeded_at AS succeededAt FROM funds f
  LEFT JOIN nav_snapshots n ON n.symbol=f.code AND n.as_of=(SELECT MAX(as_of) FROM nav_snapshots WHERE symbol=f.code)
  LEFT JOIN fund_nav_sync s ON s.code=f.code WHERE f.code=?`;

export async function readPersonalFund(db: ReconcileD1, code: string): Promise<FundRow | undefined> {
  const [rows] = await db.batch([db.prepare(READ_FUND).bind(code)]);
  return rows.results[0] as FundRow | undefined;
}

export function registerFundStatement(db: ReconcileD1, fund: DiscoveredFund, observedAt: string) {
  return db.prepare(`INSERT INTO funds(code,name,manager,fund_type,currency,venue,is_nasdaq,source_url,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name,manager=excluded.manager,
    fund_type=excluded.fund_type,updated_at=excluded.updated_at`).bind(fund.code, fund.name, fund.manager,
    fund.fundType, fund.currency, fund.venue, fund.isNasdaq ? 1 : 0, fund.sourceUrl, observedAt);
}

/** The caller authenticates. Provider requests contain only a public fund code. */
export async function discoverPersonalFund(db: ReconcileD1, rawCode: string, options: {
  now?: Date; fetcher?: typeof fetch; source?: FundNavSource;
  identity?: typeof fetchFundIdentity;
} = {}): Promise<PersonalFund> {
  const code = rawCode.trim();
  if (!/^\d{6}$/.test(code)) throw new Error("请输入六位基金代码");
  const observedAt = (options.now ?? new Date()).toISOString();
  const fetcher = options.fetcher ?? fetch;
  let row = await readPersonalFund(db, code);
  if (!row) {
    const identity = await (options.identity ?? fetchFundIdentity)(code, fetcher);
    await db.batch([registerFundStatement(db, identity, observedAt)]);
    row = await readPersonalFund(db, code);
  }
  if (!row || row.currency !== "CNY" || row.venue !== "otc") throw new Error("目前仅支持人民币场外基金");
  if (row.nav == null) {
    await db.batch([attachFundNavStatement(db, code)]);
    row = (await readPersonalFund(db, code))!;
  }
  // Cache protects repeated selection; scheduled refreshes do not use this gate.
  const age = row.succeededAt ? Date.parse(observedAt) - Date.parse(row.succeededAt) : Infinity;
  if (row.nav == null || age >= 30 * 60_000 || row.navError) {
    try {
      const source = options.source ?? tiantianNavSource;
      const nav = await source.fetchNav(code, fetcher);
      await saveNavChunkD1(db, [nav], source.name, observedAt, true);
    } catch {
      await db.batch([failedNavStatement(db, code, observedAt, "净值暂时无法获取，持仓保存后将自动重试") as D1Statement]);
    }
    row = (await readPersonalFund(db, code))!;
  }
  return { code: row.code, name: row.name, manager: row.manager, fundType: row.fundType,
    currency: row.currency, venue: row.venue, isNasdaq: Boolean(row.isNasdaq), nav: row.nav,
    navDate: row.navDate, navError: row.navError };
}

/** Reuse already persisted provider quotes when first adding a radar holding. */
export function attachFundNavStatement(db: ReconcileD1, code: string) {
  return db.prepare(`INSERT INTO nav_snapshots(symbol,as_of,nav,source,nav_change_pct,source_url)
    SELECT code,nav_date,nav,source,daily_change_pct,source_url FROM (
      SELECT *,ROW_NUMBER() OVER(PARTITION BY nav_date ORDER BY fetched_at DESC) AS rank
      FROM fund_nav_history WHERE code=? AND nav_date IN (
        SELECT DISTINCT nav_date FROM fund_nav_history WHERE code=? ORDER BY nav_date DESC LIMIT 3)) WHERE rank=1
    ON CONFLICT(symbol,as_of) DO UPDATE SET nav=excluded.nav,source=excluded.source,
      nav_change_pct=excluded.nav_change_pct,source_url=excluded.source_url WHERE nav_snapshots.source<>'manual'`).bind(code, code);
}

export const HOLDING_FUNDS_SQL = `SELECT f.code,f.name,f.manager,f.is_nasdaq AS isNasdaq,s.error AS syncError FROM funds f
  LEFT JOIN fund_nav_sync s ON s.code=f.code
  WHERE f.currency='CNY' AND (f.venue='otc' OR EXISTS(SELECT 1 FROM positions p WHERE p.symbol=f.code)) AND (EXISTS(SELECT 1 FROM nasdaq_funds r WHERE r.code=f.code)
    OR EXISTS(SELECT 1 FROM positions p WHERE p.symbol=f.code AND p.exposure IN ('nasdaq','fund'))) ORDER BY f.code`;
