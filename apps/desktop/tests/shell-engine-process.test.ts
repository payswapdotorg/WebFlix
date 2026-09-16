/**
 * R08 — the shell-backed engine process tests (the PRODUCTION transport).
 *
 * `createShellEngineProcess` over the simulated shell: the spawn/attach
 * protocol crossing the `ShellIpc` seam, the typed error mapping
 * (`ShellIpcError` → `NativeMediaError`), and the event relay — proving
 * the production wiring in-process (no real child process, per the
 * sandbox-honest build scoping).
 */

import { describe, expect, it } from "bun:test";

import { NativeMediaError } from "@wfx/native-media";
import type { EngineConfig } from "@wfx/native-media";

import { SimShell } from "./shell-simulator";
import { createShellEngineProcess } from "../src/platform/shell-engine-process";

const CONFIG: EngineConfig = {
  cacheDir: "/sim/app-data/wfx-desktop/engine-cache",
  maxCacheBytes: 32 * 1024 * 1024,
};

describe("R08 — the shell-backed engine process (production transport)", () => {
  it("spawns through the shell, sends commands, and relays spontaneous events", async () => {
    const shell = new SimShell();
    const process = createShellEngineProcess(shell);
    const handle = process.spawn(CONFIG);
    const engineId = "sim-engine-1";
    const seen: string[] = [];
    handle.onEvent((event) => seen.push(event.kind));

    // Command/response across the seam:
    const ack = await handle.send({ protocolVersion: 1, kind: "open", source: { magnet: "magnet:?xt=urn:btih:abc" } });
    expect(ack.kind).toBe("state-changed");
    if (ack.kind === "state-changed") {
      expect(ack.session.id).toBe("sim-session-1");
    }
    // The shell hosted exactly the engine the handle talks to:
    expect(shell.engineSide(engineId)?.commands).toHaveLength(1);

    // Spontaneous telemetry relays through the seam to the handle:
    shell.engineEmitProgress(engineId, "sim-session-1", 5_000);
    expect(seen).toEqual(["progress"]);
    void handle;
  });

  it("a malformed config throws the typed INVALID_INPUT synchronously (the boundary contract)", () => {
    const process = createShellEngineProcess(new SimShell());
    expect(() =>
      process.spawn({ cacheDir: "", maxCacheBytes: 10 } as unknown as EngineConfig),
    ).toThrow(NativeMediaError);
  });

  it("a shell spawn failure surfaces as the typed engine error on send", async () => {
    const shell = new SimShell();
    shell.nextEngineSpawnFailure = new (await import("../src/platform/shell-ipc")).ShellIpcError(
      "INTERNAL",
      "the engine binary could not be started",
    );
    const process = createShellEngineProcess(shell);
    const handle = process.spawn(CONFIG);
    const thrown = await handle
      .send({ protocolVersion: 1, kind: "open", source: { magnet: "magnet:?xt=urn:btih:abc" } })
      .catch((error: unknown) => error);
    expect(thrown instanceof NativeMediaError).toBe(true);
    expect((thrown as NativeMediaError).code).toBe("INTERNAL");
    expect((thrown as NativeMediaError).detail).toContain("engine binary could not be started");
  });

  it("engine command rejections cross the seam with their typed code and session id", async () => {
    const shell = new SimShell();
    const process = createShellEngineProcess(shell);
    const handle = process.spawn(CONFIG);
    const ack = await handle.send({ protocolVersion: 1, kind: "open", source: { magnet: "magnet:?xt=urn:btih:abc" } });
    const sessionId = ack.kind === "state-changed" ? ack.session.id : "unknown";
    shell.engineSide("sim-engine-1")?.failNextCommand("VERIFICATION_FAILED", "hash mismatch");
    const thrown = await handle
      .send({ protocolVersion: 1, kind: "seek", sessionId, positionMs: 100 })
      .catch((error: unknown) => error);
    expect(thrown instanceof NativeMediaError).toBe(true);
    const error = thrown as NativeMediaError;
    expect(error.code).toBe("VERIFICATION_FAILED");
    expect(error.sessionId).toBe(sessionId);
    expect(error.detail).toContain("hash mismatch");
  });

  it("terminate tears the hosted engine down (idempotent)", async () => {
    const shell = new SimShell();
    const process = createShellEngineProcess(shell);
    const handle = process.spawn(CONFIG);
    await handle.send({ protocolVersion: 1, kind: "open", source: { magnet: "magnet:?xt=urn:btih:abc" } });
    handle.terminate();
    handle.terminate(); // idempotent
    // The terminate relay settles (async seam): let it land before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The shell's hosted engine is gone (typed failure on the dead id):
    const thrown = await shell
      .engineSend("sim-engine-1", {
        protocolVersion: 1,
        kind: "pause",
        sessionId: "sim-session-1",
      })
      .catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("sim-engine-1");
  });

  it("after terminate, send rejects with the typed INVALID_INPUT error", async () => {
    const shell = new SimShell();
    const process = createShellEngineProcess(shell);
    const handle = process.spawn(CONFIG);
    handle.terminate();
    const thrown = await handle
      .send({ protocolVersion: 1, kind: "open", source: { magnet: "magnet:?xt=urn:btih:abc" } })
      .catch((error: unknown) => error);
    expect(thrown instanceof NativeMediaError).toBe(true);
    expect((thrown as NativeMediaError).code).toBe("INVALID_INPUT");
    void shell;
  });
});
