/**
 * Recommendation OS — repetition & fatigue signals (WFX-021, Lane A).
 *
 * Typed, pure, deterministic signals derived from `recentEvents`:
 *
 * - `repetitionCount` — how many repetition events (start / progress /
 *   complete / skip, see events.ts routing) the user has for the item.
 * - `fatigue` — repetition × recency decay: the sum over the item's
 *   repetition events of `1 / (1 + ageDays)` where ageDays is measured
 *   against the session anchor (the latest event instant). Recent repeats
 *   weigh ~1; a repeat 30 days old weighs 1/31; the anchor itself is an
 *   event instant, never a hidden clock.
 *
 * MONOTONICITY LAW (tested): adding one more repetition event for an item,
 * all else equal, STRICTLY increases the item's fatigue — every event
 * contributes a positive weight — and therefore lowers the item's rank
 * under the shipped heuristic model (fatigue enters the score negatively
 * and is never clamped, so the law holds without saturation). A single
 * watched topic never permanently narrows the profile: fatigue decays with
 * age and the pool is never narrowed (diversity/composition reorder only).
 *
 * Anchor handling: when `anchorAt` is null (no events at all — the only
 * case, since the anchor is derived FROM events) there can be no repetition
 * events and fatigue is 0; defensive callers passing an explicit null
 * anchor get weight 1 per event (no decay possible — recorded behavior,
 * never a guess).
 */

import type { EntertainmentEvent } from "@wfx/domain";

import { eventEpochMs, repetitionEventsFor } from "./events";

/** One day in milliseconds (the recency-decay time unit). */
export const DAY_MS = 86_400_000;

/** The typed repetition/fatigue signal for one item. */
export interface RepetitionSignal {
  /** The item the signal describes. */
  itemId: string;
  /** Count of repetition events (start/progress/complete/skip) in recentEvents. */
  repetitionCount: number;
  /**
   * Recency-weighted repetition: sum over repetition events of
   * `1 / (1 + ageDays)`. Strictly increases with each additional repeat.
   */
  fatigue: number;
  /** Per-event audit trail: age (days) and weight that fed the fatigue sum. */
  contributions: readonly { occurredAt: string; ageDays: number; weight: number }[];
}

/**
 * Compute the repetition/fatigue signal for one item.
 *
 * Pure: a function of (itemId, events, anchorAt) alone. Events for other
 * items are ignored; ages are measured against `anchorAt` (an ISO 8601
 * instant derived from the events themselves — pass the ctx anchor).
 */
export function repetitionSignal(
  itemId: string,
  events: readonly EntertainmentEvent[],
  anchorAt: string | null,
): RepetitionSignal {
  const repetitionEvents = repetitionEventsFor(itemId, events);
  const anchorEpoch = anchorAt === null ? null : Date.parse(anchorAt);

  const contributions: { occurredAt: string; ageDays: number; weight: number }[] = [];
  let fatigue = 0;
  for (const event of repetitionEvents) {
    const ageMs =
      anchorEpoch === null ? 0 : Math.max(0, anchorEpoch - eventEpochMs(event));
    const ageDays = ageMs / DAY_MS;
    const weight = 1 / (1 + ageDays);
    fatigue += weight;
    contributions.push({ occurredAt: event.occurredAt, ageDays, weight });
  }

  return {
    itemId,
    repetitionCount: repetitionEvents.length,
    fatigue,
    contributions: Object.freeze(contributions),
  };
}
