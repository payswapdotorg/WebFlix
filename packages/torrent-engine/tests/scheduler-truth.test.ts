/**
 * R12 — the truthful buffering surface (pure honesty tests).
 *
 * "truthful-buffering honesty tests (stall reported when deadline
 * unreachable)": the verified-contiguous runway law, the at-risk
 * arithmetic (ETA only when a rate exists), the slow-swarm vs
 * no-completion-path distinction, and playableNow's strict
 * verified-bytes gate. What isn't verified is never reported playable.
 */

import { describe, expect, it } from "bun:test";

import { computePlaybackTruth } from "../src/scheduler/truth";
import { PIECE_URGENCY, type PlaybackWindow } from "../src/scheduler/windows";
import type { PlayableFileGeometry } from "../src/scheduler/geometry";
import { bitSet } from "../src/session";

// ---------------------------------------------------------------------------
// The synthetic geometry + helpers
// ---------------------------------------------------------------------------

const PIECE_LENGTH = 16384;
const PLAYABLE_BYTES = PIECE_LENGTH * 14 + 9000; // 238376
const TOTAL_PIECES = 17;

const GEOMETRY: PlayableFileGeometry = {
  fileIndex: 0,
  filePath: "playback-feature-v1/feature.mkv",
  fileOffsetBytes: 0,
  fileLengthBytes: PLAYABLE_BYTES,
  pieceLengthBytes: PIECE_LENGTH,
  totalPieces: TOTAL_PIECES,
};

const ONE_PIECE_PER_SEC = PIECE_LENGTH;

function bitfieldWith(pieces: readonly number[]): Uint8Array {
  const bitfield = new Uint8Array(Math.ceil(TOTAL_PIECES / 8));
  for (const piece of pieces) bitSet(bitfield, piece);
  return bitfield;
}

function startupWindow(): PlaybackWindow {
  return {
    kind: "startup",
    fromPiece: 0,
    toPiece: 7,
    fromByte: 0,
    toByte: 8 * PIECE_LENGTH,
    urgency: PIECE_URGENCY.STARTUP,
  };
}

function runwayWindow(): PlaybackWindow {
  return {
    kind: "runway",
    fromPiece: 0,
    toPiece: 14,
    fromByte: 0,
    toByte: PLAYABLE_BYTES,
    urgency: PIECE_URGENCY.RUNWAY,
  };
}

function rangeRequestWindow(deadlineMs: number): PlaybackWindow {
  return {
    kind: "range-request",
    fromPiece: 12,
    toPiece: 13,
    fromByte: 200_000,
    toByte: 200_000 + 2 * PIECE_LENGTH,
    urgency: PIECE_URGENCY.CRITICAL,
    deadlineMs,
  };
}

const NOW = 1_000_000;

function truth(input: Partial<Parameters<typeof computePlaybackTruth>[0]> = {}) {
  return computePlaybackTruth({
    sessionId: "ts-1",
    schedulerState: "startup",
    geometry: GEOMETRY,
    positionBytes: 0,
    bytesPerSecond: ONE_PIECE_PER_SEC,
    windows: [startupWindow()],
    bitfield: bitfieldWith([]),
    sessionCompleted: false,
    sessionPaused: false,
    connectedPeers: 3,
    downloadBytesPerSec: 0,
    sessionStalled: false,
    stallDurationMs: undefined,
    nowMs: NOW,
    rangeRequests: [],
    ...input,
  });
}

describe("R12 — the runway law (verified contiguous bytes only)", () => {
  it("runway counts ONLY verified contiguous pieces from the playhead", () => {
    // Pieces 0..3 verified: runway = 4 pieces.
    const t = truth({ bitfield: bitfieldWith([0, 1, 2, 3]) });
    expect(t.runway).toEqual({ bytes: 4 * PIECE_LENGTH, seconds: 4 });
    expect(t.availability.contiguousVerifiedToByte).toBe(4 * PIECE_LENGTH);
    expect(t.availability.verifiedPiecesInFile).toBe(4);
    expect(t.availability.totalPiecesInFile).toBe(15);
  });

  it("a single unverified piece STOPS the runway — later verified pieces never count", () => {
    // Pieces 0,1 verified; piece 2 missing; pieces 5..9 verified (a seek
    // burst elsewhere): the runway from byte 0 is exactly 2 pieces.
    const t = truth({ bitfield: bitfieldWith([0, 1, 5, 6, 7, 8, 9]) });
    expect(t.runway!.bytes).toBe(2 * PIECE_LENGTH);
    expect(t.availability.verifiedPiecesInFile).toBe(7); // the horizon is honest
    expect(t.availability.contiguousVerifiedToByte).toBe(2 * PIECE_LENGTH);
  });

  it("an unverified playhead piece means ZERO runway and playableNow false (never a fake buffer)", () => {
    const t = truth({ bitfield: bitfieldWith([1, 2, 3]) });
    expect(t.runway!.bytes).toBe(0);
    expect(t.playableNow).toBe(false);
    expect(t.availability.contiguousVerifiedToByte).toBe(0);
  });

  it("a verified playhead piece means playableNow true (real readable bytes NOW)", () => {
    const t = truth({ bitfield: bitfieldWith([0]) });
    expect(t.playableNow).toBe(true);
    expect(t.runway!.bytes).toBe(PIECE_LENGTH);
  });

  it("a completed session answers the whole remaining file as verified runway", () => {
    const t = truth({
      sessionCompleted: true,
      bitfield: undefined, // no live library session needed — completion IS the verdict
      positionBytes: 100_000,
      windows: [],
      schedulerState: "background-completion",
    });
    expect(t.runway!.bytes).toBe(PLAYABLE_BYTES - 100_000);
    expect(t.playableNow).toBe(true);
    expect(t.availability.verifiedPiecesInFile).toBe(15);
    expect(t.availability.contiguousVerifiedToByte).toBe(PLAYABLE_BYTES);
  });

  it("no declared playback means no runway answer at all (honest not-applicable)", () => {
    const t = truth({ positionBytes: undefined, bytesPerSecond: undefined, windows: [] });
    expect(t.runway).toBeUndefined();
    expect(t.playableNow).toBe(false);
    expect(t.positionBytes).toBeUndefined();
  });
});

describe("R12 — deadlines at risk (the honest arithmetic)", () => {
  it("an unsatisfied startup window with ZERO rate is at risk, with NO fabricated ETA", () => {
    const t = truth({ downloadBytesPerSec: 0, connectedPeers: 0 });
    expect(t.deadlinesAtRisk.length).toBe(1);
    const risk = t.deadlinesAtRisk[0]!;
    expect(risk.kind).toBe("startup");
    expect(risk.remainingBytes).toBe(8 * PIECE_LENGTH); // piece-quantized, honest
    expect(risk.estimatedSecondsToSatisfy).toBeUndefined(); // rate 0: unbounded, not invented
    expect(risk.downloadBytesPerSec).toBe(0);
    expect(risk.reason).toContain("nothing is arriving");
  });

  it("an unsatisfied startup window with a MOVING rate is NOT at risk (progress is real)", () => {
    const t = truth({ downloadBytesPerSec: PIECE_LENGTH });
    expect(t.deadlinesAtRisk).toEqual([]);
  });

  it("a SATISFIED window is never at risk", () => {
    const t = truth({ bitfield: bitfieldWith([0, 1, 2, 3, 4, 5, 6, 7]) });
    expect(t.deadlinesAtRisk).toEqual([]);
  });

  it("the runway depletion projection: honest linear math from instantaneous rates", () => {
    // Playing at 2 pieces/sec, arriving at 1 piece/sec, 8 pieces verified:
    // starvation when V*t = R + D*t → t = R/(V−D) = 8 pieces/(2−1)/sec = 8s.
    const t = truth({
      schedulerState: "steady",
      windows: [runwayWindow()],
      bytesPerSecond: 2 * PIECE_LENGTH,
      downloadBytesPerSec: PIECE_LENGTH,
      bitfield: bitfieldWith([0, 1, 2, 3, 4, 5, 6, 7]),
    });
    expect(t.runway!.bytes).toBe(8 * PIECE_LENGTH);
    expect(t.runway!.seconds).toBe(4); // 8 pieces at 2/sec
    const risk = t.deadlinesAtRisk[0]!;
    expect(risk.kind).toBe("runway");
    expect(risk.remainingBytes).toBe(7 * PIECE_LENGTH); // pieces 8..14
    expect(risk.secondsUntilDepletion).toBe(8); // 131072 bytes / (32768−16384) B/s
    expect(risk.estimatedSecondsToSatisfy).toBe(7); // 7 pieces at 1/sec
  });

  it("a runway the rate can OUTRUN is not at risk", () => {
    const t = truth({
      schedulerState: "steady",
      windows: [runwayWindow()],
      bytesPerSecond: PIECE_LENGTH,
      downloadBytesPerSec: 4 * PIECE_LENGTH,
      bitfield: bitfieldWith([0, 1, 2, 3]),
    });
    expect(t.deadlinesAtRisk).toEqual([]);
  });

  it("a range request that cannot arrive before its deadline is at risk with the deadline echoed", () => {
    const deadline = NOW + 5_000; // 5s from now
    const t = truth({
      windows: [rangeRequestWindow(deadline)],
      downloadBytesPerSec: PIECE_LENGTH / 10, // 20s for 2 pieces — too slow
      bitfield: bitfieldWith([]),
    });
    const risk = t.deadlinesAtRisk.find((r) => r.kind === "range-request")!;
    expect(risk).toBeDefined();
    expect(risk.deadlineMs).toBe(deadline);
    expect(risk.estimatedSecondsToSatisfy).toBe(20); // 2 pieces at 0.1 piece/sec
    expect(risk.reason).toContain("deadline");
  });

  it("a range request that WILL arrive in time is not at risk", () => {
    const t = truth({
      windows: [rangeRequestWindow(NOW + 5_000)],
      downloadBytesPerSec: PIECE_LENGTH, // 2 pieces in 2s < 5s
      bitfield: bitfieldWith([]),
    });
    expect(t.deadlinesAtRisk).toEqual([]);
  });
});

describe("R12 — the stall kinds (slow swarm vs no completion path)", () => {
  it("zero peers = no-completion-path, with R11's stall law riding along", () => {
    const t = truth({
      connectedPeers: 0,
      sessionStalled: true,
      stallDurationMs: 91_000,
      downloadBytesPerSec: 0,
    });
    expect(t.stall.kind).toBe("no-completion-path");
    expect(t.stall.connectedPeers).toBe(0);
    expect(t.stall.sessionStalled).toBe(true);
    expect(t.stall.stallDurationMs).toBe(91_000);
    expect(t.stall.detail).toContain("zero connected peers");
  });

  it("a paused session is no-completion-path (nothing can arrive while paused)", () => {
    const t = truth({ sessionPaused: true, connectedPeers: 5, downloadBytesPerSec: 0 });
    expect(t.stall.kind).toBe("no-completion-path");
    expect(t.stall.detail).toContain("paused");
  });

  it("peers connected + a deadline at risk = slow-swarm (the path exists, it's just slow)", () => {
    const t = truth({
      connectedPeers: 4,
      downloadBytesPerSec: 0, // nothing arriving THIS instant
    });
    expect(t.stall.kind).toBe("slow-swarm");
    expect(t.stall.detail).toContain("slow");
  });

  it("deadlines within reach = none", () => {
    const t = truth({ downloadBytesPerSec: 4 * PIECE_LENGTH });
    expect(t.stall.kind).toBe("none");
  });
});

describe("R12 — the truth answer's shape (what it refuses to fabricate)", () => {
  it("carries the playable file, the playhead, and the scheduler state", () => {
    const t = truth();
    expect(t.sessionId).toBe("ts-1");
    expect(t.schedulerState).toBe("startup");
    expect(t.playableFile).toEqual({
      fileIndex: 0,
      path: "playback-feature-v1/feature.mkv",
      lengthBytes: PLAYABLE_BYTES,
    });
    expect(t.positionBytes).toBe(0);
  });

  it("before geometry exists (pre-metadata) the answer is honestly empty, not zeroed", () => {
    const t = computePlaybackTruth({
      sessionId: "ts-1",
      schedulerState: "idle",
      geometry: undefined,
      positionBytes: undefined,
      bytesPerSecond: undefined,
      windows: [],
      bitfield: undefined,
      sessionCompleted: false,
      sessionPaused: false,
      connectedPeers: 0,
      downloadBytesPerSec: 0,
      sessionStalled: false,
      stallDurationMs: undefined,
      nowMs: NOW,
      rangeRequests: [],
    });
    expect(t.playableFile).toBeUndefined();
    expect(t.runway).toBeUndefined();
    expect(t.availability).toEqual({
      verifiedPiecesInFile: 0,
      totalPiecesInFile: 0,
      contiguousVerifiedToByte: 0,
    });
    expect(t.deadlinesAtRisk).toEqual([]);
    expect(t.playableNow).toBe(false);
  });

  it("a playhead at EOF is honestly not playable (the file is over)", () => {
    const t = truth({ positionBytes: PLAYABLE_BYTES, bitfield: bitfieldWith([0]) });
    expect(t.playableNow).toBe(false);
    expect(t.runway).toBeUndefined();
  });
});
