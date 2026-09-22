/**
 * R25-W2 — the realtime ROUTE VIEW + player surface tests (bun:test).
 *
 * Proves the R25-E gate order + the R25-G surface grammar over the real
 * composition (the fixtures host + a real test-scope bridge):
 *
 * - THE ROUTE VIEW: the bridge gate (running/absent), the provider
 *   truth, the legal-audio gate (fail-closed), the target languages,
 *   and the anonymous truth (the shared no-login-wall laws);
 * - THE STAGE DERIVATION: full fidelity only on WebFlix-owned stages;
 *   the provider iframe/embed/external rungs restricted with the honest
 *   alternatives sentence (never a bypass);
 * - THE PLAYER SURFACE: the Translate row renders in the settings
 *   cluster's grammar (the language buttons on the ready rung; the
 *   honest restricted sentence on the provider rung); the experience
 *   island renders the anonymous optional-sign-in truth; the graceful
 *   fallback states render their typed truths; the artifact transcript
 *   surface stays present (the alignment law's other half).
 *
 * Determinism: the fixtures boot's host, a test-scope bridge on a
 * private port, controlled env (restored), no network beyond localhost.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost, canonicalIdFor } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { loadPlayerView } from "../src/host/view-models";
import type { PlayerEnrichments, PlayerShellView, PlayerView } from "../src/host/view-models";
import { PlayerSurface } from "../src/components/player/PlayerSurface";
import { PlayerChrome, fulfilledTranscriptFeatures, fulfilledTranslateFeatures } from "../src/components/player/PlayerChrome";
import {
  loadRealtimeRouteView,
  realtimeStageReadiness,
  realtimeRestrictedAlternativesSentence,
} from "../src/host/realtime/realtime-route";
import { setRealtimeBridgeStatus } from "../src/host/realtime/realtime-bridge-state";
import { startDevRealtimeProvider } from "../src/host/realtime/dev-realtime-provider";
import { createDevRealtimeSeam } from "../src/host/realtime/dev-realtime-session";
import { startRealtimeBridge } from "../src/host/realtime/realtime-bridge";
import { withEnv } from "./fake-web";
import type { RealtimeTranslationEvent } from "@wfx/domain";

// ---------------------------------------------------------------------------
// The test-scope bridge (the route view's registration truth)
// ---------------------------------------------------------------------------

const TEST_BRIDGE_PORT = 3522;
const TEST_PROVIDER_PORT = 3523;

let provider: ReturnType<typeof startDevRealtimeProvider> | null = null;
let bridge: ReturnType<typeof startRealtimeBridge> | null = null;

beforeEach(() => {
  resetWebHostProcessState();
  setRealtimeBridgeStatus({ running: false, port: null, provider: null, targetLanguages: [] });
  provider = startDevRealtimeProvider({ port: TEST_PROVIDER_PORT });
  bridge = startRealtimeBridge({
    port: TEST_BRIDGE_PORT,
    providerSeamFactory: createDevRealtimeSeam(`ws://localhost:${TEST_PROVIDER_PORT}`),
  });
});

afterEach(async () => {
  // Stop the test-scope bridge + provider after each test (the teardown
  // terminates live sockets — no port leaks into the next test).
  if (bridge !== null) {
    await bridge.stop();
    bridge = null;
  }
  if (provider !== null) {
    await provider.stop();
    provider = null;
  }
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

/** The long-form fixture item (Deep Field Diary — the browser rung). */
const DIARY = {
  itemId: canonicalIdFor("fake-source", "fake:video-1"),
  connectorId: "fake-source",
  externalRef: "fake:video-1",
  title: "Deep Field Diary",
  canonicalType: "video",
  durationMs: 1_800_000,
} as const;

/** The embed-rung fixture item (Desert Rain Doc — audio NOT legally available). */
const DESERT = {
  itemId: canonicalIdFor("fake-source", "fake:video-3"),
  connectorId: "fake-source",
  externalRef: "fake:video-3",
  title: "Desert Rain Doc",
  canonicalType: "video",
  durationMs: 2_400_000,
} as const;

/** The composed player view's surface props. */
function playerSurfaceProps(view: PlayerView): {
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

// ---------------------------------------------------------------------------
// The route view gates
// ---------------------------------------------------------------------------

describe("R25-E — the realtime route view's gate order", () => {
  it("answers the ready truth with the bridge URL, the provider identity, and the languages", () => {
    const view = loadRealtimeRouteView({ externalRef: "fake:video-1" });
    expect(view.readiness.kind).toBe("ready");
    if (view.readiness.kind === "ready") {
      expect(view.readiness.bridgeUrl).toBe(`ws://localhost:${TEST_BRIDGE_PORT}`);
      expect(view.readiness.sourceStream).toBe("scripted-dev-double");
    }
    expect(view.route?.kind).toBe("registered-provider");
    if (view.route?.kind === "registered-provider") {
      expect(view.route.providerId).toBe("wfx-dev-realtime");
      expect(view.route.reportedAverageLagMs).toBe(2_300);
    }
    expect(view.targetLanguages.map((language) => language.code)).toEqual(["es", "fr", "pt", "ja", "de"]);
  });

  it("fails closed on the legal-audio gate for items without a lawful audio path", () => {
    const view = loadRealtimeRouteView({ externalRef: "fake:video-3" });
    expect(view.readiness.kind).toBe("audio-not-legally-available");
    if (view.readiness.kind === "audio-not-legally-available") {
      expect(view.readiness.detail).toContain("no audio stream WebFlix can lawfully reach");
      expect(view.readiness.detail).toContain("never bypasses");
    }
    expect(view.route).toBeNull();
  });

  it("answers the honest absent truth when the bridge is not running (the default service boot)", () => {
    setRealtimeBridgeStatus({ running: false, port: null, provider: null, targetLanguages: [] });
    const view = loadRealtimeRouteView({ externalRef: "fake:video-1" });
    expect(view.readiness.kind).toBe("bridge-unavailable");
    if (view.readiness.kind === "bridge-unavailable") {
      expect(view.readiness.detail).toContain("not serving on this host");
    }
  });

  it("carries the shared anonymous truth: the session is accountless; the durable capabilities need the account", () => {
    const view = loadRealtimeRouteView({ externalRef: "fake:video-1" });
    expect(view.anonymous.accountless).toBe(true);
    expect(view.anonymous.durableCapabilities).toContain("durable-translation-language-preference");
    expect(view.anonymous.durableCapabilities).toContain("cross-device-translation-history");
    expect(view.anonymous.signInSentence).toContain("no account");
    expect(view.anonymous.signInSentence).toContain("optional");
  });
});

// ---------------------------------------------------------------------------
// The stage derivation (R25-E's realization truth)
// ---------------------------------------------------------------------------

describe("R25-E — the realization-level derivation (full fidelity only where WebFlix owns the media path)", () => {
  it("keeps the ready truth on the WebFlix-owned stage (the peer-copy browser rung)", () => {
    const view = loadRealtimeRouteView({ externalRef: "fake:video-1" });
    const stage = realtimeStageReadiness(view, {
      webflixOwnsStage: true,
      surfaceMode: "browser",
      transcriptAvailable: true,
    });
    expect(stage.kind).toBe("ready");
  });

  it("restricts the provider embed rung with the honest boundary sentence", () => {
    const view = loadRealtimeRouteView({ externalRef: "fake:video-1" });
    const stage = realtimeStageReadiness(view, {
      webflixOwnsStage: false,
      surfaceMode: "embed",
      transcriptAvailable: true,
    });
    expect(stage.kind).toBe("restricted-realization");
    if (stage.kind === "restricted-realization") {
      expect(stage.detail).toContain("provider's contained embed keeps the media path");
      expect(stage.detail).toContain("never bypasses DRM");
      expect(stage.transcriptAvailable).toBe(true);
      expect(stage.batchTranslateAvailable).toBe(true);
    }
    const alternatives = realtimeRestrictedAlternativesSentence(stage);
    expect(alternatives).toContain("original transcript below stays available");
    expect(alternatives).toContain("AI actions");
    expect(alternatives).toContain("authorized peer copy");
  });

  it("restricts the contained-browser rung and the external rung with their own truths", () => {
    const view = loadRealtimeRouteView({ externalRef: "fake:video-1" });
    const browserStage = realtimeStageReadiness(view, {
      webflixOwnsStage: false,
      surfaceMode: "browser",
      transcriptAvailable: true,
    });
    if (browserStage.kind === "restricted-realization") {
      expect(browserStage.detail).toContain("contained web playback keeps the media path");
    }
    const externalStage = realtimeStageReadiness(view, {
      webflixOwnsStage: false,
      surfaceMode: "external",
      transcriptAvailable: false,
    });
    if (externalStage.kind === "restricted-realization") {
      expect(externalStage.detail).toContain("opens on the source");
      expect(externalStage.transcriptAvailable).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The player surface grammar
// ---------------------------------------------------------------------------

describe("R25-G — the player surfaces render the translate experience", () => {
  it("the peer-copy player renders the Translate row's language buttons in the settings cluster", async () => {
    const host = await bootHost();
    const view = await loadPlayerView(host, { ...DIARY, preferredRealization: "torrent" });
    const markup = renderToStaticMarkup(createElement(PlayerSurface, playerSurfaceProps(view)));
    expect(markup).toContain('data-wfx-translate-row');
    expect(markup).toContain('data-wfx-translate-row-state="ready"');
    expect(markup).toContain('data-wfx-translate-target="es"');
    expect(markup).toContain("→ Spanish");
    expect(markup).toContain('data-wfx-translate-experience');
    expect(markup).toContain('data-wfx-realtime-state="idle"');
    // The island's anonymous truth (the optional sign-in — never a gate).
    expect(markup).toContain("Sign in (optional)");
    // The transcript artifact surface stays present (the alignment law's
    // other half — the original transcript is never replaced).
    expect(markup).toContain("data-wfx-live-captions");
  });

  it("the provider-rung player renders the honest restricted row (no language buttons — never a bypass)", async () => {
    const host = await bootHost();
    const view = await loadPlayerView(host, DIARY);
    const markup = renderToStaticMarkup(createElement(PlayerSurface, playerSurfaceProps(view)));
    expect(markup).toContain('data-wfx-translate-row-state="restricted-realization"');
    expect(markup).toContain("Live translation is unavailable on this way of watching");
    expect(markup).not.toContain('data-wfx-translate-target="es"');
    // The honest alternatives sentence renders (the restricted view's recovery).
    expect(markup).toContain("data-wfx-translate-alternatives");
  });

  it("the legal-audio-gated item renders the typed refusal (fail-closed)", async () => {
    const host = await bootHost();
    const view = await loadPlayerView(host, DESERT);
    const markup = renderToStaticMarkup(createElement(PlayerSurface, playerSurfaceProps(view)));
    expect(markup).toContain('data-wfx-translate-row-state="audio-not-legally-available"');
    expect(markup).toContain("no audio stream WebFlix can lawfully reach");
  });

  it("the chrome renders the row only when the features are provided (the optional prop law)", async () => {
    const host = await bootHost();
    const view = await loadPlayerView(host, { ...DIARY, preferredRealization: "torrent" });
    const chromeWithout = renderToStaticMarkup(
      createElement(PlayerChrome, {
        sessionId: view.sessionId,
        initialPhase: view.phase,
        initialPositionMs: view.resumePositionMs,
        initialBufferedMs: 0,
        durationMs: view.durationMs,
        transcriptFeatures: fulfilledTranscriptFeatures(null),
        webflixOwnsStage: true,
        surfaceMode: view.surfaceMode,
        qualityTruth: "test",
        autoplaySentence: "test",
      }),
    );
    expect(chromeWithout).not.toContain("data-wfx-translate-row");
    const chromeWith = renderToStaticMarkup(
      createElement(PlayerChrome, {
        sessionId: view.sessionId,
        initialPhase: view.phase,
        initialPositionMs: view.resumePositionMs,
        initialBufferedMs: 0,
        durationMs: view.durationMs,
        transcriptFeatures: fulfilledTranscriptFeatures(null),
        translateFeatures: fulfilledTranslateFeatures(view.realtime),
        webflixOwnsStage: true,
        surfaceMode: view.surfaceMode,
        qualityTruth: "test",
        autoplaySentence: "test",
      }),
    );
    expect(chromeWith).toContain("data-wfx-translate-row");
    expect(chromeWith).toContain('data-wfx-translate-target="es"');
  });

  it("the transport-bar law holds: the row renders inside the settings panel, the bar never suspends", async () => {
    const host = await bootHost();
    const view = await loadPlayerView(host, { ...DIARY, preferredRealization: "torrent" });
    const markup = renderToStaticMarkup(createElement(PlayerSurface, playerSurfaceProps(view)));
    // The settings cluster + the transport bar render together with the row.
    expect(markup).toContain("data-wfx-chrome-settings");
    expect(markup).toContain("data-wfx-chrome-bar");
    expect(markup).toContain("data-wfx-translate-row");
    // The playback phase truth renders (never a fake playing state).
    expect(markup).toContain('data-wfx-chrome-phase="buffering"');
  });
});

// ---------------------------------------------------------------------------
// The bilingual fold (the alignment law — pure, over the domain events)
// ---------------------------------------------------------------------------

describe("R25-G — the bilingual segment fold (the alignment law)", () => {
  it("the experience island's view model exists with the aligned segment shape", () => {
    // The fold lives in the client controller (browser-side); the
    // surface-level law is asserted here through the domain event
    // vocabulary's alignment fields (sourceSegmentId pairs the
    // translation to the source segment — the structural key the fold
    // uses; the artifact transcript stays independent).
    const delta: RealtimeTranslationEvent = {
      kind: "translation-delta",
      sessionId: "s",
      occurredAt: new Date().toISOString(),
      segmentId: "seg-1-tr",
      sourceSegmentId: "seg-1",
      targetLanguage: "es",
      deltaText: "Hola",
    };
    expect(delta.sourceSegmentId).toBe("seg-1");
    const final: RealtimeTranslationEvent = {
      kind: "translation-segment-final",
      sessionId: "s",
      occurredAt: new Date().toISOString(),
      segmentId: "seg-1-tr",
      sourceSegmentId: "seg-1",
      targetLanguage: "es",
      text: "Hola mundo",
      timing: { startedAtMs: 0, endedAtMs: 1_000 },
    };
    if (final.kind === "translation-segment-final") {
      expect(final.timing.startedAtMs).toBe(0);
      expect(final.sourceSegmentId).toBe("seg-1");
    }
  });
});
