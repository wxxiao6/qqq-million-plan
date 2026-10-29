#!/usr/bin/env node
// Run migrations and transaction checks against an isolated local Workers Durable Object.
// This probe never opens or uploads the user's database.
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const root = process.cwd();
const temp = await mkdtemp(path.join(tmpdir(), 'finance-workers-probe-'));
const server = createServer();
await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const migrations = await Promise.all((await readdir(path.join(root, 'db/migrations')))
  .filter((file) => file.endsWith('.sql')).sort().map(async (file) =>
    [file, await readFile(path.join(root, 'db/migrations', file), 'utf8')]));
const worker = `import { DurableObject } from 'cloudflare:workers';
import { DurableSqliteAdapter } from './sqlite-adapter.ts';
const migrations = ${JSON.stringify(migrations)};
export class Probe extends DurableObject {
  async fetch() {
    const sql = this.ctx.storage.sql;
    const applied = [];
    try {
      for (const [file, text] of migrations) {
        this.ctx.storage.transactionSync(() => sql.exec(text).toArray());
        applied.push(file);
      }
      sql.exec('CREATE TABLE probe_transaction (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)');
      try { this.ctx.storage.transactionSync(() => { sql.exec('INSERT INTO probe_transaction (value) VALUES (?)', 'test'); throw new Error('rollback'); }); } catch {}
      const rolledBack = sql.exec('SELECT COUNT(*) AS n FROM probe_transaction').one().n === 0;
      sql.exec('INSERT INTO probe_transaction (value) VALUES (?)', 'test');
      const insertedId = sql.exec('SELECT last_insert_rowid() AS id').one().id;
      const named = sql.exec('SELECT @value AS value', 123).one().value;
      const db = new DurableSqliteAdapter(this.ctx.storage);
      const inserted = db.prepare('INSERT INTO probe_transaction (value) VALUES (@value)').run({value:'adapter'});
      const read = db.prepare("SELECT @value AS a, @value AS b, ':ignored' AS literal /* @ignored */").get({value:'ok'});
      let adapterRollback = false;
      try { db.transaction(() => { db.prepare('INSERT INTO probe_transaction (value) VALUES (?)').run('rollback'); throw new Error('rollback'); }).immediate(); } catch {}
      adapterRollback = db.prepare('SELECT COUNT(*) AS n FROM probe_transaction WHERE value = ?').get('rollback').n === 0;
      const adapter = inserted.changes === 1 && inserted.lastInsertRowid === 2 && read.a === 'ok' && read.b === 'ok' && adapterRollback;
      let nested = false;
      try { this.ctx.storage.transactionSync(() => this.ctx.storage.transactionSync(() => sql.exec('SELECT 1').toArray())); nested = true; } catch {}
      return Response.json({applied, rolledBack, insertedId, named, nested, adapter});
    } catch (e) { return Response.json({applied, error: String(e)}, {status: 500}); }
  }
}
export default { fetch(request, env) { return env.PROBE.get(env.PROBE.idFromName('test')).fetch(request); } };`;
await writeFile(path.join(temp, 'index.js'), worker);
await writeFile(path.join(temp, 'sqlite-adapter.ts'), await readFile(path.join(root, 'src/server/cloudflare/sqlite-adapter.ts')));
await writeFile(path.join(temp, 'wrangler.json'), JSON.stringify({
  name: 'finance-sql-probe', main: 'index.js', compatibility_date: '2026-10-29',
  durable_objects: { bindings: [{ name: 'PROBE', class_name: 'Probe' }] },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['Probe'] }],
}));
let log = '';
const child = spawn('npx', ['--yes', 'wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', path.join(temp, 'state')], {
  cwd: temp, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => { log += chunk; });
child.stderr.on('data', (chunk) => { log += chunk; });
try {
  const deadline = Date.now() + 45_000;
  let response;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`wrangler exited ${child.exitCode}: ${log}`);
    try { response = await fetch(`http://127.0.0.1:${port}/`); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  if (!response) throw new Error(`wrangler did not start: ${log}`);
  const result = await response.json();
  if (!response.ok || result.applied.length !== migrations.length || !result.rolledBack || result.insertedId !== 1 || result.named !== 123 || !result.nested || !result.adapter) {
    throw new Error(`probe failed: ${JSON.stringify(result)}`);
  }
  console.log(`SQLite Durable Object probe passed: ${result.applied.length} migrations, rollback, nested transactions, insert id, named parameters and adapter behavior.`);
} finally {
  child.kill('SIGINT');
  await new Promise((resolve) => { if (child.exitCode != null) resolve(); else { child.once('exit', resolve); setTimeout(resolve, 2000).unref(); } });
  await rm(temp, { recursive: true, force: true });
}
