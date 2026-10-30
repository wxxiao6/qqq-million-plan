import { beijingTodayISO } from "@/lib/format";
import { getDb } from "../db";
import { getDynamicMarketValue } from "../ledger";
import { writeJob } from "../jobs/status";
import type { FundNavSource } from "./source";

const API_ROOT = "https://api.biyingapi.com";
const USER_AGENT = "qqq-million-plan/1.0";

type BiyingNavRow = { dm?: string; mc?: string; t?: string; dwjz?: string | number; zzl?: string | number };
type BiyingInfo = { dm?: string; qc?: string; jc?: string; lx?: string; glr?: string; [key: string]: unknown };

function rowsOf<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  for (const key of ["data", "Data", "result", "rows", "list"]) {
    if (Array.isArray(object[key])) return object[key] as T[];
    if (object[key] && typeof object[key] === "object") {
      const nested = rowsOf<T>(object[key]);
      if (nested.length) return nested;
    }
  }
  return [];
}

function numberValue(value: string | number | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function license(): string {
  const value = process.env.BIYING_LICENCE;
  if (!value) throw new Error("未配置 BIYING_LICENCE");
  return value;
}

function apiRoot(): string {
  return (process.env.BIYING_API_ROOT ?? process.env.BING_API_DOMAIN ?? API_ROOT).replace(/\/$/, "");
}

async function fetchJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`必盈请求失败：${response.status}`);
  return response.json();
}

export async function fetchBiyingNav(code: string, fetcher: typeof fetch = fetch) {
  const url = `${apiRoot()}/jj/lsjz/${encodeURIComponent(code)}/${encodeURIComponent(license())}`;
  const rows = rowsOf<BiyingNavRow>(await fetchJson(url, fetcher));
  const valid = rows.filter((row) => typeof row.t === "string" && /^20\d{2}-\d{2}-\d{2}$/.test(row.t) && (numberValue(row.dwjz) ?? 0) > 0)
    .sort((a, b) => (b.t ?? "").localeCompare(a.t ?? ""));
  const row = valid[0];
  if (!row?.t) throw new Error(`${code} 未返回有效净值`);
  return { code, navDate: row.t, nav: numberValue(row.dwjz)!, dailyChangePct: numberValue(row.zzl), sourceUrl: url };
}

export const biyingNavSource: FundNavSource = {
  name: "biying",
  fetchNav: fetchBiyingNav,
};

export async function fetchBiyingInfo(code: string, fetcher: typeof fetch = fetch) {
  const url = `${apiRoot()}/jj/jjgk/${encodeURIComponent(code)}/${encodeURIComponent(license())}`;
  const value = await fetchJson(url, fetcher);
  const row = (rowsOf<BiyingInfo>(value)[0] ?? (value && typeof value === "object" ? value as BiyingInfo : null));
  if (!row) throw new Error(`${code} 未返回基金概况`);
  return { code, fullName: row.qc ?? null, shortName: row.jc ?? null, fundType: row.lx ?? null, manager: row.glr ?? null, raw: row, sourceUrl: url };
}

type CatalogCode = { code: string; currency: string };

function catalogCodes(): CatalogCode[] {
  return getDb().prepare("SELECT code, currency FROM nasdaq_funds ORDER BY code").all() as CatalogCode[];
}

async function parallel<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>) {
  const out: Array<{ item: T; result: PromiseSettledResult<R> }> = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      try { out.push({ item, result: { status: "fulfilled", value: await work(item) } }); }
      catch (reason) { out.push({ item, result: { status: "rejected", reason } }); }
    }
  }));
  return out;
}

function beginRun(jobName: string, bizDate: string, startedAt: string, requested: number) {
  const db = getDb();
  db.prepare(`INSERT INTO fund_ingestion_runs (job_name,biz_date,started_at,requested_count,status) VALUES (?,?,?,?, 'running') ON CONFLICT(job_name,biz_date) DO UPDATE SET started_at=excluded.started_at,requested_count=excluded.requested_count,success_count=0,failure_count=0,error_json=NULL,status='running'`).run(jobName, bizDate, startedAt, requested);
}

function finishRun(jobName: string, bizDate: string, finishedAt: string, success: number, failures: Array<{ code: string; error: string }>) {
  getDb().prepare("UPDATE fund_ingestion_runs SET finished_at=?,success_count=?,failure_count=?,error_json=?,status=? WHERE job_name=? AND biz_date=?")
    .run(finishedAt, success, failures.length, failures.length ? JSON.stringify(failures) : null, failures.length === 0 ? "succeeded" : success ? "partial" : "failed", jobName, bizDate);
}

export type BiyingNavSyncResult = { ok: boolean; reused?: boolean; bizDate: string; success: number; failed: Array<{ code: string; error: string }> };

export async function syncNasdaqFundNav(now = new Date(), fetcher: typeof fetch = fetch, source: FundNavSource = biyingNavSource): Promise<BiyingNavSyncResult> {
  const bizDate = beijingTodayISO(now);
  const codes = catalogCodes();
  const jobName = `${source.name}_nav`;
  const previous = getDb().prepare("SELECT status FROM fund_ingestion_runs WHERE job_name=? AND biz_date=?").get(jobName, bizDate) as { status: string } | undefined;
  if (previous?.status === "succeeded") return { ok: true, reused: true, bizDate, success: codes.length, failed: [] };
  beginRun(jobName, bizDate, now.toISOString(), codes.length);
  const settled = await parallel(codes, Number(process.env.FUND_DATA_CONCURRENCY ?? process.env.BIYING_CONCURRENCY ?? 4), (fund) => source.fetchNav(fund.code, fetcher));
  const good = settled.flatMap(({ result }) => result.status === "fulfilled" ? [result.value] : []);
  const failed = settled.flatMap(({ item, result }) => result.status === "rejected" ? [{ code: item.code, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }] : []);
  const db = getDb();
  const held = new Set((db.prepare(`SELECT DISTINCT symbol FROM positions WHERE exposure='nasdaq' UNION SELECT DISTINCT symbol FROM dca_plans WHERE status='active' AND exposure='nasdaq'`).all() as Array<{ symbol: string }>).map((row) => row.symbol));
  const save = db.transaction(() => {
    const history = db.prepare(`INSERT INTO fund_nav_history (code,nav_date,nav,daily_change_pct,source,source_url,fetched_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(code,nav_date,source) DO UPDATE SET nav=excluded.nav,daily_change_pct=excluded.daily_change_pct,source_url=excluded.source_url,fetched_at=excluded.fetched_at`);
    const current = db.prepare(`INSERT INTO nasdaq_fund_observations (code,nav,nav_date,daily_change_pct,source_url,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET nav=excluded.nav,nav_date=excluded.nav_date,daily_change_pct=excluded.daily_change_pct,source_url=excluded.source_url,updated_at=excluded.updated_at`);
    const snapshot = db.prepare(`INSERT INTO nav_snapshots (symbol,as_of,nav,source,nav_change_pct,source_url) VALUES (?,?,?,?,?,?) ON CONFLICT(symbol,as_of) DO UPDATE SET nav=excluded.nav,source=excluded.source,nav_change_pct=excluded.nav_change_pct,source_url=excluded.source_url WHERE nav_snapshots.source <> 'manual'`);
    for (const item of good) {
      history.run(item.code, item.navDate, item.nav, item.dailyChangePct, source.name, item.sourceUrl, now.toISOString());
      current.run(item.code, item.nav, item.navDate, item.dailyChangePct, item.sourceUrl, now.toISOString());
      if (held.has(item.code)) snapshot.run(item.code, item.navDate, item.nav, source.name, item.dailyChangePct, item.sourceUrl);
    }
    const marketValue = getDynamicMarketValue(bizDate);
    if (marketValue != null) db.prepare(`INSERT INTO portfolio_snapshots (as_of,dynamic_mv) VALUES (?,?) ON CONFLICT(as_of) DO UPDATE SET dynamic_mv=excluded.dynamic_mv`).run(bizDate, marketValue);
  });
  save();
  finishRun(jobName, bizDate, new Date().toISOString(), good.length, failed);
  const result = { ok: failed.length === 0, bizDate, success: good.length, failed };
  writeJob(jobName as "biying_nav" | "tiantian_nav", { ok: result.ok, partial: failed.length > 0 && good.length > 0, at: now.toISOString(), bizDate, error: failed.length ? JSON.stringify(failed) : undefined });
  return result;
}

export async function syncNasdaqFundInfo(now = new Date(), fetcher: typeof fetch = fetch) {
  const bizDate = beijingTodayISO(now);
  const codes = catalogCodes();
  beginRun("biying_info", bizDate, now.toISOString(), codes.length);
  const settled = await parallel(codes, Number(process.env.BIYING_CONCURRENCY ?? 4), (fund) => fetchBiyingInfo(fund.code, fetcher));
  const good = settled.flatMap(({ result }) => result.status === "fulfilled" ? [result.value] : []);
  const failed = settled.flatMap(({ item, result }) => result.status === "rejected" ? [{ code: item.code, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }] : []);
  const db = getDb();
  const insert = db.prepare(`INSERT INTO fund_info_snapshots (code,name,full_name,fund_type,manager,raw_json,source,source_url,fetched_at) VALUES (?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => { for (const item of good) insert.run(item.code, item.shortName, item.fullName, item.fundType, item.manager, JSON.stringify(item.raw), "biying", item.sourceUrl, now.toISOString()); })();
  finishRun("biying_info", bizDate, new Date().toISOString(), good.length, failed);
  const result = { ok: failed.length === 0, bizDate, success: good.length, failed };
  writeJob("biying_info", { ok: result.ok, partial: failed.length > 0 && good.length > 0, at: now.toISOString(), bizDate, error: failed.length ? JSON.stringify(failed) : undefined });
  return result;
}
