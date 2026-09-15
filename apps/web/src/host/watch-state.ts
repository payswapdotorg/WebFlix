/**
 * @wfx/app-web — the host watch-state recording seam (WFX-051).
 *
 * The frozen `Ports` bundle has ONE watch-state output: the `EventSink`
 * (events flow OUT; the contract explicitly says a lost event must never
 * be a silent success). There is NO read port for watch history on the
 * client runtime — durable watch state is the SERVICE lane's surface
 * (WFX-052 writes events through the transactional outbox; reading them
 * back is that lane's contract).
 *
 * The experience shell needs "Continue watching / resume" NOW. The honest
 * composition: a WRAPPER around the EventSink that (a) FORWARDS every
 * event to the wrapped sink unchanged (the remote sink in service mode
 * still receives everything — this wrapper never swallows), and (b)
 * records the frozen watch-state event types (`start` / `progress` /
 * `complete` / `skip` — `WATCH_STATE_EVENT_TYPES`, WFX-029) in a
 * per-process, per-user buffer the home/detail/player surfaces read to
 * derive continue-watching rows through the FROZEN fold
 * (`deriveWatchHistory` — no fold logic is reimplemented here).
 *
 * Typed stopgaps, visible:
 * - The buffer is process-lifetime, not durable. A restart clears it; the
 *   durable read is the service lane's. In service mode events ALSO reach
 *   the remote sink (forwarded), so nothing is lost — only the local
 *   read-back is best-effort until that lane ships.
 * - It is keyed by the fixed anonymous user of the 050 host stopgap
 *   (`HOME_CONTEXT`); real per-user identity is the auth lane's.
 *
 * Determinism: recording preserves event order verbatim; the fold is the
 * frozen pure function. No clock, no randomness.
 */

import type { EntertainmentEvent, EntertainmentItem } from "@wfx/domain";
import { WATCH_STATE_EVENT_TYPES, deriveWatchHistory, type Ports, type WatchState } from "@wfx/experience";

/** The watch-state event types as a runtime set (record filter). */
const WATCH_STATE_EVENT_TYPE_SET: ReadonlySet<string> = new Set(
  WATCH_STATE_EVENT_TYPES as readonly string[],
);

/** Upper bound on recorded events per user (a ring, oldest dropped). */
const MAX_RECORDED_EVENTS = 512;

/** The per-process recorded watch-state events, per user, in emit order. */
const recordedEvents = new Map<string, EntertainmentEvent[]>();

/**
 * Wrap one `Ports` bundle's event sink with the recorder: every event is
 * FORWARDED to the wrapped sink (failures propagate exactly as before —
 * this wrapper adds no error handling of its own) and watch-state events
 * are additionally recorded per user. Returns a NEW ports bundle; the
 * input is untouched.
 */
export function withWatchStateRecording(ports: Ports): Ports {
  const wrapped = ports.events;
  return {
    ...ports,
    events: {
      emit(event: EntertainmentEvent): Promise<void> | void {
        if (WATCH_STATE_EVENT_TYPE_SET.has(event.type)) {
          recordEvent(event);
        }
        return wrapped.emit(event);
      },
    },
  };
}

/** Record one watch-state event (per user, order preserved, bounded). */
function recordEvent(event: EntertainmentEvent): void {
  const bucket = recordedEvents.get(event.userId) ?? [];
  bucket.push(event);
  if (bucket.length > MAX_RECORDED_EVENTS) {
    bucket.splice(0, bucket.length - MAX_RECORDED_EVENTS);
  }
  recordedEvents.set(event.userId, bucket);
}

/**
 * The recorded watch-state events of one user (verbatim, emit order).
 * A copy — callers cannot mutate the buffer.
 */
export function recordedWatchEvents(userId: string): readonly EntertainmentEvent[] {
  return [...(recordedEvents.get(userId) ?? [])];
}

/**
 * Derive the continue-watching states of one user through the FROZEN
 * WFX-029 fold over the recorded events (sessions contribute nothing here
 * — the per-boot session store is request-scoped; events carry the
 * positions). `items` supplies canonical durations for completion ratios.
 */
export function recordedWatchStates(
  userId: string,
  items?: readonly EntertainmentItem[],
): WatchState[] {
  const events = recordedWatchEvents(userId);
  if (events.length === 0) return [];
  return deriveWatchHistory(events, [], items);
}

/**
 * TEST-ONLY: clear the recorded-events buffer (every user's bucket).
 *
 * Consumed EXCLUSIVELY by `host/testing.ts` (the host test seam) — never
 * by a production path (grep-provable: no other import site exists). It
 * exists because bun:test groups test files into worker PROCESSES whose
 * grouping varies with the machine: when several apps/web test files share
 * one process, playback events recorded by earlier files accumulate in
 * this PROCESS-LIFETIME buffer and break later files' absolute-count
 * assertions (the CI test-hermeticity fix, WFX-CI-FIX). Production
 * behavior is untouched — the documented per-process laws above stand.
 */
export function resetWatchStateRecordingForTests(): void {
  recordedEvents.clear();
}
