/**
 * IntentGraph — the in-memory Intent Graph store (WFX-011, Lane A).
 *
 * Semantics (all lead-visible, all enforced):
 *
 * - Identity / dedup: an intent is keyed by the triple
 *   (userId, scope, objective) with `userId` and `objective` stored TRIMMED.
 *   `record` therefore creates on first sight and REINFORCES on repeat — the
 *   same triple never produces a second row. The same objective under a
 *   different scope is a DIFFERENT intent (scopes are part of identity).
 * - Reinforcement bumps `weight` / `confidence` (clamped at 1), increments
 *   `evidenceCount`, and restamps `lastReinforcedAt` / `updatedAt`. Origin
 *   provenance is never rewritten by reinforcement. A caller-supplied
 *   `expiresAt` extends an existing expiry to the LATER of old and new.
 * - Time decay: `decay(now)` applies exponential half-life decay to WEIGHTS
 *   (confidence is never decayed) for momentary (30m), session (8h), and
 *   temporary (72h) scopes. Persistent and social intents are immune by law.
 *   Decay is computed from a stored per-record anchor (weight at
 *   `lastReinforcedAt`), so repeated `decay(t)` calls with the same `t` are
 *   idempotent and decay can never INCREASE a weight (time travel safe).
 * - Liveness: `snapshot(userId, now)` returns only intents that are not
 *   expired (`expiresAt <= now` counts as expired) and — for the momentary
 *   scope only — not older than 1h since `lastReinforcedAt` (exactly 1h is
 *   still active; "older than 1h" is strict). Snapshot weights are the stored
 *   weights: call `decay(now)` first for time-consistent views. Momentary
 *   staleness (liveness) is deliberately separate from momentary decay
 *   (weight): 30m half-life fades the pull, 1h staleness removes it from the
 *   active view entirely.
 * - ANTI-TUNNEL-VISION LAW (frozen architecture): "A single watched topic must
 *   never permanently narrow the user profile." This store exposes no
 *   inference-driven delete or down-rank path: `record` only creates or
 *   reinforces, `decay` is time-based only, and `expire` is an explicit caller
 *   action. Weight decreases are therefore possible ONLY through the passage
 *   of time or explicit expiry — never through new evidence.
 * - Failure model: malformed input throws a typed `IntentError` (kind
 *   "invalid-input") with aggregated field-level details; `expire` on an
 *   unknown id throws kind "not-found". Read APIs return frozen defensive
 *   copies — mutating a returned record or snapshot cannot corrupt the store.
 * - In-memory, single-process, no I/O, no persistence, no dependencies
 *   (WFX-011 is Lane A pure domain logic).
 */

import type { IntentScope, UserIntent } from "../contracts/frozen";
import { type IntentId, isIntentId, newIntentId } from "../ids";
import { isIso8601, isRecord, previewValue } from "../validation";
import {
  INTENT_OBJECTIVE_MAX_LENGTH,
  INTENT_PROVENANCES,
  INTENT_SCOPES,
  IntentError,
  isIntentProvenance,
  isIntentScope,
  type IntentRecord,
  type IntentSnapshot,
} from "./model";

/** Initial weight for a created intent when the input omits `weight`. */
export const DEFAULT_INTENT_WEIGHT = 0.5;
/** Initial confidence for a created intent when the input omits `confidence`. */
export const DEFAULT_INTENT_CONFIDENCE = 0.5;
/** Weight added on reinforcement when the input omits `weight`. */
export const DEFAULT_REINFORCE_WEIGHT = 0.1;
/** Confidence added on reinforcement when the input omits `confidence`. */
export const DEFAULT_REINFORCE_CONFIDENCE = 0.1;

/**
 * Weight half-life per scope, in epoch milliseconds. `null` means the scope
 * NEVER decays (persistent interests and social intents are immune by law).
 */
export const INTENT_HALF_LIFE_MS: Readonly<Record<IntentScope, number | null>> = {
  momentary: 30 * 60 * 1000, // 30 minutes
  session: 8 * 60 * 60 * 1000, // 8 hours
  temporary: 72 * 60 * 60 * 1000, // 72 hours
  persistent: null, // no decay
  social: null, // no decay
};

/** Momentary intents whose last reinforcement is older than this are excluded from snapshots. */
export const MOMENTARY_STALE_MS = 60 * 60 * 1000; // 1 hour

/** Typed input for `IntentGraph.record` — create or reinforce an intent. */
export interface IntentRecordInput {
  userId: string;
  scope: IntentScope;
  /** Freeform objective; trimmed on storage, must be non-empty and <= 200 chars. */
  objective: string;
  /** Evidence weight in [0, 1]: the record's initial weight on create, the bump on reinforce. */
  weight?: number;
  /** Evidence confidence in [0, 1]: the record's initial confidence on create, the bump on reinforce. */
  confidence?: number;
  /** ISO 8601 expiry; on reinforcement the LATER of old and new wins. */
  expiresAt?: string;
  /** Origin of the intent; defaults to "explicit" for direct calls. */
  provenance?: UserIntent["provenance"];
}

/** Internal stored intent: the public record plus the decay anchor weight. */
interface StoredIntent {
  record: IntentRecord;
  /** Weight as of `record.lastReinforcedAt`; decay is recomputed from this anchor (idempotent). */
  decayBaseWeight: number;
}

function toIso(now: number): string {
  return new Date(now).toISOString();
}

/** Frozen shallow copy — public reads never hand out live references. */
function copyOf(record: IntentRecord): IntentRecord {
  return Object.freeze({ ...record });
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function assertNow(now: unknown, field: string): void {
  if (typeof now !== "number" || !Number.isFinite(now) || now < 0) {
    throw new IntentError(
      "invalid-input",
      `${field}: expected a finite non-negative epoch-milliseconds number, got ${previewValue(now)}`,
    );
  }
}

/** Validate and normalize a userId argument; returns the trimmed userId. */
function assertUserId(userId: unknown): string {
  if (typeof userId !== "string" || userId.trim().length === 0) {
    throw new IntentError(
      "invalid-input",
      `userId: expected a non-empty string, got ${previewValue(userId)}`,
    );
  }
  return userId.trim();
}

function assertIntentId(id: unknown): void {
  if (!isIntentId(id)) {
    throw new IntentError(
      "invalid-input",
      `id: expected an intent ID (wfxint_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(id)}`,
    );
  }
}

/** Dedup key for the (userId, scope, objective) identity triple. */
function dedupKey(userId: string, scope: IntentScope, objective: string): string {
  return JSON.stringify([userId, scope, objective]);
}

/** Liveness at instant `now`: not expired, and (momentary only) not stale. */
function isActive(record: IntentRecord, now: number): boolean {
  if (record.expiresAt !== undefined && Date.parse(record.expiresAt) <= now) return false;
  if (
    record.scope === "momentary" &&
    now - Date.parse(record.lastReinforcedAt) > MOMENTARY_STALE_MS
  ) {
    return false;
  }
  return true;
}

/**
 * The in-memory Intent Graph.
 *
 * Create with `new IntentGraph()`. All timestamps are ISO 8601 UTC; `now`
 * arguments are epoch milliseconds. All reads return frozen copies.
 */
export class IntentGraph {
  /** All stored intents by canonical id. */
  private readonly byId = new Map<IntentId, StoredIntent>();
  /** Same `StoredIntent` objects indexed by identity triple (create-or-reinforce lookup). */
  private readonly byKey = new Map<string, StoredIntent>();

  /**
   * Record an intent: create it, or reinforce the existing intent with the
   * same (userId, scope, objective). Returns a frozen copy of the stored
   * record. Throws `IntentError` (kind "invalid-input", aggregated details)
   * on malformed input.
   */
  record(input: IntentRecordInput): IntentRecord {
    if (!isRecord(input)) {
      throw new IntentError(
        "invalid-input",
        `input: expected an IntentRecordInput object, got ${previewValue(input)}`,
      );
    }
    const errors: string[] = [];

    const userId = typeof input.userId === "string" ? input.userId.trim() : "";
    if (userId.length === 0) {
      errors.push(`userId: expected a non-empty string, got ${previewValue(input.userId)}`);
    }

    if (!isIntentScope(input.scope)) {
      errors.push(`scope: expected one of ${INTENT_SCOPES.join(" | ")}, got ${previewValue(input.scope)}`);
    }

    const objective = typeof input.objective === "string" ? input.objective.trim() : "";
    if (objective.length === 0) {
      errors.push(
        `objective: expected a non-empty string after trimming, got ${previewValue(input.objective)}`,
      );
    } else if (objective.length > INTENT_OBJECTIVE_MAX_LENGTH) {
      errors.push(
        `objective: expected at most ${INTENT_OBJECTIVE_MAX_LENGTH} characters after trimming, got ${objective.length}`,
      );
    }

    if (input.weight !== undefined && !isUnitInterval(input.weight)) {
      errors.push(`weight: expected a finite number in [0, 1], got ${previewValue(input.weight)}`);
    }
    if (input.confidence !== undefined && !isUnitInterval(input.confidence)) {
      errors.push(
        `confidence: expected a finite number in [0, 1], got ${previewValue(input.confidence)}`,
      );
    }
    if (input.expiresAt !== undefined && !isIso8601(input.expiresAt)) {
      errors.push(
        `expiresAt: expected an ISO 8601 datetime string with explicit offset (e.g. 2026-09-13T10:30:00.000Z), got ${previewValue(input.expiresAt)}`,
      );
    }
    if (input.provenance !== undefined && !isIntentProvenance(input.provenance)) {
      errors.push(
        `provenance: expected one of ${INTENT_PROVENANCES.join(" | ")}, got ${previewValue(input.provenance)}`,
      );
    }

    if (errors.length > 0) throw new IntentError("invalid-input", errors);

    const now = Date.now();
    const key = dedupKey(userId, input.scope, objective);
    const existing = this.byKey.get(key);

    if (existing !== undefined) {
      const record = existing.record;
      const weightBump = input.weight ?? DEFAULT_REINFORCE_WEIGHT;
      const confidenceBump = input.confidence ?? DEFAULT_REINFORCE_CONFIDENCE;
      record.weight = Math.min(1, record.weight + weightBump);
      record.confidence = Math.min(1, record.confidence + confidenceBump);
      record.evidenceCount += 1;
      record.lastReinforcedAt = toIso(now);
      record.updatedAt = toIso(now);
      if (input.expiresAt !== undefined) {
        // Reinforcement is evidence the intent is still live: keep the LATER expiry.
        record.expiresAt =
          record.expiresAt !== undefined && Date.parse(record.expiresAt) > Date.parse(input.expiresAt)
            ? record.expiresAt
            : input.expiresAt;
      }
      existing.decayBaseWeight = record.weight; // reinforcement resets the decay anchor
      return copyOf(record);
    }

    const id = newIntentId();
    const record: IntentRecord = {
      id,
      userId,
      scope: input.scope,
      objective,
      weight: input.weight ?? DEFAULT_INTENT_WEIGHT,
      confidence: input.confidence ?? DEFAULT_INTENT_CONFIDENCE,
      provenance: input.provenance ?? "explicit",
      createdAt: toIso(now),
      updatedAt: toIso(now),
      lastReinforcedAt: toIso(now),
      evidenceCount: 1,
    };
    if (input.expiresAt !== undefined) record.expiresAt = input.expiresAt;

    const stored: StoredIntent = { record, decayBaseWeight: record.weight };
    this.byId.set(id, stored);
    this.byKey.set(key, stored);
    return copyOf(record);
  }

  /**
   * Fetch one intent by canonical id. Returns a frozen copy, or `undefined`
   * when no such intent exists (a query, not an error). Malformed ids throw
   * `IntentError` (kind "invalid-input").
   */
  get(id: IntentId): IntentRecord | undefined {
    assertIntentId(id);
    const stored = this.byId.get(id);
    return stored === undefined ? undefined : copyOf(stored.record);
  }

  /**
   * All intents for a user (including expired and stale ones), in creation
   * order. Returns frozen copies. Empty userId throws `IntentError`
   * (kind "invalid-input").
   */
  list(userId: string): IntentRecord[] {
    const trimmed = assertUserId(userId);
    const out: IntentRecord[] = [];
    for (const stored of this.byId.values()) {
      if (stored.record.userId === trimmed) out.push(copyOf(stored.record));
    }
    return out;
  }

  /**
   * Expire an intent immediately: sets `expiresAt` to `now` (defaults to the
   * current wall clock; pass an explicit epoch-ms `now` for determinism).
   * Returns the updated record. Unknown ids throw `IntentError` (kind
   * "not-found"); malformed ids throw kind "invalid-input". Expiry is an
   * explicit caller action — never an inference side effect.
   */
  expire(id: IntentId, now?: number): IntentRecord {
    assertIntentId(id);
    if (now !== undefined) assertNow(now, "now");
    const stored = this.byId.get(id);
    if (stored === undefined) {
      throw new IntentError("not-found", `intent ${id} does not exist in this graph`);
    }
    const at = now ?? Date.now();
    stored.record.expiresAt = toIso(at);
    stored.record.updatedAt = toIso(at);
    return copyOf(stored.record);
  }

  /**
   * Apply time decay to the WEIGHTS of momentary, session, and temporary
   * intents (half-life table `INTENT_HALF_LIFE_MS`; persistent and social are
   * immune). Confidence is never decayed. Decay is anchored at each record's
   * `lastReinforcedAt`, so calling `decay(t)` repeatedly at the same `t` is
   * idempotent and decay never increases a weight. Returns the number of
   * records whose weight changed. Invalid `now` throws `IntentError`
   * (kind "invalid-input").
   */
  decay(now: number): number {
    assertNow(now, "now");
    let decayed = 0;
    for (const stored of this.byId.values()) {
      const halfLife = INTENT_HALF_LIFE_MS[stored.record.scope];
      if (halfLife === null) continue; // persistent & social: immune by law
      const elapsed = Math.max(0, now - Date.parse(stored.record.lastReinforcedAt));
      const factor = Math.pow(2, -elapsed / halfLife);
      // min() guards time travel: decay can never restore or increase a weight.
      const next = Math.min(stored.record.weight, stored.decayBaseWeight * factor);
      if (next !== stored.record.weight) {
        stored.record.weight = next;
        stored.record.updatedAt = toIso(now);
        decayed += 1;
      }
    }
    return decayed;
  }

  /**
   * Point-in-time view of the user's active intents at `now`: not expired
   * (`expiresAt <= now` is expired) and — momentary scope only — last
   * reinforced within the last hour. Ordered heaviest-first (weight desc,
   * id asc as tiebreak). Weights are the STORED weights (run `decay(now)`
   * first for time-consistent weights). Returns a frozen snapshot. Invalid
   * arguments throw `IntentError` (kind "invalid-input").
   */
  snapshot(userId: string, now: number): IntentSnapshot {
    const trimmed = assertUserId(userId);
    assertNow(now, "now");
    const active = this.list(trimmed).filter((record) => isActive(record, now));
    active.sort(
      (a, b) => b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    // `active` is a fresh, snapshot-private array of frozen records; freezing the
    // snapshot object itself blocks reassignment of every field.
    const snapshot: IntentSnapshot = {
      userId: trimmed,
      takenAt: toIso(now),
      active,
    };
    return Object.freeze(snapshot);
  }
}
