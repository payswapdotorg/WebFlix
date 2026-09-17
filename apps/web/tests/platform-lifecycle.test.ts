/**
 * R07 platform lifecycle-port tests (bun:test).
 *
 * Proves the LifecyclePort laws over the web page-lifecycle signals:
 * - `markReady()` → the `ready` event + phase `active` (exactly once);
 * - visibility hidden/visible → `background`/`resume` with phase agreement;
 * - `pagehide` → `shutdown` (exactly once; the phase never returns to
 *   active — the honesty law "an adapter never reports active after
 *   shutdown");
 * - async `shutdown` hooks ARE awaited (the runtime's outbox flush);
 * - a boot context with NO document emits nothing and stays honest.
 *
 * Deterministic: a fake document, a fixed clock, no timers.
 */

import { describe, expect, it } from "bun:test";
import type { LifecycleEvent } from "@wfx/platform-contracts";

import { createWebLifecyclePort } from "../src/platform/lifecycle";
import { FakeDocument, makeBrowserEnvironment, makeServerEnvironment } from "./fake-web";

function fixedClock(now = 1_000) {
  return { now: () => now };
}

describe("R07 web lifecycle port — boot + visibility", () => {
  it("markReady emits ready exactly once and moves the phase to active", async () => {
    const port = createWebLifecyclePort({ environment: makeServerEnvironment(), clock: fixedClock() });
    const events: LifecycleEvent[] = [];
    port.subscribe((event) => events.push(event));
    expect(port.phase()).toBe("initializing");

    port.markReady();
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the emit run
    expect(port.phase()).toBe("active");
    expect(events.map((event) => event.kind)).toEqual(["ready"]);
    expect(events[0]!.occurredAtMs).toBe(1_000); // the injected clock, not Date.now

    port.markReady(); // idempotent — exactly once
    expect(events.map((event) => event.kind)).toEqual(["ready"]);
  });

  it("document visibility hidden/visible maps to background/resume with phase agreement", async () => {
    const document = new FakeDocument();
    const port = createWebLifecyclePort({
      environment: makeBrowserEnvironment({ document }),
      clock: fixedClock(),
    });
    const events: LifecycleEvent[] = [];
    port.subscribe((event) => events.push(event));
    port.markReady();
    await new Promise((resolve) => setTimeout(resolve, 0));

    document.visibilityState = "hidden";
    document.fire("visibilitychange");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(port.phase()).toBe("background");

    document.visibilityState = "visible";
    document.fire("visibilitychange");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(port.phase()).toBe("active");

    expect(events.map((event) => event.kind)).toEqual(["ready", "background", "resume"]);
  });

  it("pagehide maps to shutdown — exactly once, and the phase stays terminal", async () => {
    const document = new FakeDocument();
    const port = createWebLifecyclePort({
      environment: makeBrowserEnvironment({ document }),
      clock: fixedClock(),
    });
    const events: LifecycleEvent[] = [];
    port.subscribe((event) => events.push(event));
    port.markReady();
    await new Promise((resolve) => setTimeout(resolve, 0));

    document.fire("pagehide");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(port.phase()).toBe("shutdown");

    // A late visibility signal after shutdown emits NOTHING (the honesty
    // law: never report active after shutdown).
    document.visibilityState = "hidden";
    document.fire("visibilitychange");
    document.fire("pagehide");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(port.phase()).toBe("shutdown");
    expect(events.map((event) => event.kind)).toEqual(["ready", "shutdown"]);
  });

  it("async shutdown hooks are awaited before the emit resolves (the flush law)", async () => {
    const port = createWebLifecyclePort({
      environment: makeServerEnvironment(),
      clock: fixedClock(),
    });
    let flushed = false;
    port.hook("shutdown", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      flushed = true;
    });
    await port.emit("shutdown");
    expect(flushed).toBe(true);
  });

  it("hooks are per-kind and subscribable; duplicate registration runs twice", async () => {
    const port = createWebLifecyclePort({
      environment: makeServerEnvironment(),
      clock: fixedClock(),
    });
    let backgroundCount = 0;
    let resumeCount = 0;
    port.hook("background", () => {
      backgroundCount += 1;
    });
    port.hook("background", () => {
      backgroundCount += 1;
    });
    port.hook("resume", () => {
      resumeCount += 1;
    });
    await port.emit("background");
    await port.emit("resume");
    expect(backgroundCount).toBe(2);
    expect(resumeCount).toBe(1);
  });

  it("a no-document context emits nothing from DOM signals (honest absence)", async () => {
    const port = createWebLifecyclePort({
      environment: makeServerEnvironment(),
      clock: fixedClock(),
    });
    const events: LifecycleEvent[] = [];
    port.subscribe((event) => events.push(event));
    // No document exists — there is no DOM signal to fire; nothing
    // synthetic is emitted.
    expect(events).toEqual([]);
    expect(port.phase()).toBe("initializing"); // until markReady
    port.markReady();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(port.phase()).toBe("active");
  });
});
