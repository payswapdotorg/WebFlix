/**
 * @wfx/app-desktop — the playback startup/recovery instrument (R24-W3, the
 * plan's R24-E playback performance contract + the parity lab's torrent
 * performance track).
 *
 * THE LAW THIS INSTRUMENT KEEPS (docs/plans/
 * 2026-09-20-webflix-youtube-parity-performance-plan.md R24-E + docs/
 * validation/youtube-parity-lab.md "Playback performance lab" + "Torrent
 * performance track"): the native + torrent startup paths are INSTRUMENTED
 * with the frozen metric vocabulary —
 *
 * - navigation-to-player-visible;
 * - click-to-first-frame (TTFF) — FROM VERIFIED PLAYABLE DATA;
 * - click-to-audible where applicable;
 * - time-to-playable;
 * - startup failure;
 * - seek response latency;
 * - control response;
 * - recovery time after a transient failure;
 * - the torrent track: time to metadata / to selected file / to first
 *   verified playable range / to first frame / to background completion /
 *   through integrity verification / to the Ready-offline transition.
 *
 * THE STARTUP ARCHITECTURE LAWS (machine-checked from the observations,
 * never asserted from code reading):
 *
 * 1. NO SERIAL CHAIN / NO NONESSENTIAL WORK: any `nonessential-call`
 *    observation between the play click and the first frame marks the
 *    measurement as blocked — recommendation, AI, indexing, analytics and
 *    nonessential metadata must NEVER sit on the startup critical path.
 * 2. VERIFIED RANGES FIRST: the first frame must arrive from VERIFIED
 *    playable data (runway > 0) while the copy is still INCOMPLETE
 *    (verified fraction < 1) — the ranges needed for immediate playback
 *    are prioritized over full completion.
 *
 * THE CLOCK SEAM: the instrument timestamps through an injectable
 * `nowMs()` — the SystemClock in production, the test clock in the
 * deterministic harness. Every timing in a measurement record is a REAL
 * delta the clock observed; the instrument NEVER invents a number, and a
 * metric that was not observed stays `null` (honest absence, never zero
 * theater).
 *
 * WHAT THIS MODULE IS NOT: a benchmark driver (the journey harness drives
 * the composition and calls `observe`), a telemetry transport (Worker 1's
 * shared R24-A contract owns the transport — this record is the
 * Desktop-side instrument whose vocabulary reconciles with it when the
 * shared contract lands; the escalation is recorded in the R24-W3 report),
 * or a player (the runtime owns playback).
 */

// ---------------------------------------------------------------------------
// The observation vocabulary (the honest points of the startup path)
// ---------------------------------------------------------------------------

/**
 * One observed point of the startup/recovery path. The harness (and, in
 * production, the player shell) records these as they HAPPEN — the
 * instrument derives the measurements from the ordered, timestamped
 * observations.
 */
export type PlaybackStartupObservation =
  | { readonly kind: "navigation-start" }
  | { readonly kind: "player-visible" }
  | { readonly kind: "play-click" }
  | { readonly kind: "torrent-metadata" }
  | { readonly kind: "file-selected" }
  | { readonly kind: "first-verified-playable-range" }
  | {
      /** The first playing evidence (the first frame). */
      readonly kind: "first-frame";
      /** The verified runway ahead at the first frame (ms). */
      readonly runwayMs: number;
      /** The verified fraction of the selected files at the first frame. */
      readonly verifiedFraction: number;
    }
  | { readonly kind: "audible" }
  | { readonly kind: "startup-failed"; readonly detail: string }
  | {
      /**
       * A NONESSENTIAL call observed inside the startup window (the
       * no-serial-chain law's violation marker): recommendation, AI,
       * indexing, analytics, nonessential metadata.
       */
      readonly kind: "nonessential-call";
      readonly detail: string;
    }
  | { readonly kind: "seek-issued" }
  | { readonly kind: "seek-accepted" }
  | { readonly kind: "control-issued" }
  | { readonly kind: "control-settled" }
  | { readonly kind: "transient-failure" }
  | { readonly kind: "recovery-complete" }
  | { readonly kind: "background-completion" }
  | { readonly kind: "integrity-verified" }
  | { readonly kind: "ready-offline" };

/** Every observation kind, in the frozen vocabulary order. */
export const PLAYBACK_STARTUP_OBSERVATION_KINDS: readonly PlaybackStartupObservation["kind"][] = [
  "navigation-start",
  "player-visible",
  "play-click",
  "torrent-metadata",
  "file-selected",
  "first-verified-playable-range",
  "first-frame",
  "audible",
  "startup-failed",
  "nonessential-call",
  "seek-issued",
  "seek-accepted",
  "control-issued",
  "control-settled",
  "transient-failure",
  "recovery-complete",
  "background-completion",
  "integrity-verified",
  "ready-offline",
] as const;

// ---------------------------------------------------------------------------
// The measurement record (the frozen metric vocabulary)
// ---------------------------------------------------------------------------

/** One benchmark pass's realization label. */
export type StartupRealizationLabel =
  | "authorized-peer-copy"
  | `provider-${"embed" | "browser" | "external" | "native"}`;

/** The cache mode of one benchmark pass. */
export type StartupCacheMode = "cold" | "warm";

/**
 * One startup/recovery measurement record — the R24-E primary metrics +
 * the torrent performance track + the startup architecture laws. `null`
 * means HONESTLY NOT OBSERVED in this pass (never a fabricated zero).
 */
export interface PlaybackStartupMeasurement {
  /** The benchmark pass's label (the title). */
  readonly label: string;
  /** The realization the pass played. */
  readonly realization: StartupRealizationLabel;
  /** The cache mode the pass ran under. */
  readonly cacheMode: StartupCacheMode;
  /** The window's raw observations (the retained raw record — the lab's law). */
  readonly observations: readonly TimestampedObservation[];

  // — the R24-E primary metrics (ms; null = honestly not observed) —
  readonly navigationToPlayerVisibleMs: number | null;
  /** Click-to-first-frame — FROM VERIFIED PLAYABLE DATA. */
  readonly clickToFirstFrameMs: number | null;
  readonly clickToAudibleMs: number | null;
  readonly timeToPlayableMs: number | null;
  readonly startupFailed: boolean;
  readonly startupFailureDetail: string | null;
  readonly seekResponseMs: number | null;
  readonly controlResponseMs: number | null;
  readonly recoveryAfterTransientFailureMs: number | null;

  // — the torrent performance track (ms; null = not applicable/not observed) —
  readonly timeToTorrentMetadataMs: number | null;
  readonly timeToSelectedFileMs: number | null;
  readonly timeToFirstVerifiedPlayableRangeMs: number | null;
  readonly backgroundCompletionMs: number | null;
  readonly integrityVerificationMs: number | null;
  readonly readyOfflineTransitionMs: number | null;

  // — the startup architecture laws (machine-checked from the observations) —
  /** LAW 1: did ANY nonessential call sit between the play click and the first frame? */
  readonly playbackBlockedOnNonessentialWork: boolean;
  /** The nonessential calls observed in the window (empty when the law holds). */
  readonly nonessentialCallsInWindow: readonly string[];
  /**
   * LAW 2: did the first frame arrive from VERIFIED playable data while the
   * copy was still incomplete (the verified ranges prioritized over full
   * completion)? `null` when the pass had no torrent realization.
   */
  readonly verifiedRangesPrioritizedOverCompletion: boolean | null;
  /** The first frame's verified runway (ms; null when no first frame observed). */
  readonly firstFrameRunwayMs: number | null;
  /** The first frame's verified fraction (null when no first frame observed). */
  readonly firstFrameVerifiedFraction: number | null;
}

/** One timestamped observation (the raw retained record). */
export interface TimestampedObservation {
  readonly kind: PlaybackStartupObservation["kind"];
  readonly atMs: number;
  /** Present for `startup-failed` / `nonessential-call`. */
  readonly detail?: string;
  /** Present for `first-frame`: the verified runway ahead (ms). */
  readonly runwayMs?: number;
  /** Present for `first-frame`: the verified fraction of the selected files. */
  readonly verifiedFraction?: number;
}

// ---------------------------------------------------------------------------
// The instrument
// ---------------------------------------------------------------------------

/** Options for {@link createPlaybackStartupInstrument}. */
export interface PlaybackStartupInstrumentOptions {
  /**
   * The clock seam — the timestamp source. Production wires the
   * SystemClock's now; the deterministic harness wires its own. The
   * instrument never invents a timestamp.
   */
  readonly nowMs: () => number;
}

/** The playback startup/recovery instrument. */
export interface DesktopPlaybackStartupInstrument {
  /** Record one observation at the clock's current instant. */
  observe(observation: PlaybackStartupObservation): void;
  /** Derive the measurement record from the observations since the last reset. */
  measurement(input: {
    readonly label: string;
    readonly realization: StartupRealizationLabel;
    readonly cacheMode: StartupCacheMode;
  }): PlaybackStartupMeasurement;
  /** The raw observations since the last reset (the retained record). */
  raw(): readonly TimestampedObservation[];
  /** Reset for the next pass (the raw record clears). */
  reset(): void;
}

/**
 * Create the playback startup/recovery instrument. Pure recording +
 * derivation: no product policy, no transport, no invention — the caller
 * observes the honest points, the instrument keeps them and derives the
 * frozen metric vocabulary from them.
 */
export function createPlaybackStartupInstrument(
  options: PlaybackStartupInstrumentOptions,
): DesktopPlaybackStartupInstrument {
  const { nowMs } = options;
  let observations: TimestampedObservation[] = [];

  const at = (kind: PlaybackStartupObservation["kind"]): number | null => {
    const found = observations.find((entry) => entry.kind === kind);
    return found !== undefined ? found.atMs : null;
  };

  return {
    observe(observation: PlaybackStartupObservation): void {
      observations.push({
        kind: observation.kind,
        atMs: nowMs(),
        ...(observation.kind === "startup-failed" || observation.kind === "nonessential-call"
          ? { detail: observation.detail }
          : {}),
        ...(observation.kind === "first-frame"
          ? { runwayMs: observation.runwayMs, verifiedFraction: observation.verifiedFraction }
          : {}),
      });
    },

    measurement(input: {
      readonly label: string;
      readonly realization: StartupRealizationLabel;
      readonly cacheMode: StartupCacheMode;
    }): PlaybackStartupMeasurement {
      const navigationStart = at("navigation-start");
      const playerVisible = at("player-visible");
      const playClick = at("play-click");
      const metadata = at("torrent-metadata");
      const fileSelected = at("file-selected");
      const firstVerifiedRange = at("first-verified-playable-range");
      const firstFrame = observations.find((entry) => entry.kind === "first-frame");
      const audible = at("audible");
      const startupFailed = observations.find((entry) => entry.kind === "startup-failed");
      const seekIssued = at("seek-issued");
      const seekAccepted = at("seek-accepted");
      const controlIssued = at("control-issued");
      const controlSettled = at("control-settled");
      const transientFailure = at("transient-failure");
      const recoveryComplete = at("recovery-complete");
      const backgroundCompletion = at("background-completion");
      const integrityVerified = at("integrity-verified");
      const readyOffline = at("ready-offline");

      // LAW 1 — the no-serial-chain law: the startup window is [play-click,
      // first-frame]; any nonessential call inside it is a violation.
      const windowStart = playClick;
      const windowEnd = firstFrame?.atMs ?? Number.POSITIVE_INFINITY;
      const nonessentialInWindow = observations.filter(
        (entry) =>
          entry.kind === "nonessential-call" &&
          windowStart !== null &&
          entry.atMs >= windowStart &&
          entry.atMs <= windowEnd,
      );
      const playbackBlockedOnNonessentialWork = nonessentialInWindow.length > 0;

      // LAW 2 — the verified-ranges-first law: the first frame arrived with
      // a verified runway > 0 while the verified fraction was still < 1
      // (the ranges needed for immediate playback prioritized over full
      // completion). Only derivable for a pass that observed a first frame
      // with its torrent truth.
      let verifiedRangesPrioritizedOverCompletion: boolean | null = null;
      if (firstFrame !== undefined) {
        const runway = firstFrame.runwayMs ?? 0;
        const fraction = firstFrame.verifiedFraction ?? 1;
        verifiedRangesPrioritizedOverCompletion = runway > 0 && fraction < 1;
      }

      const delta = (from: number | null, to: number | null): number | null =>
        from !== null && to !== null && to >= from ? to - from : null;

      return {
        label: input.label,
        realization: input.realization,
        cacheMode: input.cacheMode,
        observations: [...observations],

        navigationToPlayerVisibleMs: delta(navigationStart, playerVisible),
        clickToFirstFrameMs: delta(playClick, firstFrame?.atMs ?? null),
        clickToAudibleMs: delta(playClick, audible),
        timeToPlayableMs: delta(playClick, firstVerifiedRange),
        startupFailed: startupFailed !== undefined,
        startupFailureDetail: startupFailed?.detail ?? null,
        seekResponseMs: delta(seekIssued, seekAccepted),
        controlResponseMs: delta(controlIssued, controlSettled),
        recoveryAfterTransientFailureMs: delta(transientFailure, recoveryComplete),

        timeToTorrentMetadataMs: delta(playClick, metadata),
        timeToSelectedFileMs: delta(playClick, fileSelected),
        timeToFirstVerifiedPlayableRangeMs: delta(playClick, firstVerifiedRange),
        backgroundCompletionMs: delta(playClick, backgroundCompletion),
        integrityVerificationMs: delta(backgroundCompletion, integrityVerified),
        readyOfflineTransitionMs: delta(playClick, readyOffline),

        playbackBlockedOnNonessentialWork,
        nonessentialCallsInWindow: nonessentialInWindow.map((entry) => entry.detail ?? entry.kind),
        verifiedRangesPrioritizedOverCompletion,
        firstFrameRunwayMs: firstFrame?.runwayMs ?? null,
        firstFrameVerifiedFraction: firstFrame?.verifiedFraction ?? null,
      };
    },

    raw(): readonly TimestampedObservation[] {
      return [...observations];
    },

    reset(): void {
      observations = [];
    },
  };
}

// ---------------------------------------------------------------------------
// The percentile derivation (the threshold machinery — shared by every run)
// ---------------------------------------------------------------------------

/**
 * The p50/p75/p95 derivation over one metric's non-null observations (the
 * frozen threshold machinery — the SAME derivation production telemetry
 * uses; honest over small samples: the nearest-rank method, never a
 * fabricated interpolation).
 */
export function startupPercentile(
  values: readonly number[],
  percentile: 50 | 75 | 95,
): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((percentile / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
}

/**
 * The R24-E threshold verdict for one run's TTFF percentiles against the
 * reference baseline (the frozen thresholds: p50 ≤ ref+150ms, p75 ≤
 * ref+300ms, p95 ≤ ref+750ms). The reference is the SAME-CONTENT YouTube
 * baseline in production; in the deterministic harness the reference is
 * the run's own provider-realization baseline or null (honestly not
 * comparable — the verdict then records the thresholds as pending the
 * real-device procedure).
 */
export function ttffThresholdVerdict(input: {
  readonly webflix: { readonly p50: number | null; readonly p75: number | null; readonly p95: number | null };
  readonly reference: { readonly p50: number | null; readonly p75: number | null; readonly p95: number | null } | null;
}): {
  readonly comparable: boolean;
  readonly p50WithinThreshold: boolean | null;
  readonly p75WithinThreshold: boolean | null;
  readonly p95WithinThreshold: boolean | null;
  readonly detail: string;
} {
  if (input.reference === null) {
    return {
      comparable: false,
      p50WithinThreshold: null,
      p75WithinThreshold: null,
      p95WithinThreshold: null,
      detail:
        "The same-content reference baseline is not measurable in this environment — the R24-E thresholds (p50 ≤ ref+150ms, p75 ≤ ref+300ms, p95 ≤ ref+750ms) are the real-device lab procedure's verdict, recorded here as pending (never silently passed).",
    };
  }
  const p50 =
    input.webflix.p50 !== null && input.reference.p50 !== null
      ? input.webflix.p50 <= input.reference.p50 + 150
      : null;
  const p75 =
    input.webflix.p75 !== null && input.reference.p75 !== null
      ? input.webflix.p75 <= input.reference.p75 + 300
      : null;
  const p95 =
    input.webflix.p95 !== null && input.reference.p95 !== null
      ? input.webflix.p95 <= input.reference.p95 + 750
      : null;
  return {
    comparable: true,
    p50WithinThreshold: p50,
    p75WithinThreshold: p75,
    p95WithinThreshold: p95,
    detail: `TTFF against the reference baseline: p50 ${p50 === null ? "n/a" : p50 ? "within" : "OVER"} (+150ms), p75 ${p75 === null ? "n/a" : p75 ? "within" : "OVER"} (+300ms), p95 ${p95 === null ? "n/a" : p95 ? "within" : "OVER"} (+750ms).`,
  };
}
