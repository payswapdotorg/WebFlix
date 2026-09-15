/*
 * WebFlix service worker — WFX-057. Hand-written, zero dependencies
 * (no workbox, no loader — verified by tests/pwa-service-worker.test.ts).
 *
 * THE HONESTY LAWS this worker obeys:
 *
 * 1. NEVER cache or serve API traffic. Same-origin `/api/*` requests are
 *    passed straight to the network (the early `return` in the fetch
 *    handler) — they are never served from a cache and never answered
 *    synthetically. An offline API call fails visibly, exactly like the
 *    app's honesty law demands.
 *
 * 2. NEVER serve stale CONTENT. Every page on this host is dynamic
 *    (force-dynamic: personalized, typed states — see DEPLOYMENT.md), so
 *    the ONLY offline answer for a navigation is the precached `/offline`
 *    shell. No fake "cached feed" — offline means the honest offline state.
 *
 * 3. Static build assets (`/_next/static/*`) are content-hashed — safe to
 *    serve stale-while-revalidate: the file names change when the content
 *    does. These are cached on FIRST FETCH (the hashed names are not
 *    statically knowable inside this file — nothing is precached that this
 *    file cannot name truthfully).
 *
 * 4. Everything else passes through untouched (default network behavior).
 *
 * UPDATE FLOW (the visible-update law): a new worker installs but WAITS
 * (no skipWaiting on install). The page shows a non-blocking
 * "Update available — Reload" affordance (components/shell/UpdatePrompt.tsx);
 * only the user's click posts `WFX_SKIP_WAITING`, and only the resulting
 * `controllerchange` triggers the reload — never a silent one.
 *
 * CACHE VERSIONING: `CACHE_VERSION` names every cache this worker uses;
 * activation deletes every cache that is not the current version. Bump the
 * version when the precached set or the strategy changes.
 */

const CACHE_VERSION = "wfx-static-v1";
const OFFLINE_URL = "/offline";

/** The build-time-known offline shell + identity assets (nothing else is precached). */
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/icon-main.png",
  "/icon-maskable.png",
  "/manifest.webmanifest",
  "/favicon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Each URL is added individually (not cache.addAll): one failed asset
      // must not roll back the whole install. A failed /offline precache is
      // logged loudly — the offline promise degrades honestly, in the open.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            // cache "reload" bypasses the HTTP cache: install always warms
            // the CURRENT build's offline shell, never a stale proxy copy.
            await cache.add(new Request(url, { cache: "reload" }));
          } catch (error) {
            console.warn("[webflix sw] precache miss:", url, error);
          }
        }),
      );
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Versioned cleanup: delete every cache that is not the current version.
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)),
      );
      // Claim existing clients so the offline fallback protects the very
      // first session (no reload needed to come under control).
      await self.clients.claim();
    })(),
  );
});

// skipWaiting is called ONLY when the page asks — the user clicked "Reload"
// on the visible update affordance. This is the whole visible-update law.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "WFX_SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return; // only idempotent reads are handled

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // same-origin only
  if (url.pathname.startsWith("/api/")) return; // LAW 1: never touch /api/*
  if (request.mode === "navigate") {
    // LAW 2: network-first for pages; the offline shell is the only
    // offline answer. A failed navigation NEVER falls back to a cached
    // dynamic page.
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    // LAW 3: content-hashed build assets — stale-while-revalidate.
    event.respondWith(staleWhileRevalidate(event, request));
    return;
  }
  // LAW 4: everything else passes through (default network behavior).
});

/**
 * Navigations: try the network; on network failure serve the offline shell.
 * A non-ok server answer (e.g. the typed 500 boot error) is returned AS IS —
 * only a network failure means "offline".
 */
async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    // A successful online visit to /offline refreshes the precached copy
    // (keeps the offline shell current across deploys). NO other page
    // response is ever cached — dynamic content is never served stale.
    if (response.ok && new URL(request.url).pathname === OFFLINE_URL) {
      const cache = await caches.open(CACHE_VERSION);
      await cache.put(OFFLINE_URL, response.clone());
    }
    return response;
  } catch (_error) {
    const cache = await caches.open(CACHE_VERSION);
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    // Even the offline shell is unavailable (the precache never succeeded):
    // fail as a network error. Never fabricate a page.
    return Response.error();
  }
}

/** Content-hashed build assets: serve from cache, refresh in the background. */
async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) {
        return cache.put(request, response.clone()).then(() => response);
      }
      return response;
    })
    .catch(() => null); // a failed background refresh is non-fatal
  if (cached) {
    // Keep the worker alive for the background refresh, then answer from
    // cache immediately (the name is content-hashed; "stale" == "valid").
    event.waitUntil(refresh);
    return cached;
  }
  const fresh = await refresh;
  return fresh !== null ? fresh : Response.error();
}
