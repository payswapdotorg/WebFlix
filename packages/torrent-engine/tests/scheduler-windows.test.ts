/**
 * R12 — the deadline mapping (pure window computation tests).
 *
 * "deadline-mapping unit tests (startup/seek/steady windows from
 * synthetic range traces)": a synthetic playable-file geometry in the
 * PLAYBACK_FEATURE shape (piece length 16384; a playable file spanning
 * pieces 0..14 of a 17-piece torrent; the sidecar file shares the
 * boundary piece), with exact assertions on the window piece ranges,
 * byte spans, urgencies, clamping, and the completion fallback.
 */

import { describe, expect, it } from "bun:test";

import {
  computePlaybackWindows,
  computeRangeRequestWindow,
  computeRunwayWindow,
  computeSeekWindows,
  computeStartupWindow,
  windowSatisfied,
  PIECE_URGENCY,
  type PlaybackWindow,
} from "../src/scheduler/windows";
import {
  fileByteToPiece,
  geometryForFile,
  piecesCoveringFileRange,
  firstPieceOf,
  lastPieceOf,
  fileBytesIntersectingPieceSpan,
  type PlayableFileGeometry,
} from "../src/scheduler/geometry";
import { DEFAULT_PLAYBACK_SCHEDULER_CONFIG } from "../src/scheduler/config";
import { bitSet } from "../src/session";
import type { TorrentFileEntry } from "../src/metadata";

// ---------------------------------------------------------------------------
// The synthetic geometry (PLAYBACK_FEATURE's exact shape)
// ---------------------------------------------------------------------------

const PIECE_LENGTH = 16384;
const PLAYABLE_BYTES = PIECE_LENGTH * 14 + 9000; // 238376
const SIDECAR_BYTES = PIECE_LENGTH * 2 + 3000; // 35768

const FILES: readonly TorrentFileEntry[] = [
  { path: "playback-feature-v1/feature.mkv", name: "feature.mkv", lengthBytes: PLAYABLE_BYTES, offsetBytes: 0 },
  { path: "playback-feature-v1/trailer.mp4", name: "trailer.mp4", lengthBytes: SIDECAR_BYTES, offsetBytes: PLAYABLE_BYTES },
];

const TOTAL_BYTES = PLAYABLE_BYTES + SIDECAR_BYTES; // 274144
const TOTAL_PIECES = Math.ceil(TOTAL_BYTES / PIECE_LENGTH); // 17

function playableGeometry(): PlayableFileGeometry {
  const resolved = geometryForFile(FILES, 0, PIECE_LENGTH, TOTAL_PIECES);
  if (!resolved.ok) throw new Error("the synthetic geometry must resolve");
  return resolved.value;
}

/** One piece per second — the arithmetic's friendliest honest velocity. */
const ONE_PIECE_PER_SEC = PIECE_LENGTH;
const CONFIG = DEFAULT_PLAYBACK_SCHEDULER_CONFIG;

describe("R12 — the byte↔piece geometry map", () => {
  /** Unwrapping helper (the happy path must hold or the fixture is wrong). */
  const pieceOf = (offset: number): number => {
    const result = fileByteToPiece(playableGeometry(), offset);
    if (!result.ok) throw new Error(`fileByteToPiece(${offset}) must succeed`);
    return result.value;
  };

  it("maps file bytes to absolute pieces (floor over the torrent stream)", () => {
    expect(pieceOf(0)).toBe(0);
    expect(pieceOf(PIECE_LENGTH - 1)).toBe(0);
    expect(pieceOf(PIECE_LENGTH)).toBe(1);
    // 200000 lives in piece 12 ([196608, 212992))
    expect(pieceOf(200_000)).toBe(12);
    // the file's LAST byte lives in piece 14
    expect(pieceOf(PLAYABLE_BYTES - 1)).toBe(14);
  });

  it("fileByteToPiece rejects out-of-file bytes (typed, never a fabricated piece)", () => {
    const geometry = playableGeometry();
    for (const bad of [-1, PLAYABLE_BYTES, PLAYABLE_BYTES + 5, 1.5]) {
      const result = fileByteToPiece(geometry, bad);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_INPUT");
    }
  });

  it("the playable file's piece span is first..last (0..14 of the 17-piece torrent)", () => {
    const geometry = playableGeometry();
    expect(firstPieceOf(geometry)).toBe(0);
    expect(lastPieceOf(geometry)).toBe(14);
  });

  it("piecesCoveringFileRange clamps to the file and answers null for empty/past-EOF ranges", () => {
    const geometry = playableGeometry();
    expect(piecesCoveringFileRange(geometry, 0, PLAYABLE_BYTES)).toEqual({ fromPiece: 0, toPiece: 14 });
    // A range near EOF clamps its length to the file's end.
    expect(piecesCoveringFileRange(geometry, 230_000, 1_000_000)).toEqual({ fromPiece: 14, toPiece: 14 });
    expect(piecesCoveringFileRange(geometry, PLAYABLE_BYTES, 100)).toBeNull();
    expect(piecesCoveringFileRange(geometry, 0, 0)).toBeNull();
    expect(piecesCoveringFileRange(geometry, -5, 10)).toBeNull();
  });

  it("a boundary piece's file intersection is the file's own byte subset (never the neighbor's)", () => {
    const geometry = playableGeometry();
    // Piece 14 spans [229376, 245760) of the stream — the playable file
    // owns only [229376, 238376) of it.
    const intersection = fileBytesIntersectingPieceSpan(geometry, { fromPiece: 14, toPiece: 14 });
    expect(intersection).toEqual({ fromByte: 229_376, toByte: PLAYABLE_BYTES });
  });

  it("geometryForFile rejects malformed geometry (typed, total for garbage)", () => {
    expect(geometryForFile(FILES, 2, PIECE_LENGTH, TOTAL_PIECES).ok).toBe(false);
    expect(geometryForFile(FILES, -1, PIECE_LENGTH, TOTAL_PIECES).ok).toBe(false);
    expect(geometryForFile(FILES, 0, 0, TOTAL_PIECES).ok).toBe(false);
    expect(geometryForFile(FILES, 0, PIECE_LENGTH, 0).ok).toBe(false);
    // A file extending past the piece domain is a metainfo that disagrees
    // with itself — rejected, never papered over.
    const lying: readonly TorrentFileEntry[] = [
      { path: "x", name: "x", lengthBytes: PIECE_LENGTH * 5, offsetBytes: 0 },
    ];
    expect(geometryForFile(lying, 0, PIECE_LENGTH, 2).ok).toBe(false);
  });
});

describe("R12 — the startup window (first-paint fast)", () => {
  it("covers [position, position + velocity * startupTargetSeconds) at STARTUP urgency", () => {
    const geometry = playableGeometry();
    // 8s at one piece/sec = 8 pieces from byte 0.
    const window = computeStartupWindow(geometry, 0, ONE_PIECE_PER_SEC, CONFIG);
    expect(window).toEqual({
      kind: "startup",
      fromPiece: 0,
      toPiece: 7,
      fromByte: 0,
      toByte: 8 * PIECE_LENGTH,
      urgency: PIECE_URGENCY.STARTUP,
    });
  });

  it("anchors at the playhead (resume mid-file)", () => {
    const geometry = playableGeometry();
    // From byte 200000 (piece 12), 8 pieces ahead = pieces 12..19 clamped
    // to the file's last piece 14.
    const window = computeStartupWindow(geometry, 200_000, ONE_PIECE_PER_SEC, CONFIG)!;
    expect(window.fromPiece).toBe(12);
    expect(window.toPiece).toBe(19 - 5); // min(19, file last 14) = 14
    expect(window.toPiece).toBe(14);
    expect(window.fromByte).toBe(200_000);
  });

  it("a non-playing velocity produces NO window (nothing consumed, nothing needed)", () => {
    const geometry = playableGeometry();
    expect(computeStartupWindow(geometry, 0, 0, CONFIG)).toBeNull();
    expect(computeStartupWindow(geometry, 0, -100, CONFIG)).toBeNull();
    expect(computeStartupWindow(geometry, 0, Number.NaN, CONFIG)).toBeNull();
  });

  it("a playhead at/past EOF produces no window (the file is over)", () => {
    const geometry = playableGeometry();
    expect(computeStartupWindow(geometry, PLAYABLE_BYTES, ONE_PIECE_PER_SEC, CONFIG)).toBeNull();
  });
});

describe("R12 — the steady-state runway window", () => {
  it("covers [position, position + velocity * steadyRunwaySeconds), clamped at EOF", () => {
    const geometry = playableGeometry();
    // 30s at one piece/sec = 491520 bytes — clamped to the file's 238376.
    const window = computeRunwayWindow(geometry, 0, ONE_PIECE_PER_SEC, CONFIG)!;
    expect(window.kind).toBe("runway");
    expect(window.urgency).toBe(PIECE_URGENCY.RUNWAY);
    expect(window.fromPiece).toBe(0);
    expect(window.toPiece).toBe(14);
    expect(window.fromByte).toBe(0);
    expect(window.toByte).toBe(PLAYABLE_BYTES);
  });

  it("slides with the playhead", () => {
    const geometry = playableGeometry();
    const window = computeRunwayWindow(geometry, 100_000, ONE_PIECE_PER_SEC, CONFIG)!;
    expect(window.fromPiece).toBe(6); // 100000 / 16384 = 6.1
    expect(window.toPiece).toBe(14);
  });
});

describe("R12 — the seek window (burst around the target)", () => {
  it("bursts seekBurstPieces pieces from the target's piece at CRITICAL urgency, clamped to the FILE's last piece", () => {
    const geometry = playableGeometry();
    const { burst, runway } = computeSeekWindows(geometry, 200_000, ONE_PIECE_PER_SEC, CONFIG);
    expect(burst).toEqual({
      kind: "seek-burst",
      fromPiece: 12,
      toPiece: 14, // 12 + 8 - 1 = 19 clamped to the file's last piece 14
      fromByte: 200_000,
      toByte: PLAYABLE_BYTES,
      urgency: PIECE_URGENCY.CRITICAL,
    });
    // The runway re-anchors at the target.
    expect(runway!.kind).toBe("runway");
    expect(runway!.fromPiece).toBe(12);
    expect(runway!.toPiece).toBe(14);
    expect(runway!.urgency).toBe(PIECE_URGENCY.RUNWAY);
  });

  it("a seek near EOF bursts fewer pieces (the honest clamp, not a fabricated range)", () => {
    const geometry = playableGeometry();
    const { burst } = computeSeekWindows(geometry, PLAYABLE_BYTES - 100, ONE_PIECE_PER_SEC, CONFIG);
    expect(burst!.fromPiece).toBe(14);
    expect(burst!.toPiece).toBe(14);
  });

  it("a seek target past EOF clamps to the last byte (the player meant the end)", () => {
    const geometry = playableGeometry();
    const { burst } = computeSeekWindows(geometry, PLAYABLE_BYTES + 50_000, ONE_PIECE_PER_SEC, CONFIG);
    expect(burst).not.toBeNull();
    expect(burst!.fromPiece).toBe(14);
  });
});

describe("R12 — the player's explicit range requests", () => {
  it("become CRITICAL windows carrying their own deadlines", () => {
    const geometry = playableGeometry();
    const window = computeRangeRequestWindow(geometry, {
      offsetBytes: 200_000,
      lengthBytes: PIECE_LENGTH, // [200000, 216384) — pieces 12..13
      deadlineMs: 123_456,
    })!;
    expect(window).toEqual({
      kind: "range-request",
      fromPiece: 12,
      toPiece: 13,
      fromByte: 200_000,
      toByte: 200_000 + PIECE_LENGTH,
      urgency: PIECE_URGENCY.CRITICAL,
      deadlineMs: 123_456,
    });
  });

  it("a request covering nothing of the file answers null (honest empty)", () => {
    const geometry = playableGeometry();
    expect(
      computeRangeRequestWindow(geometry, { offsetBytes: PLAYABLE_BYTES, lengthBytes: 10, deadlineMs: 1 }),
    ).toBeNull();
  });
});

describe("R12 — the whole-plan mapping (computePlaybackWindows)", () => {
  it("startup mode: the startup window plus range requests, urgency-ordered", () => {
    const geometry = playableGeometry();
    const plan = computePlaybackWindows({
      geometry,
      config: CONFIG,
      mode: "startup",
      positionBytes: 0,
      bytesPerSecond: ONE_PIECE_PER_SEC,
      rangeRequests: [
        { offsetBytes: 200_000, lengthBytes: PIECE_LENGTH, deadlineMs: 999, receivedAtMs: 0 },
      ],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.map((w) => [w.kind, w.urgency])).toEqual([
      ["range-request", PIECE_URGENCY.CRITICAL], // critical first
      ["startup", PIECE_URGENCY.STARTUP],
    ]);
  });

  it("steady mode: the runway window", () => {
    const geometry = playableGeometry();
    const plan = computePlaybackWindows({
      geometry,
      config: CONFIG,
      mode: "steady",
      positionBytes: 0,
      bytesPerSecond: ONE_PIECE_PER_SEC,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.length).toBe(1);
    expect(plan.value[0]!.kind).toBe("runway");
  });

  it("seeking mode: the burst at critical, the runway behind it", () => {
    const geometry = playableGeometry();
    const plan = computePlaybackWindows({
      geometry,
      config: CONFIG,
      mode: "seeking",
      positionBytes: 0,
      bytesPerSecond: ONE_PIECE_PER_SEC,
      seekTargetBytes: 200_000,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.map((w) => [w.kind, w.urgency])).toEqual([
      ["seek-burst", PIECE_URGENCY.CRITICAL],
      ["runway", PIECE_URGENCY.RUNWAY],
    ]);
  });

  it("seeking mode without a target is a typed rejection (never a fabricated anchor)", () => {
    const geometry = playableGeometry();
    const plan = computePlaybackWindows({
      geometry,
      config: CONFIG,
      mode: "seeking",
      positionBytes: 0,
      bytesPerSecond: ONE_PIECE_PER_SEC,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error.code).toBe("INVALID_INPUT");
  });

  it("a malformed position is a typed rejection", () => {
    const geometry = playableGeometry();
    const plan = computePlaybackWindows({
      geometry,
      config: CONFIG,
      mode: "steady",
      positionBytes: -1,
      bytesPerSecond: ONE_PIECE_PER_SEC,
    });
    expect(plan.ok).toBe(false);
  });
});

describe("R12 — window satisfaction (the fact behind state transitions)", () => {
  it("a window is satisfied iff EVERY covering piece is verified", () => {
    const window: PlaybackWindow = {
      kind: "startup",
      fromPiece: 0,
      toPiece: 3,
      fromByte: 0,
      toByte: 4 * PIECE_LENGTH,
      urgency: PIECE_URGENCY.STARTUP,
    };
    const bitfield = new Uint8Array(Math.ceil(TOTAL_PIECES / 8));
    expect(windowSatisfied(window, bitfield)).toBe(false);
    bitSet(bitfield, 0);
    bitSet(bitfield, 1);
    bitSet(bitfield, 2);
    expect(windowSatisfied(window, bitfield)).toBe(false); // piece 3 still missing
    bitSet(bitfield, 3);
    expect(windowSatisfied(window, bitfield)).toBe(true);
  });
});
