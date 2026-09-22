/**
 * R09 web media-surface tests (bun:test).
 *
 * The precedence wired END-TO-END on the booted web host (the real
 * composition root, fixture + service transports, deterministic, no
 * network):
 *
 * - THE RESOLVER WIRING: the frozen resolver (through the injected seam)
 *   decides playback resolution on the web platform's truthful device
 *   derivation — native honestly named-rejected (Web truthfully declares
 *   nativeMedia: "none"), embed > browser > external fallbacks, the
 *   precedence trace surfaced in the view (the answer NAMES what was
 *   chosen and why).
 * - THE EMBED RUNG (J07): the rendered stage is CONTAINED EXACTLY LIKE THE
 *   BROWSER RUNG — the sandbox attribute (opaque origin, no
 *   allow-same-origin), the honest attestation line (official vs
 *   unofficial), and `data-wfx-player-mode="embed"` through the same
 *   player-surface vocabulary.
 * - THE EXTERNAL RUNG (J09): the visible handoff ("opens on its source")
 *   carries the RETURN CONTEXT — the durable continuation (item + position
 *   at handoff) with the return link.
 * - THE HOSTS: the web BrowserHost's productionized session lifecycle
 *   (open/navigate/close round-trips on the DOM double; multi-session
 *   isolation — each open mints a fresh sandboxed iframe; the honest
 *   capability truth, J08's Constrained answer where the DOM is absent).
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { loadPlayerView } from "../src/host/view-models";
import type { PlayerEnrichments, PlayerShellView, PlayerView } from "../src/host/view-models";
import { webDeviceCapabilities, createWebSurfaceResolver } from "../src/host/media-surface";
import { createWebBrowserHostPort, webSurfaceCapabilityTruth } from "../src/platform/browser-host";
import { PlayerSurface } from "../src/components/player/PlayerSurface";

/**
 * The surface's render props from a composed view (the shell fields +
 * the RESOLVED enrichments — the composed render path: the sections
 * render inline, no suspension, no streaming).
 */
function playerSurfaceRenderProps(
  view: PlayerView,
): {
  view: PlayerShellView;
  enrichments: PlayerEnrichments;
} {
  return {
    view,
    enrichments: {
      aiTray: view.aiTray,
      intelligence: view.intelligence,
      liveAsr: view.liveAsr,
      realtime: view.realtime,
      related: view.related,
    },
  };
}
import { AppShell } from "../src/components/shell/AppShell";
import { withEnv, withFetchStub, FakeDocument, makeBrowserEnvironment, makeServerEnvironment } from "./fake-web";

beforeEach(() => {
  resetWebHostProcessState();
});

/** Boot the fixture host under a controlled environment. */
async function bootHost(): Promise<WebRuntimeHost> {
  let host: WebRuntimeHost | undefined;
  await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
    host = await getWebRuntimeHost();
  });
  if (host === undefined) throw new Error("the fixture host did not boot");
  return host;
}

/** The full player markup for one view (the real component tree). */
function playerMarkup(host: WebRuntimeHost, view: PlayerView): string {
  return renderToStaticMarkup(
    createElement(AppShell, {
      mode: host.mode,
      session: host.session.state,
      children: createElement(PlayerSurface, playerSurfaceRenderProps(view)),
    }),
  );
}

/** Find one card's canonical id by title through the runtime's search. */
async function itemIdOfTitle(host: WebRuntimeHost, title: string): Promise<string> {
  const model = await host.runtime.search({ query: title });
  const hit = model.hits.find((entry) => entry.result.title === title);
  if (hit === undefined) throw new Error(`fixture item '${title}' not found`);
  return hit.canonicalItemId;
}

// ---------------------------------------------------------------------------
// The resolver wiring (the truthful web device derivation)
// ---------------------------------------------------------------------------

describe("R09 web — the resolver wiring's truthful device derivation", () => {
  it("derives NO native mode (Web truthfully declares nativeMedia: none) and embed/browser/external", () => {
    const device = webDeviceCapabilities({
      nativeMedia: "none",
      browserHost: "contained",
      backgroundWork: "none",
    });
    expect(device.playbackModes).toEqual(["embed", "browser", "external"]);
    expect(device.browser).toBe(true);
    expect(device.backgroundPlayback).toBe(false);
  });

  it("derives no embed/browser modes when the platform truthfully has no contained host", () => {
    const device = webDeviceCapabilities({
      nativeMedia: "none",
      browserHost: "none",
      backgroundWork: "none",
    });
    expect(device.playbackModes).toEqual(["external"]);
    expect(device.browser).toBe(false);
  });

  it("the seam is pure and synchronous (the same input answers the identical resolution)", () => {
    const clock = { now: () => Date.parse("2026-09-16T12:00:00.000Z") };
    const seam = createWebSurfaceResolver({
      capabilities: {
        nativeMedia: "none",
        browserHost: "contained",
        backgroundWork: "none",
      },
      clock,
    });
    const realizations = [
      {
        mode: "browser" as const,
        connectorId: "x",
        externalRef: "r",
        url: "https://provider.example/watch",
        capabilities: ["playBrowser"],
      },
      {
        mode: "embed" as const,
        connectorId: "x",
        externalRef: "r",
        url: "https://provider.example/embed",
        capabilities: ["playEmbed"],
      },
    ];
    const first = seam.resolve({ itemId: "wfxitm_00000000000000000000000001", realizations });
    const second = seam.resolve({ itemId: "wfxitm_00000000000000000000000001", realizations });
    expect(second).toEqual(first);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.mode).toBe("embed"); // embed > browser on web
  });
});

// ---------------------------------------------------------------------------
// The precedence wired end-to-end through the booted host (fixture mode)
// ---------------------------------------------------------------------------

describe("R09 web — the precedence wired end-to-end (the booted host)", () => {
  it("embed wins on web with native honestly NAMED-rejected in the surfaced trace (Asteroid Drift)", async () => {
    const host = await bootHost();
    const itemId = await itemIdOfTitle(host, "Asteroid Drift");
    const view = await loadPlayerView(host, {
      itemId,
      connectorId: "fake-source",
      externalRef: "fake:movie-1",
      title: "Asteroid Drift",
      canonicalType: "movie",
      durationMs: 7_200_000,
    });
    expect(view.failure).toBeNull();
    expect(view.surfaceMode).toBe("embed");
    // THE ANSWER NAMES WHAT WAS CHOSEN AND WHY — the trace is surfaced.
    expect(view.precedenceTrace).toHaveLength(4);
    expect(view.precedenceTrace[0]).toContain("native: rejected — device cannot realize native playback");
    expect(view.precedenceTrace[0]).toContain("device declares [embed, browser, external]");
    expect(view.precedenceTrace[1]).toContain("embed: accepted");
    expect(view.precedenceTrace[2]).toContain("browser: skipped — precedence satisfied by 'embed'");
    expect(view.precedenceTrace[3]).toContain("external: skipped");
    // The markup renders the trace lines (J07/J08/J09 evidence anchors).
    const markup = playerMarkup(host, view);
    expect(markup).toContain("data-wfx-precedence-trace");
    expect(markup).toContain("native: rejected — device cannot realize native playback");
  });

  it("browser wins when embed is honestly absent (Static Bloom) — the contained session is session-scoped", async () => {
    const host = await bootHost();
    const itemId = await itemIdOfTitle(host, "Static Bloom");
    const view = await loadPlayerView(host, {
      itemId,
      connectorId: "fake-source",
      externalRef: "fake:video-2",
      title: "Static Bloom",
      canonicalType: "video",
    });
    expect(view.failure).toBeNull();
    expect(view.surfaceMode).toBe("browser");
    expect(view.browserSurface).not.toBeNull();
    expect(view.browserSurface!.url).toBe("https://fixture.invalid/watch/fake:video-2");
    // The trace names the rungs (no embed realization present — honest).
    expect(view.precedenceTrace[1]).toContain("embed: rejected — no embed realization present");
    expect(view.precedenceTrace[2]).toContain("browser: accepted");
  });

  it("the fixture embed realizations are named UNOFFICIAL (no provider attestation — invariant 10 honesty)", async () => {
    const host = await bootHost();
    const itemId = await itemIdOfTitle(host, "Harbor Lights");
    const view = await loadPlayerView(host, {
      itemId,
      connectorId: "fake-source",
      externalRef: "fake:series-1",
      title: "Harbor Lights",
      canonicalType: "series",
    });
    expect(view.surfaceMode).toBe("embed");
    expect(view.embedAttestation).toBe("unofficial"); // the fixture embeds carry no marker
    const markup = playerMarkup(host, view);
    expect(markup).toContain('data-wfx-embed-attestation="unofficial"');
    expect(markup).toContain("no provider official-embed attestation");
  });
});

// ---------------------------------------------------------------------------
// The EMBED rung's containment laws (J07) — through the service transport
// ---------------------------------------------------------------------------

describe("R09 web — the EMBED rung contained exactly like the browser rung (J07)", () => {
  it("the official-embed marker is consumed when present: the attestation renders OFFICIAL (service mode)", async () => {
    await withEnv({ WFX_API_BASE: "https://experience.example" }, async () => {
      await withFetchStub(
        (call) =>
          call.url.includes("/experience/resolve")
            ? new Response(
                JSON.stringify([
                  {
                    mode: "embed",
                    connectorId: "official-provider",
                    externalRef: "official:movie-1",
                    url: "https://official.invalid/embed/movie-1",
                    capabilities: ["playEmbed", "officialEmbed"],
                  },
                ]),
                { status: 200, headers: { "content-type": "application/json" } },
              )
            : new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
        async () => {
          const host = await getWebRuntimeHost();
          const view = await loadPlayerView(host, {
            itemId: "wfxitm_00000000000000000000000051",
            connectorId: "official-provider",
            externalRef: "official:movie-1",
            title: "Official Embed Item",
            canonicalType: "movie",
          });
          expect(view.failure).toBeNull();
          expect(view.surfaceMode).toBe("embed");
          expect(view.embedAttestation).toBe("official");
          const markup = playerMarkup(host, view);
          expect(markup).toContain('data-wfx-player-mode="embed"');
          expect(markup).toContain('data-wfx-embed-attestation="official"');
          expect(markup).toContain("Official provider embed");
          expect(markup).toContain("https://official.invalid/embed/movie-1");
        },
      );
    });
  });

  it("the embed iframe carries the SAME sandbox discipline as the browser rung (opaque origin)", async () => {
    const host = await bootHost();
    const itemId = await itemIdOfTitle(host, "Asteroid Drift");
    const view = await loadPlayerView(host, {
      itemId,
      connectorId: "fake-source",
      externalRef: "fake:movie-1",
      title: "Asteroid Drift",
      canonicalType: "movie",
      durationMs: 7_200_000,
    });
    const markup = playerMarkup(host, view);
    expect(markup).toContain("data-wfx-player-mode=\"embed\"");
    // THE CONTAINMENT LAW: the same sandbox tokens as the browser rung —
    // scripts/forms/popups/presentation allowed, NO allow-same-origin
    // (opaque origin: cookie/storage isolation), no storage-access grant.
    expect(markup).toContain('sandbox="allow-scripts allow-forms allow-popups allow-presentation"');
    expect(markup).not.toContain("allow-same-origin");
    // The embed rung engaged the CONTAINED surface (the port session rides
    // on the state) and the markup names it.
    expect(view.browserSurface).not.toBeNull();
    expect(markup).toContain("data-wfx-contained-surface=");
    // Provider-owned opacity: the honest note names it.
    expect(markup).toContain("never injects into or inspects the provider page");
  });

  it("the embed session engaged the BrowserHostPort under the isolation contract (rendered mount)", async () => {
    const host = await bootHost();
    const itemId = await itemIdOfTitle(host, "Neon Rain");
    const view = await loadPlayerView(host, {
      itemId,
      connectorId: "fake-source",
      externalRef: "fake:short-1",
      title: "Neon Rain",
      canonicalType: "short",
      durationMs: 45_000,
    });
    expect(view.surfaceMode).toBe("embed");
    // The contained-surface session exists in the port's rendered mount
    // (prepare opened it through the BrowserHostPort — isolate contract).
    expect(view.browserSurface).not.toBeNull();
    const rendered = host.browserHost.renderedSessions();
    expect(rendered.length).toBeGreaterThanOrEqual(1);
    expect(rendered.some((entry) => entry.url === "https://fixture.invalid/embed/fake:short-1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The EXTERNAL rung + return context (J09) — through the service transport
// ---------------------------------------------------------------------------

describe("R09 web — the external handoff carries the RETURN CONTEXT (J09)", () => {
  it("the handoff keeps the item + position at handoff and renders the return link", async () => {
    await withEnv({ WFX_API_BASE: "https://experience.example" }, async () => {
      await withFetchStub(
        (call) =>
          call.url.includes("/experience/resolve")
            ? new Response(
                JSON.stringify([
                  {
                    mode: "external",
                    connectorId: "provider-x",
                    externalRef: "provider:movie-9",
                    url: "https://provider.example/open/movie-9",
                    capabilities: ["playExternal"],
                  },
                ]),
                { status: 200, headers: { "content-type": "application/json" } },
              )
            : new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
        async () => {
          const host = await getWebRuntimeHost();
          const view = await loadPlayerView(host, {
            itemId: "wfxitm_00000000000000000000000061",
            connectorId: "provider-x",
            externalRef: "provider:movie-9",
            title: "External Handoff Movie",
            canonicalType: "movie",
            resumePositionMs: 1_800_000,
          });
          expect(view.failure).toBeNull();
          expect(view.surfaceMode).toBe("external");
          // The durable continuation: the item + the position at handoff.
          expect(view.externalReturn).not.toBeNull();
          expect(view.externalReturn!.itemId).toBe("wfxitm_00000000000000000000000061");
          expect(view.externalReturn!.connectorId).toBe("provider-x");
          expect(view.externalReturn!.externalRef).toBe("provider:movie-9");
          expect(view.externalReturn!.positionMs).toBe(1_800_000);
          expect(view.externalReturn!.handedOffAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

          const markup = playerMarkup(host, view);
          // The R07 handoff contract stays green…
          expect(markup).toContain("data-wfx-player-mode=\"external\"");
          expect(markup).toContain("opens on its source");
          // …and the return context renders (J09's durable continuation).
          expect(markup).toContain("data-wfx-return-context");
          expect(markup).toContain("Return context kept");
          expect(markup).toContain("data-wfx-return-link");
          expect(markup).toContain("resume=1800000");
        },
      );
    });
  });

  it("the return context is absent for non-external rungs (never fabricated)", async () => {
    const host = await bootHost();
    const itemId = await itemIdOfTitle(host, "Harbor Lights");
    const view = await loadPlayerView(host, {
      itemId,
      connectorId: "fake-source",
      externalRef: "fake:series-1",
      title: "Harbor Lights",
      canonicalType: "series",
    });
    expect(view.surfaceMode).toBe("embed");
    expect(view.externalReturn).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The web BrowserHost productionization (session lifecycle + truth)
// ---------------------------------------------------------------------------

describe("R09 web — the BrowserHost's productionized session lifecycle", () => {
  const OPEN = {
    url: "https://provider.example/watch/1",
    restrictCookies: "isolate" as const,
    purpose: "playback" as const,
  };

  it("sessions() enumerates open sessions across BOTH mounts; close removes; navigate updates", async () => {
    const port = createWebBrowserHostPort({
      environment: makeServerEnvironment(),
      clock: { now: () => 5_000 },
    });
    expect(port.sessions()).toEqual([]);
    const first = await port.open(OPEN);
    const second = await port.open({ ...OPEN, url: "https://provider.example/watch/2" });
    expect(port.sessions()).toHaveLength(2);
    expect(port.sessions().map((entry) => entry.id)).toEqual([first.id, second.id]);
    expect(port.sessions()[0]!.mount).toBe("rendered");

    await first.navigate("https://provider.example/watch/1/next");
    expect(port.sessions()[0]!.url).toBe("https://provider.example/watch/1/next");

    await second.close();
    expect(port.sessions()).toHaveLength(1);
    expect(port.sessions()[0]!.id).toBe(first.id);
  });

  it("multi-session isolation on the DOM mount: each open mints a FRESH sandboxed iframe (opaque origin)", async () => {
    const document = new FakeDocument();
    const port = createWebBrowserHostPort({
      environment: makeBrowserEnvironment({ document }),
      clock: { now: () => 5_000 },
    });
    const first = await port.open(OPEN);
    const second = await port.open({ ...OPEN, url: "https://other.example/watch" });
    // TWO distinct iframes — never a shared frame — each carrying the
    // sandbox law (fresh opaque origin per session).
    expect(document.frames.length).toBe(2);
    expect(first.id).not.toBe(second.id);
    for (const frame of document.frames) {
      expect(frame.sandbox).toContain("allow-scripts");
      expect(frame.sandbox).not.toContain("allow-same-origin");
    }
    expect(port.sessions()).toHaveLength(2);
    expect(port.sessions()[0]!.mount).toBe("dom");
  });

  it("the DOM mount's lifecycle round-trip: navigate re-points, close removes + enumerates out", async () => {
    const document = new FakeDocument();
    const port = createWebBrowserHostPort({
      environment: makeBrowserEnvironment({ document }),
      clock: { now: () => 5_000 },
    });
    const session = await port.open(OPEN);
    await session.navigate("https://provider.example/watch/2");
    expect(document.frames[0]!.src).toBe("https://provider.example/watch/2");
    expect(port.sessions()[0]!.url).toBe("https://provider.example/watch/2");
    await session.close();
    expect(document.frames[0]!.attached).toBe(false);
    expect(port.sessions()).toEqual([]);
  });

  it("J08's honest CAPABILITY TRUTH: the rendered mount answers Constrained where the DOM is absent", () => {
    const rendered = webSurfaceCapabilityTruth({ document: null });
    expect(rendered.mount).toBe("rendered");
    expect(rendered.constrained).toBe(true);
    expect(rendered.cookieIsolation).toBe("opaque-origin-sandbox");
    expect(rendered.navigationObservation).toBe("host-commands-only");
    expect(rendered.constraint).toContain("no DOM");
    expect(rendered.constraint).toContain("Constrained");

    const dom = webSurfaceCapabilityTruth({ document: new FakeDocument() });
    expect(dom.mount).toBe("dom");
    expect(dom.constrained).toBe(false);
    expect(dom.constraint).toContain("live sandboxed iframes");
  });

  it("the booted host's port answers its own capability truth (rendered in the test context)", async () => {
    const host = await bootHost();
    const truth = host.browserHost.surfaceCapabilityTruth();
    expect(truth.cookieIsolation).toBe("opaque-origin-sandbox");
    expect(truth.navigationObservation).toBe("host-commands-only");
  });
});
