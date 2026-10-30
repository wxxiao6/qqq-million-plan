type Failure = { code: string; error: string };
type Totals = { requested: number; success: number; failed: Failure[] };
type Result = { ok: boolean; partial?: boolean; error?: string; failed?: Failure[] };

/** Workers Free limits external subrequests, so the browser advances bounded
 * batches. A failed request stops the run without pretending it completed. */
export async function refreshMarket(fetcher: typeof fetch = fetch): Promise<Result> {
  const call = async (body?: unknown) => {
    const response = await fetcher("/api/market/refresh", {
      method: "POST", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok && response.status !== 207 && !(body == null && typeof result.ok === "boolean")) {
      throw new Error(result.error ?? "刷新请求失败");
    }
    return result;
  };
  const initial = await call();
  if (!initial.chunked) return initial as Result;
  const run = { runId: initial.runId, observedAt: initial.observedAt, bizDate: initial.bizDate };
  const totals: Record<"nav" | "quota", Totals> = {
    nav: { requested: 0, success: 0, failed: [] }, quota: { requested: 0, success: 0, failed: [] },
  };
  for (const phase of ["nav", "quota"] as const) {
    let after = "";
    do {
      const batch = await call({ ...run, phase, after });
      totals[phase].requested += batch.requested;
      totals[phase].success += batch.success;
      totals[phase].failed.push(...batch.failed);
      if (batch.next != null && (typeof batch.next !== "string" || batch.next <= after)) throw new Error("无效的刷新进度");
      after = batch.next ?? "";
    } while (after);
  }
  await call({ ...run, phase: "finish", ...totals });
  const failed = [...totals.nav.failed, ...totals.quota.failed];
  const success = totals.nav.success + totals.quota.success;
  return { ok: failed.length === 0, partial: success > 0 && failed.length > 0, failed,
    error: failed.length ? failed.map((item) => `${item.code}：${item.error}`).join("；") : undefined };
}
