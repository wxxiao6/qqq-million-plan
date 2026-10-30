import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("runs Monday jobs once after success and retries partial work independently", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cloud-script-"));
  try {
    const preload = path.join(dir, "preload.mjs"), log = path.join(dir, "calls.log");
    writeFileSync(preload, `
      const RealDate = Date;
      globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-10-26T14:00:00Z'])); } static now() { return new RealDate('2026-10-26T14:00:00Z').getTime(); } };`);
    const curl = path.join(dir, "curl.mjs");
    writeFileSync(curl, `#!/usr/bin/env node
      import { appendFileSync } from 'node:fs';
      const args = process.argv.slice(2), endpoint = new URL(args.at(-1)).pathname, body = JSON.parse(args[args.indexOf('--data') + 1]);
      appendFileSync(process.env.TEST_CALL_LOG, endpoint + ':' + (body.phase || 'run') + '\\n');
      let result;
      if (endpoint.endsWith('/reconcile')) result = {ok:true};
      else if (body.phase === 'init' || !body.phase) result = {chunked:true,runId:'run',bizDate:'2026-10-26',observedAt:'2026-10-26T14:00:00Z'};
      else if (body.phase === 'finish') result = {ok:true};
      else result = {requested:1,success:process.env.TEST_INFO_FAILURE && endpoint.endsWith('/info') ? 0 : 1,failed:process.env.TEST_INFO_FAILURE && endpoint.endsWith('/info') ? [{code:'000001',error:'offline'}] : [],next:null};
      process.stdout.write(JSON.stringify(result) + '\\n200');`);
    chmodSync(curl, 0o700);
    const run = (failure: boolean) => spawnSync(process.execPath, ["--import", preload, "scripts/cloud-jobs.mjs"], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, CLOUD_SITE_URL: "https://finance.example", CLOUD_JOB_TOKEN: "a".repeat(43), CLOUD_JOB_STATE_DIR: dir, TEST_CALL_LOG: log, CLOUD_JOB_CURL: curl, TEST_INFO_FAILURE: failure ? "1" : "" } });
    expect(run(true).status).toBe(1);
    expect(JSON.parse(readFileSync(path.join(dir, "state.json"), "utf8"))).toEqual({ lastSuccessfulRefresh: "2026-10-26" });
    expect(run(false).status).toBe(0);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls.filter((line) => line === "/api/jobs/refresh:finish")).toHaveLength(1);
    expect(calls.filter((line) => line === "/api/jobs/info:finish")).toHaveLength(2);
    expect(JSON.parse(readFileSync(path.join(dir, "state.json"), "utf8"))).toEqual({ lastSuccessfulRefresh: "2026-10-26", lastSuccessfulInfo: "2026-10-26" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
