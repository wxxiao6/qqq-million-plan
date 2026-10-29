import { saveRecentNavHistory } from "../ledger/recent-pending";
/** 任务 B：写入净值并重算估值；在途申购须由用户按确认份额手动结转。 */

import { beijingTodayISO } from "@/lib/format";
import type { NasdaqShareSituation } from "@/lib/market";
import { getDb } from "../db";
import { getDynamicMarketValue } from "../ledger";
import { fetchMockMarket } from "../market/mock";
import { writeJob } from "./status";

export type NavJobResult =
  | { ok: true; bizDate: string; netInflow: number }
  | { ok: false; error: string };

function writeNavForHeld(shares: NasdaqShareSituation[], held: Set<string>) {
  const db = getDb();
  const read = db.prepare(
    `SELECT source FROM nav_snapshots WHERE symbol = ? AND as_of = ?`,
  );
  const upsert = db.prepare(
    `INSERT INTO nav_snapshots (symbol, as_of, nav, source) VALUES (?, ?, ?, 'auto')
     ON CONFLICT(symbol, as_of) DO UPDATE SET nav = excluded.nav, source = 'auto'`,
  );

  for (const share of shares) {
    if (!held.has(share.symbol)) continue;
    if (share.navHistory?.length) saveRecentNavHistory(share.symbol, share.navHistory);
    if (share.priorNav != null && Number.isFinite(share.priorNav) && share.priorNav > 0 &&
        share.priorNavDate && share.navDate && share.priorNavDate < share.navDate) {
      const prior = read.get(share.symbol, share.priorNavDate) as { source: string | null } | undefined;
      if (prior?.source !== "manual") upsert.run(share.symbol, share.priorNavDate, share.priorNav);
    }
    if (share.nav == null || !share.navDate) continue;
    const existing = read.get(share.symbol, share.navDate) as
      | { source: string | null }
      | undefined;
    if (existing?.source === "manual") continue;
    upsert.run(share.symbol, share.navDate, share.nav);
  }
}

function heldNasdaqSymbols(): Set<string> {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT symbol FROM positions WHERE exposure = 'nasdaq'
       UNION
       SELECT DISTINCT symbol FROM dca_plans WHERE status = 'active' AND exposure = 'nasdaq'`,
    )
    .all() as Array<{ symbol: string }>;
  return new Set(rows.map((row) => row.symbol));
}

export function runNavScan(input?: {
  now?: Date;
  shares?: NasdaqShareSituation[];
  failAfterPost?: boolean;
  error?: string;
}): NavJobResult {
  const now = input?.now ?? new Date();
  const bizDate = beijingTodayISO(now);
  const at = now.toISOString();

  if (input?.error) {
    writeJob("nav_scan", { ok: false, at, bizDate, error: input.error });
    return { ok: false, error: input.error };
  }

  const fetched =
    input?.shares != null
      ? { ok: true as const, shares: input.shares }
      : fetchMockMarket();

  if (!fetched.ok) {
    writeJob("nav_scan", { ok: false, at, bizDate, error: fetched.error });
    return { ok: false, error: fetched.error };
  }

  const db = getDb();
  try {
    const run = db.transaction(() => {
      const held = heldNasdaqSymbols();
      writeNavForHeld(fetched.shares, held);
      const netInflow = 0;
      if (input?.failAfterPost) throw new Error("forced-fail");
      const marketValue = getDynamicMarketValue(bizDate);
      if (marketValue != null) {
        db.prepare(
          `INSERT INTO portfolio_snapshots (as_of, dynamic_mv) VALUES (?, ?)
           ON CONFLICT(as_of) DO UPDATE SET dynamic_mv = excluded.dynamic_mv`,
        ).run(bizDate, marketValue);
      }
      return netInflow;
    });
    const netInflow = run();
    writeJob("nav_scan", { ok: true, at, bizDate, netInflow });
    return { ok: true, bizDate, netInflow };
  } catch (error) {
    const message = error instanceof Error ? error.message : "净值任务失败";
    writeJob("nav_scan", { ok: false, at, bizDate, error: message });
    return { ok: false, error: message };
  }
}
