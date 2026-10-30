import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const token = "9Rr4xXQLqU8KPeU_dAAaMjJGCyYWc6Qp7scwGfXgQdk";
const auth = (password: string) => `Basic ${btoa(`owner:${password}`)}`;
const request = (path = "/dca", init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`https://finance.example${path}`, init);

afterEach(() => vi.unstubAllEnvs());

describe("Worker access guard", () => {
  it("allows anonymous site access when explicitly disabled while rejecting cross-origin writes", async () => {
    vi.stubEnv("CLOUDFLARE_RUNTIME", "1");
    vi.stubEnv("SITE_AUTH_REQUIRED", "0");
    const response = await proxy(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await proxy(request("/dca", { method: "POST", headers: { origin: "https://other.example" } }))).status).toBe(403);
    expect((await proxy(request("/dca", { method: "POST", headers: { origin: "https://finance.example" } }))).status).toBe(200);
  });

  it("fails closed when required authentication is missing", async () => {
    vi.stubEnv("SITE_AUTH_REQUIRED", "1");
    vi.stubEnv("SITE_ACCESS_TOKEN", "");
    expect((await proxy(request())).status).toBe(503);
  });

  it("requires the correct strong credential", async () => {
    vi.stubEnv("SITE_AUTH_REQUIRED", "1");
    vi.stubEnv("SITE_ACCESS_TOKEN", token);
    expect((await proxy(request())).status).toBe(401);
    expect((await proxy(request("/", { headers: { authorization: auth("incorrect") } }))).status).toBe(401);
    expect((await proxy(request("/", { headers: { authorization: auth(token) } }))).status).toBe(200);
  });

  it("rejects authenticated cross-origin writes", async () => {
    vi.stubEnv("SITE_AUTH_REQUIRED", "1");
    vi.stubEnv("SITE_ACCESS_TOKEN", token);
    expect((await proxy(request("/dca", { method: "POST", headers: { authorization: auth(token), origin: "https://other.example" } }))).status).toBe(403);
    expect((await proxy(request("/dca", { method: "POST", headers: { authorization: auth(token), origin: "https://finance.example" } }))).status).toBe(200);
  });

  it("limits machine-job bypass to the three POST endpoints", async () => {
    vi.stubEnv("SITE_AUTH_REQUIRED", "1");
    vi.stubEnv("SITE_ACCESS_TOKEN", token);
    for (const path of ["/api/jobs/refresh", "/api/jobs/reconcile", "/api/jobs/info"]) {
      expect((await proxy(request(path, { method: "POST" }))).status).toBe(200);
      expect((await proxy(request(path))).status).toBe(401);
    }
    expect((await proxy(request("/api/jobs/other", { method: "POST" }))).status).toBe(401);
  });

  it("leaves ingestion POST to its independent token check, but protects other methods", async () => {
    vi.stubEnv("SITE_AUTH_REQUIRED", "1");
    vi.stubEnv("SITE_ACCESS_TOKEN", token);
    expect((await proxy(request("/api/ingestion/quota", { method: "POST" }))).status).toBe(200);
    expect((await proxy(request("/api/ingestion/quota"))).status).toBe(401);
  });
});
