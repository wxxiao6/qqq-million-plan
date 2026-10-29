#!/usr/bin/env node
// Read-only compatibility audit. Use a SQLite online backup, never a live database copy.
// Does not print or transmit account records.
import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const backup = process.argv[2];
if (!backup) {
  console.error('Usage: node scripts/audit-cloud-migration.mjs /absolute/path/to/online-backup.sqlite');
  process.exit(2);
}
const source = new Database(backup, { readonly: true, fileMustExist: true });
const reference = new Database(':memory:');
try {
  const files = readdirSync(path.join(process.cwd(), 'db/migrations')).filter((file) => file.endsWith('.sql')).sort();
  reference.exec('CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const file of files) {
    reference.transaction(() => {
      reference.exec(readFileSync(path.join(process.cwd(), 'db/migrations', file), 'utf8'));
      reference.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(file, 'audit');
    })();
  }
  const tableNames = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
  const sourceTables = tableNames(source);
  const expectedTables = tableNames(reference);
  const sourceSet = new Set(sourceTables), expectedSet = new Set(expectedTables);
  const differences = [];
  for (const name of expectedTables) if (!sourceSet.has(name)) differences.push(`missing table: ${name}`);
  for (const name of sourceTables) if (!expectedSet.has(name)) differences.push(`extra table: ${name}`);
  for (const name of expectedTables.filter((table) => sourceSet.has(table))) {
    // Parameterized table-valued pragma avoids interpolating identifiers from the database.
    const columns = (db) => db.prepare('SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?) ORDER BY cid').all(name);
    if (JSON.stringify(columns(source)) !== JSON.stringify(columns(reference))) differences.push(`different columns: ${name}`);
  }
  const applied = new Set(source.prepare('SELECT id FROM schema_migrations').all().map((row) => row.id));
  const missingMigrations = files.filter((file) => !applied.has(file));
  const unknownMigrations = [...applied].filter((file) => !files.includes(file));
  const integrity = source.pragma('quick_check', { simple: true });
  const foreignKeyViolations = source.pragma('foreign_key_check').length;
  console.log(JSON.stringify({ integrity, foreignKeyViolations, sourceTableCount: sourceTables.length, expectedTableCount: expectedTables.length, migrationCount: files.length, missingMigrations, unknownMigrations, differences }, null, 2));
  if (integrity !== 'ok' || foreignKeyViolations || missingMigrations.length || unknownMigrations.length || differences.length) process.exitCode = 1;
} finally {
  source.close();
  reference.close();
}
