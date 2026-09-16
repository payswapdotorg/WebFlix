/**
 * R08 — BackgroundWorkPort over the native task registry (shell simulator).
 *
 * Truthful scheduling (typed outcomes, never silently dropped), idempotent
 * taskIds, honest states, and the FULL background-work truth: tasks keep
 * running while the window is unfocused (the Desktop reference law).
 */

import { describe, expect, it } from "bun:test";

import { createShellBackgroundWorkPort } from "../src/platform/background-work";
import { SimShell } from "./shell-simulator";

describe("R08 — desktop background work (full)", () => {
  it("scheduling accepts and tracks the task with the honest scheduled state", async () => {
    const shell = new SimShell();
    const work = createShellBackgroundWorkPort(shell);
    const outcome = await work.schedule({
      taskId: "acq-1",
      kind: "acquisition",
      label: "Completing authorized download",
    });
    expect(outcome).toEqual({ accepted: true, taskId: "acq-1" });
    const status = await work.status("acq-1");
    expect(status?.state).toBe("scheduled");
    expect(status?.kind).toBe("acquisition");
    expect(status?.progress).toBe(-1); // honestly unknown
  });

  it("re-scheduling the same taskId is idempotent (no duplicate tasks)", async () => {
    const shell = new SimShell();
    const work = createShellBackgroundWorkPort(shell);
    await work.schedule({ taskId: "sync-1", kind: "sync", label: "Event sync" });
    const again = await work.schedule({ taskId: "sync-1", kind: "sync", label: "Event sync" });
    expect(again).toEqual({ accepted: true, taskId: "sync-1" });
    expect(await work.list()).toHaveLength(1);
  });

  it("an invalid task is rejected with the typed reason (never silently dropped)", async () => {
    const work = createShellBackgroundWorkPort(new SimShell());
    const outcome = await work.schedule({ taskId: "", kind: "sync", label: "broken" });
    expect(outcome.accepted).toBe(false);
    if (!outcome.accepted) {
      expect(outcome.reason).toBe("invalid-task");
      expect(outcome.detail).toContain("taskId");
    }
  });

  it("at-capacity is a typed rejection, not a drop", async () => {
    const shell = new SimShell();
    shell.taskCapacity = 1;
    const work = createShellBackgroundWorkPort(shell);
    await work.schedule({ taskId: "t-1", kind: "maintenance", label: "Cache trim" });
    const outcome = await work.schedule({ taskId: "t-2", kind: "maintenance", label: "Integrity recheck" });
    expect(outcome.accepted).toBe(false);
    if (!outcome.accepted) {
      expect(outcome.reason).toBe("at-capacity");
    }
    expect(await work.status("t-2")).toBeNull();
  });

  it("cancel answers true for live tasks and false for unknown/finished ones", async () => {
    const shell = new SimShell();
    const work = createShellBackgroundWorkPort(shell);
    await work.schedule({ taskId: "acq-1", kind: "acquisition", label: "Download" });
    expect(await work.cancel("acq-1")).toBe(true);
    expect((await work.status("acq-1"))?.state).toBe("cancelled");
    expect(await work.cancel("acq-1")).toBe(false); // finished
    expect(await work.cancel("nope")).toBe(false); // unknown
  });

  it("status transitions stream to subscribers with the honest states", async () => {
    const shell = new SimShell();
    const work = createShellBackgroundWorkPort(shell);
    const seen: string[] = [];
    work.subscribe((status) => seen.push(`${status.taskId}:${status.state}:${status.progress}`));
    await work.schedule({ taskId: "acq-1", kind: "acquisition", label: "Download" });
    shell.pumpTask("acq-1", { state: "running", progress: 0.25 });
    shell.pumpTask("acq-1", { state: "completed", progress: 1 });
    expect(seen).toEqual([
      "acq-1:scheduled:-1",
      "acq-1:running:0.25",
      "acq-1:completed:1",
    ]);
    const final = await work.status("acq-1");
    expect(final?.state).toBe("completed");
    expect(final?.progress).toBe(1);
  });

  it("THE FULL-WORK TRUTH: tasks keep running while the window is unfocused", async () => {
    const shell = new SimShell();
    const work = createShellBackgroundWorkPort(shell);
    await work.schedule({ taskId: "acq-bg", kind: "acquisition", label: "Background completion" });
    shell.pumpTask("acq-bg", { state: "running", progress: 0.5 });
    // The window backgrounds (minimized/hidden) — the Desktop truth is
    // that background completion CONTINUES (never auto-suspended).
    shell.emitLifecycle("ready");
    shell.emitLifecycle("background");
    const status = await work.status("acq-bg");
    expect(status?.state).toBe("running");
    expect(status?.progress).toBe(0.5);
    // And it can still complete while unfocused.
    shell.pumpTask("acq-bg", { state: "completed", progress: 1 });
    expect((await work.status("acq-bg"))?.state).toBe("completed");
  });

  it("list answers every tracked task", async () => {
    const shell = new SimShell();
    const work = createShellBackgroundWorkPort(shell);
    await work.schedule({ taskId: "a", kind: "acquisition", label: "A" });
    await work.schedule({ taskId: "b", kind: "sync", label: "B" });
    const list = await work.list();
    expect(list.map((status) => status.taskId).sort()).toEqual(["a", "b"]);
  });
});
