/**
 * R12 — the playback-aware scheduler through the ENGINE (integration).
 *
 * The golden-path evidence, all against the deterministic loopback double
 * (no swarm, no timers — the R11 testing contract):
 * - deadline mapping drives REAL library priorities (startup window,
 *   seek burst, runway, range requests, completion fallback);
 * - pieces arrive in WATCH ORDER (the seek target lands before piece 0);
 * - ordered integrity-gated reads: verified ranges serve REAL bytes,
 *   unverified ranges are typed `UNVERIFIED_RANGE` refusals;
 * - the truthful buffering surface answers honest numbers end-to-end
 *   (stall kinds, at-risk arithmetic, the verified-contiguous runway);
 * - the state machine transitions on commands and FACTS, with typed
 *   refusals for illegal host behavior.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { authorizeProvenance, createAuthorizedSourceRegistry } from "../src/provenance";
import { createTorrentEngine, type TorrentEngine } from "../src/engine";
import { LoopbackTorrentLibrary, scriptLoopbackSession } from "./helpers/loopback-library";
import { statusOf } from "./helpers/status";
import {
  PLAYBACK_FEATURE,
  fixtureContent,
  fixtureMagnetUri,
  fixtureTorrentBytes,
} from "./helpers/fixtures";
import { TorrentEngineError } from "../src/errors";

const TMP = join(import.meta.dir, "tmp-scheduler");

const sources = createAuthorizedSourceRegistry({
  sources: [{ sourceId: "vault:family-media", basis: "user-owned", label: "Family media vault" }],
});
const PROVENANCE = (() => {
  const minted = authorizeProvenance(sources, "vault:family-media");
  if (!minted.ok) throw new Error("fixture provenance must mint");
  return minted.value;
})();

/** The fixture's geometry (piece length 16384; playable file = pieces 0..14 of 17). */
const PIECE = 16384;
const PLAYABLE_BYTES = PIECE * 14 + 9000;
const ONE_PIECE_PER_SEC = PIECE;
const DEFAULTS = { startupTargetSeconds: 8, steadyRunwaySeconds: 30, seekBurstPieces: 8 };

let engineCounter = 0;
let clockMs = 0;

function newEngine(
  library: LoopbackTorrentLibrary,
  schedulerConfig?: typeof DEFAULTS,
): TorrentEngine {
  engineCounter += 1;
  clockMs = 0;
  return createTorrentEngine({
    library,
    dataRoot: join(TMP, `engine-${engineCounter}`),
    sources,
    clock: () => clockMs,
    stallThresholdMs: 5_000,
    ...(schedulerConfig !== undefined ? { schedulerConfig } : {}),
  });
}

/** Create a session selecting the playable file (index 0). */
async function createPlayableSession(engine: TorrentEngine): Promise<string> {
  const ingested = await engine.ingestTorrentFile(fixtureTorrentBytes(PLAYBACK_FEATURE), PROVENANCE);
  if (!ingested.ok) throw new Error("ingestion must succeed");
  const created = await engine.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
  if (!created.ok) throw new Error("session must be created");
  return created.value.sessionId;
}

/** The currently verified pieces of the (single) live loopback session. */
function verifiedPieces(library: LoopbackTorrentLibrary): Set<number> {
  const session = library.liveSessions()[0];
  if (session === undefined) return new Set();
  const bitfield = session.snapshot().bitfield;
  const out = new Set<number>();
  for (let piece = 0; piece < 17; piece += 1) {
    const byte = bitfield[piece >> 3];
    if (byte !== undefined && (byte & (0x80 >> (piece & 7))) !== 0) out.add(piece);
  }
  return out;
}

/** Advance N times, recording the order pieces land (the watch-order evidence). */
function advanceRecordingOrder(library: LoopbackTorrentLibrary, times: number): number[] {
  const order: number[] = [];
  for (let i = 0; i < times; i += 1) {
    const before = verifiedPieces(library);
    library.advanceAll();
    for (const piece of verifiedPieces(library)) {
      if (!before.has(piece)) order.push(piece);
    }
  }
  return order;
}

function expectOk<T>(result: { ok: true; value: T } | { ok: false; error: TorrentEngineError }): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.detail}`);
  return result.value;
}

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("R12 — deadline mapping drives real library priorities", () => {
  it("a start command pushes the startup window onto the library", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(PLAYBACK_FEATURE);
    const engine = newEngine(library, DEFAULTS);
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", "ts-1", "data"), {
      piecesPerAdvance: 0,
      peersAt: () => 3,
    });
    const sessionId = await createPlayableSession(engine);

    const status = expectOk(
      engine.playback.command(sessionId, {
        kind: "start",
        positionBytes: 0,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );
    expect(status.schedulerState).toBe("startup");
    expect(status.windows).toEqual([
      {
        kind: "startup",
        fromPiece: 0,
        toPiece: 7, // 8s at one piece/sec
        fromByte: 0,
        toByte: 8 * PIECE,
        urgency: 4,
      },
    ]);
    // THE SEAM: the library session received exactly the window as a hint.
    expect(library.liveSessions()[0]!.appliedPriorities()).toEqual([
      { fromPiece: 0, toPiece: 7, urgency: 4 },
    ]);
    await engine.destroy();
  });

  it("a custom config shapes the window (no hidden magic)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(PLAYBACK_FEATURE);
    const engine = newEngine(library, {
      startupTargetSeconds: 2,
      steadyRunwaySeconds: 60,
      seekBurstPieces: 2,
    });
    expect(engine.playback.config).toEqual({
      startupTargetSeconds: 2,
      steadyRunwaySeconds: 60,
      seekBurstPieces: 2,
    });
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", "ts-1", "data"), {
      piecesPerAdvance: 0,
      peersAt: () => 3,
    });
    const sessionId = await createPlayableSession(engine);

    const status = expectOk(
      engine.playback.command(sessionId, {
        kind: "start",
        positionBytes: 0,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );
    expect(status.windows[0]!.toPiece).toBe(1); // 2s = 2 pieces
    expect(library.liveSessions()[0]!.appliedPriorities()).toEqual([
      { fromPiece: 0, toPiece: 1, urgency: 4 },
    ]);
    await engine.destroy();
  });

  it("a malformed scheduler config fails engine construction honestly", () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(PLAYBACK_FEATURE);
    expect(() =>
      newEngine(library, { startupTargetSeconds: 0, steadyRunwaySeconds: 30, seekBurstPieces: 8 }),
    ).toThrow(TorrentEngineError);
  });

  it("a seek pushes a CRITICAL burst (clamped to the file's last piece) plus the re-anchored runway", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(PLAYBACK_FEATURE);
    const engine = newEngine(library, DEFAULTS);
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", "ts-1", "data"), {
      piecesPerAdvance: 0,
      peersAt: () => 3,
    });
    const sessionId = await createPlayableSession(engine);
    expectOk(
      engine.playback.command(sessionId, {
        kind: "start",
        positionBytes: 0,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );

    const status = expectOk(
      engine.playback.command(sessionId, {
        kind: "seek",
        positionBytes: 200_000,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );
    expect(status.schedulerState).toBe("seeking");
    expect(status.windows.map((w) => [w.kind, w.fromPiece, w.toPiece, w.urgency])).toEqual([
      ["seek-burst", 12, 14, 5], // piece(200000)=12; 12+8-1 clamped to the file's last piece 14
      ["runway", 12, 14, 3],
    ]);
    expect(library.liveSessions()[0]!.appliedPriorities()).toEqual([
      { fromPiece: 12, toPiece: 14, urgency: 5 },
      { fromPiece: 12, toPiece: 14, urgency: 3 },
    ]);
    await engine.destroy();
  });

  it("player range requests become CRITICAL windows carrying their deadlines", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(PLAYBACK_FEATURE);
    const engine = newEngine(library, DEFAULTS);
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", "ts-1", "data"), {
      piecesPerAdvance: 0,
      peersAt: () => 3,
    });
    const sessionId = await createPlayableSession(engine);
    expectOk(
      engine.playback.command(sessionId, {
        kind: "start",
        positionBytes: 0,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );

    clockMs += 10_000;
    const status = expectOk(
      engine.playback.noteRangeRequests(sessionId, [
        { offsetBytes: 200_000, lengthBytes: PIECE, deadlineMs: clockMs + 5_000 },
      ]),
    );
    expect(status.windows.map((w) => [w.kind, w.fromPiece, w.toPiece, w.urgency])).toEqual([
      ["range-request", 12, 13, 5], // critical first
      ["startup", 0, 7, 4],
    ]);
    expect(status.windows[0]!.deadlineMs).toBe(clockMs + 5_000);
    expect(library.liveSessions()[0]!.appliedPriorities()).toEqual([
      { fromPiece: 12, toPiece: 13, urgency: 5 },
      { fromPiece: 0, toPiece: 7, urgency: 4 },
    ]);
    await engine.destroy();
  });
});

describe("R12 — watch-order arrival (the seek target lands before piece 0)", () => {
  it("the swarm fetches the seek burst first, then completion order resumes ascending", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(PLAYBACK_FEATURE);
    const engine = newEngine(library, DEFAULTS);
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", "ts-1", "data"), {
      piecesPerAdvance: 1,
      peersAt: () => 3,
    });
    const sessionId = await createPlayableSession(engine);
    expectOk(
      engine.playback.command(sessionId, {
        kind: "seek",
        positionBytes: 200_000,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );

    // 5 advances: the burst (12, 13, 14) lands FIRST — piece 0 waits.
    const order = advanceRecordingOrder(library, 5);
    expect(order).toEqual([12, 13, 14, 0, 1]);

    // The burst's pieces verified: the FACT transitions seeking -> steady.
    const truth = expectOk(engine.playback.truth(sessionId));
    expect(truth.schedulerState).toBe("steady");
    expect(truth.playableNow).toBe(true);
    expect(truth.runway!.bytes).toBe(PLAYABLE_BYTES - 200_000); // contiguous to EOF
    await engine.destroy();
  });

  it("the startup window lands before later pieces (first-paint fast)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(PLAYBACK_FEATURE);
    const engine = newEngine(library, {
      startupTargetSeconds: 4,
      steadyRunwaySeconds: 30,
      seekBurstPieces: 8,
    });
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", "ts-1", "data"), {
      piecesPerAdvance: 1,
      peersAt: () => 3,
    });
    const sessionId = await createPlayableSession(engine);
    expectOk(
      engine.playback.command(sessionId, {
        kind: "start",
        positionBytes: 0,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );
    // With hints [0..3] the first four landed pieces are exactly 0,1,2,3.
    const order = advanceRecordingOrder(library, 4);
    expect(order).toEqual([0, 1, 2, 3]);
    const truth = expectOk(engine.playback.truth(sessionId));
    expect(truth.schedulerState).toBe("steady"); // the 4s startup window is satisfied
    await engine.destroy();
  });
});

describe("R12 — ordered integrity-gated reads (partial session, real bytes)", () => {
  it("verified ranges serve the REAL bytes; unverified ranges are typed refusals naming the pieces", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(PLAYBACK_FEATURE);
    const engine = newEngine(library, DEFAULTS);
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", "ts-1", "data"), {
      piecesPerAdvance: 1,
      peersAt: () => 3,
    });
    const sessionId = await createPlayableSession(engine);
    expectOk(
      engine.playback.command(sessionId, {
        kind: "seek",
        positionBytes: 200_000,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );
    advanceRecordingOrder(library, 3); // pieces 12, 13, 14 verified

    const expected = fixtureContent(PLAYBACK_FEATURE).get("playback-feature-v1/feature.mkv")!;

    // The seek range reads REAL verified bytes (piece 12 + 13).
    const seekRange = await engine.playback.readVerifiedRange(sessionId, {
      offsetBytes: 200_000,
      lengthBytes: 2 * PIECE,
    });
    expect(seekRange.ok).toBe(true);
    if (seekRange.ok) {
      expect(Buffer.from(seekRange.value).equals(Buffer.from(expected.subarray(200_000, 200_000 + 2 * PIECE)))).toBe(true);
    }

    // The file's tail (piece 14, shared with the sidecar) reads honestly.
    const tail = await engine.playback.readVerifiedRange(sessionId, {
      offsetBytes: 230_000,
      lengthBytes: PLAYABLE_BYTES - 230_000,
    });
    expect(tail.ok).toBe(true);
    if (tail.ok) {
      expect(Buffer.from(tail.value).equals(Buffer.from(expected.subarray(230_000)))).toBe(true);
    }

    // Piece 0 is NOT verified: a typed refusal that names it — never
    // unverified bytes, never a fake success.
    const early = await engine.playback.readVerifiedRange(sessionId, {
      offsetBytes: 0,
      lengthBytes: PIECE,
    });
    expect(early.ok).toBe(false);
    if (!early.ok) {
      expect(early.error.code).toBe("UNVERIFIED_RANGE");
      expect(early.error.retryable).toBe(true);
      expect(early.error.detail).toContain("unverified piece(s) 0");
    }

    // Malformed ranges are typed input rejections.
    const badOffset = await engine.playback.readVerifiedRange(sessionId, { offsetBytes: -1, lengthBytes: 10 });
    expect(badOffset.ok && badOffset.ok).toBe(false);
    const pastEof = await engine.playback.readVerifiedRange(sessionId, {
      offsetBytes: 0,
      lengthBytes: PLAYABLE_BYTES + 1,
    });
    expect(pastEof.ok).toBe(false);
    if (!pastEof.ok) expect(pastEof.error.code).toBe("INVALID_INPUT");

    // Completion composes: once the session completes, every range reads.
    // (The digest pass is async — bounded real-clock advance/poll loop.)
    let completed = false;
    for (let i = 0; i < 60 && !completed; i += 1) {
      library.advanceAll();
      await new Promise((resolve) => setTimeout(resolve, 2));
      completed = statusOf(engine, sessionId).state === "completed";
    }
    expect(completed).toBe(true);
    expect(statusOf(engine, sessionId).state).toBe("completed");
    const nowReadable = await engine.playback.readVerifiedRange(sessionId, {
      offsetBytes: 0,
      lengthBytes: PIECE,
    });
    expect(nowReadable.ok).toBe(true);
    if (nowReadable.ok) {
      expect(Buffer.from(nowReadable.value).equals(Buffer.from(expected.subarray(0, PIECE)))).toBe(true);
    }
    await engine.destroy();
  });

  it("a file outside the session's selection is a typed refusal (scheduling applies to acquired bytes)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(PLAYBACK_FEATURE);
    const engine = newEngine(library, DEFAULTS);
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", "ts-1", "data"), {
      piecesPerAdvance: 0,
      peersAt: () => 3,
    });
    const sessionId = await createPlayableSession(engine); // selection = file 0
    const refused = engine.playback.command(
      sessionId,
      { kind: "start", positionBytes: 0, bytesPerSecond: ONE_PIECE_PER_SEC },
      { fileIndex: 1 }, // the sidecar — not selected
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("INVALID_STATE");
      expect(refused.error.detail).toContain("not in the session's selection");
    }
    await engine.destroy();
  });
});

describe("R12 — the truthful buffering surface, end to end", () => {
  it("a dead swarm (zero peers) answers no-completion-path with the honest numbers", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(PLAYBACK_FEATURE);
    const engine = newEngine(library, DEFAULTS);
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", "ts-1", "data"), {
      piecesPerAdvance: 0,
      peersAt: () => 0, // the dead swarm
    });
    const sessionId = await createPlayableSession(engine);
    expectOk(
      engine.playback.command(sessionId, {
        kind: "start",
        positionBytes: 0,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );
    clockMs += 6_000; // past the stall threshold

    const truth = expectOk(engine.playback.truth(sessionId));
    expect(truth.schedulerState).toBe("startup");
    expect(truth.stall.kind).toBe("no-completion-path");
    expect(truth.stall.connectedPeers).toBe(0);
    expect(truth.stall.sessionStalled).toBe(true); // R11's law, verbatim
    expect(truth.stall.stallDurationMs).toBeDefined();
    expect(truth.playableNow).toBe(false);
    expect(truth.runway!.bytes).toBe(0);
    expect(truth.deadlinesAtRisk.length).toBe(1);
    expect(truth.deadlinesAtRisk[0]!.kind).toBe("startup");
    expect(truth.deadlinesAtRisk[0]!.remainingBytes).toBe(8 * PIECE);
    expect(truth.deadlinesAtRisk[0]!.estimatedSecondsToSatisfy).toBeUndefined(); // no fabricated ETA
    await engine.destroy();
  });

  it("a slow swarm answers slow-swarm with the honest depletion projection", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(PLAYBACK_FEATURE);
    const engine = newEngine(library, {
      startupTargetSeconds: 4, // 4s at 2 pieces/sec = 8 pieces
      steadyRunwaySeconds: 30,
      seekBurstPieces: 8,
    });
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", "ts-1", "data"), {
      piecesPerAdvance: 1, // 1 piece per 1000ms advance = 16384 B/s
      advanceIntervalMs: 1000,
      peersAt: () => 3,
    });
    const sessionId = await createPlayableSession(engine);
    expectOk(
      engine.playback.command(sessionId, {
        kind: "start",
        positionBytes: 0,
        bytesPerSecond: 2 * PIECE, // consuming 2 pieces/sec, arriving 1
      }),
    );
    advanceRecordingOrder(library, 8); // startup window (0..7) verified

    const truth = expectOk(engine.playback.truth(sessionId));
    expect(truth.schedulerState).toBe("steady"); // the fact transition fired
    expect(truth.stall.kind).toBe("slow-swarm");
    expect(truth.runway!.bytes).toBe(8 * PIECE);
    expect(truth.runway!.seconds).toBe(4);
    const risk = truth.deadlinesAtRisk[0]!;
    expect(risk.kind).toBe("runway");
    expect(risk.remainingBytes).toBe(7 * PIECE); // pieces 8..14
    expect(risk.secondsUntilDepletion).toBe(8); // 4s * 2 / (2 - 1)
    expect(risk.estimatedSecondsToSatisfy).toBe(7); // 7 pieces at 1/sec
    await engine.destroy();
  });

  it("the runway counts only VERIFIED CONTIGUOUS pieces (a later seek burst is not runway)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(PLAYBACK_FEATURE);
    const engine = newEngine(library, DEFAULTS);
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", "ts-1", "data"), {
      piecesPerAdvance: 1,
      peersAt: () => 3,
    });
    const sessionId = await createPlayableSession(engine);
    // Seek far ahead, land the burst, stop, then restart playback at 0.
    expectOk(
      engine.playback.command(sessionId, {
        kind: "seek",
        positionBytes: 200_000,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );
    advanceRecordingOrder(library, 3); // pieces 12, 13, 14
    expectOk(engine.playback.command(sessionId, { kind: "stop" }));
    expectOk(
      engine.playback.command(sessionId, {
        kind: "start",
        positionBytes: 0,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );

    const truth = expectOk(engine.playback.truth(sessionId));
    expect(truth.schedulerState).toBe("startup");
    expect(truth.runway!.bytes).toBe(0); // piece 0 unverified — the honest zero
    expect(truth.playableNow).toBe(false);
    expect(truth.availability.verifiedPiecesInFile).toBe(3); // the horizon is honest
    expect(truth.availability.totalPiecesInFile).toBe(15);
    expect(truth.availability.contiguousVerifiedToByte).toBe(0);
    await engine.destroy();
  });

  it("a paused torrent session answers no-completion-path (paused) — and keeps completion priority", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(PLAYBACK_FEATURE);
    const engine = newEngine(library, DEFAULTS);
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", "ts-1", "data"), {
      piecesPerAdvance: 0,
      peersAt: () => 3,
    });
    const sessionId = await createPlayableSession(engine);
    expectOk(
      engine.playback.command(sessionId, {
        kind: "start",
        positionBytes: 0,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );
    expect(library.liveSessions()[0]!.appliedPriorities()).toEqual([
      { fromPiece: 0, toPiece: 7, urgency: 4 },
    ]);

    // The user pauses the TORRENT: the scheduler clears to completion
    // priority (the dispatch's paused law) and reports the paused truth.
    expectOk(engine.pause(sessionId));
    expectOk(engine.playback.tick());
    expect(library.liveSessions()[0]!.appliedPriorities()).toEqual([]);
    const pausedTruth = expectOk(engine.playback.truth(sessionId));
    expect(pausedTruth.stall.kind).toBe("no-completion-path");
    expect(pausedTruth.stall.detail).toContain("paused");

    // Resume: the playback plan restores itself on the next tick.
    expectOk(engine.resume(sessionId));
    expectOk(engine.playback.tick());
    expect(library.liveSessions()[0]!.appliedPriorities()).toEqual([
      { fromPiece: 0, toPiece: 7, urgency: 4 },
    ]);
    await engine.destroy();
  });
});

describe("R12 — the scheduler state machine through the engine", () => {
  it("commands and facts drive honest transitions; illegal commands are typed refusals", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(PLAYBACK_FEATURE);
    const engine = newEngine(library, DEFAULTS);
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", "ts-1", "data"), {
      piecesPerAdvance: 2,
      peersAt: () => 3,
    });
    const sessionId = await createPlayableSession(engine);

    // Fresh: idle.
    expect(expectOk(engine.playback.state(sessionId))).toBe("idle");

    // start -> startup; start while started is a typed refusal.
    expectOk(
      engine.playback.command(sessionId, {
        kind: "start",
        positionBytes: 0,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );
    expect(expectOk(engine.playback.state(sessionId))).toBe("startup");
    const doubleStart = engine.playback.command(sessionId, {
      kind: "start",
      positionBytes: 0,
      bytesPerSecond: ONE_PIECE_PER_SEC,
    });
    expect(doubleStart.ok).toBe(false);
    if (!doubleStart.ok) expect(doubleStart.error.code).toBe("INVALID_STATE");

    // progress while active is fine (stays startup).
    expectOk(
      engine.playback.command(sessionId, {
        kind: "progress",
        positionBytes: PIECE,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );
    expect(expectOk(engine.playback.state(sessionId))).toBe("startup");

    // seek -> seeking; the startup window satisfied -> steady (FACT).
    expectOk(
      engine.playback.command(sessionId, {
        kind: "seek",
        positionBytes: 200_000,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );
    expect(expectOk(engine.playback.state(sessionId))).toBe("seeking");
    advanceRecordingOrder(library, 2); // burst 12..14 (+ piece 0)
    expect(expectOk(engine.playback.state(sessionId))).toBe("seeking"); // facts evaluated on truth/tick
    expectOk(engine.playback.truth(sessionId));
    expect(expectOk(engine.playback.state(sessionId))).toBe("steady");

    // stop -> background-completion; stop again is a typed refusal.
    expectOk(engine.playback.command(sessionId, { kind: "stop" }));
    expect(expectOk(engine.playback.state(sessionId))).toBe("background-completion");
    const doubleStop = engine.playback.command(sessionId, { kind: "stop" });
    expect(doubleStop.ok).toBe(false);
    if (!doubleStop.ok) expect(doubleStop.error.code).toBe("INVALID_STATE");

    // progress after stop is a typed refusal; start resumes.
    const lateProgress = engine.playback.command(sessionId, {
      kind: "progress",
      positionBytes: 0,
      bytesPerSecond: ONE_PIECE_PER_SEC,
    });
    expect(lateProgress.ok).toBe(false);
    if (!lateProgress.ok) expect(lateProgress.error.code).toBe("INVALID_STATE");
    expectOk(
      engine.playback.command(sessionId, {
        kind: "start",
        positionBytes: 0,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );
    expect(expectOk(engine.playback.state(sessionId))).toBe("startup");

    // Malformed commands are typed input rejections.
    const badPosition = engine.playback.command(sessionId, {
      kind: "progress",
      positionBytes: -5,
      bytesPerSecond: 1,
    });
    expect(badPosition.ok).toBe(false);
    if (!badPosition.ok) expect(badPosition.error.code).toBe("INVALID_INPUT");
    const zeroVelocity = engine.playback.command(sessionId, {
      kind: "progress",
      positionBytes: 0,
      bytesPerSecond: 0,
    });
    expect(zeroVelocity.ok).toBe(false);
    if (!zeroVelocity.ok) expect(zeroVelocity.error.code).toBe("INVALID_INPUT");

    // Unknown session: NOT_FOUND.
    const unknown = engine.playback.command("ts-999", { kind: "stop" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe("NOT_FOUND");
    await engine.destroy();
  });

  it("commands before metadata resolves are honest refusals (no piece map exists yet)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(PLAYBACK_FEATURE);
    const engine = newEngine(library, DEFAULTS);
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", "ts-1", "data"), {
      metadataResolveAdvances: 5,
      piecesPerAdvance: 1,
      peersAt: () => 3,
    });
    const ingested = await engine.ingestMagnet(fixtureMagnetUri(PLAYBACK_FEATURE), PROVENANCE);
    if (!ingested.ok) throw new Error("magnet ingestion must succeed");
    const created = await engine.createSession(ingested.value.id, {
      selection: { filePaths: ["feature.mkv"] },
    });
    if (!created.ok) throw new Error("session must be created");
    const sessionId = created.value.sessionId;
    expect(statusOf(engine, sessionId).state).toBe("discovering-metadata");

    const refused = engine.playback.command(sessionId, {
      kind: "start",
      positionBytes: 0,
      bytesPerSecond: ONE_PIECE_PER_SEC,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("INVALID_STATE");
      expect(refused.error.detail).toContain("metadata has not resolved");
    }

    // Metadata resolves: the command now maps onto the real piece geometry.
    for (let i = 0; i < 5; i += 1) library.advanceAll();
    expect(["selecting", "downloading"]).toContain(statusOf(engine, sessionId).state);
    const status = expectOk(
      engine.playback.command(sessionId, {
        kind: "start",
        positionBytes: 0,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );
    expect(status.windows[0]!.toPiece).toBe(7);
    await engine.destroy();
  });

  it("range demand before playback is declared is a typed refusal (playback is never inferred)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(PLAYBACK_FEATURE);
    const engine = newEngine(library, DEFAULTS);
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", "ts-1", "data"), {
      piecesPerAdvance: 0,
      peersAt: () => 3,
    });
    const sessionId = await createPlayableSession(engine);
    const refused = engine.playback.noteRangeRequests(sessionId, [
      { offsetBytes: 0, lengthBytes: PIECE, deadlineMs: 1_000 },
    ]);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("INVALID_STATE");
      expect(refused.error.detail).toContain("never infers playback from reads");
    }
    const malformed = engine.playback.noteRangeRequests(sessionId, [
      { offsetBytes: 0, lengthBytes: 0, deadlineMs: 1_000 },
    ]);
    expect(malformed.ok).toBe(false);
    await engine.destroy();
  });
});

describe("R12 — completion fallback and background behavior", () => {
  it("stop clears the priorities (completion order) and ascending fetch resumes", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(PLAYBACK_FEATURE);
    const engine = newEngine(library, DEFAULTS);
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", "ts-1", "data"), {
      piecesPerAdvance: 1,
      peersAt: () => 3,
    });
    const sessionId = await createPlayableSession(engine);
    expectOk(
      engine.playback.command(sessionId, {
        kind: "seek",
        positionBytes: 200_000,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );
    expect(library.liveSessions()[0]!.appliedPriorities().length).toBe(2);

    // Stop: the scheduler hands scheduling back to the library's own
    // completion order (J24 background completion).
    expectOk(engine.playback.command(sessionId, { kind: "stop" }));
    expect(library.liveSessions()[0]!.appliedPriorities()).toEqual([]);

    // The next pieces land in ASCENDING order (the completion fallback).
    const order = advanceRecordingOrder(library, 3);
    expect(order).toEqual([0, 1, 2]);
    await engine.destroy();
  });

  it("tick() replans every scheduled session (the host-owned cadence)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(PLAYBACK_FEATURE);
    const engine = newEngine(library, DEFAULTS);
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", "ts-1", "data"), {
      piecesPerAdvance: 4,
      peersAt: () => 3,
    });
    const sessionId = await createPlayableSession(engine);
    expectOk(
      engine.playback.command(sessionId, {
        kind: "start",
        positionBytes: 0,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );
    advanceRecordingOrder(library, 2); // 8 pieces verified (4 per advance)

    // The tick evaluates the fact (startup satisfied) and pushes the
    // steady runway plan onto the library.
    const ticked = expectOk(engine.playback.tick());
    expect(ticked.replanned).toBe(1);
    expect(expectOk(engine.playback.state(sessionId))).toBe("steady");
    expect(library.liveSessions()[0]!.appliedPriorities()).toEqual([
      { fromPiece: 0, toPiece: 14, urgency: 3 },
    ]);
    await engine.destroy();
  });

  it("stopping the session detaches its scheduler (fresh state after recovery-style recreation)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(PLAYBACK_FEATURE);
    const engine = newEngine(library, DEFAULTS);
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", "ts-1", "data"), {
      piecesPerAdvance: 0,
      peersAt: () => 3,
    });
    const sessionId = await createPlayableSession(engine);
    expectOk(
      engine.playback.command(sessionId, {
        kind: "start",
        positionBytes: 0,
        bytesPerSecond: ONE_PIECE_PER_SEC,
      }),
    );
    await engine.stop(sessionId);
    // The stopped session answers NOT_FOUND on playback surfaces (its
    // persisted state is recoverable via recover() — R13's lane).
    const gone = engine.playback.state(sessionId);
    expect(gone.ok).toBe(false);
    if (!gone.ok) expect(gone.error.code).toBe("NOT_FOUND");
    await engine.destroy();
  });
});
