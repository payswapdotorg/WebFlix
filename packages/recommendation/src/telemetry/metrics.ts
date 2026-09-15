/**
 * Recommendation OS — telemetry typed metric units (WFX-041, Lane A).
 *
 * This module defines the metric VOCABULARY of the telemetry layer: every QoE,
 * recommendation, and engagement metric as a typed unit carrying
 *
 *   - a typed VALUE that is one of `ok` (measured), `degraded` (the input
 *     field was absent — the reason names it; values are NEVER fabricated),
 *     or `suppressed` (privacy redaction withheld the value — see redact.ts),
 *   - a PROVENANCE record (the measurement subject, the observed input range,
 *     the observation count, and the fields whose absence degraded the
 *     measurement), and
 *   - a `computedAt` instant stamped by the INJECTED clock (derive.ts
 *     validates the clock; there is no hidden time anywhere in telemetry).
 *
 * The QoE metric names follow the task packet: RebufferRatio (stallMs /
 * watchMs per session), JoinTimeMs (start -> first progress), SeekLatencyMs,
 * QualitySwitchCount, and BufferHealthMs percentiles (p50/p95 over the
 * session's playback-state buffer-ahead samples, deterministic interpolation
 * documented in aggregate.ts). The recommendation metrics are
 * ExplanationCoverage, DiversityIndex, AttentionModeCompliance (violations
 * MUST be 0 — the attention-policy compliance signal), CandidateSurvival
 * (anti-tunnel-vision indicator), and RerankFrequency. Engagement metrics
 * carry skip/complete/like/save rates per surface.
 *
 * Purity law: metrics are plain, JSON-serializable data. No I/O, no network,
 * no persistence, no timers, no randomness — sinks are injected (sink.ts),
 * time is injected, and aggregation is pure (aggregate.ts).
 */

import type { FeedSurface } from "../os/types";

// ---------------------------------------------------------------------------
// The injected clock + the typed failure
// ---------------------------------------------------------------------------

/**
 * The ONLY time source of the telemetry layer: a caller-injected function
 * returning an ISO 8601 instant. `derive*` validates its output; a clock that
 * returns garbage is caller misuse and fails loudly (typed error).
 */
export type TelemetryClock = () => string;

/** Typed failure kinds produced by telemetry operations. */
export type TelemetryErrorKind =
  /** Caller-supplied data violated a documented invariant. */
  | "invalid-input";

/**
 * Typed error thrown by telemetry operations on malformed input. Failures are
 * explicit and structured (machine-readable `kind` + field-level `details`) —
 * there are no silent coercions and no fake-success paths. ABSENT data is not
 * an error: it degrades the metric (typed markers); MALFORMED data is.
 */
export class TelemetryError extends Error {
  readonly kind: TelemetryErrorKind;
  /** Field-level problem descriptions (at least one). */
  readonly details: readonly string[];

  constructor(kind: TelemetryErrorKind, details: string | readonly string[]) {
    const list = typeof details === "string" ? [details] : details;
    super(`TelemetryError (${kind}): ${list.join("; ")}`);
    this.name = "TelemetryError";
    this.kind = kind;
    this.details = list;
  }
}

// ---------------------------------------------------------------------------
// Provenance — every metric carries where it came from
// ---------------------------------------------------------------------------

/**
 * Where a metric's inputs came from. The telemetry law (task packet): every
 * metric carries provenance (source trace/session id, event range) so an
 * auditor can trace any number back to the raw signal.
 */
export interface MetricProvenance {
  /**
   * The deterministic SUBJECT identity of this measurement — the playback /
   * feed / engagement session id (for engagement, `surface` + "|" + session
   * id). The aggregator composes its instance key from
   * `metric.kind + "|" + instanceId`, so re-deriving the same measurement for
   * the same subject replaces (never double-counts) — see aggregate.ts.
   */
  instanceId: string;
  /**
   * The privacy subject whose activity produced this metric (cohort-bucketed
   * at the "shared" redaction level — see redact.ts).
   */
  userId: string;
  /**
   * The measurement session (playback session, feed session, or engagement
   * session). Pseudonymized at the "shared" redaction level.
   */
  sessionId: string;
  /**
   * The first observed INPUT instant (earliest event `occurredAt` or sample
   * `at`), or null when the trail carried no timed inputs.
   */
  rangeStart: string | null;
  /**
   * The last observed INPUT instant, or null when the trail carried no timed
   * inputs.
   */
  rangeEnd: string | null;
  /** The number of raw observations (events / samples / cards) consumed. */
  observationCount: number;
  /**
   * The input fields whose ABSENCE (or invalid payload values — the reason
   * strings distinguish) degraded the measurement. Empty for a clean
   * derivation. This is the auditable "which field was absent" record.
   */
  missingFields: readonly string[];
}

/** Fields shared by every metric unit. */
export interface MetricCommon {
  /** The instant the metric was computed (INJECTED clock — never hidden). */
  computedAt: string;
  /** Where the metric's inputs came from. */
  provenance: MetricProvenance;
}

// ---------------------------------------------------------------------------
// The typed measurement value: ok | degraded | suppressed
// ---------------------------------------------------------------------------

/**
 * A measurement that succeeded. `payload` is the metric-kind-specific typed
 * value (never fabricated — derived from validated input fields only).
 */
export interface OkMeasurement<P> {
  status: "ok";
  payload: P;
}

/**
 * A measurement that could NOT be made because an input field was absent (or
 * carried an invalid value). The reason names the field — the value is NEVER
 * invented: a degraded metric carries no number at all.
 */
export interface DegradedMeasurement {
  status: "degraded";
  reason: string;
}

/**
 * A measurement whose value EXISTS but is withheld by privacy redaction
 * (small-n suppression at the "shared" level — see redact.ts). Suppression is
 * explicit and typed so a redacted report never shows a misleading rate.
 */
export interface SuppressedMeasurement {
  status: "suppressed";
  reason: string;
}

/** The typed value envelope of every metric unit. */
export type Measurement<P> =
  | OkMeasurement<P>
  | DegradedMeasurement
  | SuppressedMeasurement;

// ---------------------------------------------------------------------------
// QoE metrics (deriveQoe — one set per playback session trail)
// ---------------------------------------------------------------------------

/**
 * RebufferRatio: stallMs / watchMs for one session.
 *
 * - `watchMs` — the sum of native-session sample intervals spent in the
 *   `playing` or `background` states (the active playback clock).
 * - `stallMs` — the sum of (a) `buffering`-state sample intervals that begin
 *   AFTER playback first started (post-join rebuffering observed in session
 *   states) and (b) validated `payload.stallMs` reports on progress/complete
 *   events (the documented stall report channel — see derive.ts). The frozen
 *   WFX-004 session FSM models no post-play rebuffer state, so a healthy
 *   session that reports no stalls honestly measures 0.
 * - `ratio` — `stallMs / watchMs` (watchMs > 0 is a validity precondition;
 *   a zero denominator degrades the metric).
 */
export interface RebufferRatioPayload {
  stallMs: number;
  watchMs: number;
  ratio: number;
}

/** JoinTimeMs: the interval from the session's first `start` event to its first `progress` event. */
export interface JoinTimeMsPayload {
  joinTimeMs: number;
}

/**
 * SeekLatencyMs: the mean observed seek latency over the session's seek
 * observations. Seeks are reported through the documented
 * `payload.seekLatencyMs` key on progress events (the frozen event vocabulary
 * has no seek type); zero observations degrades the metric.
 */
export interface SeekLatencyMsPayload {
  meanLatencyMs: number;
  seekCount: number;
}

/**
 * QualitySwitchCount: the number of quality switches reported through the
 * documented `payload.qualitySwitch` key on progress/complete events. The
 * metric is `ok` only when at least one event CARRIES the key (an explicit
 * report — `qualitySwitch: false` reports "no switch here" and counts 0);
 * total absence of the key degrades the metric (the field is unreported, not
 * zero — never fabricated).
 */
export interface QualitySwitchCountPayload {
  switchCount: number;
  reportingEvents: number;
}

/**
 * BufferHealthMs: percentiles (p50/p95) of the session's buffer-ahead
 * (`bufferedMs - positionMs`) over playback-state samples (`playing` /
 * `background`), computed with the deterministic inclusive interpolation
 * documented in aggregate.ts (`percentile`). The payload carries the exact
 * per-session sample values so windowed aggregation can merge distributions.
 */
export interface BufferHealthMsPayload {
  /** The buffer-ahead sample values, ascending (exact per-session samples). */
  samples: readonly number[];
  p50: number;
  p95: number;
}

/** RebufferRatio metric unit. */
export interface RebufferRatioMetric extends MetricCommon {
  kind: "rebuffer-ratio";
  value: Measurement<RebufferRatioPayload>;
}

/** JoinTimeMs metric unit. */
export interface JoinTimeMsMetric extends MetricCommon {
  kind: "join-time-ms";
  value: Measurement<JoinTimeMsPayload>;
}

/** SeekLatencyMs metric unit. */
export interface SeekLatencyMsMetric extends MetricCommon {
  kind: "seek-latency-ms";
  value: Measurement<SeekLatencyMsPayload>;
}

/** QualitySwitchCount metric unit. */
export interface QualitySwitchCountMetric extends MetricCommon {
  kind: "quality-switch-count";
  value: Measurement<QualitySwitchCountPayload>;
}

/** BufferHealthMs metric unit. */
export interface BufferHealthMsMetric extends MetricCommon {
  kind: "buffer-health-ms";
  value: Measurement<BufferHealthMsPayload>;
}

/** The five QoE metric units of one playback session trail. */
export interface QoeMetricSet {
  rebufferRatio: RebufferRatioMetric;
  joinTimeMs: JoinTimeMsMetric;
  seekLatencyMs: SeekLatencyMsMetric;
  qualitySwitchCount: QualitySwitchCountMetric;
  bufferHealthMs: BufferHealthMsMetric;
}

// ---------------------------------------------------------------------------
// Recommendation metrics (deriveRecommendation — one set per feed page)
// ---------------------------------------------------------------------------

/**
 * ExplanationCoverage: the share of feed cards carrying a non-empty
 * `explanations` array (the WFX-021 explainability law — see
 * PipelineTrace/FeedCard). The payload carries up to
 * `EXPLANATION_SAMPLE_LIMIT` verbatim explanation strings as evidence; the
 * "internal"/"shared" redaction levels DROP this free text (audited).
 */
export interface ExplanationCoveragePayload {
  coveredCards: number;
  totalCards: number;
  coverage: number;
  /** Verbatim model explanation evidence (bounded; dropped by redaction). */
  sampleExplanations: readonly string[];
}

/**
 * DiversityIndex: distinct dominant matched objectives among the feed's cards
 * divided by the feed size (the concentration signal — 1/N for a monoculture,
 * 1.0 for fully distinct objectives; null-objective cards count toward the
 * denominator but are not distinct intents).
 */
export interface DiversityIndexPayload {
  distinctObjectives: number;
  totalCards: number;
  index: number;
}

/**
 * AttentionModeCompliance: violations of the attention-policy constraints
 * OBSERVED IN THE COMPOSED FEED OUTPUT (the compliance signal — the frozen
 * architecture forbids silent optimization, and telemetry re-verifies the
 * output invariant instead of trusting the pipeline's self-report).
 *
 * - `objectiveGapViolations` — cards sitting beyond the mode's
 *   `maxConsecutiveSameObjective` cap in runs of equal dominant objective
 *   (Σ max(0, runLength − cap) over maximal runs; 0 when the mode sets no
 *   gap cap).
 * - `chainViolations` — cards sitting beyond the mode's
 *   `maxSessionExtendingChain` cap in consecutive session-extending runs
 *   (the `nextEpisodeOf` law of ../os/attention.ts, applied to composed
 *   cards with consumed/resume sets from the session's recentEvents), or
 *   null when recentEvents were not supplied (the chain check is UNVERIFIED,
 *   never guessed — the reason names the absent input).
 * - `totalViolations` — gap + verified chain violations. MUST be 0 for a
 *   compliant feed; the metric exists to PROVE it.
 */
export interface AttentionModeCompliancePayload {
  attentionMode: "mindful" | "balanced" | "immersive" | "custom";
  objectiveGapViolations: number;
  chainViolations: number | null;
  totalViolations: number;
  checkedCards: number;
}

/**
 * CandidateSurvival: the share of retrieved candidates surviving to the
 * composed feed (composition.outputCount / retrieval.outputCount from the
 * WFX-021 PipelineTrace). The anti-tunnel-vision law keeps the pool wide
 * (the OS reorders; canonical dedupe is the one legitimate collapse), so
 * survival is the narrowing signal: `narrowed` is true whenever any
 * retrieved candidate failed to reach the feed.
 */
export interface CandidateSurvivalPayload {
  retrieved: number;
  surviving: number;
  survival: number;
  narrowed: boolean;
}

/**
 * RerankFrequency: the count of trace decisions that actively reordered the
 * feed (the closed REORDER decision kinds — demotions, run breaks,
 * exploration injections, custom-objective adjustments) divided by the feed
 * size. The "how much active re-ranking shaped this feed" signal.
 */
export interface RerankFrequencyPayload {
  rerankDecisions: number;
  totalCards: number;
  frequency: number;
}

/** ExplanationCoverage metric unit. */
export interface ExplanationCoverageMetric extends MetricCommon {
  kind: "explanation-coverage";
  value: Measurement<ExplanationCoveragePayload>;
}

/** DiversityIndex metric unit. */
export interface DiversityIndexMetric extends MetricCommon {
  kind: "diversity-index";
  value: Measurement<DiversityIndexPayload>;
}

/** AttentionModeCompliance metric unit. */
export interface AttentionModeComplianceMetric extends MetricCommon {
  kind: "attention-mode-compliance";
  value: Measurement<AttentionModeCompliancePayload>;
}

/** CandidateSurvival metric unit. */
export interface CandidateSurvivalMetric extends MetricCommon {
  kind: "candidate-survival";
  value: Measurement<CandidateSurvivalPayload>;
}

/** RerankFrequency metric unit. */
export interface RerankFrequencyMetric extends MetricCommon {
  kind: "rerank-frequency";
  value: Measurement<RerankFrequencyPayload>;
}

/** The five recommendation metric units of one feed page. */
export interface RecommendationMetricSet {
  explanationCoverage: ExplanationCoverageMetric;
  diversityIndex: DiversityIndexMetric;
  attentionModeCompliance: AttentionModeComplianceMetric;
  candidateSurvival: CandidateSurvivalMetric;
  rerankFrequency: RerankFrequencyMetric;
}

// ---------------------------------------------------------------------------
// Engagement metrics (deriveEngagement — one unit per surface × session)
// ---------------------------------------------------------------------------

/**
 * EngagementRates: skip/complete/like/save counts and rates for one surface ×
 * one engagement session. The denominator is the session's ENGAGEMENT event
 * count (every non-impression event — impressions are exposure, not
 * engagement); a zero denominator degrades the rates (never a fake 0).
 */
export interface EngagementRatesPayload {
  surface: FeedSurface;
  skip: number;
  complete: number;
  like: number;
  save: number;
  engagementEvents: number;
  skipRate: number;
  completeRate: number;
  likeRate: number;
  saveRate: number;
}

/**
 * EngagementRates metric unit. One unit per (surface, session); windowed
 * aggregation pools the counts across sessions and recomputes the pooled
 * rates (see sink.ts) — per-session rates never masquerade as window rates.
 */
export interface EngagementRatesMetric extends MetricCommon {
  kind: "engagement-rates";
  value: Measurement<EngagementRatesPayload>;
}

// ---------------------------------------------------------------------------
// The metric union
// ---------------------------------------------------------------------------

/** Every telemetry metric unit (the aggregation/sink vocabulary). */
export type TelemetryMetric =
  | RebufferRatioMetric
  | JoinTimeMsMetric
  | SeekLatencyMsMetric
  | QualitySwitchCountMetric
  | BufferHealthMsMetric
  | ExplanationCoverageMetric
  | DiversityIndexMetric
  | AttentionModeComplianceMetric
  | CandidateSurvivalMetric
  | RerankFrequencyMetric
  | EngagementRatesMetric;

/** The closed metric-kind vocabulary (sorted — canonical report order). */
export const METRIC_KINDS = [
  "attention-mode-compliance",
  "buffer-health-ms",
  "candidate-survival",
  "diversity-index",
  "engagement-rates",
  "explanation-coverage",
  "join-time-ms",
  "quality-switch-count",
  "rebuffer-ratio",
  "rerank-frequency",
  "seek-latency-ms",
] as const satisfies readonly TelemetryMetric["kind"][];

/**
 * Verbatim explanation evidence carried per explanation-coverage metric
 * (bounded so a single feed cannot flood the aggregate with free text).
 */
export const EXPLANATION_SAMPLE_LIMIT = 3;
