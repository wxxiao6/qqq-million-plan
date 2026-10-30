import { fetchBiyingInfo } from "./biying";
import type { MarketD1 } from "./tiantian-d1";

/** A bounded chunk stays below the Workers external subrequest limit. */
export async function syncInfoChunkD1(db: MarketD1, input: { after: string; observedAt: string }, fetcher: typeof fetch = fetch) {
  const query = db.prepare("SELECT code FROM nasdaq_funds WHERE code > ? ORDER BY code LIMIT 26").bind(input.after) as { all<T>(): Promise<{ results: T[] }> };
  const rows = (await query.all<{ code: string }>()).results;
  const funds = rows.slice(0, 25);
  const settled: Array<PromiseSettledResult<Awaited<ReturnType<typeof fetchBiyingInfo>>>> = new Array(funds.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, funds.length) }, async () => {
    while (cursor < funds.length) {
      const index = cursor++;
      try { settled[index] = { status: "fulfilled", value: await fetchBiyingInfo(funds[index].code, fetcher) }; }
      catch (reason) { settled[index] = { status: "rejected", reason }; }
    }
  }));
  const failed: Array<{ code: string; error: string }> = [];
  const writes = settled.flatMap((result, index) => {
    if (result.status === "rejected") {
      failed.push({ code: funds[index].code, error: result.reason instanceof Error ? result.reason.message.slice(0, 200) : "获取失败" });
      return [];
    }
    const item = result.value;
    // The API license is part of the source URL and must never be persisted in D1.
    const source = new URL(item.sourceUrl); source.pathname = source.pathname.replace(/\/[^/]+$/, "/[redacted]");
    const text = (value: unknown) => value == null ? null : String(value);
    return [db.prepare(`INSERT INTO fund_info_snapshots (code,name,full_name,fund_type,manager,raw_json,source,source_url,fetched_at)
      SELECT ?,?,?,?,?,?,'biying',?,? WHERE NOT EXISTS
      (SELECT 1 FROM fund_info_snapshots WHERE code=? AND source='biying' AND fetched_at=?)`)
      .bind(item.code, text(item.shortName), text(item.fullName), text(item.fundType), text(item.manager), JSON.stringify(item.raw), source.toString(), input.observedAt, item.code, input.observedAt)];
  });
  if (writes.length) await db.batch(writes);
  return { requested: funds.length, success: writes.length, failed, next: rows.length > 25 ? funds[funds.length - 1].code : null };
}
