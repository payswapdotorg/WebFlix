/**
 * Recommendation OS — event-derived signals (WFX-021, Lane A).
 *
 * Every temporal signal the OS uses is derived from the ctx's own
 * `recentEvents` — there is NO hidden clock anywhere in the OS. The time
 * anchor ("session now") is the LATEST event occurrence instant; all ages
 * and recency weights are measured against it, so identical ctx always
 * yields identical signals.
 *
 * Event-type routing (documented, deterministic):
 * - `impression` — passive exposure: never a repetition, never a "seen"
 *   signal for exploration, never an anchor for resume/continuation.
 * - `search` / `like` / `dislike` / `save` / `share` — engagement: mark the
 *   item as SEEN (no exploration bonus), but are not consumption.
 * - `start` / `progress` / `complete` / `skip` — consumption: repetition and
 *   fatigue signals; start/progress/complete additionally mark an item as a
 *   consumed anchor (what the user actually watched).
 * - `skip` is deliberately NOT an anchor: a skipped item must not trigger
 *   "next episode" chaining, but it DOES count as a repeat (the user has
 *   seen and rejected it — repetition breeds fatigue).
 *
 * Resume detection (recency rule, deterministic): an item is in progress iff
 * its latest start/progress instant is STRICTLY NEWER than its latest
 * complete instant (absent complete = -infinity). Re-watching after a
 * complete (a newer start) correctly flips the item back to in-progress.
 */

import type { EntertainmentEvent } from "@wfx/domain";

/** Event types that count as a repetition (repetition/fatigue signals). */
export const REPETITION_EVENT_TYPES: readonly EntertainmentEvent["type"][] = [
  "start",
  "progress",
  "complete",
  "skip",
];

/** Event types that mark an item as a consumed (watched) anchor. */
export const CONSUMPTION_EVENT_TYPES: readonly EntertainmentEvent["type"][] = [
  "start",
  "progress",
  "complete",
];

/** Structural guard: is this event type a repetition signal? */
export function isRepetitionEventType(
  value: EntertainmentEvent["type"],
): boolean {
  return (REPETITION_EVENT_TYPES as readonly string[]).includes(value);
}

/** Structural guard: is this event type a consumption anchor? */
export function isConsumptionEventType(
  value: EntertainmentEvent["type"],
): boolean {
  return (CONSUMPTION_EVENT_TYPES as readonly string[]).includes(value);
}

/** Parse an event's occurrence instant into epoch milliseconds. */
export function eventEpochMs(event: EntertainmentEvent): number {
  return Date.parse(event.occurredAt);
}

/**
 * The session time anchor: the occurrence instant of the LATEST event
 * (maximum epoch). Ties are broken by later array position (deterministic).
 * Returns null when there are no events — the OS then treats every temporal
 * feature as neutral (recorded in the trace, never guessed).
 */
export function anchorEpochOf(events: readonly EntertainmentEvent[]): number | null {
  let best: number | null = null;
  for (const event of events) {
    const epoch = eventEpochMs(event);
    if (best === null || epoch >= best) best = epoch;
  }
  return best;
}

/**
 * The ISO 8601 string of the anchoring (latest) event, or null when there
 * are no events. Mirrors `anchorEpochOf` — the anchor event's own string.
 */
export function anchorIsoOf(events: readonly EntertainmentEvent[]): string | null {
  let bestEpoch: number | null = null;
  let bestIso: string | null = null;
  for (const event of events) {
    const epoch = eventEpochMs(event);
    if (bestEpoch === null || epoch >= bestEpoch) {
      bestEpoch = epoch;
      bestIso = event.occurredAt;
    }
  }
  return bestIso;
}

/**
 * Items the user has ENGAGED with (any non-impression event): these are
 * "seen" — they lose the exploration-unseen bonus. Impressions do not count
 * (a card being rendered is not the user seeing content).
 */
export function seenItemIds(events: readonly EntertainmentEvent[]): ReadonlySet<string> {
  const seen = new Set<string>();
  for (const event of events) {
    if (event.type !== "impression") seen.add(event.itemId);
  }
  return seen;
}

/**
 * Items the user actually consumed (start/progress/complete): legitimate
 * anchors for resume ordering and next-episode continuation.
 */
export function consumedItemIds(events: readonly EntertainmentEvent[]): ReadonlySet<string> {
  const consumed = new Set<string>();
  for (const event of events) {
    if (isConsumptionEventType(event.type)) consumed.add(event.itemId);
  }
  return consumed;
}

/**
 * Items with an in-progress watch: latest start/progress strictly newer than
 * the latest complete (see module header for the recency rule).
 */
export function inProgressItemIds(events: readonly EntertainmentEvent[]): ReadonlySet<string> {
  const latestWatch = new Map<string, number>();
  const latestComplete = new Map<string, number>();
  for (const event of events) {
    const epoch = eventEpochMs(event);
    if (event.type === "start" || event.type === "progress") {
      const current = latestWatch.get(event.itemId);
      if (current === undefined || epoch > current) latestWatch.set(event.itemId, epoch);
    } else if (event.type === "complete") {
      const current = latestComplete.get(event.itemId);
      if (current === undefined || epoch > current) latestComplete.set(event.itemId, epoch);
    }
  }
  const inProgress = new Set<string>();
  for (const [itemId, watchEpoch] of latestWatch) {
    const completeEpoch = latestComplete.get(itemId);
    if (completeEpoch === undefined || watchEpoch > completeEpoch) {
      inProgress.add(itemId);
    }
  }
  return inProgress;
}

/**
 * The repetition events for one item, in ctx array order (deterministic —
 * order feeds the auditable fatigue contributions).
 */
export function repetitionEventsFor(
  itemId: string,
  events: readonly EntertainmentEvent[],
): EntertainmentEvent[] {
  return events.filter(
    (event) => event.itemId === itemId && isRepetitionEventType(event.type),
  );
}
