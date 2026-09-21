/**
 * @wfx/client-runtime — the R24-E shared playback-performance telemetry
 * contract (the performance contract Worker 1 freezes; the Web and
 * Desktop benchmark harnesses bind to it).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-youtube-parity-performance-plan.md — R24-E; J41 in
 * docs/validation/webflix-golden-journeys.md; the playback-performance lab
 * in docs/validation/youtube-parity-lab.md):
 *
 * "Videos should load just as easily as YouTube" is a MEASURED release
 * requirement. The lab compares WebFlix with YouTube using the SAME device,
 * browser, network profile and content whenever the same public video is
 * available on both, in cold-cache AND warm-cache passes, and RETAINS the
 * raw observations.
 *
 * THE METRIC SET (the plan's nine primary metrics + the realization-switch
 * metric J41 and the lab contract both measure):
 * 1. navigation-to-player-visible;  2. click-to-first-frame (TTFF);
 * 3. click-to-audible (where audio exists);  4. time-to-playable;
 * 5. startup failure rate;  6. first-60-second rebuffer ratio;
 * 7. seek response latency;  8. player control responsiveness;
 * 9. recovery time after a transient network failure;
 * 10. realization-switch time (J41/lab).
 *
 * THE HARD THRESHOLDS (frozen constants — lab acceptance targets against
 * the same-content YouTube baseline; the lead may TIGHTEN them after
 * baseline measurement, but must not silently loosen them — changing these
 * values is a lead-owned ratification):
 * - p50 TTFF: WebFlix no more than 150 ms slower;
 * - p75 TTFF: no more than 300 ms slower;
 * - p95 TTFF: no more than 750 ms slower;
 * - startup failure rate: no more than 0.5 percentage points worse;
 * - first-60-second rebuffer ratio: no more than 0.25 percentage points worse;
 * - supported content requires ONE obvious primary play action;
 * - nonessential metadata/recommendations/AI indexing/analytics must NOT
 *   block first-frame playback (the startup law — see interaction-policy.ts).
 *
 * WHAT THIS MODULE IS: the TYPED shapes + threshold constants + pure
 * derivations (percentiles, delta evaluation, marker→metric derivation).
 * No clock, no fetching, no UI: surfaces RECORD markers through their own
 * instrumentation seams; this contract types what a run looks like, how
 * observations derive, and how the pass/fail report computes. Workers 2/3
 * own the actual harnesses; the lead owns the comparative protocol.
 *
 * WHAT THIS MODULE IS NOT: a performance-testing framework or a collector.
 * It never starts playback, never reads timers, and never claims a pass —
 * `evaluatePlaybackThresholds` folds OBSERVED data against the frozen
 * thresholds and reports the truth (a benchmark passing through synthetic
 * fixture behavior is an R24 rejection).
 */

// ---------------------------------------------------------------------------
// The metric vocabulary (J41's measure list, typed)
// ---------------------------------------------------------------------------

/**
 * A DURATION metric of the playback-performance lab (milliseconds from a
 * defined start marker to a defined end marker).
 */
export type PlaybackDurationMetricId =
  /** Navigation to the Watch surface -> the player surface visible. */
  | "navigation-to-player-visible"
  /** The user's play action -> the first rendered video frame (TTFF). */
  | "click-to-first-frame"
  /** The user's play action -> audible playback (where audio exists). */
  | "click-to-audible"
  /** The user's play action -> playback declared playable. */
  | "time-to-playable"
  /** A seek request -> the seek confirmed (new frame at the target). */
  | "seek-response-latency"
  /** A control invocation -> its visible effect confirmed. */
  | "control-responsiveness"
  /** Transient failure detected -> playback recovered. */
  | "transient-failure-recovery-time"
  /** Realization switch requested -> the new realization's first frame. */
  | "realization-switch-time";

/** Every duration metric, in J41/lab order. */
export const PLAYBACK_DURATION_METRICS: readonly PlaybackDurationMetricId[] =
  [
    "navigation-to-player-visible",
    "click-to-first-frame",
    "click-to-audible",
    "time-to-playable",
    "seek-response-latency",
    "control-responsiveness",
    "transient-failure-recovery-time",
    "realization-switch-time",
  ] as const;

/** Runtime membership check against the duration-metric union. */
export function isPlaybackDurationMetric(
  x: unknown,
): x is PlaybackDurationMetricId {
  return (
    typeof x === "string" &&
    (PLAYBACK_DURATION_METRICS as readonly string[]).includes(x)
  );
}

/**
 * A RATIO metric of the playback-performance lab (occurrences over
 * attempts, compared in percentage points).
 */
export type PlaybackRatioMetricId =
  /** Startup attempts that failed / total startup attempts. */
  | "startup-failure-rate"
  /** Rebuffer time / play time within the first 60 seconds of playback. */
  | "first-60s-rebuffer-ratio";

/** Every ratio metric, in J41/lab order. */
export const PLAYBACK_RATIO_METRICS: readonly PlaybackRatioMetricId[] = [
  "startup-failure-rate",
  "first-60s-rebuffer-ratio",
] as const;

/** Runtime membership check against the ratio-metric union. */
export function isPlaybackRatioMetric(
  x: unknown,
): x is PlaybackRatioMetricId {
  return (
    typeof x === "string" &&
    (PLAYBACK_RATIO_METRICS as readonly string[]).includes(x)
  );
}

/** The complete metric id union (duration + ratio). */
export type PlaybackMetricId =
  | PlaybackDurationMetricId
  | PlaybackRatioMetricId;

// ---------------------------------------------------------------------------
// The frozen hard thresholds (R24-E — lab acceptance targets)
// ---------------------------------------------------------------------------

/**
 * TTFF percentile ceilings, as MAXIMUM DELTAS against the same-content
 * YouTube baseline (WebFlix may be at most this much SLOWER). The plan's
 * frozen values; the lead may tighten but never silently loosen.
 */
export const TTFF_MAX_DELTA_MS = {
  p50: 150,
  p75: 300,
  p95: 750,
} as const;

/**
 * Startup failure-rate ceiling: WebFlix may be at most 0.5 percentage
 * points WORSE than the same-content YouTube baseline.
 */
export const STARTUP_FAILURE_RATE_MAX_DELTA_PP = 0.5;

/**
 * First-60-second rebuffer-ratio ceiling: WebFlix may be at most 0.25
 * percentage points worse than the baseline.
 */
export const FIRST_60S_REBUFFER_RATIO_MAX_DELTA_PP = 0.25;

/**
 * The lab rule the thresholds express, as one machine-checkable record
 * (the source the report renderer and the evidence harness quote).
 */
export const PLAYBACK_PERFORMANCE_THRESHOLD_CONTRACT = {
  ttffP50MaxDeltaMs: TTFF_MAX_DELTA_MS.p50,
  ttffP75MaxDeltaMs: TTFF_MAX_DELTA_MS.p75,
  ttffP95MaxDeltaMs: TTFF_MAX_DELTA_MS.p95,
  startupFailureRateMaxDeltaPp: STARTUP_FAILURE_RATE_MAX_DELTA_PP,
  first60sRebufferRatioMaxDeltaPp: FIRST_60S_REBUFFER_RATIO_MAX_DELTA_PP,
  oneObviousPrimaryPlayActionRequired: true,
  nonessentialWorkMustNotBlockFirstFrame: true,
  fakeBufferingProgressForbidden: true,
  comparisonBasis: "same content, same device, same browser, same network profile, cold and warm cache passes",
} as const;

// ---------------------------------------------------------------------------
// The startup instrumentation vocabulary (the typed markers a surface records)
// ---------------------------------------------------------------------------

/**
 * One marker of a playback-startup/interaction trace — the typed point the
 * surfaces instrument. Every metric derives from a marker PAIR (see
 * {@link PLAYBACK_METRIC_MARKER_PAIRS}); the offsets are milliseconds from
 * the trace's start (the navigation or the play intent), monotonic within
 * one trace. Recording a marker is an adapter concern; this contract types
 * the vocabulary so Web and Desktop traces are COMPARABLE.
 */
export type PlaybackStartupMarkerId =
  | "navigation-start"
  | "player-surface-visible"
  | "play-clicked"
  | "first-frame-rendered"
  | "audible-playback"
  | "playable-declared"
  | "startup-failed"
  | "rebuffer-started"
  | "rebuffer-ended"
  | "seek-requested"
  | "seek-confirmed"
  | "control-invoked"
  | "control-confirmed"
  | "transient-failure-detected"
  | "playback-recovered"
  | "realization-switch-requested"
  | "realization-switch-confirmed";

/** Every marker id (the instrumentation vocabulary). */
export const PLAYBACK_STARTUP_MARKERS: readonly PlaybackStartupMarkerId[] = [
  "navigation-start",
  "player-surface-visible",
  "play-clicked",
  "first-frame-rendered",
  "audible-playback",
  "playable-declared",
  "startup-failed",
  "rebuffer-started",
  "rebuffer-ended",
  "seek-requested",
  "seek-confirmed",
  "control-invoked",
  "control-confirmed",
  "transient-failure-detected",
  "playback-recovered",
  "realization-switch-requested",
  "realization-switch-confirmed",
] as const;

/** Runtime membership check against the marker union. */
export function isPlaybackStartupMarker(
  x: unknown,
): x is PlaybackStartupMarkerId {
  return (
    typeof x === "string" &&
    (PLAYBACK_STARTUP_MARKERS as readonly string[]).includes(x)
  );
}

/**
 * The metric → marker-pair derivation table (the ONE definition of what
 * each duration metric measures — Web and Desktop traces feed the same
 * pairs, so their numbers mean the same thing).
 */
export const PLAYBACK_METRIC_MARKER_PAIRS: Readonly<
  Record<PlaybackDurationMetricId, readonly [PlaybackStartupMarkerId, PlaybackStartupMarkerId]>
> = {
  "navigation-to-player-visible": ["navigation-start", "player-surface-visible"],
  "click-to-first-frame": ["play-clicked", "first-frame-rendered"],
  "click-to-audible": ["play-clicked", "audible-playback"],
  "time-to-playable": ["play-clicked", "playable-declared"],
  "seek-response-latency": ["seek-requested", "seek-confirmed"],
  "control-responsiveness": ["control-invoked", "control-confirmed"],
  "transient-failure-recovery-time": [
    "transient-failure-detected",
    "playback-recovered",
  ],
  "realization-switch-time": [
    "realization-switch-requested",
    "realization-switch-confirmed",
  ],
};

/** One recorded marker (monotonic offset from the trace start). */
export interface PlaybackStartupMarker {
  readonly marker: PlaybackStartupMarkerId;
  /** Milliseconds from the trace start (monotonic within the trace). */
  readonly offsetMs: number;
  /** Optional detail (e.g. which control; which realization). */
  readonly detail?: string;
}

/**
 * One instrumented playback trace — the raw record a surface produces.
 * `startupFailed` traces are the startup-failure observations; rebuffer
 * start/end pairs within the first 60 seconds of playback feed the
 * first-60s rebuffer accounting.
 */
export interface PlaybackStartupTrace {
  readonly traceId: string;
  /** The canonical item the trace plays. */
  readonly itemId: string;
  /** The realization id/kind the trace plays (for realization slicing). */
  readonly realization?: string;
  /** The ordered markers (sorted by offsetMs on ingest). */
  readonly markers: readonly PlaybackStartupMarker[];
}

// ---------------------------------------------------------------------------
// The observation shapes (the raw data the lab RETAINS)
// ---------------------------------------------------------------------------

/**
 * RAW duration observations for one metric — the lab rule: "The lab must
 * retain the raw observations." Values are milliseconds; the harness keeps
 * every sample (no pre-aggregation), so percentiles derive consistently
 * and later re-analysis stays possible.
 */
export interface PlaybackDurationObservations {
  readonly metric: PlaybackDurationMetricId;
  readonly valuesMs: readonly number[];
}

/**
 * Ratio observations for one metric — the raw counts (occurrences over
 * attempts), plus the ratio derivation (pure).
 */
export interface PlaybackRatioObservations {
  readonly metric: PlaybackRatioMetricId;
  /** Total measured attempts (startup attempts / played seconds bucket). */
  readonly attempts: number;
  /** Occurrences (failed startups / rebuffer seconds). */
  readonly occurrences: number;
}

/** The qualitative startup observations the J41 acceptance adds. */
export interface PlaybackStartupQualitativeObservations {
  /** Supported content presented ONE obvious primary play action. */
  readonly oneObviousPrimaryPlayAction: boolean;
  /** Any nonessential AI/recommendation/indexing work blocked first frame. */
  readonly nonessentialWorkBlockedFirstFrame: boolean;
  /** Any FAKE buffering progress was observed (never lawful). */
  readonly fakeBufferingProgressObserved: boolean;
}

// ---------------------------------------------------------------------------
// The benchmark record shape (the lab's benchmark setup, typed)
// ---------------------------------------------------------------------------

/** The cache pass under measurement (both passes are required per run set). */
export type BenchmarkCachePass = "cold" | "warm";

/** The adapter under measurement. */
export type BenchmarkPlatform = "web" | "desktop";

/**
 * The environment profile the lab records for EVERY run (the "same device,
 * same browser, same network profile" law — comparability is checked, not
 * assumed: `evaluatePlaybackThresholds` refuses mismatched profiles).
 */
export interface PlaybackBenchmarkEnvironment {
  readonly platform: BenchmarkPlatform;
  /** The WebFlix commit SHA the run measured. */
  readonly commitSha: string;
  /** Browser + version (e.g. "Chrome 141"). */
  readonly browser: string;
  /** OS/device (e.g. "macOS 15, M2"). */
  readonly osDevice: string;
  /** Viewport (e.g. "1440x900"). */
  readonly viewport: string;
  /** Network profile (e.g. "unthrottled", "slow-4g"). */
  readonly networkProfile: string;
  /** The YouTube reference version/page context used as baseline. */
  readonly youtubePageContext?: string;
}

/**
 * The benchmark content reference — the same-content law: comparison is
 * lawful only when `samePublicContentOnYouTube` is true (the report's
 * comparability check enforces it).
 */
export interface PlaybackBenchmarkContentRef {
  readonly contentId: string;
  readonly title: string;
  /** The realization measured: direct/owned, provider embed, contained browser, authorized peer/torrent, verified local. */
  readonly realization: string;
  /** True when the same public content exists on both systems. */
  readonly samePublicContentOnYouTube: boolean;
  /** The YouTube reference (URL or id) when the content matches. */
  readonly youtubeContentRef?: string;
}

/**
 * ONE benchmark run — the complete record the lab retains per pass: the
 * environment, the content, the cache pass, the raw observations and the
 * qualitative startup truths.
 */
export interface PlaybackBenchmarkRun {
  readonly runId: string;
  readonly cachePass: BenchmarkCachePass;
  readonly environment: PlaybackBenchmarkEnvironment;
  readonly content: PlaybackBenchmarkContentRef;
  readonly durationMetrics: readonly PlaybackDurationObservations[];
  readonly ratioMetrics: readonly PlaybackRatioObservations[];
  readonly qualitative: PlaybackStartupQualitativeObservations;
  /** Free-form notes (network hiccups, anomalies — honest context). */
  readonly notes?: string;
}

// ---------------------------------------------------------------------------
// Pure derivations: percentiles + ratios + marker→metric derivation
// ---------------------------------------------------------------------------

/**
 * The p-th percentile of the values (0..100), linear interpolation on the
 * sorted sample (the standard R-7 method — the same number numpy/pandas
 * and the browser `performance` tooling produce). The lab's ONE
 * percentile definition so Web/Desktop/baseline numbers agree.
 */
export function percentile(
  values: readonly number[],
  p: number,
): number | undefined {
  if (values.length === 0 || !Number.isFinite(p) || p < 0 || p > 100) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * (p / 100);
  const low = Math.floor(index);
  const high = Math.ceil(index);
  const lowValue = sorted[low]!;
  const highValue = sorted[high]!;
  if (low === high) return lowValue;
  const weight = index - low;
  return lowValue * (1 - weight) + highValue * weight;
}

/** The ratio of one ratio observation, in PERCENTAGE POINTS (0..100). */
export function ratioPercentagePoints(
  observations: PlaybackRatioObservations,
): number | undefined {
  if (observations.attempts <= 0) return undefined;
  return (observations.occurrences / observations.attempts) * 100;
}

/**
 * Derive ONE duration observation from a set of traces (each trace that
 * carries both markers of the metric's pair contributes one value; traces
 * missing an end marker CONTRIBUTE NOTHING but are named in the returned
 * gaps list so the harness never silently drops failures).
 */
export function deriveDurationObservation(
  traces: readonly PlaybackStartupTrace[],
  metric: PlaybackDurationMetricId,
): { observations: PlaybackDurationObservations; incompleteTraceIds: readonly string[] } {
  const [startMarker, endMarker] = PLAYBACK_METRIC_MARKER_PAIRS[metric];
  const valuesMs: number[] = [];
  const incompleteTraceIds: string[] = [];
  for (const trace of traces) {
    const start = [...trace.markers]
      .filter((m) => m.marker === startMarker)
      .sort((a, b) => a.offsetMs - b.offsetMs)[0];
    const end = [...trace.markers]
      .filter((m) => m.marker === endMarker)
      .sort((a, b) => a.offsetMs - b.offsetMs)[0];
    if (start && end && end.offsetMs >= start.offsetMs) {
      valuesMs.push(end.offsetMs - start.offsetMs);
    } else if (start) {
      incompleteTraceIds.push(trace.traceId);
    }
  }
  return {
    observations: { metric, valuesMs },
    incompleteTraceIds,
  };
}

// ---------------------------------------------------------------------------
// The threshold evaluation (same-content, same-profile — or a typed refusal)
// ---------------------------------------------------------------------------

/** Why a comparison could not be evaluated (honest, never silent). */
export type PlaybackComparisonBlocker =
  | "content-mismatch"
  | "no-youtube-baseline"
  | "cache-pass-mismatch"
  | "environment-mismatch"
  | "missing-ttff-observations";

/** The TTFF percentile-delta report against the baseline. */
export interface TtffThresholdReport {
  readonly p50DeltaMs: number;
  readonly p75DeltaMs: number;
  readonly p95DeltaMs: number;
  readonly p50Within: boolean;
  readonly p75Within: boolean;
  readonly p95Within: boolean;
}

/** The complete R24-E threshold evaluation for one WebFlix run vs baseline. */
export interface PlaybackThresholdReport {
  readonly comparable: boolean;
  readonly blockers: readonly PlaybackComparisonBlocker[];
  readonly ttff?: TtffThresholdReport | undefined;
  readonly startupFailureRateDeltaPp?: number | undefined;
  readonly startupFailureRateWithin?: boolean | undefined;
  readonly first60sRebufferRatioDeltaPp?: number | undefined;
  readonly first60sRebufferRatioWithin?: boolean | undefined;
  readonly oneObviousPrimaryPlayAction: boolean;
  readonly nonessentialWorkBlockedFirstFrame: boolean;
  readonly fakeBufferingProgressObserved: boolean;
  readonly pass: boolean;
}

function durationObservationOf(
  run: PlaybackBenchmarkRun,
  metric: PlaybackDurationMetricId,
): PlaybackDurationObservations | undefined {
  return run.durationMetrics.find((obs) => obs.metric === metric);
}

function ratioObservationOf(
  run: PlaybackBenchmarkRun,
  metric: PlaybackRatioMetricId,
): PlaybackRatioObservations | undefined {
  return run.ratioMetrics.find((obs) => obs.metric === metric);
}

/**
 * Evaluate the frozen R24-E thresholds for one WebFlix benchmark run
 * against the same-content YouTube baseline run (PURE — folds observed
 * data, reports the truth, never fakes a pass).
 *
 * Comparability laws (J41: same content / same browser / same network
 * profile / same cache pass): a mismatch is a TYPED BLOCKER, not a silent
 * skip. The qualitative startup observations fold into `pass` — a run
 * whose play action is ambiguous, whose first frame waited on
 * nonessential work, or that faked buffering progress CANNOT pass,
 * regardless of the numbers.
 */
export function evaluatePlaybackThresholds(
  webflix: PlaybackBenchmarkRun,
  youtubeBaseline: PlaybackBenchmarkRun | undefined,
): PlaybackThresholdReport {
  const blockers: PlaybackComparisonBlocker[] = [];

  const webTtff = durationObservationOf(webflix, "click-to-first-frame");
  const ytTtff = youtubeBaseline
    ? durationObservationOf(youtubeBaseline, "click-to-first-frame")
    : undefined;

  if (!youtubeBaseline) {
    blockers.push("no-youtube-baseline");
  } else {
    if (
      webflix.content.contentId !== youtubeBaseline.content.contentId ||
      !webflix.content.samePublicContentOnYouTube ||
      !youtubeBaseline.content.samePublicContentOnYouTube
    ) {
      blockers.push("content-mismatch");
    }
    if (webflix.cachePass !== youtubeBaseline.cachePass) {
      blockers.push("cache-pass-mismatch");
    }
    const envMismatch =
      webflix.environment.browser !== youtubeBaseline.environment.browser ||
      webflix.environment.osDevice !== youtubeBaseline.environment.osDevice ||
      webflix.environment.viewport !== youtubeBaseline.environment.viewport ||
      webflix.environment.networkProfile !==
        youtubeBaseline.environment.networkProfile;
    if (envMismatch) blockers.push("environment-mismatch");
  }
  if (!webTtff || !ytTtff || webTtff.valuesMs.length === 0 || ytTtff.valuesMs.length === 0) {
    blockers.push("missing-ttff-observations");
  }

  const comparable = blockers.length === 0;

  // TTFF percentile deltas (WebFlix minus YouTube — positive = slower).
  let ttff: TtffThresholdReport | undefined;
  if (comparable && webTtff && ytTtff) {
    const webP50 = percentile(webTtff.valuesMs, 50);
    const webP75 = percentile(webTtff.valuesMs, 75);
    const webP95 = percentile(webTtff.valuesMs, 95);
    const ytP50 = percentile(ytTtff.valuesMs, 50);
    const ytP75 = percentile(ytTtff.valuesMs, 75);
    const ytP95 = percentile(ytTtff.valuesMs, 95);
    if (
      webP50 !== undefined && webP75 !== undefined && webP95 !== undefined &&
      ytP50 !== undefined && ytP75 !== undefined && ytP95 !== undefined
    ) {
      const p50 = webP50 - ytP50;
      const p75 = webP75 - ytP75;
      const p95 = webP95 - ytP95;
      ttff = {
        p50DeltaMs: p50,
        p75DeltaMs: p75,
        p95DeltaMs: p95,
        p50Within: p50 <= TTFF_MAX_DELTA_MS.p50,
        p75Within: p75 <= TTFF_MAX_DELTA_MS.p75,
        p95Within: p95 <= TTFF_MAX_DELTA_MS.p95,
      };
    }
  }

  // Startup failure rate delta (percentage points).
  const webFail = ratioObservationOf(webflix, "startup-failure-rate");
  const ytFail = youtubeBaseline
    ? ratioObservationOf(youtubeBaseline, "startup-failure-rate")
    : undefined;
  let startupFailureRateDeltaPp: number | undefined;
  let startupFailureRateWithin: boolean | undefined;
  if (
    comparable &&
    webFail &&
    ytFail &&
    webFail.attempts > 0 &&
    ytFail.attempts > 0
  ) {
    const webPp = ratioPercentagePoints(webFail)!;
    const ytPp = ratioPercentagePoints(ytFail)!;
    startupFailureRateDeltaPp = webPp - ytPp;
    startupFailureRateWithin =
      startupFailureRateDeltaPp <= STARTUP_FAILURE_RATE_MAX_DELTA_PP;
  }

  // First-60s rebuffer ratio delta (percentage points).
  const webRebuf = ratioObservationOf(webflix, "first-60s-rebuffer-ratio");
  const ytRebuf = youtubeBaseline
    ? ratioObservationOf(youtubeBaseline, "first-60s-rebuffer-ratio")
    : undefined;
  let first60sRebufferRatioDeltaPp: number | undefined;
  let first60sRebufferRatioWithin: boolean | undefined;
  if (
    comparable &&
    webRebuf &&
    ytRebuf &&
    webRebuf.attempts > 0 &&
    ytRebuf.attempts > 0
  ) {
    const webPp = ratioPercentagePoints(webRebuf)!;
    const ytPp = ratioPercentagePoints(ytRebuf)!;
    first60sRebufferRatioDeltaPp = webPp - ytPp;
    first60sRebufferRatioWithin =
      first60sRebufferRatioDeltaPp <= FIRST_60S_REBUFFER_RATIO_MAX_DELTA_PP;
  }

  // The qualitative J41 laws fold into pass — no number rescues them.
  const oneObviousPrimaryPlayAction =
    webflix.qualitative.oneObviousPrimaryPlayAction;
  const nonessentialWorkBlockedFirstFrame =
    webflix.qualitative.nonessentialWorkBlockedFirstFrame;
  const fakeBufferingProgressObserved =
    webflix.qualitative.fakeBufferingProgressObserved;

  const quantitativePass =
    comparable &&
    ttff !== undefined &&
    ttff.p50Within &&
    ttff.p75Within &&
    ttff.p95Within &&
    startupFailureRateWithin !== false &&
    first60sRebufferRatioWithin !== false;

  const pass =
    quantitativePass &&
    oneObviousPrimaryPlayAction &&
    !nonessentialWorkBlockedFirstFrame &&
    !fakeBufferingProgressObserved;

  return {
    comparable,
    blockers,
    ...(ttff !== undefined ? { ttff } : {}),
    ...(startupFailureRateDeltaPp !== undefined
      ? { startupFailureRateDeltaPp, startupFailureRateWithin }
      : {}),
    ...(first60sRebufferRatioDeltaPp !== undefined
      ? { first60sRebufferRatioDeltaPp, first60sRebufferRatioWithin }
      : {}),
    oneObviousPrimaryPlayAction,
    nonessentialWorkBlockedFirstFrame,
    fakeBufferingProgressObserved,
    pass,
  };
}
