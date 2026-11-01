import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const request = (path = "/dca", init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`https://finance.example${path}`, init);

describe("site request protections", () => {
  it("allows anonymous access and prevents shared caching", async () => {
    const response = await proxy(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.has("www-authenticate")).toBe(false);
  });

  it("rejects cross-origin writes while allowing same-origin writes", async () => {
    expect((await proxy(request("/dca", { method: "POST", headers: { origin: "https://other.example" } }))).status).toBe(403);
    expect((await proxy(request("/dca", { method: "POST", headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403);
    expect((await proxy(request("/dca", { method: "POST", headers: { origin: "https://finance.example" } }))).status).toBe(200);
  });

  it("leaves machine POST endpoints to their independent authentication", async () => {
    for (const path of ["/api/jobs/refresh", "/api/jobs/reconcile", "/api/jobs/info", "/api/ingestion/quota"]) {
      expect((await proxy(request(path, { method: "POST", headers: { origin: "https://other.example" } }))).status).toBe(200);
      expect((await proxy(request(path, { method: "PUT", headers: { origin: "https://other.example" } }))).status).toBe(403);
    }
  });
});
