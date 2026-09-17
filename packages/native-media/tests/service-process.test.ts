/**
 * R10 — the SPAWNABLE SERVICE ENTRY tests (the real child process).
 *
 * The REAL end-to-end wire: `createChildProcessEngine` spawns `main.ts`
 * as a Bun child process over temp store roots and speaks the frozen v1
 * DTO protocol on stdio JSON lines. Covers: the spawn contract (config
 * via WFX_ENGINE_CONFIG; the discovery file), open/control round-trips
 * with the R10 integrity field, HONEST bufferedMs progression over the
 * wire (monotone, reaching the full nominal duration — real reads under
 * the real clock, bounded waits), the integrity verdicts (verified on
 * completion; corrupt ⇒ VERIFICATION_FAILED), the CRASH LAW (SIGKILL ⇒
 * the synthesized error event + typed rejections; malformed frame ⇒ the
 * process poisons honestly with a nonzero exit), the version guard, the
 * graceful EOF shutdown (exit 0), and RESTART RECOVERY over the wire
 * (intact file ⇒ recovered; deleted file ⇒ honestly failed).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { NativeMediaError } from "../src/errors";
import {
  createChildProcessEngine,
  type ChildProcessEngineOptions,
} from "../src/service-process/process";
import type {
  EngineConfig,
  EngineEvent,
  EngineHandle,
  NativeEngineProcess,
} from "../src/engine/process";

/** The transport handle's internal seams the wire tests exercise (in-package). */
interface ChildHandleInternals {
  readonly stdinSink: Bun.FileSink;
  readonly proc: {
    kill(sig?: number): void;
    exited: Promise<number | null>;
  };
}

function internals(handle: EngineHandle): ChildHandleInternals {
  return handle as unknown as ChildHandleInternals;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TMP_ROOT = join(import.meta.dir, "tmp-spawn-test");

let counter = 0;
function newRoot(): string {
  counter += 1;
  const root = join(TMP_ROOT, `run-${counter}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeMedia(name: string, size: number): { path: string; bytes: Uint8Array } {
  const path = join(TMP_ROOT, name);
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    bytes[i] = (i * 23 + 9) % 251;
  }
  writeFileSync(path, bytes);
  return { path, bytes };
}

/** Spawn the REAL entry with the test-friendly engine tunables. */
function spawnEngine(root: string): { process: NativeEngineProcess; handle: EngineHandle } {
  const options: ChildProcessEngineOptions = {
    env: {
      WFX_ENGINE_TUNABLES: JSON.stringify({
        readChunkBytes: 1_000,
        nominalBitrateBps: 2_000_000,
        readBytesPerSecond: 1_000_000,
        rebufferLeadMs: 0,
      }),
    },
  };
  const proc = createChildProcessEngine(options);
  const config: EngineConfig = { cacheDir: root, maxCacheBytes: 64 * 1024 * 1024 };
  const handle = proc.spawn(config);
  return { process: proc, handle };
}

/** Poll until the predicate holds (bounded, real-clock waits). */
async function waitFor<T>(
  probe: () => Promise<T> | T,
  predicate: (value: T) => boolean,
  timeoutMs = 8_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (predicate(value)) return value;
    if (Date.now() > deadline) {
      throw new Error(`waitFor: timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
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

describe("R10 — the spawnable entry: the wire protocol", () => {
  it("spawn + open: the ack is a v1 state-changed with the R10 integrity field", async () => {
    const root = newRoot();
    const { handle } = spawnEngine(root);
    const media = writeMedia("spawn-a.bin", 10_000);
    const ack = await handle.send({
      protocolVersion: 1,
      kind: "open",
      source: { localPath: media.path },
    });
    expect(ack.kind).toBe("state-changed");
    if (ack.kind !== "state-changed") throw new Error("unreachable");
    expect(ack.protocolVersion).toBe(1);
    expect(ack.session.state).toBe("buffering");
    expect(ack.session.bufferedMs).toBe(0);
    expect(ack.session.integrity).toBe("unknown"); // the explicit R10 field
    expect(ack.session.assetId.startsWith("asset-")).toBe(true);

    // The discovery file exists with the protocol version + gateway port.
    const info = JSON.parse(readFileSync(join(root, "engine-info.json"), "utf8")) as {
      protocolVersion: number;
      gateway: { port: number } | null;
    };
    expect(info.protocolVersion).toBe(1);
    expect(info.gateway).not.toBeNull();
    expect(info.gateway!.port).toBeGreaterThan(0);
    handle.terminate();
  });

  it("control round-trips: seek/pause/resume/prioritize answer acks; close forgets", async () => {
    const root = newRoot();
    const { handle } = spawnEngine(root);
    const media = writeMedia("spawn-b.bin", 10_000);
    const open = await handle.send({
      protocolVersion: 1,
      kind: "open",
      source: { localPath: media.path },
    });
    if (open.kind !== "state-changed") throw new Error("unreachable");
    const sessionId = open.session.id;

    const seek = await handle.send({
      protocolVersion: 1,
      kind: "seek",
      sessionId,
      positionMs: 12,
    });
    expect(seek.kind === "state-changed" && seek.session.positionMs).toBe(12);

    const resume = await handle.send({ protocolVersion: 1, kind: "resume", sessionId });
    expect(resume.kind === "state-changed" && resume.session.state).toBe("playing");

    const pause = await handle.send({ protocolVersion: 1, kind: "pause", sessionId });
    expect(pause.kind === "state-changed" && pause.session.state).toBe("background");
    // ("always" policy + wifi environment ⇒ the background admission.)

    const prioritize = await handle.send({
      protocolVersion: 1,
      kind: "prioritize",
      sessionId,
      deadlines: [{ piece: 0, deadlineMs: 10 }],
    });
    expect(prioritize.kind).toBe("state-changed");

    const close = await handle.send({ protocolVersion: 1, kind: "close", sessionId });
    expect(close.kind === "state-changed" && close.session.id).toBe(sessionId);

    // Post-close control answers the typed error event.
    const dead = await handle.send({ protocolVersion: 1, kind: "pause", sessionId }).catch(
      (e: unknown) => e,
    );
    expect(dead instanceof NativeMediaError).toBe(true);
    expect((dead as NativeMediaError).code).toBe("SESSION_CLOSED");
    handle.terminate();
  });

  it("HONEST bufferedMs over the wire: monotone, reaches the full nominal duration", async () => {
    const root = newRoot();
    const { handle } = spawnEngine(root);
    const media = writeMedia("spawn-c.bin", 10_000);
    // 10_000 bytes @ 2 Mbps ⇒ 40 ms of nominal timeline.
    const open = await handle.send({
      protocolVersion: 1,
      kind: "open",
      source: { localPath: media.path },
    });
    if (open.kind !== "state-changed") throw new Error("unreachable");

    const seen: number[] = [];
    handle.onEvent((event) => {
      if (event.kind === "buffered") {
        seen.push(event.bufferedMs);
      }
    });
    // Wait for the real read-ahead (1 MB/s budget ⇒ ~10 ms) to land all
    // 10_000 bytes: the buffered telemetry must reach the full duration.
    await waitFor(
      () => seen.length,
      (n) => n > 0 && seen[seen.length - 1]! >= 40,
    );
    // Monotone non-decreasing — no fake progress, no regressions.
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
    handle.terminate();
  });

  it("background completion over the wire: complete + integrity verified + persisted asset", async () => {
    const root = newRoot();
    const { handle } = spawnEngine(root);
    const media = writeMedia("spawn-d.bin", 10_000);
    const open = await handle.send({
      protocolVersion: 1,
      kind: "open",
      source: { localPath: media.path },
    });
    if (open.kind !== "state-changed") throw new Error("unreachable");
    const sessionId = open.session.id;
    const assetId = open.session.assetId;

    await handle.send({ protocolVersion: 1, kind: "resume", sessionId });
    await handle.send({ protocolVersion: 1, kind: "pause", sessionId }); // → background

    // Wait for the background completion: state-changed complete.
    const events: EngineEvent[] = [];
    const unsub = handle.onEvent((event) => events.push(event));
    await waitFor(
      () =>
        events.find(
          (e) => e.kind === "state-changed" && e.session.state === "complete",
        ),
      (e) => e !== undefined,
    );
    unsub();
    const completed = events.find(
      (e) => e.kind === "state-changed" && e.session.state === "complete",
    );
    if (completed?.kind !== "state-changed") throw new Error("unreachable");
    expect(completed.session.integrity).toBe("verified"); // THE FROZEN LAW

    // The asset persisted in the child's store (digest + verdict).
    const metaPath = join(root, "assets", assetId, "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
      integrity: string;
      sha256: string;
      sizeBytes: number;
    };
    expect(meta.integrity).toBe("verified");
    expect(meta.sizeBytes).toBe(10_000);
    expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    handle.terminate();
  });

  it("corrupt stored asset over the wire: open answers the typed VERIFICATION_FAILED", async () => {
    const root = newRoot();
    // First run: complete an asset into the store.
    {
      const { handle } = spawnEngine(root);
      const media = writeMedia("spawn-e.bin", 10_000);
      const open = await handle.send({
        protocolVersion: 1,
        kind: "open",
        source: { localPath: media.path },
      });
      if (open.kind !== "state-changed") throw new Error("unreachable");
      await handle.send({ protocolVersion: 1, kind: "resume", sessionId: open.session.id });
      await handle.send({ protocolVersion: 1, kind: "pause", sessionId: open.session.id });
      const events: EngineEvent[] = [];
      const unsub = handle.onEvent((e) => events.push(e));
      await waitFor(
        () => events.find((e) => e.kind === "state-changed" && e.session.state === "complete"),
        (e) => e !== undefined,
      );
      unsub();
      handle.terminate();
    }
    // Corrupt ONE stored byte behind the store's back.
    const assetDir = join(root, "assets");
    const [assetId] = (await import("node:fs")).readdirSync(assetDir);
    const contentPath = join(assetDir, assetId!, "content.bin");
    const raw = new Uint8Array(readFileSync(contentPath));
    raw[3] = (raw[3]! + 1) % 251;
    writeFileSync(contentPath, raw);

    // A fresh engine over the same store: opening the corrupt asset is
    // the typed corrupt refusal — never served.
    const { handle } = spawnEngine(root);
    const refusal = await handle
      .send({ protocolVersion: 1, kind: "open", source: { localPath: contentPath } })
      .catch((e: unknown) => e);
    expect(refusal instanceof NativeMediaError).toBe(true);
    expect((refusal as NativeMediaError).code).toBe("VERIFICATION_FAILED");
    handle.terminate();
  });
});

describe("R10 — the spawnable entry: the crash law", () => {
  it("SIGKILL: the handle crashes honestly — the error event + typed rejections", async () => {
    const root = newRoot();
    const { handle } = spawnEngine(root);
    const media = writeMedia("spawn-f.bin", 10_000);
    const open = await handle.send({
      protocolVersion: 1,
      kind: "open",
      source: { localPath: media.path },
    });
    if (open.kind !== "state-changed") throw new Error("unreachable");

    const errors: EngineEvent[] = [];
    handle.onEvent((event) => {
      if (event.kind === "error") errors.push(event);
    });

    // KILL the child (the raw process, like a host crash).
    internals(handle).proc.kill(9);

    // The crash law: ONE synthesized error event + every send rejects.
    await waitFor(() => errors.length, (n) => n > 0);
    expect(errors[0]?.kind).toBe("error");
    if (errors[0]?.kind === "error") {
      expect(errors[0].code).toBe("INTERNAL");
      expect(errors[0].detail).toContain("exited");
    }
    const after = await handle
      .send({ protocolVersion: 1, kind: "pause", sessionId: open.session.id })
      .catch((e: unknown) => e);
    expect(after instanceof NativeMediaError).toBe(true);
    expect((after as NativeMediaError).code).toBe("INTERNAL");
  });

  it("a malformed frame (not JSON) poisons the process: error event + nonzero exit", async () => {
    const root = newRoot();
    const { handle } = spawnEngine(root);
    const media = writeMedia("spawn-g.bin", 10_000);
    const open = await handle.send({
      protocolVersion: 1,
      kind: "open",
      source: { localPath: media.path },
    });
    expect(open.kind).toBe("state-changed");

    const events: EngineEvent[] = [];
    handle.onEvent((event) => events.push(event));

    // Write garbage straight onto the child's stdin.
    const stdin = internals(handle).stdinSink;
    stdin.write("this is not json\n");
    stdin.flush();

    await waitFor(
      () => events.find((e) => e.kind === "error"),
      (e) => e !== undefined,
    );
    const error = events.find((e) => e.kind === "error");
    if (error?.kind !== "error") throw new Error("unreachable");
    expect(error.code).toBe("INTERNAL");
    expect(error.detail).toContain("malformed frame");

    // The process exited nonzero (honestly poisoned).
    const exit = await internals(handle).proc.exited;
    expect(exit).not.toBe(0);
  });

  it("the version guard: an unknown protocolVersion frame is a malformed frame (crash law)", async () => {
    const root = newRoot();
    const { handle } = spawnEngine(root);
    const events: EngineEvent[] = [];
    handle.onEvent((event) => events.push(event));
    const stdin = internals(handle).stdinSink;
    stdin.write(JSON.stringify({ protocolVersion: 99, kind: "open", source: { localPath: "/x" } }) + "\n");
    stdin.flush();
    await waitFor(
      () => events.find((e) => e.kind === "error"),
      (e) => e !== undefined,
    );
    const error = events.find((e) => e.kind === "error");
    if (error?.kind !== "error") throw new Error("unreachable");
    expect(error.detail).toContain("protocolVersion must be 1");
  });

  it("missing WFX_ENGINE_CONFIG: the typed startup failure + exit 2", async () => {
    // The transport always injects the config env, so the CONTRACT is
    // proven by spawning the entry directly without it.
    const child = Bun.spawn({
      cmd: [process.execPath, join(import.meta.dir, "../src/service-process/main.ts")],
      env: { ...process.env, WFX_ENGINE_CONFIG: "" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
    const text = await new Response(child.stdout).text();
    const exit = await child.exited;
    expect(exit).toBe(2);
    const line = text.split("\n").find((l) => l.trim().length > 0);
    expect(line).toBeDefined();
    const event = JSON.parse(line!) as { kind: string; code: string; detail: string };
    expect(event.kind).toBe("error");
    expect(event.code).toBe("INVALID_INPUT");
    expect(event.detail).toContain("WFX_ENGINE_CONFIG");
  });
});

describe("R10 — the spawnable entry: shutdown + restart recovery", () => {
  it("graceful shutdown: stdin EOF ⇒ journal evidence + exit 0", async () => {
    const root = newRoot();
    const { handle } = spawnEngine(root);
    const media = writeMedia("spawn-h.bin", 10_000);
    const open = await handle.send({
      protocolVersion: 1,
      kind: "open",
      source: { localPath: media.path },
    });
    expect(open.kind).toBe("state-changed");

    handle.terminate(); // closes stdin ⇒ the entry's EOF shutdown path
    const exit = await internals(handle).proc.exited;
    expect(exit).toBe(0);
    // The journal carries the shutdown evidence.
    const journal = readFileSync(join(root, "journal.ndjson"), "utf8");
    expect(journal).toContain('"shutdown"');
  });

  it("RESTART RECOVERY (intact file): the session returns as buffering at its control point", async () => {
    const root = newRoot();
    const media = writeMedia("spawn-i.bin", 10_000);
    // Run 1: open, resume, seek to 16 ms — then die HARD (SIGKILL, no
    // graceful close: the journal's last control point is the seek).
    {
      const { handle } = spawnEngine(root);
      const open = await handle.send({
        protocolVersion: 1,
        kind: "open",
        source: { localPath: media.path },
      });
      if (open.kind !== "state-changed") throw new Error("unreachable");
      await handle.send({ protocolVersion: 1, kind: "resume", sessionId: open.session.id });
      await handle.send({
        protocolVersion: 1,
        kind: "seek",
        sessionId: open.session.id,
        positionMs: 16,
      });
      internals(handle).proc.kill(9);
      await internals(handle).proc.exited;
    }
    // Run 2: the recovered session is announced at startup.
    const { handle } = spawnEngine(root);
    const startup: EngineEvent[] = [];
    const unsub = handle.onEvent((event) => startup.push(event));
    await waitFor(
      () => startup.find((e) => e.kind === "state-changed"),
      (e) => e !== undefined,
    );
    const restored = startup.find(
      (e) => e.kind === "state-changed" && e.session.state === "buffering",
    );
    if (restored?.kind !== "state-changed") throw new Error("unreachable");
    expect(restored.session.positionMs).toBe(16); // the journaled control point
    expect(restored.session.bufferedMs).toBe(0); // honest: the buffer died
    expect(restored.session.integrity).toBe("unknown");

    // The recovered session is controllable over the wire by its own id.
    const resume = await handle.send({
      protocolVersion: 1,
      kind: "resume",
      sessionId: restored.session.id,
    });
    expect(resume.kind === "state-changed" && resume.session.state).toBe("playing");
    unsub();
    handle.terminate();
  });

  it("RESTART RECOVERY (deleted file): the session is honestly failed with the detail", async () => {
    const root = newRoot();
    const media = writeMedia("spawn-j.bin", 10_000);
    {
      const { handle } = spawnEngine(root);
      const open = await handle.send({
        protocolVersion: 1,
        kind: "open",
        source: { localPath: media.path },
      });
      if (open.kind !== "state-changed") throw new Error("unreachable");
      await handle.send({ protocolVersion: 1, kind: "resume", sessionId: open.session.id });
      handle.terminate(); // graceful stop
      await internals(handle).proc.exited;
    }
    // The bytes vanish between runs.
    rmSync(media.path, { force: true });

    const { handle } = spawnEngine(root);
    const startup: EngineEvent[] = [];
    const unsub = handle.onEvent((event) => startup.push(event));
    await waitFor(
      () => startup.find((e) => e.kind === "state-changed" && e.session.state === "failed"),
      (e) => e !== undefined,
    );
    const failed = startup.find(
      (e) => e.kind === "state-changed" && e.session.state === "failed",
    );
    if (failed?.kind !== "state-changed") throw new Error("unreachable");
    expect(failed.session.integrity).toBe("unknown");
    // The journal records the honest failure detail.
    const journal = readFileSync(join(root, "journal.ndjson"), "utf8");
    expect(journal).toContain("source-bytes-vanished");
    expect(journal).toContain("no media file exists");
    // Control attempts answer SESSION_CLOSED (terminal honesty).
    const dead = await handle
      .send({ protocolVersion: 1, kind: "pause", sessionId: failed.session.id })
      .catch((e: unknown) => e);
    expect(dead instanceof NativeMediaError).toBe(true);
    expect((dead as NativeMediaError).code).toBe("SESSION_CLOSED");
    unsub();
    handle.terminate();
  });
});
