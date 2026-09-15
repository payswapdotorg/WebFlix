/**
 * Recommendation OS — telemetry sink + report (WFX-041, Lane A).
 *
 * - `TelemetrySink` — the typed PORT telemetry is recorded through. This
 *   module ships NO network and NO persistence: the sink is injected by the
 *   caller (`createRecorderSink()` is the in-memory, replayable reference
 *   implementation — validation on record, typed errors on garbage).
 * - `telemetryReport(aggregate, windowStart, options)` — the typed,
 *   serializable, SCHEMA-VERSIONED report document for one window: per
 *   metric bucket (per surface for engagement), values pooled from the
 *   window's surviving `ok` instances, degraded instance counts disclosed
 *   (telemetry quality), and suppressed buckets (privacy redaction) shown as
 *   typed markers that withhold values AND per-bucket counts — no
 *   misleading rates, ever. `generatedAt` comes from the injected clock
 *   (there is no hidden time).
 *
 * Documented pooling per kind: rebuffer-ratio pools stallMs/watchMs across
 * sessions (the micro-average — Σstall/Σwatch); join-time and diversity
 * take the mean over sessions/pages; seek-latency pools by seek count
 * (Σ mean·count / Σ count); buffer-health merges the sample MULTISET through
 * the bounded sketch (aggregate.ts) and interpolates p50/p95 from it;
 * explanation-coverage, candidate-survival, and rerank-frequency pool by
 * card/pool totals; engagement pools the counts per surface and recomputes
 * the rates (per-session rates never masquerade as window rates); attention
 * compliance sums the observed violations and reports the typed verdict
 * ("compliant" only when every feed session was fully verified with zero
 * violations — "partially-verified" is the honest in-between).
 *
 * Determinism: the report is a pure function of (aggregate, windowStart,
 * clock output). Summation follows the window's canonical instance order,
 * so equal instance sets always yield byte-identical reports — the property
 * the merge-associativity guarantee rests on (see aggregate.ts).
 */

import { isIso8601, isRecord } from "@wfx/domain";

import { assertValidMetric, boundedSketch, percentile, type Aggregation } from "./aggregate";
import {
  EXPLANATION_SAMPLE_LIMIT,
  TelemetryError,
  type TelemetryClock,
  type TelemetryMetric,
} from "./metrics";

// ---------------------------------------------------------------------------
// The sink port + the in-memory recorder
// ---------------------------------------------------------------------------

/**
 * The telemetry sink port: where derived metrics are recorded. The port is
 * deliberately synchronous and side-effect-shaped — network/persistence
 * sinks are future work items and would be injected behind this same
 * interface, never hardcoded (this module has NO I/O of its own).
 */
export interface TelemetrySink {
  /**
   * Record one derived metric. Malformed metrics are caller misuse and
   * throw the typed `TelemetryError` — no silent drops, no fake success.
   */
  record(metric: TelemetryMetric): void;
}

/** The in-memory, replayable reference sink. */
export interface RecorderSink extends TelemetrySink {
  /** Every recorded metric, in record order (a replayable batch). */
  replay(): readonly TelemetryMetric[];
  /** The number of recorded metrics. */
  size(): number;
  /** Clear the recorder (the retained metrics are dropped). */
  clear(): void;
}

/** Create the in-memory recorder sink (replayable, validating). */
export function createRecorderSink(): RecorderSink {
  const recorded: TelemetryMetric[] = [];
  return {
    record(metric: TelemetryMetric): void {
      assertValidMetric(metric);
      recorded.push(metric);
    },
    replay(): readonly TelemetryMetric[] {
      return Object.freeze([...recorded]);
    },
    size(): number {
      return recorded.length;
    },
    clear(): void {
      recorded.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// The report document (schema-versioned, serializable)
// ---------------------------------------------------------------------------

/** The telemetry report schema version (bump on incompatible changes). */
export const TELEMETRY_REPORT_SCHEMA_VERSION = 1;

/** Options for {@link telemetryReport}. */
export interface TelemetryReportOptions {
  /** The injected clock — REQUIRED: `generatedAt` is never hidden time. */
  clock: TelemetryClock;
}

/** The attention-mode compliance verdict of a window's recommendation feeds. */
export type ComplianceVerdict = "compliant" | "violations" | "partially-verified";

/** The per-bucket summary status: measured, absent values, or withheld. */
export type SummaryStatus = "ok" | "no-samples" | "suppressed";

/**
 * Every per-bucket report summary (a discriminated union on `kind` — plus
 * `surface` for engagement buckets). `ok` summaries pool the surviving ok
 * instances' values (documented pooling per kind); `no-samples` discloses
 * the degraded instance count (telemetry quality); `suppressed` summaries
 * withhold values AND per-bucket counts (small-n privacy suppression).
 */
export type ReportMetricSummary =
  // attention-mode-compliance
  | {
      kind: "attention-mode-compliance";
      status: "ok";
      degradedInstances: number;
      verifiedSessions: number;
      chainUnverifiedSessions: number;
      objectiveGapViolations: number;
      chainViolations: number;
      totalViolations: number;
      compliance: ComplianceVerdict;
    }
  | { kind: "attention-mode-compliance"; status: "no-samples"; degradedInstances: number }
  | { kind: "attention-mode-compliance"; status: "suppressed" }
  // buffer-health-ms
  | {
      kind: "buffer-health-ms";
      status: "ok";
      degradedInstances: number;
      sessions: number;
      p50: number;
      p95: number;
      totalSamples: number;
      approximate: boolean;
    }
  | { kind: "buffer-health-ms"; status: "no-samples"; degradedInstances: number }
  | { kind: "buffer-health-ms"; status: "suppressed" }
  // candidate-survival
  | {
      kind: "candidate-survival";
      status: "ok";
      degradedInstances: number;
      pages: number;
      pooledRetrieved: number;
      pooledSurviving: number;
      pooledSurvival: number;
      narrowedPages: number;
    }
  | { kind: "candidate-survival"; status: "no-samples"; degradedInstances: number }
  | { kind: "candidate-survival"; status: "suppressed" }
  // diversity-index
  | {
      kind: "diversity-index";
      status: "ok";
      degradedInstances: number;
      pages: number;
      meanIndex: number;
    }
  | { kind: "diversity-index"; status: "no-samples"; degradedInstances: number }
  | { kind: "diversity-index"; status: "suppressed" }
  // engagement-rates (one summary per surface bucket)
  | {
      kind: "engagement-rates";
      surface: string;
      status: "ok";
      degradedInstances: number;
      sessions: number;
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
  | {
      kind: "engagement-rates";
      surface: string;
      status: "no-samples";
      degradedInstances: number;
    }
  | { kind: "engagement-rates"; surface: string; status: "suppressed" }
  // explanation-coverage
  | {
      kind: "explanation-coverage";
      status: "ok";
      degradedInstances: number;
      pages: number;
      coveredCards: number;
      totalCards: number;
      coverage: number;
      sampleExplanations: readonly string[];
    }
  | { kind: "explanation-coverage"; status: "no-samples"; degradedInstances: number }
  | { kind: "explanation-coverage"; status: "suppressed" }
  // join-time-ms
  | {
      kind: "join-time-ms";
      status: "ok";
      degradedInstances: number;
      sessions: number;
      meanJoinTimeMs: number;
    }
  | { kind: "join-time-ms"; status: "no-samples"; degradedInstances: number }
  | { kind: "join-time-ms"; status: "suppressed" }
  // quality-switch-count
  | {
      kind: "quality-switch-count";
      status: "ok";
      degradedInstances: number;
      sessions: number;
      totalSwitches: number;
      reportingEvents: number;
    }
  | { kind: "quality-switch-count"; status: "no-samples"; degradedInstances: number }
  | { kind: "quality-switch-count"; status: "suppressed" }
  // rebuffer-ratio
  | {
      kind: "rebuffer-ratio";
      status: "ok";
      degradedInstances: number;
      sessions: number;
      pooledStallMs: number;
      pooledWatchMs: number;
      pooledRatio: number;
    }
  | { kind: "rebuffer-ratio"; status: "no-samples"; degradedInstances: number }
  | { kind: "rebuffer-ratio"; status: "suppressed" }
  // rerank-frequency
  | {
      kind: "rerank-frequency";
      status: "ok";
      degradedInstances: number;
      pages: number;
      rerankDecisions: number;
      totalCards: number;
      pooledFrequency: number;
    }
  | { kind: "rerank-frequency"; status: "no-samples"; degradedInstances: number }
  | { kind: "rerank-frequency"; status: "suppressed" }
  // seek-latency-ms
  | {
      kind: "seek-latency-ms";
      status: "ok";
      degradedInstances: number;
      sessions: number;
      totalSeeks: number;
      meanLatencyMs: number;
    }
  | { kind: "seek-latency-ms"; status: "no-samples"; degradedInstances: number }
  | { kind: "seek-latency-ms"; status: "suppressed" };

/** The typed, serializable telemetry report for one window. */
export interface TelemetryReport {
  /** The report schema version (see TELEMETRY_REPORT_SCHEMA_VERSION). */
  schemaVersion: number;
  /** The window identity and geometry. */
  window: {
    startMs: number;
    endExclusiveMs: number;
    bucketMs: number;
  };
  /** When the report was generated (the injected clock — never hidden). */
  generatedAt: string;
  /**
   * The per-bucket summaries, sorted by bucket key (kind, then surface for
   * engagement). Only OBSERVED buckets appear — an absent kind has no row.
   */
  metrics: readonly ReportMetricSummary[];
  /** The total number of instances in the window (all kinds — quality signal). */
  instanceCount: number;
  /** The number of degraded instances (telemetry quality signal). */
  degradedCount: number;
  /** True when any bucket's values were privacy-suppressed (redaction). */
  suppressedPresent: boolean;
}

// ---------------------------------------------------------------------------
// Report materialization helpers
// ---------------------------------------------------------------------------

/** The metric of one kind, narrowed (a runtime-checked type predicate). */
function ofKind<K extends TelemetryMetric["kind"]>(
  instances: readonly TelemetryMetric[],
  kind: K,
): readonly Extract<TelemetryMetric, { kind: K }>[] {
  return instances.filter(
    (metric): metric is Extract<TelemetryMetric, { kind: K }> => metric.kind === kind,
  );
}

/** The surface segment of an engagement instance id (`surface|session`). */
function surfaceSegmentOf(metric: TelemetryMetric): string {
  const separator = metric.provenance.instanceId.indexOf("|");
  return separator === -1 ? "unattributed" : metric.provenance.instanceId.slice(0, separator);
}

/** The report bucket key of an instance: kind, plus surface for engagement. */
function reportBucketKey(metric: TelemetryMetric): string {
  return metric.kind === "engagement-rates"
    ? `${metric.kind}:${surfaceSegmentOf(metric)}`
    : metric.kind;
}

/** One report bucket: the instances sharing a summary row. */
interface ReportBucket {
  key: string;
  kind: TelemetryMetric["kind"];
  surface: string | null;
  instances: readonly TelemetryMetric[];
}

/** Bucket the window's instances for summarization (canonical key order). */
function bucketInstances(instances: readonly TelemetryMetric[]): readonly ReportBucket[] {
  const byKey = new Map<string, TelemetryMetric[]>();
  for (const metric of instances) {
    assertValidMetric(metric);
    const key = reportBucketKey(metric);
    const group = byKey.get(key);
    if (group === undefined) byKey.set(key, [metric]);
    else group.push(metric);
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, group]) => {
      const first = group[0]!;
      return {
        key,
        kind: first.kind,
        surface: first.kind === "engagement-rates" ? surfaceSegmentOf(first) : null,
        instances: group,
      };
    });
}

/** Summarize one bucket (per-kind pooling; see the module doc). */
function summarizeBucket(bucket: ReportBucket): ReportMetricSummary {
  const instances = bucket.instances;
  const degradedInstances = instances.filter((metric) => metric.value.status !== "ok").length;
  const suppressed = instances.some((metric) => metric.value.status === "suppressed");

  switch (bucket.kind) {
    case "rebuffer-ratio": {
      const ofKindInstances = ofKind(instances, "rebuffer-ratio");
      let okCount = 0;
      let stallMs = 0;
      let watchMs = 0;
      for (const metric of ofKindInstances) {
        if (metric.value.status !== "ok") continue;
        okCount += 1;
        stallMs += metric.value.payload.stallMs;
        watchMs += metric.value.payload.watchMs;
      }
      if (okCount === 0) {
        return suppressed
          ? { kind: "rebuffer-ratio", status: "suppressed" }
          : { kind: "rebuffer-ratio", status: "no-samples", degradedInstances };
      }
      return {
        kind: "rebuffer-ratio",
        status: "ok",
        degradedInstances,
        sessions: okCount,
        pooledStallMs: stallMs,
        pooledWatchMs: watchMs,
        pooledRatio: stallMs / watchMs,
      };
    }
    case "join-time-ms": {
      const ofKindInstances = ofKind(instances, "join-time-ms");
      let okCount = 0;
      let total = 0;
      for (const metric of ofKindInstances) {
        if (metric.value.status !== "ok") continue;
        okCount += 1;
        total += metric.value.payload.joinTimeMs;
      }
      if (okCount === 0) {
        return suppressed
          ? { kind: "join-time-ms", status: "suppressed" }
          : { kind: "join-time-ms", status: "no-samples", degradedInstances };
      }
      return {
        kind: "join-time-ms",
        status: "ok",
        degradedInstances,
        sessions: okCount,
        meanJoinTimeMs: total / okCount,
      };
    }
    case "seek-latency-ms": {
      const ofKindInstances = ofKind(instances, "seek-latency-ms");
      let okCount = 0;
      let weighted = 0;
      let seeks = 0;
      for (const metric of ofKindInstances) {
        if (metric.value.status !== "ok") continue;
        okCount += 1;
        weighted += metric.value.payload.meanLatencyMs * metric.value.payload.seekCount;
        seeks += metric.value.payload.seekCount;
      }
      if (okCount === 0) {
        return suppressed
          ? { kind: "seek-latency-ms", status: "suppressed" }
          : { kind: "seek-latency-ms", status: "no-samples", degradedInstances };
      }
      return {
        kind: "seek-latency-ms",
        status: "ok",
        degradedInstances,
        sessions: okCount,
        totalSeeks: seeks,
        meanLatencyMs: weighted / seeks,
      };
    }
    case "quality-switch-count": {
      const ofKindInstances = ofKind(instances, "quality-switch-count");
      let okCount = 0;
      let switches = 0;
      let reporting = 0;
      for (const metric of ofKindInstances) {
        if (metric.value.status !== "ok") continue;
        okCount += 1;
        switches += metric.value.payload.switchCount;
        reporting += metric.value.payload.reportingEvents;
      }
      if (okCount === 0) {
        return suppressed
          ? { kind: "quality-switch-count", status: "suppressed" }
          : { kind: "quality-switch-count", status: "no-samples", degradedInstances };
      }
      return {
        kind: "quality-switch-count",
        status: "ok",
        degradedInstances,
        sessions: okCount,
        totalSwitches: switches,
        reportingEvents: reporting,
      };
    }
    case "buffer-health-ms": {
      const ofKindInstances = ofKind(instances, "buffer-health-ms");
      let okCount = 0;
      const samples: number[] = [];
      for (const metric of ofKindInstances) {
        if (metric.value.status !== "ok") continue;
        okCount += 1;
        samples.push(...metric.value.payload.samples);
      }
      if (okCount === 0) {
        return suppressed
          ? { kind: "buffer-health-ms", status: "suppressed" }
          : { kind: "buffer-health-ms", status: "no-samples", degradedInstances };
      }
      // The percentile MERGE: the bounded sketch of the pooled multiset
      // (sorted, capped, deterministic — see aggregate.ts).
      const sketch = boundedSketch(samples);
      return {
        kind: "buffer-health-ms",
        status: "ok",
        degradedInstances,
        sessions: okCount,
        p50: percentile(sketch.samples, 0.5),
        p95: percentile(sketch.samples, 0.95),
        totalSamples: sketch.totalSamples,
        approximate: sketch.approximate,
      };
    }
    case "explanation-coverage": {
      const ofKindInstances = ofKind(instances, "explanation-coverage");
      let okCount = 0;
      let covered = 0;
      let totalCards = 0;
      const explanations: string[] = [];
      for (const metric of ofKindInstances) {
        if (metric.value.status !== "ok") continue;
        okCount += 1;
        covered += metric.value.payload.coveredCards;
        totalCards += metric.value.payload.totalCards;
        for (const explanation of metric.value.payload.sampleExplanations) {
          if (explanations.length < EXPLANATION_SAMPLE_LIMIT) explanations.push(explanation);
        }
      }
      if (okCount === 0) {
        return suppressed
          ? { kind: "explanation-coverage", status: "suppressed" }
          : { kind: "explanation-coverage", status: "no-samples", degradedInstances };
      }
      return {
        kind: "explanation-coverage",
        status: "ok",
        degradedInstances,
        pages: okCount,
        coveredCards: covered,
        totalCards,
        coverage: covered / totalCards,
        sampleExplanations: explanations,
      };
    }
    case "diversity-index": {
      const ofKindInstances = ofKind(instances, "diversity-index");
      let okCount = 0;
      let total = 0;
      for (const metric of ofKindInstances) {
        if (metric.value.status !== "ok") continue;
        okCount += 1;
        total += metric.value.payload.index;
      }
      if (okCount === 0) {
        return suppressed
          ? { kind: "diversity-index", status: "suppressed" }
          : { kind: "diversity-index", status: "no-samples", degradedInstances };
      }
      return {
        kind: "diversity-index",
        status: "ok",
        degradedInstances,
        pages: okCount,
        meanIndex: total / okCount,
      };
    }
    case "attention-mode-compliance": {
      const ofKindInstances = ofKind(instances, "attention-mode-compliance");
      let verified = 0;
      let chainUnverified = 0;
      let gapViolations = 0;
      let chainViolations = 0;
      for (const metric of ofKindInstances) {
        if (metric.value.status !== "ok") continue;
        if (metric.value.payload.chainViolations === null) {
          chainUnverified += 1;
        } else {
          verified += 1;
          chainViolations += metric.value.payload.chainViolations;
        }
        gapViolations += metric.value.payload.objectiveGapViolations;
      }
      if (verified + chainUnverified === 0) {
        return suppressed
          ? { kind: "attention-mode-compliance", status: "suppressed" }
          : { kind: "attention-mode-compliance", status: "no-samples", degradedInstances };
      }
      const totalViolations = gapViolations + chainViolations;
      const compliance: ComplianceVerdict =
        totalViolations > 0
          ? "violations"
          : chainUnverified === 0 && degradedInstances === 0
            ? "compliant"
            : "partially-verified";
      return {
        kind: "attention-mode-compliance",
        status: "ok",
        degradedInstances,
        verifiedSessions: verified,
        chainUnverifiedSessions: chainUnverified,
        objectiveGapViolations: gapViolations,
        chainViolations,
        totalViolations,
        compliance,
      };
    }
    case "candidate-survival": {
      const ofKindInstances = ofKind(instances, "candidate-survival");
      let okCount = 0;
      let retrieved = 0;
      let surviving = 0;
      let narrowed = 0;
      for (const metric of ofKindInstances) {
        if (metric.value.status !== "ok") continue;
        okCount += 1;
        retrieved += metric.value.payload.retrieved;
        surviving += metric.value.payload.surviving;
        if (metric.value.payload.narrowed) narrowed += 1;
      }
      if (okCount === 0) {
        return suppressed
          ? { kind: "candidate-survival", status: "suppressed" }
          : { kind: "candidate-survival", status: "no-samples", degradedInstances };
      }
      return {
        kind: "candidate-survival",
        status: "ok",
        degradedInstances,
        pages: okCount,
        pooledRetrieved: retrieved,
        pooledSurviving: surviving,
        pooledSurvival: surviving / retrieved,
        narrowedPages: narrowed,
      };
    }
    case "rerank-frequency": {
      const ofKindInstances = ofKind(instances, "rerank-frequency");
      let okCount = 0;
      let decisions = 0;
      let cards = 0;
      for (const metric of ofKindInstances) {
        if (metric.value.status !== "ok") continue;
        okCount += 1;
        decisions += metric.value.payload.rerankDecisions;
        cards += metric.value.payload.totalCards;
      }
      if (okCount === 0) {
        return suppressed
          ? { kind: "rerank-frequency", status: "suppressed" }
          : { kind: "rerank-frequency", status: "no-samples", degradedInstances };
      }
      return {
        kind: "rerank-frequency",
        status: "ok",
        degradedInstances,
        pages: okCount,
        rerankDecisions: decisions,
        totalCards: cards,
        pooledFrequency: decisions / cards,
      };
    }
    case "engagement-rates": {
      const surface = bucket.surface!;
      const ofKindInstances = ofKind(instances, "engagement-rates");
      let okCount = 0;
      let skip = 0;
      let complete = 0;
      let like = 0;
      let save = 0;
      let engagement = 0;
      for (const metric of ofKindInstances) {
        if (metric.value.status !== "ok") continue;
        okCount += 1;
        skip += metric.value.payload.skip;
        complete += metric.value.payload.complete;
        like += metric.value.payload.like;
        save += metric.value.payload.save;
        engagement += metric.value.payload.engagementEvents;
      }
      if (okCount === 0) {
        return suppressed
          ? { kind: "engagement-rates", surface, status: "suppressed" }
          : { kind: "engagement-rates", surface, status: "no-samples", degradedInstances };
      }
      return {
        kind: "engagement-rates",
        surface,
        status: "ok",
        degradedInstances,
        sessions: okCount,
        skip,
        complete,
        like,
        save,
        engagementEvents: engagement,
        skipRate: skip / engagement,
        completeRate: complete / engagement,
        likeRate: like / engagement,
        saveRate: save / engagement,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// telemetryReport
// ---------------------------------------------------------------------------

/**
 * Materialize the typed, serializable telemetry report for one window of an
 * aggregation.
 *
 * `windowStart` MUST be bucket-aligned (`windowStart % bucketMs === 0` — a
 * misaligned window is caller misuse, typed error). A window with no
 * instances yields an honest EMPTY report (zero counts, no summary rows).
 * The report is JSON-clean: JSON.parse(JSON.stringify(report)) round-trips
 * exactly (no Dates, no undefined-valued keys, no non-finite numbers).
 */
export function telemetryReport(
  aggregate: Aggregation,
  windowStart: number,
  options: TelemetryReportOptions,
): TelemetryReport {
  if (!isRecord(aggregate) || !Array.isArray(aggregate.windows)) {
    throw new TelemetryError("invalid-input", [
      "aggregate: expected an Aggregation value (build one with aggregateMetrics/createWindowedAggregator)",
    ]);
  }
  if (
    typeof windowStart !== "number" ||
    !Number.isInteger(windowStart) ||
    windowStart % aggregate.bucketMs !== 0
  ) {
    throw new TelemetryError("invalid-input", [
      `windowStart: expected a bucket-aligned epoch-ms integer (multiple of ${aggregate.bucketMs}), got ${String(windowStart)}`,
    ]);
  }
  const generatedAt = options.clock();
  if (!isIso8601(generatedAt)) {
    throw new TelemetryError("invalid-input", [
      `options.clock: expected an ISO 8601 datetime string with an explicit offset, got '${String(generatedAt)}'`,
    ]);
  }

  const window = aggregate.windows.find(
    (candidate) => candidate.windowStart === windowStart,
  );
  const instances: readonly TelemetryMetric[] = window === undefined ? [] : window.instances;

  return {
    schemaVersion: TELEMETRY_REPORT_SCHEMA_VERSION,
    window: {
      startMs: windowStart,
      endExclusiveMs: windowStart + aggregate.bucketMs,
      bucketMs: aggregate.bucketMs,
    },
    generatedAt,
    metrics: bucketInstances(instances).map((bucket) => summarizeBucket(bucket)),
    instanceCount: instances.length,
    degradedCount: instances.filter((metric) => metric.value.status === "degraded").length,
    suppressedPresent: instances.some((metric) => metric.value.status === "suppressed"),
  };
}
