/**
 * Recommendation OS — the feedback controls (R05, the J15 control set).
 *
 * `applyFeedback(scored, feedback)` — the pipeline stage between model
 * scoring and policy constraints that consumes the profile's FEEDBACK SET
 * (the reversible controls the user recorded through
 * `POST /experience/feedback`, persisted per profile, deleted = gone).
 *
 * THE CONTROL VOCABULARY (frozen by the R05 spec — the J15 set):
 *
 * - `not-interested` (target item) — DEMOTE the item to the feed tail
 *   (below the availability floor, below `already-watched`). Demotion is
 *   REORDERING: the item is never removed and the recorded viewing events
 *   are never touched — the control is reversible by deleting the record,
 *   and the composition restores.
 * - `dont-recommend-source` (target connector id) — EXCLUDE the source's
 *   realizations from composition, WITH AN HONEST NOTE in the trace (never
 *   a silent gap, never an error). Exclusion is REALIZATION-level: an item
 *   that also realizes through a non-suppressed source still surfaces via
 *   that realization (the dedupe stage then picks among survivors only).
 * - `dont-recommend-creator` (target creator id) — same law, keyed on the
 *   documented `creatorId` candidate feature (the feature callers populate
 *   from source metadata; the OS never guesses creators from titles).
 * - `already-watched` (target item) — DEPRIORITIZE repeats: the item is
 *   demoted below every non-demoted candidate (above `not-interested`).
 *   This is a recommendation control ONLY — recorded history is immutable
 *   (the R04 event-sink law) and the item stays reachable at the tail.
 * - `more-like-this` (target item) — BOOST the anchor's SIMILARITY
 *   NEIGHBORHOOD: every candidate whose documented text surface shares a
 *   token with the anchor's surface (the same tokenizer the intent matcher
 *   uses — features.ts `objectiveTokens`) gains the documented rank boost.
 *   The model score itself is NEVER edited — the boost is carried in
 *   `feedbackAdjustment` and recorded in the trace.
 *
 * THE REVERSIBILITY LAW (J15): every control here is a pure function of
 * the feedback SET — apply a control, the composition changes; delete the
 * record, the composition restores byte-for-byte. The stage is deterministic
 * and total: identical (scored, feedback) yields identical output, trace
 * included. Structural garbage in the feedback set throws the typed
 * `RecommendationOSError` (kind "invalid-input") naming every problem —
 * the same field-level law the rest of the OS follows.
 *
 * PURITY LAW: no I/O, no persistence reads here — the CALLER (the service
 * that runs the pipeline) reads the profile's feedback records and passes
 * them in. The OS never fetches.
 */

import { isIso8601, isRecord, previewValue } from "@wfx/domain";

import { objectiveTokens } from "./features";
import { RecommendationOSError } from "./types";
import type { FeedbackDemotionKind, ScoredCandidate, TraceDecision } from "./types";

// ---------------------------------------------------------------------------
// The control vocabulary (mirrors the persistence store's migration 0010)
// ---------------------------------------------------------------------------

/** The J15 feedback-control kinds (frozen by the R05 spec). */
export const FEEDBACK_KINDS = [
  "more-like-this",
  "not-interested",
  "dont-recommend-source",
  "dont-recommend-creator",
  "already-watched",
] as const;

/** One feedback-control kind. */
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** What a control targets. */
export const FEEDBACK_TARGET_TYPES = ["item", "source", "creator"] as const;

/** One control's target type. */
export type FeedbackTargetType = (typeof FEEDBACK_TARGET_TYPES)[number];

/** The kind -> target-type law (structural, mirrors migration 0010). */
export const FEEDBACK_KIND_TARGETS: Readonly<Record<FeedbackKind, FeedbackTargetType>> =
  Object.freeze({
    "more-like-this": "item",
    "not-interested": "item",
    "dont-recommend-source": "source",
    "dont-recommend-creator": "creator",
    "already-watched": "item",
  });

/**
 * One feedback record the OS consumes. The WIRE SHAPE of the persistence
 * store's `FeedbackRecord` (id/kind/targetType/targetId/createdAt/note) —
 * the service maps rows onto this verbatim.
 */
export interface RecommendationFeedback {
  /** Canonical record id (`wfxfeed_…`). */
  readonly id: string;
  /** The control kind. */
  readonly kind: FeedbackKind;
  /** The target type. */
  readonly targetType: FeedbackTargetType;
  /** The target id: canonical item id, connector id, or creator id. */
  readonly targetId: string;
  /** ISO 8601 instant of the submission. */
  readonly createdAt: string;
  /** Optional user note (a memo — never consumed as control truth). */
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Documented constants
// ---------------------------------------------------------------------------

/**
 * The `more-like-this` rank boost applied to the anchor's neighborhood.
 * Comparable to one strong matched intent (the heuristic's
 * `HEURISTIC_INTENT_WEIGHT * strength` term) — a visible, bounded lift that
 * custom-mode objective adjustments and model scores still outrank when
 * they are larger. Deterministic, documented, tested.
 */
export const FEEDBACK_MORE_LIKE_THIS_BOOST = 0.3;

// ---------------------------------------------------------------------------
// Structural validation (the field-level law)
// ---------------------------------------------------------------------------

/** Field-level validation of one claimed feedback record. */
export function feedbackRecordErrors(feedback: unknown, index: number): string[] {
  if (!isRecord(feedback)) {
    return [`feedback[${index}]: expected a RecommendationFeedback object, got ${previewValue(feedback)}`];
  }
  const kind = feedback.kind;
  const errors: string[] = [];
  if (typeof feedback.id !== "string" || feedback.id.trim().length === 0) {
    errors.push(`feedback[${index}].id: expected a non-empty string, got ${previewValue(feedback.id)}`);
  }
  if (typeof kind !== "string" || !(FEEDBACK_KINDS as readonly string[]).includes(kind)) {
    errors.push(
      `feedback[${index}].kind: expected one of ${FEEDBACK_KINDS.join(" | ")}, got ${previewValue(kind)}`,
    );
  }
  if (typeof feedback.targetId !== "string" || feedback.targetId.trim().length === 0) {
    errors.push(
      `feedback[${index}].targetId: expected a non-empty string (after trim), got ${previewValue(feedback.targetId)}`,
    );
  }
  if (
    typeof kind === "string" &&
    (FEEDBACK_KINDS as readonly string[]).includes(kind) &&
    feedback.targetType !== FEEDBACK_KIND_TARGETS[kind as FeedbackKind]
  ) {
    errors.push(
      `feedback[${index}].targetType: expected "${FEEDBACK_KIND_TARGETS[kind as FeedbackKind]}" for kind "${kind}", got ${previewValue(feedback.targetType)}`,
    );
  }
  if (typeof feedback.createdAt !== "string" || !isIso8601(feedback.createdAt)) {
    errors.push(
      `feedback[${index}].createdAt: expected an ISO 8601 instant, got ${previewValue(feedback.createdAt)}`,
    );
  }
  if (feedback.note !== undefined && typeof feedback.note !== "string") {
    errors.push(
      `feedback[${index}].note: expected a string when present, got ${previewValue(feedback.note)}`,
    );
  }
  return errors;
}

/**
 * Validate a whole feedback set (aggregated — every problem is named in one
 * typed throw).
 */
export function assertValidFeedbackSet(
  feedback: readonly RecommendationFeedback[],
): void {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const [index, record] of feedback.entries()) {
    errors.push(...feedbackRecordErrors(record, index));
    if (
      typeof record?.id === "string" &&
      seen.has(record.id)
    ) {
      errors.push(`feedback[${index}].id: duplicate record id "${record.id}"`);
    }
    if (typeof record?.id === "string") seen.add(record.id);
  }
  if (errors.length > 0) {
    throw new RecommendationOSError("invalid-input", errors);
  }
}

// ---------------------------------------------------------------------------
// Similarity neighborhoods (the `more-like-this` semantics)
// ---------------------------------------------------------------------------

/** The candidate's text surface for neighborhood matching. */
function surfaceText(item: ScoredCandidate): string {
  const features = item.candidate.features;
  const matchText = features["matchText"];
  if (typeof matchText === "string") return matchText.toLowerCase();
  const title = features["canonicalTitle"];
  if (typeof title === "string") return title.toLowerCase();
  return "";
}

/**
 * Does `candidate` share at least one objective token with the anchor's
 * text surface? (The same tokenizer the intent matcher uses — documented,
 * deterministic, never a guess from titles alone: no shared token, no
 * boost.) The anchor itself is never its own neighborhood.
 */
export function sharesNeighborhood(anchor: ScoredCandidate, candidate: ScoredCandidate): boolean {
  if (anchor.candidate.itemId === candidate.candidate.itemId) return false;
  const anchorTokens = new Set(objectiveTokens(surfaceText(anchor)));
  if (anchorTokens.size === 0) return false;
  const candidateTokens = objectiveTokens(surfaceText(candidate));
  return candidateTokens.some((token) => anchorTokens.has(token));
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

/** Output of the feedback stage. */
export interface FeedbackResult {
  /**
   * The survivors: suppression targets excluded (with honest notes), item
   * demotions marked, boosts carried. Ordered by modelScore + boost desc
   * (unscored last, pool index tiebreak) — the stable re-sort mirrors the
   * custom-objective re-sort so both adjustments compose.
   */
  readonly ranked: readonly ScoredCandidate[];
  /** Auditable decisions (suppressions, demotions, boosts). */
  readonly decisions: readonly TraceDecision[];
}

/** The documented `creatorId` feature key (callers populate it; the OS reads it). */
export const CREATOR_FEATURE_KEY = "creatorId";

/** Read a candidate's creator id feature (null when absent/not a string). */
function creatorIdOf(item: ScoredCandidate): string | null {
  const value = item.candidate.features[CREATOR_FEATURE_KEY];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Apply the feedback set to the scored candidates. Pure and deterministic;
 * the input array and its objects are never mutated; every exclusion,
 * demotion, and boost is recorded in the trace.
 */
export function applyFeedback(
  scored: readonly ScoredCandidate[],
  feedback: readonly RecommendationFeedback[],
): FeedbackResult {
  assertValidFeedbackSet(feedback);

  // Index the control set once (deterministic lookups).
  const notInterested = new Set<string>();
  const alreadyWatched = new Set<string>();
  const suppressedSources = new Set<string>();
  const suppressedCreators = new Set<string>();
  const anchors: RecommendationFeedback[] = [];
  for (const record of feedback) {
    switch (record.kind) {
      case "not-interested":
        notInterested.add(record.targetId);
        break;
      case "already-watched":
        alreadyWatched.add(record.targetId);
        break;
      case "dont-recommend-source":
        suppressedSources.add(record.targetId);
        break;
      case "dont-recommend-creator":
        suppressedCreators.add(record.targetId);
        break;
      case "more-like-this":
        anchors.push(record);
        break;
    }
  }

  const decisions: TraceDecision[] = [];

  // --- 1. Suppressions: EXCLUDE the matching realizations, with the
  //        honest note naming the control and every skipped candidate. ---
  const survivors: ScoredCandidate[] = [];
  const suppressed: { item: ScoredCandidate; source: string }[] = [];
  const suppressedByCreator: ScoredCandidate[] = [];
  for (const item of scored) {
    if (suppressedSources.has(item.candidate.realization.connectorId)) {
      suppressed.push({ item, source: item.candidate.realization.connectorId });
      continue;
    }
    const creator = creatorIdOf(item);
    if (creator !== null && suppressedCreators.has(creator)) {
      suppressedByCreator.push(item);
      continue;
    }
    survivors.push(item);
  }

  if (suppressed.length > 0) {
    const bySource = new Map<string, ScoredCandidate[]>();
    for (const { item, source } of suppressed) {
      const group = bySource.get(source);
      if (group === undefined) bySource.set(source, [item]);
      else group.push(item);
    }
    for (const [source, items] of bySource) {
      decisions.push({
        kind: "feedback-suppression",
        detail: `source "${source}" is suppressed (dont-recommend-source) — ${items.length} realization(s) skipped: the item is gone from this feed unless another non-suppressed source realizes it; delete the control to restore`,
        itemIds: items.map((item) => item.candidate.itemId),
      });
    }
  }
  if (suppressedByCreator.length > 0) {
    const byCreator = new Map<string, ScoredCandidate[]>();
    for (const item of suppressedByCreator) {
      const creator = creatorIdOf(item)!;
      const group = byCreator.get(creator);
      if (group === undefined) byCreator.set(creator, [item]);
      else group.push(item);
    }
    for (const [creator, items] of byCreator) {
      decisions.push({
        kind: "feedback-suppression",
        detail: `creator "${creator}" is suppressed (dont-recommend-creator) — ${items.length} candidate(s) skipped: the creator's work is gone from this feed; delete the control to restore`,
        itemIds: items.map((item) => item.candidate.itemId),
      });
    }
  }

  // --- 2. Item demotions (mark; the composition stage owns tail placement). ---
  const anchorsById = new Map(anchors.map((record) => [record.targetId, record]));
  const demoted: { item: ScoredCandidate; kind: FeedbackDemotionKind }[] = [];
  for (const item of survivors) {
    const id = item.candidate.itemId;
    if (notInterested.has(id)) {
      demoted.push({ item, kind: "not-interested" });
    } else if (alreadyWatched.has(id)) {
      demoted.push({ item, kind: "already-watched" });
    }
  }
  for (const { item, kind } of demoted) {
    decisions.push({
      kind: kind === "not-interested" ? "feedback-not-interested" : "feedback-already-watched",
      detail:
        kind === "not-interested"
          ? `the user is not interested in this item — demoted to the feed tail (never removed; delete the control to restore)`
          : `the user already watched this item — repeat deprioritized to the tail (recorded history is never touched; delete the control to restore)`,
      itemIds: [item.candidate.itemId],
    });
  }

  // --- 3. More-like-this boosts (the anchor's neighborhood). ---
  const adjustments = new Map<ScoredCandidate, number>();
  if (anchors.length > 0) {
    const anchorCandidates = survivors.filter((item) =>
      anchorsById.has(item.candidate.itemId),
    );
    for (const candidate of survivors) {
      let boost = 0;
      const anchorIds: string[] = [];
      for (const anchor of anchorCandidates) {
        if (sharesNeighborhood(anchor, candidate)) {
          boost += FEEDBACK_MORE_LIKE_THIS_BOOST;
          anchorIds.push(anchor.candidate.itemId);
        }
      }
      if (boost > 0) {
        adjustments.set(candidate, boost);
        decisions.push({
          kind: "feedback-boost",
          detail: `more-like-this: shares a similarity neighborhood with ${anchorIds.map((id) => `${id}`).join(", ")} — rank +${boost.toFixed(2)} (model score untouched)`,
          itemIds: [candidate.candidate.itemId],
        });
      }
    }
    for (const anchor of anchorCandidates) {
      decisions.push({
        kind: "feedback-boost",
        detail: `more-like-this anchor ${anchor.candidate.itemId} — its similarity neighborhood is boosted; the anchor itself gains no boost (the user wants more LIKE this)`,
        itemIds: [anchor.candidate.itemId],
      });
    }
  }

  // --- 4. Materialize the marks + stable re-sort (modelScore + boost desc,
  //        unscored last, pool index tiebreak — the same order law as the
  //        custom-objective re-sort, so both adjustments compose). ---
  const demotionByItem = new Map<string, FeedbackDemotionKind>();
  for (const { item, kind } of demoted) demotionByItem.set(item.candidate.itemId, kind);
  const marked = survivors.map((item) => {
    const demotion = demotionByItem.get(item.candidate.itemId) ?? null;
    const adjustment = adjustments.get(item) ?? 0;
    if (demotion === null && adjustment === 0) return item;
    return Object.freeze({
      ...item,
      feedbackAdjustment: adjustment,
      feedbackDemoted: demotion,
    }) as ScoredCandidate;
  });

  const keyed = marked.map((item, index) => ({
    item,
    index,
    key:
      item.modelScore === null
        ? Number.NEGATIVE_INFINITY
        : item.modelScore + item.feedbackAdjustment,
  }));
  keyed.sort((a, b) => {
    if (a.key !== b.key) return b.key - a.key;
    return a.index - b.index;
  });

  return {
    ranked: Object.freeze(keyed.map((entry) => entry.item)),
    decisions: Object.freeze(decisions),
  };
}
