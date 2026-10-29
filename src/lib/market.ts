/** 全市场纳指情况。产品契约见 docs/spec-jobs.md 第 2 节。 */

export type MarketSubscribeStatus = "open" | "limited" | "paused";
export type MarketShareClass = "A" | "C" | "D" | "E" | "I" | "F";

export type NasdaqShareSituation = {
  symbol: string;
  shareClass: MarketShareClass;
  name: string;
  manager: string | null;
  directStatus: MarketSubscribeStatus | null;
  directDailyLimit: number | null;
  agencyStatus: MarketSubscribeStatus | null;
  agencyDailyLimit: number | null;
  fundStatus?: MarketSubscribeStatus | null;
  fundDailyLimit?: number | null;
  nav: number | null;
  navDate: string | null;
  navChangePct?: number | null;
  navHistory?: { asOf: string; nav: number }[];
  priorNav?: number | null;
  priorNavDate?: string | null;
  marketPrice?: number | null;
  marketPriceAt?: string | null;
  currency?: "CNY" | "USD";
  marketType?: "otc" | "etf" | "lof";
  sourceUrl?: string | null;
  quotaSource?: string | null;
};

const STATUSES = new Set<MarketSubscribeStatus>(["open", "limited", "paused"]);
const CLASSES = new Set<MarketShareClass>(["A", "C", "D", "E", "I", "F"]);

function asStatus(value: unknown): MarketSubscribeStatus | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !STATUSES.has(value as MarketSubscribeStatus)) {
    return null;
  }
  return value as MarketSubscribeStatus;
}

function asClass(value: unknown): MarketShareClass | null {
  if (typeof value !== "string" || !CLASSES.has(value as MarketShareClass)) return null;
  return value as MarketShareClass;
}

function asLimit(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function asNav(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10000) / 10000;
}

export function parseMarketShare(raw: Record<string, unknown>): NasdaqShareSituation | null {
  const symbol = String(raw.symbol ?? "").trim();
  const shareClass = asClass(raw.shareClass);
  const name = String(raw.name ?? "").trim();
  if (!symbol || !shareClass || !name) return null;
  const navDateRaw = raw.navDate == null ? "" : String(raw.navDate).trim();
  return {
    symbol,
    shareClass,
    name,
    manager: String(raw.manager ?? "").trim() || null,
    directStatus: asStatus(raw.directStatus),
    directDailyLimit: asLimit(raw.directDailyLimit),
    agencyStatus: asStatus(raw.agencyStatus),
    agencyDailyLimit: asLimit(raw.agencyDailyLimit),
    fundStatus: asStatus(raw.fundStatus),
    fundDailyLimit: asLimit(raw.fundDailyLimit),
    nav: asNav(raw.nav),
    navDate: navDateRaw || null,
    marketPrice: asNav(raw.marketPrice),
    marketPriceAt: raw.marketPriceAt == null ? null : String(raw.marketPriceAt).trim() || null,
  };
}

export type MarketFile = {
  nasdaqIndex: number | null;
  goldPrice: number | null;
  shares: NasdaqShareSituation[];
};

function asSpot(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function parseMarketList(raw: unknown): NasdaqShareSituation[] {
  return parseMarketFile(raw).shares;
}

export function parseMarketFile(raw: unknown): MarketFile {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const list = Array.isArray(raw)
    ? raw
    : record && Array.isArray(record.shares)
      ? record.shares
      : null;
  if (!list) throw new Error("模拟源格式不合法");
  const out: NasdaqShareSituation[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const parsed = parseMarketShare(item as Record<string, unknown>);
    if (parsed) out.push(parsed);
  }
  return {
    nasdaqIndex: record ? asSpot(record.nasdaqIndex) : null,
    goldPrice: record ? asSpot(record.goldPrice) : null,
    shares: out,
  };
}

export function shareKey(symbol: string, shareClass: string) {
  return `${symbol}:${shareClass}`;
}
