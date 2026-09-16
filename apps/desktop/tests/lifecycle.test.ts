/**
 * R08 — LifecyclePort over native window events (shell simulator).
 *
 * Phase/event honesty, ready→background→resume transitions, and the
 * SHUTDOWN LAW: async hooks are awaited (the runtime's at-least-once
 * outbox flush), the shell is released after the drain, and no
 * transitions follow the terminal shutdown.
 */

import { describe, expect, it } from "bun:test";

import type { LifecycleEvent } from "@wfx/platform-contracts";

import { SimShell } from "./shell-simulator";
import { createShellLifecyclePort } from "../src/platform/lifecycle";

describe("R08 — desktop lifecycle over native window events", () => {
  it("starts initializing; ready moves to active; phase and events agree", () => {
    const shell = new SimShell();
    const lifecycle = createShellLifecyclePort(shell);
    expect(lifecycle.phase()).toBe("initializing");
    const events: LifecycleEvent[] = [];
    lifecycle.subscribe((event) => events.push(event));
    shell.emitLifecycle("ready");
    expect(lifecycle.phase()).toBe("active");
    expect(events.map((event) => event.kind)).toEqual(["ready"]);
    expect(events[0]?.occurredAtMs).toBe(shell.clockNow());
  });

  it("background and resume toggle the phase truthfully", () => {
    const shell = new SimShell();
    const lifecycle = createShellLifecyclePort(shell);
    shell.emitLifecycle("ready");
    shell.emitLifecycle("background");
    expect(lifecycle.phase()).toBe("background");
    shell.emitLifecycle("resume");
    expect(lifecycle.phase()).toBe("active");
    shell.emitLifecycle("background");
    expect(lifecycle.phase()).toBe("background");
  });

  it("hooks fire per kind; registering the same hook twice invokes it twice", async () => {
    const shell = new SimShell();
    const lifecycle = createShellLifecyclePort(shell);
    let backgroundCalls = 0;
    lifecycle.hook("background", () => {
      backgroundCalls += 1;
    });
    lifecycle.hook("background", () => {
      backgroundCalls += 1;
    });
    shell.emitLifecycle("ready");
    shell.emitLifecycle("background");
    // Hooks are awaited by the port (async-capable): let the drain settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(backgroundCalls).toBe(2);
  });

  it("THE SHUTDOWN LAW: async hooks are awaited in order, then the shell is released", async () => {
    const shell = new SimShell();
    const lifecycle = createShellLifecyclePort(shell);
    const drainOrder: string[] = [];
    lifecycle.hook("shutdown", async () => {
      await Promise.resolve();
      drainOrder.push("first");
    });
    lifecycle.hook("shutdown", async () => {
      await new Promise<void>((resolve) => {
        drainOrder.push("second");
        resolve();
      });
    });
    shell.emitLifecycle("ready");
    // The shell's bounded wait (the sim resolves when the adapter releases).
    const shutdownWait = shell.requestShutdown();
    expect(lifecycle.phase()).toBe("shutdown");
    await lifecycle.shutdownSettled();
    await shutdownWait;
    expect(drainOrder).toEqual(["first", "second"]);
    expect(shell.shutdownCompleted).toBe(true);
  });

  it("a failing flush hook does not block the drain (the outbox keeps its pending events)", async () => {
    const shell = new SimShell();
    const lifecycle = createShellLifecyclePort(shell);
    let secondRan = false;
    lifecycle.hook("shutdown", async () => {
      throw new Error("flush transport failed");
    });
    lifecycle.hook("shutdown", async () => {
      secondRan = true;
    });
    const shutdownWait = shell.requestShutdown();
    await lifecycle.shutdownSettled();
    await shutdownWait;
    expect(secondRan).toBe(true);
    expect(shell.shutdownCompleted).toBe(true);
  });

  it("no transitions are emitted after shutdown (honest terminal)", () => {
    const shell = new SimShell();
    const lifecycle = createShellLifecyclePort(shell);
    const events: LifecycleEvent[] = [];
    lifecycle.subscribe((event) => events.push(event));
    shell.emitLifecycle("ready");
    shell.emitLifecycle("shutdown");
    const afterCount = events.length;
    shell.emitLifecycle("resume"); // the shell is terminating: ignored
    expect(events.length).toBe(afterCount);
    expect(lifecycle.phase()).toBe("shutdown");
  });

  it("subscriptions unsubscribe cleanly", () => {
    const shell = new SimShell();
    const lifecycle = createShellLifecyclePort(shell);
    const events: LifecycleEvent[] = [];
    const unsubscribe = lifecycle.subscribe((event) => events.push(event));
    shell.emitLifecycle("ready");
    unsubscribe();
    shell.emitLifecycle("background");
    expect(events).toHaveLength(1);
  });
});
