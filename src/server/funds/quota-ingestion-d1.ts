import type Database from "better-sqlite3";
import { ingestQuotaPayload, QuotaIngestionError } from "./quota-ingestion";

// Only the small part of the D1 API needed here; this also keeps the ingestion
// code independent of a specific version of Cloudflare's generated types.
export interface QuotaD1 {
  prepare(sql: string): {
    bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null> };
  };
  batch(statements: ReturnType<ReturnType<QuotaD1["prepare"]>["bind"]>[]): Promise<unknown>;
}

type Fund = { code: string; shareClass: string; currency: "CNY" | "USD" };
type Existing = { payloadHash: string; acceptedCount: number; status: string };
type Write = { sql: string; args: unknown[] };

const FUND_SQL = "SELECT code, share_class AS shareClass, currency FROM nasdaq_funds";
const RUN_SQL = "SELECT payload_hash AS payloadHash, accepted_count AS acceptedCount, status FROM quota_ingestion_runs WHERE idempotency_key=?";

// The SQL recorded below is owned by quota-ingestion.ts. Its named parameters
// are identifiers outside of string literals, and D1 binds positional values.
function bindWrite(db: QuotaD1, write: Write) {
  if (write.args.length === 1 && write.args[0] !== null && typeof write.args[0] === "object") {
    const object = write.args[0] as Record<string, unknown>;
    const values: unknown[] = [];
    const sql = write.sql.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => {
      if (!Object.hasOwn(object, name)) throw new Error(`Missing SQL parameter: ${name}`);
      values.push(object[name]);
      return "?";
    });
    return db.prepare(sql).bind(...values);
  }
  return db.prepare(write.sql).bind(...write.args);
}

/** Execute the existing validation and write logic against D1 atomically.
 * The synchronous SQLite implementation records its writes; D1 executes them
 * in a single batch, including the unique idempotency-key insertion. */
export async function ingestQuotaPayloadD1(db: QuotaD1, raw: unknown, key: string, now = new Date()) {
  const funds = (await db.prepare(FUND_SQL).bind().all<Fund>()).results;
  const readExisting = () => db.prepare(RUN_SQL).bind(key).first<Existing>();
  const execute = (existing: Existing | null) => {
    const writes: Write[] = [];
    const recorder = {
      prepare(sql: string) {
        return {
          all: () => {
            if (sql !== FUND_SQL) throw new Error("Unexpected ingestion query");
            return funds;
          },
          get: () => {
            if (sql !== RUN_SQL) throw new Error("Unexpected ingestion query");
            return existing ?? undefined;
          },
          run: (...args: unknown[]) => { writes.push({ sql, args }); },
        };
      },
      transaction<T>(callback: () => T) { return callback; },
    };
    let result: ReturnType<typeof ingestQuotaPayload> | undefined;
    let error: unknown;
    try { result = ingestQuotaPayload(recorder as unknown as Database.Database, raw, key, now); }
    catch (caught) { error = caught; }
    return { writes, result, error };
  };

  const attempt = execute(await readExisting());
  if (attempt.writes.length) {
    try {
      await db.batch(attempt.writes.map((write) => bindWrite(db, write)));
    } catch (error) {
      // A concurrent request may have committed the same key after our read.
      // Re-evaluate its payload hash; never mask unrelated database failures.
      const winner = await readExisting();
      if (!winner) throw error;
      const retry = execute(winner);
      if (retry.error) throw retry.error;
      if (retry.result?.reused) return retry.result;
      throw error;
    }
  }
  if (attempt.error) throw attempt.error;
  if (!attempt.result) throw new QuotaIngestionError("ingestion_failed", "额度数据写入失败");
  return attempt.result;
}
