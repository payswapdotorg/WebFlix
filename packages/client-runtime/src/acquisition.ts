/**
 * @wfx/client-runtime — the native acquisition UX seam (R14).
 *
 * THE USER LIFECYCLE (the remediation freeze's own vocabulary — the frozen
 * `AcquisitionState` of `@wfx/domain`, consumed verbatim, never reshaped):
 *
 * ```text
 *   Available -> Preparing -> Buffering -> Playing -> Completing -> Ready offline
 *        │            │            │           │            │             │
 *        └────────────┴────────────┴───────────┴────────────┴───┐         │
 *                     Failed/Recoverable <──────────────────────┼─────────┘
 *                          │                                     (the offline verdict degraded)
 *                          └──retry (recoverable only)──> Preparing
 * ```
 *
 * WHAT THIS MODULE OWNS (and nothing more — consume, don't reinvent):
 * - THE STATE MODEL: the lawful transition graph over the frozen vocabulary
 *   (the R12 `state-machine.ts` pattern: a closed table, a total predicate,
 *   a typed error for illegal hops) plus the reachability law for coarse
 *   observation steps.
 * - THE MAPPER: a PURE fold from protocol-free `AcquisitionFacts` (what the
 *   platform adapter derives from the R11 session states, the R12 playback
 *   scheduler truth, and the R13 persistence/exposure machinery) to the
 *   `AcquisitionStatusView` the default UX renders. Precedence is documented
 *   and test-enforced: a live failure is the loudest fact (never silent);
 *   `Ready offline` is EARNED only by the R13 verified-exposure verdict —
 *   never assumed, never partial; in-progress states carry the R12 truthful
 *   numbers verbatim (no fake progress).
 * - THE STORE: the runtime's acquisition intake (`report`), read (`view`/
 *   `views`), dismissal (`clear`), and change observation. The observation
 *   law is enforced at intake: an impossible jump (no direct edge and no
 *   in-progress-only path — e.g. anything out of `ready-offline` into an
 *   in-progress state) is the typed `InvalidAcquisitionTransitionError`
 *   — the R12 honesty pattern.
 * - THE PROTOCOL LEAK GUARD: the closed torrent-protocol terminology list
 *   and its predicate. DEFAULT surfaces must render protocol-free strings
 *   (test-enforced against the mapper's every label/detail); the protocol
 *   vocabulary lives ONLY inside the explicitly gated
 *   `AcquisitionDiagnosticsView` surface (the "advanced diagnostics"
 *   disclosure — J21-J25's "No native protocol" law).
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO:
 * - It never imports the torrent engine, native media, or any platform
 *   detail: the facts are protocol-free BY TYPE (the layering law — torrent
 *   internals stay behind the native-media boundary; the client-runtime
 *   knows `@wfx/domain` + `@wfx/platform-contracts` only).
 * - It never fabricates progress, timestamps, or verdicts: every number in
 *   the view is a pass-through of an adapter-reported fact, and "unknown"
 *   stays `null` (the truthful-buffering law).
 * - It never starts/stops anything: acquisition ACTIONS are typed intents
 *   (`acquisitionActionsFor`); the adapter owns the wiring (R13's resume
 *   path for retries, the R10 playback controls for pause/resume).
 */

import type { AcquisitionState } from "@wfx/domain";
import { isEntertainmentItemId, previewValue } from "@wfx/domain";
import type { Unsubscribe } from "@wfx/platform-contracts";

import { RuntimeError } from "./errors";

// ---------------------------------------------------------------------------
// The state vocabulary (frozen — consumed, never reshaped)
// ---------------------------------------------------------------------------

/**
 * The frozen user-lifecycle vocabulary, in lifecycle order. The strings are
 * `@wfx/domain`'s frozen `AcquisitionState` union, verbatim (the contracts
 * doc's Acquisition section); the USER-FACING labels live in
 * {@link ACQUISITION_STATE_LABELS}.
 */
export const ACQUISITION_STATES: readonly AcquisitionState[] = [
  "available",
  "preparing",
  "buffering",
  "playing",
  "completing",
  "ready-offline",
  "failed",
];

/** Runtime guard for the frozen state union. */
export function isAcquisitionState(x: unknown): x is AcquisitionState {
  return (
    typeof x === "string" &&
    (ACQUISITION_STATES as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// The transition graph (the R12 pattern)
// ---------------------------------------------------------------------------

/**
 * THE CLOSED TRANSITION GRAPH over the frozen vocabulary. Every edge is a
 * fact the mapper can honestly observe between two consecutive fact sets:
 *
 * - `available` reaches EVERY state directly: facts arrive asynchronously
 *   (a session created, a recovered session re-armed mid-lifecycle at boot
 *   — J25, an exposure read at boot — J26), so the first observation of an
 *   item can be any honest lifecycle point.
 * - `preparing` → `buffering` (playback declared while transferring), →
 *   `completing` (download continues without playback — the J24 background
 *   path, also the plain "make available offline" path), → `available`
 *   (the attempt was cancelled/stopped before any transfer), → `failed`.
 *   `preparing` NEVER reaches `playing` or `ready-offline` directly:
 *   playback passes through `buffering` (the startup window), and the
 *   offline copy is earned through `completing` (verified + exposed).
 * - `buffering` ⇄ `playing` (the truthful rebuffer law: a deadline at risk
 *   honestly demotes `playing` to `buffering`; a satisfied window promotes
 *   back), → `completing` (playback stopped / the asset completed), →
 *   `available` (cancelled), → `failed`.
 * - `playing` → `ready-offline` (the download COMPLETED AND the R13 exposure
 *   verified while watching — the strongest honest fact), → `completing`
 *   (completed, exposure pending), → `available`, → `failed`.
 * - `completing` → `ready-offline` (the EARNED arrival), → `buffering`
 *   (playback declared during background completion — J23), → `available`
 *   (cancelled), → `failed` (verification/exposure refused).
 *   `completing` NEVER reaches `playing` directly: playback always passes
 *   through the startup `buffering` window first.
 * - `ready-offline` is terminal FOR THE ATTEMPT but not for honesty: the
 *   only outgoing edge is → `failed` (the R13 live store verdict degraded —
 *   the exposed bytes vanished from disk). It never re-enters the
 *   in-progress states: while a verified exposure exists it WINS the fold
 *   precedence, so an in-progress re-acquisition renders `ready-offline`
 *   with the attempt visible in diagnostics.
 * - `failed` → `preparing` is THE TYPED RETRY (recoverable failures only —
 *   the action table decides; fatal failures offer dismissal, not retry),
 *   → `available` (the dismissal path: the failure view is cleared and no
 *   facts remain), → `ready-offline` (the RE-EARN path: a degraded exposure
 *   re-verified successfully — R13's `verifyOfflineReadyEntry`).
 * - Every state self-loops (observation updates: progress moves, facts
 *   refresh, no lifecycle change).
 */
export const ALLOWED_ACQUISITION_TRANSITIONS: Readonly<
  Record<AcquisitionState, readonly AcquisitionState[]>
> = {
  available: ["available", "preparing", "buffering", "playing", "completing", "ready-offline", "failed"],
  preparing: ["preparing", "available", "buffering", "completing", "failed"],
  buffering: ["buffering", "available", "playing", "completing", "failed"],
  playing: ["playing", "available", "buffering", "completing", "ready-offline", "failed"],
  completing: ["completing", "available", "buffering", "ready-offline", "failed"],
  "ready-offline": ["ready-offline", "failed"],
  failed: ["failed", "available", "preparing", "ready-offline"],
};

/**
 * Predicate: is `from` → `to` a DIRECT lawful edge? Total for garbage.
 */
export function canTransitionAcquisitionState(
  from: AcquisitionState,
  to: AcquisitionState,
): boolean {
  if (!isAcquisitionState(from) || !isAcquisitionState(to)) return false;
  const allowed = ALLOWED_ACQUISITION_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

/** The in-progress states a coarse observation gap may elide through. */
const ELIDABLE_ACQUISITION_STATES: readonly AcquisitionState[] = [
  "preparing",
  "buffering",
  "playing",
  "completing",
];

/**
 * Predicate: is the OBSERVED jump `from` → `to` lawful for the store's
 * intake? THE OBSERVATION LAW (two clauses, both honest):
 *
 * 1. A DIRECT edge is always lawful (the stepwise case — adapters that
 *    report per engine event are stepwise by construction).
 * 2. Otherwise, the jump is lawful iff a path exists whose INTERMEDIATE
 *    states are all in-progress states (`preparing`/`buffering`/
 *    `playing`/`completing`) — the COARSE POLL case: one observation gap
 *    may honestly elide several in-progress steps (e.g. `completing` →
 *    `playing` when the user pressed play AND the startup window
 *    satisfied within one gap; `buffering` → `ready-offline` when the
 *    completion and the exposure both landed within one gap).
 *
 *    The intermediates may NEVER include `failed` (a failure is never
 *    elided — it is reported or it didn't happen) nor `available` (a
 *    dismissal/cancellation is a user action, never spontaneous) nor
 *    `ready-offline` (the earned arrival is terminal for the attempt).
 *    This makes the impossible jumps structurally impossible: nothing
 *    leaves `ready-offline` for an in-progress state (`ready-offline` →
 *    `preparing` would have to pass `failed` — the degradation — as an
 *    elided intermediate, which the law forbids: the degradation must be
 *    OBSERVED, then the retry reported as its own step).
 */
export function isLawfulAcquisitionObservation(
  from: AcquisitionState,
  to: AcquisitionState,
): boolean {
  if (!isAcquisitionState(from) || !isAcquisitionState(to)) return false;
  if (canTransitionAcquisitionState(from, to)) return true;
  // Breadth-first walk restricted to in-progress intermediates (7 states —
  // trivially bounded).
  const seen = new Set<AcquisitionState>([from]);
  const queue: AcquisitionState[] = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of ALLOWED_ACQUISITION_TRANSITIONS[current] ?? []) {
      if (next === to) return true;
      if (!seen.has(next) && ELIDABLE_ACQUISITION_STATES.includes(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/**
 * Thrown when an acquisition observation implies an impossible lifecycle
 * jump (no lawful path exists). A programmer error in the adapter's fact
 * derivation — the R12 `InvalidPlaybackSchedulerTransitionError` pattern.
 * `from`/`to` are plain strings because runtime callers may pass garbage.
 */
export class InvalidAcquisitionTransitionError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(
      `InvalidAcquisitionTransitionError: acquisition state '${from}' cannot transition to '${to}' ` +
        "(no lawful path in the acquisition lifecycle)",
    );
    this.name = "InvalidAcquisitionTransitionError";
    this.from = from;
    this.to = to;
  }
}

// ---------------------------------------------------------------------------
// The typed failure vocabulary (recoverable vs fatal — never silent)
// ---------------------------------------------------------------------------

/**
 * The closed set of typed, USER-LANGUAGE acquisition failure causes — the
 * honest mapping of the R11 `TorrentFailureReason` taxonomy (plus the R13
 * degraded-exposure cause) into words that carry no torrent protocol
 * terminology. Recoverability is TABLE-DERIVED (the R11 `retryable` pattern:
 * the flag can never drift from the taxonomy).
 *
 * - `details-not-found`     — the source's details could not be found
 *   (recoverable: the source may return).
 * - `download-corrupted`    — the downloaded data failed its integrity
 *   checks (recoverable: acquire again).
 * - `saved-progress-lost`   — recorded progress existed but its data could
 *   not be found on this device (recoverable; retry starts with whatever
 *   the journal still proves — R13 never restarts from zero silently).
 * - `storage-problem`       — a local storage problem interrupted the
 *   acquisition (recoverable after freeing space/fixing the disk).
 * - `source-problem`        — the download source had a problem (recoverable).
 * - `integrity-check-failed`— the final integrity pass failed (recoverable:
 *   acquire again).
 * - `offline-copy-missing`  — the previously verified offline copy's files
 *   are no longer on disk (recoverable: acquire again; re-verification can
 *   also re-earn the verdict if the files return).
 * - `authorization-revoked` — the source that authorized this acquisition
 *   is no longer authorized (FATAL: invariant 5 never bends; retry is not
 *   offered).
 */
export const ACQUISITION_FAILURE_CAUSES = [
  "details-not-found",
  "download-corrupted",
  "saved-progress-lost",
  "storage-problem",
  "source-problem",
  "integrity-check-failed",
  "offline-copy-missing",
  "authorization-revoked",
] as const;

export type AcquisitionFailureCause = (typeof ACQUISITION_FAILURE_CAUSES)[number];

/** Runtime guard for the failure-cause union. */
export function isAcquisitionFailureCause(x: unknown): x is AcquisitionFailureCause {
  return (
    typeof x === "string" &&
    (ACQUISITION_FAILURE_CAUSES as readonly string[]).includes(x)
  );
}

/** The recoverable/fatal table (single source of truth — never caller-set). */
export const RECOVERABLE_ACQUISITION_FAILURE_CAUSES: readonly AcquisitionFailureCause[] = [
  "details-not-found",
  "download-corrupted",
  "saved-progress-lost",
  "storage-problem",
  "source-problem",
  "integrity-check-failed",
  "offline-copy-missing",
];

/** Is a failure with this cause recoverable (retry is an honest offer)? */
export function isRecoverableAcquisitionFailure(cause: AcquisitionFailureCause): boolean {
  return RECOVERABLE_ACQUISITION_FAILURE_CAUSES.includes(cause);
}

/** The user-language failure sentences (protocol-free by construction). */
export const ACQUISITION_FAILURE_LABELS: Readonly<Record<AcquisitionFailureCause, string>> = {
  "details-not-found": "The details for this title could not be found right now.",
  "download-corrupted": "The downloaded data did not pass its integrity check.",
  "saved-progress-lost": "The saved progress for this title could not be found on this device.",
  "storage-problem": "A storage problem interrupted the download.",
  "source-problem": "The download source had a problem.",
  "integrity-check-failed": "The final integrity check did not pass.",
  "offline-copy-missing": "The offline copy is no longer on this device.",
  "authorization-revoked": "The source that authorized this download is no longer authorized.",
};

// ---------------------------------------------------------------------------
// The facts contract (protocol-free, adapter-reported)
// ---------------------------------------------------------------------------

/** The transfer truth of one item's acquisition (from the R11 session states). */
export interface AcquisitionTransferFacts {
  /** Where the acquisition's transfer stands (user vocabulary). */
  readonly phase:
    | "locating"
    | "choosing-files"
    | "transferring"
    | "verifying"
    | "completed";
  /** The user paused the acquisition (the honest modifier — never a state). */
  readonly paused: boolean;
  /**
   * The truthful verified fraction of the selected files in [0, 1] — the
   * R11/R12 honest denominator. `null` when honestly unknown (e.g. while
   * details are still being located). NEVER fabricated.
   */
  readonly progressFraction: number | null;
  /**
   * J25 — the RESUME PROOF (R13's recovery report): this session was
   * restored from persisted state with its verified progress retained
   * (piece-map reuse), so the UX surfaces RESUMING — never a fresh start.
   */
  readonly resumed?: {
    /** The retained verified fraction in [0, 1] at recovery. */
    readonly retainedFraction: number;
    /** R13's proof flag: the piece map was reused, not re-downloaded. */
    readonly pieceMapReused: boolean;
  };
  /**
   * R17 — the honest STARVATION truth (peer starvation / network loss),
   * MEASURED by the adapter (never fabricated, never extrapolated): the
   * transfer has stopped receiving anything. Protocol-free by type (the
   * peer/piece vocabulary lives only in the gated diagnostics); the
   * numbers are the adapter's own measurements passed through verbatim.
   * Absent = no starvation was measured (the honest default).
   */
  readonly starved?: {
    /** How long nothing has arrived, in ms (the adapter's stall clock). */
    readonly stalledMs: number;
    /** The measured arrival rate in bytes/second over the stall (0 when starved). */
    readonly bytesPerSecond: number;
    /** The measured count of connected download sources (protocol-free). */
    readonly sourcesConnected: number;
  };
}

/** The playback truth of one item's acquisition (from the R12 scheduler). */
export interface AcquisitionPlaybackFacts {
  /** The R12 scheduler activity, in playback semantics (no protocol). */
  readonly activity:
    | "none"
    | "starting"
    | "playing"
    | "seeking"
    | "completing-in-background";
  /**
   * The R12 truthful verified runway ahead of the playhead, in SECONDS
   * (`null` when not applicable — never a fabricated number).
   */
  readonly runwaySeconds: number | null;
  /** The R12 honest flag: a playback deadline cannot be met right now. */
  readonly deadlineAtRisk: boolean;
  /** Whether the bytes at the playhead are verified (readable NOW). */
  readonly playableNow: boolean;
}

/** The R13 offline-ready verdict of one item (the EARNED-ready source). */
export interface AcquisitionOfflineReadyFacts {
  /** Every exposed asset is LIVE-verified by the store (the earned verdict). */
  readonly verified: boolean;
  /** An exposure exists but its bytes are gone/failed on disk (degraded).). */
  readonly degraded: boolean;
  /** How many assets the exposure landed (>= 1 when verified/degraded). */
  readonly assetCount: number;
  /** Total landed size in bytes. */
  readonly sizeBytes: number;
  /** When the exposure landed (epoch ms — the R13 journal's own fact). */
  readonly exposedAtMs: number;
}

/**
 * What one platform adapter reports about one canonical item's native
 * acquisition. PROTOCOL-FREE BY TYPE: peers, pieces, trackers, ratios, and
 * every other torrent-protocol concept are structurally absent — they live
 * ONLY in the gated {@link AcquisitionDiagnosticsView}.
 */
export interface AcquisitionFacts {
  /** The canonical item id (`wfxitm_…` — the R04 library key). */
  readonly itemId: string;
  /** The display title the adapter knows (the acquisition's display name). */
  readonly title?: string;
  /** The transfer truth (absent when no acquisition attempt exists). */
  readonly transfer?: AcquisitionTransferFacts;
  /** The typed failure (a live failure — the loudest fact; see precedence). */
  readonly failure?: {
    readonly cause: AcquisitionFailureCause;
    /** Honest human-readable detail (protocol-free — guard-tested). */
    readonly detail: string;
  };
  /** The playback truth (requires a transfer — playback needs a session). */
  readonly playback?: AcquisitionPlaybackFacts;
  /** The R13 exposure verdict (the ONLY source of `ready-offline`). */
  readonly offlineReady?: AcquisitionOfflineReadyFacts;
}

/** Is this value a plain record (the runtime's structural guard idiom)? */
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Validate an `AcquisitionFacts` STRUCTURALLY. Throws the typed
 * `RuntimeError` (`invalid-input`) on misuse — the same channel the runtime
 * uses everywhere. Laws beyond types:
 * - `itemId` must be a canonical `wfxitm_` id (facts are library-keyed).
 * - a failure excludes a live transfer/playback (a failed session is
 *   terminal — the honest facts never show both); an offline verdict MAY
 *   coexist (the previous offline copy can outlive a failed re-acquisition).
 * - `offlineReady.verified` and `degraded` are mutually exclusive.
 * - `playback` requires `transfer` (playback truth needs a session).
 * - fractions are finite numbers in [0, 1] (or `null` = honestly unknown).
 */
export function assertValidAcquisitionFacts(facts: AcquisitionFacts): void {
  if (!isRecord(facts)) {
    throw new RuntimeError(
      "invalid-input",
      `facts: expected an AcquisitionFacts object, got ${previewValue(facts)}`,
    );
  }
  if (typeof facts.itemId !== "string" || !isEntertainmentItemId(facts.itemId)) {
    throw new RuntimeError(
      "invalid-input",
      `facts.itemId: expected a canonical wfxitm_ id, got ${previewValue(facts.itemId)}`,
    );
  }
  if (
    facts.title !== undefined &&
    (typeof facts.title !== "string" || facts.title.trim().length === 0)
  ) {
    throw new RuntimeError(
      "invalid-input",
      `facts.title: expected a non-empty string when present, got ${previewValue(facts.title)}`,
    );
  }
  const { transfer, failure, playback, offlineReady } = facts;
  if (transfer !== undefined) {
    if (!isRecord(transfer)) {
      throw new RuntimeError("invalid-input", "facts.transfer: expected an object when present");
    }
    const phases = ["locating", "choosing-files", "transferring", "verifying", "completed"];
    if (typeof transfer.phase !== "string" || !phases.includes(transfer.phase)) {
      throw new RuntimeError(
        "invalid-input",
        `facts.transfer.phase: expected one of ${phases.join(" | ")}, got ${previewValue(transfer.phase)}`,
      );
    }
    if (typeof transfer.paused !== "boolean") {
      throw new RuntimeError(
        "invalid-input",
        `facts.transfer.paused: expected a boolean, got ${previewValue(transfer.paused)}`,
      );
    }
    if (
      transfer.progressFraction !== null &&
      transfer.progressFraction !== undefined &&
      (typeof transfer.progressFraction !== "number" ||
        !Number.isFinite(transfer.progressFraction) ||
        transfer.progressFraction < 0 ||
        transfer.progressFraction > 1)
    ) {
      throw new RuntimeError(
        "invalid-input",
        `facts.transfer.progressFraction: expected a finite number in [0,1] or null, got ${previewValue(transfer.progressFraction)}`,
      );
    }
    if (transfer.resumed !== undefined) {
      if (!isRecord(transfer.resumed)) {
        throw new RuntimeError("invalid-input", "facts.transfer.resumed: expected an object when present");
      }
      const { retainedFraction, pieceMapReused } = transfer.resumed;
      if (
        typeof retainedFraction !== "number" ||
        !Number.isFinite(retainedFraction) ||
        retainedFraction < 0 ||
        retainedFraction > 1
      ) {
        throw new RuntimeError(
          "invalid-input",
          `facts.transfer.resumed.retainedFraction: expected a finite number in [0,1], got ${previewValue(retainedFraction)}`,
        );
      }
      if (typeof pieceMapReused !== "boolean") {
        throw new RuntimeError(
          "invalid-input",
          `facts.transfer.resumed.pieceMapReused: expected a boolean, got ${previewValue(pieceMapReused)}`,
        );
      }
    }
    if (transfer.starved !== undefined) {
      if (!isRecord(transfer.starved)) {
        throw new RuntimeError("invalid-input", "facts.transfer.starved: expected an object when present");
      }
      const { stalledMs, bytesPerSecond, sourcesConnected } = transfer.starved;
      if (
        typeof stalledMs !== "number" ||
        !Number.isFinite(stalledMs) ||
        stalledMs < 0
      ) {
        throw new RuntimeError(
          "invalid-input",
          `facts.transfer.starved.stalledMs: expected a finite number >= 0, got ${previewValue(stalledMs)}`,
        );
      }
      if (
        typeof bytesPerSecond !== "number" ||
        !Number.isFinite(bytesPerSecond) ||
        bytesPerSecond < 0
      ) {
        throw new RuntimeError(
          "invalid-input",
          `facts.transfer.starved.bytesPerSecond: expected a finite number >= 0, got ${previewValue(bytesPerSecond)}`,
        );
      }
      if (
        typeof sourcesConnected !== "number" ||
        !Number.isSafeInteger(sourcesConnected) ||
        sourcesConnected < 0
      ) {
        throw new RuntimeError(
          "invalid-input",
          `facts.transfer.starved.sourcesConnected: expected a safe integer >= 0, got ${previewValue(sourcesConnected)}`,
        );
      }
    }
  }
  if (failure !== undefined) {
    if (!isRecord(failure)) {
      throw new RuntimeError("invalid-input", "facts.failure: expected an object when present");
    }
    if (!isAcquisitionFailureCause(failure.cause)) {
      throw new RuntimeError(
        "invalid-input",
        `facts.failure.cause: expected one of ${ACQUISITION_FAILURE_CAUSES.join(" | ")}, got ${previewValue(failure.cause)}`,
      );
    }
    if (typeof failure.detail !== "string" || failure.detail.trim().length === 0) {
      throw new RuntimeError(
        "invalid-input",
        `facts.failure.detail: expected a non-empty string, got ${previewValue(failure.detail)}`,
      );
    }
  }
  if (playback !== undefined) {
    if (!isRecord(playback)) {
      throw new RuntimeError("invalid-input", "facts.playback: expected an object when present");
    }
    const activities = ["none", "starting", "playing", "seeking", "completing-in-background"];
    if (typeof playback.activity !== "string" || !activities.includes(playback.activity)) {
      throw new RuntimeError(
        "invalid-input",
        `facts.playback.activity: expected one of ${activities.join(" | ")}, got ${previewValue(playback.activity)}`,
      );
    }
    if (
      playback.runwaySeconds !== null &&
      playback.runwaySeconds !== undefined &&
      (typeof playback.runwaySeconds !== "number" ||
        !Number.isFinite(playback.runwaySeconds) ||
        playback.runwaySeconds < 0)
    ) {
      throw new RuntimeError(
        "invalid-input",
        `facts.playback.runwaySeconds: expected a finite number >= 0 or null, got ${previewValue(playback.runwaySeconds)}`,
      );
    }
    if (typeof playback.deadlineAtRisk !== "boolean") {
      throw new RuntimeError(
        "invalid-input",
        `facts.playback.deadlineAtRisk: expected a boolean, got ${previewValue(playback.deadlineAtRisk)}`,
      );
    }
    if (typeof playback.playableNow !== "boolean") {
      throw new RuntimeError(
        "invalid-input",
        `facts.playback.playableNow: expected a boolean, got ${previewValue(playback.playableNow)}`,
      );
    }
  }
  if (offlineReady !== undefined) {
    if (!isRecord(offlineReady)) {
      throw new RuntimeError("invalid-input", "facts.offlineReady: expected an object when present");
    }
    const { verified, degraded, assetCount, sizeBytes, exposedAtMs } = offlineReady;
    if (typeof verified !== "boolean" || typeof degraded !== "boolean") {
      throw new RuntimeError(
        "invalid-input",
        "facts.offlineReady: verified and degraded must be booleans",
      );
    }
    if (verified && degraded) {
      throw new RuntimeError(
        "invalid-input",
        "facts.offlineReady: verified and degraded are mutually exclusive (an exposure is either live-verified or degraded — never both)",
      );
    }
    if (
      typeof assetCount !== "number" ||
      !Number.isSafeInteger(assetCount) ||
      assetCount < 0 ||
      typeof sizeBytes !== "number" ||
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes < 0 ||
      typeof exposedAtMs !== "number" ||
      !Number.isSafeInteger(exposedAtMs) ||
      exposedAtMs < 0
    ) {
      throw new RuntimeError(
        "invalid-input",
        "facts.offlineReady: expected { assetCount >= 0, sizeBytes >= 0, exposedAtMs >= 0 } as safe integers",
      );
    }
    if ((verified || degraded) && assetCount < 1) {
      throw new RuntimeError(
        "invalid-input",
        "facts.offlineReady: a verified or degraded exposure carries at least one asset",
      );
    }
  }
  // Cross-field coherence (the honest-facts laws).
  if (failure !== undefined && transfer !== undefined) {
    throw new RuntimeError(
      "invalid-input",
      "facts: a failed acquisition carries no live transfer (a failed session is terminal; report the failure and — when one exists — the offline verdict)",
    );
  }
  if (failure !== undefined && playback !== undefined) {
    throw new RuntimeError(
      "invalid-input",
      "facts: a failed acquisition carries no playback truth (a failed session has no playback)",
    );
  }
  if (playback !== undefined && transfer === undefined) {
    throw new RuntimeError(
      "invalid-input",
      "facts: playback truth requires a transfer (playback is scheduled on a live acquisition session)",
    );
  }
}

// ---------------------------------------------------------------------------
// The mapped view (what default UX surfaces render)
// ---------------------------------------------------------------------------

/** The typed failure of the view (present iff `state === "failed"`). */
export interface AcquisitionViewFailure {
  readonly cause: AcquisitionFailureCause;
  /** The user-language sentence (protocol-free — guard-tested). */
  readonly label: string;
  /** The adapter's honest detail. */
  readonly detail: string;
  /** Table-derived: is retry an honest offer? */
  readonly recoverable: boolean;
}

/** One typed action a surface can offer for the current state. */
export type AcquisitionAction =
  /** Start acquiring the item for offline use (from `available`). */
  | { readonly kind: "acquire" }
  /** Pause the in-progress acquisition. */
  | { readonly kind: "pause" }
  /** Resume the paused acquisition (R13's resume path). */
  | { readonly kind: "resume" }
  /** Retry a RECOVERABLE failure (R13's resume path — retained progress). */
  | { readonly kind: "retry" }
  /**
   * R17 — the CLEAN RESTART of an interrupted session: discard the saved
   * progress and start over from the beginning. Offered alongside `resume`
   * whenever the resumed proof exists, so resume-or-clean-restart is an
   * EXPLICIT choice — and the surface says which is which.
   */
  | { readonly kind: "restart" }
  /** Dismiss the failure view (it re-surfaces if facts fail again). */
  | { readonly kind: "dismiss" }
  /** Play the verified offline copy (from `ready-offline`). */
  | { readonly kind: "play-offline" }
  /** Re-run the offline verification (R13's re-earn path). */
  | { readonly kind: "reverify-offline" };

/**
 * The user-lifecycle view of one item's acquisition — the ONLY shape the
 * default UX surfaces render (protocol-free by construction; every number
 * is a pass-through of an adapter-reported fact).
 */
export interface AcquisitionStatusView {
  /** The canonical item id (the R04 library key). */
  readonly itemId: string;
  /** The display title, when the adapter knows one. */
  readonly title?: string;
  /** The frozen lifecycle state. */
  readonly state: AcquisitionState;
  /** The lifecycle label (user vocabulary — "Preparing", "Ready offline", …). */
  readonly label: string;
  /** The honest detail sentence (progress, runway, resume, or failure). */
  readonly detail: string;
  /** The truthful progress fraction in [0, 1]; `null` = honestly unknown. */
  readonly progress: number | null;
  /** The verified runway seconds ahead of the playhead; `null` = N/A. */
  readonly runwaySeconds: number | null;
  /** The user-paused modifier (never a state — the honest modifier). */
  readonly paused: boolean;
  /** J25: this view comes from a RESUMED session (never fresh). */
  readonly resumed: boolean;
  /** J25: the retained verified fraction at recovery (with `resumed`). */
  readonly retainedFraction: number | null;
  /**
   * R17 — the honest starvation truth, MEASURED (present iff the adapter
   * reported `transfer.starved`): how long nothing has arrived, the
   * measured rate, and the connected-source count — every number a
   * pass-through (never a fabricated ETA, never a fake moving progress).
   */
  readonly starved?: {
    readonly stalledMs: number;
    readonly bytesPerSecond: number;
    readonly sourcesConnected: number;
  };
  /** The typed failure (present iff `state === "failed"`). */
  readonly failure?: AcquisitionViewFailure;
  /** The earned offline verdict (present iff `state === "ready-offline"`). */
  readonly offline?: {
    readonly assetCount: number;
    readonly sizeBytes: number;
    readonly exposedAtMs: number;
  };
  /** The typed actions available in this state (pure derivation). */
  readonly actions: readonly AcquisitionAction[];
}

/** The lifecycle labels (user vocabulary — the J21-J25 "No native protocol" law). */
export const ACQUISITION_STATE_LABELS: Readonly<Record<AcquisitionState, string>> = {
  available: "Available",
  preparing: "Preparing",
  buffering: "Buffering",
  playing: "Playing",
  completing: "Completing",
  "ready-offline": "Ready offline",
  failed: "Couldn't finish",
};

/** Render a verified fraction as an honest percent sentence ("" for null). */
function percentSentence(fraction: number | null): string {
  if (fraction === null || fraction === undefined) return "";
  const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  return `${percent}%`;
}

/** Derive the typed actions of one in-progress state (pure). */
function inProgressActions(
  state: AcquisitionState,
  paused: boolean,
  interrupted: boolean,
): readonly AcquisitionAction[] {
  if (paused) {
    // R17: an INTERRUPTED paused session offers the EXPLICIT choice —
    // resume (keep the saved progress) or restart (discard it, start over).
    return interrupted ? [{ kind: "resume" }, { kind: "restart" }] : [{ kind: "resume" }];
  }
  if (state === "preparing" || state === "buffering" || state === "playing" || state === "completing") {
    return [{ kind: "pause" }];
  }
  return [];
}

/**
 * PURE: fold one item's facts into the lifecycle view. THE PRECEDENCE
 * (documented, test-enforced):
 *
 * 1. FAILURE — a live failure is the loudest fact: it is never hidden by
 *    an in-progress session or an old verdict (never silent). When a
 *    verified offline copy ALSO exists, the detail says so and the actions
 *    include playing it (honest on both axes).
 * 2. VERIFIED OFFLINE — the EARNED `ready-offline`: only the R13
 *    live-verified exposure verdict produces it. Never assumed, never
 *    partial, never fabricated here.
 * 3. LIVE TRANSFER/PLAYBACK — the honest in-progress mapping (below).
 * 4. DEGRADED OFFLINE — an exposure whose bytes vanished: the typed
 *    `offline-copy-missing` failure (recoverable — acquire again).
 * 5. NOTHING — `available`.
 *
 * The in-progress mapping (precedence 3), all protocol-free:
 * - `locating`/`choosing-files` → `preparing`.
 * - `transferring`/`verifying`/`completed` × playback:
 *   - `starting`/`seeking` → `buffering` (the startup window/seek burst is
 *     not satisfied — the honest pre-play state);
 *   - `playing` → `playing` when the R12 truth is healthy, `buffering`
 *     when a deadline is at risk (the truthful rebuffer demotion);
 *   - `completing-in-background`/`none`/absent → `completing` (the J24
 *     background path — also the plain "make available offline" path).
 */
export function mapAcquisitionStatus(facts: AcquisitionFacts): AcquisitionStatusView {
  assertValidAcquisitionFacts(facts);
  const { itemId, title } = facts;
  const transfer = facts.transfer;
  const playback = facts.playback;
  const offline = facts.offlineReady;

  // — the shared passthrough numbers (never fabricated) —
  const progress = transfer !== undefined ? (transfer.progressFraction ?? null) : null;
  const runwaySeconds = playback !== undefined ? (playback.runwaySeconds ?? null) : null;
  const paused = transfer !== undefined ? transfer.paused : false;
  const resumed = transfer?.resumed !== undefined;
  const retainedFraction =
    transfer?.resumed !== undefined ? transfer.resumed.retainedFraction : null;
  const starved = transfer?.starved;
  const base = {
    itemId,
    ...(title !== undefined ? { title } : {}),
    progress,
    runwaySeconds,
    paused,
    resumed,
    retainedFraction,
    ...(starved !== undefined
      ? {
          starved: {
            stalledMs: starved.stalledMs,
            bytesPerSecond: starved.bytesPerSecond,
            sourcesConnected: starved.sourcesConnected,
          },
        }
      : {}),
  };

  // 1. FAILURE (the loudest fact).
  if (facts.failure !== undefined) {
    const cause = facts.failure.cause;
    const recoverable = isRecoverableAcquisitionFailure(cause);
    const intactCopy = offline !== undefined && offline.verified;
    const label = ACQUISITION_FAILURE_LABELS[cause];
    const detail = intactCopy
      ? `${facts.failure.detail} Your existing offline copy is still verified and playable.`
      : facts.failure.detail;
    const actions: AcquisitionAction[] = [];
    if (recoverable) actions.push({ kind: "retry" });
    if (intactCopy) actions.push({ kind: "play-offline" });
    if (offline !== undefined && offline.degraded) actions.push({ kind: "reverify-offline" });
    actions.push({ kind: "dismiss" });
    return {
      ...base,
      state: "failed",
      label: ACQUISITION_STATE_LABELS.failed,
      detail,
      ...(intactCopy && offline !== undefined
        ? {
            offline: {
              assetCount: offline.assetCount,
              sizeBytes: offline.sizeBytes,
              exposedAtMs: offline.exposedAtMs,
            },
          }
        : {}),
      failure: { cause, label, detail: facts.failure.detail, recoverable },
      actions,
    };
  }

  // 2. VERIFIED OFFLINE (the earned arrival — the only ready-offline source).
  if (offline !== undefined && offline.verified) {
    return {
      ...base,
      state: "ready-offline",
      label: ACQUISITION_STATE_LABELS["ready-offline"],
      detail: "Verified and available to watch without a connection.",
      actions: [{ kind: "play-offline" }, { kind: "reverify-offline" }],
      offline: {
        assetCount: offline.assetCount,
        sizeBytes: offline.sizeBytes,
        exposedAtMs: offline.exposedAtMs,
      },
    };
  }

  // 3. LIVE TRANSFER/PLAYBACK.
  if (transfer !== undefined) {
    const activity = playback?.activity ?? "none";
    let state: AcquisitionState;
    let label: string;
    let detail: string;
    if (transfer.phase === "locating" || transfer.phase === "choosing-files") {
      state = "preparing";
      label = ACQUISITION_STATE_LABELS.preparing;
      detail =
        transfer.phase === "locating"
          ? "Finding the details for this title."
          : "Preparing the files you selected.";
    } else if (activity === "starting" || activity === "seeking") {
      state = "buffering";
      label = ACQUISITION_STATE_LABELS.buffering;
      detail = "Getting enough of the video ready to play smoothly.";
    } else if (activity === "playing") {
      if (playback !== undefined && playback.deadlineAtRisk) {
        state = "buffering";
        label = ACQUISITION_STATE_LABELS.buffering;
        detail = "Playback may pause — the video isn't arriving fast enough to keep up.";
      } else {
        state = "playing";
        label = ACQUISITION_STATE_LABELS.playing;
        detail = "Playing while the rest of the offline copy is finished in the background.";
      }
    } else {
      state = "completing";
      label = ACQUISITION_STATE_LABELS.completing;
      detail =
        transfer.phase === "verifying"
          ? "Checking the finished files."
          : "Finishing the offline copy in the background.";
    }
    // R17 — the honest starvation modifier (measured, protocol-free): a
    // starved transfer states the waiting truth with its measured numbers —
    // never a silent frozen bar, never a fabricated ETA. The lifecycle
    // state stays truthful (the transfer HAS not progressed); only the
    // sentence tells the waiting truth.
    if (starved !== undefined) {
      const seconds = Math.round(starved.stalledMs / 1000);
      detail = `${detail} Nothing has arrived for ${seconds}s — ${Math.round(
        starved.bytesPerSecond,
      )} B/s measured from ${starved.sourcesConnected} connected source${
        starved.sourcesConnected === 1 ? "" : "s"
      }. Waiting for the download to continue.`;
    }
    // The resumed modifier: J25 — resuming, never fresh.
    if (resumed && retainedFraction !== null) {
      const percent = percentSentence(retainedFraction);
      detail = `${detail} Resuming where it left off — ${
        percent !== "" ? `${percent} already saved` : "the saved progress is being reused"
      }.`;
    }
    return { ...base, state, label, detail, actions: inProgressActions(state, paused, resumed) };
  }

  // 4. DEGRADED OFFLINE (the exposure's bytes vanished — typed, recoverable).
  if (offline !== undefined && offline.degraded) {
    const label = ACQUISITION_FAILURE_LABELS["offline-copy-missing"];
    return {
      ...base,
      state: "failed",
      label: ACQUISITION_STATE_LABELS.failed,
      detail: label,
      failure: {
        cause: "offline-copy-missing",
        label,
        detail: label,
        recoverable: true,
      },
      actions: [{ kind: "retry" }, { kind: "reverify-offline" }, { kind: "dismiss" }],
    };
  }

  // 5. NOTHING — available.
  return {
    ...base,
    state: "available",
    label: ACQUISITION_STATE_LABELS.available,
    detail: "Ready to be made available offline.",
    actions: [{ kind: "acquire" }],
  };
}

// ---------------------------------------------------------------------------
// The protocol leak guard (J21-J25 "No native protocol")
// ---------------------------------------------------------------------------

/**
 * The closed torrent-protocol terminology list. DEFAULT acquisition
 * surfaces must render NONE of these words (test-enforced over the
 * mapper's every label/detail and the rendered default surfaces); they
 * appear ONLY inside the gated advanced-diagnostics surface.
 */
export const ACQUISITION_PROTOCOL_TERMS: readonly string[] = [
  "peer",
  "peers",
  "piece",
  "pieces",
  "tracker",
  "trackers",
  "swarm",
  "seed",
  "seeding",
  "leech",
  "leeching",
  "ratio",
  "torrent",
  "infohash",
  "info hash",
  "bitfield",
  "magnet",
  "dht",
  "pex",
  "choke",
  "unchoke",
  "webtorrent",
];

/**
 * Predicate: does `text` contain torrent protocol terminology (case-
 * insensitive, word-boundary matched)? The guard the default-surface tests
 * run over the mapper's strings and the rendered markup (with the gated
 * diagnostics subtree removed).
 */
export function containsAcquisitionProtocolTerminology(text: string): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  for (const term of ACQUISITION_PROTOCOL_TERMS) {
    const pattern = new RegExp(`\\b${term}\\b`, "i");
    if (pattern.test(text)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The gated advanced-diagnostics view (PROTOCOL VOCABULARY LIVES HERE)
// ---------------------------------------------------------------------------

/**
 * ⚠️ PROTOCOL VOCABULARY BY DESIGN — THE GATED SURFACE ONLY ⚠️
 *
 * The advanced diagnostics view: the torrent-protocol detail (peers,
 * pieces, rates, the R11/R12 states, provenance) the J21-J25 journeys keep
 * OUT of the default UX. It renders ONLY inside an explicitly gated
 * "advanced diagnostics" disclosure (closed by default, clearly labeled);
 * the default surfaces consume {@link AcquisitionStatusView} only. The
 * leak guard + tests enforce the isolation.
 */
export interface AcquisitionDiagnosticsView {
  readonly itemId: string;
  /** The R11 honest session state (protocol vocabulary — gated). */
  readonly sessionState?: string;
  /** The R12 playback scheduler state (gated). */
  readonly schedulerState?: string;
  /** v1 infohash (gated). */
  readonly infoHash?: string;
  /** Connected peers right now (gated). */
  readonly peersConnected?: number;
  /** Verified pieces / total pieces (gated). */
  readonly piecesVerified?: number;
  readonly piecesTotal?: number;
  /** Transfer rates, bytes per second (gated). */
  readonly downloadBytesPerSec?: number;
  readonly uploadBytesPerSec?: number;
  /** The R12 stall truth (gated). */
  readonly stallKind?: string;
  readonly stalled?: boolean;
  readonly stallDurationMs?: number;
  /** The engine's verbose failure detail (protocol-safe HERE only). */
  readonly failureDetail?: string;
  /** The acquisition authorization provenance (invariant 5 — inspectable). */
  readonly provenance?: { readonly sourceId: string; readonly basis: string };
  /** Where the engine owns the bytes (gated). */
  readonly dataDir?: string;
  /** The R13 exposure identity (gated diagnostics). */
  readonly offlineReadyKey?: string;
}

// ---------------------------------------------------------------------------
// The store (the runtime's acquisition surface)
// ---------------------------------------------------------------------------

/** Listener for acquisition view changes (receives the current views). */
export type AcquisitionListener = (views: readonly AcquisitionStatusView[]) => void;

/**
 * The runtime's acquisition operations: the adapter intake, the reads, the
 * dismissal, and change observation. The observation law is enforced at
 * intake — an observation implying an impossible jump (no direct edge and
 * no in-progress-only path) throws the typed
 * {@link InvalidAcquisitionTransitionError} (an adapter bug; the R12
 * pattern), while coarse multi-step jumps (elided in-progress states)
 * are accepted (adapters report on their own cadence — a poll gap may
 * span several honest in-progress steps).
 */
export interface AcquisitionOperations {
  /**
   * Report one item's acquisition facts (the adapter intake). Validates
   * structurally (typed `RuntimeError` on malformed facts) and enforces
   * the observation law (typed `InvalidAcquisitionTransitionError` when
   * the implied jump is impossible). Last-write-wins per item — the
   * adapter owns cadence and ordering (the R10 no-hidden-timers law).
   */
  report(facts: AcquisitionFacts): void;
  /** The item's current view (null when nothing was reported). */
  view(itemId: string): AcquisitionStatusView | null;
  /** Every current view (the Library's offline read joins here — J26). */
  views(): readonly AcquisitionStatusView[];
  /**
   * Dismiss an item's failure view (the explicit user action): the view is
   * removed and the item renders its default state until new facts arrive.
   * Idempotent; never throws for unknown ids.
   */
  clear(itemId: string): void;
  /** Observe view changes (the listener receives the full current set). */
  subscribe(listener: AcquisitionListener): Unsubscribe;
}

/** Build the acquisition store (the runtime composes this internally). */
export function createAcquisitionStore(): AcquisitionOperations {
  const views = new Map<string, AcquisitionStatusView>();
  const listeners = new Set<AcquisitionListener>();

  function publish(): void {
    const snapshot = [...views.values()];
    for (const listener of listeners) listener(snapshot);
  }

  return {
    report(facts: AcquisitionFacts): void {
      assertValidAcquisitionFacts(facts);
      const next = mapAcquisitionStatus(facts);
      const previous = views.get(facts.itemId);
      if (previous !== undefined && previous.state !== next.state) {
        // The observation law: the implied jump must be direct or a
        // coarse elision of in-progress states — never impossible.
        if (!isLawfulAcquisitionObservation(previous.state, next.state)) {
          throw new InvalidAcquisitionTransitionError(previous.state, next.state);
        }
      }
      const changed = previous === undefined || previous.state !== next.state || previous.detail !== next.detail || previous.progress !== next.progress;
      views.set(facts.itemId, next);
      if (changed) publish();
    },

    view(itemId: string): AcquisitionStatusView | null {
      return views.get(itemId) ?? null;
    },

    views(): readonly AcquisitionStatusView[] {
      return [...views.values()];
    },

    clear(itemId: string): void {
      if (views.delete(itemId)) publish();
    },

    subscribe(listener: AcquisitionListener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
