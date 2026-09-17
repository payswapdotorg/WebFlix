/**
 * R10 — THE REAL ENGINE tests.
 *
 * The production engine over REAL local files: deterministic byte-exact
 * read-ahead accounting (`pumpOnce` — one REAL read per accounted piece;
 * `bufferedMs` advances ONLY as bytes actually land), the nominal
 * timeline, seek re-cursoring, ABSOLUTE-piece prioritization, pause/
 * resume semantics (pause is not a state), REAL range reads (byte-exact,
 * refused beyond the buffered span), THE COMPLETION LAW (persist +
 * digest-verify BEFORE `complete`; mismatch/persistence failure ⇒ honest
 * `failed`), store-backed opens (verify-on-open; corrupt ⇒ typed
 * VERIFICATION_FAILED), disk-truth statMedia, and the recovery restore
 * mapping.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createRealEngine,
  type RealEngine,
  type RealEngineConfig,
} from "../src/service-process/engine";
import { sha256Hex } from "../src/service-process/store";

// ---------------------------------------------------------------------------
// Fixtures — deterministic REAL files
// ---------------------------------------------------------------------------

const TMP_ROOT = join(import.meta.dir, "tmp-engine-test");

function writeMediaFile(name: string, size: number): { path: string; bytes: Uint8Array } {
  const path = join(TMP_ROOT, name);
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    bytes[i] = (i * 13 + 5) % 251;
  }
  writeFileSync(path, bytes);
  return { path, bytes };
}

/** A manual monotonic clock (deterministic playback tests). */
class ManualClock {
  private now = 0;
  tick(ms: number): void {
    this.now += ms;
  }
  value(): number {
    return this.now;
  }
}

let engineCounter = 0;
interface TestEngine {
  readonly engine: RealEngine;
  readonly root: string;
  readonly clock: ManualClock;
}

/**
 * A fresh engine over a fresh store root with the TEST geometry:
 * 1000-byte pieces, a 2 Mbps nominal bitrate, NO auto timer (every
 * read/playback step is pumped or ticked by the test).
 */
function newEngine(overrides: Partial<RealEngineConfig> = {}): TestEngine {
  engineCounter += 1;
  const root = join(TMP_ROOT, `engine-${engineCounter}`);
  const clock = new ManualClock();
  const engine = createRealEngine({
    storeRoot: root,
    maxCacheBytes: 64 * 1024 * 1024,
    readChunkBytes: 1_000,
    nominalBitrateBps: 2_000_000, // 1000 bytes = 4 ms of timeline
    readBytesPerSecond: 1_000_000,
    tickMs: 25,
    rebufferLeadMs: 0, // the 40 ms test timeline has no room for the 250 ms default lead
    autoTick: false,
    clock: () => clock.value(),
    ...overrides,
  });
  return { engine, root, clock };
}

beforeAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

// geometry helper: 10_000 bytes / 1000-byte chunks ⇒ 10 pieces × 4 ms.
const TEN_PIECE = writeMediaFile; // alias for readability at call sites

describe("R10 — the REAL engine: open + honest read-ahead", () => {
  it("open requires a localPath; magnets are R11's lane (typed UNSUPPORTED_SOURCE)", async () => {
    const { engine } = newEngine();
    await expect(engine.open({ magnet: "magnet:?xt=urn:btih:abc" })).rejects.toMatchObject({
      code: "UNSUPPORTED_SOURCE",
    });
    await expect(engine.open({ torrentBytes: new Uint8Array([1]) })).rejects.toMatchObject({
      code: "UNSUPPORTED_SOURCE",
    });
    await expect(engine.open({})).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("open of a missing/empty file is a typed honest failure", async () => {
    const { engine } = newEngine();
    await expect(engine.open({ localPath: join(TMP_ROOT, "missing.bin") })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const empty = join(TMP_ROOT, "empty.bin");
    writeFileSync(empty, new Uint8Array(0));
    await expect(engine.open({ localPath: empty })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("open stats the REAL file: 10 pieces, buffering, bufferedMs 0, integrity unknown", async () => {
    const { engine } = newEngine();
    const { path } = TEN_PIECE("media-a.bin", 10_000);
    const session = await engine.open({ localPath: path });
    expect(session.state).toBe("buffering");
    expect(session.bufferedMs).toBe(0);
    expect(session.positionMs).toBe(0);
    expect(session.integrity).toBe("unknown");
    expect(session.id).toBe("real-session-1");
    // assetId is the deterministic path hash.
    expect(session.assetId.startsWith("asset-")).toBe(true);
    const again = await engine.open({ localPath: path });
    expect(again.assetId).toBe(session.assetId);
    expect(again.id).toBe("real-session-2");
  });

  it("HONEST BUFFERING: bufferedMs advances ONLY as bytes actually land (pump = one real read)", async () => {
    const { engine } = newEngine();
    const { path } = TEN_PIECE("media-b.bin", 10_000);
    const session = await engine.open({ localPath: path });

    // Nothing pumped: nothing buffered — no fake progress, ever.
    expect(engine.snapshot(session.id)?.bufferedMs).toBe(0);

    // One pump = one 1000-byte piece = exactly 4 ms of the nominal timeline
    // (10_000 bytes @ 2 Mbps ⇒ 40 ms total; 10 pieces of 4 ms).
    await engine.pumpOnce(session.id);
    expect(engine.snapshot(session.id)?.bufferedMs).toBe(4);

    await engine.pumpOnce(session.id);
    await engine.pumpOnce(session.id);
    expect(engine.snapshot(session.id)?.bufferedMs).toBe(12); // 3 pieces × 4 ms

    // Pump everything: the full contiguous coverage from the playhead.
    for (let i = 0; i < 20; i += 1) {
      await engine.pumpOnce(session.id);
    }
    expect(engine.snapshot(session.id)?.bufferedMs).toBe(40); // durationMs
    // The session is NOT complete (fully buffered ≠ completed playback:
    // the FSM forbids buffering -> complete).
    expect(engine.snapshot(session.id)?.state).toBe("buffering");
  });

  it("the read budget is the elapsed-time law; tickOnce advances through REAL reads", async () => {
    const { engine, clock } = newEngine();
    const { path } = TEN_PIECE("media-c.bin", 10_000);
    const session = await engine.open({ localPath: path });
    // 1 MB/s read budget: after 3 ms of clock, the budget is 3000 bytes.
    clock.tick(3);
    await engine.tickOnce();
    expect(engine.snapshot(session.id)?.bufferedMs).toBe(12); // 3 pieces
    clock.tick(2);
    await engine.tickOnce();
    expect(engine.snapshot(session.id)?.bufferedMs).toBe(20); // 5 pieces
  });

  it("readRange serves the REAL bytes byte-exactly; refuses the not-yet-read span", async () => {
    const { engine } = newEngine();
    const { path, bytes } = TEN_PIECE("media-d.bin", 10_000);
    const session = await engine.open({ localPath: path });
    await engine.pumpOnce(session.id);
    await engine.pumpOnce(session.id);

    const head = await engine.readRange(session.id, 0, 1_999);
    expect(Array.from(head)).toEqual(Array.from(bytes.slice(0, 2_000)));

    // Piece 2 (bytes 2000-2999) has NOT been read: the honest retryable
    // refusal — never fabricated bytes.
    await expect(engine.readRange(session.id, 0, 2_000)).rejects.toMatchObject({
      code: "IO_ERROR",
      retryable: true,
    });

    // statMedia reports the REAL size + the content type.
    const stat = await engine.statMedia(session.id);
    expect(stat.totalBytes).toBe(10_000);
    expect(stat.contentType).toBe("application/octet-stream");
  });

  it("readRange bounds: beyond the file is RANGE_NOT_SATISFIABLE; unknown/closed are typed", async () => {
    const { engine } = newEngine();
    const { path } = TEN_PIECE("media-e.bin", 3_000);
    const session = await engine.open({ localPath: path });
    await expect(engine.readRange(session.id, 0, 3_000)).rejects.toMatchObject({
      code: "RANGE_NOT_SATISFIABLE",
    });
    await expect(engine.readRange("nope", 0, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await engine.close(session.id);
    await expect(engine.readRange(session.id, 0, 1)).rejects.toMatchObject({
      code: "SESSION_CLOSED",
    });
  });

  it("SEEK re-cursors the read-ahead: after seek the forward pieces land first", async () => {
    const { engine } = newEngine();
    const { path, bytes } = TEN_PIECE("media-f.bin", 10_000);
    const session = await engine.open({ localPath: path });
    // Seek to 20 ms (byte 5000, piece 5): pending order is 5,6,7,8,9,0..4.
    await engine.seek(session.id, 20_000 / 1000 * 1); // positionMs semantics: 20_000 ms? no —
    // (the nominal timeline: 10_000 bytes @ 2 Mbps = 40 ms; 20 ms = piece 5)
    expect(engine.snapshot(session.id)?.positionMs).toBe(20);

    await engine.pumpOnce(session.id);
    await engine.pumpOnce(session.id);
    // Pieces 5 and 6 landed: bytes 5000..6999 are readable...
    const forward = await engine.readRange(session.id, 5_000, 6_999);
    expect(Array.from(forward)).toEqual(Array.from(bytes.slice(5_000, 7_000)));
    // ...while bytes BEFORE the seek point (piece 0) are not yet available.
    await expect(engine.readRange(session.id, 0, 999)).rejects.toMatchObject({
      code: "IO_ERROR",
    });
    // The buffered-through marker counts from the PLAYHEAD.
    expect(engine.snapshot(session.id)?.bufferedMs).toBe(28); // 20 + 2 pieces
  });

  it("seek bounds and unknown sessions are typed failures", async () => {
    const { engine } = newEngine();
    const { path } = TEN_PIECE("media-g.bin", 10_000);
    const session = await engine.open({ localPath: path });
    await expect(engine.seek(session.id, 41)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(engine.seek(session.id, -1)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(engine.seek("nope", 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("PRIORITIZE hoists pending pieces by deadline (ABSOLUTE indices, simulation law)", async () => {
    const { engine } = newEngine();
    const { path, bytes } = TEN_PIECE("media-h.bin", 10_000);
    const session = await engine.open({ localPath: path });
    // Hoist piece 9 (deadline 1) ahead of the natural order.
    await engine.prioritize(session.id, [
      { piece: 9, deadlineMs: 100 },
      { piece: 7, deadlineMs: 50 },
    ]);
    await engine.pumpOnce(session.id);
    await engine.pumpOnce(session.id);
    // Pieces 7 and 9 landed (ascending deadline first) — bytes readable.
    const seven = await engine.readRange(session.id, 7_000, 7_999);
    expect(Array.from(seven)).toEqual(Array.from(bytes.slice(7_000, 8_000)));
    const nine = await engine.readRange(session.id, 9_000, 9_999);
    expect(Array.from(nine)).toEqual(Array.from(bytes.slice(9_000, 10_000)));
    // Piece 0 was NOT read (it is behind the hoisted pieces).
    await expect(engine.readRange(session.id, 0, 999)).rejects.toMatchObject({ code: "IO_ERROR" });

    await expect(
      engine.prioritize(session.id, [{ piece: 10, deadlineMs: 1 }]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(engine.prioritize(session.id, [{ piece: -1, deadlineMs: 1 }])).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("pause is NOT a state: the clock freezes; resume restarts playback (buffering -> playing)", async () => {
    const { engine, clock } = newEngine();
    const { path } = TEN_PIECE("media-i.bin", 10_000);
    const session = await engine.open({ localPath: path });
    await engine.resume(session.id);
    expect(engine.snapshot(session.id)?.state).toBe("playing");

    // Buffer 2 pieces (8 ms of lead), then play 4 ms.
    await engine.pumpOnce(session.id);
    await engine.pumpOnce(session.id);
    clock.tick(4);
    await engine.tickOnce();
    expect(engine.snapshot(session.id)?.positionMs).toBe(4);

    // PAUSE freezes the playback clock (reads continue — that is the point).
    await engine.pause(session.id);
    clock.tick(50);
    await engine.tickOnce();
    expect(engine.snapshot(session.id)?.positionMs).toBe(4);
    expect(engine.snapshot(session.id)?.state).toBe("playing"); // pause ≠ state

    // RESUME unfreezes it.
    await engine.resume(session.id);
    clock.tick(2);
    await engine.tickOnce();
    expect(engine.snapshot(session.id)?.positionMs).toBe(6);
  });

  it("PLAYBACK END completes honestly: persist + digest verified BEFORE the terminal claim", async () => {
    const { engine, clock } = newEngine();
    const { path, bytes } = TEN_PIECE("media-j.bin", 10_000);
    const session = await engine.open({ localPath: path });
    await engine.resume(session.id);

    // Fully buffer, then play to the very end of the nominal timeline.
    for (let i = 0; i < 12; i += 1) {
      await engine.pumpOnce(session.id);
    }
    clock.tick(100); // beyond the 40 ms duration
    await engine.tickOnce();

    const final = engine.snapshot(session.id);
    expect(final?.state).toBe("complete");
    // THE FROZEN LAW: complete ⇒ verified. The proof:
    expect(final?.integrity).toBe("verified");
    expect(final?.positionMs).toBe(40);

    // The asset was PERSISTED with the REAL digest.
    const meta = engine.store.getAsset(session.assetId);
    expect(meta).toBeDefined();
    expect(meta?.integrity).toBe("verified");
    expect(meta?.sha256).toBe(sha256Hex(bytes));
    expect(engine.store.statAsset(session.assetId)).toEqual({ sizeBytes: 10_000 });

    // Terminal: further control is SESSION_CLOSED; the cache still serves.
    await expect(engine.pause(session.id)).rejects.toMatchObject({ code: "SESSION_CLOSED" });
    const body = await engine.readRange(session.id, 0, 9_999);
    expect(body.length).toBe(10_000);
  });

  it("BACKGROUND COMPLETION: a backgrounded session whose bytes all land completes + persists", async () => {
    const { engine } = newEngine();
    const { path, bytes } = TEN_PIECE("media-k.bin", 10_000);
    const session = await engine.open({ localPath: path });
    await engine.resume(session.id); // buffering -> playing
    const background = await engine.enterBackground(session.id); // playing -> background
    expect(background.state).toBe("background");

    // The read-ahead completes the download in the background.
    for (let i = 0; i < 12; i += 1) {
      await engine.pumpOnce(session.id);
    }
    const final = engine.snapshot(session.id);
    expect(final?.state).toBe("complete");
    expect(final?.integrity).toBe("verified");
    const meta = engine.store.getAsset(session.assetId);
    expect(meta?.sha256).toBe(sha256Hex(bytes));

    // enterBackground is only legal from playing (typed otherwise).
    const other = await engine.open({ localPath: path });
    await expect(engine.enterBackground(other.id)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("COMPLETION HONESTY: a store quota failure fails the session (complete is never unproven)", async () => {
    // Budget too small for the 10_000-byte completion import.
    const { engine } = newEngine({ maxCacheBytes: 5_000 });
    const { path } = TEN_PIECE("media-l.bin", 10_000);
    const session = await engine.open({ localPath: path });
    await engine.resume(session.id);
    await engine.enterBackground(session.id);
    for (let i = 0; i < 12; i += 1) {
      await engine.pumpOnce(session.id);
    }
    const final = engine.snapshot(session.id);
    expect(final?.state).toBe("failed");
    expect(final?.integrity).toBe("unknown"); // no verdict was proven
    const evidence = engine.lastEvidence(session.id);
    expect(evidence?.failure).toBe("IO_ERROR");
    expect(String(evidence?.detail)).toContain("quota");
    // Nothing was persisted: the store is honestly empty.
    expect(engine.store.listAssets()).toEqual([]);
  });

  it("STORE-BACKED opens: verify-on-open yields the verified verdict + the store's asset identity", async () => {
    const { engine } = newEngine();
    const { path, bytes } = TEN_PIECE("media-m.bin", 10_000);
    const first = await engine.open({ localPath: path });
    await engine.resume(first.id);
    await engine.enterBackground(first.id);
    for (let i = 0; i < 12; i += 1) {
      await engine.pumpOnce(first.id);
    }
    expect(engine.snapshot(first.id)?.state).toBe("complete");

    // Open the STORED asset by its real content path.
    const contentPath = engine.store.contentPath(first.assetId);
    const stored = await engine.open({ localPath: contentPath });
    expect(stored.integrity).toBe("verified");
    expect(stored.assetId).toBe(first.assetId); // the STORE's identity
    // The stored bytes are served byte-exactly through the session (the
    // fresh session reads the span first — honest read-ahead accounting).
    await engine.pumpOnce(stored.id);
    const slice = await engine.readRange(stored.id, 100, 199);
    expect(Array.from(slice)).toEqual(Array.from(bytes.slice(100, 200)));
  });

  it("CORRUPT stored asset: open rejects with VERIFICATION_FAILED (corrupt bytes are never served)", async () => {
    const { engine } = newEngine();
    const { path } = TEN_PIECE("media-n.bin", 10_000);
    const first = await engine.open({ localPath: path });
    await engine.resume(first.id);
    await engine.enterBackground(first.id);
    for (let i = 0; i < 12; i += 1) {
      await engine.pumpOnce(first.id);
    }
    expect(engine.snapshot(first.id)?.state).toBe("complete");
    const assetId = first.assetId;

    // Corrupt ONE stored byte.
    const contentPath = engine.store.contentPath(assetId);
    const raw = new Uint8Array(readFileSync(contentPath));
    raw[7] = (raw[7]! + 1) % 251;
    writeFileSync(contentPath, raw);

    await expect(engine.open({ localPath: contentPath })).rejects.toMatchObject({
      code: "VERIFICATION_FAILED",
    });
    // The recorded verdict flipped to failed (data, not an exception).
    expect(engine.store.getAsset(assetId)?.integrity).toBe("failed");
  });

  it("statMedia is DISK TRUTH: a source that changed size is refused honestly", async () => {
    const { engine } = newEngine();
    const { path } = TEN_PIECE("media-o.bin", 10_000);
    const session = await engine.open({ localPath: path });
    // The file grows behind the session's back.
    writeFileSync(path, new Uint8Array(20_000));
    await expect(engine.statMedia(session.id)).rejects.toMatchObject({ code: "IO_ERROR" });
  });

  it("the vanished-mid-session source fails the session honestly on the next read tick", async () => {
    const { engine } = newEngine();
    const media = join(TMP_ROOT, "media-p.bin");
    writeFileSync(media, new Uint8Array(10_000));
    const session = await engine.open({ localPath: media });
    await engine.pumpOnce(session.id);
    // The bytes vanish mid-session.
    rmSync(media, { force: true });
    await expect(engine.pumpOnce(session.id)).rejects.toMatchObject({ code: "IO_ERROR" });
    const final = engine.snapshot(session.id);
    expect(final?.state).toBe("failed");
    expect(engine.lastEvidence(session.id)?.failure).toBe("IO_ERROR");
  });

  it("close forgets the session; double close is idempotent; unknown close is NOT_FOUND", async () => {
    const { engine } = newEngine();
    const { path } = TEN_PIECE("media-q.bin", 10_000);
    const session = await engine.open({ localPath: path });
    await engine.close(session.id);
    await engine.close(session.id); // idempotent
    await expect(engine.close(session.id)).resolves.toBeUndefined();
    await expect(engine.close("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(engine.snapshot(session.id)).toBeUndefined();
  });
});

describe("R10 — the REAL engine: the recovery restore mapping", () => {
  it("restoreSession re-opens with the SAME id at the control point (buffering, honestly 0 buffered)", async () => {
    const { engine, root, clock } = newEngine();
    const { path } = TEN_PIECE("media-r.bin", 10_000);
    const session = await engine.open({ localPath: path });
    await engine.resume(session.id);
    await engine.seek(session.id, 12);
    engine.dispose(); // the previous process dies

    // A REAL restart: a fresh engine over the same store root, restoring
    // the journaled control point under the SAME session id.
    const restarted = createRealEngine({
      storeRoot: root,
      maxCacheBytes: 64 * 1024 * 1024,
      readChunkBytes: 1_000,
      nominalBitrateBps: 2_000_000,
      readBytesPerSecond: 1_000_000,
      tickMs: 25,
      rebufferLeadMs: 0,
      autoTick: false,
      clock: () => clock.value(),
    });
    const engine2 = restarted;
    const restored = await engine2.restoreSession({
      sessionId: session.id,
      sourcePath: path,
      positionMs: 12,
    });
    expect(restored.id).toBe(session.id);
    expect(restored.state).toBe("buffering"); // the documented mapping
    expect(restored.positionMs).toBe(12);
    expect(restored.bufferedMs).toBe(0); // honest: the buffer died with the process
    expect(engine2.lastEvidence(session.id)).toMatchObject({
      recovered: true,
      reason: "engine-restart",
    });

    // The read-ahead re-cursors at the control point: piece 3 (byte 3000).
    await engine2.pumpOnce(session.id);
    const snapshot = engine2.snapshot(session.id);
    expect(snapshot?.bufferedMs).toBe(16); // 12 + 4 (one piece ahead)

    // resume works on the restored session (buffering -> playing).
    await engine2.resume(session.id);
    expect(engine2.snapshot(session.id)?.state).toBe("playing");
    engine2.dispose();
  });

  it("restoreSession of vanished bytes is the typed NOT_FOUND (recovery marks the tombstone)", async () => {
    const { engine } = newEngine();
    const media = join(TMP_ROOT, "media-s.bin");
    writeFileSync(media, new Uint8Array(10_000));
    await expect(
      engine.restoreSession({ sessionId: "s-gone", sourcePath: media, positionMs: 5 }),
    ).resolves.toBeTruthy();
    rmSync(media, { force: true });
    await expect(
      engine.restoreSession({ sessionId: "s-gone-2", sourcePath: media, positionMs: 5 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // The tombstone: a failed record answering control with SESSION_CLOSED.
    const tombstone = engine.markRestoredSessionFailed({
      sessionId: "s-gone-2",
      assetId: "asset-x",
      fileId: "file-x",
      detail: "the source bytes vanished",
    });
    expect(tombstone.state).toBe("failed");
    expect(engine.lastEvidence("s-gone-2")).toMatchObject({
      reason: "source-bytes-vanished",
    });
    await expect(engine.pause("s-gone-2")).rejects.toMatchObject({ code: "SESSION_CLOSED" });
  });

  it("restoreSession of a journaled failed integrity stays failed", async () => {
    const { engine } = newEngine();
    const media = join(TMP_ROOT, "media-t.bin");
    writeFileSync(media, new Uint8Array(10_000));
    const restored = await engine.restoreSession({
      sessionId: "s-corrupt",
      sourcePath: media,
      positionMs: 0,
      integrity: "failed",
    });
    expect(restored.state).toBe("failed");
    expect(restored.integrity).toBe("failed");
  });
});
