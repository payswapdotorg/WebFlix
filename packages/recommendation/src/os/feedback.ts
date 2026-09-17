/**
 * Recommendation OS — feedback controls (R05, Lane A — intelligence).
 *
 * THE J15 CONTROL VOCABULARY (the architecture's Recommendation UX list, the
 * YouTube reversibility lesson adopted as law): every control that shapes
 * recommendations is an EXPLICIT, PER-PROFILE, TIMESTAMPED, REVERSIBLE typed
 * record — `more-like-this`, `not-interested`, `dont-recommend-source`,
 * `dont-recommend-creator`, `already-watched`. Feedback lives in its own
 * store (`/experience/feedback`, `PostgresRecommendationFeedbackStore`) and
 * NEVER deletes or falsifies recorded viewing events (the R04 event-sink
 * law — the outbox is immutable audit truth; feedback is a projection-side
 * control).
 *
 * THE SEMANTICS THIS MODULE ENFORCES (deterministic, traced, reversible):
 *
 * - `not-interested` (item target): the target item is EXCLUDED from the
 *   composed feed, with an honest trace decision naming it — the user said
 *   "not interested" and the OS obeys. Exclusion is the one feedback
 *   semantic that removes a card (an explicit user control, not a silent
 *   narrowing); undo (`DELETE /experience/feedback/:id`) restores the
 *   candidate exactly (the reversibility law).
 * - `dont-recommend-source` (connector target): every pool candidate whose
 *   realization belongs to the suppressed source is SKIPPED with an honest
 *   note in the composition result — never a silent gap, never an error. An
 *   item that ALSO has a non-suppressed realization still surfaces (the
 *   item is not the target; the source is).
 * - `dont-recommend-creator` (creator target): every candidate carrying the
 *   documented `creatorId` feature equal to the suppressed creator is
 *   skipped with the same honest-note law. Candidates without the feature
 *   are unaffected (the OS never guesses a creator).
 * - `already-watched` (item target): the target is DEMOTED to the tail
 *   (before the availability floor) — repeats are deprioritized WITHOUT
 *   deleting history and WITHOUT excluding the item (a rewatch is a legal
 *   user action; the control only de-prioritizes).
 * - `more-like-this` (item target): the target's SIMILARITY NEIGHBORHOOD —
 *   candidates whose text surface shares an objective token with the
 *   target's, or whose dominant matched objective equals the target's — is
 *   BOOSTED (stable reorder above non-neighbors, incoming order preserved
 *   within the boosted group). The model score is never touched (the OS
 *   law: ordering decisions live in the stages and the trace).
 *
 * PURITY LAW (unchanged): `applyFeedback` is a pure, deterministic function
 * of (ctx, scored, feedback) — no I/O, no clocks (records arrive
 * pre-timestamped from the store), no randomness. Every decision lands in
 * the trace as a `feedback-*` decision kind.
 */

import { isIso8601, isRecord, previewValue } from "@wfx/domain";

import { objectiveTokens } from "./features";
import type { ScoredCandidate, TraceDecision } from "./types";
import { RecommendationOSError } from "./types";

// ---------------------------------------------------------------------------
// The control vocabulary (closed)
// ---------------------------------------------------------------------------

/** The J15 feedback-control kinds (the frozen architecture's list). */
export type RecommendationFeedbackKind =
  | "more-like-this"
  | "not-interested"
  | "dont-recommend-source"
  | "dont-recommend-creator"
  | "already-watched";

/** Every feedback kind, in declaration order. */
export const RECOMMENDATION_FEEDBACK_KINDS: readonly RecommendationFeedbackKind[] = [
  "more-like-this",
  "not-interested",
  "dont-recommend-source",
  "dont-recommend-creator",
  "already-watched",
];

/** The kinds whose target is a canonical item id. */
export const ITEM_TARGETED_FEEDBACK_KINDS: readonly RecommendationFeedbackKind[] = [
  "more-like-this",
  "not-interested",
  "already-watched",
];

/** Structural guard for the closed kind vocabulary. */
export function isRecommendationFeedbackKind(
  value: unknown,
): value is RecommendationFeedbackKind {
  return (
    typeof value === "string" &&
    (RECOMMENDATION_FEEDBACK_KINDS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// The typed record (the wire/persistence shape)
// ---------------------------------------------------------------------------

/** One feedback control record (what `POST /experience/feedback` stores). */
export interface RecommendationFeedbackRecord {
  /** The record's id (`wfxfb_…`, minted by the persistence store). */
  readonly id: string;
  /** The closed control vocabulary member. */
  readonly kind: RecommendationFeedbackKind;
  /**
   * What the control targets — per kind: a canonical item id
   * (`more-like-this` / `not-interested` / `already-watched`), a connector
   * id (`dont-recommend-source`), or a creator id
   * (`dont-recommend-creator`).
   */
  readonly target: string;
  /** Optional free-form note (why — never rendered as a reason to others). */
  readonly note?: string;
  /** ISO 8601 instant the control was recorded (the store's clock). */
  readonly createdAt: string;
}

/** Field-level validation of one claimed feedback record; returns errors. */
export function feedbackRecordErrors(record: unknown): string[] {
  if (!isRecord(record)) {
    return [`expected a RecommendationFeedbackRecord object, got ${previewValue(record)}`];
  }
  const errors: string[] = [];
  if (typeof record.id !== "string" || record.id.trim().length === 0) {
    errors.push(`id: expected a non-empty string, got ${previewValue(record.id)}`);
  }
  if (!isRecommendationFeedbackKind(record.kind)) {
    errors.push(
      `kind: expected one of ${RECOMMENDATION_FEEDBACK_KINDS.join(" | ")}, got ${previewValue(record.kind)}`,
    );
  }
  if (typeof record.target !== "string" || record.target.trim().length === 0) {
    errors.push(`target: expected a non-empty string, got ${previewValue(record.target)}`);
  }
  if (record.note !== undefined && (typeof record.note !== "string" || record.note.length > 500)) {
    errors.push(
      `note: expected a string of at most 500 characters when present, got ${previewValue(record.note)}`,
    );
  }
  if (typeof record.createdAt !== "string" || !isIso8601(record.createdAt)) {
    errors.push(
      `createdAt: expected an ISO 8601 datetime string, got ${previewValue(record.createdAt)}`,
    );
  }
  return errors;
}

/** Validate a feedback array or throw the typed aggregated error. */
export function assertValidFeedbackRecords(
  records: unknown,
): readonly RecommendationFeedbackRecord[] {
  if (!Array.isArray(records)) {
    throw new RecommendationOSError(
      "invalid-input",
      `feedback: expected an array of RecommendationFeedbackRecord, got ${previewValue(records)}`,
    );
  }
  const errors: string[] = [];
  for (const [index, record] of records.entries()) {
    errors.push(
      ...feedbackRecordErrors(record).map((error) => `feedback[${index}]: ${error}`),
    );
  }
  if (errors.length > 0) throw new RecommendationOSError("invalid-input", errors);
  return records as readonly RecommendationFeedbackRecord[];
}

// ---------------------------------------------------------------------------
// The feedback stage
// ---------------------------------------------------------------------------

/** Output of the feedback stage. */
export interface FeedbackResult {
  /** The filtered/reordered candidates (a subset of the input by design). */
  readonly ranked: readonly ScoredCandidate[];
  /** Auditable decisions (one honest trace decision per applied control). */
  readonly decisions: readonly TraceDecision[];
}

/** Group feedback records by kind once (deterministic order preserved). */
function groupFeedback(
  records: readonly RecommendationFeedbackRecord[],
): Readonly<Record<RecommendationFeedbackKind, readonly string[]>> {
  const byKind: Record<RecommendationFeedbackKind, string[]> = {
    "more-like-this": [],
    "not-interested": [],
    "dont-recommend-source": [],
    "dont-recommend-creator": [],
    "already-watched": [],
  };
  for (const record of records) {
    if (!byKind[record.kind].includes(record.target)) byKind[record.kind].push(record.target);
  }
  return byKind;
}

/** Read the documented `creatorId` feature (null when absent — never guessed). */
function creatorIdOf(item: ScoredCandidate): string | null {
  const value = item.candidate.features["creatorId"];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * The candidate's text surface for similarity matching: the SAME documented
 * law as feature assembly (`features.matchText` when present, else a
 * lowercased `features.canonicalTitle`, else null — no signal, no guess).
 */
function textSurfaceOf(candidate: {
  readonly features: Record<string, number | string | boolean>;
}): string | null {
  if (typeof candidate.features.matchText === "string") {
    return candidate.features.matchText.toLowerCase();
  }
  if (typeof candidate.features.canonicalTitle === "string") {
    return candidate.features.canonicalTitle.toLowerCase();
  }
  return null;
}

/**
 * Apply the feedback controls to the scored candidates.
 *
 * Pure and deterministic; the input array and its objects are never mutated.
 * Throws the typed `RecommendationOSError` (kind "invalid-input") on a
 * malformed feedback record — a broken control never silently applies.
 */
export function applyFeedback(
  scored: readonly ScoredCandidate[],
  feedback: readonly RecommendationFeedbackRecord[],
): FeedbackResult {
  const records = assertValidFeedbackRecords(feedback);
  const decisions: TraceDecision[] = [];
  const byKind = groupFeedback(records);

  // --- 1. Exclusions: not-interested (item) + source/creator suppressions ---
  const notInterested = new Set(byKind["not-interested"]);
  const suppressedSources = new Set(byKind["dont-recommend-source"]);
  const suppressedCreators = new Set(byKind["dont-recommend-creator"]);

  const excludedItems = new Set<string>();
  const excludedRealizations: { item: string; connectorId: string }[] = [];
  const excludedByCreator: { item: string; creatorId: string }[] = [];

  for (const item of scored) {
    const itemId = item.candidate.itemId;
    if (notInterested.has(itemId)) {
      excludedItems.add(itemId);
      continue; // recorded once per item below
    }
    const connectorId = item.candidate.realization.connectorId;
    if (suppressedSources.has(connectorId)) {
      excludedRealizations.push({ item: itemId, connectorId });
      continue;
    }
    const creatorId = creatorIdOf(item);
    if (creatorId !== null && suppressedCreators.has(creatorId)) {
      excludedByCreator.push({ item: itemId, creatorId });
    }
  }

  for (const target of byKind["not-interested"]) {
    decisions.push({
      kind: "feedback-not-interested",
      detail: `the user is not interested in this item — excluded from the composed feed (reversible: undo the feedback control to restore it)`,
      itemIds: [target],
    });
  }
  for (const connectorId of byKind["dont-recommend-source"]) {
    const items = excludedRealizations
      .filter((entry) => entry.connectorId === connectorId)
      .map((entry) => entry.item);
    decisions.push({
      kind: "feedback-suppressed-source",
      detail: `source "${connectorId}" is suppressed by the user — every realization from it is skipped with this honest note (items with other realizations still surface; reversible control)`,
      itemIds: items,
    });
  }
  for (const creatorId of byKind["dont-recommend-creator"]) {
    const items = excludedByCreator
      .filter((entry) => entry.creatorId === creatorId)
      .map((entry) => entry.item);
    decisions.push({
      kind: "feedback-suppressed-creator",
      detail: `creator "${creatorId}" is suppressed by the user — every candidate carrying the creatorId feature is skipped with this honest note (never an error, never a silent gap; reversible control)`,
      itemIds: items,
    });
  }

  let current = scored.filter((item) => {
    if (excludedItems.has(item.candidate.itemId)) return false;
    const connectorId = item.candidate.realization.connectorId;
    if (suppressedSources.has(connectorId)) return false;
    const creatorId = creatorIdOf(item);
    if (creatorId !== null && suppressedCreators.has(creatorId)) return false;
    return true;
  });

  // --- 2. already-watched: demote repeats to the tail (never delete) ---
  const alreadyWatched = new Set(byKind["already-watched"]);
  if (alreadyWatched.size > 0) {
    const watchedTargets = current.filter((item) => alreadyWatched.has(item.candidate.itemId));
    if (watchedTargets.length > 0) {
      const demotedIds = watchedTargets.map((item) => item.candidate.itemId);
      decisions.push({
        kind: "feedback-already-watched",
        detail: `the user marked ${demotedIds.length} item(s) already-watched — deprioritized to the tail (history untouched: recorded viewing events stay immutable; the control only de-prioritizes repeats)`,
        itemIds: demotedIds,
      });
      current = [
        ...current.filter((item) => !alreadyWatched.has(item.candidate.itemId)),
        ...watchedTargets,
      ];
    } else {
      decisions.push({
        kind: "feedback-already-watched",
        detail: `already-watched control(s) present but no matching candidates in this pool — nothing to demote (the control stays recorded and reversible)`,
        itemIds: [],
      });
    }
  }

  // --- 3. more-like-this: boost the similarity neighborhood (stable) ---
  const moreLikeThis = byKind["more-like-this"];
  if (moreLikeThis.length > 0) {
    // The neighborhood tokens + dominant objectives of every boosted target.
    const targetTokens = new Set<string>();
    const targetObjectives = new Set<string>();
    const byItem = new Map<string, ScoredCandidate>();
    for (const item of current) byItem.set(item.candidate.itemId, item);
    for (const target of moreLikeThis) {
      const targetItem = byItem.get(target);
      if (targetItem === undefined) {
        decisions.push({
          kind: "feedback-more-like-this",
          detail: `the target item is not present in this pool — nothing to boost (the control stays recorded and reversible)`,
          itemIds: [target],
        });
        continue;
      }
      const surface = textSurfaceOf(targetItem.candidate);
      if (surface !== null) {
        for (const token of objectiveTokens(surface)) targetTokens.add(token);
      }
      if (targetItem.features.dominantObjective !== null) {
        targetObjectives.add(targetItem.features.dominantObjective);
      }
    }
    const boosted: ScoredCandidate[] = [];
    const rest: ScoredCandidate[] = [];
    for (const item of current) {
      if (moreLikeThis.includes(item.candidate.itemId)) {
        boosted.push(item); // the target itself stays (and leads its neighborhood)
        continue;
      }
      const surface = textSurfaceOf(item.candidate);
      const tokenMatch =
        surface !== null && objectiveTokens(surface).some((token) => targetTokens.has(token));
      const objectiveMatch =
        item.features.dominantObjective !== null &&
        targetObjectives.has(item.features.dominantObjective);
      if (tokenMatch || objectiveMatch) boosted.push(item);
      else rest.push(item);
    }
    if (boosted.length > 0 && rest.length > 0) {
      decisions.push({
        kind: "feedback-more-like-this",
        detail: `boosting ${boosted.length} candidate(s) in the similarity neighborhood of ${moreLikeThis.length} more-like-this target(s) — token-overlap and dominant-objective match, stable reorder (model scores untouched; reversible control)`,
        itemIds: boosted.map((item) => item.candidate.itemId),
      });
    } else if (boosted.length > 0) {
      decisions.push({
        kind: "feedback-more-like-this",
        detail: `the similarity neighborhood covers every remaining candidate — order preserved (nothing to boost above; reversible control)`,
        itemIds: [],
      });
    }
    current = [...boosted, ...rest];
  }

  return {
    ranked: Object.freeze(current),
    decisions: Object.freeze(decisions),
  };
}
