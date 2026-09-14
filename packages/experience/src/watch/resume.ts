/**
 * @wfx/experience — resume orchestration (WFX-027, Lane C).
 *
 * `planResume(item, history, surfaceResolution)` is the PURE resume planner
 * of the Watch Feed: it decides whether the item CONTINUES an existing
 * playback session, STARTS FRESH, or ADVANCES to the next episode, and it
 * emits the exact frozen `EntertainmentEvent` the WFX-005 playback use-case
 * should fire — TYPED, NOT FIRED (firing is the app layer's job; this module
 * touches no sink, no store, no clock).
 *
 * The resume band (the packet's thresholds, one law shared with the view
 * model's affordance classification):
 *
 * - ratio < 5%                       → start-fresh from position 0,
 * - 5% <= ratio < 95% (in progress)  → continue the session at the last
 *                                      position (or carry the position into a
 *                                      new session when none exists),
 * - ratio >= 95% or `completed`      → next-episode (via the DECLARED
 *                                      adjacency) — or a fresh re-watch when
 *                                      no successor is declared.
 *
 * Unknown completion ratio (unknown duration) is never faked: position
 * evidence decides (position > 0 resumes, else restarts).
 *
 * Event honesty: the plan's `event` is a fully valid frozen
 * `EntertainmentEvent` built from the history's host-supplied event stamp
 * (who / which experience session / when — the EventSink law: envelope and
 * session identity belong to the caller). For a continue-session plan it is
 * byte-exact what WFX-005's `startPlayback` emits: the `"start"` event whose
 * payload is `{ playbackSessionId }` of the EXISTING session. For
 * start-fresh / next-episode plans the playback session does not exist yet —
 * WFX-005 mints it — so the plan's event carries no payload and the reason
 * documents that the app layer's start event carries the fresh id.
 *
 * The WFX-025 `SurfaceResolution` supplies the realization the plan hands to
 * the app layer. An UNRESOLVABLE resolution is a typed `unresolvable`
 * result with the resolver's reasons verbatim — never a fabricated session.
 * Malformed caller input throws the typed `ExperienceError`.
 *
 * Determinism: pure function of the arguments; no randomness, no hidden
 * clock, no globals.
 */

import type {
  EntertainmentEvent,
  EntertainmentItem,
  PlaybackMode,
  PlaybackRealization,
  PlaybackSession,
} from "@wfx/domain";
import {
  PLAYBACK_MODES,
  isIso8601,
  isRecord,
  previewValue,
  validateEntertainmentEvent,
  validateEntertainmentItem,
  validatePlaybackRealization,
} from "@wfx/domain";

import { WATCH_STATUSES, type WatchState } from "../library/history";
import { ExperienceError } from "../ports";
import type { SurfaceResolution } from "../surface/resolve";
import { formatPositionMs, percentWatchedText, watchFeedTitle } from "./view";

// ---------------------------------------------------------------------------
// The resume band (the packet's thresholds — one law, typed and shared)
// ---------------------------------------------------------------------------

/** Below this watched ratio an item is (re)started from the beginning. */
export const RESUME_MIN_RATIO = 0.05;

/** At or above this watched ratio an item counts as finished and the plan advances. */
export const RESUME_MAX_RATIO = 0.95;

/** The resume affordance derived from a watch state (badge-level classification). */
export type ResumeAffordance = "resume" | "restart" | "next";

/**
 * Classify one watch state's resume affordance by the resume band:
 * `completed` or ratio >= 95% → "next"; ratio < 5% → "restart"; otherwise
 * "resume". An unknown ratio (unknown duration) is never faked: position
 * evidence decides. Pure; total on well-formed states.
 */
export function classifyResumeAffordance(state: WatchState): ResumeAffordance {
  if (state.status === "completed") return "next";
  if (
    state.completionRatio !== null &&
    typeof state.completionRatio === "number" &&
    Number.isFinite(state.completionRatio)
  ) {
    if (state.completionRatio < RESUME_MIN_RATIO) return "restart";
    if (state.completionRatio >= RESUME_MAX_RATIO) return "next";
    return "resume";
  }
  return state.lastPositionMs > 0 ? "resume" : "restart";
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * The host-supplied event stamp: who, in which EXPERIENCE session, at what
 * instant the plan's typed event is stamped with. The caller owns identity
 * and time (the EventSink law); the planner never hides a clock.
 */
export interface ResumeEventStamp {
  userId: string;
  /** The EXPERIENCE session id (fills `EntertainmentEvent.sessionId`). */
  sessionId: string;
  /** ISO 8601 instant with an explicit offset. */
  occurredAt: string;
}

/**
 * The watch-history bundle the planner composes: the event-folded states
 * (WFX-029 `deriveWatchHistory` output), the playback sessions (resume
 * targets), the canonical items (durations + successor titles), and the
 * DECLARED next-episode adjacency (episode id → successor id, host-derived
 * from graph relations — the same convention as the OS `nextEpisodeOf`
 * feature key; never title-guessed).
 */
export interface ResumeHistory {
  stamp: ResumeEventStamp;
  states: readonly WatchState[];
  sessions: readonly PlaybackSession[];
  items?: readonly EntertainmentItem[];
  nextEpisodeOf?: Readonly<Record<string, string>>;
}

/** The builder input bundle (named-argument form of the packet's signature). */
export interface PlanResumeInput {
  item: EntertainmentItem;
  history: ResumeHistory;
  surfaceResolution: SurfaceResolution;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/** The plan's outcome kind (the packet's two, plus the ≥95% next-episode). */
export type ResumePlanKind = "continue-session" | "start-fresh" | "next-episode";

/**
 * The typed resume plan: what to play, where to resume, on which
 * realization, and the exact frozen `EntertainmentEvent` the WFX-005
 * playback use-case should emit (typed, not fired).
 */
export interface ResumePlan {
  kind: ResumePlanKind;
  /** The item to play (the NEXT episode's id for a next-episode plan). */
  itemId: string;
  /** Where playback starts (0 for fresh/next plans; the last position to resume). */
  resumePositionMs: number;
  /** The resolved playback mode (WFX-025 handoff). */
  mode: PlaybackMode;
  /** The resolved realization (WFX-025 handoff — the app layer's PlaybackIntent realization). */
  realization: PlaybackRealization;
  /** Present iff kind is "continue-session": the existing session to resume. */
  session?: PlaybackSession;
  /** The typed frozen `"start"` event (see the module doc for the payload law). */
  event: EntertainmentEvent;
  /** NON-EMPTY explainability reason. */
  reason: string;
}

/** The planner's typed result: a plan, or the unresolvable dead end. */
export type ResumePlanResult =
  | { ok: true; plan: ResumePlan }
  | { ok: false; reason: "unresolvable"; details: readonly string[] };

// ---------------------------------------------------------------------------
// Input validation (caller misuse — typed throw)
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isMemberOf(values: readonly string[], value: unknown): boolean {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function stateProblems(state: unknown, prefix: string): string[] {
  if (!isRecord(state)) {
    return [`${prefix}: expected a WatchState object, got ${previewValue(state)}`];
  }
  const problems: string[] = [];
  if (!isNonEmptyString(state.itemId)) {
    problems.push(`${prefix}.itemId: expected a non-empty string, got ${previewValue(state.itemId)}`);
  }
  if (!isNonNegativeFinite(state.lastPositionMs)) {
    problems.push(
      `${prefix}.lastPositionMs: expected a finite non-negative number, got ${previewValue(state.lastPositionMs)}`,
    );
  }
  if (
    state.completionRatio !== null &&
    !(typeof state.completionRatio === "number" && Number.isFinite(state.completionRatio))
  ) {
    problems.push(
      `${prefix}.completionRatio: expected a finite number or null, got ${previewValue(state.completionRatio)}`,
    );
  }
  if (!isNonEmptyString(state.lastWatchedAt)) {
    problems.push(
      `${prefix}.lastWatchedAt: expected a non-empty string, got ${previewValue(state.lastWatchedAt)}`,
    );
  }
  if (!isMemberOf(WATCH_STATUSES, state.status)) {
    problems.push(
      `${prefix}.status: expected one of ${WATCH_STATUSES.join(" | ")}, got ${previewValue(state.status)}`,
    );
  }
  return problems;
}

function sessionProblems(session: unknown, prefix: string): string[] {
  if (!isRecord(session)) {
    return [`${prefix}: expected a PlaybackSession object, got ${previewValue(session)}`];
  }
  const problems: string[] = [];
  if (!isNonEmptyString(session.id)) {
    problems.push(`${prefix}.id: expected a non-empty string, got ${previewValue(session.id)}`);
  }
  if (!isNonEmptyString(session.userId)) {
    problems.push(`${prefix}.userId: expected a non-empty string, got ${previewValue(session.userId)}`);
  }
  if (!isNonEmptyString(session.itemId)) {
    problems.push(`${prefix}.itemId: expected a non-empty string, got ${previewValue(session.itemId)}`);
  }
  if (!isNonNegativeFinite(session.resumePositionMs)) {
    problems.push(
      `${prefix}.resumePositionMs: expected a finite non-negative number, got ${previewValue(session.resumePositionMs)}`,
    );
  }
  if (typeof session.createdAt !== "string" || !isIso8601(session.createdAt)) {
    problems.push(
      `${prefix}.createdAt: expected an ISO 8601 datetime string, got ${previewValue(session.createdAt)}`,
    );
  }
  const realization = validatePlaybackRealization(session.realization);
  if (!realization.ok) {
    problems.push(
      ...realization.errors.map((message) => `${prefix}.realization: ${message}`),
    );
  }
  return problems;
}

function assertUsableResumeHistory(history: ResumeHistory): void {
  if (!isRecord(history)) {
    throw new ExperienceError("history: expected a ResumeHistory object");
  }
  const problems: string[] = [];

  if (!isRecord(history.stamp)) {
    problems.push(
      `history.stamp: expected a ResumeEventStamp object, got ${previewValue(history.stamp)}`,
    );
  } else {
    if (!isNonEmptyString(history.stamp.userId)) {
      problems.push(
        `history.stamp.userId: expected a non-empty string, got ${previewValue(history.stamp.userId)}`,
      );
    }
    if (!isNonEmptyString(history.stamp.sessionId)) {
      problems.push(
        `history.stamp.sessionId: expected a non-empty string, got ${previewValue(history.stamp.sessionId)}`,
      );
    }
    if (typeof history.stamp.occurredAt !== "string" || !isIso8601(history.stamp.occurredAt)) {
      problems.push(
        `history.stamp.occurredAt: expected an ISO 8601 datetime string with an explicit offset, got ${previewValue(history.stamp.occurredAt)}`,
      );
    }
  }

  if (!Array.isArray(history.states)) {
    problems.push(
      `history.states: expected an array of WatchState, got ${previewValue(history.states)}`,
    );
  } else {
    history.states.forEach((state, index) => {
      problems.push(...stateProblems(state, `history.states[${index}]`));
    });
  }

  if (!Array.isArray(history.sessions)) {
    problems.push(
      `history.sessions: expected an array of PlaybackSession, got ${previewValue(history.sessions)}`,
    );
  } else {
    history.sessions.forEach((session, index) => {
      problems.push(...sessionProblems(session, `history.sessions[${index}]`));
    });
  }

  if (history.items !== undefined) {
    if (!Array.isArray(history.items)) {
      problems.push(
        `history.items: expected an array of EntertainmentItem when present, got ${previewValue(history.items)}`,
      );
    } else {
      history.items.forEach((item, index) => {
        const checked = validateEntertainmentItem(item);
        if (!checked.ok) {
          problems.push(
            ...checked.errors.map((message) => `history.items[${index}]: ${message}`),
          );
        }
      });
    }
  }

  if (history.nextEpisodeOf !== undefined) {
    if (!isRecord(history.nextEpisodeOf)) {
      problems.push(
        `history.nextEpisodeOf: expected a record of episodeId -> successorId when present, got ${previewValue(history.nextEpisodeOf)}`,
      );
    } else {
      for (const [key, value] of Object.entries(history.nextEpisodeOf)) {
        if (!isNonEmptyString(value)) {
          problems.push(
            `history.nextEpisodeOf["${key}"]: expected a non-empty successor episode id, got ${previewValue(value)}`,
          );
        }
      }
    }
  }

  if (problems.length > 0) throw new ExperienceError(problems);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO epoch (NaN-safe: malformed timestamps sort last, never crash). */
function epochOf(iso: string): number {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
}

/**
 * The newest playback session for one item (`createdAt` desc; equal stamps
 * resolve to the LATER input index — the WFX-029 latest-session law), or
 * undefined when none exists.
 */
function newestSessionFor(
  sessions: readonly PlaybackSession[],
  itemId: string,
): PlaybackSession | undefined {
  let best: { session: PlaybackSession; createdAtMs: number; index: number } | undefined;
  sessions.forEach((session, index) => {
    if (session.itemId !== itemId) return;
    const createdAtMs = epochOf(session.createdAt);
    if (
      best === undefined ||
      createdAtMs > best.createdAtMs ||
      (createdAtMs === best.createdAtMs && index > best.index)
    ) {
      best = { session, createdAtMs, index };
    }
  });
  return best?.session;
}

/** The finished-ness announcement of a state ("complete" / "95% watched"). */
function finishedText(state: WatchState): string {
  if (state.status === "completed") return "complete";
  const percent = percentWatchedText(state.completionRatio);
  return percent !== null ? percent : `watched to ${formatPositionMs(state.lastPositionMs)}`;
}

/** Title of an item by id from the history's item join (id fallback — never blank). */
function titleOfItem(items: readonly EntertainmentItem[] | undefined, itemId: string): string {
  const found = items?.find((item) => item.id === itemId);
  return found !== undefined ? watchFeedTitle(found) : itemId;
}

// ---------------------------------------------------------------------------
// planResume
// ---------------------------------------------------------------------------

/**
 * Plan the resume of ONE item (see the module doc for every law).
 *
 * @param item              the canonical item to play.
 * @param history           the watch-history bundle (states, sessions, items,
 *                          declared adjacency, and the event stamp).
 * @param surfaceResolution a WFX-025 `SurfaceResolution` — the realization
 *                          handoff. Unresolvable ⇒ the typed `unresolvable`
 *                          result with the resolver's reasons verbatim.
 * @returns the typed `ResumePlanResult`.
 * @throws `ExperienceError` on malformed caller input (item, history, or a
 *         resolution/item mismatch — including a resolution for a different
 *         item).
 */
export function planResume(
  item: EntertainmentItem,
  history: ResumeHistory,
  surfaceResolution: SurfaceResolution,
): ResumePlanResult {
  const itemCheck = validateEntertainmentItem(item);
  if (!itemCheck.ok) {
    throw new ExperienceError(itemCheck.errors.map((message) => `item: ${message}`));
  }
  assertUsableResumeHistory(history);
  if (!isRecord(surfaceResolution)) {
    throw new ExperienceError(
      `surfaceResolution: expected a SurfaceResolution object, got ${previewValue(surfaceResolution)}`,
    );
  }
  if (surfaceResolution.ok !== true) {
    // Unresolvable: the typed dead end, reasons verbatim — nothing fabricated.
    const reasons = Array.isArray(surfaceResolution.reasons)
      ? surfaceResolution.reasons.map((reason) => String(reason))
      : ["(the unresolvable resolution carried no reasons)"];
    return { ok: false, reason: "unresolvable", details: Object.freeze(reasons) };
  }

  const problems: string[] = [];
  if (
    typeof surfaceResolution.mode !== "string" ||
    !(PLAYBACK_MODES as readonly string[]).includes(surfaceResolution.mode)
  ) {
    problems.push(
      `surfaceResolution.mode: expected one of ${PLAYBACK_MODES.join(" | ")}, got ${previewValue(surfaceResolution.mode)}`,
    );
  }
  if (typeof surfaceResolution.itemId !== "string" || surfaceResolution.itemId.length === 0) {
    problems.push(
      `surfaceResolution.itemId: expected a non-empty string, got ${previewValue(surfaceResolution.itemId)}`,
    );
  } else if (surfaceResolution.itemId !== item.id) {
    problems.push(
      `surfaceResolution.itemId: '${surfaceResolution.itemId}' does not match the item to plan ('${item.id}') — the resolution belongs to a different item`,
    );
  }
  const chosenCheck = validatePlaybackRealization(surfaceResolution.chosen);
  if (!chosenCheck.ok) {
    throw new ExperienceError([
      ...problems,
      ...chosenCheck.errors.map((message) => `surfaceResolution.chosen: ${message}`),
    ]);
  }
  if (problems.length > 0) throw new ExperienceError(problems);
  const chosen = chosenCheck.value;

  const title = watchFeedTitle(item);
  const state = history.states.find((entry) => entry.itemId === item.id);

  let kind: ResumePlanKind;
  let planItemId = item.id;
  let resumePositionMs = 0;
  let session: PlaybackSession | undefined;

  if (state === undefined) {
    kind = "start-fresh";
    resumePositionMs = 0;
  } else {
    const affordance = classifyResumeAffordance(state);
    if (affordance === "resume") {
      resumePositionMs = Math.max(0, Math.floor(state.lastPositionMs));
      session = newestSessionFor(history.sessions, item.id);
      kind = session !== undefined ? "continue-session" : "start-fresh";
    } else if (affordance === "restart") {
      kind = "start-fresh";
      resumePositionMs = 0;
    } else {
      const successor = history.nextEpisodeOf?.[item.id];
      if (successor !== undefined) {
        kind = "next-episode";
        planItemId = successor;
        resumePositionMs = 0;
      } else {
        kind = "start-fresh";
        resumePositionMs = 0;
      }
    }
  }

  // The explainability reason (deterministic, non-empty).
  let reason: string;
  if (state === undefined) {
    reason = `start "${title}" fresh — no watch state for this item`;
  } else if (kind === "continue-session" && session !== undefined) {
    const progressText =
      percentWatchedText(state.completionRatio) ?? `at ${formatPositionMs(resumePositionMs)}`;
    reason = `resume "${title}" — ${progressText}, continuing playback session ${session.id}`;
  } else if (kind === "start-fresh" && classifyResumeAffordance(state) === "resume") {
    const progressText =
      percentWatchedText(state.completionRatio) ?? `at ${formatPositionMs(resumePositionMs)}`;
    reason = `resume "${title}" — ${progressText}, in a NEW playback session (no existing session to continue; the app layer's start event carries the fresh session id)`;
  } else if (kind === "start-fresh" && classifyResumeAffordance(state) === "restart") {
    reason = `restart "${title}" — under ${Math.round(RESUME_MIN_RATIO * 100)}% watched, starting from the beginning`;
  } else if (kind === "next-episode") {
    reason = `"${title}" is ${finishedText(state)} — advance to the declared next episode "${titleOfItem(history.items, planItemId)}"`;
  } else {
    reason = `"${title}" is ${finishedText(state)} with no declared next episode — start a re-watch from the beginning`;
  }

  // The typed frozen "start" event — the exact WFX-005 payload for a
  // continue-session plan; payload-free (app layer stamps the fresh id) for
  // fresh/next plans. See the module doc.
  const event: EntertainmentEvent = {
    userId: history.stamp.userId,
    itemId: planItemId,
    type: "start",
    occurredAt: history.stamp.occurredAt,
    sessionId: history.stamp.sessionId,
    ...(session !== undefined ? { payload: { playbackSessionId: session.id } } : {}),
  };
  const eventCheck = validateEntertainmentEvent(event);
  if (!eventCheck.ok) {
    // Defensive: unreachable after the stamp validation above.
    throw new ExperienceError(eventCheck.errors.map((message) => `event: ${message}`));
  }

  const plan: ResumePlan = {
    kind,
    itemId: planItemId,
    resumePositionMs,
    mode: surfaceResolution.mode,
    realization: chosen,
    ...(session !== undefined ? { session } : {}),
    event,
    reason,
  };
  return { ok: true, plan };
}
