import { getDb } from "../db";
import type { ReconcileD1 } from "../ledger/reconcile-d1";

/** Use the same SQL batches for local SQLite and the deployed D1 runtime. */
export function localFundDatabase(sqlite = getDb()): ReconcileD1 {
  return {
    prepare(sql: string) {
      return { bind(...values: (string | number | null)[]) { return { sql, values } as unknown as ReturnType<ReconcileD1["prepare"]>; } };
    },
    async batch(statements) {
      return sqlite.transaction(() => statements.map((statement) => {
        const { sql, values } = statement as unknown as { sql: string; values: (string | number | null)[] };
        const query = sqlite.prepare(sql);
        return { results: query.reader ? query.all(...values) : (query.run(...values), []) };
      })).immediate();
    },
  };
}

export async function fundDatabase(): Promise<ReconcileD1> {
  if (process.env.CLOUDFLARE_RUNTIME !== "1") return localFundDatabase();
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  return (getCloudflareContext().env as unknown as { DB: ReconcileD1 }).DB;
}
