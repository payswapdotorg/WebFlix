/**
 * @wfx/native-media — engine module tests (WFX-014, Lane B).
 *
 * Covers, per the work item's test plan:
 * 1. PROCESS DTO ROUND-TRIP — every command/event kind survives its JSON wire
 *    encoding; malformed/wrong-version/bad-shape input parses to null.
 * 2. SIMULATION ENGINE — deterministic open → buffering → playing → complete
 *    progression; seek/pause/resume/prioritize/close through the WFX-004
 *    session FSM; range reads with exact byte offsets; typed errors for
 *    unknown assets, unknown sessions, closed sessions, bad input; timer-
 *    driven auto-tick; the WFX-004 service envelope over the simulation.
 * 3. ADAPTER — in-process process + adapter behaves identically to the direct
 *    simulation (same command sequence → same final states, same typed error
 *    codes, same range bytes); process crash → all live sessions failed with
 *    typed INTERNAL errors; timeouts → typed retryable ENGINE_TIMEOUT;
 *    malformed responses → typed INTERNAL; validation fails fast without
 *    crossing the wire.
 * 4. CACHE POLICY — admission under budget, LRU vs FIFO eviction order,
 *    zero-budget rejection, minimality, typed accounting errors, purity.
 */

import { describe, expect, it } from "bun:test";

import {
  createCacheTracker,
  createEngineAdapter,
  createInProcessEngineProcess,
  createNativeMediaService,
  createSimulationEngine,
  decodeBase64,
  DEFAULT_SIMULATION_ASSET,
  encodeBase64,
  evictList,
  forgetEntry,
  isEngineCommand,
  isEngineEvent,
  NativeMediaError,
  parseCommand,
  parseEvent,
  PROTOCOL_VERSION,
  serializeCommand,
  serializeEvent,
  shouldAdmit,
  simulationMediaByte,
  touchEntry,
  trackPiece,
  usedBytes,
  type EngineCommand,
  type EngineConfig,
  type EngineEvent,
  type EngineHandle,
  type FakeAsset,
  type NativeEngineProcess,
  type NativeMediaErrorCode,
} from "../src/index";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** 64 KiB / 16 pieces / 60 s — the long-form asset (both registry keys required). */
const LONG_ASSET: FakeAsset & { magnet: string; localPath: string } = {
  magnet: "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  localPath: "/webflix/sim/long-asset.mkv",
  assetId: "long-asset",
  fileId: "long-file",
  totalBytes: 65_536,
  durationMs: 60_000,
  pieceSize: 4_096,
};

/** 32 KiB / 8 pieces / 4 s — completes within a handful of ticks. */
const SHORT_ASSET: FakeAsset & { magnet: string; localPath: string } = {
  magnet: "magnet:?xt=urn:btih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  localPath: "/webflix/sim/short-asset.mkv",
  assetId: "short-asset",
  fileId: "short-file",
  totalBytes: 32_768,
  durationMs: 4_000,
  pieceSize: 4_096,
};

/** Deterministic simulation knobs shared by the progression tests. */
const SIM_KNOBS = { autoTick: false, tickIntervalMs: 1_000, bytesPerTick: 8_192 } as const;

const ENGINE_TEST_CONFIG: EngineConfig = {
  cacheDir: ".webflix-test-cache",
  maxCacheBytes: 16 * 1024 * 1024,
};

/** Predict the media bytes [start, end] for an asset, independently. */
function predictedBytes(asset: FakeAsset, start: number, end: number): Uint8Array {
  const out = new Uint8Array(end - start + 1);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = simulationMediaByte(asset, start + i);
  }
  return out;
}

/** Assert a promise rejects with a NativeMediaError of the given code. */
async function expectNativeError(
  promise: Promise<unknown>,
  code: NativeMediaErrorCode,
): Promise<NativeMediaError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(NativeMediaError);
    const nme = e as NativeMediaError;
    expect(nme.code).toBe(code);
    return nme;
  }
  throw new Error(`expected a NativeMediaError with code ${code}, but the promise resolved`);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 1. Process DTO round-trip
// ---------------------------------------------------------------------------

describe("engine process wire contract", () => {
  it("PROTOCOL_VERSION is 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  const sampleCommands: EngineCommand[] = [
    { protocol: 1, kind: "open", requestId: "r1", source: { magnet: "magnet:?xt=urn:btih:x" } },
    { protocol: 1, kind: "open", requestId: "r2", source: { torrentBase64: "AAECAwQ=" } },
    { protocol: 1, kind: "open", requestId: "r3", source: { localPath: "/m/movie.mkv" } },
    {
      protocol: 1,
      kind: "open",
      requestId: "r4",
      source: { magnet: "magnet:?xt=urn:btih:y", localPath: "/m/both.mkv" },
    },
    { protocol: 1, kind: "seek", requestId: "r5", sessionId: "s1", positionMs: 1_234 },
    {
      protocol: 1,
      kind: "prioritize",
      requestId: "r6",
      sessionId: "s1",
      deadlines: [
        { piece: 3, deadlineMs: 500 },
        { piece: 0, deadlineMs: 250 },
      ],
    },
    { protocol: 1, kind: "pause", requestId: "r7", sessionId: "s1" },
    { protocol: 1, kind: "resume", requestId: "r8", sessionId: "s1" },
    { protocol: 1, kind: "close", requestId: "r9", sessionId: "s1" },
    { protocol: 1, kind: "stat", requestId: "r10", sessionId: "s1" },
    { protocol: 1, kind: "read", requestId: "r11", sessionId: "s1", startByte: 0, endByte: 499 },
  ];

  const sampleEvents: EngineEvent[] = [
    {
      protocol: 1,
      kind: "opened",
      requestId: "r1",
      session: { id: "s1", assetId: "a", fileId: "f", state: "buffering", bufferedMs: 0, positionMs: 0 },
    },
    {
      protocol: 1,
      kind: "acked",
      requestId: "r7",
      session: { id: "s1", assetId: "a", fileId: "f", state: "playing", bufferedMs: 5_000, positionMs: 1_000 },
    },
    { protocol: 1, kind: "stat", requestId: "r10", sessionId: "s1", totalBytes: 65_536, contentType: "video/mp4" },
    {
      protocol: 1,
      kind: "data",
      requestId: "r11",
      sessionId: "s1",
      startByte: 0,
      endByte: 2,
      dataBase64: "AAECAw==",
    },
    {
      protocol: 1,
      kind: "progress",
      sessionId: "s1",
      positionMs: 2_000,
      bufferedMs: 30_000,
      session: { id: "s1", assetId: "a", fileId: "f", state: "playing", bufferedMs: 30_000, positionMs: 2_000 },
    },
    {
      protocol: 1,
      kind: "buffered",
      sessionId: "s1",
      bufferedMs: 7_500,
      session: { id: "s1", assetId: "a", fileId: "f", state: "buffering", bufferedMs: 7_500, positionMs: 0 },
    },
    {
      protocol: 1,
      kind: "state-changed",
      sessionId: "s1",
      from: "buffering",
      to: "playing",
      session: { id: "s1", assetId: "a", fileId: "f", state: "playing", bufferedMs: 0, positionMs: 0 },
    },
    { protocol: 1, kind: "error", code: "IO_ERROR", message: "piece missing" },
    { protocol: 1, kind: "error", code: "NOT_FOUND", message: "no session", requestId: "r9", sessionId: "s1" },
    { protocol: 1, kind: "error", code: "INTERNAL", message: "panic", fatal: true },
    { protocol: 1, kind: "exit", reason: "terminated" },
  ];

  it("every command kind round-trips through its JSON wire encoding", () => {
    for (const command of sampleCommands) {
      expect(isEngineCommand(command)).toBe(true);
      const json = serializeCommand(command);
      expect(typeof json).toBe("string");
      const parsed = parseCommand(json);
      expect(parsed).toEqual(command);
      // The wire encoding is plain JSON — a real engine can JSON.parse it.
      expect(JSON.parse(json)).toEqual(command);
    }
  });

  it("every event kind round-trips through its JSON wire encoding", () => {
    for (const event of sampleEvents) {
      expect(isEngineEvent(event)).toBe(true);
      const json = serializeEvent(event);
      expect(typeof json).toBe("string");
      const parsed = parseEvent(json);
      expect(parsed).toEqual(event);
      expect(JSON.parse(json)).toEqual(event);
    }
  });

  it("parseCommand rejects malformed JSON, wrong versions, and bad shapes", () => {
    expect(parseCommand("")).toBeNull();
    expect(parseCommand("{not json")).toBeNull();
    expect(parseCommand("null")).toBeNull();
    expect(parseCommand("42")).toBeNull();
    // Wrong protocol version is rejected, not misinterpreted.
    const future = JSON.parse(serializeCommand(sampleCommands[0] ?? sampleCommands[0]!)) as Record<string, unknown>;
    future.protocol = 999;
    expect(parseCommand(JSON.stringify(future))).toBeNull();
    // Unknown kind.
    expect(parseCommand(JSON.stringify({ protocol: 1, kind: "explode", requestId: "r" }))).toBeNull();
    // open without any source.
    expect(
      parseCommand(JSON.stringify({ protocol: 1, kind: "open", requestId: "r", source: {} })),
    ).toBeNull();
    // seek with a negative position.
    expect(
      parseCommand(
        JSON.stringify({ protocol: 1, kind: "seek", requestId: "r", sessionId: "s", positionMs: -5 }),
      ),
    ).toBeNull();
    // read with endByte < startByte.
    expect(
      parseCommand(
        JSON.stringify({ protocol: 1, kind: "read", requestId: "r", sessionId: "s", startByte: 10, endByte: 5 }),
      ),
    ).toBeNull();
    // prioritize with malformed deadlines.
    expect(
      parseCommand(
        JSON.stringify({ protocol: 1, kind: "prioritize", requestId: "r", sessionId: "s", deadlines: [{ piece: -1 }] }),
      ),
    ).toBeNull();
    // Missing requestId.
    expect(parseCommand(JSON.stringify({ protocol: 1, kind: "pause", sessionId: "s" }))).toBeNull();
  });

  it("parseEvent rejects malformed JSON, wrong versions, and bad shapes", () => {
    expect(parseEvent("")).toBeNull();
    expect(parseEvent("undefined")).toBeNull();
    const opened = sampleEvents[0]!;
    const future = JSON.parse(serializeEvent(opened)) as Record<string, unknown>;
    future.protocol = 2;
    expect(parseEvent(JSON.stringify(future))).toBeNull();
    // Error code outside the WFX-004 taxonomy.
    expect(
      parseEvent(JSON.stringify({ protocol: 1, kind: "error", code: "NOT_A_CODE", message: "x" })),
    ).toBeNull();
    // exit with an empty reason.
    expect(parseEvent(JSON.stringify({ protocol: 1, kind: "exit", reason: "" }))).toBeNull();
    // state-changed with a non-frozen state.
    expect(
      parseEvent(
        JSON.stringify({
          protocol: 1,
          kind: "state-changed",
          sessionId: "s",
          from: "playing",
          to: "paused",
          session: { id: "s", assetId: "a", fileId: "f", state: "paused", bufferedMs: 0, positionMs: 0 },
        }),
      ),
    ).toBeNull();
    // data with an empty base64 payload.
    expect(
      parseEvent(
        JSON.stringify({ protocol: 1, kind: "data", requestId: "r", sessionId: "s", startByte: 0, endByte: 1, dataBase64: "" }),
      ),
    ).toBeNull();
    // Unknown kind.
    expect(parseEvent(JSON.stringify({ protocol: 1, kind: "surprise" }))).toBeNull();
  });

  it("base64 wire helpers round-trip binary payloads, including chunked sizes", () => {
    const allBytes = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) allBytes[i] = i;
    expect(decodeBase64(encodeBase64(allBytes))).toEqual(allBytes);

    // Larger than the 0x8000 chunk boundary.
    const big = new Uint8Array(100_003);
    for (let i = 0; i < big.length; i += 1) big[i] = (i * 7 + 13) % 256;
    const roundTrip = decodeBase64(encodeBase64(big));
    expect(roundTrip).not.toBeNull();
    expect(bytesEqual(roundTrip!, big)).toBe(true);

    expect(decodeBase64("!!not-base64!!")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Simulation engine
// ---------------------------------------------------------------------------

describe("simulation engine — deterministic progression", () => {
  it("open resolves metadata: resolving → buffering with zero progress", async () => {
    const sim = createSimulationEngine({ assets: [LONG_ASSET], ...SIM_KNOBS });
    const session = await sim.open({ magnet: LONG_ASSET.magnet });
    expect(session.state).toBe("buffering");
    expect(session.bufferedMs).toBe(0);
    expect(session.positionMs).toBe(0);
    expect(session.assetId).toBe("long-asset");
    expect(session.fileId).toBe("long-file");
  });

  it("buffering advances deterministically with ticks (pure function of the clock)", async () => {
    const sim = createSimulationEngine({ assets: [LONG_ASSET], ...SIM_KNOBS });
    const session = await sim.open({ localPath: LONG_ASSET.localPath });
    expect(sim.tick(4_000)).toBe(4); // 4 ticks × 8 KiB = 32 KiB of 64 KiB
    let status = await sim.status(session.id);
    expect(status.state).toBe("buffering");
    expect(status.bufferedMs).toBe(30_000); // 32_768 / 65_536 × 60_000
    expect(status.positionMs).toBe(0);
    expect(sim.tick(4_000)).toBe(4); // fully downloaded
    status = await sim.status(session.id);
    expect(status.bufferedMs).toBe(60_000);
    expect(status.state).toBe("buffering"); // download done, playback not started
  });

  it("open → buffering → playing → complete pipeline with a short asset", async () => {
    const sim = createSimulationEngine({ assets: [SHORT_ASSET], ...SIM_KNOBS });
    const session = await sim.open({ magnet: SHORT_ASSET.magnet });
    expect(session.state).toBe("buffering");
    await sim.resume(session.id);
    expect((await sim.status(session.id)).state).toBe("playing");
    sim.tick(4_000); // 4 ticks: download completes AND position reaches the end
    const final = await sim.status(session.id);
    expect(final.state).toBe("complete");
    expect(final.bufferedMs).toBe(4_000);
    expect(final.positionMs).toBe(4_000);
  });

  it("position never runs past the buffer; playback waits for buffering", async () => {
    const sim = createSimulationEngine({ assets: [LONG_ASSET], ...SIM_KNOBS });
    const session = await sim.open({ magnet: LONG_ASSET.magnet });
    await sim.seek(session.id, 30_000); // beyond the initial buffer
    await sim.resume(session.id);
    sim.tick(3_000); // 24 KiB buffered = 22_500 ms < 30_000 ms
    let status = await sim.status(session.id);
    expect(status.state).toBe("playing");
    expect(status.positionMs).toBe(30_000); // held, waiting for the buffer
    sim.tick(1_000); // 32 KiB = 30_000 ms — position can start moving
    status = await sim.status(session.id);
    expect(status.positionMs).toBe(30_000); // bufferedMs just reached the position; moves next tick
    sim.tick(1_000);
    status = await sim.status(session.id);
    expect(status.positionMs).toBe(31_000);
  });

  it("autoTick drives progression from a real timer (no manual ticks)", async () => {
    const sim = createSimulationEngine({
      assets: [SHORT_ASSET],
      autoTick: true,
      tickIntervalMs: 10,
      bytesPerTick: 8_192,
    });
    const session = await sim.open({ magnet: SHORT_ASSET.magnet });
    await sim.resume(session.id);
    await new Promise((resolve) => setTimeout(resolve, 80)); // ≥ several ticks
    const status = await sim.status(session.id);
    expect(status.bufferedMs).toBeGreaterThan(0);
    expect(status.bufferedMs).toBeLessThanOrEqual(SHORT_ASSET.durationMs);
    expect(["playing", "complete"]).toContain(status.state);
    await sim.close(session.id);
  });
});

describe("simulation engine — FSM transitions and commands", () => {
  it("seek sets the position without changing state, and refocuses the download", async () => {
    const sim = createSimulationEngine({ assets: [LONG_ASSET], ...SIM_KNOBS });
    const session = await sim.open({ magnet: LONG_ASSET.magnet });
    await sim.seek(session.id, 10_000);
    const status = await sim.status(session.id);
    expect(status.state).toBe("buffering");
    expect(status.positionMs).toBe(10_000);
    // The download refocuses on the seek target's piece (byte 10_922 → piece 2),
    // so bytes at the seek position are servable while piece 0 is still missing.
    sim.tick(1_000); // completes pieces 2 and 3
    const atSeek = await sim.readRange(session.id, 8_192, 12_287); // pieces 2-3
    expect(bytesEqual(atSeek, predictedBytes(LONG_ASSET, 8_192, 12_287))).toBe(true);
    await expectNativeError(sim.readRange(session.id, 0, 4_095), "IO_ERROR"); // piece 0 incomplete
  });

  it("pause freezes playback but not buffering; resume continues playback", async () => {
    const sim = createSimulationEngine({ assets: [LONG_ASSET], ...SIM_KNOBS });
    const session = await sim.open({ magnet: LONG_ASSET.magnet });
    await sim.resume(session.id);
    sim.tick(4_000); // buffered 30_000; position 4_000
    await sim.pause(session.id);
    let status = await sim.status(session.id);
    expect(status.state).toBe("playing"); // pause is a flag, NOT a state
    sim.tick(2_000);
    status = await sim.status(session.id);
    expect(status.positionMs).toBe(4_000); // frozen
    expect(status.bufferedMs).toBe(45_000); // download continues while paused
    await sim.resume(session.id);
    sim.tick(1_000);
    status = await sim.status(session.id);
    expect(status.positionMs).toBe(5_000); // playback resumed
  });

  it("prioritize reorders the download by deadline (honored, observable)", async () => {
    const sim = createSimulationEngine({ assets: [LONG_ASSET], ...SIM_KNOBS });
    const session = await sim.open({ magnet: LONG_ASSET.magnet });
    // Default order is sequential: piece 0 would download first.
    await sim.prioritize(session.id, [{ piece: 3, deadlineMs: 5_000 }]);
    sim.tick(1_000); // 2 pieces per tick: piece 3 (deadline) then piece 0
    const prioritized = await sim.readRange(session.id, 12_288, 16_383); // piece 3
    expect(bytesEqual(prioritized, predictedBytes(LONG_ASSET, 12_288, 16_383))).toBe(true);
    // Piece 1 was NOT downloaded (order: 3, 0, 1, 2, ...).
    await expectNativeError(sim.readRange(session.id, 4_096, 8_191), "IO_ERROR");
  });

  it("background: playback suspends, download completes in background (FSM)", async () => {
    const sim = createSimulationEngine({ assets: [LONG_ASSET], ...SIM_KNOBS });
    const session = await sim.open({ magnet: LONG_ASSET.magnet });
    await sim.resume(session.id);
    sim.goBackground(session.id);
    expect((await sim.status(session.id)).state).toBe("background");
    sim.tick(2_000);
    let status = await sim.status(session.id);
    expect(status.state).toBe("background"); // not complete yet (16 of 64 KiB)
    expect(status.positionMs).toBe(0); // playback suspended in background
    sim.tick(6_000); // download finishes while backgrounded
    status = await sim.status(session.id);
    expect(status.state).toBe("complete"); // background completion
    expect(status.bufferedMs).toBe(60_000);
    // resume from background returns to playing (FSM: background → playing).
    const sim2 = createSimulationEngine({ assets: [LONG_ASSET], ...SIM_KNOBS });
    const s2 = await sim2.open({ magnet: LONG_ASSET.magnet });
    await sim2.resume(s2.id);
    sim2.goBackground(s2.id);
    await sim2.resume(s2.id);
    expect((await sim2.status(s2.id)).state).toBe("playing");
  });

  it("goBackground rejects a non-playing session (FSM guard)", async () => {
    const sim = createSimulationEngine({ assets: [LONG_ASSET], ...SIM_KNOBS });
    const session = await sim.open({ magnet: LONG_ASSET.magnet });
    expect(() => sim.goBackground(session.id)).toThrow(NativeMediaError);
    try {
      sim.goBackground(session.id);
      throw new Error("expected INVALID_INPUT");
    } catch (e) {
      expect((e as NativeMediaError).code).toBe("INVALID_INPUT");
    }
  });

  it("close removes the session; later operations answer SESSION_CLOSED", async () => {
    const sim = createSimulationEngine({ assets: [LONG_ASSET], ...SIM_KNOBS });
    const session = await sim.open({ magnet: LONG_ASSET.magnet });
    await sim.close(session.id);
    await expectNativeError(sim.status(session.id), "SESSION_CLOSED");
    await expectNativeError(sim.seek(session.id, 0), "SESSION_CLOSED");
    await expectNativeError(sim.statMedia(session.id), "SESSION_CLOSED");
    await expectNativeError(sim.close(session.id), "SESSION_CLOSED"); // double close
    await expectNativeError(sim.close("nope"), "NOT_FOUND");
    // A fresh session gets a fresh deterministic id.
    const next = await sim.open({ magnet: LONG_ASSET.magnet });
    expect(next.id).toBe("sim-session-2");
  });

  it("terminal sessions refuse control but keep serving ranges until closed", async () => {
    const sim = createSimulationEngine({ assets: [SHORT_ASSET], ...SIM_KNOBS });
    const session = await sim.open({ magnet: SHORT_ASSET.magnet });
    await sim.resume(session.id);
    sim.tick(4_000);
    expect((await sim.status(session.id)).state).toBe("complete");
    await expectNativeError(sim.seek(session.id, 0), "SESSION_CLOSED");
    await expectNativeError(sim.pause(session.id), "SESSION_CLOSED");
    const bytes = await sim.readRange(session.id, 0, 999);
    expect(bytesEqual(bytes, predictedBytes(SHORT_ASSET, 0, 999))).toBe(true); // cache persists
    await sim.close(session.id);
    await expectNativeError(sim.readRange(session.id, 0, 999), "SESSION_CLOSED");
  });
});

describe("simulation engine — typed failures", () => {
  it("unknown assets are UNSUPPORTED_SOURCE; torrent-bytes-only is explicit", async () => {
    const sim = createSimulationEngine({ assets: [LONG_ASSET], ...SIM_KNOBS });
    const magnet = await expectNativeError(
      sim.open({ magnet: "magnet:?xt=urn:btih:ffffffffffffffffffffffffffffffffffffffff" }),
      "UNSUPPORTED_SOURCE",
    );
    expect(magnet.detail).toContain("no fake asset");
    await expectNativeError(sim.open({ localPath: "/nowhere.mkv" }), "UNSUPPORTED_SOURCE");
    const torrent = await expectNativeError(
      sim.open({ torrentBytes: new Uint8Array([1, 2, 3]) }),
      "UNSUPPORTED_SOURCE",
    );
    expect(torrent.detail).toContain("torrent");
  });

  it("malformed open input is INVALID_INPUT", async () => {
    const sim = createSimulationEngine({ ...SIM_KNOBS });
    await expectNativeError(sim.open({}), "INVALID_INPUT");
    await expectNativeError(sim.open({ magnet: "http://not-a-magnet" }), "INVALID_INPUT");
    await expectNativeError(sim.open({ magnet: "" }), "INVALID_INPUT");
    await expectNativeError(
      sim.open({ torrentBytes: new Uint8Array(0) }),
      "INVALID_INPUT",
    );
  });

  it("unknown sessions are NOT_FOUND; bad arguments are INVALID_INPUT", async () => {
    const sim = createSimulationEngine({ assets: [LONG_ASSET], ...SIM_KNOBS });
    const session = await sim.open({ magnet: LONG_ASSET.magnet });
    await expectNativeError(sim.seek("ghost", 0), "NOT_FOUND");
    await expectNativeError(sim.prioritize("ghost", []), "NOT_FOUND");
    await expectNativeError(sim.pause("ghost"), "NOT_FOUND");
    await expectNativeError(sim.statMedia("ghost"), "NOT_FOUND");
    await expectNativeError(sim.seek(session.id, 61_000), "INVALID_INPUT"); // beyond duration
    await expectNativeError(sim.seek(session.id, -1), "INVALID_INPUT");
    await expectNativeError(
      sim.prioritize(session.id, [{ piece: 16, deadlineMs: 0 }]), // out of range (16 pieces)
      "INVALID_INPUT",
    );
    await expectNativeError(
      sim.prioritize(session.id, [
        { piece: 1, deadlineMs: 0 },
        { piece: 1, deadlineMs: 1 }, // duplicate
      ]),
      "INVALID_INPUT",
    );
    await expectNativeError(
      sim.prioritize(session.id, "nope" as unknown as { piece: number; deadlineMs: number }[]),
      "INVALID_INPUT",
    );
  });

  it("malformed simulation config is INVALID_INPUT at construction", () => {
    expect(() => createSimulationEngine({ assets: [] })).not.toThrow(); // empty registry is legal
    expect(() => createSimulationEngine({ tickIntervalMs: 0 })).toThrow(NativeMediaError);
    expect(() => createSimulationEngine({ tickIntervalMs: Number.NaN })).toThrow(NativeMediaError);
    expect(() => createSimulationEngine({ bytesPerTick: 0 })).toThrow(NativeMediaError);
    expect(() => createSimulationEngine({ autoTick: "yes" as unknown as boolean })).toThrow(NativeMediaError);
    expect(() =>
      createSimulationEngine({ assets: [{ assetId: "x", fileId: "y", totalBytes: 0, durationMs: 1, pieceSize: 1 }] }),
    ).toThrow(NativeMediaError);
    expect(() =>
      createSimulationEngine({
        assets: [
          { magnet: "magnet:?xt=urn:btih:z", assetId: "a", fileId: "f", totalBytes: 10, durationMs: 10, pieceSize: 5 },
          { magnet: "magnet:?xt=urn:btih:z", assetId: "b", fileId: "f", totalBytes: 10, durationMs: 10, pieceSize: 5 },
        ],
      }),
    ).toThrow(NativeMediaError); // duplicate registry key
    expect(() =>
      createSimulationEngine({ assets: [{ assetId: "a", fileId: "f", totalBytes: 10, durationMs: 10, pieceSize: 5 }] }),
    ).toThrow(NativeMediaError); // no registry key
  });
});

describe("simulation engine — range reads", () => {
  it("serves exact bytes at correct offsets from the simulated piece buffer", async () => {
    const sim = createSimulationEngine({ assets: [LONG_ASSET], ...SIM_KNOBS });
    const session = await sim.open({ magnet: LONG_ASSET.magnet });
    sim.tick(8_000); // full download
    const stats = await sim.statMedia(session.id);
    expect(stats.totalBytes).toBe(65_536);
    expect(stats.contentType).toBe("video/mp4");

    expect(bytesEqual(await sim.readRange(session.id, 0, 0), predictedBytes(LONG_ASSET, 0, 0))).toBe(true);
    expect(bytesEqual(await sim.readRange(session.id, 0, 4_095), predictedBytes(LONG_ASSET, 0, 4_095))).toBe(true);
    expect(
      bytesEqual(await sim.readRange(session.id, 30_000, 32_767), predictedBytes(LONG_ASSET, 30_000, 32_767)),
    ).toBe(true);
    expect(
      bytesEqual(await sim.readRange(session.id, 65_536 - 1_000, 65_535), predictedBytes(LONG_ASSET, 65_536 - 1_000, 65_535)),
    ).toBe(true);
  });

  it("unbuffered spans answer a retryable IO_ERROR — never fabricated bytes", async () => {
    const sim = createSimulationEngine({ assets: [LONG_ASSET], ...SIM_KNOBS });
    const session = await sim.open({ magnet: LONG_ASSET.magnet });
    const error = await expectNativeError(sim.readRange(session.id, 0, 4_095), "IO_ERROR");
    expect(error.retryable).toBe(true);
    sim.tick(8_000); // buffered now
    expect(bytesEqual(await sim.readRange(session.id, 0, 4_095), predictedBytes(LONG_ASSET, 0, 4_095))).toBe(true);
  });

  it("spans beyond the media size answer RANGE_NOT_SATISFIABLE; malformed spans INVALID_INPUT", async () => {
    const sim = createSimulationEngine({ assets: [LONG_ASSET], ...SIM_KNOBS });
    const session = await sim.open({ magnet: LONG_ASSET.magnet });
    sim.tick(8_000);
    await expectNativeError(sim.readRange(session.id, 0, 65_536), "RANGE_NOT_SATISFIABLE");
    await expectNativeError(sim.readRange(session.id, 65_536, 65_600), "RANGE_NOT_SATISFIABLE");
    await expectNativeError(sim.readRange(session.id, -1, 10), "INVALID_INPUT");
    await expectNativeError(sim.readRange(session.id, 10, 5), "INVALID_INPUT");
  });

  it("emits wire-valid unsolicited events (state-changed, buffered, progress)", async () => {
    const sim = createSimulationEngine({ assets: [LONG_ASSET], ...SIM_KNOBS });
    const events: EngineEvent[] = [];
    sim.onEngineEvent((event) => events.push(event));
    const session = await sim.open({ magnet: LONG_ASSET.magnet });
    await sim.resume(session.id);
    sim.tick(2_000);
    // Every emitted event survives the JSON wire round-trip.
    expect(events.length).toBeGreaterThan(2);
    for (const event of events) {
      expect(isEngineEvent(event)).toBe(true);
      expect(parseEvent(serializeEvent(event))).toEqual(event);
    }
    const first = events[0]!;
    expect(first.kind).toBe("state-changed");
    if (first.kind === "state-changed") {
      expect(first.from).toBe("resolving");
      expect(first.to).toBe("buffering");
      expect(first.sessionId).toBe(session.id);
      expect(first.protocol).toBe(PROTOCOL_VERSION);
    }
    const kinds = new Set(events.map((e) => e.kind));
    expect(kinds.has("state-changed")).toBe(true);
    expect(kinds.has("buffered")).toBe(true);
    expect(kinds.has("progress")).toBe(true);
  });

  it("the WFX-004 service envelope drives the simulation end-to-end", async () => {
    const sim = createSimulationEngine({ assets: [LONG_ASSET], ...SIM_KNOBS });
    const service = createNativeMediaService(sim);
    const opened = await service.open({ magnet: LONG_ASSET.magnet });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error("unreachable");
    const sessionId = opened.value.id;

    const playing = await service.control(sessionId, { kind: "play" });
    expect(playing.ok).toBe(true);
    if (playing.ok) expect(playing.value.state).toBe("playing");

    sim.tick(8_000); // full download (service snapshots do not track progress — documented)

    const range = await service.range({ sessionId, startByte: 100, endByte: 355 });
    expect(range.ok).toBe(true);
    if (!range.ok) throw new Error("unreachable");
    expect(range.value.totalBytes).toBe(65_536);
    expect(range.value.contentType).toBe("video/mp4");
    expect(bytesEqual(range.value.data, predictedBytes(LONG_ASSET, 100, 355))).toBe(true);

    const badSeek = await service.control(sessionId, { kind: "seek", positionMs: 999_999 });
    expect(badSeek.ok).toBe(false);
    if (!badSeek.ok) expect(badSeek.error.code).toBe("INVALID_INPUT");

    const closed = await service.control(sessionId, { kind: "close" });
    expect(closed.ok).toBe(true);
    const afterClose = await service.range({ sessionId, startByte: 0, endByte: 9 });
    expect(afterClose.ok).toBe(false);
    if (!afterClose.ok) expect(afterClose.error.code).toBe("SESSION_CLOSED");
  });
});

// ---------------------------------------------------------------------------
// 3. Adapter (createEngineAdapter + createInProcessEngineProcess)
// ---------------------------------------------------------------------------

/** A fully scriptable engine handle for adapter unit tests. */
class ScriptedHandle implements EngineHandle {
  readonly sent: EngineCommand[] = [];
  terminated = false;
  responder: ((command: EngineCommand) => Promise<EngineEvent>) | undefined;
  private readonly handlers: ((event: EngineEvent) => void)[] = [];

  send(command: EngineCommand): Promise<EngineEvent> {
    this.sent.push(command);
    const responder = this.responder;
    if (responder === undefined) {
      return Promise.reject(new Error("scripted: no responder configured"));
    }
    return responder(command);
  }

  onEvent(handler: (event: EngineEvent) => void): void {
    this.handlers.push(handler);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(event: EngineEvent): void {
    for (const handler of [...this.handlers]) handler(event);
  }
}

function scriptedProcess(handle: ScriptedHandle): NativeEngineProcess {
  return { spawn: () => handle };
}

function openedEvent(requestId: string, sessionId = "s-1", protocol = PROTOCOL_VERSION): EngineEvent {
  return {
    protocol,
    kind: "opened",
    requestId,
    session: { id: sessionId, assetId: "a", fileId: "f", state: "buffering", bufferedMs: 0, positionMs: 0 },
  };
}

describe("engine adapter — factory and marshalling", () => {
  it("validates the process, config, and options (typed INVALID_INPUT)", () => {
    expect(() => createEngineAdapter(null as never)).toThrow(NativeMediaError);
    expect(() => createEngineAdapter({} as never)).toThrow(NativeMediaError);
    expect(() =>
      createEngineAdapter(scriptedProcess(new ScriptedHandle()), { cacheDir: "", maxCacheBytes: 1 }),
    ).toThrow(NativeMediaError);
    expect(() =>
      createEngineAdapter(scriptedProcess(new ScriptedHandle()), ENGINE_TEST_CONFIG, { callTimeoutMs: -1 }),
    ).toThrow(NativeMediaError);
  });

  it("a spawn failure or invalid handle is a typed INTERNAL error", () => {
    const throwing: NativeEngineProcess = {
      spawn: () => {
        throw new Error("boom");
      },
    };
    try {
      createEngineAdapter(throwing, ENGINE_TEST_CONFIG);
      throw new Error("expected INTERNAL");
    } catch (e) {
      expect((e as NativeMediaError).code).toBe("INTERNAL");
    }
    const badHandle: NativeEngineProcess = { spawn: () => ({}) as never };
    try {
      createEngineAdapter(badHandle, ENGINE_TEST_CONFIG);
      throw new Error("expected INTERNAL");
    } catch (e) {
      expect((e as NativeMediaError).code).toBe("INTERNAL");
    }
  });

  it("marshals open as a versioned wire command and adopts the response session", async () => {
    const handle = new ScriptedHandle();
    handle.responder = (command) => Promise.resolve(openedEvent(command.requestId));
    const adapter = createEngineAdapter(scriptedProcess(handle), ENGINE_TEST_CONFIG);
    const session = await adapter.open({ magnet: LONG_ASSET.magnet });
    expect(session.id).toBe("s-1");
    expect(session.state).toBe("buffering");
    expect((await adapter.status("s-1")).id).toBe("s-1");

    expect(handle.sent.length).toBe(1);
    const command = handle.sent[0]!;
    expect(command.kind).toBe("open");
    expect(command.protocol).toBe(PROTOCOL_VERSION);
    expect(command.requestId).toMatch(/^req-\d+$/);
    if (command.kind === "open") {
      expect(command.source.magnet).toBe(LONG_ASSET.magnet);
    }
  });

  it("fails fast on invalid input without crossing the wire", async () => {
    const handle = new ScriptedHandle();
    const adapter = createEngineAdapter(scriptedProcess(handle), ENGINE_TEST_CONFIG);
    await expectNativeError(adapter.open({}), "INVALID_INPUT");
    await expectNativeError(adapter.open({ magnet: "junk" }), "INVALID_INPUT");
    await expectNativeError(adapter.open({ torrentBytes: new Uint8Array(0) }), "INVALID_INPUT");
    await expectNativeError(adapter.seek("s-1", -5), "NOT_FOUND"); // unknown first
    expect(handle.sent.length).toBe(0);
  });

  it("unknown sessions are NOT_FOUND; closed and terminal sessions SESSION_CLOSED", async () => {
    const proc = createInProcessEngineProcess({ assets: [SHORT_ASSET] });
    const adapter = createEngineAdapter(proc, ENGINE_TEST_CONFIG);
    await expectNativeError(adapter.seek("ghost", 0), "NOT_FOUND");
    await expectNativeError(adapter.pause("ghost"), "NOT_FOUND");
    await expectNativeError(adapter.status("ghost"), "NOT_FOUND");
    await expectNativeError(adapter.statMedia("ghost"), "NOT_FOUND");

    const session = await adapter.open({ magnet: SHORT_ASSET.magnet });
    await adapter.close(session.id);
    await expectNativeError(adapter.seek(session.id, 0), "SESSION_CLOSED");
    await expectNativeError(adapter.status(session.id), "SESSION_CLOSED");
    await expectNativeError(adapter.close(session.id), "SESSION_CLOSED");
    await expectNativeError(adapter.readRange(session.id, 0, 9), "SESSION_CLOSED");
  });
});

describe("engine adapter — hostile process behavior", () => {
  it("a hanging process misses the deadline: typed retryable ENGINE_TIMEOUT", async () => {
    const handle = new ScriptedHandle();
    handle.responder = () => new Promise<EngineEvent>(() => {}); // never settles
    const adapter = createEngineAdapter(scriptedProcess(handle), ENGINE_TEST_CONFIG, { callTimeoutMs: 15 });
    const error = await expectNativeError(adapter.open({ magnet: LONG_ASSET.magnet }), "ENGINE_TIMEOUT");
    expect(error.retryable).toBe(true);
  });

  it("deadline enforcement can be disabled (callTimeoutMs = 0)", async () => {
    const handle = new ScriptedHandle();
    let resolveResponse: (() => void) | undefined;
    handle.responder = (command) =>
      new Promise<EngineEvent>((resolve) => {
        resolveResponse = () => resolve(openedEvent(command.requestId));
      });
    const adapter = createEngineAdapter(scriptedProcess(handle), ENGINE_TEST_CONFIG, { callTimeoutMs: 0 });
    const pending = adapter.open({ magnet: LONG_ASSET.magnet });
    resolveResponse!();
    const session = await pending;
    expect(session.id).toBe("s-1");
  });

  it("malformed, wrong-version, mis-correlated, and unsolicited responses are INTERNAL", async () => {
    const cases: {
      name: string;
      respond: (command: EngineCommand) => Promise<EngineEvent>;
    }[] = [
      {
        name: "garbage object",
        respond: () => Promise.resolve({ kind: "garbage" } as never as EngineEvent),
      },
      {
        name: "wrong protocol version",
        respond: (command) => Promise.resolve(openedEvent(command.requestId, "s-1", 999)),
      },
      {
        name: "mis-correlated requestId",
        respond: () => Promise.resolve(openedEvent("req-999")),
      },
      {
        name: "unsolicited kind in the response slot",
        respond: () =>
          Promise.resolve({
            protocol: PROTOCOL_VERSION,
            kind: "progress",
            sessionId: "s-1",
            positionMs: 0,
            bufferedMs: 0,
            session: { id: "s-1", assetId: "a", fileId: "f", state: "buffering", bufferedMs: 0, positionMs: 0 },
          }),
      },
    ];
    for (const testCase of cases) {
      const handle = new ScriptedHandle();
      handle.responder = testCase.respond;
      const adapter = createEngineAdapter(scriptedProcess(handle), ENGINE_TEST_CONFIG);
      const error = await expectNativeError(adapter.open({ magnet: LONG_ASSET.magnet }), "INTERNAL");
      expect(error.retryable).toBe(false);
    }
  });

  it("a typed engine error response keeps its code across the wire", async () => {
    const handle = new ScriptedHandle();
    handle.responder = (command) =>
      Promise.resolve({
        protocol: PROTOCOL_VERSION,
        kind: "error",
        code: "UNSUPPORTED_SOURCE",
        message: "engine says no",
        requestId: command.requestId,
      });
    const adapter = createEngineAdapter(scriptedProcess(handle), ENGINE_TEST_CONFIG);
    const error = await expectNativeError(adapter.open({ magnet: LONG_ASSET.magnet }), "UNSUPPORTED_SOURCE");
    expect(error.detail).toBe("engine says no");
  });

  it("send failures that are not NativeMediaErrors map to INTERNAL (mapEngineError reuse)", async () => {
    const handle = new ScriptedHandle();
    handle.responder = () => Promise.reject(new Error("transport exploded"));
    const adapter = createEngineAdapter(scriptedProcess(handle), ENGINE_TEST_CONFIG);
    await expectNativeError(adapter.open({ magnet: LONG_ASSET.magnet }), "INTERNAL");
  });
});

describe("engine adapter — in-process equivalence and crash detection", () => {
  /**
   * The equivalence script: identical command + tick sequences against (A) the
   * direct simulation and (B) the adapter over the in-process process. Failing
   * commands assert identical typed error codes; the final states must match.
   */
  it("same command sequence → same final states (adapter ≡ direct simulation)", async () => {
    const direct = createSimulationEngine({ assets: [LONG_ASSET], ...SIM_KNOBS });
    const proc = createInProcessEngineProcess({
      assets: [LONG_ASSET],
      tickIntervalMs: SIM_KNOBS.tickIntervalMs,
      bytesPerTick: SIM_KNOBS.bytesPerTick,
    });
    const adapter = createEngineAdapter(proc, ENGINE_TEST_CONFIG);
    const piped = proc.handles[0]?.simulation;
    expect(piped).toBeDefined();

    // --- open ---
    const a = await direct.open({ magnet: LONG_ASSET.magnet });
    const b = await adapter.open({ magnet: LONG_ASSET.magnet });
    expect(b).toEqual(a);

    // --- seek + failing seeks (same typed codes on both sides) ---
    await direct.seek(a.id, 10_000);
    await adapter.seek(b.id, 10_000);
    (await expectNativeError(direct.seek(a.id, 999_999), "INVALID_INPUT"));
    (await expectNativeError(adapter.seek(b.id, 999_999), "INVALID_INPUT"));
    (await expectNativeError(direct.seek("ghost", 0), "NOT_FOUND"));
    (await expectNativeError(adapter.seek("ghost", 0), "NOT_FOUND"));

    // --- ticks 4s (download refocused on the seek target) ---
    direct.tick(4_000);
    piped!.tick(4_000);

    // --- resume (buffering → playing) ---
    await direct.resume(a.id);
    await adapter.resume(b.id);

    // --- ticks 2s ---
    direct.tick(2_000);
    piped!.tick(2_000);

    // --- pause, ticks 2s, resume, ticks 2s ---
    await direct.pause(a.id);
    await adapter.pause(b.id);
    direct.tick(2_000);
    piped!.tick(2_000);
    await direct.resume(a.id);
    await adapter.resume(b.id);
    direct.tick(2_000);
    piped!.tick(2_000);

    // Mid-script comparison: snapshots identical.
    expect(await adapter.status(b.id)).toEqual(await direct.status(a.id));

    // --- failing prioritize (same typed code) ---
    (await expectNativeError(direct.prioritize(a.id, [{ piece: 99, deadlineMs: 0 }]), "INVALID_INPUT"));
    (await expectNativeError(adapter.prioritize(b.id, [{ piece: 99, deadlineMs: 0 }]), "INVALID_INPUT"));

    // --- background + background completion ---
    direct.goBackground(a.id);
    piped!.goBackground(b.id);
    direct.tick(2_000);
    piped!.tick(2_000);

    // --- final states identical ---
    const finalDirect = await direct.status(a.id);
    const finalAdapter = await adapter.status(b.id);
    expect(finalAdapter).toEqual(finalDirect);
    expect(finalDirect.state).toBe("complete");
    expect(finalDirect.bufferedMs).toBe(60_000);
    expect(finalDirect.positionMs).toBe(14_000);

    // --- range access identical through the wire ---
    const statsDirect = await direct.statMedia(a.id);
    const statsAdapter = await adapter.statMedia(b.id);
    expect(statsAdapter).toEqual(statsDirect);
    const bytesDirect = await direct.readRange(a.id, 100, 4_195);
    const bytesAdapter = await adapter.readRange(b.id, 100, 4_195);
    expect(bytesEqual(bytesAdapter, bytesDirect)).toBe(true);
    expect(bytesEqual(bytesAdapter, predictedBytes(LONG_ASSET, 100, 4_195))).toBe(true);
  });

  it("process crash → all live sessions failed, every operation typed INTERNAL", async () => {
    const proc = createInProcessEngineProcess({ assets: [LONG_ASSET] });
    const adapter = createEngineAdapter(proc, ENGINE_TEST_CONFIG);
    const s1 = await adapter.open({ magnet: LONG_ASSET.magnet });
    await adapter.resume(s1.id);
    const s2 = await adapter.open({ localPath: LONG_ASSET.localPath });

    proc.crash("simulated engine panic");

    expect((await adapter.status(s1.id)).state).toBe("failed");
    expect((await adapter.status(s2.id)).state).toBe("failed");
    const error = await expectNativeError(adapter.seek(s1.id, 0), "INTERNAL");
    expect(error.retryable).toBe(false);
    expect(error.detail).toContain("engine process");
    await expectNativeError(adapter.pause(s2.id), "INTERNAL");
    await expectNativeError(adapter.open({ magnet: LONG_ASSET.magnet }), "INTERNAL");
    await expectNativeError(adapter.statMedia(s1.id), "INTERNAL");
    await expectNativeError(adapter.readRange(s1.id, 0, 9), "INTERNAL");
    await expectNativeError(adapter.close(s1.id), "INTERNAL");
  });

  it("a session-scoped non-fatal error event fails only that session", async () => {
    const handle = new ScriptedHandle();
    let openings = 0;
    handle.responder = (command) => {
      openings += 1;
      return Promise.resolve(openedEvent(command.requestId, `s-${openings}`));
    };
    const adapter = createEngineAdapter(scriptedProcess(handle), ENGINE_TEST_CONFIG);
    const session = await adapter.open({ magnet: LONG_ASSET.magnet });
    handle.emit({
      protocol: PROTOCOL_VERSION,
      kind: "error",
      code: "VERIFICATION_FAILED",
      message: "hash mismatch on piece 7",
      sessionId: session.id,
    });
    expect((await adapter.status(session.id)).state).toBe("failed");
    await expectNativeError(adapter.seek(session.id, 0), "SESSION_CLOSED");
    // The adapter itself is still alive for new sessions.
    const next = await adapter.open({ magnet: LONG_ASSET.magnet });
    expect(next.id).toBe("s-2");
  });

  it("terminate (dispose) also fail-closes live sessions with typed INTERNAL", async () => {
    const proc = createInProcessEngineProcess({ assets: [LONG_ASSET] });
    const adapter = createEngineAdapter(proc, ENGINE_TEST_CONFIG);
    const session = await adapter.open({ magnet: LONG_ASSET.magnet });
    proc.dispose();
    expect((await adapter.status(session.id)).state).toBe("failed");
    await expectNativeError(adapter.resume(session.id), "INTERNAL");
  });

  it("unsolicited events update adapter-side state (event → session mapping)", async () => {
    const proc = createInProcessEngineProcess({
      assets: [LONG_ASSET],
      tickIntervalMs: SIM_KNOBS.tickIntervalMs,
      bytesPerTick: SIM_KNOBS.bytesPerTick,
    });
    const adapter = createEngineAdapter(proc, ENGINE_TEST_CONFIG);
    const session = await adapter.open({ magnet: LONG_ASSET.magnet });
    await adapter.resume(session.id);
    expect((await adapter.status(session.id)).state).toBe("playing");
    proc.handles[0]!.simulation.tick(4_000);
    const status = await adapter.status(session.id);
    expect(status.bufferedMs).toBe(30_000); // updated via forwarded 'buffered' events
    expect(status.positionMs).toBe(4_000); // updated via forwarded 'progress' events
  });

  it("a typed error round-trips the wire for an unsupported source (torrentBytes)", async () => {
    const proc = createInProcessEngineProcess({ assets: [LONG_ASSET] });
    const adapter = createEngineAdapter(proc, ENGINE_TEST_CONFIG);
    const error = await expectNativeError(
      adapter.open({ torrentBytes: new Uint8Array([1, 2, 3, 4]) }),
      "UNSUPPORTED_SOURCE",
    );
    expect(error.detail).toContain("torrent");
  });

  it("the WFX-004 service envelope composes over the adapter (full stack)", async () => {
    const proc = createInProcessEngineProcess({
      assets: [LONG_ASSET],
      tickIntervalMs: SIM_KNOBS.tickIntervalMs,
      bytesPerTick: SIM_KNOBS.bytesPerTick,
    });
    const adapter = createEngineAdapter(proc, ENGINE_TEST_CONFIG);
    const service = createNativeMediaService(adapter);

    const opened = await service.open({ magnet: LONG_ASSET.magnet });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error("unreachable");
    const sessionId = opened.value.id;

    const playing = await service.control(sessionId, { kind: "play" });
    expect(playing.ok).toBe(true);
    if (playing.ok) expect(playing.value.state).toBe("playing");

    proc.handles[0]!.simulation.tick(8_000); // full download

    const range = await service.range({ sessionId, startByte: 1_000, endByte: 1_999 });
    expect(range.ok).toBe(true);
    if (!range.ok) throw new Error("unreachable");
    expect(bytesEqual(range.value.data, predictedBytes(LONG_ASSET, 1_000, 1_999))).toBe(true);
    expect(range.value.totalBytes).toBe(65_536);

    const closed = await service.control(sessionId, { kind: "close" });
    expect(closed.ok).toBe(true);
    const after = await service.range({ sessionId, startByte: 0, endByte: 9 });
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe("SESSION_CLOSED");
  });

  it("createInProcessEngineProcess validates its options", () => {
    expect(() => createInProcessEngineProcess(null as never)).toThrow(NativeMediaError);
    expect(() => createInProcessEngineProcess({ assets: "nope" as never })).toThrow(NativeMediaError);
    const proc = createInProcessEngineProcess();
    expect(proc.handles.length).toBe(0);
    // spawn validates the engine config (typed INVALID_INPUT).
    expect(() => proc.spawn({ cacheDir: "", maxCacheBytes: 1 })).toThrow(NativeMediaError);
    expect(() => proc.spawn({ cacheDir: "ok", maxCacheBytes: 0 })).toThrow(NativeMediaError);
  });
});

// ---------------------------------------------------------------------------
// 4. Cache policy
// ---------------------------------------------------------------------------

describe("cache policy — admission", () => {
  it("admits under the budget and refuses over-budget admissions", () => {
    let tracker = createCacheTracker({ maxBytes: 1_000, evictOrder: "lru" });
    expect(shouldAdmit(tracker, 500)).toBe(true);
    tracker = trackPiece(tracker, { id: "a", bytes: 300 });
    tracker = trackPiece(tracker, { id: "b", bytes: 500 });
    expect(usedBytes(tracker)).toBe(800);
    expect(shouldAdmit(tracker, 200)).toBe(true); // exactly fits
    expect(shouldAdmit(tracker, 201)).toBe(false); // over budget
  });

  it("zero budget rejects everything; impossible sizes never evict", () => {
    const tracker = createCacheTracker({ maxBytes: 0, evictOrder: "lru" });
    expect(shouldAdmit(tracker, 1)).toBe(false);
    expect(evictList(tracker, 1)).toEqual([]);
    const big = createCacheTracker({ maxBytes: 1_000, evictOrder: "fifo" });
    const tracked = trackPiece(trackPiece(big, { id: "a", bytes: 800 }), { id: "b", bytes: 200 });
    expect(shouldAdmit(tracked, 1_500)).toBe(false); // exceeds the whole cache
    expect(evictList(tracked, 1_500)).toEqual([]); // no plan can help
  });

  it("evictList is empty when the bytes already fit", () => {
    const tracker = createCacheTracker({ maxBytes: 1_000, evictOrder: "lru" });
    const tracked = trackPiece(tracker, { id: "a", bytes: 400 });
    expect(evictList(tracked, 600)).toEqual([]);
    expect(shouldAdmit(tracked, 600)).toBe(true);
  });
});

describe("cache policy — eviction order", () => {
  function populated(evictOrder: "lru" | "fifo") {
    let tracker = createCacheTracker({ maxBytes: 1_000, evictOrder });
    tracker = trackPiece(tracker, { id: "a", bytes: 100 });
    tracker = trackPiece(tracker, { id: "b", bytes: 200 });
    tracker = trackPiece(tracker, { id: "c", bytes: 300 });
    return tracker; // used 600
  }

  it("LRU evicts least-recently-used first (a touch rescues)", () => {
    const lru = touchEntry(populated("lru"), "a"); // a is now most recent
    expect(evictList(lru, 700)).toEqual(["b", "c"]); // free 500 of the needed 600
  });

  it("FIFO ignores touches and evicts oldest admission first", () => {
    const fifo = touchEntry(populated("fifo"), "a"); // touch must NOT rescue a
    expect(evictList(fifo, 700)).toEqual(["a", "b"]);
  });

  it("eviction is minimal — exactly as many victims as needed", () => {
    let tracker = createCacheTracker({ maxBytes: 1_000, evictOrder: "fifo" });
    tracker = trackPiece(tracker, { id: "a", bytes: 800 });
    tracker = trackPiece(tracker, { id: "b", bytes: 100 });
    expect(usedBytes(tracker)).toBe(900);
    expect(evictList(tracker, 150)).toEqual(["a"]); // 900-800+150 = 250 ≤ 1000
    // Survivors plus the newcomer fit.
    const afterA = forgetEntry(tracker, "a");
    expect(shouldAdmit(afterA, 150)).toBe(true);
  });

  it("full eviction is returned when everything must go", () => {
    let tracker = createCacheTracker({ maxBytes: 1_000, evictOrder: "lru" });
    tracker = trackPiece(tracker, { id: "a", bytes: 600 });
    tracker = trackPiece(tracker, { id: "b", bytes: 300 });
    expect(evictList(tracker, 900)).toEqual(["a", "b"]); // 900+900 > 1000 until both go
  });
});

describe("cache policy — accounting discipline", () => {
  it("trackPiece is pure: the input tracker is never mutated", () => {
    const tracker = createCacheTracker({ maxBytes: 1_000, evictOrder: "lru" });
    const next = trackPiece(tracker, { id: "a", bytes: 100 });
    expect(tracker.entries.size).toBe(0);
    expect(tracker.clock).toBe(0);
    expect(next.entries.size).toBe(1);
    expect(next.clock).toBe(1);
  });

  it("duplicate ids, unknown touches, and unknown forgets are typed errors", () => {
    let tracker = createCacheTracker({ maxBytes: 1_000, evictOrder: "lru" });
    tracker = trackPiece(tracker, { id: "a", bytes: 100 });
    expect(() => trackPiece(tracker, { id: "a", bytes: 50 })).toThrow(NativeMediaError);
    try {
      trackPiece(tracker, { id: "a", bytes: 50 });
      throw new Error("expected INVALID_INPUT");
    } catch (e) {
      expect((e as NativeMediaError).code).toBe("INVALID_INPUT");
    }
    expect(() => touchEntry(tracker, "ghost")).toThrow(NativeMediaError);
    try {
      touchEntry(tracker, "ghost");
      throw new Error("expected NOT_FOUND");
    } catch (e) {
      expect((e as NativeMediaError).code).toBe("NOT_FOUND");
    }
    expect(() => forgetEntry(tracker, "ghost")).toThrow(NativeMediaError);
    expect(() => trackPiece(tracker, { id: "z", bytes: 0 })).toThrow(NativeMediaError);
  });

  it("malformed policies and trackers are typed errors / total predicates", () => {
    expect(() => createCacheTracker({ maxBytes: -1, evictOrder: "lru" })).toThrow(NativeMediaError);
    expect(() => createCacheTracker({ maxBytes: 1.5, evictOrder: "lru" })).toThrow(NativeMediaError);
    expect(() => createCacheTracker({ maxBytes: 100, evictOrder: "random" as never })).toThrow(NativeMediaError);
    // Total predicates answer false/empty for runtime garbage — never throw.
    expect(shouldAdmit(null as never, 10)).toBe(false);
    expect(evictList(null as never, 10)).toEqual([]);
    expect(shouldAdmit(createCacheTracker({ maxBytes: 100, evictOrder: "lru" }), -5)).toBe(false);
    expect(evictList(createCacheTracker({ maxBytes: 100, evictOrder: "lru" }), Number.NaN)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Misc: default asset + guard exports
// ---------------------------------------------------------------------------

describe("engine module — defaults and guards", () => {
  it("the default simulation asset is well-formed and openable", async () => {
    const sim = createSimulationEngine({ autoTick: false });
    const defaultMagnet = DEFAULT_SIMULATION_ASSET.magnet!;
    const defaultPath = DEFAULT_SIMULATION_ASSET.localPath!;
    const session = await sim.open({ magnet: defaultMagnet });
    expect(session.assetId).toBe(DEFAULT_SIMULATION_ASSET.assetId);
    const other = await sim.open({ localPath: defaultPath });
    expect(other.assetId).toBe(DEFAULT_SIMULATION_ASSET.assetId);
  });

  it("simulationMediaByte rejects out-of-domain offsets (typed)", () => {
    expect(() => simulationMediaByte(LONG_ASSET, -1)).toThrow(NativeMediaError);
    expect(() => simulationMediaByte(LONG_ASSET, LONG_ASSET.totalBytes)).toThrow(NativeMediaError);
    expect(simulationMediaByte(LONG_ASSET, 0)).toBe(
      simulationMediaByte(LONG_ASSET, 0), // deterministic
    );
  });

  it("tick returns the executed tick count and validates input", async () => {
    const sim = createSimulationEngine({ assets: [LONG_ASSET], ...SIM_KNOBS });
    await sim.open({ magnet: LONG_ASSET.magnet });
    expect(sim.tick(999)).toBe(0); // sub-tick elapsed time executes nothing
    expect(sim.tick(2_500)).toBe(2);
    expect(() => sim.tick(-1)).toThrow(NativeMediaError);
  });
});
