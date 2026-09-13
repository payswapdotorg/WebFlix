/**
 * Intent Graph entities (WFX-011, Lane A — intelligence).
 *
 * The frozen contracts (docs/architecture/contracts.md — "Intent Graph") define
 * `UserIntent` (scope | objective | weight | confidence | provenance | expiry)
 * and the five scopes: persistent | temporary | session | momentary | social.
 * The scopes are the law — this module never invents new ones. `INTENT_SCOPES`
 * mirrors the frozen union at runtime and its compile-time `Covers` check fails
 * if the frozen union drifts, so vocabulary drift between frozen.ts and this
 * table is a compile error (same technique as validation.ts).
 *
 * `IntentRecord` extends the frozen `UserIntent` with the bookkeeping the store
 * needs: creation / update / last-reinforcement timestamps and an evidence
 * counter. `IntentSnapshot` is a point-in-time view of the user's active
 * (non-expired) intents.
 *
 * ID branding: the canonical `wfxint_` scheme (branded type + guard + factory)
 * already ships in ids.ts (WFX-002). ids.ts is off-limits for edits, and minting
 * a *second*, distinct `IntentId` brand here would create ambiguous duplicate
 * star-exports in src/index.ts (silently shadowing the canonical type). The
 * intent module therefore adopts the canonical binding by re-export — same
 * binding, unambiguous — and narrows `IntentRecord.id` to the branded type.
 */

import type { IntentScope, UserIntent } from "../contracts/frozen";
import { type IntentId } from "../ids";

// Canonical `wfxint_` intent-ID helpers, adopted from ids.ts (see header).
export { type IntentId, isIntentId, newIntentId, INTENT_ID_PREFIX } from "../ids";

/** Maximum length of a stored objective string, counted after trimming. */
export const INTENT_OBJECTIVE_MAX_LENGTH = 200;

/** Compile-time check that `Values` covers every member of the frozen `Union`. */
type Covers<Union extends string, Values extends readonly string[]> = [Union] extends [
  Values[number],
]
  ? unknown
  : never;

/** Runtime mirror of the frozen `IntentScope` union (the law: exactly five scopes). */
export const INTENT_SCOPES = [
  "persistent",
  "temporary",
  "session",
  "momentary",
  "social",
] as const satisfies readonly IntentScope[];
const _intentScopesCover: Covers<IntentScope, typeof INTENT_SCOPES> = null;

/** Runtime mirror of the frozen intent provenance union. */
export const INTENT_PROVENANCES = [
  "explicit",
  "inferred",
  "imported",
] as const satisfies readonly UserIntent["provenance"][];
const _intentProvenancesCover: Covers<UserIntent["provenance"], typeof INTENT_PROVENANCES> =
  null;

/** Structural guard: is this unknown value one of the frozen intent scopes? */
export function isIntentScope(value: unknown): value is IntentScope {
  return typeof value === "string" && (INTENT_SCOPES as readonly string[]).includes(value);
}

/** Structural guard: is this unknown value one of the frozen provenances? */
export function isIntentProvenance(value: unknown): value is UserIntent["provenance"] {
  return typeof value === "string" && (INTENT_PROVENANCES as readonly string[]).includes(value);
}

/**
 * A stored intent: the frozen `UserIntent` plus store bookkeeping.
 *
 * - `id` is narrowed to the canonical `wfxint_`-branded `IntentId`.
 * - `lastReinforcedAt` is the anchor time for weight decay (see store.ts).
 * - `evidenceCount` counts the distinct signals that created/reinforced the
 *   intent (1 on creation, +1 per reinforcement).
 */
export interface IntentRecord extends UserIntent {
  /** Canonical intent identity: `wfxint_` prefix + 26-char ULID body (see ids.ts). */
  id: IntentId;
  /** ISO 8601 creation instant. */
  createdAt: string;
  /** ISO 8601 instant of the last mutation (create, reinforcement, decay, expiry). */
  updatedAt: string;
  /** ISO 8601 instant of the last reinforcing evidence; the decay anchor. */
  lastReinforcedAt: string;
  /** How many distinct evidence signals have fed this intent (always >= 1). */
  evidenceCount: number;
}

/**
 * A point-in-time view of one user's active intents.
 *
 * `active` contains the user's intents that are not expired at `takenAt`
 * (momentary intents older than 1h are additionally excluded — see store.ts).
 * Weights are the STORED weights at view time: decay is an explicit store
 * operation (`IntentGraph.decay`), snapshots never mutate or recompute weights.
 */
export interface IntentSnapshot {
  userId: string;
  /** ISO 8601 instant the snapshot was taken. */
  takenAt: string;
  /** Active intents at `takenAt`, heaviest first (id ascending as tiebreak). */
  active: IntentRecord[];
}

/** Typed failure kinds produced by the intent module. */
export type IntentErrorKind =
  /** Caller-supplied data violated a documented invariant. */
  | "invalid-input"
  /** A referenced intent does not exist in this graph. */
  | "not-found";

/**
 * Typed error thrown by intent-module operations on bad input (and by
 * `expire` on unknown ids). Failures are explicit and structured — the error
 * carries a machine-readable `kind` plus field-level `details`; there are no
 * silent coercion or fake-success paths.
 */
export class IntentError extends Error {
  readonly kind: IntentErrorKind;
  /** Field-level problem descriptions (at least one). */
  readonly details: readonly string[];

  constructor(kind: IntentErrorKind, details: string | readonly string[]) {
    const list = typeof details === "string" ? [details] : details;
    super(`IntentError (${kind}): ${list.join("; ")}`);
    this.name = "IntentError";
    this.kind = kind;
    this.details = list;
  }
}
