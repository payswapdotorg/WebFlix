/**
 * WFX-050 home surface composition tests (bun:test).
 *
 * Proves the minimal-but-real home surface end to end through the SHARED
 * runtime — the same `HomeSurface` component the route serves, rendered
 * with `react-dom/server`:
 *
 * - fixtures mode (`WFX_DEV_FIXTURES=1`): the deterministic fixture
 *   content flows through bootWebClient → ClientRuntime.getFeed →
 *   loadHomeView → HomeSurface markup;
 * - service mode: the same pipeline over the remote ports with a STUBBED
 *   fetch (no network) — the production path renders service data;
 * - empty answers render the honest empty state, never fabricated cards.
 *
 * Deterministic: controlled env (restored), stubbed transport, fixed
 * clocks/ids inside the fixture and stub bundles. No network.
 */

import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { makeFixturePorts } from "@wfx/experience";

import { HomeSurface } from "../src/components/HomeSurface";
import { bootWebClient } from "../src/main";
import { bootWebHost } from "../src/host/boot";
import { loadHomeView } from "../src/host/home";
import { createRemotePorts } from "../src/host/remote-ports";

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

/** Render the home surface to static markup (the server-render path). */
function renderHome(view: Awaited<ReturnType<typeof loadHomeView>>): string {
  return renderToStaticMarkup(createElement(HomeSurface, { view }));
}

describe("WFX-050 home surface composition (through the shared runtime)", () => {
  it("fixtures mode: the home surface renders fixture feed data through the runtime", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const host = bootWebHost();
      expect(host.mode).toBe("fixtures");
      const view = await loadHomeView(host);

      // The fixture catalog, projected through the frozen feed use-case
      // (watch surface, seed query "rain"): deterministic content — the
      // "rain" hits that are WATCH-form (long-form horizontal) surface
      // here; the vertical shorts (Neon Rain, Rain Check) do not.
      expect(view.mode).toBe("fixtures");
      expect(view.surface).toBe("watch");
      const titles = view.cards.map((card) => card.title);
      expect(titles).toEqual(["Desert Rain Doc"]);
      expect(view.cards.every((card) => card.itemId.startsWith("wfxitm_"))).toBeTrue();

      // The rendered markup carries the feed data.
      const markup = renderHome(view);
      expect(markup).toContain("WebFlix");
      expect(markup).toContain("Desert Rain Doc");
      expect(markup).toContain("dev fixtures");
      expect(markup).toContain("data-wfx-cards");
    });
  });

  it("service mode: the home surface renders EXPERIENCE SERVICE data through the runtime", async () => {
    // The production composition, hand-assembled with a stubbed transport:
    // remote ports (fixed clock + sequential ids) → bootWebClient →
    // ClientRuntime.getFeed → loadHomeView → HomeSurface.
    const ports = createRemotePorts({
      apiBase: new URL("https://experience.example.com"),
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const path = new URL(url).pathname;
        if (path === "/experience/search") {
          return new Response(
            JSON.stringify([
              {
                connectorId: "wfx-experience-service",
                externalRef: "yt:svc-1",
                title: "Live Service Feature",
                canonicalType: "video",
                durationMs: 3_600_000,
                orientation: "horizontal",
              },
            ]),
            { status: 200 },
          );
        }
        if (path === "/experience/metadata") {
          return new Response(
            JSON.stringify({
              connectorId: "wfx-experience-service",
              externalRef: "yt:svc-1",
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
        return new Response(JSON.stringify({ error: `unexpected ${path}` }), { status: 500 });
      }) as typeof fetch,
    });
    const client = bootWebClient({ ports });
    const view = await loadHomeView({ mode: "service", client });

    expect(view.mode).toBe("service");
    expect(view.cards).toHaveLength(1);
    expect(view.cards[0]?.title).toBe("Live Service Feature");
    expect(view.cards[0]?.availability).toBe("available");

    const markup = renderHome(view);
    expect(markup).toContain("Live Service Feature");
    expect(markup).toContain("live service");
    expect(markup).toContain("1h 0m");
  });

  it("an empty feed renders the honest empty state — never fabricated cards", async () => {
    // A connector whose search finds nothing (empty catalog override).
    const client = bootWebClient({ ports: makeFixturePorts({ items: [] }) });
    const view = await loadHomeView({ mode: "fixtures", client });
    expect(view.cards).toEqual([]);
    const markup = renderHome(view);
    expect(markup).toContain("No content");
    expect(markup).not.toContain("data-wfx-card=\"wfxitm_");
  });

  it("the component markup is stable for identical input (pure render)", () => {
    const view = {
      mode: "fixtures" as const,
      surface: "watch" as const,
      cards: [
        {
          itemId: "wfxitm_00000000000000000000000001",
          title: "Determinism Check",
          canonicalType: "video",
          durationMs: 90_000,
          availability: "available",
          connectorId: "fake-source",
          externalRef: "fake:video-x",
        },
      ],
    };
    expect(renderHome(view)).toBe(renderHome(view));
  });
});
