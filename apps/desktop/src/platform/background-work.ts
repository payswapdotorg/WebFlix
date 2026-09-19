/**
 * @wfx/app-desktop — BackgroundWorkPort over native background work (R08).
 *
 * The Desktop background seam: the native shell's background task
 * registry. Desktop truthfully declares `backgroundWork: "full"` — the
 * frozen Desktop reference capability:
 *
 * - tasks keep RUNNING while the window is unfocused/minimized (the
 *   native process is alive; only app termination stops them) — this is
 *   the "background acquisition/completion while unfocused" the frozen
 *   architecture names;
 * - on shutdown the registry stops (bounded by the shell's teardown) —
 *   durable resumption of interrupted acquisition is R13's recovery lane,
 *   keyed by the native-media session persistence, not by this port.
 *
 * EXECUTION BINDING (documented boundary): the shell's registry is the
 * TRUTHFUL STATE authority for background tasks (schedule/cancel/status/
 * events, honest states `scheduled|running|suspended|completed|failed|
 * cancelled`). The EXECUTORS that drive `acquisition` tasks are the
 * native-media engine sessions themselves (R10's service process keeps
 * downloading; R14 wires the acquisition UX to it); the BYOF feed `sync`
 * executor is the R20-F feed-sync driver (`platform/feed-sync.ts` — it
 * drives the registry through the executor `taskReport` seam); other
 * `sync`/`maintenance` executors land with their lanes. The shell
 * reports their state as the executors move it, never inventing progress.
 *
 * Scheduling honesty (the port contract): `schedule` answers a typed
 * outcome — accepted work is tracked with truthful state; rejected work
 * is never silently dropped (`at-capacity`/`unsupported-kind`/`
 * `invalid-task` name the reason); progress is the honest number (`-1`
 * when genuinely unknown). Idempotency: scheduling the same `taskId`
 * again answers `accepted: true` for that id without duplicating the
 * task.
 */

import type {
  BackgroundTaskSpec,
  BackgroundTaskStatus,
  BackgroundWorkOutcome,
  BackgroundWorkPort,
  Unsubscribe,
} from "@wfx/platform-contracts";

import type { ShellIpc, ShellTaskStatus } from "./shell-ipc";

/** Map a shell task status onto the port's shape (verbatim fields). */
function toStatus(status: ShellTaskStatus): BackgroundTaskStatus {
  return {
    taskId: status.taskId,
    kind: status.kind,
    state: status.state,
    progress: status.progress,
    ...(status.detail !== undefined ? { detail: status.detail } : {}),
    updatedAtMs: status.updatedAtMs,
  };
}

/** Build the Desktop `BackgroundWorkPort` over the shell's task registry. */
export function createShellBackgroundWorkPort(shell: ShellIpc): BackgroundWorkPort {
  return {
    async schedule(task: BackgroundTaskSpec): Promise<BackgroundWorkOutcome> {
      return shell.taskSchedule({
        taskId: task.taskId,
        kind: task.kind,
        label: task.label,
      });
    },

    async cancel(taskId: string): Promise<boolean> {
      return shell.taskCancel(taskId);
    },

    async status(taskId: string): Promise<BackgroundTaskStatus | null> {
      const status = await shell.taskStatus(taskId);
      return status === null ? null : toStatus(status);
    },

    async list(): Promise<readonly BackgroundTaskStatus[]> {
      const statuses = await shell.taskList();
      return statuses.map(toStatus);
    },

    subscribe(listener: (status: BackgroundTaskStatus) => void): Unsubscribe {
      return shell.onTaskEvent((status) => listener(toStatus(status)));
    },
  };
}
