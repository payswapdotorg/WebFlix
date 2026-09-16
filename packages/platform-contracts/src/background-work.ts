/**
 * @wfx/platform-contracts — BackgroundWorkPort (R01).
 *
 * INTERFACE ONLY. The background execution capability: Web honestly
 * declares `backgroundWork: "none"` (browser tabs suspend; no real
 * background acquisition), Desktop declares `"full"` (native background
 * completion while unfocused — the frozen Desktop reference capability),
 * Mobile typically `"limited"` (OS-scheduled windows). The capability level
 * on the bundle is the TRUTH; this port exists only where the level is not
 * `"none"`.
 *
 * Scheduling honesty: `schedule` answers a typed outcome — accepted work is
 * tracked with truthful state; rejected work is never silently dropped
 * (`at-capacity` and `unsupported-kind` name the reason). Progress values
 * are the adapter's honest numbers (`-1` when genuinely unknown).
 */

import type { Unsubscribe } from "./common";

/** The kinds of background work the port understands. */
export type BackgroundTaskKind =
  /** Authorized native media acquisition/completion (R10/R14 seam). */
  | "acquisition"
  /** Event/queue synchronization work. */
  | "sync"
  /** Maintenance (cache eviction, integrity re-checks). */
  | "maintenance";

/** Every value of `BackgroundTaskKind`, in union order. */
export const BACKGROUND_TASK_KINDS: readonly BackgroundTaskKind[] = [
  "acquisition",
  "sync",
  "maintenance",
];

/** One background task to schedule. `taskId` is the caller's idempotency key. */
export interface BackgroundTaskSpec {
  readonly taskId: string;
  readonly kind: BackgroundTaskKind;
  /** Human label surfaced in any progress UI. */
  readonly label: string;
}

/** The truthful state of one background task. */
export type BackgroundTaskState =
  | "scheduled"
  | "running"
  /** The OS suspended it (Mobile window ended, Desktop unfocused policy). */
  | "suspended"
  | "completed"
  | "failed"
  | "cancelled";

/** Every value of `BackgroundTaskState`, in union order. */
export const BACKGROUND_TASK_STATES: readonly BackgroundTaskState[] = [
  "scheduled",
  "running",
  "suspended",
  "completed",
  "failed",
  "cancelled",
];

/** A task's status snapshot. */
export interface BackgroundTaskStatus {
  readonly taskId: string;
  readonly kind: BackgroundTaskKind;
  readonly state: BackgroundTaskState;
  /** Progress in [0,1], or -1 when honestly unknown. */
  readonly progress: number;
  /** Honest failure detail when `state` is `"failed"`. */
  readonly detail?: string;
  /** Epoch milliseconds (adapter clock) of the last status change. */
  readonly updatedAtMs: number;
}

/** The typed outcome of one `schedule` call. */
export type BackgroundWorkOutcome =
  | { readonly accepted: true; readonly taskId: string }
  | {
      readonly accepted: false;
      readonly reason: "unsupported-kind" | "at-capacity" | "invalid-task";
      readonly detail: string;
    };

/**
 * The background work capability port. INTERFACE ONLY: adapters implement
 * it over OS background facilities; the runtime uses it for honest
 * background acquisition scheduling where the platform truly supports it.
 */
export interface BackgroundWorkPort {
  /** Schedule one task (idempotent per `taskId`). Never silently dropped. */
  schedule(task: BackgroundTaskSpec): Promise<BackgroundWorkOutcome>;
  /** Cancel one task; resolves `false` when the id is unknown/finished. */
  cancel(taskId: string): Promise<boolean>;
  /** One task's status; `null` when unknown. */
  status(taskId: string): Promise<BackgroundTaskStatus | null>;
  /** Every tracked task's status. */
  list(): Promise<readonly BackgroundTaskStatus[]>;
  /** Observe status changes of every task. */
  subscribe(listener: (status: BackgroundTaskStatus) => void): Unsubscribe;
}
