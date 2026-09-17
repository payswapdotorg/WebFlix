/**
 * R10 — the engine service host tests (the in-process assembly).
 *
 * `createEngineService`: recovery (journal replay with the documented
 * paused-by-restart mapping + honest failed tombstones), the wire
 * dispatcher (journaling + the v1 acks + background admission), the
 * translated WFX-023 foreground scheduler wiring (relative ordinals →
 * the engine's absolute geometry), the WFX-024 completion driver over
 * the real engine (admission, completion events, store persistence),
 * engine-info discovery, and graceful disposal.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PROTOCOL_VERSION } from "../src/engine/process";
import {
  createEngineService,
  createRelativePieceAdapter,
  type EngineServiceHandle,
} from "../src/service-process/service";
import type { RealEngine } from "../src/service-process/engine";
import { sha256Hex } from "../src/service-process/store";
import { NativeMediaError } from "../src/errors";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TMP_ROOT = join(import.meta.dir, "tmp-service-test");

class ManualClock {
  private now = 0;
  tick(ms: number): void {
    this.now += ms;
  }
  value(): number {
    return this.now;
  }
}

let counter = 0;

function writeMedia(name: string, size: number): { path: string; bytes: Uint8Array } {
  const path = join(TMP_ROOT, name);
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    bytes[i] = (i * 19 + 7) % 251;
  }
  writeFileSync(path, bytes);
  return { path, bytes };
}

interface HostFixture {
  service: EngineServiceHandle;
  engine: RealEngine;
  root: string;
  clock: ManualClock;
  completions: { sessionId: string; assetId: string; totalBytes: number }[];
}

/** A service host with NO timers (deterministic: pumps + manual ticks). */
function newService(overrides: {
  maxCacheBytes?: number;
  gateway?: boolean;
  policy?: { mode: "always" | "wifi-only" | "never" | "charging-only" };
} = {}): HostFixture {
  counter += 1;
  const root = join(TMP_ROOT, `svc-${counter}`);
  mkdirSync(root, { recursive: true });
  const clock = new ManualClock();
  const completions: HostFixture["completions"] = [];
  const service = createEngineService({
    cacheDir: root,
    maxCacheBytes: overrides.maxCacheBytes ?? 64 * 1024 * 1024,
    engine: {
      readChunkBytes: 1_000,
      nominalBitrateBps: 2_000_000,
      readBytesPerSecond: 1_000_000,
      rebufferLeadMs: 0,
      autoTick: false,
      clock: () => clock.value(),
    },
    gateway: overrides.gateway === undefined ? false : overrides.gateway ? {} : false,
    completion: {
      policy: { ...(overrides.policy ?? { mode: "always" }) },
      environment: { networkClass: "wifi", charging: true },
    },
    autoTick: false,
  });
  // Observe the driver's completion events (the host journals them; the
  // test captures them through the store of events the sink sees).
  const originalDispatch = service.dispatchCommand.bind(service);
  service.dispatchCommand = originalDispatch;
  return {
    service,
    engine: service.engine,
    root,
    clock,
    completions,
  };
}

beforeAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("R10 — the engine service host: dispatch + journal", () => {
  it("dispatchCommand answers the v1 state-changed ack (protocolVersion + integrity field)", async () => {
    const { service } = newService();
    const { path } = writeMedia("svc-a.bin", 10_000);
    const ack = await service.dispatchCommand({
      protocolVersion: 1,
      kind: "open",
      source: { localPath: path },
    });
    expect(ack.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(ack.kind).toBe("state-changed");
    expect(ack.session.state).toBe("buffering");
    expect(ack.session.integrity).toBe("unknown"); // the explicit R10 field

    const seek = await service.dispatchCommand({
      protocolVersion: 1,
      kind: "seek",
      sessionId: ack.session.id,
      positionMs: 12,
    });
    expect(seek.session.positionMs).toBe(12);

    const close = await service.dispatchCommand({
      protocolVersion: 1,
      kind: "close",
      sessionId: ack.session.id,
    });
    expect(close.session.id).toBe(ack.session.id);

    // The journal carries the control points.
    const records = service.journal.readAll();
    expect(records.some((r) => r.type === "open")).toBe(true);
    expect(records.some((r) => r.type === "control")).toBe(true);
    await service.dispose();
  });

  it("dispatchCommand maps engine failures to typed rejections (never fake acks)", async () => {
    const { service } = newService();
    await expect(
      service.dispatchCommand({
        protocolVersion: 1,
        kind: "open",
        source: { localPath: join(TMP_ROOT, "missing.bin") },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.dispatchCommand({ protocolVersion: 1, kind: "pause", sessionId: "nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.dispatchCommand({
        protocolVersion: 1,
        kind: "open",
        source: { magnet: "magnet:?xt=urn:btih:x" },
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_SOURCE" });
    await service.dispose();
  });
});

describe("R10 — the engine service host: background completion over the REAL engine", () => {
  it("policy-admitted pause backgrounds the session; completion persists + emits + verifies", async () => {
    const { service, engine } = newService();
    const { path, bytes } = writeMedia("svc-b.bin", 10_000);
    const open = await service.dispatchCommand({
      protocolVersion: 1,
      kind: "open",
      source: { localPath: path },
    });
    const sessionId = open.session.id;
    await service.dispatchCommand({ protocolVersion: 1, kind: "resume", sessionId });

    // The pause consults the policy ("always" + wifi ⇒ continue): the
    // session moves to the background lane and the driver tracks it.
    await service.dispatchCommand({ protocolVersion: 1, kind: "pause", sessionId });
    expect(engine.snapshot(sessionId)?.state).toBe("background");
    const stats = service.completionDriver.stats();
    expect(stats.activeCompletions).toContain(sessionId);

    // The real engine completes the download in the background.
    for (let i = 0; i < 12; i += 1) {
      await engine.pumpOnce(sessionId);
    }
    const final = engine.snapshot(sessionId);
    expect(final?.state).toBe("complete");
    expect(final?.integrity).toBe("verified");

    // The ASSET is persisted with the REAL digest; the driver observed
    // the completion (its stats + the journal evidence).
    const meta = engine.store.getAsset(final!.assetId);
    expect(meta?.sha256).toBe(sha256Hex(bytes));
    expect(meta?.integrity).toBe("verified");
    expect(service.completionDriver.stats().completions).toBe(1);
    const evidence = service.journal
      .readAll()
      .filter((r) => r.type === "evidence") as Extract<
      ReturnType<typeof service.journal.readAll>[number],
      { type: "evidence" }
    >[];
    expect(evidence.some((e) => e.message === "background-completion")).toBe(true);
    expect(
      evidence.some((e) => e.message === "background-admission"),
    ).toBe(true);
    await service.dispose();
  });

  it("mode 'never' admits NOTHING: a paused playing session stays plainly paused", async () => {
    const { service, engine } = newService({ policy: { mode: "never" } });
    const { path } = writeMedia("svc-c.bin", 10_000);
    const open = await service.dispatchCommand({
      protocolVersion: 1,
      kind: "open",
      source: { localPath: path },
    });
    const sessionId = open.session.id;
    await service.dispatchCommand({ protocolVersion: 1, kind: "resume", sessionId });
    await service.dispatchCommand({ protocolVersion: 1, kind: "pause", sessionId });
    // No background admission: the session stays playing-paused (pause is
    // not a state), the driver tracks nothing.
    expect(engine.snapshot(sessionId)?.state).toBe("playing");
    expect(service.completionDriver.stats().trackedSessions).toBe(0);
    await service.dispose();
  });

  it("setEnvironment re-evaluates tracked background sessions (typed report)", async () => {
    const { service, engine } = newService();
    const { path } = writeMedia("svc-d.bin", 10_000);
    const open = await service.dispatchCommand({
      protocolVersion: 1,
      kind: "open",
      source: { localPath: path },
    });
    const sessionId = open.session.id;
    await service.dispatchCommand({ protocolVersion: 1, kind: "resume", sessionId });
    await service.dispatchCommand({ protocolVersion: 1, kind: "pause", sessionId });
    expect(engine.snapshot(sessionId)?.state).toBe("background");

    // wifi -> cellular: the "always" policy keeps continuing (the
    // environment only gates wifi-only/charging-only modes).
    const report = await service.setEnvironment({
      networkClass: "cellular",
      charging: false,
    });
    expect(report.environment.networkClass).toBe("cellular");
    expect(report.outcomes).toHaveLength(1);
    await service.dispose();
  });
});

describe("R10 — the engine service host: the translated scheduler wiring", () => {
  it("createRelativePieceAdapter translates playhead-RELATIVE ordinals onto ABSOLUTE pieces", async () => {
    const { service, engine } = newService();
    const { path } = writeMedia("svc-e.bin", 10_000);
    const session = await engine.open({ localPath: path });
    await engine.seek(session.id, 20); // byte 5000 = piece 5

    const adapter = createRelativePieceAdapter(engine);
    // Scheduler ordinals k=0..3 (the pieces from the playhead forward).
    await adapter.prioritize(session.id, [
      { piece: 0, deadlineMs: 10 },
      { piece: 2, deadlineMs: 30 },
      { piece: 3, deadlineMs: 20 },
    ]);
    await engine.pumpOnce(session.id);
    await engine.pumpOnce(session.id);
    // The translated hoist order (ascending deadline): ABSOLUTE piece 5
    // (k=0, deadline 10), then piece 8 (k=3, deadline 20), then 7 (k=2,
    // deadline 30) — NOT the natural 5,6 order.
    const five = await engine.readRange(session.id, 5_000, 5_999);
    expect(five.length).toBe(1_000);
    const eight = await engine.readRange(session.id, 8_000, 8_999);
    expect(eight.length).toBe(1_000);
    // Pieces 6 and 7 were NOT read (behind the hoisted pieces).
    await expect(engine.readRange(session.id, 6_000, 6_999)).rejects.toMatchObject({
      code: "IO_ERROR",
    });
    await expect(engine.readRange(session.id, 7_000, 7_999)).rejects.toMatchObject({
      code: "IO_ERROR",
    });

    // Out-of-range ordinals (beyond the piece count) are dropped, never
    // fabricated into the engine's INVALID_INPUT.
    await adapter.prioritize(session.id, [{ piece: 999, deadlineMs: 1 }]);
    // Unknown sessions are the adapter's typed NOT_FOUND.
    await expect(adapter.prioritize("nope", [])).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await service.dispose();
  });

  it("tickScheduler drives the merged WFX-023 scheduler over live playing demands", async () => {
    const { service } = newService();
    const { path } = writeMedia("svc-f.bin", 10_000);
    // The foreground scheduler scopes WIRE-dispatched sessions (the
    // playback surface) — open and resume through the dispatcher.
    const open = await service.dispatchCommand({
      protocolVersion: 1,
      kind: "open",
      source: { localPath: path },
    });
    await service.dispatchCommand({
      protocolVersion: 1,
      kind: "resume",
      sessionId: open.session.id,
    });

    const report = await service.tickScheduler();
    expect(report.failures).toHaveLength(0);
    const mine = report.sessions.find((s) => s.sessionId === open.session.id);
    expect(mine).toBeDefined();
    expect(mine?.planSize).toBeGreaterThan(0); // a playing session plans pieces
    expect(mine?.engineCalled).toBe(true); // the batch reached engine.prioritize
    await service.dispose();
  });
});

describe("R10 — the engine service host: recovery", () => {
  it("journal replay restores non-terminal sessions at their control points", async () => {
    const { service, root } = newService();
    const { path } = writeMedia("svc-g.bin", 10_000);
    const open = await service.dispatchCommand({
      protocolVersion: 1,
      kind: "open",
      source: { localPath: path },
    });
    const sessionId = open.session.id;
    await service.dispatchCommand({ protocolVersion: 1, kind: "resume", sessionId });
    await service.dispatchCommand({
      protocolVersion: 1,
      kind: "seek",
      sessionId,
      positionMs: 16,
    });
    await service.dispose(); // graceful: journal evidence shutdown

    // A RESTART over the same store root.
    const clock = new ManualClock();
    const restarted = createEngineService({
      cacheDir: root,
      maxCacheBytes: 64 * 1024 * 1024,
      engine: {
        readChunkBytes: 1_000,
        nominalBitrateBps: 2_000_000,
        readBytesPerSecond: 1_000_000,
        rebufferLeadMs: 0,
        autoTick: false,
        clock: () => clock.value(),
      },
      gateway: false,
      autoTick: false,
    });
    const report = await restarted.recover();
    expect(report.recovered).toHaveLength(1);
    expect(report.recovered[0]?.sessionId).toBe(sessionId);
    expect(report.recovered[0]?.state).toBe("buffering"); // the documented mapping
    expect(report.recovered[0]?.positionMs).toBe(16);
    expect(report.failed).toHaveLength(0);

    // The recovered session is LIVE under its own id and controllable.
    const snapshot = restarted.engine.snapshot(sessionId);
    expect(snapshot?.positionMs).toBe(16);
    await restarted.dispatchCommand({ protocolVersion: 1, kind: "resume", sessionId });
    expect(restarted.engine.snapshot(sessionId)?.state).toBe("playing");
    await restarted.dispose();
  });

  it("vanished bytes are honestly failed (the tombstone) — never a fabricated recovery", async () => {
    const media = writeMedia("svc-h.bin", 10_000);
    const { service, root } = newService();
    const open = await service.dispatchCommand({
      protocolVersion: 1,
      kind: "open",
      source: { localPath: media.path },
    });
    const sessionId = open.session.id;
    await service.dispatchCommand({ protocolVersion: 1, kind: "resume", sessionId });
    await service.dispose();

    // The bytes vanish between runs.
    rmSync(media.path, { force: true });
    const clock = new ManualClock();
    const restarted = createEngineService({
      cacheDir: root,
      maxCacheBytes: 64 * 1024 * 1024,
      engine: {
        readChunkBytes: 1_000,
        nominalBitrateBps: 2_000_000,
        autoTick: false,
        clock: () => clock.value(),
      },
      gateway: false,
      autoTick: false,
    });
    const report = await restarted.recover();
    expect(report.recovered).toHaveLength(0);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.sessionId).toBe(sessionId);
    expect(report.failed[0]?.detail).toContain("no media file exists");
    // The tombstone answers control with SESSION_CLOSED (terminal honesty).
    await expect(
      restarted.dispatchCommand({ protocolVersion: 1, kind: "pause", sessionId }),
    ).rejects.toMatchObject({ code: "SESSION_CLOSED" });
    // The journal recorded the failed recovery with evidence.
    const states = restarted.journal
      .readAll()
      .filter((r) => r.type === "state") as Extract<
      ReturnType<typeof restarted.journal.readAll>[number],
      { type: "state" }
    >[];
    const failedState = states.find((s) => s.sessionId === sessionId && s.state === "failed");
    expect(failedState?.evidence).toMatchObject({
      recovered: true,
      reason: "source-bytes-vanished",
    });
    await restarted.dispose();
  });

  it("recovery is idempotent per session (a second pass is a no-op)", async () => {
    const { service } = newService();
    const { path } = writeMedia("svc-i.bin", 10_000);
    const open = await service.dispatchCommand({
      protocolVersion: 1,
      kind: "open",
      source: { localPath: path },
    });
    // No dispose: the session is still live; recover skips it.
    const report = await service.recover();
    expect(report.recovered).toHaveLength(0);
    expect(service.engine.snapshot(open.session.id)).toBeDefined();
    await service.dispose();
  });
});

describe("R10 — the engine service host: discovery + disposal", () => {
  it("engine-info.json records the protocol version (gateway disabled ⇒ null)", async () => {
    const { service, root } = newService({ gateway: false });
    await service.dispose();
    const info = JSON.parse(
      readFileSync(join(root, "engine-info.json"), "utf8"),
    ) as { protocolVersion: number; gateway: unknown };
    expect(info.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(info.gateway).toBeNull();
  });

  it("with the gateway enabled, engine-info carries the loopback port", async () => {
    const { service, root } = newService({ gateway: true });
    const info = JSON.parse(
      readFileSync(join(root, "engine-info.json"), "utf8"),
    ) as { gateway: { port: number; baseUrl: string } | null };
    expect(info.gateway).not.toBeNull();
    expect(info.gateway!.port).toBeGreaterThan(0);
    expect(info.gateway!.baseUrl).toContain("127.0.0.1");
    await service.dispose();
  });

  it("malformed configuration is a typed factory failure", () => {
    expect(() => createEngineService({ cacheDir: "", maxCacheBytes: 1 })).toThrow(
      NativeMediaError,
    );
    expect(() =>
      createEngineService({ cacheDir: "/tmp/x", maxCacheBytes: -1 }),
    ).toThrow(NativeMediaError);
  });
});
