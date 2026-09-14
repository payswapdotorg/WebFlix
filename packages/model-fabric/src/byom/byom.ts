/**
 * WFX-032 — the BYOM port: the bring-your-own-model seam (Lane A — intelligence).
 *
 * `ByomModel` is the SEAM the frozen architecture demands ("Recommendation is
 * user-controlled. Users may use WebFlix models, bring a model, use local
 * models, or define policies" — product invariant 6): the user's own model
 * scores candidates while WebFlix enforces policy around it. Models rank
 * candidates; they do NOT own policy, persistence, authorization, or provider
 * actions (docs/architecture/contracts.md, "Recommendation OS").
 *
 * The seam is deliberately UNTYPED at the output edge: `score(input)` resolves
 * with `unknown` because external models return whatever they return. The
 * ADAPTER's job (adapter.ts + enforce.ts) is to validate and shape that output
 * into the frozen `RecommendationScore[]` — never to trust it, never to
 * fabricate it.
 *
 * The input edge is typed: `ByomInput` is the serialized
 * `RecommendationContext` (candidate features included) MINUS the fields
 * redacted by the model's privacy class (redaction.ts is the single producer —
 * `ByomInput` values are only ever minted there, so the privacy boundary is
 * enforced by construction, not by convention).
 *
 * `privacyClass` (WHERE the model's input may travel) reuses the frozen
 * `ModelPolicy["privacy"]` vocabulary — the same three classes the fabric's
 * policies speak, so a BYOM model plugs into the merged routing/privacy
 * machinery without a translation layer.
 *
 * `costPerCall` is the model's declared cost for ONE score() invocation, in
 * the fabric's abstract cost units (the same units as
 * `ModelPolicy.maxCostPerOperation` — see enforce.ts's cost ceiling).
 *
 * No fixture models ship in this module (fixtures.ts owns the TEST doubles);
 * `assertValidByomModel` is the constructor-time validation shared by the
 * adapter and the fabric wrapper.
 */

import type {
  EntertainmentCandidate,
  EntertainmentEvent,
  RecommendationContext,
  RecommendationPolicy,
  UserIntent,
} from "@wfx/domain";

// ---------------------------------------------------------------------------
// Privacy class vocabulary (runtime mirror of the frozen ModelPolicy union)
// ---------------------------------------------------------------------------

/**
 * Where a BYOM model's input may travel — the frozen
 * `ModelPolicy["privacy"]` vocabulary, reused verbatim so BYOM models and
 * fabric policies speak the same classes.
 */
export type ByomPrivacyClass = "local-only" | "trusted-cloud" | "any-cloud";

/** Every privacy class, in frozen-contract order. */
export const BYOM_PRIVACY_CLASSES = [
  "local-only",
  "trusted-cloud",
  "any-cloud",
] as const satisfies readonly ByomPrivacyClass[];

/** Runtime guard for the privacy class union (accepts untrusted values). */
export function isByomPrivacyClass(x: unknown): x is ByomPrivacyClass {
  return typeof x === "string" && (BYOM_PRIVACY_CLASSES as readonly string[]).includes(x);
}

// ---------------------------------------------------------------------------
// ByomInput — the serialized, redacted context a BYOM model receives
// ---------------------------------------------------------------------------

/**
 * The input a BYOM model's `score` receives: the serialized
 * `RecommendationContext` (candidate features included) MINUS the fields
 * redacted by the model's privacy class.
 *
 * Structurally the frozen context shape; the GUARANTEE is runtime, not
 * structural: values of this type are produced ONLY by
 * `redactForPrivacy(ctx, privacyClass)` (redaction.ts), which deep-copies the
 * context and applies the class's transformations — the model never sees the
 * caller's objects and never sees redacted fields.
 */
export interface ByomInput {
  /** The context user — verbatim for `local-only`, pseudonymized otherwise. */
  userId: string;
  /** The session id — kept under every class (the spec keeps session ids). */
  sessionId: string;
  /** The requested feed surface (frozen vocabulary). */
  surface: RecommendationContext["surface"];
  /** The user's intents (serialized copies; userId pseudonymized alongside). */
  intents: UserIntent[];
  /** The recommendation policy (serialized copy; userId pseudonymized alongside). */
  policy: RecommendationPolicy;
  /** Recent events (serialized copies; payloads minimized for `any-cloud`). */
  recentEvents: EntertainmentEvent[];
  /** The candidate pool, features included (verbatim deep copies). */
  candidatePool: EntertainmentCandidate[];
}

// ---------------------------------------------------------------------------
// ByomModel — the seam
// ---------------------------------------------------------------------------

/**
 * The bring-your-own-model port. The real model is the user's; THIS interface
 * is the deliverable seam the adapter wraps. `score` may reject or throw —
 * failures are the model's own; the adapter types them (ByomError
 * "model-failure") and never substitutes.
 *
 * `id` / `version` identify the user's model honestly (any non-empty version
 * string — unlike the first-party model, a user's model versions itself;
 * semver is NOT imposed on external models).
 */
export interface ByomModel {
  /** The model's identity (stable, non-empty). */
  id: string;
  /** The model's version string (non-empty; scheme is the model's own). */
  version: string;
  /** Where this model's input may travel (drives redaction + fabric privacy). */
  privacyClass: ByomPrivacyClass;
  /** Declared cost of ONE score() invocation (fabric abstract cost units). */
  costPerCall: number;
  /**
   * Score the (already redacted) input. The output is deliberately UNTYPED:
   * external models return whatever they return; the adapter validates and
   * shapes it (enforce.ts). A rejection/throw propagates as a typed ByomError
   * — never swallowed, never substituted.
   */
  score(input: ByomInput): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Constructor-time validation (programmer errors — wiring bugs)
// ---------------------------------------------------------------------------

/**
 * Thrown by `assertValidByomModel` when a claimed `ByomModel` violates the
 * port's shape. Construction-time failure (like the merged
 * `InvalidWfxModelVersionError` precedent): a malformed BYOM registration is a
 * wiring bug, fail fast with field-level details.
 */
export class InvalidByomModelError extends Error {
  /** Field-level problem descriptions (at least one). */
  readonly details: readonly string[];

  constructor(details: string | readonly string[]) {
    const list = typeof details === "string" ? [details] : details;
    super(`InvalidByomModelError: ${list.join("; ")}`);
    this.name = "InvalidByomModelError";
    this.details = list;
  }
}

/**
 * Validate a claimed `ByomModel`: object with a non-empty string id/version, a
 * frozen-vocabulary privacyClass, a finite non-negative costPerCall, and a
 * callable score.
 *
 * @throws InvalidByomModelError with field-level details on any violation.
 */
export function assertValidByomModel(byom: unknown): asserts byom is ByomModel {
  const details: string[] = [];
  const record =
    typeof byom === "object" && byom !== null ? (byom as Record<string, unknown>) : null;

  if (record === null) {
    details.push("expected a ByomModel object");
  } else {
    if (typeof record.id !== "string" || record.id.trim().length === 0) {
      details.push(`id: expected a non-empty string, got ${preview(record.id)}`);
    }
    if (typeof record.version !== "string" || record.version.trim().length === 0) {
      details.push(`version: expected a non-empty string, got ${preview(record.version)}`);
    }
    if (!isByomPrivacyClass(record.privacyClass)) {
      details.push(
        `privacyClass: expected one of ${BYOM_PRIVACY_CLASSES.join(" | ")}, got ${preview(record.privacyClass)}`,
      );
    }
    if (
      typeof record.costPerCall !== "number" ||
      !Number.isFinite(record.costPerCall) ||
      record.costPerCall < 0
    ) {
      details.push(
        `costPerCall: expected a finite non-negative number, got ${preview(record.costPerCall)}`,
      );
    }
    if (typeof record.score !== "function") {
      details.push(`score: expected a function, got ${preview(record.score)}`);
    }
  }

  if (details.length > 0) throw new InvalidByomModelError(details);
}

/** Compact, safe preview of an untrusted value for error messages (never throws). */
function preview(value: unknown): string {
  let rendered: string;
  if (typeof value === "number") {
    rendered = String(value); // JSON.stringify would render NaN/Infinity as null
  } else {
    try {
      rendered = JSON.stringify(value) ?? String(value);
    } catch {
      rendered = String(value); // circular structures and other exotic input
    }
  }
  return rendered.length > 60 ? `${rendered.slice(0, 57)}...` : rendered;
}
