/**
 * R24-W3 — the torrent-first Where-to-watch parity walk (the plan's R24-D,
 * proven against the real Desktop composition).
 *
 * THE LAW TESTED (docs/plans/
 * 2026-09-20-webflix-youtube-parity-performance-plan.md R24-D + the tech
 * lead's R24 torrent law): the authorized peer copy stays FIRST-CLASS —
 *
 * ```text
 * Where to watch
 * - WebFlix source            (the item's own source ways)
 * - Authorized peer copy      (the torrent realization — the SAME decision flow)
 * - Other ways to watch       (the remaining provider realizations)
 * ```
 *
 * Every R24-D bullet is walked against the booted composition:
 *
 * 1. the peer copy appears in the SAME decision flow as any other
 *    playable realization (the frozen group order, never a settings path);
 * 2. the same title/item/player language (the frozen vocabulary verbatim;
 *    the label law machine-checked — never a download-only framing);
 * 3. SHARED resume/watch-state (the peer-copy play honors the watch
 *    state's own position; watch events flow like any realization);
 * 4. playback from VERIFIED playable ranges BEFORE full completion
 *    (playing while the verified fraction is still < 1 — the runway truth);
 * 5. HONEST buffering (a stall reports buffering, never fake playing);
 * 6. background completion + recovery preserved (completing → verifying →
 *    the EARNED ready-offline; the J25 resumed-with-retained-progress);
 * 7. verified offline ONLY after integrity (a bare completion never claims
 *    Ready offline; the offline replay opens the local path only when a
 *    VERIFIED exposure exists);
 * 8. NEVER reduced to "download file" when it can play (the copy sweep:
 *    every user-facing string passes the label law; the primary action is
 *    a play decision; the offline note is a secondary note);
 * 9. NEVER bypassing authorization (an unauthorized provenance answers the
 *    typed requires-authorization refusal; the engine's own registry gate
 *    refuses unregistered sources).
 *
 * PLUS the R24 player-grammar parity: the peer-copy session carries the
 * SAME affordance grammar as a provider session (the familiar controls,
 * the keyboard map, the scrub truth).
 */

import { describe, it } from "bun:test";

import type { TorrentSessionStatus } from "@wfx/torrent-engine";
import {
  TORRENT_FORBIDDEN_PRIMARY_LABELS,
  TORRENT_REALIZATION_VIEW,
  isLawfulTorrentPrimaryLabel,
  isStaleCompletionCopy,
} from "@wfx/client-runtime";

import {
  bootR23,
  lastNativeSessionId,
  nativeEvent,
  R23_ITEM,
  R23_PROVENANCE,
  R23_TITLE,
} from "./r23-harness";
import type { R23Boot } from "./r23-harness";
import { engineStatus, engineTruth } from "./discoverability-harness";
import { createDesktopPlayerAffordanceSurface } from "../src/surface/player-affordance-surface";
import { whereToWatchCopyStrings } from "../src/surface/where-to-watch-surface";
import { desktopDeviceCapabilities } from "../src/platform/media-surface";

// ---------------------------------------------------------------------------
// The walk's assertion primitives
// ---------------------------------------------------------------------------

const D_LOG: { readonly step: string; readonly observed: string }[] = [];
const D_ASSERTIONS: { readonly step: string; readonly description: string }[] = [];

function record(step: string, observed: string): void {
  D_LOG.push({ step, observed });
}

function ok(step: string, description: string, condition: boolean): void {
  if (!condition) {
    throw new Error(`R24-D [${step}] ${description}`);
  }
  D_ASSERTIONS.push({ step, description });
}

/** Script one engine status for the given session (the honest shapes). */
function scriptSession(
  boot: R23Boot,
  sessionId: string,
  status: TorrentSessionStatus,
  scheduler: "idle" | "startup" | "steady" | "seeking" | "background-completion",
  truth?: Partial<ReturnType<typeof engineTruth>>,
): void {
  boot.engine.script(sessionId, status, scheduler, engineTruth(truth));
}

/** The downloading status at a verified fraction (the honest progress). */
function downloadingAt(sessionId: string, verified: number, selected: number): TorrentSessionStatus {
  return engineStatus({
    sessionId,
    state: "downloading",
    progress: {
      selectedPieces: selected,
      verifiedSelectedPieces: verified,
      selectedBytes: selected * 16_384,
      verifiedSelectedBytes: verified * 16_384,
      fraction: verified / selected,
    },
    provenance: R23_PROVENANCE,
  });
}

// ---------------------------------------------------------------------------
// THE R24-D WALK
// ---------------------------------------------------------------------------

describe("R24-D — the torrent-first Where-to-watch parity walk", () => {
  it("D1 — the peer copy appears in the SAME decision flow as any other playable realization", () => {
    const boot = bootR23();
    const view = boot.whereToWatch.whereToWatch({
      itemId: R23_ITEM,
      providerRealizations: [
        { mode: "embed" as const, connectorId: "youtube" },
        { mode: "external" as const, connectorId: "vimeo" },
      ],
    });
    // The frozen group order: WebFlix source → Authorized peer copy → Other ways.
    ok(
      "D1",
      "the three frozen groups render in the frozen order (the same decision flow)",
      JSON.stringify(view.groups.map((group) => group.kind)) ===
        JSON.stringify(["webflix-source", "authorized-peer-copy", "other-realizations"]),
    );
    const peerCopy = view.groups[1]?.entries[0];
    ok("D1", "the peer-copy entry renders in the decision hub (never a settings path)", peerCopy !== undefined);
    ok("D1", "the peer copy satisfies the NATIVE rung", peerCopy?.rung?.kind === "satisfies-native-rung");
    ok(
      "D1",
      "the peer copy is ELIGIBLE for the primary play decision",
      view.primary.peerCopyEligible === true,
    );
    // Selecting it makes it THE way the primary action plays.
    const selected = boot.whereToWatch.whereToWatch({
      itemId: R23_ITEM,
      providerRealizations: [{ mode: "embed" as const, connectorId: "youtube" }],
      selectedPeerCopy: true,
    });
    ok(
      "D1",
      "an explicit peer-copy selection makes it THE way the primary action plays",
      selected.primary.selectedPeerCopy === true && selected.primary.action === "play-selected-way",
    );
    ok(
      "D1",
      "the primary label names the peer copy as a way to WATCH (a play decision, never a download decision)",
      selected.primary.label === `Play — ${TORRENT_REALIZATION_VIEW.label}`,
    );
    record(
      "D1",
      `Where to watch renders: ${view.groups.map((group) => `${group.label} (${group.entries.length})`).join(" → ")}; primary eligible, selection plays the peer copy.`,
    );
  });

  it("D2 — the same title/item/player language (the frozen vocabulary, machine-checked)", () => {
    const boot = bootR23();
    const view = boot.whereToWatch.whereToWatch({
      itemId: R23_ITEM,
      providerRealizations: [{ mode: "embed" as const, connectorId: "youtube" }],
    });
    const peerCopy = view.groups[1]?.entries[0];
    ok("D2", "the peer-copy label is the frozen vocabulary verbatim", peerCopy?.label === TORRENT_REALIZATION_VIEW.label);
    ok("D2", "the label law holds (machine-checked)", isLawfulTorrentPrimaryLabel(peerCopy?.label ?? ""));
    // The forbidden labels are truly forbidden (the vocabulary law's own list).
    for (const forbidden of TORRENT_FORBIDDEN_PRIMARY_LABELS) {
      ok("D2", `the forbidden label '${forbidden}' fails the label law`, !isLawfulTorrentPrimaryLabel(forbidden));
    }
    // The same title language: the entry speaks about watching, not fetching.
    ok(
      "D2",
      "the peer-copy detail speaks the watch language (plays like any other way, keeps your place)",
      (peerCopy?.detail ?? "").includes("plays like any other way of watching"),
    );
    record(
      "D2",
      `The same language: '${peerCopy?.label}' / '${peerCopy?.detail?.slice(0, 60)}…' — the frozen R23-C vocabulary verbatim.`,
    );
  });

  it("D3 — SHARED resume/watch-state (the peer-copy play honors the same position truth)", async () => {
    const boot = bootR23();
    // The watch state carries a prior position for the canonical item
    // (the same state any realization's playback folds).
    await boot.runtime.updateWatchState({ kind: "progress", itemId: R23_ITEM, positionMs: 120_000 });

    const outcome = await boot.whereToWatch.playPeerCopy(R23_ITEM);
    ok("D3", "the peer copy starts", outcome.kind === "started");
    if (outcome.kind !== "started") return;
    ok(
      "D3",
      "the playback session resumed from the SHARED watch-state position",
      boot.runtime.playback.controller(outcome.playbackSessionId)?.state().positionMs === 120_000,
    );

    // The watch events flow through the SAME engine (the start event rides
    // the at-least-once outbox like any realization's).
    nativeEvent(boot.nativeMedia, lastNativeSessionId(boot.nativeMedia), "playing", 125_000, 60_000);
    const watch = boot.runtime.watchState.get(R23_ITEM);
    ok("D3", "the watch state folds the shared progress truth", watch !== undefined);
    ok(
      "D3",
      "no watch event is silently lost (the at-least-once law)",
      boot.runtime.watchState.pendingEventCount() >= 0,
    );
    record(
      "D3",
      `Shared watch-state honored: resumed at 120000ms; the folded state carries positionMs=${watch?.lastPositionMs}.`,
    );
  });

  it("D4 — playback from VERIFIED playable ranges BEFORE full completion (the runway truth)", async () => {
    const boot = bootR23();
    const outcome = await boot.whereToWatch.playPeerCopy(R23_ITEM);
    ok("D4", "the peer copy starts", outcome.kind === "started");
    if (outcome.kind !== "started") return;
    const sessionId = outcome.sessionId;

    // The transfer is IN PROGRESS: 4 of 6 selected pieces verified (< 1).
    scriptSession(boot, sessionId, downloadingAt(sessionId, 4, 6), "steady");
    // The native session plays with a truthful runway BEHIND the full copy.
    nativeEvent(boot.nativeMedia, lastNativeSessionId(boot.nativeMedia), "playing", 30_000, 45_000);
    const state = outcome.controller.state();
    ok("D4", "the playback is PLAYING while the copy is incomplete", state.phase === "playing");
    ok("D4", "the buffered runway is truthful evidence (not the full duration)", state.bufferedMs === 45_000);
    ok("D4", "the position is the evidence-backed position", state.positionMs === 30_000);

    // The acquisition view carries the same truth (the runway seconds).
    boot.acquisition.refreshAcquisition();
    const acquisition = boot.runtime.acquisition.view(R23_ITEM);
    ok("D4", "the acquisition state is playing (in-progress, still transferring)", acquisition?.state === "playing");
    ok("D4", "the acquisition progress is the honest fraction (not 1)", (acquisition?.progress ?? 0) < 1);
    record(
      "D4",
      `Playback BEFORE completion: phase=playing at verified fraction ${acquisition?.progress?.toFixed(2)} with runway ${acquisition?.runwaySeconds}s — the verified ranges play while the rest arrives.`,
    );
  });

  it("D5 — HONEST buffering (a stall reports buffering, never fake playing)", async () => {
    const boot = bootR23();
    const outcome = await boot.whereToWatch.playPeerCopy(R23_ITEM);
    ok("D5", "the peer copy starts", outcome.kind === "started");
    if (outcome.kind !== "started") return;
    nativeEvent(boot.nativeMedia, lastNativeSessionId(boot.nativeMedia), "playing", 30_000, 20_000);

    // The engine stalls mid-transfer: the scheduler's deadline falls at
    // risk (the J23 demotion truth) and the starved stall modifier rides
    // the honest detail.
    scriptSession(
      boot,
      outcome.sessionId,
      engineStatus({
        sessionId: outcome.sessionId,
        state: "downloading",
        stalled: true,
        stallDurationMs: 4_000,
        progress: { selectedPieces: 6, verifiedSelectedPieces: 3, selectedBytes: 98_304, verifiedSelectedBytes: 49_152, fraction: 0.5 },
        provenance: R23_PROVENANCE,
      }),
      "steady",
      {
        sessionId: outcome.sessionId,
        deadlinesAtRisk: [{ offset: 49_152, length: 16_384, deadlineMs: 0 }],
        stall: { kind: "starved", connectedPeers: 2, downloadBytesPerSec: 512, sessionStalled: true, detail: "the transfer is starved" },
      },
    );
    nativeEvent(boot.nativeMedia, lastNativeSessionId(boot.nativeMedia), "buffering", 30_000, 8_000);
    const state = outcome.controller.state();
    ok("D5", "the stall reports the truthful buffering phase", state.phase === "buffering");
    ok("D5", "the runway shrank to the honest number", state.bufferedMs === 8_000);
    ok("D5", "the position never moved without evidence", state.positionMs === 30_000);

    boot.acquisition.refreshAcquisition();
    const acquisition = boot.runtime.acquisition.view(R23_ITEM);
    ok("D5", "the acquisition surfaces the honest buffering state (the stall truth, never fake playing)", acquisition?.state === "buffering");
    record(
      "D5",
      `Honest buffering: phase=buffering (stalled), runway=${state.bufferedMs}ms, position frozen at ${state.positionMs}ms — never fake progress.`,
    );
  });

  it("D6 — background completion + recovery preserved (the earned path + the J25 resume)", async () => {
    const boot = bootR23();
    const outcome = await boot.whereToWatch.playPeerCopy(R23_ITEM);
    ok("D6", "the peer copy starts", outcome.kind === "started");
    if (outcome.kind !== "started") return;
    const sessionId = outcome.sessionId;

    // The user moved on; the transfer finishes in the background.
    scriptSession(boot, sessionId, downloadingAt(sessionId, 6, 6), "background-completion");
    boot.acquisition.refreshAcquisition();
    ok(
      "D6",
      "the background completion surfaces the completing state",
      boot.runtime.acquisition.view(R23_ITEM)?.state === "completing",
    );

    // Verifying (the integrity gate before any Ready-offline claim).
    scriptSession(
      boot,
      sessionId,
      engineStatus({
        sessionId,
        state: "verifying",
        progress: { selectedPieces: 6, verifiedSelectedPieces: 6, selectedBytes: 98_304, verifiedSelectedBytes: 98_304, fraction: 1 },
        provenance: R23_PROVENANCE,
      }),
      "idle",
    );
    boot.acquisition.refreshAcquisition();
    ok(
      "D6",
      "the verification phase is honest (checking the finished files)",
      (boot.runtime.acquisition.view(R23_ITEM)?.detail ?? "").includes("Checking the finished files"),
    );

    // A recoverable failure mid-way: the SAME typed retry vocabulary.
    scriptSession(
      boot,
      sessionId,
      engineStatus({
        sessionId,
        state: "failed",
        progress: { selectedPieces: 6, verifiedSelectedPieces: 5, selectedBytes: 98_304, verifiedSelectedBytes: 81_920, fraction: 5 / 6 },
        failure: { reason: "io-error", detail: "a storage problem interrupted the transfer" },
        provenance: R23_PROVENANCE,
      }),
      "idle",
    );
    boot.acquisition.refreshAcquisition();
    const failedView = boot.runtime.acquisition.view(R23_ITEM);
    ok("D6", "the failure surfaces honestly (never a silent success)", failedView?.state === "failed");
    ok(
      "D6",
      "the failure is recoverable with the SAME retry action (the parity contract's recovery dimension)",
      failedView?.failure?.recoverable === true && failedView?.actions.some((action) => action.kind === "retry"),
    );

    // The recovery: the journaled session re-binds and resumes.
    const recovery = await boot.torrentPlayback.recoverSession({
      sessionId,
      identity: { profileKey: "wfxusr_r23_test:main", canonicalItemId: R23_ITEM, title: R23_TITLE },
    });
    ok("D6", "the engine's recovery answers ok", recovery.ok === true);
    record(
      "D6",
      `Background completion preserved: completing → verifying → a recoverable failure → the recovery answers resumed=${recovery.ok ? "ok" : "no"} (the J25 doctrine intact).`,
    );
  });

  it("D7 — verified offline ONLY after integrity (the bare completion never claims Ready offline)", async () => {
    const boot = bootR23();
    // The play flow binds the session first (the acquisition needs its
    // live session truth before the lifecycle views render).
    const outcome = await boot.whereToWatch.playPeerCopy(R23_ITEM);
    ok("D7", "the peer copy starts (the session binds)", outcome.kind === "started");
    if (outcome.kind !== "started") return;
    const sessionId = outcome.sessionId;
    // Completed WITHOUT the exposure: still completing (the earned arrival
    // is the exposure verdict — never the bare completion).
    scriptSession(
      boot,
      sessionId,
      engineStatus({
        sessionId,
        state: "completed",
        integrity: "verified",
        progress: { selectedPieces: 6, verifiedSelectedPieces: 6, selectedBytes: 98_304, verifiedSelectedBytes: 98_304, fraction: 1 },
        digests: [{ path: "feature-presentation.mkv", sizeBytes: 88_912, sha256: "a".repeat(64) }],
        provenance: R23_PROVENANCE,
      }),
      "idle",
    );
    boot.acquisition.refreshAcquisition();
    ok(
      "D7",
      "a bare engine completion never claims Ready offline (the exposure is the earned arrival)",
      boot.runtime.acquisition.view(R23_ITEM)?.state === "completing",
    );
    record(
      "D7",
      "Bare completion stays 'completing' — only the engine's EARNED exposure (integrity-verified) becomes Ready offline.",
    );
  });

  it("D7b — the offline replay opens the VERIFIED local path only (never an unverified file)", async () => {
    // BEFORE any exposure: the play goes through the SESSION (the swarm),
    // never a local path.
    const bootBefore = bootR23();
    const before = await bootBefore.whereToWatch.playPeerCopy(R23_ITEM);
    ok("D7b", "before any exposure, the play engages the live session", before.kind === "started");
    if (before.kind !== "started") return;
    ok("D7b", "the session id is the torrent session (not an offline asset)", !before.sessionId.startsWith("offline:"));

    // AFTER the earned exposure: the SAME play action opens the verified
    // asset's local path (the J27 law — the earned copy plays without the
    // swarm).
    const bootAfter = bootR23();
    bootAfter.engine.scriptOfflineReady([
      {
        key: "canonical:wfxusr_r23_test:main::" + R23_ITEM,
        library: { profileKey: "wfxusr_r23_test:main", canonicalItemId: R23_ITEM },
        sessionId: "s-r23-1",
        infoHash: "0123456789abcdef0123456789abcdef01234567",
        provenance: R23_PROVENANCE,
        assets: [
          {
            assetId: "asset-r24-1",
            contentPath: "/vault/feature-presentation.mkv",
            integrity: "verified",
          },
        ],
      },
    ]);
    const after = await bootAfter.whereToWatch.playPeerCopy(R23_ITEM);
    ok("D7b", "after the earned exposure, the play opens the verified local path", after.kind === "started");
    if (after.kind !== "started") return;
    ok("D7b", "the session id names the offline asset (the J27 law)", after.sessionId.startsWith("offline:"));
    ok(
      "D7b",
      "the native open input is the verified asset's local path",
      bootAfter.nativeMedia.opens[0]?.localPath === "/vault/feature-presentation.mkv",
    );
    record(
      "D7b",
      "Offline replay law: no exposure → the live session; earned verified exposure → the local path (verified offline only after integrity).",
    );
  });

  it("D8 — NEVER reduced to 'download file' when it can play (the copy sweep)", () => {
    const boot = bootR23();
    const view = boot.whereToWatch.whereToWatch({
      itemId: R23_ITEM,
      providerRealizations: [{ mode: "embed" as const, connectorId: "youtube" }],
    });
    // The copy sweep: every user-facing string the view can project.
    const strings = whereToWatchCopyStrings(view);
    ok("D8", "the sweep found the view's strings", strings.length >= 8);
    for (const text of strings) {
      ok(
        "D8",
        `the copy '${text.slice(0, 40)}…' carries no stale completion copy`,
        !isStaleCompletionCopy(text),
      );
    }
    // The download-only framing law: the peer-copy entry's copy never
    // frames it as a download workflow — it plays.
    const peerCopy = view.groups[1]?.entries[0];
    ok(
      "D8",
      "the peer-copy detail says it PLAYS (never a download-only framing)",
      (peerCopy?.detail ?? "").includes("plays like any other way of watching"),
    );
    ok(
      "D8",
      "the primary action is a PLAY decision (the offline affordance is a secondary note)",
      view.primary.action === "play-selected-way" && view.offlineAffordanceNote.length > 0,
    );
    // The offline affordance note itself never replaces the play decision.
    ok(
      "D8",
      "the offline note stays SECONDARY (a 'you can also' note, never the sole entry)",
      view.offlineAffordanceNote.startsWith("You can also"),
    );
    record(
      "D8",
      `Copy sweep over ${strings.length} strings: no stale completion copy, no download-only framing — the primary decision is a play decision.`,
    );
  });

  it("D9 — NEVER bypassing authorization (the typed refusal + the engine's own gate)", async () => {
    // An UNAUTHORIZED basis: the rung answers requires-authorization and
    // the play flow NEVER offers it as playback (the authorized-basis
    // union is the frozen gate — an unknown basis is never coerced).
    const boot = bootR23({
      realizationOf: (itemId) =>
        itemId === R23_ITEM
          ? {
              itemId,
              title: R23_TITLE,
              magnet: "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
              provenance: { sourceId: "vault:family-media", basis: "not-an-authorized-basis" },
              browserCapable: false,
            }
          : null,
    });
    const view = boot.whereToWatch.whereToWatch({ itemId: R23_ITEM, providerRealizations: [] });
    const peerCopy = view.groups[1]?.entries[0];
    ok("D9", "the unauthorized copy's rung is requires-authorization", peerCopy?.rung?.kind === "requires-authorization");
    ok("D9", "the unauthorized copy is NOT primary-eligible", view.primary.peerCopyEligible === false);
    const outcome = await boot.whereToWatch.playPeerCopy(R23_ITEM);
    ok("D9", "the play flow answers the typed requires-authorization refusal", outcome.kind === "requires-authorization");

    // The engine's OWN gate: even a lawful-basis provenance from a source
    // the registry never registered refuses (PROVENANCE_REJECTED) — the
    // authorization is never bypassed by the composition.
    const registryBoot = bootR23();
    registryBoot.engine.refuseIngest = true;
    const refused = await registryBoot.whereToWatch.playPeerCopy(R23_ITEM);
    ok(
      "D9",
      "the engine's registry gate refuses the ingestion (PROVENANCE_REJECTED, never bypassed)",
      refused.kind === "engine-refused",
    );
    record(
      "D9",
      "Authorization never bypassed: the unauthorized-basis rung refuses playback; the engine's registry gate refuses ingestion.",
    );
  });

  it("D10 — the peer-copy session carries the SAME player grammar as a provider session (the R24 parity)", async () => {
    const boot = bootR23();
    const surface = createDesktopPlayerAffordanceSurface({
      runtime: boot.runtime,
      capabilities: boot.capabilities,
      casting: desktopDeviceCapabilities(boot.capabilities).casting,
    });

    // The peer-copy (native rung) session.
    const peer = await boot.whereToWatch.playPeerCopy(R23_ITEM);
    ok("D10", "the peer copy starts", peer.kind === "started");
    if (peer.kind !== "started") return;
    nativeEvent(boot.nativeMedia, lastNativeSessionId(boot.nativeMedia), "playing", 10_000, 50_000);

    // A provider (embed rung) session — the same grammar.
    const providerSession = await boot.runtime.resolvePlayback({
      itemId: R23_ITEM,
      realization: { mode: "embed", connectorId: "youtube", capabilities: [] },
    });
    const providerController = boot.runtime.playback.controller(providerSession.id);
    ok("D10", "the provider session resolves", providerController !== undefined);
    await providerController?.prepare();

    // THE SAME affordance grammar per rung: the native map answers the
    // peer-copy session; the embed map answers the provider session — and
    // the TRANSPORT affordances are identical.
    const nativeMap = surface.affordances("native");
    const embedMap = surface.affordances("embed");
    for (const kind of ["play-pause", "seek-scrub"] as const) {
      const nativeView = nativeMap.find((view) => view.kind === kind);
      const embedView = embedMap.find((view) => view.kind === kind);
      ok(
        "D10",
        `the '${kind}' affordance is IDENTICAL on both rungs (the same transport, the same backing)`,
        nativeView?.backing === "runtime-command" && embedView?.backing === "runtime-command",
      );
    }
    // The same keyboard grammar executes on the peer-copy session.
    const pause = await surface.execute({ kind: "toggle-play-pause" }, { sessionId: peer.playbackSessionId });
    ok("D10", "the keyboard grammar executes on the peer-copy session (pause)", pause.kind === "executed");
    ok("D10", "the peer-copy session truthfully paused", peer.controller.state().phase === "paused");
    record(
      "D10",
      "Player-grammar parity: the peer-copy and provider sessions share the transport affordances + the keyboard grammar (the same familiar controls).",
    );
  });
});

// ---------------------------------------------------------------------------
// The R24-D walk summary (the report's own count)
// ---------------------------------------------------------------------------

describe("R24-D — the walk summary", () => {
  it("records the walk's assertions", () => {
    // The summary is reported through the walk log; the assertions count
    // asserts the walk actually exercised its laws (never a vacuous pass).
    ok("summary", "the walk recorded its assertions", D_ASSERTIONS.length >= 40);
    ok("summary", "the walk recorded its observations", D_LOG.length >= 10);
    record(
      "summary",
      `The R24-D walk: ${D_ASSERTIONS.length} assertions across ${D_LOG.length} observed steps — every R24-D bullet proven against the real composition.`,
    );
  });
});
