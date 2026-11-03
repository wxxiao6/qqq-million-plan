import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { uploadPlan, uploadQuota } from "./upload-quota.mjs";

const payload = {
  schemaVersion: 1, observedAt: "2026-11-01T20:00:00Z", sourceProvider: "ai-test",
  items: [{ fundCode: "016452", shareClass: "A", channel: "direct", status: "limited", dailyLimit: 10, currency: "CNY", effectiveOn: "2026-11-01", sourceUrl: "https://pdf.dfcfw.com/evidence.pdf" }],
};
const body = JSON.stringify(payload, null, 2) + "\n";
const directories = [];
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quota-upload-"));
  directories.push(dir);
  const file = path.join(dir, "payload.json");
  await writeFile(file, body);
  return { dir, file };
}
afterEach(async () => { await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

it("resolves the configured production endpoint and Beijing date without shell config", async () => {
  const plan = uploadPlan(body, null, {});
  expect(plan.endpoint).toBe("https://qqq-million-plan.cc.cd/api/ingestion/quota");
  expect(plan.idempotencyKey).toMatch(/^nasdaq-quota-ai:2026-11-02:/);
  const config = JSON.parse(await readFile(new URL("../config/quota-ingestion.json", import.meta.url), "utf8"));
  const worker = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  expect(worker.vars.QUOTA_SOURCE_HOSTS.split(",")).toEqual(config.sourceHosts);
  expect(new URL(config.endpoint).hostname).toBe(worker.routes[0].pattern);
});

it("rejects HTTP and unapproved source hosts before sending credentials", () => {
  expect(() => uploadPlan(body, null, { QUOTA_INGEST_URL: "http://localhost/api/ingestion/quota" })).toThrow("HTTPS");
  expect(() => uploadPlan(body.replace("pdf.dfcfw.com", "evil.example"), null, {})).toThrow("allowlist");
  expect(() => uploadPlan(body, null, { QUOTA_SOURCE_HOSTS: "" })).toThrow("allowlist");
});

it("keeps an existing frozen key and refuses a changed retry body", () => {
  const plan = uploadPlan(body, null, {});
  const previous = { ...plan, idempotencyKey: "original-frozen-key" };
  expect(uploadPlan(body, previous, {}).idempotencyKey).toBe("original-frozen-key");
  expect(() => uploadPlan(body + " ", previous, {})).toThrow("hash changed");
});

it("records missing credentials as pending without attempting a request", async () => {
  const { dir, file } = await fixture();
  const transport = vi.fn();
  const result = await uploadQuota(file, { env: { QUOTA_INGEST_TOKEN_FILE: path.join(dir, "missing-token") }, transport });
  expect(result).toMatchObject({ status: "pending_upload", attempted: false, accepted: 0, response: null });
  expect(transport).not.toHaveBeenCalled();
  expect(JSON.parse(await readFile(path.join(dir, "upload.json"), "utf8"))).toEqual(result);
});

it("loads a token file and records actual acceptance, including idempotent replay", async () => {
  const { dir, file } = await fixture();
  const tokenFile = path.join(dir, "token");
  await writeFile(tokenFile, "x".repeat(43), { mode: 0o600 });
  const transport = vi.fn(async (plan, filename, token) => {
    expect(token).toBe("x".repeat(43));
    expect(await readFile(filename, "utf8")).toBe(body);
    return { httpStatus: 201, response: { ok: true, accepted: 1, reused: false } };
  });
  const env = { QUOTA_INGEST_TOKEN_FILE: tokenFile };
  const first = await uploadQuota(file, { env, transport });
  expect(first).toMatchObject({ status: "uploaded", accepted: 1, attempted: true });
  transport.mockResolvedValueOnce({ httpStatus: 200, response: { ok: true, accepted: 1, reused: true } });
  const second = await uploadQuota(file, { env, transport });
  expect(second.status).toBe("uploaded");
  expect(second.idempotencyKey).toBe(first.idempotencyKey);
  expect(await readFile(file, "utf8")).toBe(body);
});

it.each([
  { httpStatus: 401, response: { error: "unauthorized" } },
  { httpStatus: 422, response: { error: "validation_failed", details: [{ index: 0, error: "sourceUrl" }] } },
  { httpStatus: 201, response: { ok: true, accepted: 0, rejected: 1 } },
])("does not report failed or partial responses as successful: $httpStatus", async (response) => {
  const { file } = await fixture();
  const result = await uploadQuota(file, { env: { QUOTA_INGEST_TOKEN: "x".repeat(43) }, transport: async () => response });
  expect(result).toMatchObject({ status: "pending_upload", accepted: 0, attempted: true, ...response });
  expect(result.errors[0]).toContain("not accepted");
});

it("can check a frozen payload without credentials or modifying receipt files", async () => {
  const { dir, file } = await fixture();
  const result = await uploadQuota(file, { env: {}, dryRun: true });
  expect(result).toMatchObject({ status: "dry_run", attempted: false });
  await expect(readFile(path.join(dir, "upload.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("persists collection progress offline and retries only the frozen upload", async () => {
  const { quotaRun } = await import("./quota-run.mjs");
  const { dir, file } = await fixture();
  const env = { QUOTA_INGEST_TOKEN: "x".repeat(43) };
  const offline = vi.fn(async () => { throw new Error("offline"); });
  const start = await quotaRun("start", dir, { env, transport: offline });
  expect(start).toMatchObject({ status: "collecting", reported: false });
  expect((await quotaRun("start", dir, { env, transport: offline })).runId).toBe(start.runId);
  await quotaRun("finish", dir, { env, transport: offline });
  const requests = [];
  const transport = vi.fn(async (plan, filename) => {
    requests.push({ endpoint: plan.endpoint, key: plan.idempotencyKey, body: await readFile(filename, "utf8") });
    return plan.endpoint.endsWith("/status") ? { httpStatus: 200, response: { ok: true } } : { httpStatus: 201, response: { ok: true, accepted: 1, rejected: 0 } };
  });
  const first = await uploadQuota(file, { env, transport });
  expect(first.status).toBe("uploaded");
  const frozen = await readFile(file, "utf8");
  expect(JSON.parse(frozen).collectionRunId).toBe(start.runId);
  const second = await uploadQuota(file, { env, transport });
  expect(second.idempotencyKey).toBe(first.idempotencyKey);
  expect(await readFile(file, "utf8")).toBe(frozen);
  expect(requests.filter((r) => !r.endpoint.endsWith("/status")).map((r) => r.body)).toEqual([frozen, frozen]);
  expect(JSON.stringify(first)).not.toContain(env.QUOTA_INGEST_TOKEN);
});
