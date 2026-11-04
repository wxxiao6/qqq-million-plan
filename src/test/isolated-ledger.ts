import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

/** Keep migrated seed data, but roll back every test's writes, including on failure. */
export function isolatedLedger() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "isolated-ledger-"));
  vi.stubEnv("P0_TEST_DB", path.join(directory, "ledger.sqlite"));
  let db: Database.Database;
  beforeAll(async () => {
    db = (await import("@/server/db")).getDb();
    // Serialized in-memory copies cannot open the source database's WAL files.
    db.pragma("journal_mode = DELETE");
  });
  beforeEach(() => { db.exec("SAVEPOINT test_fixture"); });
  afterEach(() => { db.exec("ROLLBACK TO test_fixture; RELEASE test_fixture"); });
  afterAll(() => {
    db?.close();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });
  return { get db() { return db; } };
}
