/**
 * Recommendation OS — telemetry privacy redaction (WFX-041, Lane A).
 *
 * `redactMetrics(aggregate, level)` — the privacy boundary of the telemetry
 * layer (product-boundaries.md: "Recommendation telemetry is minimized …
 * aggregate where possible"). Levels are CUMULATIVE:
 *
 * - `full`     — as-is (one "none" report entry — an auditable no-op).
 * - `internal` — drops FREE-TEXT explanations (the verbatim model
 *   explanation evidence carried by explanation-coverage metrics), keeps
 *   every count. One audited entry per affected window.
 * - `shared`   — everything `internal` does, PLUS:
 *     - userIds are bucketed into deterministic hash cohorts
 *       (`cohort:<FNV-1a32(userId) mod 64>` — deterministic, documented,
 *       NOT cryptographic anonymity: it is aggregate statistics bucketing);
 *     - session ids are pseudonymized deterministically (a 64-bit hex
 *       digest of two seeded FNV-1a passes — session ids are linkable
 *       pseudonymous identifiers, so the shared level never carries them
 *       raw; instance ids are rebuilt from the pseudonym so aggregation
 *       idempotency survives). This transformation is deliberate, extra to
 *       the packet's letter, and audited in the RedactionReport;
 *     - SMALL-N SUPPRESSION: per window and metric bucket (per surface for
 *       engagement), when the count of `ok`-valued samples is 1..4 the
 *       bucket's values are replaced with the typed `suppressed` marker —
 *       no misleading rates, and never a fabricated zero (this includes
 *       attention-mode compliance: a withheld violation count is honest, a
 *       fake 0 would violate the no-fake-success law).
 *
 * EVERY transformation is listed in the returned `RedactionReport` —
 * auditable, deterministic (identical input + level ⇒ identical report),
 * and the input aggregate is never mutated (pure).
 */

import { isRecord } from "@wfx/domain";

import type { Aggregation, MetricAggregate } from "./aggregate";
import { assertValidMetric } from "./aggregate";
import { TelemetryError, type TelemetryMetric } from "./metrics";

// ---------------------------------------------------------------------------
// Levels + the auditable report
// ---------------------------------------------------------------------------

/** The cumulative privacy redaction levels. */
export type RedactionLevel = "full" | "internal" | "shared";

/** The closed transformation vocabulary of the redaction report. */
export type RedactionTransformation =
  | "none"
  | "explanations-dropped"
  | "cohort-bucketed"
  | "session-pseudonymized"
  | "small-n-suppressed";

/** One auditable redaction transformation. */
export interface RedactionReportEntry {
  /** The machine-readable transformation kind (closed vocabulary). */
  transformation: RedactionTransformation;
  /** What was done, in deterministic words (never leaks the redacted data). */
  detail: string;
  /** Where it applied (window identity / metric bucket). */
  scope: string;
}

/** The audit trail of one redaction: every transformation, in canonical order. */
export interface RedactionReport {
  /** The level applied. */
  level: RedactionLevel;
  /** Every transformation performed (canonical order; never silent). */
  entries: readonly RedactionReportEntry[];
}

/** The result of {@link redactMetrics}: the transformed aggregate + its audit. */
export interface RedactionResult {
  /** The redacted aggregate (a NEW value — the input is never mutated). */
  aggregate: Aggregation;
  /** The auditable list of every transformation applied. */
  report: RedactionReport;
}

// ---------------------------------------------------------------------------
// Documented constants (deterministic hashing + suppression threshold)
// ---------------------------------------------------------------------------

/** The number of deterministic userId cohorts at the "shared" level. */
export const COHORT_COUNT = 64;

/** Small-n suppression threshold: fewer ok samples than this ⇒ suppressed. */
export const MIN_SAMPLES_FOR_RATE = 5;

/** FNV-1a 32-bit (deterministic, documented — NOT cryptographic). */
function fnv1a32(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The deterministic cohort id of a userId (FNV-1a32 mod 64). */
export function cohortOf(userId: string): string {
  return `cohort:${fnv1a32(userId, 0x811c9dc5) % COHORT_COUNT}`;
}

/**
 * The deterministic session pseudonym: two seeded FNV-1a 32-bit passes
 * concatenated as 16 hex characters (documented as pseudonymization — link
 * resistance, NOT anonymity).
 */
export function pseudonymizeSessionId(sessionId: string): string {
  const high = fnv1a32(sessionId, 0x811c9dc5).toString(16).padStart(8, "0");
  const low = fnv1a32(sessionId, 0x2f3b13d1).toString(16).padStart(8, "0");
  return `wfxred_${high}${low}`;
}

/** Rebuild an instance id from the pseudonymized session id (shape-preserving). */
function rebuildInstanceId(
  instanceId: string,
  sessionId: string,
  pseudonym: string,
): string {
  if (instanceId === sessionId) return pseudonym;
  if (instanceId.endsWith(`|${sessionId}`)) {
    return `${instanceId.slice(0, instanceId.length - sessionId.length)}${pseudonym}`;
  }
  // Defensive: an instance id in an unrecognized shape is kept verbatim
  // (never silently rewritten) — every id this package mints has one of the
  // two shapes above.
  return instanceId;
}

// ---------------------------------------------------------------------------
// The per-instance transformations
// ---------------------------------------------------------------------------

/**
 * Apply the per-instance transformations of a level (explanation drop;
 * cohort bucketing + session pseudonymization). Pure: returns a NEW metric
 * object; the input is never mutated.
 */
function redactInstance(metric: TelemetryMetric, level: RedactionLevel): TelemetryMetric {
  let out: TelemetryMetric = metric;
  if (level !== "full") {
    if (
      out.kind === "explanation-coverage" &&
      out.value.status === "ok" &&
      out.value.payload.sampleExplanations.length > 0
    ) {
      out = {
        ...out,
        value: {
          status: "ok",
          payload: { ...out.value.payload, sampleExplanations: [] },
        },
      };
    }
  }
  if (level === "shared") {
    const pseudonym = pseudonymizeSessionId(out.provenance.sessionId);
    out = {
      ...out,
      provenance: {
        ...out.provenance,
        instanceId: rebuildInstanceId(out.provenance.instanceId, out.provenance.sessionId, pseudonym),
        userId: cohortOf(out.provenance.userId),
        sessionId: pseudonym,
      },
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Small-n suppression (per window, per metric bucket)
// ---------------------------------------------------------------------------

/** The suppression bucket key of an instance: kind, plus surface for engagement. */
function bucketKeyOf(metric: TelemetryMetric): string {
  if (metric.kind !== "engagement-rates") return metric.kind;
  const separator = metric.provenance.instanceId.indexOf("|");
  const surface =
    separator === -1 ? "unattributed" : metric.provenance.instanceId.slice(0, separator);
  return `${metric.kind}:${surface}`;
}

/**
 * Suppress the small-n buckets of one window: every bucket whose ok-sample
 * count is 1..(MIN_SAMPLES_FOR_RATE − 1) has its ok values replaced with the
 * typed `suppressed` marker. Pure and ORDER-PRESERVING; returns the
 * transformed instances plus the sorted list of suppressed bucket keys.
 */
function suppressSmallN(
  instances: readonly TelemetryMetric[],
): { instances: readonly TelemetryMetric[]; suppressedBuckets: string[] } {
  // Read-only pass: ok-sample count per bucket.
  const okCountByKey = new Map<string, number>();
  for (const metric of instances) {
    const key = bucketKeyOf(metric);
    const current = okCountByKey.get(key) ?? 0;
    okCountByKey.set(key, current + (metric.value.status === "ok" ? 1 : 0));
  }
  const suppressedBuckets = [...okCountByKey.entries()]
    .filter(([, count]) => count > 0 && count < MIN_SAMPLES_FOR_RATE)
    .map(([key]) => key)
    .sort();
  const suppressedSet = new Set(suppressedBuckets);

  // Transform pass: order preserved exactly (canonical order survives).
  const out = instances.map((metric) => {
    if (!suppressedSet.has(bucketKeyOf(metric)) || metric.value.status !== "ok") {
      return metric;
    }
    return {
      ...metric,
      value: {
        status: "suppressed" as const,
        reason: `small-n suppression: fewer than ${MIN_SAMPLES_FOR_RATE} samples in this bucket — value withheld (no misleading rates; never a fabricated zero)`,
      },
    };
  });
  return { instances: out, suppressedBuckets };
}

// ---------------------------------------------------------------------------
// redactMetrics
// ---------------------------------------------------------------------------

/**
 * Redact an aggregation to a privacy level (pure — the input is never
 * mutated; the result carries a NEW aggregate plus the auditable report of
 * every transformation performed).
 *
 * Determinism: identical (aggregate, level) inputs yield byte-identical
 * results — the transformed instance order follows the input's canonical
 * order, and the report entries are emitted in canonical window/bucket
 * order with deterministic detail strings.
 */
export function redactMetrics(
  aggregate: Aggregation,
  level: RedactionLevel,
): RedactionResult {
  if (!isRecord(aggregate) || !Array.isArray(aggregate.windows)) {
    throw new TelemetryError("invalid-input", [
      "aggregate: expected an Aggregation value (build one with aggregateMetrics/createWindowedAggregator)",
    ]);
  }
  if (level !== "full" && level !== "internal" && level !== "shared") {
    throw new TelemetryError("invalid-input", [
      `level: expected 'full' | 'internal' | 'shared', got '${String(level)}'`,
    ]);
  }

  // Re-typed after the runtime guards: the Array.isArray check narrows the
  // declared array into an intersection with any[]; the clean local keeps
  // the typed work below honest.
  const windowsIn: readonly MetricAggregate[] = aggregate.windows;

  if (level === "full") {
    // Validate on the way in (no silent garbage passthrough), transform none.
    for (const window of windowsIn) {
      for (const metric of window.instances) assertValidMetric(metric);
    }
    return {
      aggregate,
      report: {
        level,
        entries: [
          {
            transformation: "none",
            detail: "level 'full' — no transformations applied (as-is)",
            scope: "all windows",
          },
        ],
      },
    };
  }

  const entries: RedactionReportEntry[] = [];
  const windows = windowsIn.map((window) => {
    // 1. Validate (typed error on malformed metrics — never a silent skip).
    for (const metric of window.instances) assertValidMetric(metric);

    // 2. Per-instance transformations of the level.
    let instances: readonly TelemetryMetric[] = window.instances.map((metric) =>
      redactInstance(metric, level),
    );

    // 3. Audited entries for what just happened.
    const explanationsDropped = window.instances.filter(
      (metric) =>
        metric.kind === "explanation-coverage" &&
        metric.value.status === "ok" &&
        metric.value.payload.sampleExplanations.length > 0,
    ).length;
    if (explanationsDropped > 0) {
      entries.push({
        transformation: "explanations-dropped",
        detail: `dropped verbatim explanation evidence from ${explanationsDropped} explanation-coverage metric(s) — counts kept (free text never crosses the internal boundary)`,
        scope: `window ${window.windowStart}`,
      });
    }
    if (level === "shared") {
      entries.push({
        transformation: "cohort-bucketed",
        detail: `bucketed ${window.instances.length} userId(s) into ${COHORT_COUNT} deterministic FNV-1a cohorts`,
        scope: `window ${window.windowStart}`,
      });
      entries.push({
        transformation: "session-pseudonymized",
        detail: `pseudonymized ${window.instances.length} sessionId(s) with the deterministic two-pass FNV-1a digest (instance ids rebuilt; aggregation idempotency preserved)`,
        scope: `window ${window.windowStart}`,
      });
    }

    // 4. Small-n suppression (shared only) — per metric bucket.
    if (level === "shared") {
      const suppression = suppressSmallN(instances);
      instances = suppression.instances;
      for (const bucket of suppression.suppressedBuckets) {
        entries.push({
          transformation: "small-n-suppressed",
          detail: `bucket ok-sample count is below ${MIN_SAMPLES_FOR_RATE} — all values in the bucket replaced with the typed suppressed marker (no misleading rates)`,
          scope: `window ${window.windowStart}: ${bucket}`,
        });
      }
    }

    return { ...window, instances };
  });

  return {
    aggregate: { bucketMs: aggregate.bucketMs, windows },
    report: { level, entries },
  };
}
