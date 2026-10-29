#!/usr/bin/env node
// Apply the checked-in schema to an isolated local D1 database, without user data.
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const temp = await mkdtemp(path.join(tmpdir(), 'finance-d1-probe-'));
try {
  const files = (await readdir(path.join(root, 'db/migrations'))).filter((f) => f.endsWith('.sql')).sort();
  const migrations = await Promise.all(files.map(async (file) => `\n-- ${file}\n${await readFile(path.join(root, 'db/migrations', file), 'utf8')}\n`));
  await writeFile(path.join(temp, 'migrations.sql'), migrations.join('\n'));
  await writeFile(path.join(temp, 'wrangler.json'), JSON.stringify({ name: 'finance-d1-probe', compatibility_date: '2026-10-29', d1_databases: [{ binding: 'DB', database_name: 'finance-probe', database_id: '00000000-0000-0000-0000-000000000001' }] }));
  const child = spawn('npx', ['--yes', 'wrangler', 'd1', 'execute', 'finance-probe', '--local', '--persist-to', path.join(temp, 'state'), '--file', path.join(temp, 'migrations.sql'), '--json'], { cwd: temp, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { errors += chunk; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  if (code !== 0) throw new Error(`Local D1 migration failed (exit ${code}): ${errors || output}`);
  const results = JSON.parse(output);
  if (!Array.isArray(results) || results.some((result) => !result.success)) throw new Error('Local D1 returned an unsuccessful migration statement');
  console.log(`Local D1 schema probe passed: ${files.length} migrations, ${results.length} SQL statements. No user data was read or uploaded.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
