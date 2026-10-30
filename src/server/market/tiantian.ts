import { beijingTodayISO } from "@/lib/format";
import { getDb } from "../db";
import { writeJob } from "../jobs/status";
import type { FundNavRecord, FundNavSource } from "./source";

const NAV_URL = "https://fundcomapi.tiantianfunds.com/mm/newCore/FundVPageDiagram";
const RATE_URL = "https://fundmobapi.eastmoney.com/FundMApi/FundRateInfo.ashx";
const USER_AGENT = "qqq-million-plan/1.0";
const CLIENT_PARAMS = {
  deviceid: "1",
  plat: "Android",
  product: "EFund",
  version: "6.5.5",
};

type TiantianNavRow = { FSRQ?: string; DWJZ?: string | number; JZZZL?: string | number };
type FeeRow = { money?: string; time?: string; source?: string; rate?: string };
type TiantianRateData = {
  SGZT?: string;
  MINSG?: string | number;
  MAXSG?: string | number;
  MGREXP?: string;
  TRUSTEXP?: string;
  SALESEXP?: string;
  sg?: FeeRow[];
};

export type TiantianQuotaRecord = {
  code: string;
  status: "open" | "limited" | "paused";
  dailyLimit: number | null;
  purchaseFeePct: number | null;
  purchaseFeeJson: string | null;
  managementFeePct: number | null;
  managementFeeRaw: string | null;
  managementFeeStatus: "valid" | "missing" | "invalid";
  sourceUrl: string;
  rawStatus: string;
};

function numberValue(value: string | number | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function percentValue(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^\s*(-?\d+(?:\.\d+)?)%\s*$/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function queryUrl(base: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  return `${base}?${query.toString()}`;
}

async function fetchJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: "https://fund.eastmoney.com/",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`天天基金请求失败：${response.status}`);
  return response.json();
}

function navRows(value: unknown): TiantianNavRow[] {
  if (!value || typeof value !== "object") return [];
  const data = (value as { data?: unknown }).data;
  return Array.isArray(data) ? data as TiantianNavRow[] : [];
}

export function parseTiantianNav(code: string, value: unknown, sourceUrl: string): FundNavRecord {
  const rows = navRows(value)
    .filter((row) => typeof row.FSRQ === "string" && /^20\d{2}-\d{2}-\d{2}$/.test(row.FSRQ) && (numberValue(row.DWJZ) ?? 0) > 0)
    .sort((a, b) => (b.FSRQ ?? "").localeCompare(a.FSRQ ?? ""));
  const row = rows[0];
  if (!row?.FSRQ) throw new Error(`${code} 未返回有效天天基金净值`);
  return {
    code,
    navDate: row.FSRQ,
    nav: numberValue(row.DWJZ)!,
    dailyChangePct: numberValue(row.JZZZL),
    sourceUrl,
  };
}

export async function fetchTiantianNav(code: string, fetcher: typeof fetch = fetch): Promise<FundNavRecord> {
  const sourceUrl = queryUrl(NAV_URL, { ...CLIENT_PARAMS, FCODE: code, RANGE: "ln", POINTCOUNT: "500" });
  return parseTiantianNav(code, await fetchJson(sourceUrl, fetcher), sourceUrl);
}

export const tiantianNavSource: FundNavSource = {
  name: "tiantian",
  fetchNav: fetchTiantianNav,
};

function quotaStatus(code: string, value: string | undefined): "open" | "limited" | "paused" {
  if (value === "开放申购") return "open";
  if (value === "限大额") return "limited";
  if (value === "暂停申购" || value === "封闭期" || value === "认购期" || value === "场内交易") return "paused";
  throw new Error(`${code} 返回未知申购状态`);
}

export function parseTiantianQuota(code: string, value: unknown, sourceUrl: string): TiantianQuotaRecord {
  const data = value && typeof value === "object" ? (value as { Datas?: TiantianRateData }).Datas : null;
  if (!data || typeof data !== "object") throw new Error(`${code} 未返回天天基金交易规则`);
  const status = quotaStatus(code, data.SGZT);
  const rawLimit = numberValue(data.MAXSG);
  const dailyLimit = rawLimit != null && rawLimit >= 100_000_000_000 ? null : rawLimit;
  const ladder = Array.isArray(data.sg) ? data.sg : [];
  const purchaseFeePct = ladder.map((row) => percentValue(row.rate)).find((fee) => fee != null) ?? null;
  const managementFeeRaw = data.MGREXP ?? null;
  const managementFeePct = percentValue(managementFeeRaw ?? undefined);
  return {
    code,
    status,
    dailyLimit: status === "paused" ? null : dailyLimit,
    purchaseFeePct,
    purchaseFeeJson: ladder.length ? JSON.stringify(ladder) : null,
    managementFeePct,
    managementFeeRaw,
    managementFeeStatus: managementFeeRaw == null || managementFeeRaw.trim() === ""
      ? "missing"
      : managementFeePct == null
        ? "invalid"
        : "valid",
    sourceUrl,
    rawStatus: data.SGZT ?? "",
  };
}

export async function fetchTiantianQuota(code: string, fetcher: typeof fetch = fetch): Promise<TiantianQuotaRecord> {
  const sourceUrl = queryUrl(RATE_URL, { ...CLIENT_PARAMS, FCODE: code });
  return parseTiantianQuota(code, await fetchJson(sourceUrl, fetcher), sourceUrl);
}

type CatalogFund = { code: string; shareClass: string; currency: "CNY" | "USD"; venue: "exchange" | "otc" };

function catalogFunds(): CatalogFund[] {
  return getDb().prepare("SELECT code, share_class AS shareClass, currency, venue FROM nasdaq_funds WHERE venue='otc' ORDER BY code").all() as CatalogFund[];
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

export type TiantianQuotaSyncResult = {
  ok: boolean;
  reused?: boolean;
  bizDate: string;
  requested: number;
  success: number;
  failed: Array<{ code: string; error: string }>;
};

export async function syncTiantianAgencyQuota(now = new Date(), fetcher: typeof fetch = fetch): Promise<TiantianQuotaSyncResult> {
  const bizDate = beijingTodayISO(now);
  const funds = catalogFunds();
  const key = `tiantian-agency:${bizDate}`;
  const settled = await parallel(funds, Number(process.env.FUND_DATA_CONCURRENCY ?? 4), (fund) => fetchTiantianQuota(fund.code, fetcher));
  const good = settled.flatMap(({ item, result }) => result.status === "fulfilled" ? [{ fund: item, quota: result.value }] : []);
  const failed = settled.flatMap(({ item, result }) => result.status === "rejected" ? [{ code: item.code, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }] : []);
  const db = getDb();
  const observedAt = now.toISOString();
  const run = db.transaction(() => {
    db.prepare(`INSERT INTO quota_ingestion_runs (idempotency_key, source_provider, observed_at, payload_hash, item_count, accepted_count, status, created_at)
      VALUES (?, 'tiantian-fund', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET observed_at=excluded.observed_at, payload_hash=excluded.payload_hash,
      item_count=excluded.item_count, accepted_count=excluded.accepted_count, status=excluded.status`)
      .run(key, observedAt, `tiantian-fund:${bizDate}`, funds.length, good.length, failed.length ? (good.length ? "accepted" : "rejected") : "accepted", observedAt);
    const observation = db.prepare(`INSERT INTO quota_observations
      (idempotency_key, code, share_class, channel_kind, status, daily_limit, currency, quota_scope, effective_on, observed_at, source_url, source_provider, created_at, purchase_fee_pct, purchase_fee_json)
      VALUES (?, ?, ?, 'agency', ?, ?, ?, ?, ?, ?, ?, 'tiantian-fund', ?, ?, ?)
      ON CONFLICT(idempotency_key, code, share_class, channel_kind) DO UPDATE SET status=excluded.status,
      daily_limit=excluded.daily_limit, currency=excluded.currency, quota_scope=excluded.quota_scope,
      effective_on=excluded.effective_on, observed_at=excluded.observed_at, source_url=excluded.source_url,
      source_provider=excluded.source_provider, created_at=excluded.created_at,
      purchase_fee_pct=excluded.purchase_fee_pct, purchase_fee_json=excluded.purchase_fee_json`);
    const current = db.prepare(`INSERT INTO quota_current
      (code, share_class, channel_kind, status, daily_limit, currency, quota_scope, effective_on, observed_at, source_url, source_provider, updated_at, purchase_fee_pct, purchase_fee_json)
      VALUES (?, ?, 'agency', ?, ?, ?, ?, ?, ?, ?, 'tiantian-fund', ?, ?, ?)
      ON CONFLICT(code, share_class, channel_kind) DO UPDATE SET status=excluded.status,
      daily_limit=excluded.daily_limit, currency=excluded.currency, quota_scope=excluded.quota_scope,
      effective_on=excluded.effective_on, observed_at=excluded.observed_at, source_url=excluded.source_url,
      source_provider=excluded.source_provider, updated_at=excluded.updated_at,
      purchase_fee_pct=excluded.purchase_fee_pct, purchase_fee_json=excluded.purchase_fee_json`);
    const managementFee = db.prepare(`INSERT INTO fund_management_fee_rates
      (code, effective_on, annual_rate_pct, raw_value, source_url, source_provider, observed_at, status)
      VALUES (?, ?, ?, ?, ?, 'tiantian-fund', ?, ?)
      ON CONFLICT(code, effective_on, source_provider) DO UPDATE SET
        annual_rate_pct=excluded.annual_rate_pct, raw_value=excluded.raw_value,
        source_url=excluded.source_url, observed_at=excluded.observed_at, status=excluded.status`);
    const latestNavDate = db.prepare("SELECT MAX(as_of) AS asOf FROM nav_snapshots WHERE symbol = ? AND as_of <= ?");
    for (const { fund, quota } of good) {
      const scope = quota.rawStatus === "场内交易" ? "场内交易" : "日累计申购限额";
      observation.run(key, fund.code, fund.shareClass, quota.status, quota.dailyLimit, fund.currency, scope, bizDate, observedAt, quota.sourceUrl, observedAt, quota.purchaseFeePct, quota.purchaseFeeJson);
      current.run(fund.code, fund.shareClass, quota.status, quota.dailyLimit, fund.currency, scope, bizDate, observedAt, quota.sourceUrl, observedAt, quota.purchaseFeePct, quota.purchaseFeeJson);
      const navDate = (latestNavDate.get(fund.code, bizDate) as { asOf: string | null } | undefined)?.asOf ?? bizDate;
      managementFee.run(fund.code, navDate, quota.managementFeePct, quota.managementFeeRaw, quota.sourceUrl, observedAt, quota.managementFeeStatus);
    }
  });
  run();
  writeJob("tiantian_quota", { ok: failed.length === 0, partial: failed.length > 0 && good.length > 0, at: observedAt, bizDate, error: failed.length ? JSON.stringify(failed) : undefined });
  return { ok: failed.length === 0, bizDate, requested: funds.length, success: good.length, failed };
}
