/**
 * @wfx/app-desktop — the acquisition facts source, THE R14 DESKTOP SEAM.
 *
 * Derives the shared client runtime's PROTOCOL-FREE `AcquisitionFacts`
 * from the torrent machinery's PUBLIC surfaces — consuming existing
 * exports only, no engine changes (the "consume, don't reinvent" law):
 *
 * - R11 `engine.status(sessionId)` — the honest session states
 *   (`discovering-metadata`/`selecting`/`downloading`/`seeding-paused`/
 *   `verifying`/`completed`/`failed(reason)`) + the truthful progress
 *   fraction (verified/selected pieces — the honest denominator).
 * - R12 `engine.playback.state/truth(sessionId)` — the scheduler activity
 *   (idle/startup/steady/seeking/background-completion) and the truthful
 *   buffering numbers (verified runway seconds, deadlines at risk,
 *   playable-now).
 * - R13 `engine.recover()`'s report — the resume proof (disk-verified
 *   pieces + `pieceMapReused`) that makes the J25 surface RESUMING,
 *   never fresh; and `adapter.listOfflineReady()` — the live-verified
 *   exposures (the ONLY source of `Ready offline`, per the
 *   verified-before-ready law).
 *
 * WHAT THIS MODULE IS: the typed state-mapping seam where both
 * vocabularies meet — the platform adapter (the frozen layering's
 * composition point for native capabilities: Desktop -> Native
 * Capability Ports -> Torrent Engine). The torrent protocol vocabulary
 * (peers/pieces/trackers/rates/infohash) enters ONLY
 * {@link DesktopAcquisitionSource.diagnostics} — the GATED advanced
 * surface — and NEVER the facts reported into `runtime.acquisition`
 * (structurally impossible: the facts type has no protocol fields).
 *
 * HONESTY LAWS KEPT HERE:
 * - NO HIDDEN TIMERS: `refresh()` is the only reporting path — the host
 *   owns cadence (the R10/R12 law). Nothing polls on its own.
 * - NO PROTOCOL STRINGS ON THE DEFAULT SURFACE: the R11 failure details
 *   name pieces/directories — the default surface renders the typed
 *   PROTOCOL-FREE cause sentences (below) and the engine's verbose
 *   detail rides ONLY in the gated diagnostics view.
 * - FAILURE IS THE LOUDEST FACT: a failed session reports the typed
 *   failure facts (the runtime's fold does the rest, including naming an
 *   intact offline copy when one exists).
 * - A session the engine no longer knows (stopped/cancelled) reports the
 *   honest ABSENCE: the item falls back to its exposure verdict or
 *   `available` — never a stale view.
 */

import type {
  AcquisitionDiagnosticsView,
  AcquisitionFacts,
  AcquisitionFailureCause,
  AcquisitionPlaybackFacts,
  AcquisitionTransferFacts,
  ClientRuntime,
} from "@wfx/client-runtime";
import {
  containsAcquisitionProtocolTerminology,
  RuntimeError,
} from "@wfx/client-runtime";
import type {
  OfflineReadyEntry,
  PlaybackBufferingTruth,
  PlaybackSchedulerState,
  TorrentEngine,
  TorrentEngineAdapter,
  TorrentFailureReason,
  TorrentRecoveryReport,
  TorrentResult,
  TorrentSessionStatus,
} from "@wfx/torrent-engine";
import { torrentError } from "@wfx/torrent-engine";

// ---------------------------------------------------------------------------
// The failure-cause mapping (R11 reasons -> user-language causes)
// ---------------------------------------------------------------------------

/** The closed mapping of the R11 failure reasons onto the UX causes. */
export const ACQUISITION_CAUSE_FOR_FAILURE_REASON: Readonly<
  Record<TorrentFailureReason, AcquisitionFailureCause>
> = {
  "metadata-failed": "details-not-found",
  "corruption-detected": "download-corrupted",
  "data-vanished": "saved-progress-lost",
  "io-error": "storage-problem",
  "library-error": "source-problem",
  "verification-failed": "integrity-check-failed",
  "provenance-revoked": "authorization-revoked",
};

/**
 * The PROTOCOL-FREE failure detail sentences (the default surface). The
 * engine's own verbose detail (which may name pieces/paths) rides ONLY
 * in the gated diagnostics view — the leak law. The sentences state the
 * honest retry semantics: a FAILED session re-acquires FRESH (the
 * engine's own guidance for terminal sessions); the RETAINED-progress
 * resume is R13's recovery path (interrupted sessions — the `resumed`
 * proof), never a failed-session retry.
 */
export const ACQUISITION_FAILURE_DETAILS: Readonly<Record<AcquisitionFailureCause, string>> = {
  "details-not-found":
    "The details for this title could not be found right now. You can try again — the source may come back.",
  "download-corrupted":
    "The downloaded data didn't pass its integrity check. Retrying downloads the data again.",
  "saved-progress-lost":
    "The saved progress could not be found on this device, so the download would start fresh. You can try again.",
  "storage-problem":
    "A storage problem interrupted the download. Freeing up space and retrying may fix it.",
  "source-problem": "The download source had a problem. You can try again.",
  "integrity-check-failed":
    "The final integrity check did not pass. Retrying downloads the data again.",
  "offline-copy-missing":
    "The offline copy is no longer on this device. You can download it again, or re-check in case the files return.",
  "authorization-revoked":
    "The source that authorized this download is no longer authorized, so it can't continue.",
};

// ---------------------------------------------------------------------------
// The identity binding (sessions -> the R04 canonical identity)
// ---------------------------------------------------------------------------

/** How a session's target item is known (the R13 exposure composition). */
export interface AcquisitionIdentity {
  /** R04's effective-profile key of the owning profile. */
  readonly profileKey: string;
  /** The canonical item id the acquisition realizes (`wfxitm_…`). */
  readonly canonicalItemId: string;
  /** The display title (the ingestion's own name, when known). */
  readonly title?: string;
}

/**
 * The typed RETRY recipe: how the composition root re-acquires one item
 * after a RECOVERABLE failure (a fresh ingestion + session over the same
 * authorized source — the engine's own guidance for terminal sessions;
 * the retained-progress resume is R13's recovery path, a different flow).
 * Returns the NEW session id.
 */
export type AcquisitionRetryRecipe = () => Promise<{
  ok: true;
  value: { readonly sessionId: string };
} | { ok: false; error: { code: string; detail: string } }>;

// ---------------------------------------------------------------------------
// Options + surface
// ---------------------------------------------------------------------------

/** Options for {@link createDesktopAcquisitionSource}. */
export interface DesktopAcquisitionSourceOptions {
  /** The R11-R13 torrent engine (consumed through its public surface). */
  readonly engine: TorrentEngine;
  /** The R13 narrow-seam adapter (the offline-ready read). */
  readonly adapter: TorrentEngineAdapter;
  /** The runtime whose `acquisition` store receives the derived facts. */
  readonly runtime: ClientRuntime;
}

/** The desktop acquisition facts source (the R14 seam). */
export interface DesktopAcquisitionSource {
  /**
   * Bind a session to the canonical item it realizes (the same R04
   * composition `exposeCompletedSelection` takes — the caller derives it
   * from the library keys when the user starts the acquisition), with
   * the optional typed RETRY recipe (the recoverable-failure path).
   */
  bindSession(
    sessionId: string,
    identity: AcquisitionIdentity,
    retry?: AcquisitionRetryRecipe,
  ): void;
  /** Drop a binding (the attempt was cancelled/removed). Idempotent. */
  unbindSession(sessionId: string): void;
  /**
   * Derive + report the current facts for EVERY bound item and every
   * library-identified exposure (the only reporting path — the host owns
   * cadence; no hidden timers). Optionally ingest a fresh recovery
   * report first (the J25 resume proofs).
   */
  refresh(recovery?: TorrentRecoveryReport): TorrentResult<void>;
  /**
   * Execute the typed RETRY of one item's RECOVERABLE failure: runs the
   * bound recipe (the composition root's fresh re-acquisition), rebinds
   * the new session, and reports the fresh facts. Typed refusals: no
   * bound item, or no recipe (the caller did not wire a retry).
   */
  attemptRetry(itemId: string): Promise<TorrentResult<{ readonly sessionId: string }>>;
  /**
   * THE GATED ADVANCED DIAGNOSTICS of one item (protocol vocabulary —
   * renders ONLY inside the explicitly gated diagnostics surface).
   */
  diagnostics(itemId: string): AcquisitionDiagnosticsView | null;
}

// ---------------------------------------------------------------------------
// The derivation (pure helpers)
// ---------------------------------------------------------------------------

/** Map one R11 session state onto the transfer phase (protocol-free). */
function transferPhaseOf(status: TorrentSessionStatus): AcquisitionTransferFacts["phase"] {
  switch (status.state) {
    case "discovering-metadata":
      return "locating";
    case "selecting":
      return "choosing-files";
    case "downloading":
      return "transferring";
    case "verifying":
      return "verifying";
    case "completed":
      return "completed";
    case "seeding-paused": {
      // The user-paused state keeps its PRE-PAUSE phase: the file list
      // and the honest fraction tell where the transfer stood (the
      // status carries no resume target — the honest approximation).
      if (status.files.length === 0) return "locating";
      return status.progress.fraction >= 1 ? "verifying" : "transferring";
    }
    case "failed":
      return "transferring"; // unreachable for facts (failures report no transfer)
  }
}

/** Map the R12 scheduler state onto the playback activity (protocol-free). */
function playbackActivityOf(scheduler: PlaybackSchedulerState): AcquisitionPlaybackFacts["activity"] {
  switch (scheduler) {
    case "idle":
      return "none";
    case "startup":
      return "starting";
    case "steady":
      return "playing";
    case "seeking":
      return "seeking";
    case "background-completion":
      return "completing-in-background";
  }
}

/** The playback facts of one live session (the R12 truth, verbatim). */
function playbackFactsOf(
  engine: TorrentEngine,
  sessionId: string,
): AcquisitionPlaybackFacts | undefined {
  const state = engine.playback.state(sessionId);
  if (!state.ok) return undefined; // no scheduler truth — the honest absence
  const truth: TorrentResult<PlaybackBufferingTruth> = engine.playback.truth(sessionId);
  const runwaySeconds = truth.ok ? (truth.value.runway?.seconds ?? null) : null;
  const deadlineAtRisk = truth.ok ? truth.value.deadlinesAtRisk.length > 0 : false;
  const playableNow = truth.ok ? truth.value.playableNow : false;
  return {
    activity: playbackActivityOf(state.value),
    runwaySeconds,
    deadlineAtRisk,
    playableNow,
  };
}

/** The offline-ready facts of one exposure entry (the R13 live verdicts). */
function offlineReadyFactsOf(entry: OfflineReadyEntry): {
  verified: boolean;
  degraded: boolean;
  assetCount: number;
  sizeBytes: number;
  exposedAtMs: number;
} | undefined {
  if (entry.assets.length === 0) return undefined; // nothing landed — no verdict
  const verified = entry.assets.every((asset) => asset.integrity === "verified");
  const degraded = entry.assets.some(
    (asset) => asset.integrity === "vanished" || asset.integrity === "failed",
  );
  if (!verified && !degraded) return undefined; // ambiguous verdicts: diagnostics-only
  return {
    verified,
    degraded,
    assetCount: entry.assets.length,
    sizeBytes: entry.assets.reduce((sum, asset) => sum + asset.sizeBytes, 0),
    exposedAtMs: entry.exposedAt,
  };
}

// ---------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------

/** The source's per-item derivation state. */
interface ItemBinding {
  readonly identity: AcquisitionIdentity;
  /** The most recently LIVE session id for this item (the active attempt). */
  sessionId: string | null;
  /** The latest recovery proof for the active session (J25). */
  resumed: { retainedFraction: number; pieceMapReused: boolean } | undefined;
  /** The typed retry recipe (the recoverable-failure path). */
  retry: AcquisitionRetryRecipe | undefined;
}

/**
 * Build the desktop acquisition facts source. Throws the typed
 * `RuntimeError` (`invalid-input`) on a malformed options object.
 */
export function createDesktopAcquisitionSource(
  options: DesktopAcquisitionSourceOptions,
): DesktopAcquisitionSource {
  if (
    typeof options !== "object" ||
    options === null ||
    typeof options.engine !== "object" ||
    options.engine === null ||
    typeof options.adapter !== "object" ||
    options.adapter === null ||
    typeof options.runtime !== "object" ||
    options.runtime === null
  ) {
    throw new RuntimeError(
      "invalid-input",
      "createDesktopAcquisitionSource: expects { engine, adapter, runtime }",
    );
  }
  const { engine, adapter, runtime } = options;
  const bySession = new Map<string, ItemBinding>();

  /** The exposure entry of one canonical item (latest wins; R13's fold). */
  function exposureFor(canonicalItemId: string, profileKey: string): OfflineReadyEntry | undefined {
    const listed = adapter.listOfflineReady();
    if (!listed.ok) return undefined; // the honest absence — diagnostics name the refusal
    return listed.value.find(
      (entry) =>
        entry.library !== undefined &&
        entry.library.canonicalItemId === canonicalItemId &&
        entry.library.profileKey === profileKey,
    );
  }

  /** Derive one item's facts from its live session + exposure verdict. */
  function factsForItem(binding: ItemBinding): AcquisitionFacts {
    const identity = binding.identity;
    const exposure = exposureFor(identity.canonicalItemId, identity.profileKey);
    const offlineReady = exposure !== undefined ? offlineReadyFactsOf(exposure) : undefined;
    const base = {
      itemId: identity.canonicalItemId,
      ...(identity.title !== undefined ? { title: identity.title } : {}),
      ...(offlineReady !== undefined ? { offlineReady } : {}),
    };

    // No live session: the exposure verdict (or its honest absence) answers.
    if (binding.sessionId === null) return base as AcquisitionFacts;

    const status: TorrentResult<TorrentSessionStatus> = engine.status(binding.sessionId);
    if (!status.ok) {
      // The engine no longer knows the session (stopped/removed): the
      // honest absence — never a stale view.
      binding.sessionId = null;
      binding.resumed = undefined;
      return base as AcquisitionFacts;
    }

    // A failed session reports the TYPED failure (the loudest fact).
    if (status.value.state === "failed" && status.value.failure !== undefined) {
      const cause = ACQUISITION_CAUSE_FOR_FAILURE_REASON[status.value.failure.reason];
      return {
        ...base,
        failure: {
          cause,
          detail: ACQUISITION_FAILURE_DETAILS[cause],
        },
      } as AcquisitionFacts;
    }

    // The live-transfer + playback truth (the R11 phase × the R12 activity).
    const transfer: AcquisitionTransferFacts = {
      phase: transferPhaseOf(status.value),
      paused: status.value.state === "seeding-paused",
      progressFraction:
        status.value.progress.selectedPieces > 0
          ? status.value.progress.fraction
          : null, // honestly unknown while nothing is verifiable
      ...(binding.resumed !== undefined ? { resumed: binding.resumed } : {}),
    };
    const playback = playbackFactsOf(engine, binding.sessionId);
    return { ...base, transfer, ...(playback !== undefined ? { playback } : {}) } as AcquisitionFacts;
  }

  return {
    bindSession(
      sessionId: string,
      identity: AcquisitionIdentity,
      retry?: AcquisitionRetryRecipe,
    ): void {
      if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
        throw new RuntimeError("invalid-input", "bindSession: sessionId must be a non-empty string");
      }
      if (typeof identity !== "object" || identity === null) {
        throw new RuntimeError("invalid-input", "bindSession: identity must be an object");
      }
      if (
        typeof identity.profileKey !== "string" ||
        identity.profileKey.trim().length === 0 ||
        typeof identity.canonicalItemId !== "string" ||
        identity.canonicalItemId.trim().length === 0
      ) {
        throw new RuntimeError(
          "invalid-input",
          "bindSession: identity requires non-empty profileKey and canonicalItemId (the R04 composition)",
        );
      }
      // The active attempt for the item is the newest binding.
      for (const binding of bySession.values()) {
        if (
          binding.identity.canonicalItemId === identity.canonicalItemId &&
          binding.identity.profileKey === identity.profileKey &&
          binding.sessionId !== sessionId
        ) {
          binding.sessionId = null; // the older attempt is superseded
          binding.resumed = undefined;
        }
      }
      bySession.set(sessionId, {
        identity: { ...identity },
        sessionId,
        resumed: undefined,
        retry,
      });
    },

    unbindSession(sessionId: string): void {
      const binding = bySession.get(sessionId);
      if (binding !== undefined) {
        binding.sessionId = null;
        binding.resumed = undefined;
      }
      bySession.delete(sessionId);
    },

    async attemptRetry(itemId: string): Promise<TorrentResult<{ readonly sessionId: string }>> {
      let bound: ItemBinding | undefined;
      for (const binding of bySession.values()) {
        if (
          binding.identity.canonicalItemId === itemId &&
          binding.sessionId !== null
        ) {
          bound = binding;
        }
      }
      if (bound === undefined) {
        return torrentError("NOT_FOUND", {
          detail: `attemptRetry: no acquisition session is bound for '${itemId}'`,
        });
      }
      if (bound.retry === undefined) {
        return torrentError("INVALID_STATE", {
          detail:
            `attemptRetry: no retry recipe is bound for '${itemId}' — the composition root owns the ` +
            "re-acquisition logic (a fresh ingestion + session over the same authorized source)",
        });
      }
      const outcome = await bound.retry();
      if (!outcome.ok) {
        return torrentError("LIBRARY_ERROR", {
          detail: `attemptRetry: the retry recipe failed: ${outcome.error.detail}`,
        });
      }
      // Rebind to the fresh attempt (the recipe's session) + report.
      this.bindSession(outcome.value.sessionId, bound.identity, bound.retry);
      this.refresh();
      return { ok: true, value: { sessionId: outcome.value.sessionId } };
    },

    refresh(recovery?: TorrentRecoveryReport): TorrentResult<void> {
      // Ingest the recovery proofs first (the J25 resume facts).
      if (recovery !== undefined) {
        for (const restored of recovery.recovered) {
          const binding = bySession.get(restored.sessionId);
          if (binding === undefined) continue;
          const status = engine.status(restored.sessionId);
          const retainedFraction =
            status.ok && status.value.progress.selectedPieces > 0
              ? restored.diskVerifiedPieces / status.value.progress.selectedPieces
              : 0;
          binding.resumed = {
            retainedFraction: Math.max(0, Math.min(1, retainedFraction)),
            pieceMapReused: restored.pieceMapReused,
          };
        }
      }
      // Report every bound item's CURRENT facts (last-write-wins; the
      // observation law is the runtime store's to enforce).
      for (const binding of bySession.values()) {
        runtime.acquisition.report(factsForItem(binding));
      }
      // Every library-identified exposure WITHOUT a live bound attempt
      // still surfaces (the J26 library read: an exposure outlives its
      // session — restarts included, the journal is the truth).
      const listed = adapter.listOfflineReady();
      if (!listed.ok) return listed;
      const boundItems = new Set(
        [...bySession.values()].map(
          (binding) => `${binding.identity.profileKey}::${binding.identity.canonicalItemId}`,
        ),
      );
      for (const entry of listed.value) {
        if (entry.library === undefined) continue; // session-scoped: diagnostics only
        const key = `${entry.library.profileKey}::${entry.library.canonicalItemId}`;
        if (boundItems.has(key)) continue; // the bound attempt's facts carry it
        const offlineReady = offlineReadyFactsOf(entry);
        if (offlineReady === undefined) continue;
        runtime.acquisition.report({
          itemId: entry.library.canonicalItemId,
          offlineReady,
        });
      }
      return { ok: true, value: undefined };
    },

    diagnostics(itemId: string): AcquisitionDiagnosticsView | null {
      // The gated protocol view of one item: the live session's own
      // numbers (peers/pieces/rates/states) + the exposure identity.
      for (const binding of bySession.values()) {
        if (binding.identity.canonicalItemId !== itemId) continue;
        const entry = exposureFor(binding.identity.canonicalItemId, binding.identity.profileKey);
        if (binding.sessionId === null) {
          return entry !== undefined && entry.library !== undefined
            ? {
                itemId,
                infoHash: entry.infoHash,
                provenance: { sourceId: entry.provenance.sourceId, basis: entry.provenance.basis },
                offlineReadyKey: entry.key,
              }
            : null;
        }
        const status = engine.status(binding.sessionId);
        if (!status.ok) return null;
        const scheduler = engine.playback.state(binding.sessionId);
        const truth = engine.playback.truth(binding.sessionId);
        const view: AcquisitionDiagnosticsView = {
          itemId,
          sessionState: status.value.state,
          ...(scheduler.ok ? { schedulerState: scheduler.value } : {}),
          infoHash: status.value.infoHash,
          peersConnected: status.value.peers.connected,
          piecesVerified: status.value.pieces.verified,
          piecesTotal: status.value.pieces.total,
          downloadBytesPerSec: status.value.rates.downloadBytesPerSec,
          uploadBytesPerSec: status.value.rates.uploadBytesPerSec,
          ...(truth.ok
            ? {
                stallKind: truth.value.stall.kind,
                stalled: truth.value.stall.sessionStalled,
                ...(truth.value.stall.stallDurationMs !== undefined
                  ? { stallDurationMs: truth.value.stall.stallDurationMs }
                  : {}),
              }
            : {}),
          provenance: {
            sourceId: status.value.provenance.sourceId,
            basis: status.value.provenance.basis,
          },
          dataDir: status.value.dataDir,
          ...(status.value.failure !== undefined
            ? {
                // The engine's verbose failure detail — protocol-safe HERE
                // (the gated surface), never on the default surface.
                failureDetail: `${status.value.failure.reason}: ${status.value.failure.detail}`,
              }
            : {}),
          ...(entry !== undefined ? { offlineReadyKey: entry.key } : {}),
        };
        return view;
      }
      return null;
    },
  };
}

/**
 * The default-surface failure-detail guard (test support, exported for the
 * leak tests): every sentence the source can put on the DEFAULT surface is
 * protocol-free.
 */
export function assertProtocolFreeDefaultDetail(detail: string): void {
  if (containsAcquisitionProtocolTerminology(detail)) {
    throw new RuntimeError(
      "invalid-input",
      `the acquisition default-surface detail leaks protocol terminology: '${detail}'`,
    );
  }
}
