/**
 * Recommendation OS — telemetry windowed aggregation (WFX-041, Lane A).
 *
 * PURE, merge-safe windowed aggregation over derived telemetry metrics:
 *
 * - **Bucketing** — a metric lands in the time bucket containing its
 *   `computedAt` instant: `windowStart = floor(epoch / bucketMs) · bucketMs`
 *   with the bucket size INJECTED per aggregation (exact, deterministic).
 * - **Merge semantics** — within a window, instances are keyed by
 *   `kind + "|" + provenance.instanceId` (one measurement per metric per
 *   subject). Adding or merging keeps, per key, the instance that is MAXIMUM
 *   under the deterministic total order (computedAt epoch, then canonical
 *   serialization) — "the latest measurement for a subject wins". Max under
 *   a total order is associative, commutative, and idempotent, so
 *   `mergeAggregations` is MERGE-SAFE: combining the same aggregation twice
 *   changes nothing, and `(a ⊕ b) ⊕ c` equals `a ⊕ (b ⊕ c)` — byte-identical
 *   reports (the report is a pure function of the window's instance set,
 *   materialized in canonical sorted order).
 * - **Percentile merge (t-digest-free, documented approximation)** —
 *   percentile metrics (BufferHealthMs) carry their exact per-session sample
 *   values; merging collects the sample MULTISET of the surviving instances
 *   and reduces it to a bounded sketch: the sorted sample capped at
 *   `PERCENTILE_SKETCH_CAP` values by deterministic even-stride decimation
 *   (keep index `round(j·(n−1)/(cap−1))`, j = 0..cap−1). Because the sketch
 *   is materialized from the FINAL instance set (never chained through
 *   intermediate merges), merge associativity is EXACT; the documented
 *   approximation is the sketch itself: beyond the cap, percentiles are
 *   computed from the bounded evenly-strided subsample (≤ cap values) of the
 *   true multiset, with the exact count retained and `approximate: true`
 *   surfaced — never silently.
 * - **Deterministic percentile interpolation** — `percentile(sorted, p)`
 *   uses inclusive linear interpolation: `i = p·(n−1)`,
 *   `value = s[⌊i⌋] + (i−⌊i⌋)·(s[⌈i⌉]−s[⌊i⌋])` (numpy's default method).
 *
 * Purity law: no I/O, no timers, no randomness, no hidden state — the
 * `WindowedAggregator` is a deterministic fold (its snapshot is a pure
 * function of the added metrics and their insertion order never changes the
 * canonical output).
 */

import { isIso8601, isRecord } from "@wfx/domain";

import { METRIC_KINDS, TelemetryError, type TelemetryMetric } from "./metrics";

// ---------------------------------------------------------------------------
// The deterministic percentile (the ONE definition — derive.ts reuses it)
// ---------------------------------------------------------------------------

/**
 * The percentile of an ASCENDING sorted sample, inclusive linear
 * interpolation (the documented deterministic method):
 *
 *   position i = p · (n − 1); value = s[⌊i⌋] + (i − ⌊i⌋) · (s[⌈i⌉] − s[⌊i⌋])
 *
 * Identical to numpy's default ("linear"/"inclusive") method: p50 of
 * [1,2,3] is exactly 2; p95 of [1,2,3,4] is 3.85. An empty sample or p
 * outside [0, 1] is caller misuse and throws the typed error.
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    throw new TelemetryError("invalid-input", [
      "percentile: the sample is empty — a percentile needs at least one value",
    ]);
  }
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new TelemetryError("invalid-input", [
      `percentile: expected p in [0, 1], got ${String(p)}`,
    ]);
  }
  const position = p * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower]!;
  if (lower === upper) return low;
  const high = sorted[upper]!;
  return low + (position - lower) * (high - low);
}

// ---------------------------------------------------------------------------
// The bounded percentile sketch (t-digest-free, documented approximation)
// ---------------------------------------------------------------------------

/** The fixed sample cap of the percentile sketch (documented approximation). */
export const PERCENTILE_SKETCH_CAP = 512;

/** A bounded percentile sketch: the merged sample multiset, capped. */
export interface PercentileSketch {
  /** The sketch sample values, ascending, at most PERCENTILE_SKETCH_CAP. */
  samples: readonly number[];
  /** The EXACT size of the underlying multiset (never approximated). */
  totalSamples: number;
  /** True when decimation was applied (the approximation is disclosed). */
  approximate: boolean;
}

/**
 * Materialize the bounded sketch of a sample multiset: sorted ascending,
 * capped at {@link PERCENTILE_SKETCH_CAP} by deterministic even-stride
 * decimation (`round(j·(n−1)/(cap−1))`). The exact count is retained and the
 * decimation is surfaced (`approximate: true`) — the approximation is
 * documented, never silent.
 */
export function boundedSketch(samples: readonly number[]): PercentileSketch {
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted.length <= PERCENTILE_SKETCH_CAP) {
    return { samples: sorted, totalSamples: sorted.length, approximate: false };
  }
  const kept: number[] = [];
  const lastIndex = sorted.length - 1;
  for (let j = 0; j < PERCENTILE_SKETCH_CAP; j += 1) {
    const index = Math.round((j * lastIndex) / (PERCENTILE_SKETCH_CAP - 1));
    kept.push(sorted[index]!);
  }
  return { samples: kept, totalSamples: sorted.length, approximate: true };
}

// ---------------------------------------------------------------------------
// Aggregation data structures (pure, serializable, canonical)
// ---------------------------------------------------------------------------

/** One time window's aggregate: the surviving metric instances, canonically ordered. */
export interface MetricAggregate {
  /** The window start, epoch milliseconds (bucket-aligned). */
  windowStart: number;
  /** The window end (exclusive), epoch milliseconds = windowStart + bucketMs. */
  windowEndExclusive: number;
  /**
   * The surviving instances sorted by instance key
   * (`kind + "|" + provenance.instanceId`) — the canonical order that makes
   * reports byte-identical for equal instance sets.
   */
  instances: readonly TelemetryMetric[];
}

/** A whole aggregation: bucket size + windows, canonically ordered. */
export interface Aggregation {
  /** The injected bucket size (milliseconds) — identical across merges. */
  bucketMs: number;
  /** The windows sorted by windowStart. */
  windows: readonly MetricAggregate[];
}

// ---------------------------------------------------------------------------
// Metric validation (the envelope + every payload field the report reads)
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function problem(label: string, expected: string, got: unknown): string {
  return `${label}: expected ${expected}, got '${String(got)}'`;
}

function numberArrayProblems(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every(isFiniteNumber)) {
    return [problem(label, "an array of finite numbers", value)];
  }
  return [];
}

function stringArrayProblems(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    return [problem(label, "an array of non-empty strings", value)];
  }
  return [];
}

/** Per-kind ok-payload validation: the fields the report reads, plus the
 *  ok-invariants that keep report pooling total (non-zero denominators —
 *  matching exactly the preconditions under which derive.ts mints `ok`). */
function payloadProblems(metric: TelemetryMetric): string[] {
  if (metric.value.status !== "ok") return [];
  const payload = metric.value.payload as unknown as Record<string, unknown>;
  if (!isRecord(payload)) {
    return [`value.payload: expected an object for an 'ok' measurement`];
  }
  const p = (field: string): unknown => payload[field];
  switch (metric.kind) {
    case "rebuffer-ratio":
      return [
        ...(!isFiniteNumber(p("stallMs")) || (p("stallMs") as number) < 0 ? [problem("value.payload.stallMs", "a finite number >= 0", p("stallMs"))] : []),
        ...(!isFiniteNumber(p("watchMs")) || (p("watchMs") as number) <= 0 ? [problem("value.payload.watchMs", "a finite number > 0 (an ok ratio needs a denominator)", p("watchMs"))] : []),
        ...(!isFiniteNumber(p("ratio")) ? [problem("value.payload.ratio", "a finite number", p("ratio"))] : []),
      ];
    case "join-time-ms":
      return !isFiniteNumber(p("joinTimeMs"))
        ? [problem("value.payload.joinTimeMs", "a finite number", p("joinTimeMs"))]
        : [];
    case "seek-latency-ms":
      return [
        ...(!isFiniteNumber(p("meanLatencyMs")) || (p("meanLatencyMs") as number) < 0 ? [problem("value.payload.meanLatencyMs", "a finite number >= 0", p("meanLatencyMs"))] : []),
        ...(!isNonNegativeInteger(p("seekCount")) || (p("seekCount") as number) < 1 ? [problem("value.payload.seekCount", "an integer >= 1 (an ok seek-latency needs at least one observation)", p("seekCount"))] : []),
      ];
    case "quality-switch-count":
      return [
        ...(!isNonNegativeInteger(p("switchCount")) ? [problem("value.payload.switchCount", "a non-negative integer", p("switchCount"))] : []),
        ...(!isNonNegativeInteger(p("reportingEvents")) ? [problem("value.payload.reportingEvents", "a non-negative integer", p("reportingEvents"))] : []),
      ];
    case "buffer-health-ms": {
      const samples = p("samples");
      const problems = numberArrayProblems(samples, "value.payload.samples");
      if (Array.isArray(samples) && samples.length === 0) {
        problems.push(
          problem("value.payload.samples", "a non-empty array (an ok buffer-health needs at least one sample)", samples),
        );
      }
      return [
        ...problems,
        ...(!isFiniteNumber(p("p50")) ? [problem("value.payload.p50", "a finite number", p("p50"))] : []),
        ...(!isFiniteNumber(p("p95")) ? [problem("value.payload.p95", "a finite number", p("p95"))] : []),
      ];
    }
    case "explanation-coverage":
      return [
        ...(!isNonNegativeInteger(p("coveredCards")) ? [problem("value.payload.coveredCards", "a non-negative integer", p("coveredCards"))] : []),
        ...(!isNonNegativeInteger(p("totalCards")) || (p("totalCards") as number) < 1 ? [problem("value.payload.totalCards", "an integer >= 1 (an ok coverage needs a non-empty feed)", p("totalCards"))] : []),
        ...(!isFiniteNumber(p("coverage")) ? [problem("value.payload.coverage", "a finite number", p("coverage"))] : []),
        ...stringArrayProblems(p("sampleExplanations"), "value.payload.sampleExplanations"),
      ];
    case "diversity-index":
      return [
        ...(!isNonNegativeInteger(p("distinctObjectives")) ? [problem("value.payload.distinctObjectives", "a non-negative integer", p("distinctObjectives"))] : []),
        ...(!isNonNegativeInteger(p("totalCards")) || (p("totalCards") as number) < 1 ? [problem("value.payload.totalCards", "an integer >= 1 (an ok diversity index needs a non-empty feed)", p("totalCards"))] : []),
        ...(!isFiniteNumber(p("index")) ? [problem("value.payload.index", "a finite number", p("index"))] : []),
      ];
    case "attention-mode-compliance": {
      const problems: string[] = [];
      if (
        typeof p("attentionMode") !== "string" ||
        !["mindful", "balanced", "immersive", "custom"].includes(p("attentionMode") as string)
      ) {
        problems.push(problem("value.payload.attentionMode", "'mindful' | 'balanced' | 'immersive' | 'custom'", p("attentionMode")));
      }
      if (!isNonNegativeInteger(p("objectiveGapViolations"))) {
        problems.push(problem("value.payload.objectiveGapViolations", "a non-negative integer", p("objectiveGapViolations")));
      }
      const chain = p("chainViolations");
      if (chain !== null && !isNonNegativeInteger(chain)) {
        problems.push(problem("value.payload.chainViolations", "a non-negative integer or null", chain));
      }
      if (!isNonNegativeInteger(p("totalViolations"))) {
        problems.push(problem("value.payload.totalViolations", "a non-negative integer", p("totalViolations")));
      }
      if (!isNonNegativeInteger(p("checkedCards"))) {
        problems.push(problem("value.payload.checkedCards", "a non-negative integer", p("checkedCards")));
      }
      return problems;
    }
    case "candidate-survival":
      return [
        ...(!isNonNegativeInteger(p("retrieved")) || (p("retrieved") as number) < 1 ? [problem("value.payload.retrieved", "an integer >= 1 (an ok survival needs a non-empty pool)", p("retrieved"))] : []),
        ...(!isNonNegativeInteger(p("surviving")) ? [problem("value.payload.surviving", "a non-negative integer", p("surviving"))] : []),
        ...(!isFiniteNumber(p("survival")) ? [problem("value.payload.survival", "a finite number", p("survival"))] : []),
        ...(typeof p("narrowed") !== "boolean" ? [problem("value.payload.narrowed", "a boolean", p("narrowed"))] : []),
      ];
    case "rerank-frequency":
      return [
        ...(!isNonNegativeInteger(p("rerankDecisions")) ? [problem("value.payload.rerankDecisions", "a non-negative integer", p("rerankDecisions"))] : []),
        ...(!isNonNegativeInteger(p("totalCards")) || (p("totalCards") as number) < 1 ? [problem("value.payload.totalCards", "an integer >= 1 (an ok rerank frequency needs a non-empty feed)", p("totalCards"))] : []),
        ...(!isFiniteNumber(p("frequency")) ? [problem("value.payload.frequency", "a finite number", p("frequency"))] : []),
      ];
    case "engagement-rates": {
      const problems: string[] = [];
      if (typeof p("surface") !== "string" || !["watch", "short"].includes(p("surface") as string)) {
        problems.push(problem("value.payload.surface", "'watch' | 'short'", p("surface")));
      }
      for (const field of ["skip", "complete", "like", "save"]) {
        if (!isNonNegativeInteger(p(field))) {
          problems.push(problem(`value.payload.${field}`, "a non-negative integer", p(field)));
        }
      }
      if (!isNonNegativeInteger(p("engagementEvents")) || (p("engagementEvents") as number) < 1) {
        problems.push(
          problem("value.payload.engagementEvents", "an integer >= 1 (an ok rate needs a denominator)", p("engagementEvents")),
        );
      }
      for (const field of ["skipRate", "completeRate", "likeRate", "saveRate"]) {
        if (!isFiniteNumber(p(field))) {
          problems.push(problem(`value.payload.${field}`, "a finite number", p(field)));
        }
      }
      return problems;
    }
  }
}

/**
 * Validate one telemetry metric (envelope + the payload fields the report
 * reads). Malformed metrics are caller misuse — typed error, never silently
 * dropped and never "repaired".
 */
export function assertValidMetric(metric: unknown): asserts metric is TelemetryMetric {
  const problems: string[] = [];
  if (!isRecord(metric)) {
    throw new TelemetryError("invalid-input", ["metric: expected a TelemetryMetric object"]);
  }
  if (typeof metric.kind !== "string" || !(METRIC_KINDS as readonly string[]).includes(metric.kind)) {
    problems.push(problem("kind", `one of ${METRIC_KINDS.join(" | ")}`, metric.kind));
    throw new TelemetryError("invalid-input", problems);
  }
  if (!isIso8601(metric.computedAt)) {
    problems.push(problem("computedAt", "an ISO 8601 datetime string with an explicit offset", metric.computedAt));
  }
  const provenance: unknown = metric.provenance;
  if (!isRecord(provenance)) {
    problems.push("provenance: expected a MetricProvenance object");
  } else {
    if (!isNonEmptyString(provenance.instanceId)) {
      problems.push(problem("provenance.instanceId", "a non-empty string", provenance.instanceId));
    }
    if (!isNonEmptyString(provenance.userId)) {
      problems.push(problem("provenance.userId", "a non-empty string", provenance.userId));
    }
    if (!isNonEmptyString(provenance.sessionId)) {
      problems.push(problem("provenance.sessionId", "a non-empty string", provenance.sessionId));
    }
    for (const field of ["rangeStart", "rangeEnd"]) {
      const value: unknown = provenance[field];
      if (value !== null && !isIso8601(value)) {
        problems.push(problem(`provenance.${field}`, "an ISO 8601 string or null", value));
      }
    }
    if (!isNonNegativeInteger(provenance.observationCount)) {
      problems.push(problem("provenance.observationCount", "a non-negative integer", provenance.observationCount));
    }
    if (!Array.isArray(provenance.missingFields) || !provenance.missingFields.every(isNonEmptyString)) {
      problems.push(problem("provenance.missingFields", "an array of strings", provenance.missingFields));
    }
  }
  const value: unknown = metric.value;
  if (!isRecord(value) || typeof value.status !== "string") {
    problems.push("value: expected a Measurement object");
  } else if (value.status === "ok") {
    if (!isRecord(value.payload)) {
      problems.push("value.payload: expected an object for an 'ok' measurement");
    }
  } else if (value.status === "degraded" || value.status === "suppressed") {
    if (!isNonEmptyString(value.reason)) {
      problems.push(problem("value.reason", "a non-empty string", value.reason));
    }
  } else {
    problems.push(problem("value.status", "'ok' | 'degraded' | 'suppressed'", value.status));
  }
  if (problems.length === 0) {
    problems.push(...payloadProblems(metric as unknown as TelemetryMetric));
  }
  if (problems.length > 0) {
    throw new TelemetryError("invalid-input", problems);
  }
}

// ---------------------------------------------------------------------------
// Canonical ordering (merge-safety machinery)
// ---------------------------------------------------------------------------

/** The instance key: one measurement per metric kind per subject. */
export function instanceKey(metric: TelemetryMetric): string {
  return `${metric.kind}|${metric.provenance.instanceId}`;
}

/** Deterministic JSON with recursively sorted object keys. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The deterministic total order on same-key instances: computedAt epoch
 * descending (the LATEST measurement wins), then canonical serialization
 * descending as the tiebreak (byte-stable regardless of merge order).
 */
function preferNewer(a: TelemetryMetric, b: TelemetryMetric): TelemetryMetric {
  const epochA = Date.parse(a.computedAt);
  const epochB = Date.parse(b.computedAt);
  if (epochA !== epochB) return epochA > epochB ? a : b;
  const canonicalA = canonicalJson(a);
  const canonicalB = canonicalJson(b);
  return canonicalA >= canonicalB ? a : b;
}

// ---------------------------------------------------------------------------
// Pure aggregation functions
// ---------------------------------------------------------------------------

/** Validate a bucket size: a positive safe integer of milliseconds. */
function assertValidBucketMs(bucketMs: number): void {
  if (
    typeof bucketMs !== "number" ||
    !Number.isInteger(bucketMs) ||
    bucketMs <= 0 ||
    !Number.isSafeInteger(bucketMs)
  ) {
    throw new TelemetryError("invalid-input", [
      `bucketMs: expected a positive safe integer of milliseconds, got ${String(bucketMs)}`,
    ]);
  }
}

/** The bucket-aligned window start of a computedAt instant. */
export function windowStartOf(computedAt: string, bucketMs: number): number {
  return Math.floor(Date.parse(computedAt) / bucketMs) * bucketMs;
}

/** The canonical instance-array of a window's instance map (sorted by key). */
function canonicalInstances(
  byKey: ReadonlyMap<string, TelemetryMetric>,
): readonly TelemetryMetric[] {
  return [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, metric]) => metric);
}

/** Build the canonical Aggregation value from windows of instance maps. */
function buildAggregation(
  bucketMs: number,
  windows: ReadonlyMap<number, ReadonlyMap<string, TelemetryMetric>>,
): Aggregation {
  const sortedStarts = [...windows.keys()].sort((a, b) => a - b);
  return {
    bucketMs,
    windows: sortedStarts.map((windowStart) => {
      const byKey = windows.get(windowStart)!;
      return {
        windowStart,
        windowEndExclusive: windowStart + bucketMs,
        instances: canonicalInstances(byKey),
      };
    }),
  };
}

/** Fold one metric into the window maps (the max-merge with a single instance). */
function foldMetric(
  bucketMs: number,
  windows: Map<number, Map<string, TelemetryMetric>>,
  metric: TelemetryMetric,
): void {
  assertValidMetric(metric);
  const windowStart = windowStartOf(metric.computedAt, bucketMs);
  let byKey = windows.get(windowStart);
  if (byKey === undefined) {
    byKey = new Map<string, TelemetryMetric>();
    windows.set(windowStart, byKey);
  }
  const key = instanceKey(metric);
  const existing = byKey.get(key);
  byKey.set(key, existing === undefined ? metric : preferNewer(existing, metric));
}

/** Fold a whole aggregation's windows into the target maps (max-merge). */
function foldAggregation(
  windows: Map<number, Map<string, TelemetryMetric>>,
  source: Aggregation,
): void {
  for (const window of source.windows) {
    let byKey = windows.get(window.windowStart);
    if (byKey === undefined) {
      byKey = new Map<string, TelemetryMetric>();
      windows.set(window.windowStart, byKey);
    }
    for (const metric of window.instances) {
      assertValidMetric(metric);
      const key = instanceKey(metric);
      const existing = byKey.get(key);
      byKey.set(key, existing === undefined ? metric : preferNewer(existing, metric));
    }
  }
}

/**
 * Purely aggregate a batch of derived metrics into windows (bucket size
 * injected). Identical batches — in ANY order — yield identical aggregations
 * (the canonical instance order depends only on the surviving instance SET).
 */
export function aggregateMetrics(
  metrics: readonly TelemetryMetric[],
  bucketMs: number,
): Aggregation {
  if (!Array.isArray(metrics)) {
    throw new TelemetryError("invalid-input", [
      "metrics: expected an array of TelemetryMetric",
    ]);
  }
  assertValidBucketMs(bucketMs);
  const windows = new Map<number, Map<string, TelemetryMetric>>();
  for (const metric of metrics) {
    foldMetric(bucketMs, windows, metric);
  }
  return buildAggregation(bucketMs, windows);
}

/**
 * Merge two aggregations (pure). The bucket sizes MUST match — merging
 * different bucket geometries is caller misuse. The merge is the max-merge
 * per window per instance key: associative, commutative, idempotent.
 */
export function mergeAggregations(a: Aggregation, b: Aggregation): Aggregation {
  assertValidBucketMs(a.bucketMs);
  if (a.bucketMs !== b.bucketMs) {
    throw new TelemetryError("invalid-input", [
      `bucketMs: cannot merge aggregations of different bucket sizes (${a.bucketMs} vs ${b.bucketMs})`,
    ]);
  }
  const windows = new Map<number, Map<string, TelemetryMetric>>();
  foldAggregation(windows, a);
  foldAggregation(windows, b);
  return buildAggregation(a.bucketMs, windows);
}

/** The instances of one window of an aggregation (empty when absent). */
export function windowInstances(
  aggregation: Aggregation,
  windowStart: number,
): readonly TelemetryMetric[] {
  const window = aggregation.windows.find(
    (candidate) => candidate.windowStart === windowStart,
  );
  return window === undefined ? [] : window.instances;
}

// ---------------------------------------------------------------------------
// The stateful recorder (a deterministic fold over add() calls)
// ---------------------------------------------------------------------------

/** Options for {@link createWindowedAggregator}. */
export interface WindowedAggregatorOptions {
  /** The injected bucket size (milliseconds) — positive safe integer. */
  bucketMs: number;
}

/** The windowed aggregator: a deterministic, pure-fold recorder. */
export interface WindowedAggregator {
  /** The injected bucket size (milliseconds). */
  readonly bucketMs: number;
  /** Add one derived metric (typed error on a malformed metric). */
  add(metric: TelemetryMetric): void;
  /** Add many derived metrics, in order. */
  addAll(metrics: readonly TelemetryMetric[]): void;
  /** Merge another aggregation into this aggregator (same bucket size only). */
  merge(other: Aggregation): void;
  /** The window starts present, ascending. */
  windowStarts(): readonly number[];
  /** The aggregate of one window, or undefined when the window is empty. */
  window(windowStart: number): MetricAggregate | undefined;
  /** The canonical snapshot (a pure value — a function of the added metrics). */
  snapshot(): Aggregation;
}

/**
 * Create a windowed aggregator (the bucket size is INJECTED). The recorder is
 * a deterministic fold: its snapshot depends only on the SET of surviving
 * instances, never on the insertion order of the adds.
 */
export function createWindowedAggregator(
  options: WindowedAggregatorOptions,
): WindowedAggregator {
  if (!isRecord(options)) {
    throw new TelemetryError("invalid-input", [
      "options: expected a WindowedAggregatorOptions object",
    ]);
  }
  assertValidBucketMs(options.bucketMs);
  const bucketMs = options.bucketMs;
  const windows = new Map<number, Map<string, TelemetryMetric>>();

  return {
    bucketMs,
    add(metric: TelemetryMetric): void {
      foldMetric(bucketMs, windows, metric);
    },
    addAll(metrics: readonly TelemetryMetric[]): void {
      if (!Array.isArray(metrics)) {
        throw new TelemetryError("invalid-input", [
          "metrics: expected an array of TelemetryMetric",
        ]);
      }
      for (const metric of metrics) foldMetric(bucketMs, windows, metric);
    },
    merge(other: Aggregation): void {
      if (other.bucketMs !== bucketMs) {
        throw new TelemetryError("invalid-input", [
          `bucketMs: cannot merge an aggregation of bucket size ${other.bucketMs} into an aggregator of bucket size ${bucketMs}`,
        ]);
      }
      foldAggregation(windows, other);
    },
    windowStarts(): readonly number[] {
      return [...windows.keys()].sort((a, b) => a - b);
    },
    window(windowStart: number): MetricAggregate | undefined {
      const byKey = windows.get(windowStart);
      if (byKey === undefined) return undefined;
      return {
        windowStart,
        windowEndExclusive: windowStart + bucketMs,
        instances: canonicalInstances(byKey),
      };
    },
    snapshot(): Aggregation {
      return buildAggregation(bucketMs, windows);
    },
  };
}
