import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const tmp = mkdtempSync(path.join(os.tmpdir(), "tiantian-market-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));

describe("天天基金数据源", () => {
  it("解析净值和交易规则", async () => {
    const { parseTiantianNav, parseTiantianQuota } = await import("./tiantian");
    expect(parseTiantianNav("016452", { data: [
      { FSRQ: "2026-10-26", DWJZ: "2.07", JZZZL: "-0.2" },
      { FSRQ: "2026-10-27", DWJZ: "2.10", JZZZL: "1.25" },
    ] }, "https://example.com/nav")).toMatchObject({ code: "016452", navDate: "2026-10-27", nav: 2.1, dailyChangePct: 1.25 });
    expect(parseTiantianQuota("016452", { Datas: {
      SGZT: "限大额", MAXSG: "10", MGREXP: "0.50%", sg: [{ money: "<100万", source: "1.20%", rate: "0.12%" }],
    } }, "https://example.com/rate")).toMatchObject({ code: "016452", status: "limited", dailyLimit: 10, purchaseFeePct: 0.12, managementFeePct: 0.5, managementFeeStatus: "valid" });
    expect(parseTiantianQuota("016452", { Datas: { SGZT: "开放申购", MGREXP: "--" } }, "https://example.com/rate")).toMatchObject({ managementFeePct: null, managementFeeStatus: "invalid" });
  });

  it("只更新代销额度，保留外部机器人写入的直销额度", async () => {
    const { getDb } = await import("@/server/db");
    const db = getDb();
    db.prepare("INSERT INTO nav_snapshots (symbol, as_of, nav, source) VALUES ('016452', '2026-10-27', 10, 'auto')").run();
    db.prepare(`INSERT INTO quota_current
      (code, share_class, channel_kind, status, daily_limit, currency, quota_scope, effective_on, observed_at, source_url, source_provider, updated_at)
      SELECT code, share_class, 'direct', 'limited', 123, currency, 'bot:direct', '2026-10-28', '2026-10-28T01:00:00Z', 'https://bot.example/direct', 'external-ai-bot', '2026-10-28T01:00:00Z'
      FROM nasdaq_funds WHERE code='016452'`).run();
    const { syncTiantianAgencyQuota } = await import("./tiantian");
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const code = new URL(String(input)).searchParams.get("FCODE") ?? "";
      return new Response(JSON.stringify({ Datas: { SGZT: code === "021000" ? "场内交易" : "限大额", MAXSG: "10", MGREXP: "0.50%", sg: [{ rate: "0.12%" }] } }), { status: 200 });
    });
    const result = await syncTiantianAgencyQuota(new Date("2026-10-28T14:00:00.000Z"), fetcher);
    expect(result.success).toBeGreaterThan(0);
    expect(db.prepare("SELECT status,daily_limit,source_provider,purchase_fee_pct FROM quota_current WHERE code='016452' AND channel_kind='agency'").get()).toMatchObject({ status: "limited", daily_limit: 10, source_provider: "tiantian-fund", purchase_fee_pct: 0.12 });
    expect(db.prepare("SELECT status,daily_limit,source_provider FROM quota_current WHERE code='016452' AND channel_kind='direct'").get()).toEqual({ status: "limited", daily_limit: 123, source_provider: "external-ai-bot" });
    expect(db.prepare("SELECT annual_rate_pct, raw_value, status FROM fund_management_fee_rates WHERE code='016452' AND effective_on='2026-10-27'").get()).toEqual({ annual_rate_pct: 0.5, raw_value: "0.50%", status: "valid" });
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
