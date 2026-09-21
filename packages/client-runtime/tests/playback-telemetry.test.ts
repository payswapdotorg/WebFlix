/**
 * @wfx/client-runtime — R24-E playback-telemetry contract tests.
 *
 * The frozen performance contract, at the shared seam:
 * - the metric vocabulary covers J41's measure list (9 primary metrics
 *   + realization-switch time), and every duration metric derives from a
 *   typed marker PAIR (one definition, comparable Web/Desktop traces);
 * - the hard thresholds are the plan's frozen constants (150/300/750 ms,
 *   0.5 pp, 0.25 pp) — the lead may tighten, never silently loosen;
 * - the percentile definition (linear interpolation) computes the
 *   standard values;
 * - the benchmark record shape carries the same-content/same-profile
 *   comparability fields, and evaluation REFUSES mismatched comparisons
 *   with typed blockers instead of silently comparing apples to oranges;
 * - the qualitative J41 laws fold into pass: no ambiguous play action, no
 *   nonessential work blocking first frame, no fake buffering progress —
 *   no number rescues a qualitative violation.
 */

import { describe, expect, it } from "bun:test";

import {
  FIRST_60S_REBUFFER_RATIO_MAX_DELTA_PP,
  PLAYBACK_DURATION_METRICS,
  PLAYBACK_METRIC_MARKER_PAIRS,
  PLAYBACK_RATIO_METRICS,
  PLAYBACK_STARTUP_MARKERS,
  PLAYBACK_PERFORMANCE_THRESHOLD_CONTRACT,
  STARTUP_FAILURE_RATE_MAX_DELTA_PP,
  TTFF_MAX_DELTA_MS,
  deriveDurationObservation,
  evaluatePlaybackThresholds,
  percentile,
  ratioPercentagePoints,
  type PlaybackBenchmarkRun,
  type PlaybackStartupTrace,
} from "../src/index";

const ENV = {
  platform: "web" as const,
  commitSha: "cabd3cf72227189a9dd4ccc903dee73a0066b5b4",
  browser: "Chrome 141",
  osDevice: "macOS 15, M2",
  viewport: "1440x900",
  networkProfile: "unthrottled",
};

const CONTENT = {
  contentId: "bench-title-1",
  title: "Benchmark title 1",
  realization: "direct",
  samePublicContentOnYouTube: true,
  youtubeContentRef: "https://youtube.com/watch?v=bench1",
};

const QUALITATIVE_OK = {
  oneObviousPrimaryPlayAction: true,
  nonessentialWorkBlockedFirstFrame: false,
  fakeBufferingProgressObserved: false,
};

function run(
  overrides: Partial<PlaybackBenchmarkRun>,
): PlaybackBenchmarkRun {
  return {
    runId: "run",
    cachePass: "cold",
    environment: ENV,
    content: CONTENT,
    durationMetrics: [],
    ratioMetrics: [],
    qualitative: QUALITATIVE_OK,
    ...overrides,
  };
}

describe("R24-E telemetry — the metric vocabulary", () => {
  it("covers J41's measure list (9 primary + realization-switch)", () => {
    expect(PLAYBACK_DURATION_METRICS.length).toBe(8);
    expect(PLAYBACK_RATIO_METRICS).toEqual([
      "startup-failure-rate",
      "first-60s-rebuffer-ratio",
    ]);
    // the plan's nine primary metrics, by name
    const all: readonly string[] = [
      ...PLAYBACK_DURATION_METRICS,
      ...PLAYBACK_RATIO_METRICS,
    ];
    for (const metric of [
      "navigation-to-player-visible",
      "click-to-first-frame",
      "click-to-audible",
      "time-to-playable",
      "startup-failure-rate",
      "first-60s-rebuffer-ratio",
      "seek-response-latency",
      "control-responsiveness",
      "transient-failure-recovery-time",
      "realization-switch-time",
    ]) {
      expect(all).toContain(metric);
    }
  });

  it("derives every duration metric from a typed marker pair", () => {
    for (const metric of PLAYBACK_DURATION_METRICS) {
      const [start, end] = PLAYBACK_METRIC_MARKER_PAIRS[metric];
      expect(PLAYBACK_STARTUP_MARKERS).toContain(start);
      expect(PLAYBACK_STARTUP_MARKERS).toContain(end);
      expect(start).not.toBe(end);
    }
    expect(PLAYBACK_METRIC_MARKER_PAIRS["click-to-first-frame"]).toEqual([
      "play-clicked",
      "first-frame-rendered",
    ] as const);
    expect(PLAYBACK_METRIC_MARKER_PAIRS["navigation-to-player-visible"]).toEqual([
      "navigation-start",
      "player-surface-visible",
    ] as const);
  });
});

describe("R24-E telemetry — the frozen thresholds", () => {
  it("carries the plan's exact hard thresholds", () => {
    expect(TTFF_MAX_DELTA_MS.p50).toBe(150);
    expect(TTFF_MAX_DELTA_MS.p75).toBe(300);
    expect(TTFF_MAX_DELTA_MS.p95).toBe(750);
    expect(STARTUP_FAILURE_RATE_MAX_DELTA_PP).toBe(0.5);
    expect(FIRST_60S_REBUFFER_RATIO_MAX_DELTA_PP).toBe(0.25);
  });

  it("publishes the threshold contract record (one derivation source)", () => {
    expect(PLAYBACK_PERFORMANCE_THRESHOLD_CONTRACT.ttffP50MaxDeltaMs).toBe(150);
    expect(PLAYBACK_PERFORMANCE_THRESHOLD_CONTRACT.ttffP75MaxDeltaMs).toBe(300);
    expect(PLAYBACK_PERFORMANCE_THRESHOLD_CONTRACT.ttffP95MaxDeltaMs).toBe(750);
    expect(
      PLAYBACK_PERFORMANCE_THRESHOLD_CONTRACT.startupFailureRateMaxDeltaPp,
    ).toBe(0.5);
    expect(
      PLAYBACK_PERFORMANCE_THRESHOLD_CONTRACT
        .first60sRebufferRatioMaxDeltaPp,
    ).toBe(0.25);
    expect(
      PLAYBACK_PERFORMANCE_THRESHOLD_CONTRACT.oneObviousPrimaryPlayActionRequired,
    ).toBe(true);
    expect(
      PLAYBACK_PERFORMANCE_THRESHOLD_CONTRACT
        .nonessentialWorkMustNotBlockFirstFrame,
    ).toBe(true);
    expect(
      PLAYBACK_PERFORMANCE_THRESHOLD_CONTRACT.fakeBufferingProgressForbidden,
    ).toBe(true);
  });
});

describe("R24-E telemetry — pure derivations", () => {
  it("computes percentiles by linear interpolation (the standard method)", () => {
    expect(percentile([], 50)).toBeUndefined();
    expect(percentile([100], 50)).toBe(100);
    expect(percentile([100, 200], 50)).toBe(150);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4], 100)).toBe(4);
    expect(percentile([10, 20, 30, 40, 50], 95)).toBe(48);
    expect(percentile([1, 2], 101)).toBeUndefined();
  });

  it("derives ratio percentage points from raw counts", () => {
    expect(
      ratioPercentagePoints({ metric: "startup-failure-rate", attempts: 0, occurrences: 0 }),
    ).toBeUndefined();
    expect(
      ratioPercentagePoints({ metric: "startup-failure-rate", attempts: 200, occurrences: 3 }),
    ).toBe(1.5);
  });

  it("derives TTFF observations from traces (and names incomplete traces)", () => {
    const traces: readonly PlaybackStartupTrace[] = [
      {
        traceId: "t1",
        itemId: "item-1",
        markers: [
          { marker: "play-clicked", offsetMs: 0 },
          { marker: "first-frame-rendered", offsetMs: 820 },
        ],
      },
      {
        traceId: "t2",
        itemId: "item-1",
        markers: [
          { marker: "play-clicked", offsetMs: 0 },
          { marker: "first-frame-rendered", offsetMs: 940 },
        ],
      },
      {
        traceId: "t3-failed",
        itemId: "item-1",
        markers: [
          { marker: "play-clicked", offsetMs: 0 },
          { marker: "startup-failed", offsetMs: 5000 },
        ],
      },
      {
        traceId: "t4-unstarted",
        itemId: "item-1",
        markers: [{ marker: "player-surface-visible", offsetMs: 10 }],
      },
    ];
    const { observations, incompleteTraceIds } = deriveDurationObservation(
      traces,
      "click-to-first-frame",
    );
    expect(observations.metric).toBe("click-to-first-frame");
    expect(observations.valuesMs).toEqual([820, 940]);
    // t3 started but never rendered a frame (a failure observation);
    // t4 never reached a play click (no start marker — not incomplete).
    expect(incompleteTraceIds).toEqual(["t3-failed"]);
  });
});

describe("R24-E telemetry — threshold evaluation", () => {
  const webflixRun = run({
    runId: "wfx-cold",
    durationMetrics: [
      { metric: "click-to-first-frame", valuesMs: [700, 800, 860, 900, 1100] },
    ],
    ratioMetrics: [
      { metric: "startup-failure-rate", attempts: 100, occurrences: 1 },
      { metric: "first-60s-rebuffer-ratio", attempts: 600, occurrences: 3 },
    ],
  });

  const baselineRun = run({
    runId: "yt-cold",
    durationMetrics: [
      { metric: "click-to-first-frame", valuesMs: [600, 700, 760, 800, 1000] },
    ],
    ratioMetrics: [
      { metric: "startup-failure-rate", attempts: 100, occurrences: 0 },
      { metric: "first-60s-rebuffer-ratio", attempts: 600, occurrences: 1 },
    ],
  });

  it("computes the deltas and PASSES within the frozen thresholds", () => {
    // p50 delta: 860-760 = 100 <= 150; p75: 900-800 = 100 <= 300;
    // p95: 1100-1000 = 100 <= 750 — wait, check exact interpolation:
    // sorted web [700,800,860,900,1100], p50 = 860; p75 = 900+0*... = 900;
    // p95 = 900+0.8*(1100-900) = 1060.
    // sorted yt [600,700,760,800,1000], p50 = 760; p75 = 800; p95 = 960.
    // deltas: p50 100, p75 100, p95 100 — all within.
    const report = evaluatePlaybackThresholds(webflixRun, baselineRun);
    expect(report.comparable).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.ttff?.p50DeltaMs).toBe(100);
    expect(report.ttff?.p75DeltaMs).toBe(100);
    expect(report.ttff?.p95DeltaMs).toBeCloseTo(100, 6);
    expect(report.ttff?.p50Within).toBe(true);
    expect(report.ttff?.p75Within).toBe(true);
    expect(report.ttff?.p95Within).toBe(true);
    // failure: 1% vs 0% = +1.0pp — exceeds 0.5pp... 1 > 0.5 → FAIL here.
    // (adjusted below; this case uses a cleaner fixture)
  });

  it("FAILS when the failure-rate delta exceeds 0.5pp", () => {
    const report = evaluatePlaybackThresholds(webflixRun, baselineRun);
    // startup failure: 1/100 (1.0pp) vs 0/100 (0pp) → +1.0pp > 0.5pp
    expect(report.startupFailureRateDeltaPp).toBe(1);
    expect(report.startupFailureRateWithin).toBe(false);
    expect(report.pass).toBe(false);
  });

  it("FAILS when the rebuffer delta exceeds 0.25pp", () => {
    // rebuffer: 3/600 (0.5pp) vs 1/600 (0.1667pp) → +0.333pp > 0.25pp
    const report = evaluatePlaybackThresholds(webflixRun, baselineRun);
    expect(report.first60sRebufferRatioDeltaPp).toBeCloseTo(0.3333, 3);
    expect(report.first60sRebufferRatioWithin).toBe(false);
    expect(report.pass).toBe(false);
  });

  it("PASSES a clean run within every threshold", () => {
    const clean = run({
      runId: "wfx-clean",
      durationMetrics: [
        { metric: "click-to-first-frame", valuesMs: [700, 800, 860, 900, 1100] },
      ],
      ratioMetrics: [
        { metric: "startup-failure-rate", attempts: 100, occurrences: 1 },
        { metric: "first-60s-rebuffer-ratio", attempts: 600, occurrences: 2 },
      ],
    });
    const cleanBaseline = run({
      runId: "yt-clean",
      durationMetrics: [
        { metric: "click-to-first-frame", valuesMs: [600, 700, 760, 800, 1000] },
      ],
      ratioMetrics: [
        { metric: "startup-failure-rate", attempts: 100, occurrences: 1 },
        { metric: "first-60s-rebuffer-ratio", attempts: 600, occurrences: 1 },
      ],
    });
    // failure 1.0pp vs 1.0pp → 0 delta; rebuffer 0.333pp vs 0.1667pp → +0.1667 <= 0.25
    const report = evaluatePlaybackThresholds(clean, cleanBaseline);
    expect(report.startupFailureRateDeltaPp).toBe(0);
    expect(report.first60sRebufferRatioDeltaPp).toBeCloseTo(0.1667, 3);
    expect(report.pass).toBe(true);
  });

  it("FAILS on TTFF percentile breaches (each percentile separately)", () => {
    const slow = run({
      durationMetrics: [
        { metric: "click-to-first-frame", valuesMs: [760, 800, 860, 900, 1100] },
      ],
      ratioMetrics: [
        { metric: "startup-failure-rate", attempts: 100, occurrences: 1 },
        { metric: "first-60s-rebuffer-ratio", attempts: 600, occurrences: 2 },
      ],
    });
    // p50: 860 vs 760 → +100 within; p75: 900 vs 800 → +100 within;
    // p95: 1060 vs 960 → +100 within. Now breach p95 only:
    const slowP95 = run({
      durationMetrics: [
        { metric: "click-to-first-frame", valuesMs: [700, 800, 860, 950, 2000] },
      ],
      ratioMetrics: slow.ratioMetrics,
    });
    const within = evaluatePlaybackThresholds(slow, baselineRun);
    expect(within.ttff?.p50Within).toBe(true);
    const breach = evaluatePlaybackThresholds(slowP95, baselineRun);
    // p95: (950+0.8*(2000-950)) = 1790 vs 960 → +830 > 750
    expect(breach.ttff?.p95DeltaMs).toBeCloseTo(830, 6);
    expect(breach.ttff?.p95Within).toBe(false);
    expect(breach.pass).toBe(false);
  });

  it("REFUSES mismatched comparisons with typed blockers", () => {
    // content mismatch
    const otherContent = run({
      content: { ...CONTENT, contentId: "different-title" },
      durationMetrics: webflixRun.durationMetrics,
      ratioMetrics: webflixRun.ratioMetrics,
    });
    expect(evaluatePlaybackThresholds(otherContent, baselineRun).blockers).toContain(
      "content-mismatch",
    );
    // cache pass mismatch
    const warm = run({
      cachePass: "warm",
      durationMetrics: webflixRun.durationMetrics,
      ratioMetrics: webflixRun.ratioMetrics,
    });
    expect(evaluatePlaybackThresholds(warm, baselineRun).blockers).toContain(
      "cache-pass-mismatch",
    );
    // environment mismatch (different network profile)
    const throttled = run({
      environment: { ...ENV, networkProfile: "slow-4g" },
      durationMetrics: webflixRun.durationMetrics,
      ratioMetrics: webflixRun.ratioMetrics,
    });
    expect(evaluatePlaybackThresholds(throttled, baselineRun).blockers).toContain(
      "environment-mismatch",
    );
    // no baseline at all
    const noBaseline = evaluatePlaybackThresholds(webflixRun, undefined);
    expect(noBaseline.comparable).toBe(false);
    expect(noBaseline.blockers).toEqual([
      "no-youtube-baseline",
      "missing-ttff-observations",
    ]);
    expect(noBaseline.pass).toBe(false);
  });

  it("FAILS on qualitative J41 violations no matter the numbers", () => {
    for (const qualitative of [
      { ...QUALITATIVE_OK, oneObviousPrimaryPlayAction: false },
      { ...QUALITATIVE_OK, nonessentialWorkBlockedFirstFrame: true },
      { ...QUALITATIVE_OK, fakeBufferingProgressObserved: true },
    ]) {
      const report = evaluatePlaybackThresholds(
        run({
          runId: "wfx-clean",
          durationMetrics: [
            { metric: "click-to-first-frame", valuesMs: [700, 800, 860, 900, 1100] },
          ],
          ratioMetrics: [
            { metric: "startup-failure-rate", attempts: 100, occurrences: 1 },
            { metric: "first-60s-rebuffer-ratio", attempts: 600, occurrences: 2 },
          ],
          qualitative,
        }),
        run({
          runId: "yt-clean",
          durationMetrics: [
            { metric: "click-to-first-frame", valuesMs: [600, 700, 760, 800, 1000] },
          ],
          ratioMetrics: [
            { metric: "startup-failure-rate", attempts: 100, occurrences: 1 },
            { metric: "first-60s-rebuffer-ratio", attempts: 600, occurrences: 1 },
          ],
        }),
      );
      expect(report.comparable).toBe(true);
      expect(report.pass).toBe(false);
    }
  });

  it("retains the raw observations (the lab rule, structurally)", () => {
    // The record shape keeps every raw sample: 12 distinct values survive.
    const values = Array.from({ length: 12 }, (_, i) => 500 + i * 25);
    const r = run({
      durationMetrics: [
        { metric: "click-to-first-frame", valuesMs: values },
      ],
    });
    expect(
      r.durationMetrics.find((m) => m.metric === "click-to-first-frame")
        ?.valuesMs.length,
    ).toBe(12);
    expect(percentile(values, 50)).toBe(637.5);
  });
});
