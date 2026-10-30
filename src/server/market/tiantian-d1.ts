import { fetchTiantianQuota, type TiantianQuotaRecord } from "./tiantian";

type Value = string | number | null;
type Statement = { bind(...values: Value[]): unknown };
export interface MarketD1 {
  prepare(sql: string): Statement;
  batch(statements: unknown[]): Promise<unknown>;
}

export type AgencyQuotaFund = { code: string; shareClass: string; currency: "CNY" | "USD" };
export type AgencyQuotaUpdate = { fund: AgencyQuotaFund; quota: TiantianQuotaRecord };

// A chunk leaves room for other subrequests on the Workers Free plan.
export const AGENCY_QUOTA_CHUNK_SIZE = 25;

export async function syncAgencyQuotaChunkD1(
  db: MarketD1,
  input: { key: string; bizDate: string; observedAt: string; funds: AgencyQuotaFund[] },
  fetcher: typeof fetch = fetch,
) {
  if (input.funds.length > AGENCY_QUOTA_CHUNK_SIZE) throw new Error("Too many funds in quota chunk");
  if (new Set(input.funds.map((fund) => fund.code)).size !== input.funds.length) throw new Error("Duplicate fund in quota chunk");
  const updates: AgencyQuotaUpdate[] = [];
  const failed: Array<{ code: string; error: string }> = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, input.funds.length) }, async () => {
    while (cursor < input.funds.length) {
      const fund = input.funds[cursor++];
      try { updates.push({ fund, quota: await fetchTiantianQuota(fund.code, fetcher) }); }
      catch (error) { failed.push({ code: fund.code, error: error instanceof Error ? error.message : String(error) }); }
    }
  }));
  await saveAgencyQuotaD1(db, { ...input, requested: input.funds.length, updates });
  return { requested: input.funds.length, success: updates.length, failed };
}

/** Persist one bounded refresh batch atomically. Keys must be unique for each
 * refresh chunk and stable across retries. The caller owns job aggregation. */
export async function saveAgencyQuotaD1(
  db: MarketD1,
  input: { key: string; bizDate: string; observedAt: string; requested: number; updates: AgencyQuotaUpdate[] },
): Promise<void> {
  const { key, bizDate, observedAt, requested, updates } = input;
  const bind = (sql: string, ...args: Value[]) => db.prepare(sql).bind(...args);
  const statements = [bind(`INSERT INTO quota_ingestion_runs (idempotency_key, source_provider, observed_at, payload_hash, item_count, accepted_count, status, created_at)
      VALUES (?, 'tiantian-fund', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET observed_at=excluded.observed_at, payload_hash=excluded.payload_hash,
      item_count=excluded.item_count, accepted_count=excluded.accepted_count, status=excluded.status`,
    key, observedAt, key, requested, updates.length, updates.length || requested === 0 ? "accepted" : "rejected", observedAt)];
  for (const { fund, quota } of updates) {
    const scope = quota.rawStatus === "场内交易" ? "场内交易" : "日累计申购限额";
    statements.push(bind(`INSERT INTO quota_observations
      (idempotency_key, code, share_class, channel_kind, status, daily_limit, currency, quota_scope, effective_on, observed_at, source_url, source_provider, created_at, purchase_fee_pct, purchase_fee_json)
      VALUES (?, ?, ?, 'agency', ?, ?, ?, ?, ?, ?, ?, 'tiantian-fund', ?, ?, ?)
      ON CONFLICT(idempotency_key, code, share_class, channel_kind) DO UPDATE SET status=excluded.status,
      daily_limit=excluded.daily_limit, currency=excluded.currency, quota_scope=excluded.quota_scope,
      effective_on=excluded.effective_on, observed_at=excluded.observed_at, source_url=excluded.source_url,
      source_provider=excluded.source_provider, created_at=excluded.created_at,
      purchase_fee_pct=excluded.purchase_fee_pct, purchase_fee_json=excluded.purchase_fee_json`,
    key, fund.code, fund.shareClass, quota.status, quota.dailyLimit, fund.currency, scope, bizDate, observedAt, quota.sourceUrl, observedAt, quota.purchaseFeePct, quota.purchaseFeeJson));
    statements.push(bind(`INSERT INTO quota_current
      (code, share_class, channel_kind, status, daily_limit, currency, quota_scope, effective_on, observed_at, source_url, source_provider, updated_at, purchase_fee_pct, purchase_fee_json)
      VALUES (?, ?, 'agency', ?, ?, ?, ?, ?, ?, ?, 'tiantian-fund', ?, ?, ?)
      ON CONFLICT(code, share_class, channel_kind) DO UPDATE SET status=excluded.status,
      daily_limit=excluded.daily_limit, currency=excluded.currency, quota_scope=excluded.quota_scope,
      effective_on=excluded.effective_on, observed_at=excluded.observed_at, source_url=excluded.source_url,
      source_provider=excluded.source_provider, updated_at=excluded.updated_at,
      purchase_fee_pct=excluded.purchase_fee_pct, purchase_fee_json=excluded.purchase_fee_json`,
    fund.code, fund.shareClass, quota.status, quota.dailyLimit, fund.currency, scope, bizDate, observedAt, quota.sourceUrl, observedAt, quota.purchaseFeePct, quota.purchaseFeeJson));
  }
  await db.batch(statements);
}
