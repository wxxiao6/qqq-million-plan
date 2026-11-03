import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, expect, it, vi } from "vitest";
import type { ReconcileD1 } from "./reconcile-d1";

const tmp = mkdtempSync(path.join(os.tmpdir(), "import-d1-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));
vi.mock("@/server/auth/context", () => ({ requireUser: async () => ({ id: "test-owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
let cloudBinding: ReconcileD1;
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: { DB: cloudBinding } }) }));
function binding(db: Database.Database): ReconcileD1 {
  return { prepare(sql) { return { bind(...values) { return { sql, values } as unknown as ReturnType<ReconcileD1["prepare"]>; } }; },
    async batch(statements) { return db.transaction(() => statements.map((item) => {
      const { sql, values } = item as unknown as { sql: string; values: (string | number | null)[] };
      const stmt = db.prepare(sql);
      return { results: stmt.reader ? stmt.all(...values) : (stmt.run(...values), []) };
    }))(); } };
}
it("matches SQLite for manual updates and atomic CSV imports", async () => {
  vi.stubEnv("CLOUDFLARE_RUNTIME", "0");
  const { getDb } = await import("../db");
  const actions = await import("./actions");
  const local = getDb(); local.pragma("journal_mode = DELETE");
  const cloud = new Database(local.serialize()); cloudBinding = binding(cloud);
  const both = async (action: () => Promise<unknown>) => {
    vi.stubEnv("CLOUDFLARE_RUNTIME", "0"); const expected = await action();
    vi.stubEnv("CLOUDFLARE_RUNTIME", "1"); expect(await action()).toEqual(expected);
  };
  await both(() => actions.importPositionsCsv("account,symbol,shares,cost,status\nalipay,AAA,3,12,settled\ncmb,BBB,2,4,pending"));
  await both(() => actions.importPositionsCsv("jd,CCC,1,2,settled\nalipay,AAA,1,2,settled"));
  await both(() => actions.importPositionsCsv("jd,DDD,1,2,settled\njd,DDD,1,2,pending"));
  await both(() => actions.importPositionsCsv("jd,EEE,1,2,settled\ncmb,FFF,0,2,settled"));
  await both(() => actions.importNavCsv("symbol,date,nav\nAAA,2026-01-01,2\nBBB,2026-01-01,3"));
  await both(() => actions.importNavCsv("AAA,2026-01-02,2\nBBB,bad,3"));
  await both(() => actions.saveNav({ symbol: "AAA", asOf: "2026-01-01", nav: 2.5 }));
  await both(() => actions.savePortfolioSnapshot({ asOf: "2025-01-01", dynamicMv: 42 }));
  for (const table of ["positions", "nav_snapshots", "portfolio_snapshots"]) {
    const normalize = (db: Database.Database) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((row) => {
      const copy = { ...(row as Record<string, unknown>) }; delete copy.updated_at; return copy;
    });
    expect(normalize(cloud)).toEqual(normalize(local));
  }
  expect((cloud.prepare("SELECT count(*) n FROM positions").get() as { n: number }).n).toBe(2);
  cloud.close(); vi.stubEnv("CLOUDFLARE_RUNTIME", "0");
});
it("imports an independent holding beside DCA while still rejecting duplicate CSV entries", async () => {
  vi.stubEnv("CLOUDFLARE_RUNTIME", "0");
  const { getDb } = await import("../db");
  const { upsertDcaPlan, recordPlanExecution } = await import("../dca");
  const { importPositionsCsv } = await import("./actions");
  const { importPositionsCsvD1 } = await import("./import-d1");
  const local = getDb();
  const plan = upsertDcaPlan({ symbol: "008971", shareClass: "C", channelKind: "direct", amount: 100, frequency: "weekly", weekday: 3, startDate: "2026-10-01" });
  if (!plan.ok) throw new Error(plan.error);
  expect(recordPlanExecution(plan.id, { status: "bought_before_cutoff", executionDate: "2026-10-07" }).ok).toBe(true);
  local.pragma("journal_mode = DELETE");
  const cloud = new Database(local.serialize());
  try {
    const csv = "gf_direct,008971,10,50,settled";
    expect(await importPositionsCsv(csv)).toEqual({ ok: true });
    expect(await importPositionsCsvD1(binding(cloud), csv)).toEqual({ ok: true });
    expect(await importPositionsCsvD1(binding(cloud), csv)).toEqual(await importPositionsCsv(csv));
    expect(cloud.prepare("SELECT count(*) AS n FROM positions WHERE dca_plan_id=?").get(plan.id)).toEqual({ n: 1 });
    expect(cloud.prepare("SELECT shares,cost FROM positions WHERE symbol='008971' AND dca_plan_id IS NULL").get()).toEqual({ shares: 10, cost: 50 });
  } finally { cloud.close(); }
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
