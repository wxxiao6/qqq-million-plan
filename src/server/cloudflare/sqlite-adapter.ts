/** Synchronous SQLite adapter for a SQLite-backed Durable Object.
 * This adapter is not yet wired into the application runtime.
 */
export interface DurableSqlStorage {
  sql: { exec(query: string, ...bindings: (string | number | null | ArrayBuffer)[]): { toArray(): Record<string, unknown>[] } };
  transactionSync<T>(callback: () => T): T;
}

type SqlValue = string | number | null | ArrayBuffer;
type NamedBindings = Record<string, SqlValue>;
type Transaction<T extends unknown[], R> = ((...args: T) => R) & { immediate: (...args: T) => R };

// Collect SQLite's named parameters in index order. Repeated names use one index.
// Quoted text, identifiers and SQL comments are skipped.
function parameterNames(sql: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1];
    if (c === "-" && next === "-") { i = sql.indexOf("\n", i + 2); if (i < 0) break; continue; }
    if (c === "/" && next === "*") { i = sql.indexOf("*/", i + 2); if (i < 0) break; i++; continue; }
    if (c === "'" || c === '"' || c === "`" || c === "[") {
      const end = c === "[" ? "]" : c;
      for (i++; i < sql.length; i++) {
        if (sql[i] !== end) continue;
        if (c !== "[" && sql[i + 1] === end) { i++; continue; }
        break;
      }
      continue;
    }
    if ((c === "@" || c === ":" || c === "$") && /[A-Za-z_]/.test(next ?? "")) {
      let j = i + 2;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
      const name = sql.slice(i + 1, j);
      const token = c + name;
      if (!seen.has(token)) { seen.add(token); names.push(name); }
      i = j - 1;
    }
  }
  return names;
}

function bindingsFor(sql: string, args: unknown[]): SqlValue[] {
  if (args.length !== 1 || args[0] === null || typeof args[0] !== "object" || args[0] instanceof ArrayBuffer || ArrayBuffer.isView(args[0])) {
    return args as SqlValue[];
  }
  const values = args[0] as NamedBindings;
  const names = parameterNames(sql);
  return names.map((name) => {
    if (!Object.hasOwn(values, name)) throw new Error(`Missing SQL parameter: ${name}`);
    return values[name];
  });
}

export class DurableSqliteAdapter {
  constructor(private readonly storage: DurableSqlStorage) {}

  prepare(sql: string) {
    const execute = (...args: unknown[]) => this.storage.sql.exec(sql, ...bindingsFor(sql, args));
    return {
      all: (...args: unknown[]) => execute(...args).toArray(),
      get: (...args: unknown[]) => execute(...args).toArray()[0],
      run: (...args: unknown[]) => {
        execute(...args).toArray();
        const result = this.storage.sql.exec("SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid").toArray()[0];
        return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
      },
    };
  }

  exec(sql: string) { this.storage.sql.exec(sql).toArray(); return this; }

  transaction<T extends unknown[], R>(callback: (...args: T) => R): Transaction<T, R> {
    const run = (...args: T) => this.storage.transactionSync(() => callback(...args));
    return Object.assign(run, { immediate: run });
  }
}
