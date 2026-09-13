/**
 * Intent-aware pre-filtering, RETRIEVAL SIDE ONLY (WFX-020, Lane A).
 *
 * CRITICAL LAW (frozen architecture — "Recommendation principles" +
 * anti-tunnel-vision): retrieval stays wide. `rankForIntents` NEVER removes
 * a candidate and NEVER narrows the pool — filtering-out is the
 * Recommendation OS policy stage's job (WFX-021). This function only
 * ORDERS: candidates matching more/stronger intents rank earlier, and ties
 * keep insertion order (stable). The output is always a permutation of the
 * input: same length, same members, nothing dropped, nothing duplicated.
 *
 * Matching semantics (deterministic, documented, tested):
 *
 * - Signal: the candidate's text surface — the `features.matchText` string
 *   built by `CandidateIndex` (lowercase title + resolved creator/topic
 *   names + canonicalType + orientation), falling back to a lowercased
 *   `features.canonicalTitle` when a candidate was produced elsewhere.
 *   Candidates with neither surface match no intent (score 0) — they are
 *   still returned, just ranked by insertion order among the score-0 tail.
 * - An intent matches a candidate when at least one objective token
 *   (lowercased, whitespace-split, length >= `INTENT_MATCH_MIN_TOKEN_LENGTH`)
 *   appears as a substring of the candidate's text surface. The min token
 *   length skips function words ("a", "of", "to", …) — a deterministic,
 *   locale-independent stopword proxy; objectives that tokenize to nothing
 *   match nothing.
 * - Strength: one matched intent contributes `weight * confidence` (both
 *   validated to [0, 1], so each contribution lies in [0, 1]). The
 *   candidate's intent score is the SUM over matched intents — matching
 *   MORE intents and matching STRONGER intents both raise the score.
 * - Enrichment: each returned candidate is a NEW frozen object whose
 *   `matchedObjectives` lists the objectives it matched (in intent order).
 *   The input array and its objects are never mutated.
 *
 * Failure model: caller-level mistakes (non-array arguments, malformed
 * candidates, malformed intents) throw a typed `RetrievalError` with
 * aggregated field-level details. Emptiness is fine: no candidates → `[]`;
 * no intents → the input order is returned unchanged.
 */

import {
  INTENT_PROVENANCES,
  INTENT_SCOPES,
  type UserIntent,
  isIso8601,
  isRecord,
  previewValue,
} from "@wfx/domain";

import type { RetrievedCandidate } from "./candidate";
import { RetrievalError } from "./index";

/** Minimum objective-token length that can match (skips short function words). */
export const INTENT_MATCH_MIN_TOKEN_LENGTH = 3;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Structural membership check that accepts untrusted values (unknown-safe). */
function isMemberOf(values: readonly string[], value: unknown): boolean {
  return typeof value === "string" && values.includes(value);
}

/** Field-level validation of one claimed UserIntent; returns its errors. */
function intentErrors(intent: unknown): string[] {
  if (!isRecord(intent)) {
    return [`expected a UserIntent object, got ${previewValue(intent)}`];
  }
  const errors: string[] = [];
  if (typeof intent.userId !== "string" || intent.userId.trim().length === 0) {
    errors.push(`userId: expected a non-empty string, got ${previewValue(intent.userId)}`);
  }
  if (!isMemberOf(INTENT_SCOPES, intent.scope)) {
    errors.push(
      `scope: expected one of ${INTENT_SCOPES.join(" | ")}, got ${previewValue(intent.scope)}`,
    );
  }
  if (typeof intent.objective !== "string" || intent.objective.trim().length === 0) {
    errors.push(
      `objective: expected a non-empty string after trimming, got ${previewValue(intent.objective)}`,
    );
  }
  for (const field of ["weight", "confidence"] as const) {
    const value = intent[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      errors.push(
        `${field}: expected a finite number in [0, 1], got ${previewValue(value)}`,
      );
    }
  }
  if (!isMemberOf(INTENT_PROVENANCES, intent.provenance)) {
    errors.push(
      `provenance: expected one of ${INTENT_PROVENANCES.join(" | ")}, got ${previewValue(intent.provenance)}`,
    );
  }
  if (intent.expiresAt !== undefined && !isIso8601(intent.expiresAt)) {
    errors.push(
      `expiresAt: expected an ISO 8601 datetime string with explicit offset when present, got ${previewValue(intent.expiresAt)}`,
    );
  }
  return errors;
}

/** Field-level validation of one claimed RetrievedCandidate; returns errors. */
function candidateErrors(candidate: unknown): string[] {
  if (!isRecord(candidate)) {
    return [`expected a RetrievedCandidate object, got ${previewValue(candidate)}`];
  }
  if (!isRecord(candidate.candidate)) {
    return [
      `candidate: expected an EntertainmentCandidate object, got ${previewValue(candidate.candidate)}`,
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------

/** Tokenize an objective: lowercase, whitespace-split, min-length filtered. */
function objectiveTokens(objective: string): string[] {
  return objective
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length >= INTENT_MATCH_MIN_TOKEN_LENGTH);
}

/**
 * The candidate's text surface: `features.matchText` when present, else a
 * lowercased `features.canonicalTitle`, else `null` (no text signal — the
 * candidate can match no intent).
 */
function textSurfaceOf(candidate: RetrievedCandidate): string | null {
  const features = candidate.candidate.features;
  if (isRecord(features) && typeof features.matchText === "string") {
    return features.matchText;
  }
  if (isRecord(features) && typeof features.canonicalTitle === "string") {
    return features.canonicalTitle.toLowerCase();
  }
  return null;
}

// ---------------------------------------------------------------------------
// The ranker
// ---------------------------------------------------------------------------

/**
 * Rank candidates by intent affinity — STABLE, ADDITIVE ordering only.
 *
 * Returns a NEW array (the input is never mutated): every input candidate
 * appears exactly once, ordered by descending intent score (sum of
 * `weight * confidence` over matched intents), ties keeping insertion
 * order. Each returned candidate is a fresh frozen object carrying the
 * matched objectives in `matchedObjectives`; the embedded `candidate` and
 * `sourceRealizations` are shared by reference (already frozen, immutable).
 *
 * This function NEVER removes or narrows: the anti-tunnel-vision law
 * (policy filtering is WFX-021's job) holds by construction — the output is
 * a permutation of the input.
 */
export function rankForIntents(
  candidates: readonly RetrievedCandidate[],
  intents: readonly UserIntent[],
): RetrievedCandidate[] {
  if (!Array.isArray(candidates)) {
    throw new RetrievalError(
      `candidates: expected an array of RetrievedCandidate, got ${previewValue(candidates)}`,
    );
  }
  if (!Array.isArray(intents)) {
    throw new RetrievalError(
      `intents: expected an array of UserIntent, got ${previewValue(intents)}`,
    );
  }

  const errors: string[] = [];
  for (const [index, candidate] of candidates.entries()) {
    errors.push(...candidateErrors(candidate).map((error) => `candidates[${index}]: ${error}`));
  }
  for (const [index, intent] of intents.entries()) {
    errors.push(...intentErrors(intent).map((error) => `intents[${index}]: ${error}`));
  }
  if (errors.length > 0) throw new RetrievalError(errors);

  // Score every candidate (insertion-indexed for the stable tiebreak).
  const scored = candidates.map((retrieved, insertionIndex) => {
    const surface = textSurfaceOf(retrieved);
    let score = 0;
    const matchedObjectives: string[] = [];
    if (surface !== null) {
      for (const intent of intents) {
        const tokens = objectiveTokens(intent.objective);
        if (tokens.length === 0) continue; // no matchable signal in this objective
        if (tokens.some((token) => surface.includes(token))) {
          score += intent.weight * intent.confidence;
          matchedObjectives.push(intent.objective);
        }
      }
    }
    return { retrieved, insertionIndex, score, matchedObjectives };
  });

  // Stable ordering: score descending, then insertion order ascending.
  scored.sort((a, b) => b.score - a.score || a.insertionIndex - b.insertionIndex);

  return scored.map((entry) =>
    Object.freeze({
      ...entry.retrieved,
      matchedObjectives: Object.freeze([...entry.matchedObjectives]) as string[],
    }),
  );
}
