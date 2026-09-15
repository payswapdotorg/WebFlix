/**
 * Recommendation OS — telemetry derivation (WFX-041, Lane A).
 *
 * Pure derivation from the MERGED artifacts of this repository:
 *
 * - `deriveQoe(sessionTrail, options)` — QoE metrics from one playback
 *   session trail: the frozen `EntertainmentEvent` raw signal (WFX-005/027/
 *   028 vocabulary — start/progress/complete/...) plus timed frozen
 *   `NativeMediaSession` snapshots (the WFX-004 session health contract:
 *   `state`, `bufferedMs`, `positionMs`). WFX-023 SchedulerStats and WFX-024
 *   BackgroundLog/CompletionEvent are NOT merged at this base — the honest
 *   gap is closed by the documented event-payload extension keys below
 *   (validated, never coerced) and by typed `degraded` markers whenever a
 *   field is absent. NO value is ever fabricated.
 * - `deriveRecommendation(pages, options)` — recommendation metrics from the
 *   merged WFX-021 `FeedPage` outputs (cards + `PipelineTrace`): explanation
 *   coverage, diversity, attention-mode compliance (re-verified from the
 *   composed feed, not trusted from the trace), candidate survival, and
 *   rerank frequency.
 * - `deriveEngagement(events, options)` — skip/complete/like/save rates per
 *   surface from the frozen `EntertainmentEvent`s.
 *
 * DOCUMENTED EVENT-PAYLOAD TELEMETRY EXTENSION (the frozen payload channel
 * `EntertainmentEvent.payload?: Record<string, unknown>` — the same
 * extension mechanism WFX-027 `positionMs` and WFX-028 `percent` use):
 *
 * - `payload.stallMs`      — number, finite, >= 0, on progress/complete
 *   events: stall milliseconds observed since the previous report. Absent or
 *   invalid ⇒ contributes nothing and is listed in the metric's missing
 *   fields.
 * - `payload.seekLatencyMs` — number, finite, >= 0, on progress events: the
 *   observed latency of the seek this progress report satisfies. The frozen
 *   event vocabulary has NO seek type — this key is the explicit seek report
 *   channel; zero observations degrades the SeekLatencyMs metric.
 * - `payload.qualitySwitch` — boolean, on progress/complete events: `true`
 *   marks a quality switch observed at this report; `false` is an explicit
 *   no-switch report. PRESENCE of the key marks the field reported (the
 *   QualitySwitchCount metric is `ok` with count 0 when every report says
 *   false); total absence degrades the metric (unreported, not zero).
 *
 * Purity law: no I/O, no network, no persistence, no timers, no randomness.
 * The ONLY time source is the injected clock (validated — a clock returning
 * a non-ISO value is caller misuse and throws the typed `TelemetryError`).
 * Malformed input throws (typed, aggregated, field-level); ABSENT input
 * degrades the metric with a marker naming the absent field.
 */

import type {
  EntertainmentEvent,
  NativeMediaSession,
  RecommendationPolicy,
} from "@wfx/domain";
import { isIso8601, isRecord, validateEntertainmentEvent } from "@wfx/domain";

import { attentionConstraints } from "../os/attention";
import { consumedItemIds, inProgressItemIds } from "../os/events";
import type { FeedCard, FeedPage, FeedSurface } from "../os/types";

import { percentile } from "./aggregate";
import {
  EXPLANATION_SAMPLE_LIMIT,
  TelemetryError,
  type AttentionModeComplianceMetric,
  type BufferHealthMsMetric,
  type CandidateSurvivalMetric,
  type DiversityIndexMetric,
  type EngagementRatesMetric,
  type ExplanationCoverageMetric,
  type JoinTimeMsMetric,
  type MetricProvenance,
  type QoeMetricSet,
  type QualitySwitchCountMetric,
  type RebufferRatioMetric,
  type RecommendationMetricSet,
  type RerankFrequencyMetric,
  type SeekLatencyMsMetric,
  type TelemetryClock,
} from "./metrics";

// ---------------------------------------------------------------------------
// Input types (the telemetry trail/view of the merged artifacts)
// ---------------------------------------------------------------------------

/** One timed observation of a frozen `NativeMediaSession` (WFX-004 contract shape). */
export interface SessionSample {
  /** The observation instant (ISO 8601 with an explicit offset). */
  at: string;
  /** The frozen native-media session snapshot at that instant. */
  session: NativeMediaSession;
}

/**
 * One playback session's telemetry trail: the frozen engagement events of
 * the session plus timed native-media session snapshots. Both parts are
 * OPTIONAL — an absent part degrades exactly the metrics that need it
 * (typed markers, never fabricated values).
 */
export interface PlaybackSessionTrail {
  /** The playback/experience session identity this trail covers. */
  sessionId: string;
  /** The user whose session this is (the privacy subject). */
  userId: string;
  /** The frozen engagement events of this session (start/progress/...). */
  events?: readonly EntertainmentEvent[];
  /** Timed frozen native-media session snapshots (ascending `at`). */
  samples?: readonly SessionSample[];
}

/** Options for {@link deriveQoe}. */
export interface DeriveQoeOptions {
  /** The injected clock — REQUIRED (no hidden time anywhere in telemetry). */
  clock: TelemetryClock;
}

/** Options for {@link deriveRecommendation}. */
export interface DeriveRecommendationOptions {
  /** The injected clock — REQUIRED (no hidden time anywhere in telemetry). */
  clock: TelemetryClock;
  /**
   * The attention policies by FEED session id — the compliance source of
   * truth. A page whose session has no policy here degrades its
   * AttentionModeCompliance metric (unverified, never guessed).
   */
  policiesBySessionId?: ReadonlyMap<string, RecommendationPolicy>;
  /**
   * The recentEvents by feed session id — the consumed/resume anchor sets
   * for chain-compliance verification (the same signals the OS itself uses).
   * Absent for a session ⇒ the chain check is UNVERIFIED (typed null), never
   * approximated.
   */
  eventsBySessionId?: ReadonlyMap<string, readonly EntertainmentEvent[]>;
}

/** Options for {@link deriveEngagement}. */
export interface DeriveEngagementOptions {
  /** The injected clock — REQUIRED (no hidden time anywhere in telemetry). */
  clock: TelemetryClock;
  /**
   * Surface attribution by engagement session id. Sessions without an entry
   * produce a typed DEGRADED engagement metric ("unattributed") — surface is
   * never guessed from payload shapes.
   */
  surfaceBySessionId?: ReadonlyMap<string, FeedSurface>;
}

// ---------------------------------------------------------------------------
// Documented payload keys (validated, never coerced)
// ---------------------------------------------------------------------------

/** The documented stall report key on progress/complete event payloads. */
export const STALL_MS_PAYLOAD_KEY = "stallMs";

/** The documented seek-latency report key on progress event payloads. */
export const SEEK_LATENCY_MS_PAYLOAD_KEY = "seekLatencyMs";

/** The documented quality-switch report key on progress/complete event payloads. */
export const QUALITY_SWITCH_PAYLOAD_KEY = "qualitySwitch";

/**
 * The closed trace-decision kinds counted as ACTIVE REORDERS by
 * RerankFrequency (the WFX-021 vocabulary at this base): explicit rank
 * adjustments, demotions, run breaks, exploration injections, and chain/
 * extension stops. Declaration kinds ("attention-policy", "position") and
 * honest residual admissions are NOT reorders.
 */
export const REORDER_DECISION_KINDS: readonly string[] = [
  "custom-objective",
  "availability-demotion",
  "objective-run-break",
  "exploration-injection",
  "chain-cap",
  "session-extension-cap",
];

/** The frozen native-media session states (the NativeMediaSession union at this base). */
const NATIVE_SESSION_STATES: readonly string[] = [
  "resolving",
  "buffering",
  "playing",
  "background",
  "complete",
  "failed",
];

/** The frozen attention-mode vocabulary. */
const ATTENTION_MODES: readonly string[] = ["mindful", "balanced", "immersive", "custom"];

/** The frozen feed-surface vocabulary. */
const FEED_SURFACES: readonly string[] = ["watch", "short"];

/** States that count as active playback (the watch clock + buffer health). */
const PLAYBACK_STATES: readonly string[] = ["playing", "background"];

// ---------------------------------------------------------------------------
// Shared validation helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** A validated payload number read: absent | invalid | valid value. */
type PayloadNumber =
  | { present: false }
  | { present: true; valid: false }
  | { present: true; valid: true; value: number };

function readPayloadNumber(
  event: EntertainmentEvent,
  key: string,
): PayloadNumber {
  if (!isRecord(event.payload)) return { present: false };
  if (!(key in event.payload)) return { present: false };
  const raw: unknown = event.payload[key];
  if (isNonNegativeFinite(raw)) return { present: true, valid: true, value: raw };
  return { present: true, valid: false };
}

/** A validated payload boolean read: absent | invalid | valid value. */
type PayloadBoolean =
  | { present: false }
  | { present: true; valid: false }
  | { present: true; valid: true; value: boolean };

function readPayloadBoolean(
  event: EntertainmentEvent,
  key: string,
): PayloadBoolean {
  if (!isRecord(event.payload)) return { present: false };
  if (!(key in event.payload)) return { present: false };
  const raw: unknown = event.payload[key];
  if (typeof raw === "boolean") return { present: true, valid: true, value: raw };
  return { present: true, valid: false };
}

/** The computed instant from the injected clock (validated — no hidden time). */
function clockInstant(clock: TelemetryClock): string {
  const at = clock();
  if (!isIso8601(at)) {
    throw new TelemetryError("invalid-input", [
      `clock: expected an ISO 8601 datetime string with an explicit offset, got '${String(at)}'`,
    ]);
  }
  return at;
}

/** Validate every event with the WFX-002 validator; aggregate the problems. */
function validatedEvents(
  events: readonly unknown[],
  label: string,
): readonly EntertainmentEvent[] {
  const out: EntertainmentEvent[] = [];
  const problems: string[] = [];
  events.forEach((raw, index) => {
    const result = validateEntertainmentEvent(raw);
    if (result.ok) out.push(result.value);
    else problems.push(`${label}[${index}]: ${result.errors.join("; ")}`);
  });
  if (problems.length > 0) throw new TelemetryError("invalid-input", problems);
  return out;
}

// ---------------------------------------------------------------------------
// Session-trail validation (deriveQoe)
// ---------------------------------------------------------------------------

/** Validate one native-media session sample snapshot (frozen shape). */
function sampleProblems(sample: unknown, index: number): string[] {
  if (!isRecord(sample)) {
    return [`samples[${index}]: expected a SessionSample object`];
  }
  const problems: string[] = [];
  if (!isIso8601(sample.at)) {
    problems.push(
      `samples[${index}].at: expected an ISO 8601 datetime string with an explicit offset, got '${String(sample.at)}'`,
    );
  }
  const session: unknown = sample.session;
  if (!isRecord(session)) {
    problems.push(`samples[${index}].session: expected a NativeMediaSession object`);
    return problems;
  }
  if (!isNonEmptyString(session.id)) {
    problems.push(`samples[${index}].session.id: expected a non-empty string`);
  }
  if (!isNonEmptyString(session.assetId)) {
    problems.push(`samples[${index}].session.assetId: expected a non-empty string`);
  }
  if (!isNonEmptyString(session.fileId)) {
    problems.push(`samples[${index}].session.fileId: expected a non-empty string`);
  }
  if (
    typeof session.state !== "string" ||
    !NATIVE_SESSION_STATES.includes(session.state)
  ) {
    problems.push(
      `samples[${index}].session.state: expected one of ${NATIVE_SESSION_STATES.join(" | ")}, got '${String(session.state)}'`,
    );
  }
  if (!isNonNegativeFinite(session.bufferedMs)) {
    problems.push(
      `samples[${index}].session.bufferedMs: expected a finite number >= 0, got '${String(session.bufferedMs)}'`,
    );
  }
  if (!isNonNegativeFinite(session.positionMs)) {
    problems.push(
      `samples[${index}].session.positionMs: expected a finite number >= 0, got '${String(session.positionMs)}'`,
    );
  }
  return problems;
}

/** The validated, normalized view of one playback session trail. */
interface ValidatedTrail {
  sessionId: string;
  userId: string;
  events: readonly EntertainmentEvent[];
  samples: readonly SessionSample[];
}

function validateTrail(trail: PlaybackSessionTrail): ValidatedTrail {
  if (!isRecord(trail)) {
    throw new TelemetryError("invalid-input", ["trail: expected a PlaybackSessionTrail object"]);
  }
  const problems: string[] = [];
  if (!isNonEmptyString(trail.sessionId)) {
    problems.push(`trail.sessionId: expected a non-empty string, got '${String(trail.sessionId)}'`);
  }
  if (!isNonEmptyString(trail.userId)) {
    problems.push(`trail.userId: expected a non-empty string, got '${String(trail.userId)}'`);
  }
  if (problems.length > 0) throw new TelemetryError("invalid-input", problems);

  // Events: frozen-shape validated, then session/user consistency enforced
  // (a trail mixing other sessions' events is caller misuse — never silently
  // dropped).
  const hasEvents = trail.events !== undefined;
  const hasSamples = trail.samples !== undefined;
  if (hasEvents && !Array.isArray(trail.events)) {
    throw new TelemetryError("invalid-input", [
      "trail.events: expected an array of EntertainmentEvent when present",
    ]);
  }
  if (hasSamples && !Array.isArray(trail.samples)) {
    throw new TelemetryError("invalid-input", [
      "trail.samples: expected an array of SessionSample when present",
    ]);
  }

  const events = validatedEvents(trail.events ?? [], "trail.events");
  events.forEach((event, index) => {
    if (event.sessionId !== trail.sessionId) {
      problems.push(
        `trail.events[${index}].sessionId: '${event.sessionId}' does not match the trail session '${trail.sessionId}' — a trail covers exactly one session`,
      );
    }
    if (event.userId !== trail.userId) {
      problems.push(
        `trail.events[${index}].userId: '${event.userId}' does not match the trail user '${trail.userId}'`,
      );
    }
  });

  const samplesRaw: readonly SessionSample[] = trail.samples ?? [];
  samplesRaw.forEach((sample, index) => {
    problems.push(...sampleProblems(sample, index));
  });

  if (problems.length > 0) throw new TelemetryError("invalid-input", problems);

  // Deterministic sample normalization: ascending `at` epoch with the array
  // position as the stable tiebreak (documented — identical trails always
  // produce identical metrics).
  const samples: readonly SessionSample[] = [...samplesRaw].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at) || 0,
  );

  return { sessionId: trail.sessionId, userId: trail.userId, events, samples };
}

// ---------------------------------------------------------------------------
// deriveQoe
// ---------------------------------------------------------------------------

/** The provenance skeleton shared by every metric of one derivation. */
function baseProvenance(
  instanceId: string,
  userId: string,
  sessionId: string,
  rangeStart: string | null,
  rangeEnd: string | null,
  observationCount: number,
  missingFields: readonly string[],
): MetricProvenance {
  return {
    instanceId,
    userId,
    sessionId,
    rangeStart,
    rangeEnd,
    observationCount,
    missingFields: Object.freeze([...missingFields]),
  };
}

/** The earliest event of a type (min epoch, earliest array position tiebreak). */
function earliestEventOf(
  events: readonly EntertainmentEvent[],
  type: EntertainmentEvent["type"],
): EntertainmentEvent | null {
  let best: EntertainmentEvent | null = null;
  let bestEpoch = Number.POSITIVE_INFINITY;
  for (const event of events) {
    if (event.type !== type) continue;
    const epoch = Date.parse(event.occurredAt);
    if (epoch < bestEpoch) {
      bestEpoch = epoch;
      best = event;
    }
  }
  return best;
}

/**
 * Derive the five QoE metrics from one playback session trail.
 *
 * Deterministic: identical (trail, clock) yields identical metrics. Absent
 * input fields produce typed `degraded` markers whose provenance names the
 * field — values are never fabricated.
 */
export function deriveQoe(
  sessionTrail: PlaybackSessionTrail,
  options: DeriveQoeOptions,
): QoeMetricSet {
  const trail = validateTrail(sessionTrail);
  const computedAt = clockInstant(options.clock);

  const hasEvents = sessionTrail.events !== undefined;
  const hasSamples = sessionTrail.samples !== undefined;

  // Input range: earliest..latest observed instant across events + samples.
  let rangeStart: string | null = null;
  let rangeEnd: string | null = null;
  let startEpoch = Number.POSITIVE_INFINITY;
  let endEpoch = Number.NEGATIVE_INFINITY;
  for (const event of trail.events) {
    const epoch = Date.parse(event.occurredAt);
    if (epoch < startEpoch) {
      startEpoch = epoch;
      rangeStart = event.occurredAt;
    }
    if (epoch > endEpoch) {
      endEpoch = epoch;
      rangeEnd = event.occurredAt;
    }
  }
  for (const sample of trail.samples) {
    const epoch = Date.parse(sample.at);
    if (epoch < startEpoch) {
      startEpoch = epoch;
      rangeStart = sample.at;
    }
    if (epoch > endEpoch) {
      endEpoch = epoch;
      rangeEnd = sample.at;
    }
  }

  // --- session-state interval accounting (from the samples) ---------------
  // Interval [i, i+1] carries the state observed at sample i; the final
  // sample closes the trail (no interval extends past the last observation).
  let watchMs = 0;
  let stateStallMs = 0;
  let firstPlaybackIndex: number | null = null;
  trail.samples.forEach((sample, index) => {
    if (PLAYBACK_STATES.includes(sample.session.state) && firstPlaybackIndex === null) {
      firstPlaybackIndex = index;
    }
  });
  for (let index = 0; index + 1 < trail.samples.length; index += 1) {
    const current = trail.samples[index]!;
    const next = trail.samples[index + 1]!;
    const durationMs = Date.parse(next.at) - Date.parse(current.at);
    if (durationMs <= 0) continue;
    if (PLAYBACK_STATES.includes(current.session.state)) {
      watchMs += durationMs;
    } else if (
      current.session.state === "buffering" &&
      firstPlaybackIndex !== null &&
      index > firstPlaybackIndex
    ) {
      // Post-join buffering: rebuffering observed in session states. (The
      // frozen WFX-004 FSM has no playing->buffering hop, so this catches
      // future/rebuffering trails honestly; healthy sessions measure 0.)
      stateStallMs += durationMs;
    }
  }

  // --- payload-channel reports (validated, never coerced) -----------------
  let payloadStallMs = 0;
  const stallMissing: string[] = [];
  let stallReports = 0;
  const seekLatencies: number[] = [];
  const seekMissing: string[] = [];
  let qualityReports = 0;
  let qualitySwitches = 0;
  const qualityMissing: string[] = [];
  for (const event of trail.events) {
    if (event.type !== "progress" && event.type !== "complete") continue;
    const stall = readPayloadNumber(event, STALL_MS_PAYLOAD_KEY);
    if (stall.present && stall.valid) {
      payloadStallMs += stall.value;
      stallReports += 1;
    } else if (stall.present && !stall.valid) {
      stallMissing.push(`payload.${STALL_MS_PAYLOAD_KEY}(invalid)`);
    }
    if (event.type === "progress") {
      const seek = readPayloadNumber(event, SEEK_LATENCY_MS_PAYLOAD_KEY);
      if (seek.present && seek.valid) seekLatencies.push(seek.value);
      else if (seek.present && !seek.valid) {
        seekMissing.push(`payload.${SEEK_LATENCY_MS_PAYLOAD_KEY}(invalid)`);
      }
    }
    const quality = readPayloadBoolean(event, QUALITY_SWITCH_PAYLOAD_KEY);
    if (quality.present && quality.valid) {
      qualityReports += 1;
      if (quality.value) qualitySwitches += 1;
    } else if (quality.present && !quality.valid) {
      qualityMissing.push(`payload.${QUALITY_SWITCH_PAYLOAD_KEY}(invalid)`);
    }
  }

  const stallMs = stateStallMs + payloadStallMs;

  // --- RebufferRatio -------------------------------------------------------
  const rebufferMissing: string[] = [];
  if (!hasSamples) rebufferMissing.push("samples");
  if (stallMissing.length > 0) rebufferMissing.push(...stallMissing);
  let rebufferValue: RebufferRatioMetric["value"];
  if (!hasSamples || watchMs <= 0) {
    rebufferValue = {
      status: "degraded",
      reason: !hasSamples
        ? "samples: absent — watchMs/stallMs unobservable (no native-media session snapshots in the trail)"
        : "samples: no playing/background intervals — watchMs is zero, the ratio has no denominator",
    };
  } else {
    rebufferValue = {
      status: "ok",
      payload: { stallMs, watchMs, ratio: stallMs / watchMs },
    };
  }
  const rebufferRatio: RebufferRatioMetric = {
    kind: "rebuffer-ratio",
    computedAt,
    provenance: baseProvenance(
      trail.sessionId,
      trail.userId,
      trail.sessionId,
      rangeStart,
      rangeEnd,
      trail.samples.length + stallReports,
      rebufferMissing,
    ),
    value: rebufferValue,
  };

  // --- JoinTimeMs ------------------------------------------------------------
  const firstStart = earliestEventOf(trail.events, "start");
  const firstProgress = earliestEventOf(trail.events, "progress");
  const joinMissing: string[] = [];
  let joinValue: JoinTimeMsMetric["value"];
  if (!hasEvents) {
    joinMissing.push("events");
    joinValue = {
      status: "degraded",
      reason: "events: absent — join time (start -> first progress) unmeasurable",
    };
  } else if (firstStart === null) {
    joinMissing.push("events.start");
    joinValue = {
      status: "degraded",
      reason: "events.start: no 'start' event in the trail — join time unmeasurable",
    };
  } else if (firstProgress === null) {
    joinMissing.push("events.progress");
    joinValue = {
      status: "degraded",
      reason: "events.progress: no 'progress' event after start — playback never reported progress",
    };
  } else {
    joinValue = {
      status: "ok",
      payload: {
        joinTimeMs: Date.parse(firstProgress.occurredAt) - Date.parse(firstStart.occurredAt),
      },
    };
  }
  const joinTimeMs: JoinTimeMsMetric = {
    kind: "join-time-ms",
    computedAt,
    provenance: baseProvenance(
      trail.sessionId,
      trail.userId,
      trail.sessionId,
      rangeStart,
      rangeEnd,
      (firstStart !== null ? 1 : 0) + (firstProgress !== null ? 1 : 0),
      joinMissing,
    ),
    value: joinValue,
  };

  // --- SeekLatencyMs -----------------------------------------------------------
  const seekValue: SeekLatencyMsMetric["value"] =
    seekLatencies.length === 0
      ? {
          status: "degraded",
          reason: `payload.${SEEK_LATENCY_MS_PAYLOAD_KEY}: no seek observations — the frozen event vocabulary carries no seek type and no progress event reported the key`,
        }
      : {
          status: "ok",
          payload: {
            meanLatencyMs:
              seekLatencies.reduce((sum, latency) => sum + latency, 0) / seekLatencies.length,
            seekCount: seekLatencies.length,
          },
        };
  const seekLatencyMs: SeekLatencyMsMetric = {
    kind: "seek-latency-ms",
    computedAt,
    provenance: baseProvenance(
      trail.sessionId,
      trail.userId,
      trail.sessionId,
      rangeStart,
      rangeEnd,
      seekLatencies.length,
      seekLatencies.length === 0
        ? [`payload.${SEEK_LATENCY_MS_PAYLOAD_KEY}`, ...seekMissing]
        : seekMissing,
    ),
    value: seekValue,
  };

  // --- QualitySwitchCount --------------------------------------------------------
  const qualityValue: QualitySwitchCountMetric["value"] =
    qualityReports === 0
      ? {
          status: "degraded",
          reason: `payload.${QUALITY_SWITCH_PAYLOAD_KEY}: unreported — no progress/complete event carried the key (absent is not zero; values are never fabricated)`,
        }
      : {
          status: "ok",
          payload: { switchCount: qualitySwitches, reportingEvents: qualityReports },
        };
  const qualitySwitchCount: QualitySwitchCountMetric = {
    kind: "quality-switch-count",
    computedAt,
    provenance: baseProvenance(
      trail.sessionId,
      trail.userId,
      trail.sessionId,
      rangeStart,
      rangeEnd,
      qualityReports,
      qualityReports === 0
        ? [`payload.${QUALITY_SWITCH_PAYLOAD_KEY}`, ...qualityMissing]
        : qualityMissing,
    ),
    value: qualityValue,
  };

  // --- BufferHealthMs --------------------------------------------------------------
  // Buffer-ahead = bufferedMs - positionMs over playback-state samples
  // (kept RAW — a playhead ahead of the buffer is a real unhealthy signal,
  // never clamped). Percentiles use the deterministic interpolation of
  // aggregate.ts percentile().
  const bufferAhead: number[] = [];
  for (const sample of trail.samples) {
    if (PLAYBACK_STATES.includes(sample.session.state)) {
      bufferAhead.push(sample.session.bufferedMs - sample.session.positionMs);
    }
  }
  const sortedBufferAhead = [...bufferAhead].sort((a, b) => a - b);
  const bufferValue: BufferHealthMsMetric["value"] =
    sortedBufferAhead.length === 0
      ? {
          status: "degraded",
          reason: !hasSamples
            ? "samples: absent — buffer health unobservable (no native-media session snapshots in the trail)"
            : "samples: no playing/background snapshots — buffer-ahead has no samples",
        }
      : {
          status: "ok",
          payload: {
            samples: Object.freeze(sortedBufferAhead),
            p50: percentile(sortedBufferAhead, 0.5),
            p95: percentile(sortedBufferAhead, 0.95),
          },
        };
  const bufferHealthMs: BufferHealthMsMetric = {
    kind: "buffer-health-ms",
    computedAt,
    provenance: baseProvenance(
      trail.sessionId,
      trail.userId,
      trail.sessionId,
      rangeStart,
      rangeEnd,
      sortedBufferAhead.length,
      sortedBufferAhead.length === 0 ? ["samples"] : [],
    ),
    value: bufferValue,
  };

  return {
    rebufferRatio,
    joinTimeMs,
    seekLatencyMs,
    qualitySwitchCount,
    bufferHealthMs,
  };
}

// ---------------------------------------------------------------------------
// Feed-page validation (deriveRecommendation)
// ---------------------------------------------------------------------------

/** Validate one TraceDecision record (tolerant kind — see module docs). */
function decisionProblems(decision: unknown, label: string): string[] {
  if (!isRecord(decision)) return [`${label}: expected a TraceDecision object`];
  const problems: string[] = [];
  if (!isNonEmptyString(decision.kind)) {
    problems.push(`${label}.kind: expected a non-empty string`);
  }
  if (typeof decision.detail !== "string") {
    problems.push(`${label}.detail: expected a string`);
  }
  if (!Array.isArray(decision.itemIds) || !decision.itemIds.every(isNonEmptyString)) {
    problems.push(`${label}.itemIds: expected an array of strings`);
  }
  return problems;
}

/** Validate one FeedCard record (the fields telemetry consumes). */
function cardProblems(card: unknown, label: string): string[] {
  if (!isRecord(card)) return [`${label}: expected a FeedCard object`];
  const problems: string[] = [];
  if (!isNonNegativeInteger(card.position)) {
    problems.push(`${label}.position: expected a non-negative integer`);
  }
  const candidate: unknown = card.candidate;
  if (!isRecord(candidate)) {
    problems.push(`${label}.candidate: expected an EntertainmentCandidate object`);
  } else {
    if (!isNonEmptyString(candidate.itemId)) {
      problems.push(`${label}.candidate.itemId: expected a non-empty string`);
    }
    if (!isRecord(candidate.features)) {
      problems.push(`${label}.candidate.features: expected a record`);
    }
  }
  if (!Array.isArray(card.explanations) || !card.explanations.every(isNonEmptyString)) {
    problems.push(`${label}.explanations: expected an array of strings`);
  }
  if (card.dominantObjective !== null && !isNonEmptyString(card.dominantObjective)) {
    problems.push(`${label}.dominantObjective: expected a non-empty string or null`);
  }
  return problems;
}

/** Validate one FeedPage (envelope + the fields telemetry consumes). */
function pageProblems(page: unknown, index: number): string[] {
  if (!isRecord(page)) return [`pages[${index}]: expected a FeedPage object`];
  const label = `pages[${index}]`;
  const problems: string[] = [];
  if (typeof page.surface !== "string" || !FEED_SURFACES.includes(page.surface)) {
    problems.push(`${label}.surface: expected 'watch' | 'short', got '${String(page.surface)}'`);
  }
  if (!isNonEmptyString(page.userId)) {
    problems.push(`${label}.userId: expected a non-empty string`);
  }
  if (!isNonEmptyString(page.sessionId)) {
    problems.push(`${label}.sessionId: expected a non-empty string`);
  }
  if (!Array.isArray(page.cards)) {
    problems.push(`${label}.cards: expected an array of FeedCard`);
    return problems;
  }
  page.cards.forEach((card, cardIndex) => {
    problems.push(...cardProblems(card, `${label}.cards[${cardIndex}]`));
  });
  const trace: unknown = page.trace;
  if (!isRecord(trace)) {
    problems.push(`${label}.trace: expected a PipelineTrace object`);
    return problems;
  }
  const model: unknown = trace.model;
  if (!isRecord(model)) {
    problems.push(`${label}.trace.model: expected a model identity record`);
  } else {
    if (!isNonEmptyString(model.id)) {
      problems.push(`${label}.trace.model.id: expected a non-empty string`);
    }
    if (!isNonEmptyString(model.version)) {
      problems.push(`${label}.trace.model.version: expected a non-empty string`);
    }
  }
  if (!Array.isArray(trace.stages)) {
    problems.push(`${label}.trace.stages: expected an array of PipelineStageRecord`);
    return problems;
  }
  trace.stages.forEach((stage: unknown, stageIndex: number) => {
    const stageLabel = `${label}.trace.stages[${stageIndex}]`;
    if (!isRecord(stage)) {
      problems.push(`${stageLabel}: expected a PipelineStageRecord object`);
      return;
    }
    if (!isNonEmptyString(stage.stage)) {
      problems.push(`${stageLabel}.stage: expected a non-empty string`);
    }
    if (!isNonNegativeInteger(stage.inputCount)) {
      problems.push(`${stageLabel}.inputCount: expected a non-negative integer`);
    }
    if (!isNonNegativeInteger(stage.outputCount)) {
      problems.push(`${stageLabel}.outputCount: expected a non-negative integer`);
    }
    if (!Array.isArray(stage.decisions)) {
      problems.push(`${stageLabel}.decisions: expected an array of TraceDecision`);
      return;
    }
    stage.decisions.forEach((decision: unknown, decisionIndex: number) => {
      problems.push(
        ...decisionProblems(decision, `${stageLabel}.decisions[${decisionIndex}]`),
      );
    });
  });
  return problems;
}

/** Validate an attention policy for compliance derivation (the consumed fields). */
function policyProblems(policy: unknown, sessionId: string): string[] {
  if (!isRecord(policy)) {
    return [`policiesBySessionId['${sessionId}']: expected a RecommendationPolicy object`];
  }
  const problems: string[] = [];
  if (typeof policy.attentionMode !== "string" || !ATTENTION_MODES.includes(policy.attentionMode)) {
    problems.push(
      `policiesBySessionId['${sessionId}'].attentionMode: expected 'mindful' | 'balanced' | 'immersive' | 'custom', got '${String(policy.attentionMode)}'`,
    );
  }
  if (
    policy.maxSessionExtensionMinutes !== undefined &&
    !isNonNegativeFinite(policy.maxSessionExtensionMinutes)
  ) {
    problems.push(
      `policiesBySessionId['${sessionId}'].maxSessionExtensionMinutes: expected a finite number >= 0 when present`,
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Attention-compliance verification (the output invariant re-check)
// ---------------------------------------------------------------------------

/** The documented `nextEpisodeOf` feature key read from a composed card. */
function feedCardNextEpisodeOf(card: FeedCard): string | null {
  const value: unknown = card.candidate.features["nextEpisodeOf"];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Does this composed card extend the session after `previousItemId`?
 * Mirrors the frozen law of ../os/attention.ts `isSessionExtending` applied
 * to FeedCard records: an item extends when its documented `nextEpisodeOf`
 * links to the previous card's item or to a consumed anchor — UNLESS the
 * item itself is in progress (a resume is the user's own continuation).
 */
function feedCardIsSessionExtending(
  card: FeedCard,
  previousItemId: string | null,
  consumedIds: ReadonlySet<string>,
  resumeIds: ReadonlySet<string>,
): boolean {
  if (resumeIds.has(card.candidate.itemId)) return false;
  const next = feedCardNextEpisodeOf(card);
  if (next === null) return false;
  if (previousItemId !== null && next === previousItemId) return true;
  return consumedIds.has(next);
}

/** Σ max(0, runLength − cap) over maximal same-objective runs (0 when no cap). */
function objectiveGapViolations(cards: readonly FeedCard[], cap: number | null): number {
  if (cap === null) return 0;
  let violations = 0;
  let runLength = 0;
  let lastObjective: string | null = null;
  for (const card of cards) {
    const objective = card.dominantObjective;
    if (objective === null || objective !== lastObjective) {
      runLength = objective === null ? 0 : 1;
      lastObjective = objective;
    } else {
      runLength += 1;
    }
    if (objective !== null && runLength > cap) violations += 1;
  }
  return violations;
}

/** Σ max(0, chainLength − cap) over maximal extending runs (0 when no cap). */
function chainViolationsOf(
  cards: readonly FeedCard[],
  cap: number | null,
  consumedIds: ReadonlySet<string>,
  resumeIds: ReadonlySet<string>,
): number {
  if (cap === null) return 0;
  let violations = 0;
  let chainLength = 0;
  let previousItemId: string | null = null;
  for (const card of cards) {
    const extending = feedCardIsSessionExtending(card, previousItemId, consumedIds, resumeIds);
    if (extending) chainLength += 1;
    else chainLength = 0;
    if (extending && chainLength > cap) violations += 1;
    previousItemId = card.candidate.itemId;
  }
  return violations;
}

// ---------------------------------------------------------------------------
// deriveRecommendation
// ---------------------------------------------------------------------------

/**
 * Derive the five recommendation metrics for each merged WFX-021 feed page.
 *
 * Attention-mode compliance re-verifies the composed feed OUTPUT against the
 * attention-policy constraints (objective-gap cap + session-extending chain
 * cap) — telemetry PROVES compliance instead of trusting the pipeline's own
 * trace. Pages without a supplied policy degrade the compliance metric; the
 * chain check is unverified (typed null) when the session's recentEvents are
 * not supplied — never guessed.
 */
export function deriveRecommendation(
  pages: readonly FeedPage[],
  options: DeriveRecommendationOptions,
): readonly RecommendationMetricSet[] {
  if (!Array.isArray(pages)) {
    throw new TelemetryError("invalid-input", [
      "pages: expected an array of FeedPage",
    ]);
  }
  // Re-typed after the runtime guard: `Array.isArray` narrows the declared
  // array into an intersection with any[]; the clean local restores the
  // declared type for the typed work below.
  const pageList: readonly FeedPage[] = pages;
  const computedAt = clockInstant(options.clock);
  const problems: string[] = [];
  pageList.forEach((page, index) => {
    problems.push(...pageProblems(page, index));
  });

  // Option maps: lookups only (no iteration — deterministic).
  const policies = options.policiesBySessionId;
  const eventsBySession = options.eventsBySessionId;
  if (policies !== undefined && !(policies instanceof Map)) {
    throw new TelemetryError("invalid-input", [
      "options.policiesBySessionId: expected a Map<string, RecommendationPolicy>",
    ]);
  }
  if (eventsBySession !== undefined && !(eventsBySession instanceof Map)) {
    throw new TelemetryError("invalid-input", [
      "options.eventsBySessionId: expected a Map<string, EntertainmentEvent[]>",
    ]);
  }
  if (policies !== undefined) {
    for (const [sessionId, policy] of policies) {
      problems.push(...policyProblems(policy, sessionId));
    }
  }
  if (eventsBySession !== undefined) {
    for (const [sessionId, events] of eventsBySession) {
      if (!Array.isArray(events)) {
        problems.push(
          `eventsBySessionId['${sessionId}']: expected an array of EntertainmentEvent`,
        );
        continue;
      }
      validatedEvents(events, `eventsBySessionId['${sessionId}']`);
    }
  }
  if (problems.length > 0) throw new TelemetryError("invalid-input", problems);

  return pageList.map((page) => {
    const sessionId: string = page.sessionId;
    const instanceId = sessionId;
    const provenance = (observationCount: number, missingFields: readonly string[]): MetricProvenance =>
      baseProvenance(
        instanceId,
        page.userId,
        sessionId,
        // The WFX-021 FeedPage carries no instants — honest nulls.
        null,
        null,
        observationCount,
        missingFields,
      );

    const cards: readonly FeedCard[] = page.cards;
    const emptyFeed = cards.length === 0;

    // --- ExplanationCoverage --------------------------------------------
    const coveredCards = cards.filter((card) => card.explanations.length > 0).length;
    const sampleExplanations: string[] = [];
    for (const card of cards) {
      if (card.explanations.length === 0) continue;
      for (const explanation of card.explanations) {
        if (sampleExplanations.length >= EXPLANATION_SAMPLE_LIMIT) break;
        sampleExplanations.push(explanation);
      }
      if (sampleExplanations.length >= EXPLANATION_SAMPLE_LIMIT) break;
    }
    const coverageValue: ExplanationCoverageMetric["value"] = emptyFeed
      ? {
          status: "degraded",
          reason: "cards: the feed carries no cards — coverage over an empty feed is undefined",
        }
      : {
          status: "ok",
          payload: {
            coveredCards,
            totalCards: cards.length,
            coverage: coveredCards / cards.length,
            sampleExplanations: Object.freeze(sampleExplanations),
          },
        };
    const explanationCoverage: ExplanationCoverageMetric = {
      kind: "explanation-coverage",
      computedAt,
      provenance: provenance(cards.length, emptyFeed ? ["cards"] : []),
      value: coverageValue,
    };

    // --- DiversityIndex ---------------------------------------------------
    const distinctObjectives = new Set<string>();
    for (const card of cards) {
      if (card.dominantObjective !== null) distinctObjectives.add(card.dominantObjective);
    }
    const diversityValue: DiversityIndexMetric["value"] = emptyFeed
      ? {
          status: "degraded",
          reason: "cards: the feed carries no cards — diversity over an empty feed is undefined",
        }
      : {
          status: "ok",
          payload: {
            distinctObjectives: distinctObjectives.size,
            totalCards: cards.length,
            index: distinctObjectives.size / cards.length,
          },
        };
    const diversityIndex: DiversityIndexMetric = {
      kind: "diversity-index",
      computedAt,
      provenance: provenance(cards.length, emptyFeed ? ["cards"] : []),
      value: diversityValue,
    };

    // --- AttentionModeCompliance (the output invariant re-check) ------------
    const policy = policies?.get(sessionId);
    let complianceValue: AttentionModeComplianceMetric["value"];
    let complianceMissing: string[] = [];
    let complianceObservations = cards.length;
    if (policy === undefined) {
      complianceValue = {
        status: "degraded",
        reason:
          "policiesBySessionId: no attention policy for this feed session — compliance unverified (never guessed)",
      };
      complianceMissing = ["policiesBySessionId"];
      complianceObservations = 0;
    } else {
      const constraints = attentionConstraints(policy);
      const gapViolations = objectiveGapViolations(
        cards,
        constraints.maxConsecutiveSameObjective,
      );
      let chainViolations: number | null;
      const sessionEvents = eventsBySession?.get(sessionId);
      if (
        constraints.maxSessionExtendingChain === null ||
        sessionEvents !== undefined
      ) {
        const consumed = consumedItemIds(sessionEvents ?? []);
        const resume = inProgressItemIds(sessionEvents ?? []);
        chainViolations = chainViolationsOf(
          cards,
          constraints.maxSessionExtendingChain,
          consumed,
          resume,
        );
      } else {
        // No recentEvents: the chain check would need the consumed/resume
        // anchor sets — UNVERIFIED (typed null), never approximated.
        chainViolations = null;
        complianceMissing = ["eventsBySessionId"];
      }
      complianceValue = {
        status: "ok",
        payload: {
          attentionMode: constraints.attentionMode,
          objectiveGapViolations: gapViolations,
          chainViolations,
          totalViolations: gapViolations + (chainViolations ?? 0),
          checkedCards: cards.length,
        },
      };
    }
    const attentionModeCompliance: AttentionModeComplianceMetric = {
      kind: "attention-mode-compliance",
      computedAt,
      provenance: provenance(complianceObservations, complianceMissing),
      value: complianceValue,
    };

    // --- CandidateSurvival ---------------------------------------------------
    const retrievalStage = page.trace.stages.find((stage) => stage.stage === "retrieval");
    const compositionStage = page.trace.stages.find((stage) => stage.stage === "composition");
    let survivalValue: CandidateSurvivalMetric["value"];
    let survivalMissing: string[] = [];
    if (retrievalStage === undefined || compositionStage === undefined) {
      const absent: string[] = [];
      if (retrievalStage === undefined) absent.push("trace.stages[retrieval]");
      if (compositionStage === undefined) absent.push("trace.stages[composition]");
      survivalMissing = absent;
      survivalValue = {
        status: "degraded",
        reason: `${absent.join(", ")}: absent from the PipelineTrace — survival unmeasurable`,
      };
    } else if (retrievalStage.outputCount === 0) {
      survivalMissing = ["trace.stages[retrieval].outputCount"];
      survivalValue = {
        status: "degraded",
        reason:
          "trace.stages[retrieval].outputCount: the pool was empty — survival over an empty pool is undefined",
      };
    } else {
      const retrieved = retrievalStage.outputCount;
      const surviving = compositionStage.outputCount;
      survivalValue = {
        status: "ok",
        payload: {
          retrieved,
          surviving,
          survival: surviving / retrieved,
          narrowed: surviving < retrieved,
        },
      };
    }
    const candidateSurvival: CandidateSurvivalMetric = {
      kind: "candidate-survival",
      computedAt,
      provenance: provenance(
        (retrievalStage?.outputCount ?? 0) + (compositionStage?.outputCount ?? 0),
        survivalMissing,
      ),
      value: survivalValue,
    };

    // --- RerankFrequency ------------------------------------------------------
    let rerankDecisions = 0;
    for (const stage of page.trace.stages) {
      for (const decision of stage.decisions) {
        if (REORDER_DECISION_KINDS.includes(decision.kind)) rerankDecisions += 1;
      }
    }
    const rerankValue: RerankFrequencyMetric["value"] = emptyFeed
      ? {
          status: "degraded",
          reason: "cards: the feed carries no cards — rerank frequency over an empty feed is undefined",
        }
      : {
          status: "ok",
          payload: {
            rerankDecisions,
            totalCards: cards.length,
            frequency: rerankDecisions / cards.length,
          },
        };
    const rerankFrequency: RerankFrequencyMetric = {
      kind: "rerank-frequency",
      computedAt,
      provenance: provenance(
        page.trace.stages.reduce((sum, stage) => sum + stage.decisions.length, 0),
        emptyFeed ? ["cards"] : [],
      ),
      value: rerankValue,
    };

    return {
      explanationCoverage,
      diversityIndex,
      attentionModeCompliance,
      candidateSurvival,
      rerankFrequency,
    };
  });
}

// ---------------------------------------------------------------------------
// deriveEngagement
// ---------------------------------------------------------------------------

/**
 * Derive the engagement rate metrics from a batch of frozen engagement
 * events: one metric unit per (surface, engagement session).
 *
 * Surface attribution comes from `options.surfaceBySessionId` — surface is
 * NEVER guessed from payload shapes (that would be a silent heuristic).
 * Sessions without attribution produce a typed DEGRADED "unattributed" unit
 * (the events are accounted in provenance, never silently dropped). The
 * rate denominator is the session's engagement event count (every
 * non-impression event); a zero denominator degrades the rates.
 */
export function deriveEngagement(
  events: readonly EntertainmentEvent[],
  options: DeriveEngagementOptions,
): readonly EngagementRatesMetric[] {
  if (!Array.isArray(events)) {
    throw new TelemetryError("invalid-input", [
      "events: expected an array of EntertainmentEvent",
    ]);
  }
  const computedAt = clockInstant(options.clock);
  const validated = validatedEvents(events, "events");

  const surfaces = options.surfaceBySessionId;
  if (surfaces !== undefined && !(surfaces instanceof Map)) {
    throw new TelemetryError("invalid-input", [
      "options.surfaceBySessionId: expected a Map<string, 'watch' | 'short'>",
    ]);
  }
  if (surfaces !== undefined) {
    const problems: string[] = [];
    for (const [sessionId, surface] of surfaces) {
      if (typeof surface !== "string" || !FEED_SURFACES.includes(surface)) {
        problems.push(
          `surfaceBySessionId['${sessionId}']: expected 'watch' | 'short', got '${String(surface)}'`,
        );
      }
    }
    if (problems.length > 0) throw new TelemetryError("invalid-input", problems);
  }

  // Group by session, deterministic first-appearance order.
  const bySession = new Map<string, EntertainmentEvent[]>();
  for (const event of validated) {
    const group = bySession.get(event.sessionId);
    if (group === undefined) bySession.set(event.sessionId, [event]);
    else group.push(event);
  }

  // One session = one user: a session mixing users' events is caller misuse
  // (the metric's privacy subject is picked silently otherwise — never).
  const consistencyProblems: string[] = [];
  for (const [sessionId, sessionEvents] of bySession) {
    const userId = sessionEvents[0]!.userId;
    sessionEvents.forEach((event, index) => {
      if (event.userId !== userId) {
        consistencyProblems.push(
          `events: session '${sessionId}' mixes userIds ('${userId}' and '${event.userId}' at event ${index}) — one engagement session belongs to one user`,
        );
      }
    });
  }
  if (consistencyProblems.length > 0) {
    throw new TelemetryError("invalid-input", consistencyProblems);
  }

  const metrics: EngagementRatesMetric[] = [];
  for (const [sessionId, sessionEvents] of bySession) {
    const userId = sessionEvents[0]!.userId;
    const surface = surfaces?.get(sessionId);
    const attributed = surface !== undefined;

    // Session input range (earliest..latest event instant).
    let rangeStart: string | null = null;
    let rangeEnd: string | null = null;
    let startEpoch = Number.POSITIVE_INFINITY;
    let endEpoch = Number.NEGATIVE_INFINITY;
    for (const event of sessionEvents) {
      const epoch = Date.parse(event.occurredAt);
      if (epoch < startEpoch) {
        startEpoch = epoch;
        rangeStart = event.occurredAt;
      }
      if (epoch > endEpoch) {
        endEpoch = epoch;
        rangeEnd = event.occurredAt;
      }
    }

    const engagementEvents = sessionEvents.filter((event) => event.type !== "impression");
    const count = (type: EntertainmentEvent["type"]): number =>
      sessionEvents.filter((event) => event.type === type).length;
    const skip = count("skip");
    const complete = count("complete");
    const like = count("like");
    const save = count("save");
    const denominator = engagementEvents.length;

    let value: EngagementRatesMetric["value"];
    let missingFields: string[] = [];
    if (!attributed) {
      missingFields = ["surfaceBySessionId"];
      value = {
        status: "degraded",
        reason:
          "surfaceBySessionId: no surface attribution for this engagement session — rates per surface are unmeasurable (surface is never guessed from payload shapes)",
      };
    } else if (denominator === 0) {
      missingFields = ["engagementEvents"];
      value = {
        status: "degraded",
        reason:
          "engagementEvents: the session carries only impressions — the rate denominator is zero (never a fake 0)",
      };
    } else {
      value = {
        status: "ok",
        payload: {
          surface: surface!,
          skip,
          complete,
          like,
          save,
          engagementEvents: denominator,
          skipRate: skip / denominator,
          completeRate: complete / denominator,
          likeRate: like / denominator,
          saveRate: save / denominator,
        },
      };
    }

    metrics.push({
      kind: "engagement-rates",
      computedAt,
      provenance: baseProvenance(
        `${attributed ? surface! : "unattributed"}|${sessionId}`,
        userId,
        sessionId,
        rangeStart,
        rangeEnd,
        sessionEvents.length,
        missingFields,
      ),
      value,
    });
  }
  return metrics;
}
