/**
 * WFX-057 service worker source tests (bun:test).
 *
 * The service worker runs only in browsers — so these are source-level
 * assertions on `public/sw.js` (the packet's prescribed approach): the
 * never-cache laws, the cache versioning, the strategies per request
 * class, and the gated skipWaiting are each pinned to the exact code
 * paths that implement them. A behavioral regression that reorders the
 * guards or un-gates skipWaiting fails here.
 *
 * Deterministic: one file read + string/regex analysis. No browser.
 */

import { describe, expect, it } from "bun:test";

const sw = await Bun.file(new URL("../public/sw.js", import.meta.url)).text();

describe("WFX-057 service worker: hand-written, zero dependencies", () => {
  it("imports nothing (no workbox, no importScripts, no modules)", () => {
    expect(sw).not.toContain("importScripts");
    expect(sw).not.toMatch(/^\s*import\s/m);
    expect(sw).not.toMatch(/^\s*export\s/m);
  });

  it("uses a versioned cache name for EVERY cache access", () => {
    expect(sw).toMatch(/const CACHE_VERSION = "wfx-static-v\d+"/);
    const opens = sw.match(/caches\.open\(/g) ?? [];
    const versionedOpens = sw.match(/caches\.open\(CACHE_VERSION\)/g) ?? [];
    expect(opens.length).toBeGreaterThan(0);
    expect(versionedOpens.length).toBe(opens.length); // no anonymous/second cache
  });
});

describe("WFX-057 service worker: the never-cache laws", () => {
  it("LAW 1 — /api/* requests return BEFORE any respondWith (never cached, never intercepted)", () => {
    // The exact guard line: same-origin API paths leave the handler
    // immediately — no cache read, no cache write, no synthetic answer.
    expect(sw).toContain('if (url.pathname.startsWith("/api/")) return;');
    const apiGuard = sw.indexOf('url.pathname.startsWith("/api/")');
    const firstRespondWith = sw.indexOf("event.respondWith(");
    expect(apiGuard).toBeGreaterThanOrEqual(0);
    expect(firstRespondWith).toBeGreaterThanOrEqual(0);
    expect(apiGuard).toBeLessThan(firstRespondWith); // the guard runs first
  });

  it("only idempotent GET requests are handled (everything else passes through)", () => {
    expect(sw).toContain('if (request.method !== "GET") return;');
  });

  it("only same-origin requests are handled", () => {
    expect(sw).toContain("url.origin !== self.location.origin");
  });

  it("the /api guard appears exactly once and matches the /api/ prefix (not a broader path)", () => {
    const matches = sw.match(/startsWith\("\/api\/"\)/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

describe("WFX-057 service worker: strategies per request class", () => {
  it("navigations are network-first with the offline page as the ONLY fallback", () => {
    expect(sw).toContain('request.mode === "navigate"');
    expect(sw).toContain("event.respondWith(networkFirstNavigation(request))");
    expect(sw).toContain("cache.match(OFFLINE_URL)");
    // No navigation response other than /offline is ever cached.
    const navigationCachePuts = sw.match(
      /pathname === OFFLINE_URL[\s\S]{0,200}?cache\.put\(OFFLINE_URL/g,
    );
    expect(navigationCachePuts).toHaveLength(1);
  });

  it("content-hashed /_next/static assets are stale-while-revalidate", () => {
    expect(sw).toContain('url.pathname.startsWith("/_next/static/")');
    expect(sw).toContain("event.respondWith(staleWhileRevalidate(event, request))");
  });

  it("the default branch passes through (no catch-all respondWith)", () => {
    // The fetch handler's last statement is the LAW 4 comment — everything
    // not matched above falls through to the browser's default behavior.
    const fetchListener = sw.slice(sw.indexOf('self.addEventListener("fetch"'));
    const law4 = fetchListener.indexOf("LAW 4: everything else passes through");
    const lastRespondWith = fetchListener.lastIndexOf("event.respondWith(");
    expect(law4).toBeGreaterThan(lastRespondWith);
  });
});

describe("WFX-057 service worker: install / activate / update lifecycle", () => {
  it("precache is exactly the build-time-known set: offline route + icons + manifest + favicon", () => {
    expect(sw).toContain('const OFFLINE_URL = "/offline"');
    for (const url of [
      '"/offline"',
      '"/icon-main.png"',
      '"/icon-maskable.png"',
      '"/manifest.webmanifest"',
      '"/favicon.svg"',
    ]) {
      expect(sw).toContain(url);
    }
    // Precache happens through cache.add with a reload bypass.
    expect(sw).toContain("cache.add(new Request(url, { cache: \"reload\" }))");
  });

  it("activate deletes every cache that is not the current version and claims clients", () => {
    expect(sw).toContain("caches.keys()");
    expect(sw).toMatch(/key !== CACHE_VERSION[\s\S]{0,120}?caches\.delete\(key\)/);
    expect(sw).toContain("self.clients.claim()");
  });

  it("skipWaiting is gated on the page's explicit WFX_SKIP_WAITING message (visible-update law)", () => {
    const skipWaitingCalls = sw.match(/self\.skipWaiting\(\)/g) ?? [];
    expect(skipWaitingCalls).toHaveLength(1); // exactly one — never called on install
    const messageGate = sw.indexOf("WFX_SKIP_WAITING");
    const skipWaiting = sw.indexOf("self.skipWaiting()");
    expect(messageGate).toBeGreaterThanOrEqual(0);
    expect(messageGate).toBeLessThan(skipWaiting); // inside the message handler only
  });
});
