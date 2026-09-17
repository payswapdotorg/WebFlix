/**
 * @wfx/torrent-engine — the playback deadline mapping (R12, PURE CORE).
 *
 * THE MAPPING LAW (the dispatch): "map playback byte/range deadlines onto
 * torrent piece priorities; prioritize startup/seek/playback windows; fall
 * back to completion priority outside active windows". This module is the
 * pure, deterministic translation — inputs in (geometry, config, playback
 * position/velocity, seek target, player range requests), windows out.
 * No I/O, no clocks, no state: the caller injects `nowMs` when a window
 * carries a deadline.
 *
 * THE WINDOW MODEL (the four kinds the freeze names):
 *
 * 1. STARTUP — `[P, P + V * startupTargetSeconds)` at STARTUP urgency:
 *    the pieces the player needs for an honest first paint, fetched
 *    first-paint-fast.
 * 2. RUNWAY — `[P, P + V * steadyRunwaySeconds)` at RUNWAY urgency: the
 *    steady-state seconds-ahead target the scheduler maintains while
 *    playing.
 * 3. SEEK BURST — `seekBurstPieces` pieces from the piece containing the
 *    seek target, at CRITICAL urgency, plus the runway re-anchored at the
 *    target: the burst lands so the player can paint after a seek.
 * 4. RANGE REQUESTS — the byte ranges the player/gateway explicitly
 *    asked for, at CRITICAL urgency with their own deadlines: the most
 *    literal demand signal there is.
 *
 * COMPLETION FALLBACK is the absence of windows: outside active playback
 * (idle / background-completion) the mapping answers NO windows, and the
 * library's own selection order (R11's `selectFiles` at urgency 0) IS the
 * priority — the scheduler never re-implements rarest-first; the mature
 * library owns completion order (invariant 6).
 *
 * THE URGENCY LADDER (WebFlix vocabulary; the webtorrent binding maps it
 * onto the library's own `select`/`critical` mechanisms):
 *
 * - 5 CRITICAL — range requests + seek bursts (the player is waiting on
 *   these bytes right now);
 * - 4 STARTUP — the first-paint window;
 * - 3 RUNWAY — the steady-state runway;
 * - 0 COMPLETION — the file selection itself (the library's default).
 */

import type { TorrentResult } from "../errors";
import { torrentError } from "../errors";
import { bitHas } from "../session";
import {
  piecesCoveringFileRange,
  type PlayableFileGeometry,
} from "./geometry";
import type { PlaybackSchedulerConfig } from "./config";

// ---------------------------------------------------------------------------
// The urgency ladder
// ---------------------------------------------------------------------------

/** The closed urgency vocabulary the scheduler speaks to the library. */
export const PIECE_URGENCY = {
  /** The player is waiting on these bytes right now (range requests, seek bursts). */
  CRITICAL: 5,
  /** The first-paint startup window. */
  STARTUP: 4,
  /** The steady-state runway. */
  RUNWAY: 3,
  /** The library's own completion order (the file selection at its default). */
  COMPLETION: 0,
} as const;

/** Every urgency the scheduler may emit (validation domain). */
export const PLAYBACK_URGENCY_LEVELS: readonly number[] = [
  PIECE_URGENCY.COMPLETION,
  PIECE_URGENCY.RUNWAY,
  PIECE_URGENCY.STARTUP,
  PIECE_URGENCY.CRITICAL,
];

// ---------------------------------------------------------------------------
// The window types
// ---------------------------------------------------------------------------

/** The kind of a playback window (which demand produced it). */
export type PlaybackWindowKind = "startup" | "runway" | "seek-burst" | "range-request";

/**
 * One prioritized piece window: the deadline mapping's output unit. Byte
 * bounds are FILE-relative and clamped to the playable file; piece bounds
 * are absolute and inclusive.
 */
export interface PlaybackWindow {
  readonly kind: PlaybackWindowKind;
  /** First absolute piece (inclusive). */
  readonly fromPiece: number;
  /** Last absolute piece (inclusive). */
  readonly toPiece: number;
  /** First file-relative byte of the window's demand (clamped to the file). */
  readonly fromByte: number;
  /** END file-relative byte of the window's demand (exclusive, clamped). */
  readonly toByte: number;
  /** The urgency (the ladder above). */
  readonly urgency: number;
  /** The wall-clock deadline, when the demand carries one (range requests). */
  readonly deadlineMs?: number;
}

/** One player byte-range request (the R10 range gateway's demand shape). */
export interface PlaybackRangeRequest {
  /** File-relative byte offset the player needs. */
  readonly offsetBytes: number;
  /** Byte length of the needed range (>= 1). */
  readonly lengthBytes: number;
  /** Epoch ms by which the range must be readable. */
  readonly deadlineMs: number;
}

/** A range request as the scheduler tracks it (arrival-stamped). */
export interface TrackedRangeRequest extends PlaybackRangeRequest {
  readonly receivedAtMs: number;
}

// ---------------------------------------------------------------------------
// Window constructors (pure)
// ---------------------------------------------------------------------------

/**
 * The startup window: pieces covering `[position, position + velocity *
 * startupTargetSeconds)`. A non-playing demand (velocity <= 0) or an
 * at/past-EOF position produces NO window — nothing is consumed, nothing
 * is urgently needed (the R10 precedent: playbackRate 0 yields an empty
 * plan, honestly).
 */
export function computeStartupWindow(
  geometry: PlayableFileGeometry,
  positionBytes: number,
  bytesPerSecond: number,
  config: PlaybackSchedulerConfig,
): PlaybackWindow | null {
  if (!(bytesPerSecond > 0) || !Number.isFinite(bytesPerSecond)) return null;
  const span = piecesCoveringFileRange(
    geometry,
    positionBytes,
    bytesPerSecond * config.startupTargetSeconds,
  );
  if (span === null) return null;
  return {
    kind: "startup",
    fromPiece: span.fromPiece,
    toPiece: span.toPiece,
    fromByte: Math.max(0, Math.min(positionBytes, geometry.fileLengthBytes)),
    toByte: Math.min(
      geometry.fileLengthBytes,
      Math.max(positionBytes, positionBytes + bytesPerSecond * config.startupTargetSeconds),
    ),
    urgency: PIECE_URGENCY.STARTUP,
  };
}

/**
 * The steady-state runway window: pieces covering `[position, position +
 * velocity * steadyRunwaySeconds)`. Same honesty guards as startup.
 */
export function computeRunwayWindow(
  geometry: PlayableFileGeometry,
  positionBytes: number,
  bytesPerSecond: number,
  config: PlaybackSchedulerConfig,
): PlaybackWindow | null {
  if (!(bytesPerSecond > 0) || !Number.isFinite(bytesPerSecond)) return null;
  const span = piecesCoveringFileRange(
    geometry,
    positionBytes,
    bytesPerSecond * config.steadyRunwaySeconds,
  );
  if (span === null) return null;
  return {
    kind: "runway",
    fromPiece: span.fromPiece,
    toPiece: span.toPiece,
    fromByte: Math.max(0, Math.min(positionBytes, geometry.fileLengthBytes)),
    toByte: Math.min(
      geometry.fileLengthBytes,
      Math.max(positionBytes, positionBytes + bytesPerSecond * config.steadyRunwaySeconds),
    ),
    urgency: PIECE_URGENCY.RUNWAY,
  };
}

/**
 * The seek windows: a CRITICAL burst of `seekBurstPieces` pieces starting
 * at the piece containing the seek target (clamped to the playable file's
 * LAST piece — a burst extending past the file's own pieces could never
 * verify under the session's selection, and the seeking→steady fact must
 * stay reachable), plus the steady runway re-anchored at the target (so
 * flow continues after the burst). The burst's byte span is the target's
 * piece through the burst's last piece, intersected with the file.
 */
export function computeSeekWindows(
  geometry: PlayableFileGeometry,
  seekTargetBytes: number,
  bytesPerSecond: number,
  config: PlaybackSchedulerConfig,
): { readonly burst: PlaybackWindow | null; readonly runway: PlaybackWindow | null } {
  if (!(bytesPerSecond > 0) || !Number.isFinite(bytesPerSecond)) {
    return { burst: null, runway: null };
  }
  const target = Math.max(0, Math.min(seekTargetBytes, Math.max(0, geometry.fileLengthBytes - 1)));
  const burstSpan = piecesCoveringFileRange(geometry, target, 1);
  if (burstSpan === null) return { burst: null, runway: null };
  const fromPiece = burstSpan.fromPiece;
  const fileLastPiece = Math.floor(
    (geometry.fileOffsetBytes + geometry.fileLengthBytes - 1) / geometry.pieceLengthBytes,
  );
  const toPiece = Math.min(fileLastPiece, fromPiece + config.seekBurstPieces - 1);
  const burstEndByte = Math.min(
    geometry.fileLengthBytes,
    (toPiece + 1) * geometry.pieceLengthBytes - geometry.fileOffsetBytes,
  );
  const burst: PlaybackWindow = {
    kind: "seek-burst",
    fromPiece,
    toPiece,
    fromByte: target,
    toByte: Math.max(target + 1, burstEndByte),
    urgency: PIECE_URGENCY.CRITICAL,
  };
  const runway = computeRunwayWindow(geometry, target, bytesPerSecond, config);
  return { burst, runway };
}

/**
 * The window of one explicit player range request: pieces covering
 * `[offset, offset + length)` at CRITICAL urgency, carrying the request's
 * own deadline. Malformed or out-of-file requests produce NO window (the
 * noteRangeRequests entry point validates and rejects malformed input
 * BEFORE it ever reaches here — a null here means "covers nothing of this
 * file", which is honest, not an error).
 */
export function computeRangeRequestWindow(
  geometry: PlayableFileGeometry,
  request: PlaybackRangeRequest,
): PlaybackWindow | null {
  const span = piecesCoveringFileRange(geometry, request.offsetBytes, request.lengthBytes);
  if (span === null) return null;
  const toByte = Math.min(
    geometry.fileLengthBytes,
    request.offsetBytes + request.lengthBytes,
  );
  return {
    kind: "range-request",
    fromPiece: span.fromPiece,
    toPiece: span.toPiece,
    fromByte: Math.max(0, request.offsetBytes),
    toByte: Math.max(request.offsetBytes + 1, toByte),
    urgency: PIECE_URGENCY.CRITICAL,
    deadlineMs: request.deadlineMs,
  };
}

// ---------------------------------------------------------------------------
// The whole mapping
// ---------------------------------------------------------------------------

/** The scheduler modes that produce playback windows. */
export type PlaybackWindowMode = "startup" | "steady" | "seeking";

/** The inputs of the whole-mapping function. */
export interface PlaybackPlanInput {
  readonly geometry: PlayableFileGeometry;
  readonly config: PlaybackSchedulerConfig;
  readonly mode: PlaybackWindowMode;
  /** The playhead (file-relative bytes). */
  readonly positionBytes: number;
  /** The consumption velocity (file bytes per second; <= 0 means nothing is consumed). */
  readonly bytesPerSecond: number;
  /** The seek target (file-relative bytes; REQUIRED in seeking mode). */
  readonly seekTargetBytes?: number;
  /** The player's explicit range requests (arrival-stamped). */
  readonly rangeRequests?: readonly TrackedRangeRequest[];
}

/**
 * THE DEADLINE MAPPING: the complete window set for the current playback
 * mode. Deterministic and ordered by descending urgency (critical first)
 * so consumers (and tests) can rely on a stable plan shape. Outside the
 * active modes the caller does not call this at all — completion priority
 * is the library's own selection order, not a window set.
 */
export function computePlaybackWindows(input: PlaybackPlanInput): TorrentResult<readonly PlaybackWindow[]> {
  const { geometry, config, mode, positionBytes, bytesPerSecond } = input;
  if (typeof positionBytes !== "number" || !Number.isFinite(positionBytes) || positionBytes < 0) {
    return torrentError("INVALID_INPUT", {
      detail: `computePlaybackWindows: positionBytes must be a finite number >= 0 (got ${String(positionBytes)})`,
    });
  }
  const windows: PlaybackWindow[] = [];
  if (mode === "startup") {
    const startup = computeStartupWindow(geometry, positionBytes, bytesPerSecond, config);
    if (startup !== null) windows.push(startup);
  } else if (mode === "steady") {
    const runway = computeRunwayWindow(geometry, positionBytes, bytesPerSecond, config);
    if (runway !== null) windows.push(runway);
  } else {
    if (typeof input.seekTargetBytes !== "number" || !Number.isFinite(input.seekTargetBytes) || input.seekTargetBytes < 0) {
      return torrentError("INVALID_INPUT", {
        detail: `computePlaybackWindows: seeking mode requires a finite seekTargetBytes >= 0 (got ${String(input.seekTargetBytes)})`,
      });
    }
    const seek = computeSeekWindows(geometry, input.seekTargetBytes, bytesPerSecond, config);
    if (seek.burst !== null) windows.push(seek.burst);
    if (seek.runway !== null) windows.push(seek.runway);
  }
  for (const request of input.rangeRequests ?? []) {
    const window = computeRangeRequestWindow(geometry, request);
    if (window !== null) windows.push(window);
  }
  // Stable urgency sort: critical first, then by fromPiece, then by kind
  // name (full determinism for equal shapes).
  windows.sort((a, b) => {
    if (b.urgency !== a.urgency) return b.urgency - a.urgency;
    if (a.fromPiece !== b.fromPiece) return a.fromPiece - b.fromPiece;
    if (a.toPiece !== b.toPiece) return a.toPiece - b.toPiece;
    return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });
  return { ok: true, value: windows };
}

/**
 * Is a window SATISFIED against a bitfield (every covering piece
 * verified)? The honest fact behind the startup→steady and seeking→steady
 * transitions.
 */
export function windowSatisfied(window: PlaybackWindow, bitfield: Uint8Array): boolean {
  for (let piece = window.fromPiece; piece <= window.toPiece; piece += 1) {
    if (!bitHas(bitfield, piece)) return false;
  }
  return true;
}
