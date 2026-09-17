/**
 * @wfx/torrent-engine — the truthful buffering surface (R12, PURE CORE).
 *
 * INVARIANT 10 FAMILY (the freeze): "when the swarm cannot meet a
 * deadline, the scheduler reports the honest state (stall/buffering with
 * reasons) — never a fabricated 'buffering' that is actually dead, never
 * playback of unverified bytes."
 *
 * WHAT THIS MODULE COMPUTES (and what it REFUSES to fabricate):
 *
 * - RUNWAY: the verified CONTIGUOUS bytes ahead of the playhead, in bytes
 *   and seconds. Only pieces whose bits are SET in the live library
 *   bitfield count — a single unverified piece stops the runway dead.
 *   Nothing is smoothed, extrapolated, or rounded up. What isn't verified
 *   is not reported playable.
 * - DEADLINES AT RISK: every active window that cannot be met at the
 *   current transfer rate, with the honest arithmetic (remaining bytes,
 *   the rate, the ETA when computable, the depletion projection for the
 *   runway). An ETA is only reported when the rate is > 0 — a zero rate
 *   answers `estimatedSecondsToSatisfy: undefined`, the honest
 *   "unbounded", never a fabricated number.
 * - STALL KIND: the dispatch's distinction — "slow swarm" (peers are
 *   connected and bytes ARE arriving, just slower than playback consumes)
 *   vs "no completion path" (zero connected peers, a paused session, or
 *   otherwise nothing that can deliver a byte right now). R11's own stall
 *   law (`stalled` + duration) rides along verbatim.
 * - PLAYABLE NOW: whether the bytes at the playhead are verified — the
 *   strict, honest "the player can read something real right now" bit.
 */

import { bitHas } from "../session";
import type { PlayableFileGeometry } from "./geometry";
import { fileBytesIntersectingPieceSpan, lastPieceOf } from "./geometry";
import type { PlaybackSchedulerState } from "./state-machine";
import type { PlaybackWindow, TrackedRangeRequest } from "./windows";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The honest stall taxonomy (the dispatch's distinction). */
export type PlaybackStallKind = "none" | "slow-swarm" | "no-completion-path";

/** One playback deadline that cannot be met, with the honest arithmetic. */
export interface PlaybackDeadlineRisk {
  /** Which window is at risk. */
  readonly kind: PlaybackWindow["kind"];
  /** The window's file-relative byte span. */
  readonly fromByte: number;
  readonly toByte: number;
  /** Unverified bytes of media in the window (piece-quantized, honest). */
  readonly remainingBytes: number;
  /** The playback consumption rate (bytes/sec; the deadline's opponent). */
  readonly consumptionBytesPerSec: number;
  /** The transfer rate RIGHT NOW (bytes/sec; 0 when nothing arrives). */
  readonly downloadBytesPerSec: number;
  /**
   * ETA in seconds at the current rate. ABSENT when the rate is 0 — no
   * fabricated ETA for a dead swarm.
   */
  readonly estimatedSecondsToSatisfy?: number;
  /** For runway risks: when the playhead starves at current rates. */
  readonly secondsUntilDepletion?: number;
  /** The wall-clock deadline, when the demand carried one. */
  readonly deadlineMs?: number;
  /** The honest sentence (why this deadline cannot be met). */
  readonly reason: string;
}

/** The piece-availability horizon (how far verified bytes extend). */
export interface PlaybackAvailability {
  /** Verified pieces among the playable file's covering pieces. */
  readonly verifiedPiecesInFile: number;
  /** Total pieces that cover the playable file. */
  readonly totalPiecesInFile: number;
  /**
   * The file-relative byte offset where the verified CONTIGUOUS run from
   * the playhead ends (equals `positionBytes` when the very next piece is
   * unverified — the honest "nothing ahead is ready").
   */
  readonly contiguousVerifiedToByte: number;
}

/** The honest, total buffering-truth answer for one scheduled session. */
export interface PlaybackBufferingTruth {
  readonly sessionId: string;
  readonly schedulerState: PlaybackSchedulerState;
  /** The playable file being scheduled (absent before any command). */
  readonly playableFile?:
    | {
        readonly fileIndex: number;
        readonly path: string;
        readonly lengthBytes: number;
      }
    | undefined;
  /** The playhead (file-relative bytes; absent before any command). */
  readonly positionBytes?: number;
  /**
   * The verified contiguous runway ahead of the playhead. Absent when no
   * playback has been declared (idle/background) — an honest "not
   * applicable", never a fake zero-runway "playing" answer.
   */
  readonly runway?:
    | {
        readonly bytes: number;
        readonly seconds: number;
      }
    | undefined;
  /** The piece-availability horizon. */
  readonly availability: PlaybackAvailability;
  /** Every deadline that cannot be met at the current rate. */
  readonly deadlinesAtRisk: readonly PlaybackDeadlineRisk[];
  /** The stall truth (slow swarm vs no completion path). */
  readonly stall: {
    readonly kind: PlaybackStallKind;
    readonly connectedPeers: number;
    readonly downloadBytesPerSec: number;
    /** R11's stall law, verbatim (downloading + 0 peers past threshold). */
    readonly sessionStalled: boolean;
    readonly stallDurationMs?: number;
    readonly detail: string;
  };
  /** Whether the bytes at the playhead are verified (readable NOW). */
  readonly playableNow: boolean;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Everything the truth computation needs (all injected, all honest). */
export interface PlaybackTruthInput {
  readonly sessionId: string;
  readonly schedulerState: PlaybackSchedulerState;
  readonly geometry: PlayableFileGeometry | undefined;
  readonly positionBytes: number | undefined;
  readonly bytesPerSecond: number | undefined;
  readonly windows: readonly PlaybackWindow[];
  /** The live verified-piece bitfield (undefined when no library session exists). */
  readonly bitfield: Uint8Array | undefined;
  /** Whether the session completed (every selected piece verified + digested). */
  readonly sessionCompleted: boolean;
  /** Whether the torrent session is user-paused (R11 seeding-paused). */
  readonly sessionPaused: boolean;
  readonly connectedPeers: number;
  readonly downloadBytesPerSec: number;
  readonly sessionStalled: boolean;
  readonly stallDurationMs: number | undefined;
  readonly nowMs: number;
  readonly rangeRequests: readonly TrackedRangeRequest[];
}

// ---------------------------------------------------------------------------
// The computation (pure)
// ---------------------------------------------------------------------------

/**
 * THE TRUTHFUL BUFFERING ANSWER. Every number comes from the inputs
 * (bitfield, rates, geometry) — nothing invented. See the module docs for
 * the honesty laws.
 */
export function computePlaybackTruth(input: PlaybackTruthInput): PlaybackBufferingTruth {
  const { geometry, positionBytes, bytesPerSecond, bitfield, sessionCompleted } = input;

  // --- availability + runway -------------------------------------------------

  const availability: PlaybackAvailability = geometry === undefined
    ? { verifiedPiecesInFile: 0, totalPiecesInFile: 0, contiguousVerifiedToByte: 0 }
    : computeAvailability(geometry, positionBytes, bitfield, sessionCompleted);

  let runway: PlaybackBufferingTruth["runway"];
  let playableNow = false;
  if (geometry !== undefined && positionBytes !== undefined && positionBytes < geometry.fileLengthBytes) {
    const runwayBytes = Math.max(0, availability.contiguousVerifiedToByte - positionBytes);
    const velocity = bytesPerSecond !== undefined && bytesPerSecond > 0 ? bytesPerSecond : undefined;
    runway = {
      bytes: runwayBytes,
      seconds: velocity !== undefined ? runwayBytes / velocity : 0,
    };
    const playheadPiece = Math.floor(
      (geometry.fileOffsetBytes + positionBytes) / geometry.pieceLengthBytes,
    );
    playableNow = sessionCompleted || (bitfield !== undefined && bitHas(bitfield, playheadPiece));
  }

  // --- deadlines at risk -----------------------------------------------------

  const velocity = bytesPerSecond !== undefined && bytesPerSecond > 0 ? bytesPerSecond : 0;
  const deadlinesAtRisk: PlaybackDeadlineRisk[] = [];
  for (const window of input.windows) {
    const risk = windowRisk(window, {
      geometry,
      bitfield,
      sessionCompleted,
      velocity,
      rate: input.downloadBytesPerSec,
      nowMs: input.nowMs,
      runwaySeconds: runway !== undefined ? runway.seconds : undefined,
    });
    if (risk !== null) deadlinesAtRisk.push(risk);
  }

  // --- stall kind --------------------------------------------------------------

  // The honest completion-path question: can ANY byte arrive right now?
  // Peers ARE the path — a momentarily-zero rate with connected peers is
  // "slow", not "dead"; a paused session can deliver nothing by definition.
  const noBytesCanArrive = input.sessionPaused || input.connectedPeers === 0;
  let stallKind: PlaybackStallKind = "none";
  let detail = "playback deadlines are within reach of the current transfer rate";
  if (noBytesCanArrive) {
    stallKind = "no-completion-path";
    detail = input.sessionPaused
      ? "the torrent session is paused — no bytes can arrive while paused (completion priority is retained; resume continues the session)"
      : `zero connected peers — no completion path exists right now (${input.sessionStalled ? `stalled for ${String(input.stallDurationMs)} ms` : "below the session stall threshold so far"}); deadlines cannot be met until a peer connects`;
  } else if (deadlinesAtRisk.length > 0) {
    stallKind = "slow-swarm";
    const worst = deadlinesAtRisk[0]!;
    detail = `slow swarm: bytes can arrive (peers connected) but the ${worst.kind} deadline is at risk — ${worst.reason}`;
  }

  return {
    sessionId: input.sessionId,
    schedulerState: input.schedulerState,
    ...(geometry !== undefined
      ? {
          playableFile: {
            fileIndex: geometry.fileIndex,
            path: geometry.filePath,
            lengthBytes: geometry.fileLengthBytes,
          },
        }
      : {}),
    ...(positionBytes !== undefined ? { positionBytes } : {}),
    ...(runway !== undefined ? { runway } : {}),
    availability,
    deadlinesAtRisk,
    stall: {
      kind: stallKind,
      connectedPeers: input.connectedPeers,
      downloadBytesPerSec: input.downloadBytesPerSec,
      sessionStalled: input.sessionStalled,
      ...(input.stallDurationMs !== undefined ? { stallDurationMs: input.stallDurationMs } : {}),
      detail,
    },
    playableNow,
  };
}

// ---------------------------------------------------------------------------
// Internals (pure)
// ---------------------------------------------------------------------------

/** The availability horizon of the playable file from the playhead. */
function computeAvailability(
  geometry: PlayableFileGeometry,
  positionBytes: number | undefined,
  bitfield: Uint8Array | undefined,
  sessionCompleted: boolean,
): PlaybackAvailability {
  const first = Math.floor(geometry.fileOffsetBytes / geometry.pieceLengthBytes);
  const last = lastPieceOf(geometry);
  const total = last - first + 1;
  let verified = 0;
  for (let piece = first; piece <= last; piece += 1) {
    if (sessionCompleted || (bitfield !== undefined && bitHas(bitfield, piece))) verified += 1;
  }
  if (sessionCompleted) {
    return {
      verifiedPiecesInFile: verified,
      totalPiecesInFile: total,
      contiguousVerifiedToByte: geometry.fileLengthBytes,
    };
  }
  if (bitfield === undefined || positionBytes === undefined) {
    return { verifiedPiecesInFile: verified, totalPiecesInFile: total, contiguousVerifiedToByte: 0 };
  }
  const startPiece = Math.floor((geometry.fileOffsetBytes + Math.max(0, Math.min(positionBytes, geometry.fileLengthBytes))) / geometry.pieceLengthBytes);
  let contiguousEndPiece = startPiece - 1;
  for (let piece = startPiece; piece <= last; piece += 1) {
    if (!bitHas(bitfield, piece)) break;
    contiguousEndPiece = piece;
  }
  if (contiguousEndPiece < startPiece) {
    // The very piece at the playhead is unverified: nothing ahead is ready
    // (the honest zero — later verified pieces do NOT count as runway).
    return {
      verifiedPiecesInFile: verified,
      totalPiecesInFile: total,
      contiguousVerifiedToByte: Math.max(0, Math.min(positionBytes, geometry.fileLengthBytes)),
    };
  }
  const span = fileBytesIntersectingPieceSpan(geometry, {
    fromPiece: startPiece,
    toPiece: contiguousEndPiece,
  });
  const toByte = span !== null ? span.toByte : Math.max(0, Math.min(positionBytes, geometry.fileLengthBytes));
  return {
    verifiedPiecesInFile: verified,
    totalPiecesInFile: total,
    contiguousVerifiedToByte: Math.max(
      Math.max(0, Math.min(positionBytes, geometry.fileLengthBytes)),
      toByte,
    ),
  };
}

/** The at-risk computation for one window (null when the deadline is met). */
function windowRisk(
  window: PlaybackWindow,
  context: {
    geometry: PlayableFileGeometry | undefined;
    bitfield: Uint8Array | undefined;
    sessionCompleted: boolean;
    velocity: number;
    rate: number;
    nowMs: number;
    runwaySeconds: number | undefined;
  },
): PlaybackDeadlineRisk | null {
  const { geometry, bitfield, sessionCompleted, velocity, rate, nowMs } = context;
  if (geometry === undefined) return null;
  if (sessionCompleted) return null;
  if (bitfield !== undefined) {
    let satisfied = true;
    for (let piece = window.fromPiece; piece <= window.toPiece; piece += 1) {
      if (!bitHas(bitfield, piece)) {
        satisfied = false;
        break;
      }
    }
    if (satisfied) return null;
  }
  // Unverified bytes, piece-quantized against the file's own span.
  const intersection = fileBytesIntersectingPieceSpan(geometry, {
    fromPiece: window.fromPiece,
    toPiece: window.toPiece,
  });
  let unverifiedPieces = 0;
  if (bitfield !== undefined) {
    for (let piece = window.fromPiece; piece <= window.toPiece; piece += 1) {
      if (!bitHas(bitfield, piece)) unverifiedPieces += 1;
    }
  } else {
    unverifiedPieces = window.toPiece - window.fromPiece + 1;
  }
  const remainingBytes = Math.min(
    unverifiedPieces * geometry.pieceLengthBytes,
    intersection !== null ? intersection.toByte - intersection.fromByte : unverifiedPieces * geometry.pieceLengthBytes,
  );
  if (remainingBytes <= 0) return null;

  const eta = rate > 0 ? remainingBytes / rate : undefined;
  const base: PlaybackDeadlineRisk = {
    kind: window.kind,
    fromByte: window.fromByte,
    toByte: window.toByte,
    remainingBytes,
    consumptionBytesPerSec: velocity,
    downloadBytesPerSec: rate,
    ...(eta !== undefined ? { estimatedSecondsToSatisfy: eta } : {}),
    ...(window.deadlineMs !== undefined ? { deadlineMs: window.deadlineMs } : {}),
    reason: "",
  };

  if (window.kind === "runway") {
    // The runway depletes when consumption outruns supply.
    if (rate >= velocity) return null; // keeping up — no risk
    const runwaySeconds = context.runwaySeconds ?? 0;
    const depletion = velocity > rate ? (runwaySeconds * velocity) / (velocity - rate) : undefined;
    return {
      ...base,
      ...(depletion !== undefined ? { secondsUntilDepletion: depletion } : {}),
      reason:
        rate <= 0
          ? `the runway needs ${String(remainingBytes)} more verified bytes and nothing is arriving (0 B/s)`
          : `the runway needs ${String(remainingBytes)} more verified bytes; arrival (${String(Math.round(rate))} B/s) is slower than consumption (${String(Math.round(velocity))} B/s)`,
    };
  }
  if (window.kind === "range-request" && window.deadlineMs !== undefined) {
    if (eta !== undefined && nowMs + eta * 1000 <= window.deadlineMs) return null; // met in time
    return {
      ...base,
      reason:
        eta === undefined
          ? `the player's range [${String(window.fromByte)}, ${String(window.toByte)}) cannot arrive before its deadline — nothing is transferring`
          : `the player's range [${String(window.fromByte)}, ${String(window.toByte)}) needs ~${eta.toFixed(1)}s at the current rate but its deadline is in ${((window.deadlineMs - nowMs) / 1000).toFixed(1)}s`,
    };
  }
  // startup / seek-burst: the demand is "as soon as possible" with no
  // wall-clock deadline of its own. It CANNOT be met only when nothing is
  // arriving (rate <= 0); a moving swarm is progressing toward it, and the
  // truth's rates/availability carry the honest pace.
  if (rate > 0) return null;
  return {
    ...base,
    reason: `the ${window.kind} window [${String(window.fromByte)}, ${String(window.toByte)}) needs ${String(remainingBytes)} verified bytes and nothing is arriving right now`,
  };
}
