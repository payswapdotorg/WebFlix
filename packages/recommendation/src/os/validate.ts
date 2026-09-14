/**
 * Recommendation OS — context and model validation (WFX-021, Lane A).
 *
 * Field-level, aggregated validation of untrusted input, following the
 * WFX-002/WFX-020 law: every problem is collected (never thrown one at a
 * time), nothing is coerced, and objects with unknown extra fields are
 * ACCEPTED (structural typing, forward compatibility — same decision as the
 * domain validators).
 *
 * - `validateRecommendationContext` — total validation of the frozen
 *   `RecommendationContext`: surface vocabulary, userId/sessionId, policy
 *   (delegated to the WFX-011 `validatePolicy`), intents (the same
 *   field-level law WFX-020's rankForIntents enforces, re-implemented here
 *   because retrieval's validators are private to that module), recent
 *   events (WFX-002 `validateEntertainmentEvent`, plus a userId match: the
 *   OS consumes THE user's events; another user's events would corrupt
 *   repetition/fatigue/resume signals), and the candidate pool (the frozen
 *   `EntertainmentCandidate` shape plus the documented optional feature
 *   keys the OS consumes: canonicalType / canonicalTitle / matchText /
 *   durationMs / orientation / publishedAt / nextEpisodeOf).
 * - `validateRecommendationModel` — the injected model must satisfy the
 *   frozen `RecommendationModel` shape (id, version, callable score).
 */

import {
  AVAILABILITIES,
  CANONICAL_TYPES,
  INTENT_PROVENANCES,
  INTENT_SCOPES,
  ORIENTATIONS,
  type RecommendationContext,
  type RecommendationModel,
  type UserIntent,
  isIso8601,
  isRecord,
  previewValue,
  validateEntertainmentEvent,
  validatePolicy,
} from "@wfx/domain";

import type { ValidationResult } from "@wfx/domain";

import { RecommendationOSError } from "./types";

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** Structural membership check that accepts untrusted values. */
function isMemberOf(values: readonly string[], value: unknown): boolean {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** Assert a ValidationResult is ok, otherwise throw the typed OS error. */
export function assertOk<T>(result: ValidationResult<T>, prefix: string): T {
  if (result.ok) return result.value;
  throw new RecommendationOSError(
    "invalid-input",
    result.errors.map((error) => `${prefix}: ${error}`),
  );
}

// ---------------------------------------------------------------------------
// Intent validation (mirrors WFX-020 rankForIntents' field-level law)
// ---------------------------------------------------------------------------

/**
 * Field-level validation of one claimed `UserIntent`; returns its errors.
 * Same law as the merged retrieval work — scope/provenance vocabularies,
 * objective non-empty after trim, weight/confidence finite in [0, 1],
 * expiresAt ISO 8601 with explicit offset when present. The intent's
 * `userId` field is NOT cross-checked against the ctx user (same decision
 * as WFX-020's rankForIntents: the caller assembles the user's intent set).
 */
export function userIntentErrors(intent: unknown): string[] {
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
      errors.push(`${field}: expected a finite number in [0, 1], got ${previewValue(value)}`);
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

// ---------------------------------------------------------------------------
// Candidate pool validation
// ---------------------------------------------------------------------------

/**
 * Field-level validation of one claimed pool `EntertainmentCandidate`.
 *
 * The frozen shape is checked in full (itemId, realization quadruple,
 * features record of primitives). Known feature keys the OS consumes are
 * additionally type-checked when present: `canonicalType`, `canonicalTitle`,
 * `matchText`, `durationMs`, `orientation`, `publishedAt` (ISO 8601),
 * `nextEpisodeOf`. Informational keys the OS does not consume (e.g. the
 * index's `realizationCount` / `capabilityCount`) are only checked to be
 * valid record values — never coerced, never rejected.
 */
export function candidateErrors(candidate: unknown): string[] {
  if (!isRecord(candidate)) {
    return [`expected an EntertainmentCandidate object, got ${previewValue(candidate)}`];
  }
  const errors: string[] = [];
  if (typeof candidate.itemId !== "string" || candidate.itemId.trim().length === 0) {
    errors.push(`itemId: expected a non-empty string, got ${previewValue(candidate.itemId)}`);
  }

  if (!isRecord(candidate.realization)) {
    errors.push(
      `realization: expected an object, got ${previewValue(candidate.realization)}`,
    );
  } else {
    const realization = candidate.realization;
    for (const field of ["connectorId", "externalRef"] as const) {
      if (typeof realization[field] !== "string" || realization[field].trim().length === 0) {
        errors.push(
          `realization.${field}: expected a non-empty string, got ${previewValue(realization[field])}`,
        );
      }
    }
    if (
      !Array.isArray(realization.capabilities) ||
      !realization.capabilities.every((capability) => typeof capability === "string")
    ) {
      errors.push(
        `realization.capabilities: expected an array of strings, got ${previewValue(realization.capabilities)}`,
      );
    }
    if (!isMemberOf(AVAILABILITIES, realization.availability)) {
      errors.push(
        `realization.availability: expected one of ${AVAILABILITIES.join(" | ")}, got ${previewValue(realization.availability)}`,
      );
    }
  }

  if (!isRecord(candidate.features)) {
    errors.push(
      `features: expected a Record<string, number | string | boolean>, got ${previewValue(candidate.features)}`,
    );
    return errors;
  }
  for (const [key, value] of Object.entries(candidate.features)) {
    if (typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean") {
      errors.push(
        `features.${key}: expected a number, string, or boolean, got ${previewValue(value)}`,
      );
    }
  }
  const features = candidate.features;
  if (
    features.canonicalType !== undefined &&
    !isMemberOf(CANONICAL_TYPES, features.canonicalType)
  ) {
    errors.push(
      `features.canonicalType: expected one of ${CANONICAL_TYPES.join(" | ")} when present, got ${previewValue(features.canonicalType)}`,
    );
  }
  if (
    features.canonicalTitle !== undefined &&
    (typeof features.canonicalTitle !== "string" || features.canonicalTitle.trim().length === 0)
  ) {
    errors.push(
      `features.canonicalTitle: expected a non-empty string when present, got ${previewValue(features.canonicalTitle)}`,
    );
  }
  if (features.matchText !== undefined && typeof features.matchText !== "string") {
    errors.push(
      `features.matchText: expected a string when present, got ${previewValue(features.matchText)}`,
    );
  }
  if (
    features.durationMs !== undefined &&
    (typeof features.durationMs !== "number" ||
      !Number.isFinite(features.durationMs) ||
      features.durationMs < 0)
  ) {
    errors.push(
      `features.durationMs: expected a finite non-negative number when present, got ${previewValue(features.durationMs)}`,
    );
  }
  if (features.orientation !== undefined && !isMemberOf(ORIENTATIONS, features.orientation)) {
    errors.push(
      `features.orientation: expected one of ${ORIENTATIONS.join(" | ")} when present, got ${previewValue(features.orientation)}`,
    );
  }
  if (features.publishedAt !== undefined && !isIso8601(features.publishedAt)) {
    errors.push(
      `features.publishedAt: expected an ISO 8601 datetime string with explicit offset when present, got ${previewValue(features.publishedAt)}`,
    );
  }
  if (
    features.nextEpisodeOf !== undefined &&
    (typeof features.nextEpisodeOf !== "string" || features.nextEpisodeOf.trim().length === 0)
  ) {
    errors.push(
      `features.nextEpisodeOf: expected a non-empty canonical item id string when present, got ${previewValue(features.nextEpisodeOf)}`,
    );
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Context validation
// ---------------------------------------------------------------------------

/**
 * Total validation of an untrusted `RecommendationContext`.
 *
 * All problems are collected into one result — never thrown here. On success
 * the SAME reference is returned as the typed value. The events' userId must
 * match the ctx userId (the repetition / fatigue / resume / continuation
 * signals are per-user; another user's events would silently corrupt them —
 * a typed error, never a guess).
 */
export function validateRecommendationContext(
  input: unknown,
): ValidationResult<RecommendationContext> {
  if (!isRecord(input)) {
    return { ok: false, errors: ["RecommendationContext: expected an object"] };
  }
  const errors: string[] = [];

  if (typeof input.userId !== "string" || input.userId.trim().length === 0) {
    errors.push(`userId: expected a non-empty string, got ${previewValue(input.userId)}`);
  }
  if (typeof input.sessionId !== "string" || input.sessionId.trim().length === 0) {
    errors.push(`sessionId: expected a non-empty string, got ${previewValue(input.sessionId)}`);
  }
  if (input.surface !== "watch" && input.surface !== "short") {
    errors.push(`surface: expected "watch" | "short", got ${previewValue(input.surface)}`);
  }

  const policyCheck = validatePolicy(input.policy);
  if (!policyCheck.ok) {
    errors.push(...policyCheck.errors.map((error) => `policy: ${error}`));
  }

  if (!Array.isArray(input.intents)) {
    errors.push(`intents: expected an array of UserIntent, got ${previewValue(input.intents)}`);
  } else {
    for (const [index, intent] of input.intents.entries()) {
      errors.push(
        ...userIntentErrors(intent).map((error) => `intents[${index}]: ${error}`),
      );
    }
  }

  if (!Array.isArray(input.recentEvents)) {
    errors.push(
      `recentEvents: expected an array of EntertainmentEvent, got ${previewValue(input.recentEvents)}`,
    );
  } else {
    for (const [index, rawEvent] of input.recentEvents.entries()) {
      const eventCheck = validateEntertainmentEvent(rawEvent);
      if (!eventCheck.ok) {
        errors.push(
          ...eventCheck.errors.map((error) => `recentEvents[${index}]: ${error}`),
        );
        continue;
      }
      if (
        typeof input.userId === "string" &&
        eventCheck.value.userId.trim() !== input.userId.trim()
      ) {
        errors.push(
          `recentEvents[${index}]: userId "${eventCheck.value.userId}" does not match the context user "${input.userId}" — the OS consumes the user's own events`,
        );
      }
    }
  }

  if (!Array.isArray(input.candidatePool)) {
    errors.push(
      `candidatePool: expected an array of EntertainmentCandidate, got ${previewValue(input.candidatePool)}`,
    );
  } else {
    for (const [index, candidate] of input.candidatePool.entries()) {
      errors.push(
        ...candidateErrors(candidate).map((error) => `candidatePool[${index}]: ${error}`),
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as unknown as RecommendationContext };
}

/** Validate an untrusted `RecommendationModel` (the injected model shape). */
export function validateRecommendationModel(
  input: unknown,
): ValidationResult<RecommendationModel> {
  if (!isRecord(input)) {
    return { ok: false, errors: ["RecommendationModel: expected an object"] };
  }
  const errors: string[] = [];
  if (typeof input.id !== "string" || input.id.trim().length === 0) {
    errors.push(`id: expected a non-empty string, got ${previewValue(input.id)}`);
  }
  if (typeof input.version !== "string" || input.version.trim().length === 0) {
    errors.push(`version: expected a non-empty string, got ${previewValue(input.version)}`);
  }
  if (typeof input.score !== "function") {
    errors.push(`score: expected a function, got ${previewValue(input.score)}`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as unknown as RecommendationModel };
}

// ---------------------------------------------------------------------------
// Convenience assert helpers (stage entry points)
// ---------------------------------------------------------------------------

/** Validate a context or throw the typed aggregated error. */
export function assertValidContext(input: unknown): RecommendationContext {
  return assertOk(validateRecommendationContext(input), "ctx");
}

/** Validate the model or throw the typed aggregated error. */
export function assertValidModel(input: unknown): RecommendationModel {
  return assertOk(validateRecommendationModel(input), "model");
}

/**
 * Validate an intents array or throw (diversify accepts intents separately
 * from the ctx).
 */
export function assertValidIntents(input: unknown): UserIntent[] {
  if (!Array.isArray(input)) {
    throw new RecommendationOSError(
      "invalid-input",
      `intents: expected an array of UserIntent, got ${previewValue(input)}`,
    );
  }
  const errors: string[] = [];
  for (const [index, intent] of input.entries()) {
    errors.push(...userIntentErrors(intent).map((error) => `intents[${index}]: ${error}`));
  }
  if (errors.length > 0) throw new RecommendationOSError("invalid-input", errors);
  return input as UserIntent[];
}
