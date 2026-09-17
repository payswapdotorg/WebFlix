/**
 * @wfx/torrent-engine — torrent session state machine (R11).
 *
 * The session states are taken from the frozen `TorrentState` union in
 * @wfx/domain (docs/architecture/contracts.md, "Torrent engine" section).
 * The state machine is:
 *
 * ```text
 *   metadata ──> checking ──> downloading ⇄ paused ──> complete
 *                     │           │
 *                     ▼           ▼
 *                   failed <── (every live state)
 *
 *   (a 'playing' state exists in the frozen union; it is a playback-
 *    driven projection the engine surfaces when the playback-aware
 *    scheduler (R12) reports the playhead inside a downloaded range; it
 *    is reachable from 'downloading' and 'paused' and never terminal)
 * ```
 *
 * HONEST STATUS LAW (the frozen architecture's "honest unsupported states"
 * law, mirrored from R10's session.ts):
 *
 * - The frozen union names EIGHT states: `metadata | checking | buffering
 *   | playing | downloading | paused | complete | failed`. The torrent
 *   engine's RUNTIME status reports a SUBSET relevant to acquisition —
 *   `buffering` is the playback-aware scheduler's projection (R12); the
 *   engine reports `downloading` while pieces are arriving and `paused`
 *   when the user paused.
 * - `complete` requires VERIFIED integrity (the J24 law — the engine
 *   must have verified every piece AND computed the whole-asset digest
 *   compatible with the native-media asset store). A session that lands
 *   all bytes but fails verification NEVER enters `complete` — it goes
 *   to `failed` with the `INTEGRITY_FAILED` evidence.
 * - `failed` is reachable from every live state (a torrent can fail at
 *   metadata, at checking, at downloading, at paused — disk full, peer
 *   starvation, data vanished, integrity mismatch).
 * - `complete` and `failed` are terminal: no outgoing transitions.
 *
 * DESIGN NOTE (the frozen union vs the runtime projection):
 *
 * The frozen `TorrentState` includes `playing` so a future playback-
 * aware scheduler can drive the engine into a state the runtime observes
 * as "currently playing." The torrent engine ITSELF does not own
 * playback; it surfaces `playing` only as a projection of "the playhead
 * is inside a downloaded range." R12 owns that projection. This module
 * makes the hop LEGAL (`downloading → playing`, `paused → playing`,
 * `playing → downloading`, `playing → paused`) so the scheduler can drive
 * the transition without touching the engine internals.
 */

import type { TorrentState } from "@wfx/domain";

import { InvalidTransitionError } from "./errors";

// ---------------------------------------------------------------------------
// States (re-exported from the frozen union; the local types align)
// ---------------------------------------------------------------------------

/** The frozen `TorrentState` union, re-exported for the engine surface. */
export type TorrentSessionState = TorrentState;

/** Every value of {@link TorrentSessionState}, in frozen-union order. */
export const TORRENT_SESSION_STATES: readonly TorrentSessionState[] = [
  "metadata",
  "checking",
  "buffering",
  "playing",
  "downloading",
  "paused",
  "complete",
  "failed",
];

/** Runtime guard for {@link TorrentSessionState}. */
export function isTorrentSessionState(x: unknown): x is TorrentSessionState {
  return (
    typeof x === "string" &&
    (TORRENT_SESSION_STATES as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

/** Typed transition table: for each state, the states it may move to. */
export type TorrentTransitionTable = {
  readonly [S in TorrentSessionState]: readonly TorrentSessionState[];
};

/**
 * The closed transition graph (see module docs). Terminal states
 * (`complete`, `failed`) map to empty arrays — there is no way out.
 *
 * DESIGN NOTE: the graph is more liberal than the simplest "linear"
 * progression to admit the honest status surface — a session may move
 * between `downloading` and `paused` repeatedly (the user pauses and
 * resumes), and between either and `playing` (the scheduler reports a
 * playhead inside a downloaded range). Every non-terminal state can move
 * to `failed` (the honest failure path).
 */
export const ALLOWED_TORRENT_TRANSITIONS: TorrentTransitionTable = {
  metadata: ["checking", "downloading", "failed"],
  checking: ["downloading", "paused", "failed"],
  buffering: ["downloading", "paused", "playing", "failed"],
  playing: ["downloading", "paused", "complete", "failed"],
  downloading: ["paused", "playing", "complete", "failed"],
  paused: ["downloading", "playing", "failed"],
  complete: [],
  failed: [],
};

/**
 * Predicate: may a session in state `from` move to state `to`?
 * Total and safe for runtime garbage — unknown states answer `false`.
 */
export function canTransition(from: TorrentSessionState, to: TorrentSessionState): boolean {
  if (!isTorrentSessionState(from) || !isTorrentSessionState(to)) return false;
  const allowed = ALLOWED_TORRENT_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

/**
 * Pure transition: returns a NEW state value (no session object to
 * mutate — the engine owns the session shape). Throws
 * {@link InvalidTransitionError} when the hop is illegal or either
 * state is unknown.
 */
export function transition(from: TorrentSessionState, to: TorrentSessionState): TorrentSessionState {
  if (!isTorrentSessionState(from) || !isTorrentSessionState(to) || !canTransition(from, to)) {
    throw new InvalidTransitionError(String(from), String(to));
  }
  return to;
}

// ---------------------------------------------------------------------------
// Honest status (the runtime projection)
// ---------------------------------------------------------------------------

/**
 * The HONEST runtime status the engine reports to observers. Distinct
 * from the frozen `TorrentState` because the spec mandates a status
 * surface that names STALL truthfully:
 *
 * - `discovering-metadata` — magnet source, metadata not yet acquired
 *   (the swarm is exchanging BEP-9 ut_metadata, or the loopback is
 *   about to inject the fixture metadata).
 * - `selecting`            — metadata arrived, the user has not yet
 *   chosen a file (the J22 step).
 * - `downloading`          — pieces are arriving.
 * - `seeding-paused`       — the session is paused with verified
 *   pieces (the user paused; integrity is proven so far).
 * - `verifying`            — the engine is hashing the final bytes
 *   against the recorded piece hashes + computing the asset digest.
 * - `completed`            — integrity proven, asset landed.
 * - `failed`               — the honest failure (with a reason).
 *
 * The status is a PROJECTION of the frozen state + the live peer/piece
 * numbers: a session with `peerCount == 0` for the stall window reports
 * `failed(stalled)` instead of `downloading` — the honest "stalled"
 * answer, never a fake progress. See {@link statusFromSession}.
 */
export type HonestTorrentStatus =
  | { readonly kind: "discovering-metadata" }
  | { readonly kind: "selecting" }
  | { readonly kind: "downloading" }
  | { readonly kind: "seeding-paused" }
  | { readonly kind: "verifying" }
  | { readonly kind: "completed" }
  | { readonly kind: "failed"; readonly reason: string };

/** The honest status projection (see {@link HonestTorrentStatus}). */
export function statusFromSession(input: {
  readonly state: TorrentSessionState;
  readonly peerCount: number;
  readonly verifiedPieces: number;
  readonly totalPieces: number;
  readonly stalledSinceMs?: number;
  readonly stallWindowMs: number;
  readonly error?: string;
}): HonestTorrentStatus {
  const { state, peerCount, verifiedPieces, totalPieces, stalledSinceMs, stallWindowMs, error } = input;
  if (state === "failed") {
    return { kind: "failed", reason: error ?? "the session failed (no detail recorded)" };
  }
  if (state === "complete") return { kind: "completed" };
  if (state === "metadata") return { kind: "discovering-metadata" };
  if (state === "checking") return { kind: "selecting" };
  if (state === "buffering") return { kind: "downloading" };
  if (state === "paused") return { kind: "seeding-paused" };
  // `playing` and `downloading` — the honest stall law: a session with
  // 0 peers for the configured window is stalled (the honest failure,
  // not a fake progress). The stall window defaults to infinite when the
  // caller does not supply it (the engine does — see engine.ts).
  if (peerCount === 0 && stalledSinceMs !== undefined && stalledSinceMs >= stallWindowMs) {
    return {
      kind: "failed",
      reason: `the session has had 0 peers for ${Math.round(stalledSinceMs / 1000)}s — peer starvation (the honest stall, never a fake progress)`,
    };
  }
  // The verifying projection: when every piece is verified but the
  // session has not yet entered `complete` (the engine's finalizeCompletion
  // has not yet finished the whole-asset digest). The `state` here is
  // narrowed by the earlier returns to `playing | downloading` (the only
  // states that fall through); comparing to `"complete"` is defensive
  // against a future transition table change.
  if (verifiedPieces >= totalPieces && totalPieces > 0) {
    return { kind: "verifying" };
  }
  return { kind: "downloading" };
}
