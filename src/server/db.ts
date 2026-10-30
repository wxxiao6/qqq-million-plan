import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { seedNasdaqFundCatalog } from "./funds/catalog";
import { beijingTodayISO } from "@/lib/format";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH =
  process.env.P0_TEST_DB ?? path.join(DATA_DIR, "ledger.sqlite");
const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");
const SNAPSHOT_PATH = path.join(process.cwd(), "config", "quota-snapshots.json");
const NASDAQ_CATALOG_PATH = path.join(process.cwd(), "config", "nasdaq-funds.json");

let db: Database.Database | null = null;
let seededCatalogMtime = 0;

export function getDbPath() {
  return DB_PATH;
}

export function getDb(): Database.Database {
  // 开发环境的热更新会保留模块级连接；新迁移加入后仍需在同一连接上补跑。
  if (db) {
    migrate(db);
    const catalogMtime = fs.statSync(NASDAQ_CATALOG_PATH).mtimeMs;
    if (catalogMtime !== seededCatalogMtime) {
      seedNasdaqFundCatalog(db);
      seededCatalogMtime = catalogMtime;
    }
    return db;
  }

  const dir = path.dirname(DB_PATH);
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seed(db);
  seededCatalogMtime = fs.statSync(NASDAQ_CATALOG_PATH).mtimeMs;
  return db;
}

function migrate(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const applied = database.prepare(
    "SELECT 1 AS ok FROM schema_migrations WHERE id = ?",
  );

  for (const file of files) {
    if (applied.get(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const run = database.transaction(() => {
      database.exec(sql);
      database
        .prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
        .run(file, new Date().toISOString());
    });
    run();
  }
}

function seed(database: Database.Database) {
  seedNasdaqFundCatalog(database);
  if (process.env.P0_TEST_DB) seedQuotaSnapshots(database);
}

type SnapshotFile = {
  source?: string;
  cells: Array<{
    symbol: string;
    shareClass: "A" | "C" | "I" | "F";
    channelKind: "direct" | "agency";
    status: "open" | "limited" | "paused";
    dailyLimit?: number | null;
    quotaScope?: string;
    source?: string;
  }>;
};

function seedQuotaSnapshots(database: Database.Database) {
  if (!fs.existsSync(SNAPSHOT_PATH)) return;
  const raw = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as SnapshotFile;
  const insert = database.prepare(`
    INSERT OR IGNORE INTO quota_current
      (code, share_class, channel_kind, status, daily_limit, currency, quota_scope, effective_on, observed_at, source_url, source_provider, updated_at)
    SELECT @symbol, f.share_class, @channelKind, @status, @dailyLimit, f.currency, @quotaScope, @bizDate, @updatedAt, @source, 'seed', @updatedAt
    FROM nasdaq_funds f WHERE f.code=@symbol
  `);
  const now = new Date();
  const updatedAt = now.toISOString();
  const source = raw.source ?? "seed";
  const run = database.transaction(() => {
    for (const cell of raw.cells) {
      insert.run({
        symbol: cell.symbol,
        channelKind: cell.channelKind,
        status: cell.status,
        dailyLimit: cell.dailyLimit ?? null,
        quotaScope:
          cell.quotaScope ?? `${cell.symbol}:${cell.shareClass}:${cell.channelKind}`,
        bizDate: beijingTodayISO(now),
        source: `https://example.com/seed/${cell.source ?? source}`,
        updatedAt,
      });
    }
  });
  run();
}

export function kvGet(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM app_kv WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function kvSet(key: string, value: string) {
  getDb()
    .prepare(
      `INSERT INTO app_kv (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}
