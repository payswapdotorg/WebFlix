/**
 * @wfx/app-desktop — the Desktop BYOF background feed sync driver (R20-F).
 *
 * THE `sync`-kind background executor the task-registry design named
 * ("the shell reports their state as the executors move it, never
 * inventing progress") — this module IS the BYOF feed executor. It binds
 * the frozen shared feed sync seam (`FeedPort.syncImport`) to the
 * Desktop's FULL background-work capability:
 *
 * - SCHEDULE: one tracked task per import (`wfx-feed-sync/<importId>`,
 *   kind `"sync"`) in the native shell's registry — idempotent per id;
 * - EXECUTE: `runSync` drives the task through the executor report seam
 *   (`taskReport`: scheduled → running → completed/failed) and the
 *   port's `syncImport` does the real synchronization work;
 * - CADENCE: the HOST owns when sync passes run (the R10/R12
 *   no-hidden-timers law — this driver exposes the executor, not a
 *   scheduler). While the app lives, a continuous route can be kept
 *   `live` by the host's cadence; on app exit the registry stops
 *   (durable resumption is R13's lane, exactly as background-work.ts
 *   documents).
 *
 * Truth laws kept here (the R20 survival/state laws):
 * - A FAILING source NEVER deletes records: this driver has NO deletion
 *   path at all — a failed/reauthorization sync folds to the typed
 *   verdict and the imported records SURVIVE (the port's readFeed keeps
 *   answering them; pinned by tests against the real store semantics).
 * - A sync that cannot refresh names its honest typed outcome
 *   (`reauthorization-required` / `unsupported` / `failed` — the
 *   FeedImport.status vocabulary + the closed failure taxonomy) — never
 *   a silent no-op, never a fake completion.
 * - The task registry's state is the WORK's truth: `completed` means
 *   one sync pass applied; `failed` carries the typed verdict in the
 *   detail. Progress is `-1` when unknown (a feed sync has no partial
 *   progress to report — honest).
 */

import type { FeedImport, FeedPort } from "@wfx/domain";

import type { ShellIpc, ShellTaskStatus } from "./shell-ipc";

// ---------------------------------------------------------------------------
// The typed sync outcome
// ---------------------------------------------------------------------------

/**
 * The typed verdict of one background sync pass. Every non-`synced`
 * outcome RETAINS the imported records (the survival law — this driver
 * never deletes; only the explicit user-deletion path removes rows).
 */
export type DesktopFeedSyncOutcome =
  | { readonly outcome: "synced"; readonly import: FeedImport }
  | { readonly outcome: "reauthorization-required"; readonly detail: string }
  | { readonly outcome: "unsupported"; readonly detail: string }
  | { readonly outcome: "failed"; readonly detail: string };

/** The deterministic task id of one import's background sync (the idempotency key). */
export function feedSyncTaskId(importId: string): string {
  return `wfx-feed-sync/${importId}`;
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

/** Options for {@link createDesktopFeedSyncDriver}. */
export interface DesktopFeedSyncDriverOptions {
  /** The live native shell (the task registry + the executor report seam). */
  readonly shell: ShellIpc;
  /** The frozen shared feed port (`syncImport` is the real work). */
  readonly feedPort: FeedPort;
}

/** The Desktop BYOF background feed sync executor (the R20-F binding). */
export interface DesktopFeedSyncDriver {
  /**
   * Schedule the import's sync task in the native registry (kind
   * `sync` — idempotent per import; the typed schedule outcome answers
   * capacity/kind problems honestly, never a silent drop).
   */
  scheduleSync(input: { readonly importId: string; readonly label?: string }): Promise<
    | { readonly accepted: true; readonly taskId: string }
    | { readonly accepted: false; readonly reason: string; readonly detail: string }
  >;
  /**
   * Run ONE sync pass (the executor): drive the task truthfully through
   * the registry while the port's `syncImport` does the work. The typed
   * verdict carries the honest outcome; records survive every failure.
   */
  runSync(input: { readonly importId: string }): Promise<DesktopFeedSyncOutcome>;
  /**
   * Stop synchronizing one import (the honest disconnect half): the task
   * is cancelled, the records are RETAINED (deletion is the explicit
   * user path — never a sync side effect). Answers whether a live task
   * was cancelled.
   */
  cancelSync(importId: string): Promise<boolean>;
  /** The import's sync task status (the registry's truth; null when never scheduled). */
  syncStatus(importId: string): Promise<ShellTaskStatus | null>;
  /** Observe every tracked task's transitions (the shell's task channel, verbatim). */
  observeSync(listener: (status: ShellTaskStatus) => void): () => void;
}

/**
 * Build the Desktop BYOF background feed sync driver over the live shell
 * + the frozen shared feed port.
 */
export function createDesktopFeedSyncDriver(
  options: DesktopFeedSyncDriverOptions,
): DesktopFeedSyncDriver {
  const { shell, feedPort } = options;

  async function report(
    importId: string,
    state: ShellTaskStatus["state"],
    detail?: string,
  ): Promise<void> {
    // The executor report seam: the registry records the transition and
    // pushes it verbatim; an unknown task id answers false (never a fake
    // transition) — runSync always schedules first, so the id is known.
    await shell.taskReport({
      taskId: feedSyncTaskId(importId),
      state,
      progress: -1, // a feed sync pass has no honest partial progress
      ...(detail !== undefined ? { detail } : {}),
    });
  }

  return {
    async scheduleSync(input) {
      const outcome = await shell.taskSchedule({
        taskId: feedSyncTaskId(input.importId),
        kind: "sync",
        label: input.label ?? "Synchronizing your imported feed",
      });
      return outcome.accepted
        ? { accepted: true, taskId: outcome.taskId }
        : { accepted: false, reason: outcome.reason, detail: outcome.detail };
    },

    async runSync(input) {
      const { importId } = input;

      // The task must be tracked before the executor attaches (the
      // registry's law: scheduling is the entry; idempotent per id).
      const schedule = await this.scheduleSync({ importId });
      if (!schedule.accepted) {
        return {
          outcome: "unsupported",
          detail: `the background sync task could not be scheduled (${schedule.reason}): ${schedule.detail}`,
        };
      }

      // The executor attaches: scheduled → running (truthful transition).
      await report(importId, "running", "Synchronizing your imported feed");

      try {
        const imported = await feedPort.syncImport(importId);

        // The frozen FeedImport.status is the shared sync truth: fold it
        // onto the typed verdict + the task registry's honest state.
        switch (imported.status) {
          case "reauthorization-required": {
            const detail =
              imported.error ??
              "the source needs reauthorization before this feed can refresh";
            await report(importId, "failed", `Reauthorization required: ${detail}`);
            return { outcome: "reauthorization-required", detail };
          }
          case "failed": {
            const detail = imported.error ?? "the source reported a sync failure";
            await report(importId, "failed", detail);
            return { outcome: "failed", detail };
          }
          case "preview":
          case "confirmed":
          case "running": {
            // A sync that answers an in-flight status did not apply a
            // fresh capture — the honest verdict is that nothing was
            // synchronized yet (never a fake completion).
            const detail = `the import is still ${imported.status} — the sync did not apply a fresh capture`;
            await report(importId, "failed", detail);
            return { outcome: "failed", detail };
          }
          case "complete":
          default: {
            await report(importId, "completed", "Feed synchronized");
            return { outcome: "synced", import: imported };
          }
        }
      } catch (thrown) {
        // A rejecting port is a transport/provider-class failure: the
        // records SURVIVE (this driver has no deletion path), the task
        // fails honestly, and the verdict names the failure.
        const detail = thrown instanceof Error ? thrown.message : String(thrown);
        await report(importId, "failed", detail);
        return { outcome: "failed", detail };
      }
    },

    async cancelSync(importId) {
      return shell.taskCancel(feedSyncTaskId(importId));
    },

    async syncStatus(importId) {
      return shell.taskStatus(feedSyncTaskId(importId));
    },

    observeSync(listener) {
      return shell.onTaskEvent(listener);
    },
  };
}
