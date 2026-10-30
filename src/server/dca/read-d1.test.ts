import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const tmp = mkdtempSync(path.join(os.tmpdir(), "dca-read-d1-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));

describe("D1 DCA dashboard read", () => {
  it("matches SQLite's candidates, plans, history and managers", async () => {
    const { getDb } = await import("../db");
    const db = getDb();
    const { upsertDcaPlan, getDcaBoard, listDcaExecutionHistory } = await import("./index");
    const { createPendingSubscription } = await import("../ledger/pending");
    const { listNasdaqHoldingManagers } = await import("../ledger");
    const { readDcaDashboardD1 } = await import("./read-d1");
    const plan = upsertDcaPlan({ symbol: "019547", shareClass: "A", channelKind: "agency", account: "alipay", amount: 10, frequency: "daily", startDate: "2026-10-08" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error(plan.error);
    expect(createPendingSubscription({ symbol: "019547", account: "alipay", dcaPlanId: plan.id, executionOn: "2026-10-08", cutoffPeriod: "before_15", cashDebited: 10, feeAmount: 0 }).ok).toBe(true);
    const d1 = {
      prepare(sql: string) { return sql; },
      async batch(statements: unknown[]) { return db.transaction(() => statements.map((sql) => ({ results: db.prepare(sql as string).all() })))(); },
    };
    const result = await readDcaDashboardD1(d1);
    expect(result.board).toEqual(getDcaBoard());
    expect(result.records).toEqual(listDcaExecutionHistory());
    expect(result.managers).toEqual(listNasdaqHoldingManagers());
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
