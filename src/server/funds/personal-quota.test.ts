import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it, vi } from "vitest";

const tmp = mkdtempSync(path.join(os.tmpdir(), "personal-quota-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

it("uses the same read-only, user-scoped SQL for SQLite and D1, excluding paused/ended plans and old holdings", async () => {
  const { getDb } = await import("../db");
  const { localFundDatabase } = await import("./database");
  const { readPersonalQuota } = await import("./personal-quota");
  const { listNasdaqFunds } = await import("./catalog");
  const db = getDb();
  for (const id of ["owner", "other-user"]) db.prepare("INSERT INTO users(id,email,password_hash,role,created_at) VALUES(?,?,?,'member','2026-11-04')").run(id, id, "test");
  const insertPlan = db.prepare(`INSERT INTO dca_plans(user_id,symbol,share_class,channel_kind,account,amount,frequency,start_date,status,ended_at,updated_at)
    VALUES(?,'016452','A','agency','alipay',?,'daily','2026-11-04',?,?,'2026-11-04')`);
  insertPlan.run("owner", 20, "active", null);
  insertPlan.run("other-user", 90, "active", null);
  insertPlan.run("owner", 30, "paused", null);
  insertPlan.run("owner", 40, "active", "2026-11-03");
  const insertOrder = db.prepare(`INSERT INTO positions(user_id,account,exposure,symbol,shares,cost,cash_debited,fee_amount,status,execution_on,cutoff_period,updated_at)
    VALUES(?,'alipay','nasdaq','016452',NULL,?,?,?,'pending',?,'before_15','2026-11-04')`);
  insertOrder.run("owner", 9, 10, 1, "2026-11-04");
  insertOrder.run("other-user", 50, 50, 0, "2026-11-04");
  insertOrder.run("owner", 40, 40, 0, "2026-10-30");
  // A starting holding snapshot is not a purchase placed today.
  db.prepare("INSERT INTO positions(user_id,account,exposure,symbol,cost,status,recorded_on,t_date,updated_at) VALUES('owner','alipay','nasdaq','016452',1000,'settled','2026-11-04','2026-11-04','2026-11-04')").run();
  const funds = listNasdaqFunds(db).map((fund) => fund.code === "016452" ? { ...fund, agencyTradeStatus: "limited" as const, agencyStatus: "verified" as const, agencyDailyLimit: 100, agencyLimitScope: null } : fund);
  const changesBefore = db.prepare("SELECT total_changes() AS count").get();
  const local = await readPersonalQuota(localFundDatabase(db), "owner", funds, "2026-11-04");
  const queries: string[] = [];
  const binding = { prepare(sql: string) { queries.push(sql); return localFundDatabase(db).prepare(sql); }, batch: localFundDatabase(db).batch };
  expect(await readPersonalQuota(binding, "owner", funds, "2026-11-04")).toEqual(local);
  expect(local["016452:agency"]).toMatchObject({ ownPlanCount: 1, remaining: 70, recorded: 10, scheduled: 20 });
  expect(queries).toHaveLength(2);
  expect(queries.every((sql) => sql.includes("p.user_id=?") && sql.trim().startsWith("SELECT"))).toBe(true);
  expect(db.prepare("SELECT total_changes() AS count").get()).toEqual(changesBefore);
});
