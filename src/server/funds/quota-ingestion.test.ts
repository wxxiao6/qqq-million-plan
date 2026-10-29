import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const tmp = mkdtempSync(path.join(os.tmpdir(), "quota-ingestion-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));
vi.stubEnv("QUOTA_INGEST_TOKEN", "test-token");
vi.stubEnv("QUOTA_SOURCE_HOSTS", "fund.eastmoney.com");

afterEach(() => { vi.resetModules(); });

describe("额度上报", () => {
  it("校验后写入历史和当前值，并支持幂等重放", async () => {
    const { getDb } = await import("@/server/db");
    const { ingestQuotaPayload } = await import("./quota-ingestion");
    const payload = {
      schemaVersion: 1 as const,
      observedAt: "2026-10-28T02:00:00.000Z",
      sourceProvider: "test-bot",
      items: [{ fundCode: "016452", shareClass: "A", channel: "direct" as const, status: "limited" as const, dailyLimit: 1_000_000, currency: "CNY" as const, effectiveOn: "2026-10-28", sourceUrl: "https://fund.eastmoney.com/016452.html", sourceType: "official_page" as const }],
    };
    const first = ingestQuotaPayload(getDb(), payload, "run-1");
    const second = ingestQuotaPayload(getDb(), payload, "run-1");
    expect(first).toMatchObject({ reused: false, accepted: 1 });
    expect(second).toMatchObject({ reused: true, accepted: 1 });
    expect(getDb().prepare("SELECT status,daily_limit,source_type FROM quota_current WHERE code='016452' AND channel_kind='direct'").get()).toEqual({ status: "limited", daily_limit: 1_000_000, source_type: "official_page" });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM quota_observations WHERE code='016452'").get()).toEqual({ count: 1 });
  });

  it("拒绝目录外基金、暂停状态额度和不允许来源", async () => {
    const { getDb } = await import("@/server/db");
    const { ingestQuotaPayload, QuotaIngestionError } = await import("./quota-ingestion");
    expect(() => ingestQuotaPayload(getDb(), { schemaVersion: 1, observedAt: "2026-10-28T02:00:00Z", sourceProvider: "test", items: [{ fundCode: "999999", shareClass: "A", channel: "agency", status: "paused", dailyLimit: 10, currency: "CNY", effectiveOn: "2026-10-28", sourceUrl: "https://evil.example/item" }] }, "run-bad")).toThrowError(QuotaIngestionError);
    expect(getDb().prepare("SELECT status FROM quota_ingestion_runs WHERE idempotency_key='run-bad'").get()).toEqual({ status: "rejected" });
  });

  it("将场内额度写入独立快照，不混入场外额度 projection", async () => {
    const { getDb } = await import("@/server/db");
    const { ingestQuotaPayload } = await import("./quota-ingestion");
    const result = ingestQuotaPayload(getDb(), {
      schemaVersion: 1,
      observedAt: "2026-10-29T14:30:00Z",
      sourceProvider: "ai-quota-agent",
      items: [{ fundCode: "159941", shareClass: "A", channel: "exchange", status: "open", dailyLimit: null, currency: "CNY", effectiveOn: "2026-10-29", sourceUrl: "https://fund.eastmoney.com/159941.html", sourceType: "official_page" }],
    }, "exchange-run-1");
    expect(result).toMatchObject({ reused: false, accepted: 1 });
    expect(getDb().prepare("SELECT status,daily_limit,source_type FROM quota_exchange_current WHERE code='159941' AND share_class='A'").get()).toEqual({ status: "open", daily_limit: null, source_type: "official_page" });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM quota_current WHERE code='159941'").get()).toEqual({ count: 0 });
  });

  it("保存公告 PDF 证据及定位信息", async () => {
    const { getDb } = await import("@/server/db");
    const { ingestQuotaPayload } = await import("./quota-ingestion");
    ingestQuotaPayload(getDb(), {
      schemaVersion: 1,
      observedAt: "2026-10-29T05:00:00Z",
      sourceProvider: "ai-quota-agent",
      items: [{
        fundCode: "016452", shareClass: "A", channel: "direct", status: "limited", dailyLimit: 10, currency: "CNY", effectiveOn: "2026-10-29",
        sourceUrl: "https://fund.eastmoney.com/evidence/016452.pdf",
        sourceType: "announcement_pdf", sourcePublishedAt: "2026-10-28T08:00:00Z", evidenceLocator: "第2页：申购限额", sourceHash: "a".repeat(64),
      }],
    }, "pdf-evidence-run");
    expect(getDb().prepare("SELECT source_url,source_type,source_published_at,evidence_locator,source_hash FROM quota_current WHERE code='016452' AND channel_kind='direct'").get()).toEqual({
      source_url: "https://fund.eastmoney.com/evidence/016452.pdf",
      source_type: "announcement_pdf",
      source_published_at: "2026-10-28T08:00:00Z",
      evidence_locator: "第2页：申购限额",
      source_hash: "a".repeat(64),
    });
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
