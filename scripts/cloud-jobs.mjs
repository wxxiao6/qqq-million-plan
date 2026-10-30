/** Invoked periodically by the local scheduler; credentials are supplied via environment. */
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const url = process.env.CLOUD_SITE_URL;
const token = process.env.CLOUD_JOB_TOKEN;
if (!url || !token || !/^[A-Za-z0-9_-]{43,}$/.test(token)) throw new Error("CLOUD_SITE_URL and a strong CLOUD_JOB_TOKEN are required");
const origin = new URL(url);
if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("CLOUD_SITE_URL must be an HTTPS origin");
const directory = path.resolve(process.env.CLOUD_JOB_STATE_DIR || "data/cloud-jobs");
await mkdir(directory, { recursive: true, mode: 0o700 });
const lockPath = path.join(directory, "running.lock");
let lock;
try { lock = await open(lockPath, "wx", 0o600); }
catch (error) {
  if (error.code !== "EEXIST") throw error;
  const owner = Number((await readFile(lockPath, "utf8")).trim());
  if (!Number.isInteger(owner) || owner <= 0) throw new Error("Cloud job lock has no valid owner");
  try { process.kill(owner, 0); throw new Error("A cloud job is already running"); }
  catch (probe) { if (probe.code !== "ESRCH") throw probe; }
  await unlink(lockPath);
  lock = await open(lockPath, "wx", 0o600);
}
await lock.writeFile(String(process.pid));
const statePath = path.join(directory, "state.json");
try {
  let state = {};
  try { state = JSON.parse(await readFile(statePath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  // Node 22 does not automatically honour macOS system proxy settings.
  const systemProxy = (() => {
    if (process.platform !== "darwin" || process.env.HTTPS_PROXY || process.env.https_proxy) return null;
    const output = spawnSync("/usr/sbin/scutil", ["--proxy"], { encoding: "utf8" });
    const settings = Object.fromEntries([...output.stdout.matchAll(/^\s*(HTTPSEnable|HTTPSProxy|HTTPSPort)\s*:\s*(\S+)/gm)].map((match) => [match[1], match[2]]));
    if (settings.HTTPSEnable !== "1" || !/^[\w.:-]+$/.test(settings.HTTPSProxy ?? "") || !/^\d{1,5}$/.test(settings.HTTPSPort ?? "")) return null;
    return `http://${settings.HTTPSProxy}:${settings.HTTPSPort}`;
  })();
  // curl can use either the shell proxy variables or the detected system proxy.
  // Pass the bearer token through stdin rather than process arguments.
  const call = async (endpoint, body) => {
    const args = ["--silent", "--show-error", "--max-time", "120", "--config", "-", "--header", "Content-Type: application/json", "--data", JSON.stringify(body ?? {}), "--write-out", "\n%{http_code}", ...(systemProxy ? ["--proxy", systemProxy] : []), new URL(endpoint, origin).href];
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.env.CLOUD_JOB_CURL || "/usr/bin/curl", args, { stdio: ["pipe", "pipe", "pipe"] });
      let output = "", error = "";
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { output += chunk; if (output.length > 2_000_000) child.kill(); });
      child.stderr.on("data", (chunk) => { error += chunk; });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`Request to ${endpoint} failed: ${error.slice(0, 200)}`)));
      child.stdin.end(`header = "Authorization: Bearer ${token}"\n`);
    });
    const split = result.lastIndexOf("\n"), status = Number(result.slice(split + 1));
    if (split < 0 || status < 200 || status >= 300) throw new Error(`${endpoint} returned ${status || "invalid response"}`);
    return JSON.parse(result.slice(0, split));
  };
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", hour12: false }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" }).format(now);
  let infoError;
  try {
  if (weekday === "Mon" && hour >= "01" && state.lastSuccessfulInfo !== date) {
    const run = await call("/api/jobs/info", { phase: "init" });
    let after = "", requested = 0, success = 0, failure = 0;
    do {
      const result = await call("/api/jobs/info", { runId: run.runId, bizDate: run.bizDate, observedAt: run.observedAt, phase: "chunk", after });
      if (!Number.isInteger(result.requested) || !Number.isInteger(result.success) || !Array.isArray(result.failed)) throw new Error("Invalid info response");
      requested += result.requested; success += result.success; failure += result.failed.length;
      if (result.next != null && (typeof result.next !== "string" || result.next <= after)) throw new Error("Invalid info cursor");
      after = result.next ?? "";
    } while (after);
    await call("/api/jobs/info", { runId: run.runId, bizDate: run.bizDate, observedAt: run.observedAt, phase: "finish", requested, success, failure });
    if (failure) throw new Error("Cloud info update was incomplete; it will be retried");
    state.lastSuccessfulInfo = date;
    const temporary = `${statePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, statePath);
  }
  } catch (error) { infoError = error; }
  if (hour >= "22" && state.lastSuccessfulRefresh !== date) {
    const run = await call("/api/jobs/refresh");
    if (!run.chunked) throw new Error("Cloud refresh did not provide a chunked run");
    const totals = { nav: { requested: 0, success: 0, failed: [] }, quota: { requested: 0, success: 0, failed: [] } };
    for (const phase of ["nav", "quota"]) {
      let after = "";
      do {
        const result = await call("/api/jobs/refresh", { runId: run.runId, bizDate: run.bizDate, observedAt: run.observedAt, phase, after });
        if (!Number.isInteger(result.requested) || !Number.isInteger(result.success) || !Array.isArray(result.failed)) throw new Error("Invalid refresh response");
        totals[phase].requested += result.requested; totals[phase].success += result.success; totals[phase].failed.push(...result.failed);
        if (result.next != null && (typeof result.next !== "string" || result.next <= after)) throw new Error("Invalid refresh cursor");
        after = result.next ?? "";
      } while (after);
    }
    await call("/api/jobs/refresh", { runId: run.runId, bizDate: run.bizDate, observedAt: run.observedAt, phase: "finish", ...totals });
    if (totals.nav.failed.length || totals.quota.failed.length) throw new Error("Cloud refresh was incomplete; it will be retried");
    state.lastSuccessfulRefresh = date;
    const temporary = `${statePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, statePath);
  }
  if (infoError) throw infoError;
} finally { await lock.close(); await unlink(lockPath); }
