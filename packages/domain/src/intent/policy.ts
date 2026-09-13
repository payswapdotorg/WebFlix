/**
 * RecommendationPolicy helpers (WFX-011, Lane A) on the frozen type.
 *
 * The frozen `RecommendationPolicy` carries the user-controlled recommendation
 * dials (exploration, novelty, socialInfluence, attention mode, explicit
 * objectives with maximize/minimize directions, optional session-extension
 * cap). This module provides:
 *
 * - `defaultPolicy(userId)` — the balanced baseline: attentionMode "balanced",
 *   exploration 0.2, novelty 0.2, socialInfluence 0.1, no objectives, and NO
 *   session-extension cap (frozen architecture: "The system does not silently
 *   optimize for maximum session length" — the field is absent, not zero).
 * - `validatePolicy(input)` — total validation of untrusted input returning
 *   the WFX-002 `ValidationResult` shape: every problem is reported, nothing
 *   is coerced. Objective weights and the three dials must be finite numbers
 *   in [0, 1]; objective ids must be unique non-empty strings; directions and
 *   attention modes must be members of the frozen vocabularies.
 * - `clampPolicy(p)` — bounds NUMERIC values into legal ranges and reports
 *   exactly what it clamped. Structural problems (non-object policy,
 *   non-array objectives, non-numeric fields) are NOT fixed here — they are
 *   validatePolicy's job; clampPolicy passes them through untouched rather
 *   than silently inventing data.
 */

import type { RecommendationPolicy } from "../contracts/frozen";
import { generateUlid } from "../ids";
import { type ValidationResult, isRecord, previewValue } from "../validation";
import { IntentError } from "./model";

/** Prefix for policy ids minted by this module (canonical ULID scheme). */
export const POLICY_ID_PREFIX = "wfxpol_";

/**
 * Mint a fresh policy id: `wfxpol_` + 26-char ULID (same canonical scheme as
 * ids.ts, which is off-limits for edits — see model.ts for the same pattern).
 * The frozen contract treats `RecommendationPolicy.id` as an opaque string;
 * this helper keeps the platform convention without touching ids.ts.
 */
export function newPolicyId(): string {
  return `${POLICY_ID_PREFIX}${generateUlid()}`;
}

/** Default exploration dial (balanced mode). */
export const DEFAULT_EXPLORATION = 0.2;
/** Default novelty dial (balanced mode). */
export const DEFAULT_NOVELTY = 0.2;
/** Default social-influence dial (balanced mode). */
export const DEFAULT_SOCIAL_INFLUENCE = 0.1;

/** Runtime mirror of the frozen attention-mode vocabulary. */
export const ATTENTION_MODES = [
  "mindful",
  "balanced",
  "immersive",
  "custom",
] as const satisfies readonly RecommendationPolicy["attentionMode"][];
type Covers<Union extends string, Values extends readonly string[]> = [Union] extends [
  Values[number],
]
  ? unknown
  : never;
const _attentionModesCover: Covers<RecommendationPolicy["attentionMode"], typeof ATTENTION_MODES> =
  null;

function isAttentionMode(value: unknown): value is RecommendationPolicy["attentionMode"] {
  return typeof value === "string" && (ATTENTION_MODES as readonly string[]).includes(value);
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * The balanced default policy for a user.
 *
 * attentionMode "balanced", exploration 0.2, novelty 0.2, socialInfluence 0.1,
 * no objectives, and no session-extension cap — `maxSessionExtensionMinutes`
 * is deliberately ABSENT (an absent cap differs semantically from a zero cap:
 * the frozen architecture forbids silently maximizing session length).
 * Throws `IntentError` (kind "invalid-input") on an empty userId.
 */
export function defaultPolicy(userId: string): RecommendationPolicy {
  const trimmed = typeof userId === "string" ? userId.trim() : "";
  if (trimmed.length === 0) {
    throw new IntentError(
      "invalid-input",
      `userId: expected a non-empty string, got ${previewValue(userId)}`,
    );
  }
  return {
    id: newPolicyId(),
    userId: trimmed,
    objectives: [],
    exploration: DEFAULT_EXPLORATION,
    novelty: DEFAULT_NOVELTY,
    socialInfluence: DEFAULT_SOCIAL_INFLUENCE,
    attentionMode: "balanced",
    // maxSessionExtensionMinutes intentionally omitted: no session-extension cap.
  };
}

/**
 * Validate untrusted input as a `RecommendationPolicy`.
 *
 * Checks (all problems are collected, never thrown):
 * - `id`, `userId`: non-empty strings,
 * - `objectives`: an array of objects with unique non-empty `id`, finite
 *   `weight` in [0, 1], and `direction` "maximize" | "minimize",
 * - `exploration`, `novelty`, `socialInfluence`: finite numbers in [0, 1],
 * - `attentionMode`: one of the four frozen modes,
 * - `maxSessionExtensionMinutes`: when present, a finite number >= 0.
 *
 * Objects with unknown extra fields are ACCEPTED (structural typing, forward
 * compatibility — same decision as validation.ts). On success the SAME
 * reference is returned as the typed value.
 */
export function validatePolicy(input: unknown): ValidationResult<RecommendationPolicy> {
  if (!isRecord(input)) {
    return { ok: false, errors: ["RecommendationPolicy: expected an object"] };
  }
  const errors: string[] = [];

  if (typeof input.id !== "string" || input.id.trim().length === 0) {
    errors.push(`id: expected a non-empty string, got ${previewValue(input.id)}`);
  }
  if (typeof input.userId !== "string" || input.userId.trim().length === 0) {
    errors.push(`userId: expected a non-empty string, got ${previewValue(input.userId)}`);
  }

  if (!Array.isArray(input.objectives)) {
    errors.push(`objectives: expected an array, got ${previewValue(input.objectives)}`);
  } else {
    const seen = new Set<string>();
    input.objectives.forEach((entry, index) => {
      if (!isRecord(entry)) {
        errors.push(`objectives[${index}]: expected an object, got ${previewValue(entry)}`);
        return;
      }
      if (typeof entry.id !== "string" || entry.id.trim().length === 0) {
        errors.push(
          `objectives[${index}].id: expected a non-empty string, got ${previewValue(entry.id)}`,
        );
      } else if (seen.has(entry.id)) {
        errors.push(`objectives[${index}].id: duplicate objective id "${entry.id}"`);
      } else {
        seen.add(entry.id);
      }
      if (!isUnitInterval(entry.weight)) {
        errors.push(
          `objectives[${index}].weight: expected a finite number in [0, 1], got ${previewValue(entry.weight)}`,
        );
      }
      if (entry.direction !== "maximize" && entry.direction !== "minimize") {
        errors.push(
          `objectives[${index}].direction: expected maximize | minimize, got ${previewValue(entry.direction)}`,
        );
      }
    });
  }

  if (!isUnitInterval(input.exploration)) {
    errors.push(`exploration: expected a finite number in [0, 1], got ${previewValue(input.exploration)}`);
  }
  if (!isUnitInterval(input.novelty)) {
    errors.push(`novelty: expected a finite number in [0, 1], got ${previewValue(input.novelty)}`);
  }
  if (!isUnitInterval(input.socialInfluence)) {
    errors.push(
      `socialInfluence: expected a finite number in [0, 1], got ${previewValue(input.socialInfluence)}`,
    );
  }
  if (!isAttentionMode(input.attentionMode)) {
    errors.push(
      `attentionMode: expected one of ${ATTENTION_MODES.join(" | ")}, got ${previewValue(input.attentionMode)}`,
    );
  }
  if (
    input.maxSessionExtensionMinutes !== undefined &&
    !(typeof input.maxSessionExtensionMinutes === "number" &&
      Number.isFinite(input.maxSessionExtensionMinutes) &&
      input.maxSessionExtensionMinutes >= 0)
  ) {
    errors.push(
      `maxSessionExtensionMinutes: expected a finite non-negative number when present, got ${previewValue(input.maxSessionExtensionMinutes)}`,
    );
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as unknown as RecommendationPolicy };
}

/** Result of `clampPolicy`: the bounded policy plus a record of every clamp. */
export interface PolicyClampResult {
  policy: RecommendationPolicy;
  /** One human-readable entry per clamped field; empty when input was already legal. */
  adjustments: string[];
}

/**
 * Bound a number into [0, 1]: NaN → 0 (no direction; replaced with the neutral
 * lower bound), +Infinity → 1, -Infinity → 0, otherwise clamped.
 */
function clampUnitInterval(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (!Number.isFinite(value)) return value > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, value));
}

function clampDial(field: string, value: number, adjustments: string[]): number {
  const to = clampUnitInterval(value);
  if (to !== value) adjustments.push(`${field}: ${value} -> ${to}`);
  return to;
}

/**
 * Bound a policy's NUMERIC values into legal ranges and report what changed:
 *
 * - `exploration`, `novelty`, `socialInfluence` → [0, 1],
 * - each objective `weight` → [0, 1],
 * - `maxSessionExtensionMinutes` → clamped up to 0 (a negative cap is
 *   meaningless; NaN becomes 0; +Infinity has no upper bound to violate and
 *   is kept).
 *
 * Non-numeric / structurally invalid values are passed through UNTOUCHED —
 * clampPolicy never invents data; use `validatePolicy` to detect them.
 * Returns a new policy (shallow-copied, objectives deep-copied); the input is
 * never mutated. Throws `IntentError` (kind "invalid-input") only when the
 * input is not an object at all (a typed caller cannot hit this).
 */
export function clampPolicy(p: RecommendationPolicy): PolicyClampResult {
  if (!isRecord(p)) {
    throw new IntentError("invalid-input", `policy: expected a RecommendationPolicy object, got ${previewValue(p)}`);
  }
  const adjustments: string[] = [];
  const policy: RecommendationPolicy = { ...p };

  policy.exploration = clampDial("exploration", p.exploration, adjustments);
  policy.novelty = clampDial("novelty", p.novelty, adjustments);
  policy.socialInfluence = clampDial("socialInfluence", p.socialInfluence, adjustments);

  if (Array.isArray(p.objectives)) {
    policy.objectives = p.objectives.map((entry, index) => {
      if (entry === null || typeof entry !== "object" || typeof entry.weight !== "number") {
        return entry; // structural problem: validatePolicy's job, not ours
      }
      const to = clampUnitInterval(entry.weight);
      if (to !== entry.weight) {
        adjustments.push(`objectives[${index}].weight: ${entry.weight} -> ${to}`);
      }
      return { ...entry, weight: to };
    });
  }

  if (typeof p.maxSessionExtensionMinutes === "number") {
    const to = Number.isNaN(p.maxSessionExtensionMinutes)
      ? 0
      : Math.max(0, p.maxSessionExtensionMinutes);
    if (to !== p.maxSessionExtensionMinutes) {
      adjustments.push(`maxSessionExtensionMinutes: ${p.maxSessionExtensionMinutes} -> ${to}`);
    }
    policy.maxSessionExtensionMinutes = to;
  }

  return { policy, adjustments };
}
