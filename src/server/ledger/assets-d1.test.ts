import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ReconcileD1 } from "./reconcile-d1";

const tmp = mkdtempSync(path.join(os.tmpdir(), "assets-d1-"));
vi.stubEnv("P0_TEST_DB", path.join(tmp, "ledger.sqlite"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
let cloudBinding: ReconcileD1;
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: { DB: cloudBinding } }) }));

function binding(db: Database.Database): ReconcileD1 {
  return {
    prepare(sql) { return { bind(...values) { return { sql, values } as unknown as ReturnType<ReconcileD1["prepare"]>; } }; },
    async batch(statements) { return db.transaction(() => statements.map((item) => {
      const { sql, values } = item as unknown as { sql: string; values: (string | number | null)[] };
      const stmt = db.prepare(sql);
      return { results: stmt.reader ? stmt.all(...values) : (stmt.run(...values), []) };
    }))(); },
  };
}

describe("D1 assets", () => {
  it("matches local writes and reads for deposits, mortgage and cash", async () => {
    vi.stubEnv("CLOUDFLARE_RUNTIME", "0");
    const { getDb } = await import("../db");
    const ledger = await import("./index");
    const actions = await import("./actions");
    const { readAssetsD1 } = await import("./assets-d1");
    const db = getDb(); db.pragma("journal_mode = DELETE");
    const cloud = new Database(db.serialize()); cloudBinding = binding(cloud);
    const both = async (local: () => Promise<unknown>, remote: () => Promise<unknown>) => {
      vi.stubEnv("CLOUDFLARE_RUNTIME", "0"); const expected = await local();
      vi.stubEnv("CLOUDFLARE_RUNTIME", "1"); expect(await remote()).toEqual(expected);
    };
    await both(() => actions.saveDeposit({ bank: "测试银行", principal: 100, rate: 2, canPrepay: true }), () => actions.saveDeposit({ bank: "测试银行", principal: 100, rate: 2, canPrepay: true }));
    await both(() => actions.saveDeposit({ id: 1, bank: "新银行", principal: 120 }), () => actions.saveDeposit({ id: 1, bank: "新银行", principal: 120 }));
    await both(() => actions.saveMortgage({ remainingPrincipal: 300, monthlyPayment: 10, remainingTerms: 24, rateType: "fixed", paymentDay: 10 }), () => actions.saveMortgage({ remainingPrincipal: 300, monthlyPayment: 10, remainingTerms: 24, rateType: "fixed", paymentDay: 10 }));
    await both(() => actions.saveCash(55), () => actions.saveCash(55));
    const result = await readAssetsD1(cloudBinding);
    expect(result).toEqual({ deposits: ledger.listDeposits(), mortgage: ledger.getMortgage(), cash: ledger.getCash() });
    await both(() => actions.deleteDeposit(1), () => actions.deleteDeposit(1));
    expect((await readAssetsD1(cloudBinding)).deposits).toEqual([]);
    cloud.close();
    vi.stubEnv("CLOUDFLARE_RUNTIME", "0");
  });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
