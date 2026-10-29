import { createHash, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "../db";

export type QuotaChannel = "direct" | "agency" | "exchange";
export type QuotaStatus = "open" | "limited" | "paused";
export type QuotaSourceType = "announcement_pdf" | "official_page" | "api";

export type QuotaIngestionItem = {
  fundCode: string;
  shareClass: string;
  channel: QuotaChannel;
  status: QuotaStatus;
  dailyLimit: number | null;
  currency: "CNY" | "USD";
  quotaScope?: string | null;
  effectiveOn: string;
  sourceUrl: string;
  sourceType?: QuotaSourceType;
  sourcePublishedAt?: string | null;
  evidenceLocator?: string | null;
  sourceHash?: string | null;
};

export type QuotaIngestionPayload = {
  schemaVersion: 1;
  observedAt: string;
  sourceProvider: string;
  items: QuotaIngestionItem[];
};

export class QuotaIngestionError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
  }
}

const SHARE_CLASSES = new Set(["A", "C", "D", "E", "F", "I"]);
const SOURCE_TYPES = new Set<QuotaSourceType>(["announcement_pdf", "official_page", "api"]);
const DATE = /^20\d{2}-\d{2}-\d{2}$/;
const HASH = /^[a-f0-9]{64}$/i;

function isIsoDateTime(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function sourceAllowed(sourceUrl: string): boolean {
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "https:") return false;
    const configured = (process.env.QUOTA_SOURCE_HOSTS ?? "")
      .split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
    return configured.length > 0 && configured.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function canonicalHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validatePayload(database: Database.Database, payload: unknown): { payload: QuotaIngestionPayload; errors: Array<{ index: number; error: string }> } {
  const errors: Array<{ index: number; error: string }> = [];
  if (!payload || typeof payload !== "object") throw new QuotaIngestionError("invalid_payload", "请求体必须是 JSON 对象");
  const input = payload as Partial<QuotaIngestionPayload>;
  if (input.schemaVersion !== 1) throw new QuotaIngestionError("invalid_schema", "schemaVersion 必须为 1");
  if (!isIsoDateTime(input.observedAt)) throw new QuotaIngestionError("invalid_observed_at", "observedAt 必须是 ISO 时间");
  if (typeof input.sourceProvider !== "string" || !input.sourceProvider.trim()) throw new QuotaIngestionError("invalid_provider", "sourceProvider 不能为空");
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 1000) throw new QuotaIngestionError("invalid_items", "items 必须包含 1 到 1000 条记录");

  const known = new Map((database.prepare("SELECT code, share_class AS shareClass, currency FROM nasdaq_funds").all() as Array<{ code: string; shareClass: string; currency: "CNY" | "USD" }>).map((row) => [row.code, row]));
  input.items.forEach((raw, index) => {
    const item = raw as Partial<QuotaIngestionItem>;
    const fund = typeof item.fundCode === "string" ? known.get(item.fundCode) : undefined;
    if (!fund) errors.push({ index, error: "基金代码不在已配置纳斯达克基金列表中" });
    if (typeof item.fundCode !== "string" || !/^\d{6}$/.test(item.fundCode)) errors.push({ index, error: "fundCode 无效" });
    if (typeof item.shareClass !== "string" || !SHARE_CLASSES.has(item.shareClass)) errors.push({ index, error: "shareClass 无效" });
    if (fund && item.shareClass !== fund.shareClass) errors.push({ index, error: "shareClass 与基金目录不匹配" });
    if (item.channel !== "direct" && item.channel !== "agency" && item.channel !== "exchange") errors.push({ index, error: "channel 必须是 direct、agency 或 exchange" });
    if (item.status !== "open" && item.status !== "limited" && item.status !== "paused") errors.push({ index, error: "status 无效" });
    if (item.status === "paused" && item.dailyLimit != null) errors.push({ index, error: "paused 状态的 dailyLimit 必须为 null" });
    if (item.status !== "paused" && item.dailyLimit != null && (typeof item.dailyLimit !== "number" || !Number.isFinite(item.dailyLimit) || item.dailyLimit < 0)) errors.push({ index, error: "dailyLimit 必须是非负数字或 null" });
    if (item.currency !== "CNY" && item.currency !== "USD") errors.push({ index, error: "currency 无效" });
    if (fund && item.currency !== fund.currency) errors.push({ index, error: "currency 与基金目录不匹配" });
    if (typeof item.effectiveOn !== "string" || !DATE.test(item.effectiveOn)) errors.push({ index, error: "effectiveOn 必须是 YYYY-MM-DD" });
    if (typeof item.sourceUrl !== "string" || !sourceAllowed(item.sourceUrl)) errors.push({ index, error: "sourceUrl 必须是允许来源的 HTTPS 地址" });
    if (item.sourceType != null && !SOURCE_TYPES.has(item.sourceType)) errors.push({ index, error: "sourceType 必须是 announcement_pdf、official_page 或 api" });
    if (item.sourcePublishedAt != null && (typeof item.sourcePublishedAt !== "string" || !isIsoDateTime(item.sourcePublishedAt))) errors.push({ index, error: "sourcePublishedAt 必须是 ISO 时间" });
    if (item.evidenceLocator != null && (typeof item.evidenceLocator !== "string" || item.evidenceLocator.length > 500)) errors.push({ index, error: "evidenceLocator 必须是不超过 500 字符的文本" });
    if (item.sourceHash != null && (typeof item.sourceHash !== "string" || !HASH.test(item.sourceHash))) errors.push({ index, error: "sourceHash 必须是 64 位十六进制哈希" });
  });
  return { payload: input as QuotaIngestionPayload, errors };
}

export function authorizeQuotaToken(requestToken: string | null): boolean {
  const expected = process.env.QUOTA_INGEST_TOKEN;
  if (!expected || !requestToken) return false;
  const a = Buffer.from(requestToken);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function ingestQuotaPayload(database: Database.Database, raw: unknown, idempotencyKey: string, now?: Date): ReturnType<typeof ingestQuotaPayloadImpl>;
export function ingestQuotaPayload(raw: unknown, idempotencyKey: string, now?: Date): ReturnType<typeof ingestQuotaPayloadImpl>;
export function ingestQuotaPayload(databaseOrRaw: Database.Database | unknown, rawOrKey: unknown, keyOrNow?: string | Date, nowArg = new Date()) {
  const hasDatabase = Boolean(databaseOrRaw && typeof databaseOrRaw === "object" && typeof (databaseOrRaw as Database.Database).prepare === "function");
  const database = (hasDatabase ? databaseOrRaw : getDb()) as Database.Database;
  const raw = hasDatabase ? rawOrKey : databaseOrRaw;
  const idempotencyKey = (hasDatabase ? keyOrNow : rawOrKey) as string;
  const now = (hasDatabase ? (keyOrNow instanceof Date ? keyOrNow : nowArg) : keyOrNow instanceof Date ? keyOrNow : nowArg);
  return ingestQuotaPayloadImpl(database, raw, idempotencyKey, now);
}

function ingestQuotaPayloadImpl(database: Database.Database, raw: unknown, idempotencyKey: string, now = new Date()) {
  if (!idempotencyKey || idempotencyKey.length > 200) throw new QuotaIngestionError("invalid_idempotency_key", "必须提供有效的 Idempotency-Key");
  const { payload, errors } = validatePayload(database, raw);
  const payloadHash = canonicalHash(payload);
  const existing = database.prepare("SELECT payload_hash AS payloadHash, accepted_count AS acceptedCount, status FROM quota_ingestion_runs WHERE idempotency_key=?").get(idempotencyKey) as { payloadHash: string; acceptedCount: number; status: string } | undefined;
  if (existing) {
    if (existing.payloadHash !== payloadHash) throw new QuotaIngestionError("idempotency_conflict", "同一 Idempotency-Key 对应了不同请求体");
    return { reused: true, accepted: existing.acceptedCount, rejected: existing.status === "rejected" ? payload.items.length : 0 };
  }
  if (errors.length) {
    database.prepare(`INSERT INTO quota_ingestion_runs (idempotency_key, source_provider, observed_at, payload_hash, item_count, accepted_count, status, error_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(idempotencyKey, payload.sourceProvider, payload.observedAt, payloadHash, payload.items.length, 0, "rejected", JSON.stringify(errors), now.toISOString());
    throw new QuotaIngestionError("validation_failed", "额度数据校验失败", errors);
  }

  const run = database.transaction(() => {
    database.prepare(`INSERT INTO quota_ingestion_runs (idempotency_key, source_provider, observed_at, payload_hash, item_count, accepted_count, status, created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(idempotencyKey, payload.sourceProvider, payload.observedAt, payloadHash, payload.items.length, payload.items.length, "accepted", now.toISOString());
    const observation = database.prepare(`INSERT INTO quota_observations (idempotency_key, code, share_class, channel_kind, status, daily_limit, currency, quota_scope, effective_on, observed_at, source_url, source_provider, created_at, source_type, source_published_at, evidence_locator, source_hash) VALUES (@idempotencyKey,@code,@shareClass,@channel,@status,@dailyLimit,@currency,@quotaScope,@effectiveOn,@observedAt,@sourceUrl,@sourceProvider,@createdAt,@sourceType,@sourcePublishedAt,@evidenceLocator,@sourceHash)`);
    const current = database.prepare(`INSERT INTO quota_current (code, share_class, channel_kind, status, daily_limit, currency, quota_scope, effective_on, observed_at, source_url, source_provider, updated_at, source_type, source_published_at, evidence_locator, source_hash) VALUES (@code,@shareClass,@channel,@status,@dailyLimit,@currency,@quotaScope,@effectiveOn,@observedAt,@sourceUrl,@sourceProvider,@createdAt,@sourceType,@sourcePublishedAt,@evidenceLocator,@sourceHash) ON CONFLICT(code,share_class,channel_kind) DO UPDATE SET status=excluded.status,daily_limit=excluded.daily_limit,currency=excluded.currency,quota_scope=excluded.quota_scope,effective_on=excluded.effective_on,observed_at=excluded.observed_at,source_url=excluded.source_url,source_provider=excluded.source_provider,updated_at=excluded.updated_at,source_type=excluded.source_type,source_published_at=excluded.source_published_at,evidence_locator=excluded.evidence_locator,source_hash=excluded.source_hash`);
    const exchangeObservation = database.prepare(`INSERT INTO quota_exchange_observations (idempotency_key, code, share_class, status, daily_limit, currency, quota_scope, effective_on, observed_at, source_url, source_provider, created_at, source_type, source_published_at, evidence_locator, source_hash) VALUES (@idempotencyKey,@code,@shareClass,@status,@dailyLimit,@currency,@quotaScope,@effectiveOn,@observedAt,@sourceUrl,@sourceProvider,@createdAt,@sourceType,@sourcePublishedAt,@evidenceLocator,@sourceHash)`);
    const exchangeCurrent = database.prepare(`INSERT INTO quota_exchange_current (code, share_class, status, daily_limit, currency, quota_scope, effective_on, observed_at, source_url, source_provider, updated_at, source_type, source_published_at, evidence_locator, source_hash) VALUES (@code,@shareClass,@status,@dailyLimit,@currency,@quotaScope,@effectiveOn,@observedAt,@sourceUrl,@sourceProvider,@createdAt,@sourceType,@sourcePublishedAt,@evidenceLocator,@sourceHash) ON CONFLICT(code,share_class) DO UPDATE SET status=excluded.status,daily_limit=excluded.daily_limit,currency=excluded.currency,quota_scope=excluded.quota_scope,effective_on=excluded.effective_on,observed_at=excluded.observed_at,source_url=excluded.source_url,source_provider=excluded.source_provider,updated_at=excluded.updated_at,source_type=excluded.source_type,source_published_at=excluded.source_published_at,evidence_locator=excluded.evidence_locator,source_hash=excluded.source_hash`);
    for (const item of payload.items) {
      const row = { idempotencyKey, code: item.fundCode, shareClass: item.shareClass, channel: item.channel, status: item.status, dailyLimit: item.status === "paused" ? null : item.dailyLimit, currency: item.currency, quotaScope: item.quotaScope ?? `${item.fundCode}:${item.shareClass}:${item.channel}`, effectiveOn: item.effectiveOn, observedAt: payload.observedAt, sourceUrl: item.sourceUrl, sourceProvider: payload.sourceProvider, createdAt: now.toISOString(), sourceType: item.sourceType ?? (item.sourceUrl.toLowerCase().split("?")[0].endsWith(".pdf") ? "announcement_pdf" : "official_page"), sourcePublishedAt: item.sourcePublishedAt ?? null, evidenceLocator: item.evidenceLocator ?? null, sourceHash: item.sourceHash ?? null };
      if (item.channel === "exchange") {
        exchangeObservation.run(row); exchangeCurrent.run(row);
      } else {
        observation.run(row); current.run(row);
      }
    }
  });
  run();
  return { reused: false, accepted: payload.items.length, rejected: 0 };
}
