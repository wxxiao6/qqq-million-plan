import { afterEach, expect, it, vi } from "vitest";
import { authorizeCloudJob } from "./cloud-auth";

afterEach(() => vi.unstubAllEnvs());
it("fails closed and accepts only the dedicated strong job credential", async () => {
  const token = "a".repeat(43);
  const request = (credential?: string) => new Request("https://example.test/api/jobs/reconcile", { method: "POST", headers: credential ? { Authorization: credential } : {} });
  vi.stubEnv("CLOUD_JOB_TOKEN", "");
  expect(await authorizeCloudJob(request(`Bearer ${token}`))).toBe(false);
  vi.stubEnv("CLOUD_JOB_TOKEN", "short");
  expect(await authorizeCloudJob(request("Bearer short"))).toBe(false);
  vi.stubEnv("CLOUD_JOB_TOKEN", token);
  expect(await authorizeCloudJob(request())).toBe(false);
  expect(await authorizeCloudJob(request(`Bearer ${"b".repeat(43)}`))).toBe(false);
  expect(await authorizeCloudJob(request(`Basic ${token}`))).toBe(false);
  expect(await authorizeCloudJob(request(`Bearer ${token}`))).toBe(true);
});
