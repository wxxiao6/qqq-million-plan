import { NextResponse } from "next/server";
import { syncNasdaqFundNav } from "@/server/market/biying";
import { syncTiantianAgencyQuota, tiantianNavSource } from "@/server/market/tiantian";
import { finishCloudRefresh, newRefreshRun, refreshCloudChunk, validRefreshRun, type RefreshTotals } from "@/server/market/refresh-d1";

/** 手动触发天天基金净值与代销额度刷新；直销额度仍由外部机器人上报。 */
function validTotals(value: unknown): value is RefreshTotals {
  if (!value || typeof value !== "object") return false;
  const totals = value as RefreshTotals;
  return Number.isInteger(totals.requested) && totals.requested >= 0 && totals.requested <= 10000 &&
    Number.isInteger(totals.success) && totals.success >= 0 && totals.success <= totals.requested &&
    Array.isArray(totals.failed) && totals.failed.length === totals.requested - totals.success &&
    totals.failed.every((item) => item && typeof item.code === "string" && /^\d{6}$/.test(item.code) && typeof item.error === "string" && item.error.length <= 2000);
}

export async function POST(request: Request) {
  if (process.env.CLOUDFLARE_RUNTIME === "1") {
    let input: Record<string, unknown>;
    try { input = await request.json() as Record<string, unknown>; }
    catch { input = {}; }
    if (!input || typeof input !== "object" || Array.isArray(input)) return NextResponse.json({ error: "invalid_refresh_request" }, { status: 400 });
    if (input.phase == null || input.phase === "init") return NextResponse.json(newRefreshRun());
    if (!validRefreshRun(input)) return NextResponse.json({ error: "invalid_refresh_run" }, { status: 400 });
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = getCloudflareContext();
    const db = (env as unknown as { DB: Parameters<typeof refreshCloudChunk>[0] }).DB;
    const run = { runId: input.runId as string, bizDate: input.bizDate as string, observedAt: input.observedAt as string };
    if ((input.phase === "nav" || input.phase === "quota") && typeof input.after === "string" && /^(?:\d{6})?$/.test(input.after)) {
      const result = await refreshCloudChunk(db, { ...run, phase: input.phase, after: input.after });
      return NextResponse.json(result);
    }
    if (input.phase === "finish" && validTotals(input.nav) && validTotals(input.quota)) {
      await finishCloudRefresh(db, { ...run, nav: input.nav, quota: input.quota });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "invalid_refresh_request" }, { status: 400 });
  }
  const nav = await syncNasdaqFundNav(new Date(), fetch, tiantianNavSource);
  const quota = await syncTiantianAgencyQuota();
  const failed = [...nav.failed, ...quota.failed];
  const success = nav.success + quota.success;
  return NextResponse.json({ ...nav, source: "tiantian", quota, success, failed, partial: success > 0 && failed.length > 0, error: failed.length ? failed.map((item) => `${item.code}：${item.error}`).join("；") : undefined }, {
    status: failed.length === 0 ? 200 : success > 0 ? 207 : 502,
  });
}
