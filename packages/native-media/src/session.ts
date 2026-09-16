/**
 * @wfx/native-media — session state machine (WFX-004, Lane B).
 *
 * The session states and transition graph are taken verbatim from the frozen
 * `NativeMediaSession.state` union in @wfx/domain (docs/architecture/
 * contracts.md, "Native media" section). The state machine is:
 *
 * ```text
 *   resolving ──> buffering ──> playing ⇄ background
 *                                   │          │
 *                                   ▼          ▼
 *                                complete <── (background completion)
 *   (every live state may transition to `failed`)
 * ```
 *
 * Design decisions (documented for lead review):
 * - `failed` is reachable from every live state (resolving, buffering,
 *   playing, background) — a media session can fail at any acquisition
 *   stage. `complete` and `failed` are terminal: no outgoing transitions.
 * - `background -> complete` is legal: the frozen architecture names
 *   "background completion" as a service-owned capability (the download
 *   finishes while the session is backgrounded).
 * - `playing -> buffering` (re-buffering) is NOT modeled: the task packet's
 *   graph (`resolving -> buffering -> playing ⇄ background`) is the closed
 *   law. If re-buffering needs first-class state, that is a contract change
 *   for the lead.
 *
 * All functions here are PURE: `transition` never mutates its input and
 * returns a new session object.
 */

import type { NativeMediaSession } from "@wfx/domain";

import { InvalidTransitionError, NativeMediaError } from "./errors";

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/**
 * The six session states, in frozen-union order. `satisfies` guarantees at
 * compile time that every entry is a `NativeMediaSession["state"]` member;
 * the package tests assert the exact contents so the list can never drift
 * from the frozen union.
 */
export const SESSION_STATES = [
  "resolving",
  "buffering",
  "playing",
  "background",
  "complete",
  "failed",
] as const satisfies readonly NativeMediaSession["state"][];

/** A session state, derived from the frozen `NativeMediaSession` union. */
export type SessionState = NativeMediaSession["state"];

/** Runtime guard for {@link SessionState}. */
export function isSessionState(x: unknown): x is SessionState {
  return (
    typeof x === "string" &&
    (SESSION_STATES as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

/** Typed transition table: for each state, the states it may move to. */
export type TransitionTable = {
  readonly [S in SessionState]: readonly SessionState[];
};

/**
 * The closed transition graph (see module docs). Terminal states
 * (`complete`, `failed`) map to empty arrays — there is no way out.
 */
export const ALLOWED_TRANSITIONS: TransitionTable = {
  resolving: ["buffering", "failed"],
  buffering: ["playing", "failed"],
  playing: ["background", "complete", "failed"],
  background: ["playing", "complete", "failed"],
  complete: [],
  failed: [],
};

/**
 * Predicate: may a session in state `from` move to state `to`?
 * Total and safe for runtime garbage — unknown states answer `false`.
 */
export function canTransition(from: SessionState, to: SessionState): boolean {
  if (!isSessionState(from) || !isSessionState(to)) return false;
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

/**
 * Pure transition: returns a NEW session object with `state` set to `to`.
 * The input session is never mutated. Throws {@link InvalidTransitionError}
 * when the hop is illegal or either state is unknown.
 */
export function transition(
  session: NativeMediaSession,
  to: SessionState,
): NativeMediaSession {
  // `unknown` keeps this total for runtime garbage (JS callers, corrupted
  // snapshots) instead of relying on the declared non-null types.
  const from: unknown = session?.state;
  if (!isSessionState(from) || !isSessionState(to) || !canTransition(from, to)) {
    throw new InvalidTransitionError(String(from), String(to));
  }
  return { ...session, state: to };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Input for {@link makeSession}. All fields are validated. */
export interface MakeSessionInput {
  id: string;
  assetId: string;
  fileId: string;
  /** Initial state; defaults to `"resolving"` (the FSM entry state). */
  state?: SessionState;
  /** Buffered duration; defaults to 0. */
  bufferedMs?: number;
  /** Playback position; defaults to 0. */
  positionMs?: number;
  /** Content integrity verdict; defaults to `"unknown"` (no verdict claimed). */
  integrity?: NativeMediaSession["integrity"];
}

/**
 * Factory: validate input and build a well-formed `NativeMediaSession`.
 * Throws a typed `NativeMediaError` (`INVALID_INPUT`) on malformed input —
 * never a fake default-filled session.
 */
export function makeSession(input: MakeSessionInput): NativeMediaSession {
  if (typeof input !== "object" || input === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "makeSession: input must be an object",
    });
  }
  requireNonEmptyString(input.id, "id");
  requireNonEmptyString(input.assetId, "assetId");
  requireNonEmptyString(input.fileId, "fileId");
  const state = input.state ?? "resolving";
  if (!isSessionState(state)) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `makeSession: state '${String(state)}' is not a session state`,
    });
  }
  const bufferedMs = input.bufferedMs ?? 0;
  const positionMs = input.positionMs ?? 0;
  requireNonNegativeFinite(bufferedMs, "bufferedMs");
  requireNonNegativeFinite(positionMs, "positionMs");
  return { id: input.id, assetId: input.assetId, fileId: input.fileId, state, bufferedMs, positionMs, integrity: input.integrity ?? "unknown" };
}

// ---------------------------------------------------------------------------
// Internal validation helpers
// ---------------------------------------------------------------------------

function requireNonEmptyString(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `makeSession: '${field}' must be a non-empty string`,
    });
  }
}

function requireNonNegativeFinite(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `makeSession: '${field}' must be a finite number >= 0`,
    });
  }
}
