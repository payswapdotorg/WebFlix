/**
 * Evidence-based intent inference (WFX-011, Lane A).
 *
 * ANTI-TUNNEL-VISION LAW (frozen architecture, "Recommendation principles"):
 * "A single watched topic must never permanently narrow the user profile."
 * This module guards it by construction: `inferFromEvents` is a PURE function
 * that only ever PRODUCES additive evidence. Every output is an `IntentUpdate`
 * meant to be applied through `IntentGraph.record()`, which can only create
 * or reinforce. Inference never deletes an intent, never down-ranks one, and
 * never narrows the profile — there is no code path in this module that could.
 *
 * Signal strengths (frozen product invariant #1: "User intent is primary. A
 * recent watch is one signal, not a permanent identity"):
 *   - complete → weight +0.05, confidence +0.05  (a watch is ONE weak signal)
 *   - like / save / search → weight +0.15, confidence +0.15 (explicit engagement)
 *
 * Scope routing: a `search` is the in-session signal — the user is actively
 * expressing what they want right now — so it infers SESSION scope. `like`,
 * `save`, and `complete` are durable evidence and infer TEMPORARY scope.
 *
 * Objectives:
 *   - search with a usable `payload.query` (non-empty after trimming) → the
 *     trimmed query, capped at INTENT_OBJECTIVE_MAX_LENGTH so updates always
 *     satisfy the store invariant.
 *   - otherwise → the synthetic objective `item:<itemId>` (the frozen
 *     EntertainmentEvent carries no topic taxonomy yet; synthetic item
 *     objectives are deterministic and collision-free, and they will be
 *     replaced by graph-derived topics when the Entertainment Graph lane
 *     ships them).
 *
 * Events are validated with the WFX-02 validators (`validateEntertainmentEvent`)
 * and must all belong to the target user — foreign events are a caller bug and
 * fail loudly with a typed `IntentError`, never a silent skip. Event types that
 * are not intent evidence (impression, start, progress, skip, dislike, share)
 * are explicitly ignored: they are perfectly valid events, just not signals
 * about intent (dislike is a POLICY objective, not an intent, per WFX-011
 * scope). Duplicate handling of the identical event twice is the caller's
 * responsibility (the frozen event has no identity; envelopes do).
 */

import type { EntertainmentEvent, IntentScope } from "../contracts/frozen";
import { previewValue, validateEntertainmentEvent } from "../validation";
import { INTENT_OBJECTIVE_MAX_LENGTH, IntentError } from "./model";
import type { IntentRecordInput } from "./store";

/** Event types that are intent evidence. Every other event type is ignored. */
export type IntentSignalEvent = "search" | "like" | "save" | "complete";

/** Structural guard for `IntentSignalEvent` (no casts needed at call sites). */
export function isIntentSignalEvent(value: unknown): value is IntentSignalEvent {
  return (
    value === "search" || value === "like" || value === "save" || value === "complete"
  );
}

/**
 * Weight contributed by a `complete` event. Deliberately LOWER than explicit
 * signals: a watch is one signal, not an identity.
 */
export const COMPLETE_WEIGHT_BUMP = 0.05;
/** Confidence contributed by a `complete` event. */
export const COMPLETE_CONFIDENCE_BUMP = 0.05;
/** Weight contributed by like / save / search events (explicit engagement). */
export const EXPLICIT_SIGNAL_WEIGHT_BUMP = 0.15;
/** Confidence contributed by like / save / search events. */
export const EXPLICIT_SIGNAL_CONFIDENCE_BUMP = 0.15;

/** Prefix of synthetic item-derived objectives: `item:<entertainmentItemId>`. */
export const ITEM_OBJECTIVE_PREFIX = "item:";

interface SignalProfile {
  scope: IntentScope;
  weight: number;
  confidence: number;
}

/** Signal routing table: event type → scope + evidence strength. */
const SIGNAL_PROFILES: Readonly<Record<IntentSignalEvent, SignalProfile>> = {
  search: { scope: "session", weight: EXPLICIT_SIGNAL_WEIGHT_BUMP, confidence: EXPLICIT_SIGNAL_CONFIDENCE_BUMP },
  like: { scope: "temporary", weight: EXPLICIT_SIGNAL_WEIGHT_BUMP, confidence: EXPLICIT_SIGNAL_CONFIDENCE_BUMP },
  save: { scope: "temporary", weight: EXPLICIT_SIGNAL_WEIGHT_BUMP, confidence: EXPLICIT_SIGNAL_CONFIDENCE_BUMP },
  complete: { scope: "temporary", weight: COMPLETE_WEIGHT_BUMP, confidence: COMPLETE_CONFIDENCE_BUMP },
};

/**
 * One inferred intent change — additive evidence, ready to be applied with
 * `IntentGraph.record(update)` (the interface is structurally compatible with
 * `IntentRecordInput`, which the type-level assertion at the bottom of this
 * file proves at compile time).
 */
export interface IntentUpdate {
  userId: string;
  scope: IntentScope;
  objective: string;
  /** Weight contribution of this evidence signal (bump, in [0, 1]). */
  weight: number;
  /** Confidence contribution of this evidence signal (bump, in [0, 1]). */
  confidence: number;
  provenance: "inferred";
  /** ISO 8601 instant the evidence was processed into this update. */
  inferredAt: string;
  /** The event type that produced this update. */
  signal: IntentSignalEvent;
}

function toIso(now: number): string {
  return new Date(now).toISOString();
}

/** Objective for one evidence event: the search query, else `item:<itemId>`. */
function objectiveForEvent(event: EntertainmentEvent): string {
  if (event.type === "search") {
    const query = event.payload?.["query"];
    if (typeof query === "string" && query.trim().length > 0) {
      // Cap so inferred updates always satisfy the store objective invariant.
      return query.trim().slice(0, INTENT_OBJECTIVE_MAX_LENGTH);
    }
  }
  return `${ITEM_OBJECTIVE_PREFIX}${event.itemId}`;
}

/**
 * Infer intent updates from entertainment events (pure — touches no store).
 *
 * Each search / like / save / complete event yields exactly one additive
 * `IntentUpdate` with `provenance: "inferred"`; other event types yield none.
 * Events are validated (WFX-002 validators) and must belong to `userId`.
 *
 * Throws `IntentError` (kind "invalid-input", aggregated details) when:
 * - `userId` is not a non-empty string,
 * - `now` is not a finite non-negative epoch-milliseconds number,
 * - `events` is not an array, or any entry fails `validateEntertainmentEvent`,
 * - any event's `userId` differs from the target `userId`.
 *
 * The caller applies updates with `IntentGraph.record` — which can only add
 * or reinforce. Inference can never remove or down-rank intents.
 */
export function inferFromEvents(
  userId: string,
  events: readonly EntertainmentEvent[],
  now: number,
): IntentUpdate[] {
  const trimmedUserId = typeof userId === "string" ? userId.trim() : "";
  if (trimmedUserId.length === 0) {
    throw new IntentError(
      "invalid-input",
      `userId: expected a non-empty string, got ${previewValue(userId)}`,
    );
  }
  if (typeof now !== "number" || !Number.isFinite(now) || now < 0) {
    throw new IntentError(
      "invalid-input",
      `now: expected a finite non-negative epoch-milliseconds number, got ${previewValue(now)}`,
    );
  }
  if (!Array.isArray(events)) {
    throw new IntentError(
      "invalid-input",
      `events: expected an array of EntertainmentEvent, got ${previewValue(events)}`,
    );
  }

  const updates: IntentUpdate[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const checked = validateEntertainmentEvent(events[index]);
    if (!checked.ok) {
      throw new IntentError(
        "invalid-input",
        checked.errors.map((message) => `events[${index}]: ${message}`),
      );
    }
    const event = checked.value;
    if (event.userId.trim() !== trimmedUserId) {
      throw new IntentError(
        "invalid-input",
        `events[${index}]: userId "${event.userId}" does not match the inference target "${trimmedUserId}"`,
      );
    }
    if (!isIntentSignalEvent(event.type)) continue; // valid event, not intent evidence
    const profile = SIGNAL_PROFILES[event.type];
    updates.push({
      userId: trimmedUserId,
      scope: profile.scope,
      objective: objectiveForEvent(event),
      weight: profile.weight,
      confidence: profile.confidence,
      provenance: "inferred",
      inferredAt: toIso(now),
      signal: event.type,
    });
  }
  return updates;
}

/** Compile-time proof that every IntentUpdate is directly recordable in the store. */
type AssertIntentRecordable<T extends IntentRecordInput> = T;
type _IntentUpdateIsRecordable = AssertIntentRecordable<IntentUpdate>;
