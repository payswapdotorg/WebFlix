/**
 * WFX-032 — BYOM output validation + policy enforcement (Lane A — intelligence).
 *
 * The BYOM adapter's safety net around an UNTRUSTED external model:
 *
 * - `validateByomOutput(raw)` — strict schema validation of whatever the model
 *   returned against the frozen `RecommendationScore[]` shape: an array of
 *   `{ itemId, score (finite number), explanations (string[]), confidence
 *   (finite in [0, 1]) }`, exactly one score per item. Unknown extra fields
 *   are TOLERATED (structural typing, the domain validators' decision) but
 *   LOGGED in the validation report — never silently ignored. Malformed input
 *   yields typed errors with field paths, aggregated, never thrown here.
 * - `enforcePolicy(scores, policy)` — safety shaping of VALIDATED scores:
 *   clamps scores into a sane range, caps the explanation count, and — for an
 *   EMPTY model response — yields the typed `degraded` verdict marked with
 *   confidence 0. NEVER fabricates scores: an empty response produces
 *   `scores: []` on the degraded branch, not fake zeros for the pool items;
 *   the caller (the OS) sees the verdict and decides fallback.
 * - `checkCostCeiling(byom, estimatedCalls, policy)` — the PRE-INVOCATION cost
 *   gate: `costPerCall × estimatedCalls` vs `policy.maxCostPerOperation`
 *   (the fabric `ModelPolicy` cost field, same abstract units). Over budget ⇒
 *   the record says `allowed: false` and the adapter refuses BEFORE the model
 *   is ever invoked (the typed refusal is `ByomError` kind "cost-refused").
 *
 * Purity: no I/O, no clocks, no randomness. `enforcePolicy` and
 * `checkCostCeiling` validate their policy argument first
 * (`assertValidByomEnforcementPolicy`) — a malformed policy is a typed
 * programmer error, never a silently-ignored knob.
 *
 * Lead-visible decision: the packet's "marks confidence 0 when the model
 * returned none" is realized as the degraded verdict's `confidence: 0` — the
 * verdict-level marking that the model returned NO scores. Per-entry
 * confidence is NEVER defaulted: the strict schema requires it, so an entry
 * without confidence is a typed validation error, not a zero.
 */

import { isRecord, previewValue, type RecommendationScore } from "@wfx/domain";

import type { ByomModel } from "./byom";

// ---------------------------------------------------------------------------
// Enforcement policy + constants
// ---------------------------------------------------------------------------

/**
 * The BYOM enforcement policy: the knobs the adapter enforces around the
 * model. `maxCostPerOperation` mirrors the frozen `ModelPolicy` field of the
 * same name (same abstract cost units) — it is the ceiling
 * `costPerCall × estimatedCalls` is checked against. The remaining knobs are
 * the BYOM safety margins with documented defaults.
 */
export interface ByomEnforcementPolicy {
  /**
   * Cost ceiling in fabric abstract units. `undefined` = no ceiling (the
   * fabric's own semantics for the absent field).
   */
  maxCostPerOperation?: number;
  /**
   * Maximum explanation lines kept per score. Default:
   * {@link BYOM_MAX_EXPLANATIONS}.
   */
  maxExplanations?: number;
  /**
   * Inclusive lower clamp bound for scores. Default: {@link BYOM_SCORE_FLOOR}.
   */
  scoreFloor?: number;
  /**
   * Inclusive upper clamp bound for scores. Default: {@link BYOM_SCORE_CEILING}.
   */
  scoreCeiling?: number;
}

/**
 * The default sane score range, [-1, 1]: it covers every first-party model's
 * output (the WFX-031 formula's terms are all sub-unit) while bounding
 * absurd external magnitudes (1e300, -Infinity clamps, never propagates).
 * Clamping preserves order within the range; extreme values collapse to the
 * bound and every clamp is recorded.
 */
export const BYOM_SCORE_FLOOR = -1;
/** The default inclusive upper clamp bound (see {@link BYOM_SCORE_FLOOR}). */
export const BYOM_SCORE_CEILING = 1;

/**
 * The default explanation cap: at most 5 lines per score reach the OS. Extra
 * lines are a presentation hazard, not a ranking signal; the cap keeps the
 * feed card contract sane and the trace bounded.
 */
export const BYOM_MAX_EXPLANATIONS = 5;

/**
 * Thrown when a `ByomEnforcementPolicy` is malformed (construction-time
 * programmer error — the adapter validates its options once, up front, and
 * the enforcement entry points re-assert for direct callers).
 */
export class InvalidByomPolicyError extends Error {
  /** Field-level problem descriptions (at least one). */
  readonly details: readonly string[];

  constructor(details: string | readonly string[]) {
    const list = typeof details === "string" ? [details] : details;
    super(`InvalidByomPolicyError: ${list.join("; ")}`);
    this.name = "InvalidByomPolicyError";
    this.details = list;
  }
}

/**
 * Assert a `ByomEnforcementPolicy` is well-formed: present knobs are finite
 * numbers; `maxCostPerOperation` non-negative; `maxExplanations` a positive
 * integer; `scoreFloor <= scoreCeiling` when both are present.
 *
 * @throws InvalidByomPolicyError with field-level details.
 */
export function assertValidByomEnforcementPolicy(
  policy: ByomEnforcementPolicy,
): asserts policy is ByomEnforcementPolicy {
  const details: string[] = [];
  const record = isRecord(policy) ? policy : null;
  if (record === null) {
    details.push("expected a ByomEnforcementPolicy object");
    return;
  }
  const { maxCostPerOperation, maxExplanations, scoreFloor, scoreCeiling } =
    record as ByomEnforcementPolicy;

  if (
    maxCostPerOperation !== undefined &&
    (typeof maxCostPerOperation !== "number" ||
      !Number.isFinite(maxCostPerOperation) ||
      maxCostPerOperation < 0)
  ) {
    details.push(
      `maxCostPerOperation: expected a finite non-negative number when present, got ${previewNumber(maxCostPerOperation)}`,
    );
  }
  if (
    maxExplanations !== undefined &&
    (typeof maxExplanations !== "number" ||
      !Number.isInteger(maxExplanations) ||
      maxExplanations < 1)
  ) {
    details.push(
      `maxExplanations: expected a positive integer when present, got ${previewNumber(maxExplanations)}`,
    );
  }
  if (scoreFloor !== undefined && (typeof scoreFloor !== "number" || !Number.isFinite(scoreFloor))) {
    details.push(`scoreFloor: expected a finite number when present, got ${previewNumber(scoreFloor)}`);
  }
  if (
    scoreCeiling !== undefined &&
    (typeof scoreCeiling !== "number" || !Number.isFinite(scoreCeiling))
  ) {
    details.push(
      `scoreCeiling: expected a finite number when present, got ${previewNumber(scoreCeiling)}`,
    );
  }
  if (
    typeof scoreFloor === "number" &&
    Number.isFinite(scoreFloor) &&
    typeof scoreCeiling === "number" &&
    Number.isFinite(scoreCeiling) &&
    scoreFloor > scoreCeiling
  ) {
    details.push(
      `scoreFloor (${scoreFloor}) must not exceed scoreCeiling (${scoreCeiling})`,
    );
  }

  if (details.length > 0) throw new InvalidByomPolicyError(details);
}

// ---------------------------------------------------------------------------
// validateByomOutput — the strict schema gate
// ---------------------------------------------------------------------------

/** The tolerated-unknown-fields log of one validation. */
export interface ByomValidationReport {
  /** Paths of tolerated unknown fields, e.g. `scores[1].rank` (never errors). */
  unknownFields: readonly string[];
}

/**
 * The typed result of `validateByomOutput`: the domain `ValidationResult`
 * shape (ok/value vs errors) PLUS the validation report on BOTH branches —
 * unknown fields are logged even when validation fails.
 */
export type ByomOutputValidation =
  | { ok: true; value: RecommendationScore[]; report: ByomValidationReport }
  | { ok: false; errors: string[]; report: ByomValidationReport };

/** The frozen set of fields a `RecommendationScore` entry declares. */
const SCORE_ENTRY_FIELDS: readonly string[] = ["itemId", "score", "explanations", "confidence"];

/**
 * Number-aware preview: JSON.stringify renders NaN/Infinity as null, which
 * would mislead — render numbers via String() instead.
 */
function previewNumber(value: unknown): string {
  return typeof value === "number" ? String(value) : previewValue(value);
}

/** Field-level validation of one claimed score entry (paths in every error). */
function scoreEntryErrors(entry: unknown, index: number, unknownFields: string[]): string[] {
  if (!isRecord(entry)) {
    return [`scores[${index}]: expected a RecommendationScore object, got ${previewValue(entry)}`];
  }
  const errors: string[] = [];
  if (typeof entry.itemId !== "string" || entry.itemId.trim().length === 0) {
    errors.push(
      `scores[${index}].itemId: expected a non-empty string, got ${previewValue(entry.itemId)}`,
    );
  }
  if (typeof entry.score !== "number" || !Number.isFinite(entry.score)) {
    errors.push(
      `scores[${index}].score: expected a finite number, got ${previewNumber(entry.score)}`,
    );
  }
  if (
    !Array.isArray(entry.explanations) ||
    !entry.explanations.every((explanation) => typeof explanation === "string")
  ) {
    errors.push(
      `scores[${index}].explanations: expected an array of strings, got ${previewValue(entry.explanations)}`,
    );
  }
  if (
    typeof entry.confidence !== "number" ||
    !Number.isFinite(entry.confidence) ||
    entry.confidence < 0 ||
    entry.confidence > 1
  ) {
    errors.push(
      `scores[${index}].confidence: expected a finite number in [0, 1], got ${previewNumber(entry.confidence)}`,
    );
  }
  // Unknown fields: tolerated (structural typing) but logged — never silent.
  for (const key of Object.keys(entry)) {
    if (!SCORE_ENTRY_FIELDS.includes(key)) {
      unknownFields.push(`scores[${index}].${key}`);
    }
  }
  return errors;
}

/**
 * Validate an untrusted BYOM output against the strict
 * `RecommendationScore[]` schema. Total (never throws): failures are
 * aggregated typed errors with field paths; unknown fields are tolerated and
 * logged in the report on both branches. Duplicate itemIds are malformed —
 * the score interface is item-keyed, so an ambiguous output is refused.
 */
export function validateByomOutput(raw: unknown): ByomOutputValidation {
  const unknownFields: string[] = [];

  if (!Array.isArray(raw)) {
    return {
      ok: false,
      errors: [`scores: expected an array of RecommendationScore, got ${previewValue(raw)}`],
      report: { unknownFields: Object.freeze(unknownFields) },
    };
  }

  const errors: string[] = [];
  for (const [index, entry] of raw.entries()) {
    errors.push(...scoreEntryErrors(entry, index, unknownFields));
  }

  // Duplicate itemIds: exactly one score per item (checked only when the
  // entries are well-formed enough to key on).
  const seen = new Map<string, number>();
  for (const [index, entry] of raw.entries()) {
    if (isRecord(entry) && typeof entry.itemId === "string" && entry.itemId.trim().length > 0) {
      const firstIndex = seen.get(entry.itemId);
      if (firstIndex !== undefined) {
        errors.push(
          `scores[${index}].itemId "${entry.itemId}": duplicate score — exactly one score per item (first at scores[${firstIndex}])`,
        );
      } else {
        seen.set(entry.itemId, index);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, report: { unknownFields: Object.freeze(unknownFields) } };
  }
  return {
    ok: true,
    value: raw as RecommendationScore[],
    report: { unknownFields: Object.freeze(unknownFields) },
  };
}

/** The trace summary of one validation (bounded, no raw output echoed). */
export interface ByomValidationSummary {
  /** Whether the output satisfied the strict schema. */
  ok: boolean;
  /** The typed errors (with paths) — empty when ok. */
  errors: readonly string[];
  /** The tolerated unknown-field paths. */
  unknownFields: readonly string[];
}

// ---------------------------------------------------------------------------
// enforcePolicy — safety shaping of validated scores
// ---------------------------------------------------------------------------

/** One applied score clamp. */
export interface ScoreClamp {
  itemId: string;
  from: number;
  to: number;
}

/** One applied explanation cap. */
export interface ExplanationCap {
  itemId: string;
  from: number;
  to: number;
}

/** The auditable record of every enforcement action applied. */
export interface EnforcementReport {
  /** Score clamps applied (one per clamped entry, in input order). */
  clamps: readonly ScoreClamp[];
  /** Explanation caps applied (one per capped entry, in input order). */
  explanationCaps: readonly ExplanationCap[];
}

/**
 * The typed enforcement verdict.
 *
 * - `ok` — the enforced scores (clamped, capped; the model's own values
 *   otherwise, unknown tolerated fields included).
 * - `degraded` — the model returned NO scores. `confidence` is literally 0
 *   (the verdict-level marking), `scores` is literally `[]` (NOT fabricated
 *   zeros for the pool items), and `reason` names the condition. The caller
 *   (the OS) sees this verdict and decides fallback — the adapter never
 *   substitutes.
 */
export type ByomEnforcementResult =
  | { verdict: "ok"; scores: RecommendationScore[]; report: EnforcementReport }
  | {
      verdict: "degraded";
      confidence: 0;
      reason: string;
      scores: [];
      report: EnforcementReport;
    };

/** The machine-readable reason carried by the degraded verdict. */
export const BYOM_DEGRADED_REASON = "empty-model-response";

/**
 * Enforce the BYOM safety policy over VALIDATED scores (the adapter always
 * validates first; this function trusts its typed input's shape and owns only
 * the shaping).
 *
 * - Clamps each score into [scoreFloor ?? BYOM_SCORE_FLOOR,
 *   scoreCeiling ?? BYOM_SCORE_CEILING] (inclusive bounds), recording every
 *   clamp with its exact from/to values.
 * - Caps each entry's explanations at `maxExplanations ??
 *   BYOM_MAX_EXPLANATIONS`, recording every cap.
 * - An EMPTY scores array yields the typed `degraded` verdict (confidence 0,
 *   no fabricated zeros) — never an ok with invented entries.
 *
 * @throws InvalidByomPolicyError when the policy is malformed.
 */
export function enforcePolicy(
  scores: readonly RecommendationScore[],
  policy: ByomEnforcementPolicy = {},
): ByomEnforcementResult {
  assertValidByomEnforcementPolicy(policy);

  if (scores.length === 0) {
    return {
      verdict: "degraded",
      confidence: 0,
      reason: BYOM_DEGRADED_REASON,
      scores: [],
      report: { clamps: [], explanationCaps: [] },
    };
  }

  const floor = policy.scoreFloor ?? BYOM_SCORE_FLOOR;
  const ceiling = policy.scoreCeiling ?? BYOM_SCORE_CEILING;
  const maxExplanations = policy.maxExplanations ?? BYOM_MAX_EXPLANATIONS;

  const clamps: ScoreClamp[] = [];
  const explanationCaps: ExplanationCap[] = [];

  const enforced: RecommendationScore[] = scores.map((entry) => {
    let score = entry.score;
    if (score < floor) {
      clamps.push({ itemId: entry.itemId, from: score, to: floor });
      score = floor;
    } else if (score > ceiling) {
      clamps.push({ itemId: entry.itemId, from: score, to: ceiling });
      score = ceiling;
    }

    let explanations = entry.explanations;
    if (explanations.length > maxExplanations) {
      explanationCaps.push({
        itemId: entry.itemId,
        from: explanations.length,
        to: maxExplanations,
      });
      explanations = [...explanations.slice(0, maxExplanations)];
    }

    return { ...entry, score, explanations };
  });

  return {
    verdict: "ok",
    scores: enforced,
    report: { clamps: Object.freeze(clamps), explanationCaps: Object.freeze(explanationCaps) },
  };
}

// ---------------------------------------------------------------------------
// checkCostCeiling — the pre-invocation cost gate
// ---------------------------------------------------------------------------

/** The auditable record of one pre-invocation cost check. */
export interface CostCheckRecord {
  /** Estimated byom calls per score() invocation (the adapter's own pattern). */
  estimatedCalls: number;
  /** The model's declared cost per call (fabric abstract cost units). */
  costPerCall: number;
  /** `costPerCall × estimatedCalls`. */
  estimatedCost: number;
  /** The policy ceiling; ABSENT when the policy sets none. */
  maxCostPerOperation?: number;
  /** Whether invocation may proceed (true when no ceiling, or within it). */
  allowed: boolean;
}

/**
 * Check the cost ceiling BEFORE invocation:
 * `costPerCall × estimatedCalls` vs `policy.maxCostPerOperation`. No ceiling
 * ⇒ allowed. Exactly-at-ceiling ⇒ allowed (within budget — the same
 * semantics as the merged fabric gateway's skip rule, which refuses only
 * when the sum would EXCEED the budget). Over budget ⇒ `allowed: false` and
 * the adapter refuses before the model is ever invoked.
 *
 * @throws InvalidByomPolicyError when the policy is malformed.
 */
export function checkCostCeiling(
  byom: Pick<ByomModel, "costPerCall">,
  estimatedCalls: number,
  policy: ByomEnforcementPolicy,
): CostCheckRecord {
  assertValidByomEnforcementPolicy(policy);

  const costPerCall = byom.costPerCall;
  const estimatedCost = costPerCall * estimatedCalls;
  const ceiling = policy.maxCostPerOperation;
  const allowed = ceiling === undefined || estimatedCost <= ceiling;
  return allowed
    ? {
        estimatedCalls,
        costPerCall,
        estimatedCost,
        ...(ceiling !== undefined ? { maxCostPerOperation: ceiling } : {}),
        allowed: true,
      }
    : {
        estimatedCalls,
        costPerCall,
        estimatedCost,
        maxCostPerOperation: ceiling,
        allowed: false,
      };
}
