/**
 * WFX-051 search surface composition tests (bun:test).
 *
 * Proves the real search flow — query → Experience API search → results
 * grid — through BOTH port bundles:
 *
 * - fixtures mode: both surfaces are browsed (watch first, then shorts not
 *   already shown), joined identities dedupe, and the three typed states
 *   (empty query / no matches / results) render honestly;
 * - service mode: the SAME pipeline over the remote ports with a STUBBED
 *   fetch (no network) — the query rides the frozen transport contract
 *   (GET {base}/experience/search?query=… + x-wfx-* identity headers) and
 *   the stub's answers render as cards;
 * - a failed transport degrades to the honest empty answer (the WFX-003
 *   law mirrored by the remote ports) — the typed no-matches state, never
 *   fabricated cards, never a crash.
 *
 * Deterministic: controlled env (restored), stubbed transport. No network.
 */

import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AppShell } from "../src/components/shell/AppShell";
import { SearchSurface } from "../src/components/search/SearchSurface";
import { bootExperienceHost } from "../src/host/experience";
import { withWatchStateRecording } from "../src/host/watch-state";
import { loadSearchView } from "../src/host/views";
import { createRemotePorts } from "../src/host/remote-ports";
import { bootWebClient } from "../src/main";

/** Run an async `body` with a controlled environment, restoring the real one after. */
async function withEnv(overrides: Record<string, string>, body: () => Promise<void>): Promise<void> {
  const names = ["WFX_DEV_FIXTURES", "WFX_API_BASE", "NODE_ENV"];
  const saved = new Map<string, string | undefined>();
  for (const name of names) saved.set(name, process.env[name]);
  try {
    for (const name of names) delete process.env[name];
    for (const [name, value] of Object.entries(overrides)) process.env[name] = value;
    await body();
  } finally {
    for (const name of names) {
      const value = saved.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/** Render the full search page tree (shell + surface). */
function renderSearch(view: Awaited<ReturnType<typeof loadSearchView>>): string {
  return renderToStaticMarkup(
    createElement(AppShell, {
      mode: view.mode,
      active: "/search",
      children: createElement(SearchSurface, { view }),
    }),
  );
}

describe("WFX-051 search surface composition (through the ports)", () => {
  it("fixtures mode: both surfaces are browsed, deduped, and rendered with typed states", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const host = bootExperienceHost();

      // "rain" hits the watch surface (Desert Rain Doc) AND the short
      // surface (Neon Rain, Rain Check) — watch first, shorts join after.
      const view = await loadSearchView(host, "rain");
      expect(view.mode).toBe("fixtures");
      expect(view.query).toBe("rain");
      expect(view.results.map((card) => card.title)).toEqual([
        "Desert Rain Doc",
        "Neon Rain",
        "Rain Check",
      ]);
      const markup = renderSearch(view);
      expect(markup).toContain("data-wfx-search-state=\"results\"");
      expect(markup).toContain("3 results for");
      expect(markup).toContain("Desert Rain Doc");
      expect(markup).toContain("Neon Rain");

      // The empty query is its own typed state.
      const empty = await loadSearchView(host, "   ");
      expect(empty.query).toBe("");
      expect(empty.results).toEqual([]);
      expect(renderSearch(empty)).toContain("data-wfx-search-state=\"empty-query\"");

      // No matches is honest — no fabricated cards.
      const none = await loadSearchView(host, "zzzz-no-such-title");
      expect(none.results).toEqual([]);
      const noneMarkup = renderSearch(none);
      expect(noneMarkup).toContain("data-wfx-search-state=\"no-results\"");
      expect(noneMarkup).not.toContain("data-wfx-card=\"wfxitm_");
    });
  });

  it("service mode: the query rides the transport contract and renders the service's answers", async () => {
    const seen: { method: string; url: string; headers: Record<string, string> }[] = [];
    const ports = createRemotePorts({
      apiBase: new URL("https://experience.example.com"),
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const parsed = new URL(url);
        seen.push({
          method: init?.method ?? "GET",
          url: parsed.pathname + parsed.search,
          headers: Object.fromEntries(
            Object.entries(init?.headers as Record<string, string> ?? {}),
          ),
        });
        if (parsed.pathname === "/experience/search") {
          return new Response(
            JSON.stringify([
              {
                connectorId: "wfx-experience-service",
                externalRef: "yt:svc-9",
                title: "Live Service Feature",
                canonicalType: "video",
                durationMs: 3_600_000,
                orientation: "horizontal",
              },
            ]),
            { status: 200 },
          );
        }
        if (parsed.pathname === "/experience/metadata") {
          return new Response(
            JSON.stringify({
              connectorId: "wfx-experience-service",
              externalRef: "yt:svc-9",
              title: "Live Service Feature",
              availability: "available",
              capabilities: ["playEmbed"],
              canonicalType: "video",
              durationMs: 3_600_000,
              orientation: "horizontal",
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: `unexpected ${parsed.pathname}` }), { status: 500 });
      }) as typeof fetch,
    });
    const client = bootWebClient({ ports: withWatchStateRecording(ports) });
    const view = await loadSearchView({ mode: "service", client }, "feature");

    expect(view.mode).toBe("service");
    expect(view.results).toHaveLength(1);
    expect(view.results[0]?.title).toBe("Live Service Feature");
    expect(view.results[0]?.availability).toBe("available");

    // The transport contract: search + metadata GETs with identity headers.
    const search = seen.find((entry) => entry.url.startsWith("/experience/search"));
    expect(search).toBeDefined();
    expect(search?.method).toBe("GET");
    expect(search?.url).toContain("query=feature");
    expect(search?.headers["x-wfx-user-id"]).toBe("wfx-anonymous");
    expect(search?.headers["x-wfx-session-id"]).toBe("wfx-web-host");

    const markup = renderSearch(view);
    expect(markup).toContain("live service");
    expect(markup).toContain("Live Service Feature");
    expect(markup).toContain("1h 0m");
  });

  it("a failed transport degrades to the honest no-matches state (never fabricated, never a crash)", async () => {
    const ports = createRemotePorts({
      apiBase: new URL("https://experience.example.com"),
      fetchImpl: (async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ error: "service down" }), { status: 503 })) as typeof fetch,
    });
    const client = bootWebClient({ ports: withWatchStateRecording(ports) });
    const view = await loadSearchView({ mode: "service", client }, "anything");
    expect(view.results).toEqual([]);
    const markup = renderSearch(view);
    expect(markup).toContain("data-wfx-search-state=\"no-results\"");
    expect(markup).not.toContain("data-wfx-card=\"wfxitm_");
  });
});
