/**
 * @wfx/experience — watch-history derivation (WFX-029, Lane C).
 *
 * `deriveWatchHistory(events, sessions, items?)` is the PURE, DETERMINISTIC
 * fold of the frozen event stream + `PlaybackSession`s into per-item
 * `WatchState` — the "watch history = derived view over the event stream +
 * sessions" law of the frozen architecture ("Experience Core" owns watch
 * state presentation).
 *
 * Fold semantics (documented, deterministic):
 *
 * 1. EVENT SELECTION — only the watch-state event types fold:
 *    `start`, `progress`, `complete`, `skip`. Other frozen event types
 *    (impression / like / dislike / save / share / search) are legal stream
 *    members but carry no watch state — they are skipped (documented scope,
 *    not an error).
 * 2. ORDERING — events are ordered by `occurredAt` (parsed to epoch ms; the
 *    domain validator guarantees an explicit ISO 8601 offset), with a
 *    documented tie-break by the event's SEQUENCE INPUT INDEX (an event that
 *    appears later in the input array is processed later when timestamps are
 *    equal — the fold therefore tolerates out-of-order input and remains
 *    fully deterministic for equal-timestamp batches).
 * 3. CHRONOLOGICAL LAST-WRITER-WINS — per item, the fold accumulates
 *    position, status and last-watch time in event order:
 *    - `start`    → status "in-progress"; position := payload.positionMs,
 *                   else the referenced session's `resumePositionMs`, else
 *                   the prior folded position, else 0.
 *    - `progress` → status "in-progress"; position := payload.positionMs
 *                   (WFX-005 always emits it; when absent or malformed the
 *                   field is defensively ignored and the session's resume /
 *                   prior position is kept — never a crash).
 *    - `complete` → status "completed"; position := payload.positionMs, else
 *                   session resume, else prior.
 *    - `skip`     → status "skipped" (SKIPPED-BUT-RESUMABLE — skipped items
 *                   remain Continue-section candidates); position like
 *                   complete.
 *    A `start` after a `complete` legitimately re-opens the item
 *    (a re-watch in progress): chronology wins.
 * 4. SESSIONS fold alongside events (both are inputs, per the packet):
 *    - A session referenced by an event's `payload.playbackSessionId`
 *      supplies its resume position (multi-session resume: a later session
 *      that starts from the previous one's end).
 *    - Items with NO watch events at all are seeded from their NEWEST
 *      session (by `createdAt`, tie-break by input index): status
 *      "in-progress", position = `resumePositionMs`, last watch =
 *      `createdAt` (a `PlaybackSession` carries no terminal marker —
 *      completed-ness is event evidence only, never fabricated).
 *    - NEWER-SESSION RULE: when the newest session for an item STARTS after
 *      the item's last watch event, the session's `resumePositionMs`
 *      supersedes the event-folded position (the session carried the resume
 *      forward; its progress events may lie outside the input window) and
 *      `lastWatchedAt` becomes the session's `createdAt`. STATUS stays
 *      event-derived — the session snapshot has no completion truth.
 * 5. COMPLETION RATIO — `completed` items are exactly `1` (the complete
 *    event is authoritative). Otherwise the ratio is
 *    `clamp(lastPositionMs / durationMs, 0, 1)` when the item's duration is
 *    known (from the optional `items` argument), and `null` when it is not
 *    (honest: an unknown ratio is never a fake 0 or 1).
 * 6. OUTPUT ORDER — most recently watched first (`lastWatchedAt` epoch
 *    desc), tie-break itemId asc (codepoint).
 *
 * Error channel: malformed input (non-arrays; an event failing the WFX-002
 * `validateEntertainmentEvent`; a session with an invalid shape; an item
 * failing `validateEntertainmentItem`) throws the typed `ExperienceError`
 * (the package's caller-misuse channel). Untrusted raw input should be
 * pre-validated by the host — the fold itself trusts the frozen contracts.
 *
 * Determinism laws: no randomness, no `Date.now`, no globals — the only
 * inputs are the arguments. Duplicate item ids in `items` resolve last-wins;
 * duplicate session ids resolve first-wins (both documented).
 */

import type { EntertainmentEvent, EntertainmentItem, PlaybackSession } from "@wfx/domain";
import {
  isIso8601,
  isRecord,
  previewValue,
  validateEntertainmentItem,
  validateEntertainmentEvent,
  validatePlaybackRealization,
} from "@wfx/domain";

import { ExperienceError } from "../ports";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The per-item watch status the fold derives. */
export type WatchStatus = "in-progress" | "completed" | "skipped";

/** Every `WatchStatus`, in union order. */
export const WATCH_STATUSES: readonly WatchStatus[] = [
  "in-progress",
  "completed",
  "skipped",
];

/**
 * The frozen event types that carry watch state. Other frozen event types are
 * skipped by the fold (documented scope — see the module doc).
 */
export const WATCH_STATE_EVENT_TYPES: readonly EntertainmentEvent["type"][] = [
  "start",
  "progress",
  "complete",
  "skip",
];

/**
 * The derived watch state of ONE item — the packet's shape, verbatim:
 * position, completion ratio, last watch time, and status. `completionRatio`
 * is `null` exactly when the item's duration is unknown (never faked).
 */
export interface WatchState {
  itemId: string;
  /** Last known position in milliseconds (>= 0). */
  lastPositionMs: number;
  /** 1 when completed; clamp(position/duration, 0, 1) when duration is known; null otherwise. */
  completionRatio: number | null;
  /** ISO timestamp of the last watch evidence (event or session start). */
  lastWatchedAt: string;
  status: WatchStatus;
}

// ---------------------------------------------------------------------------
// Input validation (caller misuse — typed throw)
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function assertValidEvents(events: readonly EntertainmentEvent[]): void {
  if (!Array.isArray(events)) {
    throw new ExperienceError("events: expected an array of EntertainmentEvent");
  }
  events.forEach((event, index) => {
    const checked = validateEntertainmentEvent(event);
    if (!checked.ok) {
      throw new ExperienceError(checked.errors.map((message) => `events[${index}]: ${message}`));
    }
  });
}

function assertValidSessions(sessions: readonly PlaybackSession[]): void {
  if (!Array.isArray(sessions)) {
    throw new ExperienceError("sessions: expected an array of PlaybackSession");
  }
  sessions.forEach((session, index) => {
    const problems: string[] = [];
    if (!isRecord(session)) {
      throw new ExperienceError(`sessions[${index}]: expected a PlaybackSession object`);
    }
    if (!isNonEmptyString(session.id)) {
      problems.push(
        `sessions[${index}].id: expected a non-empty string, got ${previewValue(session.id)}`,
      );
    }
    if (!isNonEmptyString(session.userId)) {
      problems.push(
        `sessions[${index}].userId: expected a non-empty string, got ${previewValue(session.userId)}`,
      );
    }
    if (!isNonEmptyString(session.itemId)) {
      problems.push(
        `sessions[${index}].itemId: expected a non-empty string, got ${previewValue(session.itemId)}`,
      );
    }
    if (!isNonNegativeFinite(session.resumePositionMs)) {
      problems.push(
        `sessions[${index}].resumePositionMs: expected a finite non-negative number, got ${previewValue(session.resumePositionMs)}`,
      );
    }
    if (typeof session.createdAt !== "string" || !isIso8601(session.createdAt)) {
      problems.push(
        `sessions[${index}].createdAt: expected an ISO 8601 datetime string, got ${previewValue(session.createdAt)}`,
      );
    }
    const realization = validatePlaybackRealization(session.realization);
    if (!realization.ok) {
      problems.push(
        ...realization.errors.map((message) => `sessions[${index}].realization: ${message}`),
      );
    }
    if (problems.length > 0) throw new ExperienceError(problems);
  });
}

function assertValidItems(items: readonly EntertainmentItem[]): void {
  if (!Array.isArray(items)) {
    throw new ExperienceError("items: expected an array of EntertainmentItem");
  }
  items.forEach((item, index) => {
    const checked = validateEntertainmentItem(item);
    if (!checked.ok) {
      throw new ExperienceError(checked.errors.map((message) => `items[${index}]: ${message}`));
    }
  });
}

// ---------------------------------------------------------------------------
// Payload extraction (defensive, documented)
// ---------------------------------------------------------------------------

/** Read a valid non-negative position from an event payload, if present. */
function positionFromPayload(event: EntertainmentEvent): number | undefined {
  if (!isRecord(event.payload)) return undefined;
  const value = event.payload.positionMs;
  return isNonNegativeFinite(value) ? value : undefined; // malformed → ignored
}

/** Read the playback session correlation id from an event payload, if present. */
function sessionIdFromPayload(event: EntertainmentEvent): string | undefined {
  if (!isRecord(event.payload)) return undefined;
  const value = event.payload.playbackSessionId;
  return isNonEmptyString(value) ? value : undefined; // malformed → ignored
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

/** Internal per-item accumulator (positions/times are epoch ms). */
interface ItemFold {
  itemId: string;
  positionMs?: number;
  status?: WatchStatus;
  lastWatchedAt?: string;
  lastWatchedAtMs?: number;
}

/** Codepoint string comparison (locale-independent, deterministic). */
function compareCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Derive the per-item watch history from the frozen event stream and the
 * playback sessions (see the module doc for the exact fold semantics).
 * `items` optionally supplies canonical durations for completion ratios and
 * may pass the same item the host will join later — the fold only reads it.
 */
export function deriveWatchHistory(
  events: readonly EntertainmentEvent[],
  sessions: readonly PlaybackSession[],
  items?: readonly EntertainmentItem[],
): WatchState[] {
  assertValidEvents(events);
  assertValidSessions(sessions);
  if (items !== undefined) assertValidItems(items);

  // Session index (duplicate ids: FIRST wins — documented).
  const sessionById = new Map<string, PlaybackSession>();
  interface LatestSession {
    session: PlaybackSession;
    createdAtMs: number;
    inputIndex: number;
  }
  const latestSessionByItem = new Map<string, LatestSession>();
  sessions.forEach((session, index) => {
    if (!sessionById.has(session.id)) sessionById.set(session.id, session);
    const createdAtMs = Date.parse(session.createdAt);
    const current = latestSessionByItem.get(session.itemId);
    if (
      current === undefined ||
      createdAtMs > current.createdAtMs ||
      (createdAtMs === current.createdAtMs && index > current.inputIndex)
    ) {
      latestSessionByItem.set(session.itemId, { session, createdAtMs, inputIndex: index });
    }
  });

  // Duration index (duplicate item ids: LAST wins — documented).
  const durationByItem = new Map<string, number>();
  if (items !== undefined) {
    for (const item of items) {
      if (typeof item.durationMs === "number" && Number.isFinite(item.durationMs) && item.durationMs > 0) {
        durationByItem.set(item.id, item.durationMs);
      }
    }
  }

  // Chronological event order: occurredAt epoch asc, tie-break input index.
  const watchTypes = WATCH_STATE_EVENT_TYPES as readonly string[];
  const ordered = events
    .map((event, index) => {
      const at = Date.parse(event.occurredAt);
      if (Number.isNaN(at)) {
        // Defensive: isIso8601 (via the validator) makes this unreachable.
        throw new ExperienceError(
          `events[${index}].occurredAt: unparseable ISO timestamp '${event.occurredAt}'`,
        );
      }
      return { event, index, at };
    })
    .filter((entry) => watchTypes.includes(entry.event.type))
    .sort((a, b) => a.at - b.at || a.index - b.index);

  // The fold itself.
  const folds = new Map<string, ItemFold>();
  for (const { event, at } of ordered) {
    const fold: ItemFold = folds.get(event.itemId) ?? { itemId: event.itemId };
    const payloadPosition = positionFromPayload(event);
    const sessionId = sessionIdFromPayload(event);
    const session = sessionId !== undefined ? sessionById.get(sessionId) : undefined;
    const sessionPosition = session !== undefined ? session.resumePositionMs : undefined;

    switch (event.type) {
      case "start": {
        fold.status = "in-progress";
        fold.positionMs = payloadPosition ?? sessionPosition ?? fold.positionMs ?? 0;
        break;
      }
      case "progress": {
        fold.status = "in-progress";
        if (payloadPosition !== undefined) fold.positionMs = payloadPosition;
        else if (sessionPosition !== undefined) fold.positionMs = sessionPosition;
        break;
      }
      case "complete": {
        fold.status = "completed";
        const next = payloadPosition ?? sessionPosition ?? fold.positionMs;
        if (next !== undefined) fold.positionMs = next;
        break;
      }
      case "skip": {
        fold.status = "skipped";
        const next = payloadPosition ?? sessionPosition ?? fold.positionMs;
        if (next !== undefined) fold.positionMs = next;
        break;
      }
      default:
        // Unreachable: the filter above selects only watch-state types.
        break;
    }

    fold.lastWatchedAt = event.occurredAt;
    fold.lastWatchedAtMs = at;
    folds.set(event.itemId, fold);
  }

  // Session overlay: seed event-less items; apply the newer-session rule.
  for (const [itemId, latest] of latestSessionByItem) {
    const fold: ItemFold = folds.get(itemId) ?? { itemId };
    const lastEventMs = fold.lastWatchedAtMs;
    if (fold.lastWatchedAt === undefined) {
      // No watch events at all: seed from the newest session.
      fold.positionMs = latest.session.resumePositionMs;
      fold.status = "in-progress";
      fold.lastWatchedAt = latest.session.createdAt;
      fold.lastWatchedAtMs = latest.createdAtMs;
    } else if (
      latest.createdAtMs > (lastEventMs ?? Number.NEGATIVE_INFINITY)
    ) {
      // The newest session STARTS after the last watch event: its resume
      // carries the position forward (status stays event-derived).
      fold.positionMs = latest.session.resumePositionMs;
      fold.lastWatchedAt = latest.session.createdAt;
      fold.lastWatchedAtMs = latest.createdAtMs;
    }
    folds.set(itemId, fold);
  }

  // Project accumulators to WatchState (order: most recent first).
  const states: WatchState[] = [];
  for (const fold of folds.values()) {
    const durationMs = durationByItem.get(fold.itemId);
    let completionRatio: number | null;
    if (fold.status === "completed") {
      completionRatio = 1;
    } else if (durationMs !== undefined && fold.positionMs !== undefined) {
      completionRatio = Math.min(Math.max(fold.positionMs / durationMs, 0), 1);
    } else {
      completionRatio = null;
    }
    states.push({
      itemId: fold.itemId,
      lastPositionMs: fold.positionMs ?? 0,
      completionRatio,
      lastWatchedAt: fold.lastWatchedAt ?? "",
      status: fold.status ?? "in-progress",
    });
  }

  states.sort((a, b) => {
    const aMs = Date.parse(a.lastWatchedAt);
    const bMs = Date.parse(b.lastWatchedAt);
    return bMs - aMs || compareCodepoint(a.itemId, b.itemId);
  });
  return states;
}
