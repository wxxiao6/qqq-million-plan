import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import manifest from "@/app/manifest";

function worker() {
  const listeners: Record<string, (event: Record<string, unknown>) => void> = {};
  const cache = { addAll: vi.fn().mockResolvedValue(undefined) };
  const caches = {
    open: vi.fn().mockResolvedValue(cache), match: vi.fn().mockResolvedValue(new Response("offline")),
    keys: vi.fn().mockResolvedValue(["million-plan-pwa-old", "another-app", "million-plan-pwa-v1"]),
    delete: vi.fn().mockResolvedValue(true),
  };
  const fetch = vi.fn().mockResolvedValue(new Response("live"));
  const self = { location: { origin: "https://example.com" }, addEventListener: (name: string, callback: typeof listeners[string]) => { listeners[name] = callback; }, clients: { claim: vi.fn().mockResolvedValue(undefined) }, skipWaiting: vi.fn() };
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), { self, caches, fetch, URL, Response });
  function request(path: string, options = {}) {
    const respondWith = vi.fn();
    listeners.fetch({ request: { url: `https://example.com${path}`, method: "GET", mode: "cors", ...options }, respondWith });
    return respondWith;
  }
  return { listeners, caches, cache, fetch, self, request };
}

describe("PWA boundaries", () => {
  it("installs the whole site with real, correctly sized icons", () => {
    const config = manifest();
    expect(config).toMatchObject({ id: "/", scope: "/", start_url: "/quota", display: "standalone" });
    for (const icon of config.icons ?? []) {
      expect(existsSync(`public${icon.src}`)).toBe(true);
      const png = readFileSync(`public${icon.src}`);
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
    }
  });

  it("precaches only offline UI and icons, without forcing activation", async () => {
    const w = worker();
    const waitUntil = vi.fn();
    w.listeners.install({ waitUntil });
    await waitUntil.mock.calls[0][0];
    expect(w.cache.addAll.mock.calls[0][0]).toEqual(["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png"]);
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
  });

  it("leaves API, RSC, actions, external requests and private assets to the network", () => {
    const w = worker();
    for (const [path, options] of [
      ["/api/auth/login", { method: "POST" }], ["/api/holdings", {}],
      ["/api/health", { mode: "navigate" }], ["/holdings/manage?_rsc=abc", {}],
      ["/holdings/manage", { method: "POST" }], ["/_next/static/chunk.js", {}],
      ["/icons/icon-192.png?private=1", {}], ["/external", { url: "https://other.com/" }],
    ] as const) expect(w.request(path, options)).not.toHaveBeenCalled();
    expect(w.caches.match).not.toHaveBeenCalled();
  });

  it("fetches a fresh page and falls back only on a navigation network failure", async () => {
    const w = worker();
    const online = w.request("/holdings/manage", { mode: "navigate" });
    expect(await (await online.mock.calls[0][0]).text()).toBe("live");
    expect(w.caches.match).not.toHaveBeenCalled();
    w.fetch.mockRejectedValueOnce(new TypeError("offline"));
    const offline = w.request("/dca", { mode: "navigate" });
    expect(await (await offline.mock.calls[0][0]).text()).toBe("offline");
    expect(w.caches.match).toHaveBeenCalledWith("/offline.html");
  });

  it("does not mask an HTTP error or authentication redirect with cached content", async () => {
    const w = worker();
    w.fetch.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const response = w.request("/quota", { mode: "navigate" });
    expect((await response.mock.calls[0][0]).status).toBe(503);
    expect(w.caches.match).not.toHaveBeenCalled();
  });

  it("only removes this application's old caches and activates updates on request", async () => {
    const w = worker();
    const waitUntil = vi.fn();
    w.listeners.activate({ waitUntil });
    await waitUntil.mock.calls[0][0];
    expect(w.caches.delete.mock.calls).toEqual([["million-plan-pwa-old"]]);
    expect(w.self.clients.claim).toHaveBeenCalledOnce();
    w.listeners.message({ data: { type: "OTHER" } });
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
    w.listeners.message({ data: { type: "SKIP_WAITING" } });
    expect(w.self.skipWaiting).toHaveBeenCalledOnce();
  });
});
