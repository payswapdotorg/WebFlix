/**
 * WFX-041 — QoE/recommendation telemetry tests (Lane A — intelligence).
 *
 * Coverage (the task packet's law):
 * - Derivation goldens from fixture trails/events/pages, including a
 *   degraded case (absent fields ⇒ typed markers, never fabricated values).
 * - Percentile determinism + the documented inclusive interpolation.
 * - Aggregation: exact window bucketing; merge associativity
 *   ((a+b)+c == a+(b+c) byte-identical reports) and idempotency.
 * - AttentionModeCompliance: crafted violating feeds ⇒ violations > 0 (the
 *   metric MUST catch violations); compliant feeds ⇒ 0; the real WFX-021
 *   pipeline under a mindful policy verifies compliant.
 * - CandidateSurvival: anti-tunnel-vision fixture ⇒ survival 1; narrowing
 *   fixture ⇒ low survival with the signal visible (narrowed).
 * - Redaction: each level's transformations + typed small-n suppression.
 * - Report serialization round-trip (JSON.parse(JSON.stringify) equality).
 */

import { describe, expect, it } from "bun:test";

import {
  // WFX-041 telemetry under test
  aggregateMetrics,
  assertValidMetric,
  boundedSketch,
  canonicalJson,
  cohortOf,
  COHORT_COUNT,
  createRecorderSink,
  createWindowedAggregator,
  deriveEngagement,
  deriveQoe,
  deriveRecommendation,
  instanceKey,
  mergeAggregations,
  METRIC_KINDS,
  MIN_SAMPLES_FOR_RATE,
  PERCENTILE_SKETCH_CAP,
  percentile,
  pseudonymizeSessionId,
  QUALITY_SWITCH_PAYLOAD_KEY,
  redactMetrics,
  REORDER_DECISION_KINDS,
  SEEK_LATENCY_MS_PAYLOAD_KEY,
  TELEMETRY_REPORT_SCHEMA_VERSION,
  TelemetryError,
  telemetryReport,
  windowInstances,
  windowStartOf,
  type Aggregation,
  type DeriveRecommendationOptions,
  type PlaybackSessionTrail,
  type QoeMetricSet,
  type RecommendationMetricSet,
  type RedactionLevel,
  type ReportMetricSummary,
  type SessionSample,
  type TelemetryClock,
  type TelemetryMetric,
} from "../src/index";

// WFX-021 — the real merged pipeline (read-only inputs here): used to prove
// telemetry compliance verification against actual pipeline output.
import { runRecommendation } from "../src/index";

import type {
  EntertainmentCandidate,
  EntertainmentEvent,
  RecommendationPolicy,
  UserIntent,
} from "@wfx/domain";
import type {
  FeedCard,
  FeedPage,
  TraceDecision,
  TraceDecisionKind,
} from "../src/index";

// ---------------------------------------------------------------------------
// Fixtures + helpers (deterministic — no clocks, no randomness)
// ---------------------------------------------------------------------------

const T0 = "2026-09-13T12:00:00.000Z";
const T0_EPOCH = Date.parse(T0);
/** The injected clock fixture: a constant instant. */
const clock: TelemetryClock = () => T0;
/** Another fixed instant (a later one — for latest-wins merge tests). */
const T1 = "2026-09-13T12:04:00.000Z";
const clockLater: TelemetryClock = () => T1;

/** Canonical-shaped hand-authored item id: wfxitm_ + 26-char body. */
function cid(n: number): string {
  return `wfxitm_01ARZ3NDEKF1XTVRE${String(n).padStart(9, "0")}`;
}

/** An engagement event literal. */
function event(
  sessionId: string,
  itemId: number,
  type: EntertainmentEvent["type"],
  occurredAt: string,
  payload?: Record<string, unknown>,
  userId: string = "wfx-user-1",
): EntertainmentEvent {
  const base: EntertainmentEvent = {
    userId,
    itemId: cid(itemId),
    type,
    occurredAt,
    sessionId,
  };
  if (payload !== undefined) base.payload = payload;
  return base;
}

/** A timed frozen native-media session snapshot. */
function sample(
  at: string,
  state: SessionSample["session"]["state"],
  bufferedMs: number,
  positionMs: number,
): SessionSample {
  return {
    at,
    session: {
      id: "wfxnms_01ARZ3NDEKF1XTVRE000000001",
      assetId: "wfxast_01ARZ3NDEKF1XTVRE000000001",
      fileId: "wfxfile_01ARZ3NDEKF1XTVRE000000001",
      state,
      bufferedMs,
      positionMs,
    },
  };
}

/** The golden QoE trail: a healthy session with one stall report. */
function goldenTrail(): PlaybackSessionTrail {
  return {
    sessionId: "wfxpses-1",
    userId: "wfx-user-1",
    events: [
      event("wfxpses-1", 1, "start", "2026-09-13T12:00:00.000Z"),
      event("wfxpses-1", 1, "progress", "2026-09-13T12:00:02.500Z", {
        positionMs: 2000,
        stallMs: 0,
        seekLatencyMs: 120,
        qualitySwitch: false,
      }),
      event("wfxpses-1", 1, "progress", "2026-09-13T12:00:10.000Z", {
        positionMs: 8000,
        stallMs: 800,
        qualitySwitch: true,
      }),
      event("wfxpses-1", 1, "complete", "2026-09-13T12:01:00.000Z", {
        positionMs: 60000,
        stallMs: 0,
        qualitySwitch: false,
      }),
    ],
    samples: [
      sample("2026-09-13T12:00:00.000Z", "resolving", 0, 0),
      sample("2026-09-13T12:00:02.000Z", "buffering", 5000, 0),
      sample("2026-09-13T12:00:02.500Z", "playing", 5000, 0),
      sample("2026-09-13T12:00:12.500Z", "playing", 25000, 10000),
      sample("2026-09-13T12:00:20.000Z", "playing", 40000, 18000),
      sample("2026-09-13T12:01:00.000Z", "complete", 60000, 60000),
    ],
  };
}

/** Runs fn expecting a typed TelemetryError; returns the error. */
function expectTelemetryError(fn: () => unknown): TelemetryError {
  try {
    fn();
  } catch (error) {
    const telemetryError = error as TelemetryError;
    expect(telemetryError).toBeInstanceOf(TelemetryError);
    expect(telemetryError.kind).toBe("invalid-input");
    expect(telemetryError.details.length).toBeGreaterThan(0);
    return telemetryError;
  }
  throw new Error("expected a TelemetryError to be thrown");
}

/** The five QoE units of one metric set as a flat array. */
function qoeMetricArray(set: QoeMetricSet): TelemetryMetric[] {
  return [
    set.rebufferRatio,
    set.joinTimeMs,
    set.seekLatencyMs,
    set.qualitySwitchCount,
    set.bufferHealthMs,
  ];
}

// --- synthetic feed-page fixtures -------------------------------------------

/** A hand-built feed card (the validation contract: position/candidate/…). */
function card(over: {
  itemId: number;
  objective: string | null;
  explanations?: string[];
  nextEpisodeOf?: number;
  position: number;
}): FeedCard {
  const features: Record<string, number | string | boolean> = {
    canonicalType: "video",
    canonicalTitle: `Item ${over.itemId}`,
  };
  if (over.nextEpisodeOf !== undefined) features.nextEpisodeOf = cid(over.nextEpisodeOf);
  return {
    position: over.position,
    candidate: {
      itemId: cid(over.itemId),
      realization: {
        connectorId: "wfx-test-native",
        externalRef: `ref-${over.itemId}`,
        capabilities: ["identity", "playNative"],
        availability: "available",
      },
      features,
    },
    modelScore: 0.5,
    confidence: 0.5,
    explanations: over.explanations ?? [],
    dominantObjective: over.objective,
    positionReasons: ["fixture"],
  };
}

/** A minimal six-stage trace with the given retrieval/composition counts. */
function traceFixture(
  retrievalOut: number,
  compositionOut: number,
  decisions: { stage: string; kind: TraceDecisionKind; detail: string }[] = [],
): FeedPage["trace"] {
  return {
    model: { id: "wfx-test-model", version: "1.0.0" },
    stages: [
      { stage: "retrieval", inputCount: retrievalOut, outputCount: retrievalOut, decisions: [] },
      { stage: "features", inputCount: retrievalOut, outputCount: retrievalOut, decisions: [] },
      { stage: "scoring", inputCount: retrievalOut, outputCount: retrievalOut, decisions: [] },
      { stage: "policy", inputCount: retrievalOut, outputCount: retrievalOut, decisions: [] },
      { stage: "diversity", inputCount: retrievalOut, outputCount: retrievalOut, decisions: [] },
      {
        stage: "composition",
        inputCount: compositionOut,
        outputCount: compositionOut,
        decisions: decisions.map(
          (decision): TraceDecision => ({
            kind: decision.kind,
            detail: decision.detail,
            itemIds: [],
          }),
        ),
      },
    ],
  };
}

/** A synthetic feed page (cards + trace). */
function page(
  sessionId: string,
  cards: readonly FeedCard[],
  retrievalOut: number,
  compositionOut: number,
  decisions: { stage: string; kind: TraceDecisionKind; detail: string }[] = [],
): FeedPage {
  return {
    surface: "watch",
    userId: "wfx-user-1",
    sessionId,
    cards,
    trace: traceFixture(retrievalOut, compositionOut, decisions),
  };
}

/** The mindful attention policy fixture. */
function mindfulPolicy(): RecommendationPolicy {
  return {
    id: "wfxpol_01ARZ3NDEKF1XT0P000000001",
    userId: "wfx-user-1",
    objectives: [],
    exploration: 0.5,
    novelty: 0.2,
    socialInfluence: 0.1,
    attentionMode: "mindful",
  };
}

/** Derive options with the mindful policy + events for a session. */
function mindfulOptions(
  sessionId: string,
  recentEvents: readonly EntertainmentEvent[] = [],
): DeriveRecommendationOptions {
  return {
    clock,
    policiesBySessionId: new Map([[sessionId, mindfulPolicy()]]),
    eventsBySessionId: new Map([[sessionId, [...recentEvents]]]),
  };
}

// ---------------------------------------------------------------------------
// deriveQoe — goldens
// ---------------------------------------------------------------------------

describe("deriveQoe — goldens from the fixture trail", () => {
  const metrics: QoeMetricSet = deriveQoe(goldenTrail(), { clock });

  it("RebufferRatio: payload-reported stallMs over sample-derived watchMs", () => {
    expect(metrics.rebufferRatio.kind).toBe("rebuffer-ratio");
    expect(metrics.rebufferRatio.value.status).toBe("ok");
    if (metrics.rebufferRatio.value.status !== "ok") throw new Error("unreachable");
    // watchMs = 10s + 7.5s + 40s of playing intervals; stallMs = 800 (payload).
    expect(metrics.rebufferRatio.value.payload.watchMs).toBe(57500);
    expect(metrics.rebufferRatio.value.payload.stallMs).toBe(800);
    expect(metrics.rebufferRatio.value.payload.ratio).toBe(800 / 57500);
  });

  it("JoinTimeMs: first start -> first progress", () => {
    expect(metrics.joinTimeMs.value.status).toBe("ok");
    if (metrics.joinTimeMs.value.status !== "ok") throw new Error("unreachable");
    expect(metrics.joinTimeMs.value.payload.joinTimeMs).toBe(2500);
  });

  it("SeekLatencyMs: the payload seek observations pool to the mean", () => {
    expect(metrics.seekLatencyMs.value.status).toBe("ok");
    if (metrics.seekLatencyMs.value.status !== "ok") throw new Error("unreachable");
    expect(metrics.seekLatencyMs.value.payload.seekCount).toBe(1);
    expect(metrics.seekLatencyMs.value.payload.meanLatencyMs).toBe(120);
  });

  it("QualitySwitchCount: explicit reports count switches (false reports count 0)", () => {
    expect(metrics.qualitySwitchCount.value.status).toBe("ok");
    if (metrics.qualitySwitchCount.value.status !== "ok") throw new Error("unreachable");
    expect(metrics.qualitySwitchCount.value.payload.reportingEvents).toBe(3);
    expect(metrics.qualitySwitchCount.value.payload.switchCount).toBe(1);
  });

  it("BufferHealthMs: p50/p95 over playback-state buffer-ahead samples", () => {
    expect(metrics.bufferHealthMs.value.status).toBe("ok");
    if (metrics.bufferHealthMs.value.status !== "ok") throw new Error("unreachable");
    // Samples: 5000, 15000, 22000 (playing states only).
    expect(metrics.bufferHealthMs.value.payload.samples).toEqual([5000, 15000, 22000]);
    expect(metrics.bufferHealthMs.value.payload.p50).toBe(15000);
    expect(metrics.bufferHealthMs.value.payload.p95).toBe(21300);
  });

  it("every metric carries provenance + the injected computedAt", () => {
    for (const metric of [
      metrics.rebufferRatio,
      metrics.joinTimeMs,
      metrics.seekLatencyMs,
      metrics.qualitySwitchCount,
      metrics.bufferHealthMs,
    ] as const) {
      expect(metric.computedAt).toBe(T0);
      expect(metric.provenance.sessionId).toBe("wfxpses-1");
      expect(metric.provenance.userId).toBe("wfx-user-1");
      expect(metric.provenance.instanceId).toBe("wfxpses-1");
      expect(metric.provenance.rangeStart).toBe("2026-09-13T12:00:00.000Z");
      expect(metric.provenance.rangeEnd).toBe("2026-09-13T12:01:00.000Z");
      expect(metric.provenance.observationCount).toBeGreaterThanOrEqual(0);
    }
  });

  it("determinism: identical (trail, clock) yields identical metrics", () => {
    const again = deriveQoe(goldenTrail(), { clock });
    expect(canonicalJson(again)).toBe(canonicalJson(metrics));
  });
});

describe("deriveQoe — the degraded case (absent fields ⇒ typed markers)", () => {
  it("a bare trail degrades all five metrics, naming the absent fields", () => {
    const metrics = deriveQoe({ sessionId: "wfxpses-2", userId: "wfx-user-1" }, { clock });
    expect(metrics.rebufferRatio.value.status).toBe("degraded");
    expect(metrics.rebufferRatio.provenance.missingFields).toContain("samples");
    expect(metrics.joinTimeMs.value.status).toBe("degraded");
    expect(metrics.joinTimeMs.provenance.missingFields).toContain("events");
    expect(metrics.seekLatencyMs.value.status).toBe("degraded");
    expect(metrics.seekLatencyMs.provenance.missingFields).toContain(
      `payload.${SEEK_LATENCY_MS_PAYLOAD_KEY}`,
    );
    expect(metrics.qualitySwitchCount.value.status).toBe("degraded");
    expect(metrics.qualitySwitchCount.provenance.missingFields).toContain(
      `payload.${QUALITY_SWITCH_PAYLOAD_KEY}`,
    );
    expect(metrics.bufferHealthMs.value.status).toBe("degraded");
    expect(metrics.bufferHealthMs.provenance.missingFields).toContain("samples");
    // Degraded values carry NO numbers — never fabricated.
    if (metrics.rebufferRatio.value.status === "degraded") {
      expect(typeof metrics.rebufferRatio.value.reason).toBe("string");
      expect(metrics.rebufferRatio.value.reason.length).toBeGreaterThan(0);
    }
  });

  it("events without a start degrade join time naming events.start", () => {
    const trail: PlaybackSessionTrail = {
      sessionId: "wfxpses-3",
      userId: "wfx-user-1",
      events: [event("wfxpses-3", 1, "progress", "2026-09-13T12:00:05.000Z")],
    };
    const metrics = deriveQoe(trail, { clock });
    expect(metrics.joinTimeMs.value.status).toBe("degraded");
    expect(metrics.joinTimeMs.provenance.missingFields).toContain("events.start");
  });

  it("samples that never reach playing degrade the rebuffer ratio (zero denominator)", () => {
    const trail: PlaybackSessionTrail = {
      sessionId: "wfxpses-4",
      userId: "wfx-user-1",
      samples: [
        sample("2026-09-13T12:00:00.000Z", "resolving", 0, 0),
        sample("2026-09-13T12:00:05.000Z", "buffering", 1000, 0),
      ],
    };
    const metrics = deriveQoe(trail, { clock });
    expect(metrics.rebufferRatio.value.status).toBe("degraded");
    expect(metrics.bufferHealthMs.value.status).toBe("degraded");
  });

  it("invalid payload values are skipped and disclosed, never coerced", () => {
    const trail: PlaybackSessionTrail = {
      sessionId: "wfxpses-5",
      userId: "wfx-user-1",
      events: [
        event("wfxpses-5", 1, "start", "2026-09-13T12:00:00.000Z"),
        event("wfxpses-5", 1, "progress", "2026-09-13T12:00:01.000Z", {
          stallMs: "not-a-number",
          seekLatencyMs: -5,
          qualitySwitch: "yes",
        }),
      ],
    };
    const metrics = deriveQoe(trail, { clock });
    // All three payload observations are invalid: seek degrades (no valid
    // observations), quality degrades (no valid reports), and the stall
    // fields are listed as missing/invalid in the ratio's provenance.
    expect(metrics.seekLatencyMs.value.status).toBe("degraded");
    expect(metrics.qualitySwitchCount.value.status).toBe("degraded");
    expect(metrics.seekLatencyMs.provenance.missingFields).toContain(
      `payload.${SEEK_LATENCY_MS_PAYLOAD_KEY}(invalid)`,
    );
    expect(metrics.qualitySwitchCount.provenance.missingFields).toContain(
      `payload.${QUALITY_SWITCH_PAYLOAD_KEY}(invalid)`,
    );
    expect(metrics.joinTimeMs.value.status).toBe("ok");
  });

  it("malformed input throws the typed error (never fake success)", () => {
    expectTelemetryError(() =>
      deriveQoe(
        {
          sessionId: "wfxpses-6",
          userId: "wfx-user-1",
          events: [event("OTHER-session", 1, "start", "2026-09-13T12:00:00.000Z")],
        },
        { clock },
      ),
    );
    expectTelemetryError(() =>
      deriveQoe(
        {
          sessionId: "wfxpses-6",
          userId: "wfx-user-1",
          events: [
            {
              userId: "wfx-user-1",
              itemId: "not-canonical",
              type: "start",
              occurredAt: "2026-09-13T12:00:00.000Z",
              sessionId: "wfxpses-6",
            },
          ],
        },
        { clock },
      ),
    );
    expectTelemetryError(() =>
      deriveQoe(goldenTrail(), { clock: () => "not-an-iso-instant" }),
    );
    expectTelemetryError(() =>
      deriveQoe(
        {
          sessionId: "wfxpses-7",
          userId: "wfx-user-1",
          samples: [
            // Deliberate runtime garbage: a state outside the frozen union
            // (the type lie simulates untrusted input — validation must catch it).
            {
              at: "2026-09-13T12:00:00.000Z",
              session: {
                id: "x",
                assetId: "y",
                fileId: "z",
                state: "teleporting" as unknown as SessionSample["session"]["state"],
                bufferedMs: 0,
                positionMs: 0,
              },
            },
          ],
        },
        { clock },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// deriveRecommendation
// ---------------------------------------------------------------------------

describe("deriveRecommendation — explanation coverage, diversity, rerank", () => {
  const cards = [
    card({ itemId: 1, objective: "sci-fi", explanations: ["matches session intent sci-fi"], position: 0 }),
    card({ itemId: 2, objective: "sci-fi", explanations: ["fresh release"], position: 1 }),
    card({ itemId: 3, objective: "documentary", explanations: [], position: 2 }),
    card({ itemId: 4, objective: null, explanations: ["unseen exploration pick"], position: 3 }),
  ];
  const metrics: RecommendationMetricSet = deriveRecommendation(
    [page("wfxfeed-1", cards, 4, 4, [
      { stage: "composition", kind: "objective-run-break", detail: "fixture decision" },
      { stage: "composition", kind: "attention-policy", detail: "fixture declaration" },
    ])],
    { clock },
  )[0]!;

  it("ExplanationCoverage: covered cards / feed size + bounded verbatim evidence", () => {
    expect(metrics.explanationCoverage.value.status).toBe("ok");
    if (metrics.explanationCoverage.value.status !== "ok") throw new Error("unreachable");
    expect(metrics.explanationCoverage.value.payload.coveredCards).toBe(3);
    expect(metrics.explanationCoverage.value.payload.totalCards).toBe(4);
    expect(metrics.explanationCoverage.value.payload.coverage).toBe(0.75);
    expect(metrics.explanationCoverage.value.payload.sampleExplanations).toEqual([
      "matches session intent sci-fi",
      "fresh release",
      "unseen exploration pick",
    ]);
  });

  it("DiversityIndex: distinct dominant objectives / feed size", () => {
    expect(metrics.diversityIndex.value.status).toBe("ok");
    if (metrics.diversityIndex.value.status !== "ok") throw new Error("unreachable");
    expect(metrics.diversityIndex.value.payload.distinctObjectives).toBe(2);
    expect(metrics.diversityIndex.value.payload.index).toBe(0.5);
  });

  it("RerankFrequency: reordering decisions / feed size (closed kind set)", () => {
    expect(metrics.rerankFrequency.value.status).toBe("ok");
    if (metrics.rerankFrequency.value.status !== "ok") throw new Error("unreachable");
    expect(metrics.rerankFrequency.value.payload.rerankDecisions).toBe(1);
    expect(metrics.rerankFrequency.value.payload.frequency).toBe(0.25);
    // The closed reorder vocabulary excludes declarations and residuals.
    expect(REORDER_DECISION_KINDS).toContain("objective-run-break");
    expect(REORDER_DECISION_KINDS).not.toContain("attention-policy");
    expect(REORDER_DECISION_KINDS).not.toContain("position");
  });

  it("CandidateSurvival: the anti-tunnel-vision fixture survives intact", () => {
    expect(metrics.candidateSurvival.value.status).toBe("ok");
    if (metrics.candidateSurvival.value.status !== "ok") throw new Error("unreachable");
    expect(metrics.candidateSurvival.value.payload.retrieved).toBe(4);
    expect(metrics.candidateSurvival.value.payload.surviving).toBe(4);
    expect(metrics.candidateSurvival.value.payload.survival).toBe(1);
    expect(metrics.candidateSurvival.value.payload.narrowed).toBe(false);
  });

  it("an empty feed degrades coverage/diversity/rerank (never fabricates)", () => {
    const empty = deriveRecommendation([page("wfxfeed-2", [], 0, 0)], { clock })[0]!;
    expect(empty.explanationCoverage.value.status).toBe("degraded");
    expect(empty.diversityIndex.value.status).toBe("degraded");
    expect(empty.rerankFrequency.value.status).toBe("degraded");
    expect(empty.candidateSurvival.value.status).toBe("degraded");
    expect(empty.attentionModeCompliance.value.status).toBe("degraded");
  });
});

describe("deriveRecommendation — CandidateSurvival anti-tunnel-vision signal", () => {
  it("the narrowing fixture: low survival + the narrowed signal visible", () => {
    // 10 candidates retrieved, only 3 reach the feed — tunnel vision.
    const cards = [
      card({ itemId: 1, objective: "sci-fi", position: 0 }),
      card({ itemId: 2, objective: "sci-fi", position: 1 }),
      card({ itemId: 3, objective: "sci-fi", position: 2 }),
    ];
    const metrics = deriveRecommendation([page("wfxfeed-3", cards, 10, 3)], { clock })[0]!;
    expect(metrics.candidateSurvival.value.status).toBe("ok");
    if (metrics.candidateSurvival.value.status !== "ok") throw new Error("unreachable");
    expect(metrics.candidateSurvival.value.payload.survival).toBe(0.3);
    expect(metrics.candidateSurvival.value.payload.narrowed).toBe(true);
  });

  it("a missing composition stage degrades survival naming the absent field", () => {
    const broken: FeedPage = {
      surface: "watch",
      userId: "wfx-user-1",
      sessionId: "wfxfeed-4",
      cards: [card({ itemId: 1, objective: null, position: 0 })],
      trace: {
        model: { id: "m", version: "1" },
        stages: [
          { stage: "retrieval", inputCount: 1, outputCount: 1, decisions: [] },
        ],
      },
    };
    const metrics = deriveRecommendation([broken], { clock })[0]!;
    expect(metrics.candidateSurvival.value.status).toBe("degraded");
    expect(metrics.candidateSurvival.provenance.missingFields).toContain(
      "trace.stages[composition]",
    );
  });

  it("the real WFX-021 pipeline over the 19-candidate fixture pool (dedupe visible)", async () => {
    const { buildFixtureIndex, FIXTURE_INTENTS } = await import("../src/index");
    const index = buildFixtureIndex();
    const pool: EntertainmentCandidate[] = index.query({ limit: 100 }).map(
      (retrieved) => retrieved.candidate,
    );
    const intents: UserIntent[] = [...FIXTURE_INTENTS];

    const feed = await runRecommendation({
      userId: "wfx-user-fixture",
      sessionId: "wfxfeed-real",
      surface: "watch",
      intents,
      policy: {
        id: "wfxpol_01ARZ3NDEKF1XT0P000000001",
        userId: "wfx-user-fixture",
        objectives: [],
        exploration: 0.5,
        novelty: 0.2,
        socialInfluence: 0.1,
        attentionMode: "balanced",
      },
      recentEvents: [],
      candidatePool: pool,
    });
    const metrics = deriveRecommendation([feed], { clock })[0]!;
    expect(metrics.candidateSurvival.value.status).toBe("ok");
    if (metrics.candidateSurvival.value.status !== "ok") throw new Error("unreachable");
    // 19 pool entries collapse to the 12 distinct canonical items (dedupe is
    // the one legitimate collapse — traced "dedupe-kept" decisions) and the
    // anti-tunnel-vision law keeps every distinct item in the feed.
    expect(metrics.candidateSurvival.value.payload.retrieved).toBe(19);
    expect(metrics.candidateSurvival.value.payload.surviving).toBe(12);
    expect(metrics.candidateSurvival.value.payload.survival).toBe(12 / 19);
    expect(feed.cards.length).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// deriveRecommendation — attention-mode compliance (the compliance signal)
// ---------------------------------------------------------------------------

describe("deriveRecommendation — AttentionModeCompliance", () => {
  it("a crafted violating feed (4-run under the mindful gap cap) ⇒ violations > 0", () => {
    const cards = [
      card({ itemId: 1, objective: "sci-fi", position: 0 }),
      card({ itemId: 2, objective: "sci-fi", position: 1 }),
      card({ itemId: 3, objective: "sci-fi", position: 2 }),
      card({ itemId: 4, objective: "sci-fi", position: 3 }),
    ];
    const metrics = deriveRecommendation(
      [page("wfxfeed-5", cards, 4, 4)],
      mindfulOptions("wfxfeed-5"),
    )[0]!;
    expect(metrics.attentionModeCompliance.value.status).toBe("ok");
    if (metrics.attentionModeCompliance.value.status !== "ok") throw new Error("unreachable");
    // Mindful cap = 2: a 4-run carries 2 violating positions.
    expect(metrics.attentionModeCompliance.value.payload.attentionMode).toBe("mindful");
    expect(metrics.attentionModeCompliance.value.payload.objectiveGapViolations).toBe(2);
    expect(metrics.attentionModeCompliance.value.payload.totalViolations).toBe(2);
  });

  it("a crafted session-extending chain beyond the mindful cap ⇒ violations > 0", () => {
    // Cards 1..4 form a 4-long extending chain: card 1 extends a CONSUMED
    // anchor (a completed watch), cards 2..4 chain in-feed — cap 2.
    const recentEvents = [
      event("wfxfeed-6", 0, "complete", "2026-09-13T11:00:00.000Z"),
    ];
    const cards = [
      card({ itemId: 1, objective: "a", nextEpisodeOf: 0, position: 0 }),
      card({ itemId: 2, objective: "b", nextEpisodeOf: 1, position: 1 }),
      card({ itemId: 3, objective: "c", nextEpisodeOf: 2, position: 2 }),
      card({ itemId: 4, objective: "d", nextEpisodeOf: 3, position: 3 }),
    ];
    const metrics = deriveRecommendation(
      [page("wfxfeed-6", cards, 4, 4)],
      mindfulOptions("wfxfeed-6", recentEvents),
    )[0]!;
    expect(metrics.attentionModeCompliance.value.status).toBe("ok");
    if (metrics.attentionModeCompliance.value.status !== "ok") throw new Error("unreachable");
    expect(metrics.attentionModeCompliance.value.payload.chainViolations).toBe(2);
    expect(metrics.attentionModeCompliance.value.payload.objectiveGapViolations).toBe(0);
    expect(metrics.attentionModeCompliance.value.payload.totalViolations).toBe(2);
  });

  it("compliant feeds ⇒ 0 violations (gap interleaved, chain at cap)", () => {
    const cards = [
      card({ itemId: 1, objective: "a", position: 0 }),
      card({ itemId: 2, objective: "a", position: 1 }),
      card({ itemId: 3, objective: "b", position: 2 }),
      card({ itemId: 4, objective: "a", position: 3 }),
      card({ itemId: 5, objective: "b", nextEpisodeOf: 3, position: 4 }),
      card({ itemId: 6, objective: "c", nextEpisodeOf: 5, position: 5 }),
      card({ itemId: 7, objective: "d", position: 6 }),
    ];
    const metrics = deriveRecommendation(
      [page("wfxfeed-7", cards, 7, 7)],
      mindfulOptions("wfxfeed-7"),
    )[0]!;
    expect(metrics.attentionModeCompliance.value.status).toBe("ok");
    if (metrics.attentionModeCompliance.value.status !== "ok") throw new Error("unreachable");
    expect(metrics.attentionModeCompliance.value.payload.objectiveGapViolations).toBe(0);
    expect(metrics.attentionModeCompliance.value.payload.chainViolations).toBe(0);
    expect(metrics.attentionModeCompliance.value.payload.totalViolations).toBe(0);
  });

  it("no policy ⇒ degraded (compliance unverified, never guessed)", () => {
    const cards = [card({ itemId: 1, objective: "a", position: 0 })];
    const metrics = deriveRecommendation([page("wfxfeed-8", cards, 1, 1)], { clock })[0]!;
    expect(metrics.attentionModeCompliance.value.status).toBe("degraded");
    expect(metrics.attentionModeCompliance.provenance.missingFields).toContain(
      "policiesBySessionId",
    );
  });

  it("no recentEvents ⇒ the chain check is unverified (typed null), gap still checked", () => {
    // A 4-run violates the gap cap even without events; the chain part of the
    // same metric is honestly null (unverified), never approximated.
    const cards = [
      card({ itemId: 1, objective: "sci-fi", position: 0 }),
      card({ itemId: 2, objective: "sci-fi", position: 1 }),
      card({ itemId: 3, objective: "sci-fi", position: 2 }),
      card({ itemId: 4, objective: "sci-fi", position: 3 }),
    ];
    const metrics = deriveRecommendation(
      [page("wfxfeed-9", cards, 4, 4)],
      {
        clock,
        policiesBySessionId: new Map([["wfxfeed-9", mindfulPolicy()]]),
      },
    )[0]!;
    expect(metrics.attentionModeCompliance.value.status).toBe("ok");
    if (metrics.attentionModeCompliance.value.status !== "ok") throw new Error("unreachable");
    expect(metrics.attentionModeCompliance.value.payload.objectiveGapViolations).toBe(2);
    expect(metrics.attentionModeCompliance.value.payload.chainViolations).toBe(null);
    expect(metrics.attentionModeCompliance.provenance.missingFields).toContain(
      "eventsBySessionId",
    );
  });

  it("the REAL WFX-021 pipeline under a mindful policy verifies compliant", async () => {
    const { buildFixtureIndex, FIXTURE_USER_ID, FIXTURE_INTENTS } = await import("../src/index");
    const index = buildFixtureIndex();
    const pool: EntertainmentCandidate[] = index.query({ limit: 100 }).map(
      (retrieved) => retrieved.candidate,
    );
    const sessionId = "wfxfeed-real-mindful";
    const feed = await runRecommendation({
      userId: FIXTURE_USER_ID,
      sessionId,
      surface: "watch",
      intents: [...FIXTURE_INTENTS],
      policy: mindfulPolicy(),
      recentEvents: [],
      candidatePool: pool,
    });
    const metrics = deriveRecommendation(
      [feed],
      mindfulOptions(sessionId),
    )[0]!;
    expect(metrics.attentionModeCompliance.value.status).toBe("ok");
    if (metrics.attentionModeCompliance.value.status !== "ok") throw new Error("unreachable");
    expect(metrics.attentionModeCompliance.value.payload.attentionMode).toBe("mindful");
    expect(metrics.attentionModeCompliance.value.payload.objectiveGapViolations).toBe(0);
    expect(metrics.attentionModeCompliance.value.payload.chainViolations).toBe(0);
    expect(metrics.attentionModeCompliance.value.payload.totalViolations).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deriveEngagement
// ---------------------------------------------------------------------------

describe("deriveEngagement — skip/complete/like/save rates per surface", () => {
  const events: EntertainmentEvent[] = [
    // short session: 2 skips, 1 complete, 1 like (4 engagement events).
    event("eng-short", 1, "skip", "2026-09-13T12:00:01.000Z"),
    event("eng-short", 2, "skip", "2026-09-13T12:00:02.000Z"),
    event("eng-short", 3, "complete", "2026-09-13T12:00:03.000Z"),
    event("eng-short", 3, "like", "2026-09-13T12:00:04.000Z"),
    // watch session: 1 complete, 1 save, 1 impression (exposure ≠ engagement).
    event("eng-watch", 5, "complete", "2026-09-13T12:00:10.000Z"),
    event("eng-watch", 5, "save", "2026-09-13T12:00:11.000Z"),
    event("eng-watch", 6, "impression", "2026-09-13T12:00:12.000Z"),
    // unattributed session: 1 skip.
    event("eng-none", 7, "skip", "2026-09-13T12:00:20.000Z"),
  ];
  const metrics = deriveEngagement(events, {
    clock,
    surfaceBySessionId: new Map([
      ["eng-short", "short"],
      ["eng-watch", "watch"],
    ]),
  });

  it("one metric per (surface, session) with pooled-correct per-session rates", () => {
    expect(metrics).toHaveLength(3);
    const shortMetric = metrics.find(
      (metric) => metric.provenance.instanceId === "short|eng-short",
    );
    const watchMetric = metrics.find(
      (metric) => metric.provenance.instanceId === "watch|eng-watch",
    );
    const unattributed = metrics.find(
      (metric) => metric.provenance.instanceId === "unattributed|eng-none",
    );
    expect(shortMetric).toBeDefined();
    expect(watchMetric).toBeDefined();
    expect(unattributed).toBeDefined();

    expect(shortMetric?.value.status).toBe("ok");
    if (shortMetric?.value.status !== "ok") throw new Error("unreachable");
    expect(shortMetric.value.payload.surface).toBe("short");
    expect(shortMetric.value.payload.skip).toBe(2);
    expect(shortMetric.value.payload.complete).toBe(1);
    expect(shortMetric.value.payload.like).toBe(1);
    expect(shortMetric.value.payload.save).toBe(0);
    expect(shortMetric.value.payload.engagementEvents).toBe(4);
    expect(shortMetric.value.payload.skipRate).toBe(0.5);
    expect(shortMetric.value.payload.completeRate).toBe(0.25);
    expect(shortMetric.value.payload.likeRate).toBe(0.25);
    expect(shortMetric.value.payload.saveRate).toBe(0);

    expect(watchMetric?.value.status).toBe("ok");
    if (watchMetric?.value.status !== "ok") throw new Error("unreachable");
    // Impressions are exposure, not engagement: the denominator is 2.
    expect(watchMetric.value.payload.engagementEvents).toBe(2);
    expect(watchMetric.value.payload.completeRate).toBe(0.5);
    expect(watchMetric.value.payload.saveRate).toBe(0.5);
    expect(watchMetric.value.payload.skipRate).toBe(0);
  });

  it("unattributed sessions degrade (surface is never guessed from payloads)", () => {
    const unattributed = metrics.find(
      (metric) => metric.provenance.instanceId === "unattributed|eng-none",
    );
    expect(unattributed?.value.status).toBe("degraded");
    expect(unattributed?.provenance.missingFields).toContain("surfaceBySessionId");
    expect(unattributed?.provenance.observationCount).toBe(1);
  });

  it("a session of only impressions degrades (zero denominator — never a fake 0)", () => {
    const metrics = deriveEngagement(
      [event("eng-imp", 9, "impression", "2026-09-13T12:00:30.000Z")],
      {
        clock,
        surfaceBySessionId: new Map([["eng-imp", "short"]]),
      },
    );
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.value.status).toBe("degraded");
    expect(metrics[0]!.provenance.missingFields).toContain("engagementEvents");
  });

  it("a session mixing users throws the typed error (never a silent pick)", () => {
    expectTelemetryError(() =>
      deriveEngagement(
        [
          event("eng-mix", 1, "skip", "2026-09-13T12:00:30.000Z", undefined, "user-a"),
          event("eng-mix", 2, "skip", "2026-09-13T12:00:31.000Z", undefined, "user-b"),
        ],
        { clock },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Percentiles — determinism + the documented interpolation
// ---------------------------------------------------------------------------

describe("percentile — the documented deterministic interpolation", () => {
  it("inclusive linear interpolation (i = p·(n−1)) goldens", () => {
    expect(percentile([1, 2, 3], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    // p95 of [1,2,3,4]: i = 2.85 -> 3 + 0.85·1 = 3.85 (documented method;
    // toBeCloseTo guards the unavoidable IEEE-754 representation drift).
    expect(percentile([1, 2, 3, 4], 0.95)).toBeCloseTo(3.85, 10);
    expect(percentile([5], 0.95)).toBe(5);
    expect(percentile([10, 20], 0)).toBe(10);
    expect(percentile([10, 20], 1)).toBe(20);
    expect(percentile([1, 2, 3, 4, 5], 0.25)).toBe(2);
  });

  it("determinism: identical inputs yield identical outputs across calls", () => {
    const sampleValues = Array.from({ length: 101 }, (_, index) => index * 37);
    const first = percentile(sampleValues, 0.95);
    for (let call = 0; call < 5; call += 1) {
      expect(percentile(sampleValues, 0.95)).toBe(first);
    }
  });

  it("an unsorted input is caller misuse territory: the contract requires ascending", () => {
    // The documented contract: the sample must be ascending. (Derivation
    // always sorts; this pins the method, not a sorting guarantee.)
    expect(percentile([3, 1, 2], 0.5)).toBe(1);
  });

  it("empty samples and out-of-range p throw the typed error", () => {
    expectTelemetryError(() => percentile([], 0.5));
    expectTelemetryError(() => percentile([1], 1.5));
    expectTelemetryError(() => percentile([1], -0.1));
  });
});

describe("boundedSketch — the t-digest-free percentile merge sketch", () => {
  it("under the cap: the exact sorted sample, approximate false", () => {
    const sketch = boundedSketch([30, 10, 20, 5]);
    expect(sketch.samples).toEqual([5, 10, 20, 30]);
    expect(sketch.totalSamples).toBe(4);
    expect(sketch.approximate).toBe(false);
  });

  it("over the cap: deterministic even-stride decimation, count exact, disclosed", () => {
    const values = Array.from({ length: PERCENTILE_SKETCH_CAP * 3 }, (_, index) => index);
    const first = boundedSketch(values);
    expect(first.samples.length).toBe(PERCENTILE_SKETCH_CAP);
    expect(first.totalSamples).toBe(PERCENTILE_SKETCH_CAP * 3);
    expect(first.approximate).toBe(true);
    // Endpoints preserved by the even stride.
    expect(first.samples[0]).toBe(0);
    expect(first.samples[PERCENTILE_SKETCH_CAP - 1]).toBe(PERCENTILE_SKETCH_CAP * 3 - 1);
    // Determinism across calls and input orders.
    expect(canonicalJson(boundedSketch([...values].reverse()))).toBe(canonicalJson(first));
  });
});

// ---------------------------------------------------------------------------
// Aggregation — window bucketing, merge-safety, idempotency
// ---------------------------------------------------------------------------

describe("WindowedAggregator + aggregateMetrics — window bucketing", () => {
  const bucketMs = 300_000; // 5 minutes
  const at = (epochMs: number): string => new Date(epochMs).toISOString();

  function trailFor(sessionId: string): PlaybackSessionTrail {
    return {
      sessionId,
      userId: "wfx-user-1",
      events: [
        event(sessionId, 1, "start", "2026-09-13T11:59:00.000Z"),
        event(sessionId, 1, "progress", "2026-09-13T11:59:01.000Z", { qualitySwitch: true }),
      ],
      samples: [
        sample("2026-09-13T11:59:00.000Z", "playing", 1000, 0),
        sample("2026-09-13T11:59:59.000Z", "playing", 60000, 59000),
      ],
    };
  }

  it("metrics land in the bucket containing their computedAt (exact boundaries)", () => {
    const aggregator = createWindowedAggregator({ bucketMs });
    // T0 = 12:00:00 exactly — the bucket boundary itself belongs to THIS window.
    aggregator.add(deriveQoe(trailFor("s-boundary"), { clock }).rebufferRatio);
    // One ms before the next boundary — still the first window.
    aggregator.add(
      deriveQoe(trailFor("s-inside"), {
        clock: () => at(T0_EPOCH + bucketMs - 1),
      }).rebufferRatio,
    );
    // Exactly the next boundary — the NEXT window.
    aggregator.add(
      deriveQoe(trailFor("s-next"), {
        clock: () => at(T0_EPOCH + bucketMs),
      }).rebufferRatio,
    );

    const starts = aggregator.windowStarts();
    expect(starts).toHaveLength(2);
    expect(starts[0]!).toBe(windowStartOf(T0, bucketMs));
    expect(starts[0]! % bucketMs).toBe(0);
    expect(starts[1]!).toBe(starts[0]! + bucketMs);
    expect(aggregator.window(starts[0]!)?.instances).toHaveLength(2);
    expect(aggregator.window(starts[1]!)?.instances).toHaveLength(1);
  });

  it("windowStartOf aligns any instant down to its bucket", () => {
    expect(windowStartOf(T0, bucketMs)).toBe(Math.floor(T0_EPOCH / bucketMs) * bucketMs);
    expect(windowStartOf(at(T0_EPOCH + bucketMs - 1), bucketMs)).toBe(
      Math.floor(T0_EPOCH / bucketMs) * bucketMs,
    );
    expect(windowStartOf(at(T0_EPOCH + bucketMs), bucketMs)).toBe(
      Math.floor(T0_EPOCH / bucketMs) * bucketMs + bucketMs,
    );
  });

  it("re-deriving the same subject replaces (never double-counts) — latest wins", () => {
    const earlier = deriveQoe(goldenTrail(), { clock });
    const later = deriveQoe(goldenTrail(), { clock: clockLater });
    const aggregation = aggregateMetrics(
      [earlier.rebufferRatio, later.rebufferRatio],
      bucketMs,
    );
    const window = aggregation.windows[0]!;
    expect(window.instances).toHaveLength(1);
    expect(window.instances[0]!.computedAt).toBe(T1);
    // And idempotently: adding the same aggregation again changes nothing.
    expect(canonicalJson(mergeAggregations(aggregation, aggregation))).toBe(
      canonicalJson(aggregation),
    );
  });

  it("malformed metrics and bucket sizes throw the typed error", () => {
    expectTelemetryError(() => aggregateMetrics([{ kind: "nonsense" } as unknown as TelemetryMetric], bucketMs));
    expectTelemetryError(() =>
      aggregateMetrics(
        [
          {
            kind: "rebuffer-ratio",
            computedAt: T0,
            provenance: {
              instanceId: "s",
              userId: "u",
              sessionId: "s",
              rangeStart: null,
              rangeEnd: null,
              observationCount: 1,
              missingFields: [],
            },
            value: { status: "ok", payload: { stallMs: 1, watchMs: 0, ratio: 0 } },
          } as unknown as TelemetryMetric,
        ],
        bucketMs,
      ),
    );
    expectTelemetryError(() => aggregateMetrics([], 0));
    expectTelemetryError(() => aggregateMetrics([], -5));
    expectTelemetryError(() => createWindowedAggregator({ bucketMs: 1.5 }));
  });

  it("assertValidMetric accepts a well-formed metric (round-trip guard)", () => {
    const metrics = deriveQoe(goldenTrail(), { clock });
    expect(() => assertValidMetric(metrics.rebufferRatio)).not.toThrow();
    expect(instanceKey(metrics.rebufferRatio)).toBe("rebuffer-ratio|wfxpses-1");
    expect(METRIC_KINDS).toHaveLength(11);
  });
});

describe("mergeAggregations — associativity + idempotency (byte-identical)", () => {
  const bucketMs = 300_000;

  /** Three disjoint batches of real derived metrics. */
  function batches(): [TelemetryMetric[], TelemetryMetric[], TelemetryMetric[]] {
    const a: TelemetryMetric[] = [
      ...qoeMetricArray(deriveQoe(goldenTrail(), { clock })),
    ];
    const qoe = deriveQoe(
      {
        sessionId: "wfxpses-b",
        userId: "wfx-user-2",
        events: [
          event("wfxpses-b", 2, "start", "2026-09-13T12:00:30.000Z", undefined, "wfx-user-2"),
          event("wfxpses-b", 2, "progress", "2026-09-13T12:00:32.000Z", {
            stallMs: 100,
            seekLatencyMs: 90,
            qualitySwitch: false,
          }, "wfx-user-2"),
          event("wfxpses-b", 2, "complete", "2026-09-13T12:02:00.000Z", { qualitySwitch: true }, "wfx-user-2"),
        ],
        samples: [
          sample("2026-09-13T12:00:30.000Z", "playing", 8000, 0),
          sample("2026-09-13T12:02:00.000Z", "complete", 120000, 110000),
        ],
      },
      { clock },
    );
    const b: TelemetryMetric[] = [...qoeMetricArray(qoe)];
    const engagement = deriveEngagement(
      [
        event("eng-short", 1, "skip", "2026-09-13T12:00:01.000Z"),
        event("eng-short", 2, "complete", "2026-09-13T12:00:02.000Z"),
        event("eng-short", 3, "like", "2026-09-13T12:00:03.000Z"),
        event("eng-short", 3, "save", "2026-09-13T12:00:04.000Z"),
        event("eng-short", 4, "skip", "2026-09-13T12:00:05.000Z"),
        event("eng-watch", 5, "complete", "2026-09-13T12:00:10.000Z"),
      ],
      {
        clock,
        surfaceBySessionId: new Map([
          ["eng-short", "short"],
          ["eng-watch", "watch"],
        ]),
      },
    );
    const c: TelemetryMetric[] = [...engagement];
    return [a, b, c];
  }

  it("(a+b)+c == a+(b+c): byte-identical aggregations AND reports", () => {
    const [a, b, c] = batches();
    const left = mergeAggregations(mergeAggregations(aggregateMetrics(a, bucketMs), aggregateMetrics(b, bucketMs)), aggregateMetrics(c, bucketMs));
    const right = mergeAggregations(aggregateMetrics(a, bucketMs), mergeAggregations(aggregateMetrics(b, bucketMs), aggregateMetrics(c, bucketMs)));
    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
    expect(JSON.stringify(telemetryReport(left, left.windows[0]!.windowStart, { clock }))).toBe(
      JSON.stringify(telemetryReport(right, right.windows[0]!.windowStart, { clock })),
    );
  });

  it("merge is commutative and order-independent for shuffled adds", () => {
    const [a, b, c] = batches();
    const straight = aggregateMetrics([...a, ...b, ...c], bucketMs);
    const shuffled = aggregateMetrics([...c, ...a, ...b], bucketMs);
    expect(JSON.stringify(straight)).toBe(JSON.stringify(shuffled));
  });

  it("merging different bucket sizes is the typed error", () => {
    const [a] = batches();
    expectTelemetryError(() =>
      mergeAggregations(aggregateMetrics(a, 300_000), aggregateMetrics(a, 600_000)),
    );
  });

  it("windowInstances returns the window's canonically ordered instances", () => {
    const [a, b, c] = batches();
    const aggregation = aggregateMetrics([...a, ...b, ...c], bucketMs);
    const start = aggregation.windows[0]!.windowStart;
    expect(windowInstances(aggregation, start)).toHaveLength(
      aggregation.windows[0]!.instances.length,
    );
    expect(windowInstances(aggregation, start + bucketMs)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Redaction — levels, transformations, small-n suppression
// ---------------------------------------------------------------------------

describe("redactMetrics — the privacy levels", () => {
  /** An aggregation with 5 explanation-carrying pages in one window. */
  function fullAggregate(): Aggregation {
    const metrics: TelemetryMetric[] = [];
    for (let n = 1; n <= 5; n += 1) {
      const sessionId = `wfxfeed-r${n}`;
      const cards = [
        card({
          itemId: n,
          objective: n % 2 === 0 ? "sci-fi" : "documentary",
          explanations: [`explanation for page ${n}`],
          position: 0,
        }),
        card({ itemId: n + 10, objective: null, position: 1 }),
      ];
      const set = deriveRecommendation([page(sessionId, cards, 2, 2)], { clock })[0]!;
      metrics.push(
        set.explanationCoverage,
        set.diversityIndex,
        set.candidateSurvival,
        set.rerankFrequency,
        set.attentionModeCompliance,
      );
    }
    return aggregateMetrics(metrics, 300_000);
  }

  it("full: as-is (identity) with the audited no-op entry", () => {
    const aggregate = fullAggregate();
    const result = redactMetrics(aggregate, "full");
    expect(JSON.stringify(result.aggregate)).toBe(JSON.stringify(aggregate));
    expect(result.report.level).toBe("full");
    expect(result.report.entries).toEqual([
      {
        transformation: "none",
        detail: "level 'full' — no transformations applied (as-is)",
        scope: "all windows",
      },
    ]);
  });

  it("internal: free-text explanations dropped, counts kept, audited", () => {
    const aggregate = fullAggregate();
    const result = redactMetrics(aggregate, "internal");
    const window = result.aggregate.windows[0]!;
    const coverage = window.instances.filter((metric) => metric.kind === "explanation-coverage");
    expect(coverage).toHaveLength(5);
    for (const metric of coverage) {
      expect(metric.value.status).toBe("ok");
      if (metric.value.status !== "ok") throw new Error("unreachable");
      // The free text is gone; every count stays.
      expect(metric.value.payload.sampleExplanations).toEqual([]);
      expect(metric.value.payload.coverage).toBe(0.5);
      expect(metric.value.payload.totalCards).toBe(2);
    }
    expect(result.report.level).toBe("internal");
    const dropped = result.report.entries.filter(
      (entry) => entry.transformation === "explanations-dropped",
    );
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.scope).toBe(`window ${window.windowStart}`);
    // The input aggregate is never mutated (purity).
    const original = aggregate.windows[0]!.instances.find(
      (metric) => metric.kind === "explanation-coverage",
    );
    expect(original?.value.status).toBe("ok");
    if (original?.value.status !== "ok") throw new Error("unreachable");
    expect(original.value.payload.sampleExplanations).toEqual(["explanation for page 1"]);
  });

  it("shared (n=5 ok samples): cohort bucketing + pseudonymization, NO suppression", () => {
    const aggregate = fullAggregate();
    const result = redactMetrics(aggregate, "shared");
    const window = result.aggregate.windows[0]!;
    for (const metric of window.instances) {
      expect(metric.provenance.userId).toMatch(/^cohort:\d+$/);
      expect(Number(metric.provenance.userId.slice("cohort:".length))).toBeLessThan(COHORT_COUNT);
      expect(metric.provenance.sessionId).toMatch(/^wfxred_[0-9a-f]{16}$/);
      // Instance ids are rebuilt from the pseudonym — unique per session.
      expect(metric.provenance.instanceId).toContain(metric.provenance.sessionId);
    }
    // Deterministic: same input, same output.
    expect(canonicalJson(redactMetrics(aggregate, "shared"))).toBe(
      canonicalJson(redactMetrics(aggregate, "shared")),
    );
    // 5 ok samples per kind ⇒ NO small-n suppression at the threshold.
    expect(
      result.report.entries.filter((entry) => entry.transformation === "small-n-suppressed"),
    ).toEqual([]);
    // Every transformation is audited.
    const kinds = result.report.entries.map((entry) => entry.transformation);
    expect(kinds).toContain("explanations-dropped");
    expect(kinds).toContain("cohort-bucketed");
    expect(kinds).toContain("session-pseudonymized");
  });

  it("shared small-n (n<5 ok samples): values replaced by the typed suppressed marker", () => {
    // 3 ok rebuffer-ratio instances (samples + payload stall reports) + 3
    // DEGRADED join-time instances (no start event) in one window: only the
    // ok-valued bucket is suppressed; degraded instances carry no values and
    // pass through untouched.
    const metrics: TelemetryMetric[] = [];
    for (let n = 1; n <= 3; n += 1) {
      const set = deriveQoe(
        {
          sessionId: `wfxpses-small${n}`,
          userId: `wfx-user-small${n}`,
          events: [
            event(`wfxpses-small${n}`, n, "progress", "2026-09-13T12:00:02.000Z", {
              stallMs: 100 * n,
            }, `wfx-user-small${n}`),
          ],
          samples: [
            sample("2026-09-13T12:00:00.000Z", "playing", 1000, 0),
            sample("2026-09-13T12:00:59.000Z", "playing", 61000, 59000),
          ],
        },
        { clock },
      );
      metrics.push(set.rebufferRatio, set.joinTimeMs);
    }
    // Pre-condition sanity: 3 ok rebuffers, 3 degraded joins.
    const preWindow = aggregateMetrics(metrics, 300_000).windows[0]!;
    expect(
      preWindow.instances.filter(
        (metric) => metric.kind === "rebuffer-ratio" && metric.value.status === "ok",
      ),
    ).toHaveLength(3);
    expect(
      preWindow.instances.filter(
        (metric) => metric.kind === "join-time-ms" && metric.value.status === "degraded",
      ),
    ).toHaveLength(3);

    const aggregate = aggregateMetrics(metrics, 300_000);
    const result = redactMetrics(aggregate, "shared");
    const window = result.aggregate.windows[0]!;
    const rebuffer = window.instances.filter((metric) => metric.kind === "rebuffer-ratio");
    expect(rebuffer).toHaveLength(3);
    for (const metric of rebuffer) {
      expect(metric.value.status).toBe("suppressed");
      if (metric.value.status === "suppressed") {
        expect(metric.value.reason).toContain("small-n suppression");
        expect(metric.value.reason).toContain(`${MIN_SAMPLES_FOR_RATE}`);
      }
    }
    // The degraded join-time instances are untouched (they carry no values).
    const join = window.instances.filter((metric) => metric.kind === "join-time-ms");
    for (const metric of join) {
      expect(metric.value.status).toBe("degraded");
    }
    // The suppression is audited with its bucket scope — join-time is absent
    // because its bucket has zero ok samples to suppress.
    const suppressed = result.report.entries.filter(
      (entry) => entry.transformation === "small-n-suppressed",
    );
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]!.scope).toContain("rebuffer-ratio");
    expect(suppressed[0]!.scope).not.toContain("join-time-ms");
  });

  it("engagement suppression is per surface bucket, not per kind", () => {
    // 2 short sessions + 5 watch sessions: short suppressed, watch kept.
    const events: EntertainmentEvent[] = [];
    for (let n = 1; n <= 2; n += 1) {
      events.push(event(`eng-s${n}`, n, "skip", "2026-09-13T12:00:01.000Z"));
    }
    for (let n = 1; n <= 5; n += 1) {
      events.push(event(`eng-w${n}`, n + 10, "complete", "2026-09-13T12:00:02.000Z"));
    }
    const engagement = deriveEngagement(events, {
      clock,
      surfaceBySessionId: new Map([
        ...[1, 2].map((n) => [`eng-s${n}`, "short"] as const),
        ...[1, 2, 3, 4, 5].map((n) => [`eng-w${n}`, "watch"] as const),
      ]),
    });
    const aggregate = aggregateMetrics(engagement, 300_000);
    const result = redactMetrics(aggregate, "shared");
    const window = result.aggregate.windows[0]!;
    for (const metric of window.instances) {
      if (metric.provenance.instanceId.startsWith("short|")) {
        expect(metric.value.status).toBe("suppressed");
      } else {
        expect(metric.value.status).toBe("ok");
      }
    }
    const scopes = result.report.entries
      .filter((entry) => entry.transformation === "small-n-suppressed")
      .map((entry) => entry.scope);
    expect(scopes).toEqual([
      `window ${window.windowStart}: engagement-rates:short`,
    ]);
  });

  it("the hash bucketing is deterministic and the typed errors hold", () => {
    expect(cohortOf("wfx-user-1")).toBe(cohortOf("wfx-user-1"));
    expect(cohortOf("wfx-user-1")).not.toBe(cohortOf("wfx-user-2"));
    expect(pseudonymizeSessionId("s1")).toMatch(/^wfxred_[0-9a-f]{16}$/);
    expect(pseudonymizeSessionId("s1")).toBe(pseudonymizeSessionId("s1"));
    expect(pseudonymizeSessionId("s1")).not.toBe(pseudonymizeSessionId("s2"));
    expectTelemetryError(() => redactMetrics(fullAggregate(), "leaky" as RedactionLevel));
    expectTelemetryError(() =>
      redactMetrics({} as unknown as Aggregation, "internal"),
    );
  });
});

// ---------------------------------------------------------------------------
// Sink + report
// ---------------------------------------------------------------------------

describe("createRecorderSink — the in-memory replayable sink", () => {
  it("records, replays, sizes, clears — validating on record", () => {
    const sink = createRecorderSink();
    const metrics = deriveQoe(goldenTrail(), { clock });
    sink.record(metrics.rebufferRatio);
    sink.record(metrics.joinTimeMs);
    expect(sink.size()).toBe(2);
    expect(sink.replay()).toHaveLength(2);
    expect(sink.replay()[0]!.kind).toBe("rebuffer-ratio");
    sink.clear();
    expect(sink.size()).toBe(0);
    expect(sink.replay()).toEqual([]);
    expectTelemetryError(() => sink.record({ kind: "garbage" } as unknown as TelemetryMetric));
  });

  it("drains into the aggregator: sink -> aggregate -> report end-to-end", () => {
    const sink = createRecorderSink();
    const qoe = deriveQoe(goldenTrail(), { clock });
    sink.record(qoe.rebufferRatio);
    sink.record(qoe.joinTimeMs);
    sink.record(qoe.seekLatencyMs);
    sink.record(qoe.qualitySwitchCount);
    sink.record(qoe.bufferHealthMs);
    const engagement = deriveEngagement(
      [
        event("eng-short", 1, "skip", "2026-09-13T12:00:01.000Z"),
        event("eng-short", 2, "complete", "2026-09-13T12:00:02.000Z"),
        event("eng-short", 3, "like", "2026-09-13T12:00:03.000Z"),
        event("eng-short", 3, "save", "2026-09-13T12:00:04.000Z"),
        event("eng-short", 4, "skip", "2026-09-13T12:00:05.000Z"),
      ],
      { clock, surfaceBySessionId: new Map([["eng-short", "short"]]) },
    );
    for (const metric of engagement) sink.record(metric);

    const aggregator = createWindowedAggregator({ bucketMs: 300_000 });
    aggregator.addAll(sink.replay());
    const aggregation = aggregator.snapshot();
    const report = telemetryReport(aggregation, aggregation.windows[0]!.windowStart, { clock });
    expect(report.schemaVersion).toBe(TELEMETRY_REPORT_SCHEMA_VERSION);
    expect(report.instanceCount).toBe(6);
    expect(report.metrics.map((summary) => summary.kind)).toEqual([
      "buffer-health-ms",
      "engagement-rates",
      "join-time-ms",
      "quality-switch-count",
      "rebuffer-ratio",
      "seek-latency-ms",
    ]);
  });
});

/** Type guard: the ok summary of one metric kind. */
function okSummaryOf<K extends ReportMetricSummary["kind"]>(
  summary: ReportMetricSummary | undefined,
  kind: K,
): Extract<ReportMetricSummary, { kind: K; status: "ok" }> {
  if (summary === undefined || summary.kind !== kind || summary.status !== "ok") {
    throw new Error(`expected an ok ${kind} summary`);
  }
  // The kind + status checks above establish the narrowed variant; the cast
  // spells out what TypeScript cannot prove for a generic K.
  return summary as Extract<ReportMetricSummary, { kind: K; status: "ok" }>;
}

/** Type guard: any engagement-rates summary (ok/no-samples/suppressed). */
function isEngagementSummary(
  summary: ReportMetricSummary,
): summary is Extract<ReportMetricSummary, { kind: "engagement-rates" }> {
  return summary.kind === "engagement-rates";
}

describe("telemetryReport — the typed, serializable report document", () => {
  const bucketMs = 300_000;

  /** A rich aggregation: QoE + recommendation + engagement in one window. */
  function richAggregation(): Aggregation {
    const metrics: TelemetryMetric[] = [];
    // Two QoE sessions.
    metrics.push(...qoeMetricArray(deriveQoe(goldenTrail(), { clock })));
    metrics.push(
      ...qoeMetricArray(
        deriveQoe(
          {
            sessionId: "wfxpses-q2",
            userId: "wfx-user-2",
            events: [
              event("wfxpses-q2", 2, "start", "2026-09-13T12:00:30.000Z", undefined, "wfx-user-2"),
              event("wfxpses-q2", 2, "progress", "2026-09-13T12:00:31.500Z", {
                stallMs: 300,
                seekLatencyMs: 200,
                qualitySwitch: true,
              }, "wfx-user-2"),
              event("wfxpses-q2", 2, "complete", "2026-09-13T12:01:00.000Z", {
                stallMs: 100,
                qualitySwitch: false,
              }, "wfx-user-2"),
            ],
            samples: [
              sample("2026-09-13T12:00:30.000Z", "playing", 4000, 0),
              sample("2026-09-13T12:00:40.000Z", "playing", 14000, 10000),
              sample("2026-09-13T12:01:00.000Z", "complete", 60000, 60000),
            ],
          },
          { clock },
        ),
      ),
    );
    // One recommendation feed (compliant mindful).
    const cards = [
      card({ itemId: 1, objective: "a", explanations: ["e1"], position: 0 }),
      card({ itemId: 2, objective: "a", explanations: ["e2"], position: 1 }),
      card({ itemId: 3, objective: "b", position: 2 }),
      card({ itemId: 4, objective: "a", position: 3 }),
    ];
    const feedMetrics = deriveRecommendation(
      [page("wfxfeed-report", cards, 4, 4)],
      mindfulOptions("wfxfeed-report"),
    )[0]!;
    metrics.push(
      feedMetrics.explanationCoverage,
      feedMetrics.diversityIndex,
      feedMetrics.attentionModeCompliance,
      feedMetrics.candidateSurvival,
      feedMetrics.rerankFrequency,
    );
    // Engagement: 5 short + 3 watch sessions.
    const events: EntertainmentEvent[] = [];
    for (let n = 1; n <= 5; n += 1) {
      events.push(event(`eng-s${n}`, n, "skip", "2026-09-13T12:00:01.000Z"));
      events.push(event(`eng-s${n}`, n, "complete", "2026-09-13T12:00:02.000Z"));
    }
    for (let n = 1; n <= 3; n += 1) {
      events.push(event(`eng-w${n}`, n + 10, "like", "2026-09-13T12:00:03.000Z"));
    }
    metrics.push(
      ...deriveEngagement(events, {
        clock,
        surfaceBySessionId: new Map([
          ...[1, 2, 3, 4, 5].map((n) => [`eng-s${n}`, "short"] as const),
          ...[1, 2, 3].map((n) => [`eng-w${n}`, "watch"] as const),
        ]),
      }),
    );
    return aggregateMetrics(metrics, bucketMs);
  }

  it("round-trip: JSON.parse(JSON.stringify(report)) equals the report", () => {
    const aggregation = richAggregation();
    const report = telemetryReport(aggregation, aggregation.windows[0]!.windowStart, { clock });
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("window geometry + generatedAt come from the aggregation and the injected clock", () => {
    const aggregation = richAggregation();
    const start = aggregation.windows[0]!.windowStart;
    const report = telemetryReport(aggregation, start, { clock });
    expect(report.window).toEqual({
      startMs: start,
      endExclusiveMs: start + bucketMs,
      bucketMs,
    });
    expect(report.generatedAt).toBe(T0);
  });

  it("QoE summaries pool across sessions (micro-average rebuffer, mean join)", () => {
    const aggregation = richAggregation();
    const report = telemetryReport(aggregation, aggregation.windows[0]!.windowStart, { clock });
    const byKind = new Map(report.metrics.map((summary) => [summary.kind, summary]));
    const rebuffer = okSummaryOf(byKind.get("rebuffer-ratio"), "rebuffer-ratio");
    // Session 1: stall 800, watch 57500. Session 2: stall 400, watch 30000.
    expect(rebuffer.pooledStallMs).toBe(1200);
    expect(rebuffer.pooledWatchMs).toBe(87500);
    expect(rebuffer.pooledRatio).toBe(1200 / 87500);
    expect(rebuffer.sessions).toBe(2);

    const join = okSummaryOf(byKind.get("join-time-ms"), "join-time-ms");
    expect(join.sessions).toBe(2);
    expect(join.meanJoinTimeMs).toBe((2500 + 1500) / 2);

    const seek = okSummaryOf(byKind.get("seek-latency-ms"), "seek-latency-ms");
    // Pooled by seek count: (120·1 + 200·1) / 2.
    expect(seek.totalSeeks).toBe(2);
    expect(seek.meanLatencyMs).toBe(160);

    const quality = okSummaryOf(byKind.get("quality-switch-count"), "quality-switch-count");
    expect(quality.totalSwitches).toBe(2);
    expect(quality.reportingEvents).toBe(5);
  });

  it("buffer-health merges the sample multiset through the bounded sketch", () => {
    const aggregation = richAggregation();
    const report = telemetryReport(aggregation, aggregation.windows[0]!.windowStart, { clock });
    const buffer = okSummaryOf(
      report.metrics.find((summary) => summary.kind === "buffer-health-ms"),
      "buffer-health-ms",
    );
    // Pooled samples: session 1 [5000, 15000, 22000] + session 2 [4000, 4000]
    // (complete-state snapshots are not playback states) — under the cap,
    // exact, sorted [4000, 4000, 5000, 15000, 22000].
    expect(buffer.totalSamples).toBe(5);
    expect(buffer.approximate).toBe(false);
    expect(buffer.sessions).toBe(2);
    expect(buffer.p50).toBe(5000);
    expect(buffer.p95).toBe(percentile([4000, 4000, 5000, 15000, 22000], 0.95));
  });

  it("attention compliance verdict: compliant only when fully verified with 0 violations", () => {
    const aggregation = richAggregation();
    const report = telemetryReport(aggregation, aggregation.windows[0]!.windowStart, { clock });
    const compliance = okSummaryOf(
      report.metrics.find((summary) => summary.kind === "attention-mode-compliance"),
      "attention-mode-compliance",
    );
    expect(compliance.compliance).toBe("compliant");
    expect(compliance.totalViolations).toBe(0);
    expect(compliance.verifiedSessions).toBe(1);
    expect(compliance.chainUnverifiedSessions).toBe(0);

    // The violating variant flips the verdict.
    const violatingCards = [
      card({ itemId: 1, objective: "a", position: 0 }),
      card({ itemId: 2, objective: "a", position: 1 }),
      card({ itemId: 3, objective: "a", position: 2 }),
      card({ itemId: 4, objective: "a", position: 3 }),
    ];
    const violating = deriveRecommendation(
      [page("wfxfeed-report", violatingCards, 4, 4)],
      mindfulOptions("wfxfeed-report"),
    )[0]!;
    const aggregation2 = aggregateMetrics(
      [violating.attentionModeCompliance],
      bucketMs,
    );
    const report2 = telemetryReport(aggregation2, aggregation2.windows[0]!.windowStart, { clock });
    const compliance2 = okSummaryOf(report2.metrics[0], "attention-mode-compliance");
    expect(compliance2.compliance).toBe("violations");
    expect(compliance2.totalViolations).toBe(2);
  });

  it("engagement summaries appear per surface with pooled rates", () => {
    const aggregation = richAggregation();
    const report = telemetryReport(aggregation, aggregation.windows[0]!.windowStart, { clock });
    const engagement = report.metrics.filter(isEngagementSummary);
    expect(engagement).toHaveLength(2);
    const short = okSummaryOf(
      engagement.find((summary) => summary.surface === "short"),
      "engagement-rates",
    );
    const watch = okSummaryOf(
      engagement.find((summary) => summary.surface === "watch"),
      "engagement-rates",
    );
    // 5 short sessions × (skip + complete): pooled 5/10 and 5/10.
    expect(short.sessions).toBe(5);
    expect(short.skip).toBe(5);
    expect(short.complete).toBe(5);
    expect(short.engagementEvents).toBe(10);
    expect(short.skipRate).toBe(0.5);
    expect(short.completeRate).toBe(0.5);
    expect(watch.sessions).toBe(3);
    expect(watch.like).toBe(3);
    expect(watch.likeRate).toBe(1);
  });

  it("a report from a shared-redacted aggregate shows the typed suppression", () => {
    const aggregation = richAggregation();
    const redacted = redactMetrics(aggregation, "shared");
    const report = telemetryReport(redacted.aggregate, aggregation.windows[0]!.windowStart, {
      clock,
    });
    // The watch engagement bucket (3 ok samples < 5) is suppressed — values
    // AND per-bucket counts withheld; the short bucket (5) keeps its rates.
    const engagement = report.metrics.filter(isEngagementSummary);
    const watch = engagement.find((summary) => summary.surface === "watch");
    expect(watch?.status).toBe("suppressed");
    const short = engagement.find((summary) => summary.surface === "short");
    expect(short?.status).toBe("ok");
    expect(report.suppressedPresent).toBe(true);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("an empty window yields an honest empty report", () => {
    const aggregation = aggregateMetrics([], bucketMs);
    const start = windowStartOf(T0, bucketMs);
    const report = telemetryReport(aggregation, start, { clock });
    expect(report.metrics).toEqual([]);
    expect(report.instanceCount).toBe(0);
    expect(report.degradedCount).toBe(0);
    expect(report.suppressedPresent).toBe(false);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("misaligned windows and garbage clocks throw the typed error", () => {
    const aggregation = richAggregation();
    expectTelemetryError(() => telemetryReport(aggregation, 123_457, { clock }));
    expectTelemetryError(() =>
      telemetryReport(aggregation, aggregation.windows[0]!.windowStart, {
        clock: () => "yesterday-ish",
      }),
    );
  });
});
