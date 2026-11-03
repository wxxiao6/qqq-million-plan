import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const defaults = JSON.parse(await readFile(new URL("../config/quota-ingestion.json", import.meta.url), "utf8"));
export const optionalRead = async (filename) => {
  try { return await readFile(filename, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; return null; }
};

export function uploadPlan(body, previous, env = process.env) {
  const payload = JSON.parse(body);
  if (payload.schemaVersion !== 1 || !Array.isArray(payload.items) || !payload.items.length || payload.items.length > 1000 || !Number.isFinite(Date.parse(payload.observedAt))) {
    throw new Error("Invalid quota payload; expected schemaVersion, observedAt and 1–1000 items");
  }
  const endpoint = new URL(env.QUOTA_INGEST_URL || defaults.endpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.pathname !== "/api/ingestion/quota" || endpoint.search || endpoint.hash) {
    throw new Error("QUOTA_INGEST_URL must be an HTTPS /api/ingestion/quota endpoint");
  }
  const hosts = (env.QUOTA_SOURCE_HOSTS ?? defaults.sourceHosts.join(",")).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const item of payload.items) {
    const source = new URL(item.sourceUrl);
    if (source.protocol !== "https:" || source.username || source.password || !hosts.includes(source.hostname)) throw new Error(`Source outside HTTPS allowlist: ${item.sourceUrl}`);
  }
  const payloadSha256 = createHash("sha256").update(body).digest("hex");
  // An existing frozen receipt owns its key. Never silently change the body on retry.
  if (previous?.payloadSha256 && previous.payloadSha256 !== payloadSha256) throw new Error("Frozen payload hash changed; use a new run directory");
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(payload.observedAt));
  const idempotencyKey = previous?.idempotencyKey || `nasdaq-quota-ai:${date}:${payloadSha256.slice(0, 32)}`;
  if (!/^[\x21-\x7e]{1,200}$/.test(idempotencyKey)) throw new Error("Invalid Idempotency-Key");
  return { endpoint: endpoint.href, idempotencyKey, payloadSha256, itemCount: payload.items.length };
}

// Match the existing cloud-job transport: honour macOS's system proxy, and keep
// the bearer credential on stdin rather than exposing it in process arguments.
export async function postQuota(plan, filename, token) {
  let proxy;
  if (process.platform === "darwin" && !process.env.HTTPS_PROXY && !process.env.https_proxy) {
    const { stdout = "" } = spawnSync("/usr/sbin/scutil", ["--proxy"], { encoding: "utf8" });
    const settings = Object.fromEntries([...stdout.matchAll(/^\s*(HTTPSEnable|HTTPSProxy|HTTPSPort)\s*:\s*(\S+)/gm)].map((m) => [m[1], m[2]]));
    if (settings.HTTPSEnable === "1" && /^[\w.:-]+$/.test(settings.HTTPSProxy ?? "") && /^\d{1,5}$/.test(settings.HTTPSPort ?? "")) proxy = `http://${settings.HTTPSProxy}:${settings.HTTPSPort}`;
  }
  const args = ["--silent", "--show-error", "--max-time", "120", "--config", "-", "--header", "Content-Type: application/json", "--header", `Idempotency-Key: ${plan.idempotencyKey}`, "--data-binary", `@${filename}`, "--write-out", "\n%{http_code}", ...(proxy ? ["--proxy", proxy] : []), plan.endpoint];
  const output = await new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/curl", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; if (stdout.length > 2_000_000) child.kill(); });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`Quota request failed: ${stderr.slice(0, 500)}`)));
    child.stdin.end(`header = "Authorization: Bearer ${token}"\n`);
  });
  const split = output.lastIndexOf("\n");
  const httpStatus = Number(output.slice(split + 1));
  let response;
  try { response = JSON.parse(output.slice(0, split)); }
  catch { response = output.slice(0, split); }
  return { httpStatus, response };
}

export async function quotaToken(env = process.env) {
  const token = (env.QUOTA_INGEST_TOKEN || await optionalRead(env.QUOTA_INGEST_TOKEN_FILE || path.join(root, "data/quota-ingestion/token")) || "").trim();
  if (!/^[A-Za-z0-9_-]{43,}$/.test(token)) throw new Error("Missing or invalid QUOTA_INGEST_TOKEN; configure env or data/quota-ingestion/token");
  return token;
}

// Register the saved collection attempt before sending its immutable payload.
export async function syncCollectionState(dir, { env = process.env, transport = postQuota } = {}) {
  const saved = await optionalRead(path.join(dir, "collection-run.json"));
  if (!saved) return null;
  const state = JSON.parse(saved);
  const endpoint = new URL(env.QUOTA_INGEST_URL || defaults.endpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.pathname !== "/api/ingestion/quota" || endpoint.search || endpoint.hash) throw new Error("Invalid quota endpoint");
  endpoint.pathname += "/status";
  const token = await quotaToken(env);
  for (const action of state.status === "collecting" ? ["start"] : ["start", "finish"]) {
    const filename = path.join(dir, `.collection-${action}.json`);
    await writeFile(filename, JSON.stringify({ action, runId: state.runId, startedAt: state.startedAt, status: state.status, collectedCount: state.collectedCount }), { mode: 0o600 });
    const receipt = await transport({ endpoint: endpoint.href, idempotencyKey: `${state.runId}:${action}` }, filename, token);
    if (receipt.httpStatus < 200 || receipt.httpStatus >= 300 || receipt.response?.ok !== true) throw new Error(`Collection status not accepted: HTTP ${receipt.httpStatus}`);
  }
  return state;
}

export async function uploadQuota(filename, { env = process.env, dryRun = false, transport = postQuota } = {}) {
  filename = path.resolve(filename);
  const receiptPath = path.join(path.dirname(filename), "upload.json");
  let body = await readFile(filename, "utf8");
  const oldText = await optionalRead(receiptPath);
  const previous = oldText ? JSON.parse(oldText) : null;
  const collectionText = await optionalRead(path.join(path.dirname(filename), "collection-run.json"));
  if (collectionText) {
    const state = JSON.parse(collectionText), payload = JSON.parse(body);
    if (payload.collectionRunId && payload.collectionRunId !== state.runId) throw new Error("Payload belongs to another collection run");
    if (!payload.collectionRunId) {
      if (previous?.payloadSha256) throw new Error("Cannot attach collection ID to a frozen upload");
      body = JSON.stringify({ ...payload, collectionRunId: state.runId }, null, 2) + "\n";
      if (!dryRun) await writeFile(filename, body, { mode: 0o600 });
    }
  }
  const plan = uploadPlan(body, previous, env);
  if (dryRun) return { ...plan, status: "dry_run", attempted: false };
  const receipt = { ...plan, status: "pending_upload", attempted: false, accepted: 0, httpStatus: null, response: null, errors: [], attemptedAt: new Date().toISOString() };
  try {
    const token = await quotaToken(env);
    await syncCollectionState(path.dirname(filename), { env, transport });
    receipt.attempted = true;
    Object.assign(receipt, await transport(plan, filename, token));
    const r = receipt.response;
    if (receipt.httpStatus < 200 || receipt.httpStatus >= 300 || !r || r.ok !== true || r.accepted !== plan.itemCount || r.rejected > 0) {
      throw new Error(`Quota upload not accepted: HTTP ${receipt.httpStatus}; ${JSON.stringify(r)}`);
    }
    receipt.status = "uploaded";
    receipt.accepted = r.accepted;
  } catch (error) { receipt.errors.push(error.message); }
  // Keep each attempt, while upload.json always describes the latest outcome.
  const historyPath = path.join(path.dirname(filename), `upload-attempt-${Date.now()}-${randomUUID()}.json`);
  const text = JSON.stringify(receipt, null, 2) + "\n";
  await writeFile(historyPath, text, { mode: 0o600, flag: "wx" });
  await writeFile(receiptPath, text, { mode: 0o600 });
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    // Existing shell variables take precedence; .env.local precedes .env.
    for (const name of [".env.local", ".env"]) {
      try { loadEnvFile(path.join(root, name)); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const args = process.argv.slice(2);
    const filename = args.find((arg) => arg !== "--dry-run");
    if (!filename) throw new Error("Usage: pnpm quota:upload /absolute/path/payload.json [--dry-run]");
    const result = await uploadQuota(filename, { dryRun: args.includes("--dry-run") });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "pending_upload") process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
