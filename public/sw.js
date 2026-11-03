/* Bump the version when changing offline assets. Financial pages are network-only. */
const CACHE = "million-plan-pwa-v1";
const OFFLINE = "/offline.html";
const ASSETS = [OFFLINE, "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("million-plan-pwa-") && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Only an explicit user action may activate an update; never reload a form silently.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && !url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request).catch(async () => {
      return (await caches.match(OFFLINE)) || Response.error();
    }));
    return;
  }
  // No HTML, RSC, API responses, account details or writes enter Cache Storage.
  if (ASSETS.includes(url.pathname) && !url.search) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
  }
});
