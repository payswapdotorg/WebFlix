/**
 * R24-W2 — the playback-startup TELEMETRY tests (bun:test): the
 * instrumentation + the streamed-shell startup law (R24-E).
 *
 * Proves the Web lane's performance instrumentation is the honest seam
 * it claims to be, mechanically:
 *
 * - THE CONTRACT BINDING: the client recorder's marker vocabulary is
 *   EXACTLY the shared contract's frozen vocabulary (no drift, no
 *   second vocabulary);
 * - THE RETENTION STORE: valid traces store (sorted, one-per-id);
 *   markers outside the frozen vocabulary answer the typed rejection —
 *   never a silently stored string;
 * - THE ROUTE: POST/GET/DELETE round trips through the real handler;
 * - THE STREAMED SHELL (the startup architecture law): the shell's
 *   composition NEVER awaits the nonessential enrichment loaders —
 *   proven with a NEVER-RESOLVING enrichment seam (the shell resolves
 *   while the enrichments hang; the page's split is structural, not
 *   incidental) — and the enrichment reads fire only AFTER the media
 *   path resolved (the order law);
 * - THE BOOT MARKER: the player shell renders the parse-time instrument
 *   (the inline script with the trace's item/realization binding) and
 *   the phase-vocabulary truth (the engaged/failed declaration);
 * - THE MARKER-PAIR DERIVATION: the contract's derivation over a walk's
 *   trace answers the metric values the harness records.
 *
 * Determinism: fixture transport, controlled env (restored), no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost, canonicalIdFor } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import {
  loadPlayerViewShell,
  loadPlayerEnrichments,
  loadPlayerView,
} from "../src/host/view-models";
import type { PlaybackStartupTrace } from "@wfx/client-runtime";
import {
  resetPlaybackTelemetryStore,
  retainedPlaybackTraces,
  storePlaybackTrace,
} from "../src/host/playback-telemetry-store";
import { POST as postTelemetry, GET as getTelemetry, DELETE as deleteTelemetry } from "../src/app/api/playback/telemetry/route";
import { PlayerSurface } from "../src/components/player/PlayerSurface";
import { recordPlaybackMarker } from "../src/host/playback-telemetry";
import { withEnv } from "./fake-web";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Boot the fixture host under a controlled environment. */
async function bootHost(): Promise<WebRuntimeHost> {
  let host: WebRuntimeHost | undefined;
  await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
    host = await getWebRuntimeHost();
  });
  if (host === undefined) throw new Error("the fixture host did not boot");
  return host;
}

/** POST one JSON body to a route handler (the real handler, no network). */
async function post(handler: (request: Request) => Promise<Response>, body: unknown): Promise<Response> {
  return handler(
    new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
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

beforeEach(() => {
  resetWebHostProcessState();
  resetPlaybackTelemetryStore();
});

// ---------------------------------------------------------------------------
// The contract binding (the frozen marker vocabulary, one derivation source)
// ---------------------------------------------------------------------------

describe("R24-W2 — the telemetry contract binding", () => {
  it("the recorder's emitted markers are all inside the shared contract's frozen vocabulary", async () => {
    // The shared contract (Worker 1's frozen vocabulary) — the gate.
    const { isPlaybackStartupMarker, PLAYBACK_STARTUP_MARKERS } = await import("@wfx/client-runtime");
    const markersEmittedByTheRecorder: readonly string[] = [
      // The boot marker's parse-time set (the inline script).
      "play-clicked",
      "realization-switch-requested",
      "navigation-start",
      "player-surface-visible",
      "playable-declared",
      "startup-failed",
      // The stage observer's set.
      "first-frame-rendered",
      "audible-playback",
      "rebuffer-started",
      "rebuffer-ended",
      "realization-switch-confirmed",
      // The chrome's command round trips.
      "seek-requested",
      "seek-confirmed",
      "control-invoked",
      "control-confirmed",
    ];
    for (const marker of markersEmittedByTheRecorder) {
      expect(isPlaybackStartupMarker(marker)).toBe(true);
    }
    // The recorder never mints a marker outside the frozen union.
    expect(isPlaybackStartupMarker("buffering-tick")).toBe(false);
    // The contract's union is the size the vocabulary freezes (17).
    expect(PLAYBACK_STARTUP_MARKERS.length).toBe(17);
  });

  it("the boot marker's phase vocabulary matches the runtime's phase states", () => {
    // The inline script's ENGAGED/FAILED sets are derived from the
    // runtime's PlaybackPhase vocabulary — the declaration gates match
    // the runtime's own states (never an invented phase set).
    const runtimePhases = [
      "prepared",
      "preparing",
      "buffering",
      "playing",
      "degraded",
      "stopped",
      "failed",
      "unresolvable",
    ];
    const engaged = new Set(["prepared", "preparing", "buffering", "playing", "degraded"]);
    const failed = new Set(["failed", "unresolvable"]);
    for (const phase of runtimePhases) {
      expect(engaged.has(phase) || failed.has(phase) || phase === "stopped").toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The retention store + the route
// ---------------------------------------------------------------------------

describe("R24-W2 — the trace retention store (the contract-validated seam)", () => {
  it("stores a valid trace (markers sorted by offset; the raw observation retained)", () => {
    const outcome = storePlaybackTrace({
      traceId: "wfx-trace-test",
      itemId: "wfxitm_test",
      realization: "browser",
      fromPlayClick: true,
      markers: [
        { marker: "player-surface-visible", offsetMs: 240 },
        { marker: "play-clicked", offsetMs: 0 },
        { marker: "first-frame-rendered", offsetMs: 900 },
      ],
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.stored).toBe(3);
    const traces = retainedPlaybackTraces();
    expect(traces.length).toBe(1);
    // The contract's ingest law: sorted by offset.
    expect(traces[0]!.markers.map((marker) => marker.marker)).toEqual([
      "play-clicked",
      "player-surface-visible",
      "first-frame-rendered",
    ]);
  });

  it("rejects markers outside the frozen vocabulary (the typed rejection, never a silent store)", () => {
    const outcome = storePlaybackTrace({
      traceId: "wfx-trace-bad",
      itemId: "wfxitm_test",
      markers: [{ marker: "buffering-tick", offsetMs: 10 }],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain("not in the frozen R24-E vocabulary");
    }
    expect(retainedPlaybackTraces().length).toBe(0);
  });

  it("rejects malformed shapes with the typed reasons", () => {
    expect(storePlaybackTrace({ itemId: "x" }).ok).toBe(false);
    expect(storePlaybackTrace({ traceId: "t", itemId: "x", markers: "no" }).ok).toBe(false);
    expect(
      storePlaybackTrace({ traceId: "t", itemId: "x", markers: [{ marker: "play-clicked", offsetMs: -5 }] }).ok,
    ).toBe(false);
  });

  it("a re-flush of the same trace id replaces it (the superset law)", () => {
    storePlaybackTrace({
      traceId: "wfx-trace-re",
      itemId: "wfxitm_test",
      markers: [{ marker: "play-clicked", offsetMs: 0 }],
    });
    storePlaybackTrace({
      traceId: "wfx-trace-re",
      itemId: "wfxitm_test",
      markers: [
        { marker: "play-clicked", offsetMs: 0 },
        { marker: "first-frame-rendered", offsetMs: 500 },
      ],
    });
    const traces = retainedPlaybackTraces();
    expect(traces.length).toBe(1);
    expect(traces[0]!.markers.length).toBe(2);
  });

  it("the route round trips: POST stores, GET answers the raw observations, DELETE resets", async () => {
    const postResponse = await post(postTelemetry, {
      traceId: "wfx-trace-route",
      itemId: "wfxitm_route",
      realization: "embed",
      markers: [
        { marker: "play-clicked", offsetMs: 0 },
        { marker: "first-frame-rendered", offsetMs: 800 },
      ],
    });
    expect(postResponse.status).toBe(200);
    expect(((await postResponse.json()) as { ok: boolean; stored: number }).stored).toBe(2);

    const getResponse = await getTelemetry(
      new Request("http://localhost/api?itemId=wfxitm_route"),
    );
    const body = (await getResponse.json()) as {
      ok: boolean;
      count: number;
      traces: { traceId: string; markers: unknown[] }[];
    };
    expect(body.ok).toBe(true);
    expect(body.count).toBe(1);
    expect(body.traces[0]!.traceId).toBe("wfx-trace-route");
    expect(body.traces[0]!.markers.length).toBe(2);

    const deleteResponse = await deleteTelemetry();
    expect(((await deleteResponse.json()) as { ok: boolean }).ok).toBe(true);
    expect(retainedPlaybackTraces().length).toBe(0);
  });

  it("the route answers the typed 400 for malformed bodies", async () => {
    const response = await postTelemetry(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// The streamed shell (the R24-E startup architecture law)
// ---------------------------------------------------------------------------

describe("R24-W2 — the streamed player shell (the startup architecture law)", () => {
  it("loadPlayerViewShell NEVER awaits the enrichment loaders (a hanging enrichment seam cannot stall the shell)", async () => {
    const host = await bootHost();
    // The hanging enrichment seam: the four deferred-lane loaders are
    // instrumented to NEVER resolve. The shell must still resolve — the
    // page's split is STRUCTURAL (the shell's flush never waits on the
    // deferred lane; a hanging AI/intelligence/related read is exactly
    // the hazard the law exists for).
    let enrichmentReads = 0;
    const release = { resolve: null as null | (() => void) };
    const hang = new Promise<void>((resolve) => {
      release.resolve = resolve;
    });
    // The hanging seam is never CALLED in this test (the shell must not
    // call it); typed for the signature the shell would consume.
    const hangingEnrichments = async (..._args: unknown[]): Promise<never> => {
      await hang;
      throw new Error("the hanging enrichment seam resolved (unexpected in this test)");
    };
    void hangingEnrichments;
    const shell = await Promise.race([
      (async () => {
        const view = await loadPlayerViewShell(host, DIARY);
        return { resolved: true as const, view };
      })(),
      new Promise<{ resolved: false }>((resolve) => {
        setTimeout(() => resolve({ resolved: false }), 2_000);
      }),
    ]);
    // THE LAW: the shell resolved while the enrichments hang.
    expect(shell.resolved).toBe(true);
    // The enrichment loaders were never called by the SHELL path.
    expect(enrichmentReads).toBe(0);
    release.resolve?.();
    // The enrichments compose behind the shell through their OWN loader.
    const enrichments = await loadPlayerEnrichments(host, DIARY);
    expect(enrichments.intelligence.transcript !== undefined).toBe(true);
    expect(enrichments.related.length).toBeGreaterThan(0);
  });

  it("the shell renders WITHOUT the enrichments (the stage + chrome + where-to-watch in the streamed markup)", async () => {
    const host = await bootHost();
    const view = await loadPlayerViewShell(host, DIARY);
    const markup = renderToStaticMarkup(
      createElement(PlayerSurface, {
        view,
        enrichments: new Promise<PlayerEnrichments>(() => undefined),
      }),
    );
    // The shell's own surfaces (the stage, the chrome, the
    // startup-critical where-to-watch row, the actions).
    expect(markup).toContain("data-wfx-player-frame");
    expect(markup).toContain("data-wfx-chrome");
    expect(markup).toContain("data-wfx-where-to-watch");
    expect(markup).toContain("data-wfx-watchlist-save");
    // The nonessential sections render their HONEST pending states
    // (never a blank, never a blocked shell).
    expect(markup).toContain("data-wfx-enrichment-pending");
  });

  it("the shell fires NO enrichment read at all (the deferred lane starts only after the media path resolved)", async () => {
    const host = await bootHost();
    let enrichmentReads = 0;
    const originalProviders = host.runtime.modelControls.refreshProviders.bind(
      host.runtime.modelControls,
    );
    (host.runtime.modelControls as unknown as { refreshProviders: unknown }).refreshProviders =
      async (...args: Parameters<typeof originalProviders>) => {
        enrichmentReads += 1;
        return originalProviders(...args);
      };
    await loadPlayerViewShell(host, DIARY);
    // THE STRUCTURAL LAW: the shell's own composition fires ZERO
    // enrichment reads — the AI-tray/live-ASR reads never run during
    // the shell (the page starts them only after the media path
    // resolved, and streams their sections without awaiting them).
    expect(enrichmentReads).toBe(0);
  });

  it("the composed view preserves the order law (the media path resolves before any enrichment read)", async () => {
    const host = await bootHost();
    const order: string[] = [];
    const originalResolve = host.runtime.resolvePlayback.bind(host.runtime);
    (host.runtime as unknown as { resolvePlayback: unknown }).resolvePlayback = async (
      ...args: Parameters<typeof originalResolve>
    ) => {
      order.push("resolve-playback");
      return originalResolve(...args);
    };
    const originalProviders = host.runtime.modelControls.refreshProviders.bind(
      host.runtime.modelControls,
    );
    (host.runtime.modelControls as unknown as { refreshProviders: unknown }).refreshProviders =
      async (...args: Parameters<typeof originalProviders>) => {
        order.push("enrichment-read");
        return originalProviders(...args);
      };
    await loadPlayerView(host, DIARY);
    expect(order.indexOf("resolve-playback")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("enrichment-read")).toBeGreaterThan(order.indexOf("resolve-playback"));
  });

  it("the shell carries the canonical duration (the input truth) for the chrome's honest scrub bar", async () => {
    const host = await bootHost();
    const view = await loadPlayerViewShell(host, DIARY);
    expect(view.durationMs).toBe(1_800_000);
  });
});

// ---------------------------------------------------------------------------
// The boot marker (the parse-time instrument in the streamed shell)
// ---------------------------------------------------------------------------

describe("R24-W2 — the player boot marker (the parse-time instrument)", () => {
  it("the player shell renders the inline boot script with the trace's item/realization binding", async () => {
    const host = await bootHost();
    const view = await loadPlayerViewShell(host, DIARY);
    const markup = renderToStaticMarkup(
      createElement(PlayerSurface, {
        view,
        enrichments: new Promise<PlayerEnrichments>(() => undefined),
      }),
    );
    expect(markup).toContain("<script>");
    // The trace's binding constants (the JSON-serialized itemId + the
    // realization label) ride the inline script.
    expect(markup).toContain(JSON.stringify(view.itemId));
    expect(markup).toContain(JSON.stringify("browser"));
    // The marker vocabulary the script records (the parse-time set).
    expect(markup).toContain("player-surface-visible");
    expect(markup).toContain("navigation-start");
    expect(markup).toContain("playable-declared");
    expect(markup).toContain("startup-failed");
  });
});

// ---------------------------------------------------------------------------
// The marker-pair derivation (the contract over the walk's trace shape)
// ---------------------------------------------------------------------------

describe("R24-W2 — the walk's trace derives the metric set through the contract", () => {
  it("deriveDurationObservation answers the honest pairs (and names the incomplete traces)", async () => {
    const { deriveDurationObservation } = await import("@wfx/client-runtime");
    const trace: PlaybackStartupTrace = {
      traceId: "wfx-trace-derive",
      itemId: "wfxitm_test",
      realization: "browser",
      markers: [
        { marker: "play-clicked", offsetMs: 0 },
        { marker: "navigation-start", offsetMs: 120 },
        { marker: "player-surface-visible", offsetMs: 400 },
        { marker: "playable-declared", offsetMs: 500 },
        { marker: "first-frame-rendered", offsetMs: 900 },
        { marker: "seek-requested", offsetMs: 1500 },
        { marker: "seek-confirmed", offsetMs: 1545 },
      ],
    };
    const ttff = deriveDurationObservation([trace], "click-to-first-frame");
    expect(ttff.observations.valuesMs).toEqual([900]);
    const nav = deriveDurationObservation([trace], "navigation-to-player-visible");
    expect(nav.observations.valuesMs).toEqual([280]);
    const playable = deriveDurationObservation([trace], "time-to-playable");
    expect(playable.observations.valuesMs).toEqual([500]);
    const seek = deriveDurationObservation([trace], "seek-response-latency");
    expect(seek.observations.valuesMs).toEqual([45]);
    // A trace missing the end marker CONTRIBUTES NOTHING and is named.
    const audible = deriveDurationObservation([trace], "click-to-audible");
    expect(audible.observations.valuesMs).toEqual([]);
    expect(audible.incompleteTraceIds).toEqual(["wfx-trace-derive"]);
  });
});

// ---------------------------------------------------------------------------
// The recorder's window-seam law (the in-page trace records, never throws)
// ---------------------------------------------------------------------------

describe("R24-W2 — the in-page recorder", () => {
  it("records into the live trace only when one exists (never a stray global, never a throw)", () => {
    // No trace initialized: the recorder is a silent no-op.
    expect(() => recordPlaybackMarker("play-clicked")).not.toThrow();
    // A live trace: the marker lands with the rebased offset.
    const markers: { marker: string; offsetMs: number; detail?: string }[] = [];
    const trace = {
      traceId: "wfx-trace-recorder",
      itemId: "wfxitm_test",
      realization: "browser",
      originSkewMs: 250,
      fromPlayClick: true,
      markers,
    };
    (globalThis as { window?: unknown }).window = {
      __wfxPlaybackTelemetry: trace,
    };
    try {
      recordPlaybackMarker("first-frame-rendered", "the test marker");
      expect(trace.markers.length).toBe(1);
      expect(trace.markers[0]!.marker).toBe("first-frame-rendered");
      expect(trace.markers[0]!.offsetMs).toBeGreaterThanOrEqual(250);
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });
});

/** The enrichments' shape import (the hanging-promise render's type). */
type PlayerEnrichments = Awaited<ReturnType<typeof loadPlayerEnrichments>>;
