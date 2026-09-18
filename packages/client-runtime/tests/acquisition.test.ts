/**
 * R14 — the acquisition UX seam tests (the state model + mapper + store).
 *
 * The laws proven here (bun:test, pure — no platform, no engine):
 *
 * - THE TRANSITION LAW: every DIRECT edge of the closed graph is exercised
 *   as lawful; every non-edge is rejected; REACHABILITY accepts lawful
 *   multi-step observation jumps and rejects the impossible ones
 *   (`ready-offline` → in-progress, `completing` → `playing`,
 *   `preparing` → `ready-offline`, ...).
 * - THE EARNED LAW: `ready-offline` is produced ONLY by a verified
 *   offline-ready verdict — never by a bare transfer fact, never partial.
 * - THE TRUTHFUL PROGRESS LAW: progress is the passthrough of the honest
 *   fraction (null stays null — never a fabricated number); the paused
 *   modifier never masquerades as a state; the resumed modifier surfaces
 *   RESUMING with the retained fraction (J25 — never fresh).
 * - THE FAILURE LAW: every failure is typed with a table-derived
 *   recoverable/fatal flag; recoverable failures offer the typed RETRY
 *   action; fatal ones never do; the degraded exposure maps to the typed
 *   `offline-copy-missing` failure.
 * - THE IN-PROGRESS MAPPING: the R11 phase × R12 activity table —
 *   preparing/buffering/playing/completing — including the truthful
 *   rebuffer demotion (deadline at risk) and the J23/J24 paths.
 * - THE STORE: the intake enforces the lifecycle law with the TYPED
 *   `InvalidAcquisitionTransitionError` on impossible jumps; reads,
 *   dismissal, and subscriptions behave; malformed facts throw the typed
 *   runtime error.
 * - THE LEAK GUARD: the mapper's EVERY label and detail (all states, all
 *   failure causes) is protocol-free; the guard itself detects the closed
 *   protocol vocabulary.
 */

import { describe, expect, it } from "bun:test";
import type { AcquisitionState } from "@wfx/domain";
import type { AcquisitionStatusView } from "../src/acquisition";

import {
  ACQUISITION_FAILURE_CAUSES,
  ACQUISITION_FAILURE_LABELS,
  ACQUISITION_PROTOCOL_TERMS,
  ACQUISITION_STATES,
  ACQUISITION_STATE_LABELS,
  ALLOWED_ACQUISITION_TRANSITIONS,
  containsAcquisitionProtocolTerminology,
  createAcquisitionStore,
  InvalidAcquisitionTransitionError,
  isLawfulAcquisitionObservation,
  canTransitionAcquisitionState,
  isRecoverableAcquisitionFailure,
  mapAcquisitionStatus,
  RuntimeError,
} from "../src/index";

/** A canonical item id (the facts are library-keyed). */
const ITEM = "wfxitm_00000000000000000000000001";
const ITEM_2 = "wfxitm_00000000000000000000000002";
const ITEM_3 = "wfxitm_00000000000000000000000003";

/** The honest facts of each lifecycle point (protocol-free by type). */
const availableFacts = { itemId: ITEM };
const preparingFacts = {
  itemId: ITEM,
  transfer: { phase: "locating" as const, paused: false, progressFraction: null },
};
const bufferingFacts = {
  itemId: ITEM,
  transfer: { phase: "transferring" as const, paused: false, progressFraction: 0.2 },
  playback: { activity: "starting" as const, runwaySeconds: 0, deadlineAtRisk: false, playableNow: false },
};
const playingFacts = {
  itemId: ITEM,
  transfer: { phase: "transferring" as const, paused: false, progressFraction: 0.5 },
  playback: { activity: "playing" as const, runwaySeconds: 90, deadlineAtRisk: false, playableNow: true },
};
const completingFacts = {
  itemId: ITEM,
  transfer: { phase: "transferring" as const, paused: false, progressFraction: 0.8 },
  playback: { activity: "completing-in-background" as const, runwaySeconds: null, deadlineAtRisk: false, playableNow: true },
};
const readyOfflineFacts = {
  itemId: ITEM,
  offlineReady: { verified: true, degraded: false, assetCount: 1, sizeBytes: 4096, exposedAtMs: 1_700_000_000_000 },
};
const failedFacts = {
  itemId: ITEM,
  failure: { cause: "source-problem" as const, detail: "The download source had a problem." },
};

// ---------------------------------------------------------------------------
// The transition graph
// ---------------------------------------------------------------------------

describe("R14 — the acquisition transition law (the R12 pattern)", () => {
  it("every DIRECT edge of the closed graph is lawful", () => {
    // The exercised edge set (each named for its honest cause):
    const directEdges: readonly [string, AcquisitionState, AcquisitionState][] = [
      // available reaches every honest first observation (async facts).
      ["available→available", "available", "available"],
      ["available→preparing (session created)", "available", "preparing"],
      ["available→buffering (recovered mid-startup)", "available", "buffering"],
      ["available→playing (recovered mid-play — J25)", "available", "playing"],
      ["available→completing (recovered mid-completion)", "available", "completing"],
      ["available→ready-offline (exposure read at boot — J26)", "available", "ready-offline"],
      ["available→failed (start failed instantly)", "available", "failed"],
      // preparing
      ["preparing→preparing (observation update)", "preparing", "preparing"],
      ["preparing→available (cancelled before transfer)", "preparing", "available"],
      ["preparing→buffering (playback declared)", "preparing", "buffering"],
      ["preparing→completing (download without playback — J24)", "preparing", "completing"],
      ["preparing→failed", "preparing", "failed"],
      // buffering
      ["buffering→buffering (still buffering / re-seek)", "buffering", "buffering"],
      ["buffering→available (cancelled)", "buffering", "available"],
      ["buffering→playing (startup window satisfied)", "buffering", "playing"],
      ["buffering→completing (playback stopped)", "buffering", "completing"],
      ["buffering→failed", "buffering", "failed"],
      // playing
      ["playing→playing (progress)", "playing", "playing"],
      ["playing→available (cancelled)", "playing", "available"],
      ["playing→buffering (truthful rebuffer demotion)", "playing", "buffering"],
      ["playing→completing (stopped / asset completed)", "playing", "completing"],
      ["playing→ready-offline (completed + exposed while watching)", "playing", "ready-offline"],
      ["playing→failed", "playing", "failed"],
      // completing
      ["completing→completing (progress)", "completing", "completing"],
      ["completing→available (cancelled)", "completing", "available"],
      ["completing→buffering (playback declared — J23)", "completing", "buffering"],
      ["completing→ready-offline (the EARNED arrival)", "completing", "ready-offline"],
      ["completing→failed (verification refused)", "completing", "failed"],
      // ready-offline (terminal for the attempt; honest degradation only)
      ["ready-offline→ready-offline (no-op)", "ready-offline", "ready-offline"],
      ["ready-offline→failed (the offline verdict degraded)", "ready-offline", "failed"],
      // failed (the typed retry / dismissal / re-earn)
      ["failed→failed (no-op)", "failed", "failed"],
      ["failed→available (dismissed)", "failed", "available"],
      ["failed→preparing (THE TYPED RETRY)", "failed", "preparing"],
      ["failed→ready-offline (re-verified — the re-earn path)", "failed", "ready-offline"],
    ];
    for (const [name, from, to] of directEdges) {
      expect(canTransitionAcquisitionState(from, to)).toBe(true);
      expect(ALLOWED_ACQUISITION_TRANSITIONS[from]).toContain(to);
      void name;
    }
  });

  it("every NON-edge is rejected (the closed graph has no other edges)", () => {
    const totalEdges = Object.values(ALLOWED_ACQUISITION_TRANSITIONS).reduce(
      (sum, targets) => sum + targets.length,
      0,
    );
    let exercised = 0;
    for (const from of ACQUISITION_STATES) {
      for (const to of ACQUISITION_STATES) {
        const lawful = canTransitionAcquisitionState(from, to);
        const listed = ALLOWED_ACQUISITION_TRANSITIONS[from].includes(to);
        expect(lawful).toBe(listed); // the predicate and the table agree
        if (lawful) exercised += 1;
      }
    }
    expect(exercised).toBe(totalEdges); // every table edge was seen
    // The named IMPOSSIBLE jumps (typed errors at the store, below):
    expect(canTransitionAcquisitionState("ready-offline", "preparing")).toBe(false);
    expect(canTransitionAcquisitionState("ready-offline", "buffering")).toBe(false);
    expect(canTransitionAcquisitionState("ready-offline", "playing")).toBe(false);
    expect(canTransitionAcquisitionState("ready-offline", "completing")).toBe(false);
    expect(canTransitionAcquisitionState("completing", "playing")).toBe(false);
    expect(canTransitionAcquisitionState("preparing", "ready-offline")).toBe(false);
    expect(canTransitionAcquisitionState("preparing", "playing")).toBe(false);
  });

  it("the OBSERVATION law: coarse in-progress elisions lawful; out-of-ready-offline impossible", () => {
    // A poll gap may honestly elide IN-PROGRESS steps (documented law):
    expect(isLawfulAcquisitionObservation("buffering", "ready-offline")).toBe(true); // via completing
    expect(isLawfulAcquisitionObservation("preparing", "ready-offline")).toBe(true); // via completing
    expect(isLawfulAcquisitionObservation("completing", "playing")).toBe(true); // via buffering
    expect(isLawfulAcquisitionObservation("preparing", "playing")).toBe(true); // via buffering
    expect(isLawfulAcquisitionObservation("available", "ready-offline")).toBe(true);
    expect(isLawfulAcquisitionObservation("failed", "ready-offline")).toBe(true);
    expect(isLawfulAcquisitionObservation("playing", "playing")).toBe(true);
    // IMPOSSIBLE: nothing leaves ready-offline for an in-progress state —
    // the degradation (`failed`) is never an elided intermediate; it must
    // be OBSERVED, then the retry reported as its own step.
    expect(isLawfulAcquisitionObservation("ready-offline", "preparing")).toBe(false);
    expect(isLawfulAcquisitionObservation("ready-offline", "buffering")).toBe(false);
    expect(isLawfulAcquisitionObservation("ready-offline", "playing")).toBe(false);
    expect(isLawfulAcquisitionObservation("ready-offline", "completing")).toBe(false);
    expect(isLawfulAcquisitionObservation("ready-offline", "available")).toBe(false);
    // Garbage is total-false.
    expect(isLawfulAcquisitionObservation("nonsense" as never, "playing")).toBe(false);
    expect(canTransitionAcquisitionState("nonsense" as never, "playing")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The mapper (the honest fold)
// ---------------------------------------------------------------------------

describe("R14 — mapAcquisitionStatus (the pure fold)", () => {
  it("no facts → available (the honest default)", () => {
    const view = mapAcquisitionStatus(availableFacts);
    expect(view.state).toBe("available");
    expect(view.label).toBe("Available");
    expect(view.progress).toBe(null);
    expect(view.actions.map((a) => a.kind)).toEqual(["acquire"]);
  });

  it("locating / choosing-files → preparing (progress null — honestly unknown)", () => {
    const locating = mapAcquisitionStatus(preparingFacts);
    expect(locating.state).toBe("preparing");
    expect(locating.progress).toBe(null); // NEVER fabricated
    expect(locating.detail).toContain("details");
    const choosing = mapAcquisitionStatus({
      itemId: ITEM,
      transfer: { phase: "choosing-files", paused: false, progressFraction: 0 },
    });
    expect(choosing.state).toBe("preparing");
    expect(choosing.progress).toBe(0);
  });

  it("playback starting/seeking → buffering (the honest pre-play state)", () => {
    const view = mapAcquisitionStatus(bufferingFacts);
    expect(view.state).toBe("buffering");
    expect(view.progress).toBe(0.2);
    expect(view.runwaySeconds).toBe(0);
    const seeking = mapAcquisitionStatus({
      itemId: ITEM,
      transfer: { phase: "transferring", paused: false, progressFraction: 0.4 },
      playback: { activity: "seeking", runwaySeconds: 0, deadlineAtRisk: false, playableNow: false },
    });
    expect(seeking.state).toBe("buffering");
  });

  it("playing with a healthy truth → playing; deadline at risk → the truthful rebuffer demotion", () => {
    const healthy = mapAcquisitionStatus(playingFacts);
    expect(healthy.state).toBe("playing");
    expect(healthy.runwaySeconds).toBe(90);
    const atRisk = mapAcquisitionStatus({
      ...playingFacts,
      playback: { activity: "playing", runwaySeconds: 2, deadlineAtRisk: true, playableNow: true },
    });
    expect(atRisk.state).toBe("buffering"); // R12's honest demotion, surfaced
    expect(atRisk.detail).toContain("pause");
  });

  it("background completion / no playback → completing (J24's honest state)", () => {
    const view = mapAcquisitionStatus(completingFacts);
    expect(view.state).toBe("completing");
    expect(view.progress).toBe(0.8);
    const verifying = mapAcquisitionStatus({
      itemId: ITEM,
      transfer: { phase: "verifying", paused: false, progressFraction: 1 },
    });
    expect(verifying.state).toBe("completing");
    expect(verifying.detail).toContain("Checking");
  });

  it("THE EARNED LAW: ready-offline comes ONLY from the verified offline verdict", () => {
    const view = mapAcquisitionStatus(readyOfflineFacts);
    expect(view.state).toBe("ready-offline");
    expect(view.label).toBe("Ready offline");
    expect(view.offline).toEqual({ assetCount: 1, sizeBytes: 4096, exposedAtMs: 1_700_000_000_000 });
    expect(view.actions.map((a) => a.kind)).toEqual(["play-offline", "reverify-offline"]);
    // A completed transfer WITHOUT the exposure verdict is completing —
    // never ready-offline (verified-before-ready, R13's law).
    const completedNotExposed = mapAcquisitionStatus({
      itemId: ITEM,
      transfer: { phase: "completed", paused: false, progressFraction: 1 },
    });
    expect(completedNotExposed.state).toBe("completing");
    // A PARTIAL transfer is never ready-offline either.
    const partial = mapAcquisitionStatus(completingFacts);
    expect(partial.state).not.toBe("ready-offline");
  });

  it("the DEGRADED exposure → the typed offline-copy-missing failure (recoverable)", () => {
    const view = mapAcquisitionStatus({
      itemId: ITEM,
      offlineReady: { verified: false, degraded: true, assetCount: 1, sizeBytes: 4096, exposedAtMs: 1 },
    });
    expect(view.state).toBe("failed");
    expect(view.failure?.cause).toBe("offline-copy-missing");
    expect(view.failure?.recoverable).toBe(true);
    expect(view.actions.map((a) => a.kind)).toEqual(["retry", "reverify-offline", "dismiss"]);
  });

  it("failures are typed with the table-derived recoverable flag; retry only when recoverable", () => {
    const recoverable = mapAcquisitionStatus(failedFacts);
    expect(recoverable.state).toBe("failed");
    expect(recoverable.failure?.cause).toBe("source-problem");
    expect(recoverable.failure?.recoverable).toBe(true);
    expect(recoverable.actions.map((a) => a.kind)).toEqual(["retry", "dismiss"]);
    const fatal = mapAcquisitionStatus({
      itemId: ITEM,
      failure: { cause: "authorization-revoked", detail: "The source is no longer authorized." },
    });
    expect(fatal.failure?.recoverable).toBe(false);
    expect(fatal.actions.map((a) => a.kind)).toEqual(["dismiss"]); // NO retry for fatal
  });

  it("a live failure is the loudest fact — and names the intact offline copy when one exists", () => {
    const view = mapAcquisitionStatus({
      itemId: ITEM,
      failure: { cause: "source-problem", detail: "The download source had a problem." },
      offlineReady: { verified: true, degraded: false, assetCount: 1, sizeBytes: 4096, exposedAtMs: 2 },
    });
    expect(view.state).toBe("failed");
    expect(view.detail).toContain("offline copy is still verified");
    // Retry stays honest (the failed re-acquisition is recoverable) AND
    // the intact copy stays playable — both axes honest.
    expect(view.actions.map((a) => a.kind)).toEqual(["retry", "play-offline", "dismiss"]);
  });

  it("paused is the honest modifier — never a state (the frozen vocabulary has no paused state)", () => {
    const view = mapAcquisitionStatus({
      itemId: ITEM,
      transfer: { phase: "transferring", paused: true, progressFraction: 0.4 },
    });
    expect(view.state).toBe("completing"); // where it was, paused
    expect(view.paused).toBe(true);
    expect(view.actions.map((a) => a.kind)).toEqual(["resume"]);
  });

  it("J25 — the RESUMED modifier surfaces RESUMING with the retained fraction (never fresh)", () => {
    const view = mapAcquisitionStatus({
      itemId: ITEM,
      transfer: {
        phase: "transferring",
        paused: false,
        progressFraction: 0.67,
        resumed: { retainedFraction: 0.67, pieceMapReused: true },
      },
      playback: { activity: "completing-in-background", runwaySeconds: null, deadlineAtRisk: false, playableNow: true },
    });
    expect(view.state).toBe("completing");
    expect(view.resumed).toBe(true);
    expect(view.retainedFraction).toBe(0.67);
    expect(view.detail).toContain("Resuming where it left off");
    expect(view.detail).toContain("67% already saved");
  });

  it("malformed facts throw the typed RuntimeError (never silent)", () => {
    expect(() => mapAcquisitionStatus({ itemId: "not-canonical" } as never)).toThrow(RuntimeError);
    expect(() =>
      mapAcquisitionStatus({
        itemId: ITEM,
        transfer: { phase: "nonsense", paused: false, progressFraction: null },
      } as never),
    ).toThrow(RuntimeError);
    expect(() =>
      mapAcquisitionStatus({
        itemId: ITEM,
        transfer: { phase: "transferring", paused: false, progressFraction: 1.5 },
      } as never),
    ).toThrow(RuntimeError);
    // verified + degraded are mutually exclusive.
    expect(() =>
      mapAcquisitionStatus({
        itemId: ITEM,
        offlineReady: { verified: true, degraded: true, assetCount: 1, sizeBytes: 1, exposedAtMs: 1 },
      } as never),
    ).toThrow(RuntimeError);
    // a failed session carries no live transfer.
    expect(() =>
      mapAcquisitionStatus({
        itemId: ITEM,
        failure: { cause: "source-problem", detail: "x" },
        transfer: { phase: "transferring", paused: false, progressFraction: 0.1 },
      } as never),
    ).toThrow(RuntimeError);
    // playback requires a transfer.
    expect(() =>
      mapAcquisitionStatus({
        itemId: ITEM,
        playback: { activity: "playing", runwaySeconds: 1, deadlineAtRisk: false, playableNow: true },
      } as never),
    ).toThrow(RuntimeError);
  });
});

// ---------------------------------------------------------------------------
// The store (the runtime's intake + reads)
// ---------------------------------------------------------------------------

describe("R14 — the acquisition store", () => {
  it("report → view/views; the observation law enforced with the TYPED error", () => {
    const store = createAcquisitionStore();
    store.report(readyOfflineFacts);
    expect(store.view(ITEM)?.state).toBe("ready-offline");
    expect(store.views().length).toBe(1);
    // ready-offline → preparing is IMPOSSIBLE (the degradation must be
    // observed first): the typed error, thrown with from/to on it.
    let thrown: unknown;
    try {
      store.report(preparingFacts);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidAcquisitionTransitionError);
    expect((thrown as InvalidAcquisitionTransitionError).from).toBe("ready-offline");
    expect((thrown as InvalidAcquisitionTransitionError).to).toBe("preparing");
    // The store kept its honest view (the impossible report did not land).
    expect(store.view(ITEM)?.state).toBe("ready-offline");
    // ready-offline → failed is lawful (the degraded verdict).
    store.report({
      itemId: ITEM,
      offlineReady: { verified: false, degraded: true, assetCount: 1, sizeBytes: 1, exposedAtMs: 1 },
    });
    expect(store.view(ITEM)?.state).toBe("failed");
    // ...and failed → preparing is the typed retry (lawful).
    store.report(preparingFacts);
    expect(store.view(ITEM)?.state).toBe("preparing");
  });

  it("the coarse poll gap: completing → playing is accepted via the elided buffering step (J23)", () => {
    const store = createAcquisitionStore();
    store.report(completingFacts);
    // The direct predicate rejects the edge (playback passes through
    // buffering) — but a poll gap that elided the buffering step is an
    // honest observation (the observation law accepts it).
    expect(canTransitionAcquisitionState("completing", "playing")).toBe(false);
    store.report(playingFacts);
    expect(store.view(ITEM)?.state).toBe("playing");
  });

  it("the multi-step poll gap is accepted (a lawful path exists)", () => {
    const store = createAcquisitionStore();
    store.report(bufferingFacts);
    // The completion AND the exposure both landed between two polls:
    store.report(readyOfflineFacts);
    expect(store.view(ITEM)?.state).toBe("ready-offline");
  });

  it("the retry law: failed → preparing is lawful; dismissal clears the view", () => {
    const store = createAcquisitionStore();
    store.report(failedFacts);
    store.report(preparingFacts); // the typed retry, accepted
    expect(store.view(ITEM)?.state).toBe("preparing");
    store.report(failedFacts);
    store.clear(ITEM); // the dismissal
    expect(store.view(ITEM)).toBe(null);
    store.clear(ITEM); // idempotent
  });

  it("subscriptions observe changes; unknown ids answer null; malformed facts throw typed", () => {
    const store = createAcquisitionStore();
    const seen: number[] = [];
    const unsubscribe = store.subscribe((views) => {
      seen.push(views.length);
    });
    store.report(availableFacts);
    store.report({ ...availableFacts }); // same state, same detail: no re-publish... (state/detail equal)
    store.report(preparingFacts);
    expect(store.view(ITEM_2)).toBe(null);
    expect(() => store.report({ itemId: "garbage" } as never)).toThrow(RuntimeError);
    unsubscribe();
    store.report({ ...preparingFacts, itemId: ITEM_3, transfer: { phase: "transferring", paused: false, progressFraction: 0.5 } });
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(store.views().length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The protocol leak guard (J21-J25 "No native protocol")
// ---------------------------------------------------------------------------

describe("R14 — the protocol leak guard", () => {
  it("the guard detects every closed protocol term (case-insensitive, word-boundary)", () => {
    for (const term of ACQUISITION_PROTOCOL_TERMS) {
      expect(containsAcquisitionProtocolTerminology(`A sentence mentioning ${term}.`)).toBe(true);
      expect(containsAcquisitionProtocolTerminology(`${term.toUpperCase()} shouted`)).toBe(true);
    }
    expect(containsAcquisitionProtocolTerminology("Preparing your offline copy")).toBe(false);
    expect(containsAcquisitionProtocolTerminology("Verified and available to watch without a connection.")).toBe(false);
    expect(containsAcquisitionProtocolTerminology("")).toBe(false);
  });

  it("EVERY mapper string is protocol-free (all states, all failure causes, all labels)", () => {
    const factsByState: AcquisitionStatusView[] = [
      mapAcquisitionStatus(availableFacts),
      mapAcquisitionStatus(preparingFacts),
      mapAcquisitionStatus(bufferingFacts),
      mapAcquisitionStatus(playingFacts),
      mapAcquisitionStatus({
        ...playingFacts,
        playback: { activity: "playing", runwaySeconds: 1, deadlineAtRisk: true, playableNow: true },
      }),
      mapAcquisitionStatus(completingFacts),
      mapAcquisitionStatus(readyOfflineFacts),
      // every failure cause, recoverable and fatal
      ...ACQUISITION_FAILURE_CAUSES.map((cause) =>
        mapAcquisitionStatus({ itemId: ITEM, failure: { cause, detail: ACQUISITION_FAILURE_LABELS[cause] } }),
      ),
      // the resumed sentence
      mapAcquisitionStatus({
        itemId: ITEM,
        transfer: {
          phase: "transferring",
          paused: false,
          progressFraction: 0.67,
          resumed: { retainedFraction: 0.67, pieceMapReused: true },
        },
        playback: { activity: "completing-in-background", runwaySeconds: null, deadlineAtRisk: false, playableNow: true },
      }),
    ];
    expect(factsByState.length).toBeGreaterThanOrEqual(16);
    for (const view of factsByState) {
      expect(containsAcquisitionProtocolTerminology(view.label)).toBe(false);
      expect(containsAcquisitionProtocolTerminology(view.detail)).toBe(false);
      if (view.failure !== undefined) {
        expect(containsAcquisitionProtocolTerminology(view.failure.label)).toBe(false);
        expect(containsAcquisitionProtocolTerminology(view.failure.detail)).toBe(false);
      }
    }
    for (const label of Object.values(ACQUISITION_STATE_LABELS)) {
      expect(containsAcquisitionProtocolTerminology(label)).toBe(false);
    }
  });

  it("the recoverability table is closed: exactly one fatal cause", () => {
    const fatal = ACQUISITION_FAILURE_CAUSES.filter((cause) => !isRecoverableAcquisitionFailure(cause));
    expect(fatal).toEqual(["authorization-revoked"]);
  });
});

// ---------------------------------------------------------------------------
// The runtime composition (the seam flows through createRuntime)
// ---------------------------------------------------------------------------

describe("R14 — the runtime exposes the acquisition seam", () => {
  it("createRuntime composes runtime.acquisition (the store, live)", async () => {
    const { createRuntime, InMemoryServerPort, makeDesktopCapabilities, FixedClock, SequentialIdGen } =
      await import("../src/index");
    const T0 = Date.parse("2026-09-16T12:00:00.000Z");
    const runtime = createRuntime(
      makeDesktopCapabilities(),
      new InMemoryServerPort(),
      {
        context: { userId: "user-1", sessionId: "sess-1", locale: "en" },
        clock: new FixedClock(T0),
        ids: new SequentialIdGen(),
      },
    );
    expect(typeof runtime.acquisition.report).toBe("function");
    expect(typeof runtime.acquisition.views).toBe("function");
    // The full lifecycle flows through the runtime's own store (J21→J26):
    runtime.acquisition.report(availableFacts);
    runtime.acquisition.report(preparingFacts);
    runtime.acquisition.report(bufferingFacts);
    runtime.acquisition.report(playingFacts);
    runtime.acquisition.report(completingFacts);
    runtime.acquisition.report(readyOfflineFacts);
    expect(runtime.acquisition.view(ITEM)?.state).toBe("ready-offline");
    expect(runtime.acquisition.views().length).toBe(1);
    // The observation law is enforced on the runtime's own store too.
    expect(() => runtime.acquisition.report(preparingFacts)).toThrow(InvalidAcquisitionTransitionError);
  });
});
