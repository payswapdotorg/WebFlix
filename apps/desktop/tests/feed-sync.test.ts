/**
 * R20-F — the Desktop BYOF background feed sync (the executor's laws).
 *
 * The `sync`-kind background executor over the native task registry,
 * proven against the shell simulator + the FeedPort double (the REAL
 * domain reconciliation engine inside):
 *
 * - TASK REGISTRY TRUTH: scheduling is idempotent (one task per import);
 *   the executor drives scheduled → running → completed/failed through
 *   the report seam; progress stays -1 (no honest partial progress to
 *   report); the task events stream to subscribers verbatim.
 * - BACKGROUND SYNC SEMANTICS: a successful pass answers `synced` and
 *   applies the REAL reconciliation diff (adds/removes/keeps — the
 *   fresh capture's truth, idempotent when nothing changed).
 * - THE SURVIVAL LAW: a failing source (transport) or an expired
 *   authorization NEVER deletes records — the records survive every
 *   failure fold and the task registry carries the typed verdict.
 * - DISCONNECT TRUTH: cancelling the sync stops the task and RETAINS
 *   every record (deletion is only the explicit user path).
 * - CADENCE LAW: the driver exposes the executor, not a scheduler —
 *   runSync runs when the host calls it (no hidden timers to assert).
 */

import { describe, expect, it } from "bun:test";

import { feedSyncTaskId, createDesktopFeedSyncDriver } from "../src/platform/feed-sync";
import { SimShell } from "./shell-simulator";
import { createFeedPortDouble, testExportArtifact } from "./feed-port-double";

const PROFILE = "wfxusr_r20g_test:main";
const USER = "wfxusr_r20g_test";

function makeFixture(input: { continuousSync: boolean }) {
  let counter = 0;
  const shell = new SimShell();
  const double = createFeedPortDouble({
    profileId: PROFILE,
    userId: USER,
    now: () => "2026-09-19T13:00:00.000Z",
    nextId: () => String(++counter).padStart(6, "0"),
  });
  const artifact = testExportArtifact({
    continuousSync: input.continuousSync,
    sourceRef: "PL_r20g",
    items: [
      { externalRef: "vidA", relationship: "playlist" as const, sourceOrder: 0, title: "Alpha" },
      { externalRef: "vidB", relationship: "playlist" as const, sourceOrder: 1, title: "Beta" },
    ],
  });
  const driver = createDesktopFeedSyncDriver({ shell, feedPort: double.port });
  return { shell, double, artifact, driver };
}

/** Import a file through the port directly (the confirmed precondition). */
async function confirmedImport(
  double: ReturnType<typeof createFeedPortDouble>,
  artifact: Uint8Array,
): Promise<string> {
  const preview = await double.port.previewImport({ connectorId: "youtube", method: "user-file", artifact });
  await double.port.confirmImport(preview.importId);
  return preview.importId;
}

describe("R20-F — the background feed sync executor", () => {
  it("schedules one idempotent sync task per import (kind sync, honest scheduled state)", async () => {
    const { shell, double, artifact, driver } = makeFixture({ continuousSync: true });
    const importId = await confirmedImport(double, artifact);

    const first = await driver.scheduleSync({ importId });
    expect(first).toEqual({ accepted: true, taskId: feedSyncTaskId(importId) });
    const second = await driver.scheduleSync({ importId });
    expect(second).toEqual({ accepted: true, taskId: feedSyncTaskId(importId) });
    expect(await shell.taskList()).toHaveLength(1); // ONE task, not two

    const status = await driver.syncStatus(importId);
    expect(status?.kind).toBe("sync");
    expect(status?.state).toBe("scheduled"); // honestly scheduled until the executor attaches
    expect(status?.progress).toBe(-1); // honestly unknown
  });

  it("a successful pass drives scheduled → running → completed and answers synced", async () => {
    const { double, artifact, driver } = makeFixture({ continuousSync: true });
    const importId = await confirmedImport(double, artifact);

    const seen: string[] = [];
    driver.observeSync((status) => {
      if (status.taskId === feedSyncTaskId(importId)) seen.push(status.state);
    });

    const outcome = await driver.runSync({ importId });
    expect(outcome.outcome).toBe("synced");
    expect(seen).toEqual(["scheduled", "running", "completed"]); // the truthful transitions, in order

    const status = await driver.syncStatus(importId);
    expect(status?.state).toBe("completed");
    expect(status?.progress).toBe(-1); // a feed sync has no honest partial progress
  });

  it("the sync applies the REAL reconciliation diff (a fresh capture adds/removes; an unchanged one is a no-op)", async () => {
    const { double, artifact, driver } = makeFixture({ continuousSync: true });
    const importId = await confirmedImport(double, artifact);
    expect(double.recordCount()).toBe(2);

    // An UNCHANGED capture: the diff is empty (the idempotence law).
    const unchanged = await driver.runSync({ importId });
    expect(unchanged.outcome).toBe("synced");
    expect(double.recordCount()).toBe(2);

    // A CHANGED capture: vidB gone, vidC new (the source's truth).
    double.scriptNextSyncCapture({
      continuousSync: true,
      sourceRef: "PL_r20g",
      items: [
        { externalRef: "vidA", relationship: "playlist", sourceOrder: 0, title: "Alpha" },
        { externalRef: "vidC", relationship: "playlist", sourceOrder: 1, title: "Gamma" },
      ],
    });
    const changed = await driver.runSync({ importId });
    expect(changed.outcome).toBe("synced");
    expect(double.recordCount()).toBe(2); // vidB removed, vidC added
    const records = await double.allRecords();
    expect(records.map((record) => record.externalRef).sort()).toEqual(["vidA", "vidC"]);
  });

  it("THE SURVIVAL LAW: a transport failure fails the task and RETAINS every record", async () => {
    const { double, artifact, driver } = makeFixture({ continuousSync: true });
    const importId = await confirmedImport(double, artifact);
    expect(double.recordCount()).toBe(2);

    double.scriptNextSyncFailure("transport");
    const outcome = await driver.runSync({ importId });
    expect(outcome.outcome).toBe("failed");
    if (outcome.outcome === "failed") {
      expect(outcome.detail).toContain("transport to the source failed");
    }

    // The records SURVIVED (the survival law — a failing source never erases them).
    expect(double.recordCount()).toBe(2);
    const status = await driver.syncStatus(importId);
    expect(status?.state).toBe("failed");
    expect(status?.detail).toContain("transport to the source failed"); // the typed verdict rides the task
  });

  it("an expired authorization answers the typed reauthorization verdict and RETAINS every record", async () => {
    const { double, artifact, driver } = makeFixture({ continuousSync: true });
    const importId = await confirmedImport(double, artifact);

    double.scriptNextSyncFailure("authorization");
    const outcome = await driver.runSync({ importId });
    expect(outcome.outcome).toBe("reauthorization-required");
    if (outcome.outcome === "reauthorization-required") {
      expect(outcome.detail).toContain("authorization");
    }

    // Records retained; the task failed honestly with the recovery path named.
    expect(double.recordCount()).toBe(2);
    const status = await driver.syncStatus(importId);
    expect(status?.state).toBe("failed");
    expect(status?.detail).toContain("Reauthorization required");
  });

  it("DISCONNECT TRUTH: cancelling the sync stops the task and keeps every record", async () => {
    const { double, artifact, driver } = makeFixture({ continuousSync: true });
    const importId = await confirmedImport(double, artifact);

    await driver.scheduleSync({ importId });
    const cancelled = await driver.cancelSync(importId);
    expect(cancelled).toBe(true);
    const status = await driver.syncStatus(importId);
    expect(status?.state).toBe("cancelled");

    // The imported feed is fully readable after the disconnect (the
    // survival law: a disconnected source is not a deleted feed).
    const records = await double.allRecords();
    expect(records).toHaveLength(2);
  });

  it("a task at registry capacity answers the typed unsupported verdict (never a silent drop)", async () => {
    const { shell, double, artifact, driver } = makeFixture({ continuousSync: true });
    const importId = await confirmedImport(double, artifact);
    shell.taskCapacity = 1;
    await shell.taskSchedule({ taskId: "occupying-task", kind: "maintenance", label: "x" });

    const outcome = await driver.runSync({ importId });
    expect(outcome.outcome).toBe("unsupported");
    if (outcome.outcome === "unsupported") {
      expect(outcome.detail).toContain("could not be scheduled");
      expect(outcome.detail).toContain("at-capacity");
    }
  });

  it("task events stream to every observer with the registry's truth verbatim", async () => {
    const { double, artifact, driver } = makeFixture({ continuousSync: true });
    const importId = await confirmedImport(double, artifact);

    const events: { taskId: string; state: string; detail?: string }[] = [];
    driver.observeSync((status) => events.push({ taskId: status.taskId, state: status.state, ...(status.detail !== undefined ? { detail: status.detail } : {}) }));
    await driver.runSync({ importId });

    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events[0]?.state).toBe("scheduled");
    expect(events[1]?.state).toBe("running");
    expect(events[2]?.state).toBe("completed");
    expect(events[2]?.detail).toBe("Feed synchronized");
  });
});
