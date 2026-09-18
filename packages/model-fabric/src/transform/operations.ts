/**
 * @wfx/model-fabric/src/transform — the EXPLICIT transformation operation
 * state machine + engine (R06).
 *
 * The remediation architecture's law (§AI media transformation): AI
 * capabilities are presented as explicit user actions with progress and
 * results — never implicit background magic. This module is that
 * explicitness, as machinery:
 *
 * - `TransformOperationState` — the closed vocabulary
 *   `queued → running → succeeded | failed | cancelled` (cancel legal from
 *   queued AND running; all three terminal states are terminal).
 * - `transitionTransformOperation` — the PURE transition function: every
 *   legal transition answers the next state + the history entry to append;
 *   every illegal one answers the typed refusal (never a silent overwrite,
 *   never a resurrect).
 * - `TransformOperationStore` — the durable-store SEAM (interface): the
 *   persistence package provides the SQL implementation (structurally —
 *   the repo's lane law: model-fabric defines the seam, persistence speaks
 *   it without importing this package).
 * - `TransformOperationEngine` — the driver: `submit` (validate + PERMISSION
 *   CHECK FIRST — a denied or constrained transformation is refused BEFORE
 *   any operation record exists: the J20 law, a constrained platform answers
 *   the typed constraint, never a fake success), `run` (queued → running →
 *   terminal, with the pipeline's progress reporting persisted where the
 *   fabric reports it), `cancel` (the user's undo while work is in flight;
 *   a run that completes after a cancel DISCARDS its result — cancelled is
 *   terminal).
 *
 * The state HISTORY is APPEND-ONLY: every transition appends one
 * `{ from, to, event, at, reason? }` entry; no code path rewrites or drops
 * history (the store enforces it with the transition insert + guarded
 * state-column update in one atomic step).
 *
 * Purity laws: the transition function is pure (no I/O, no clocks — time
 * arrives in the events); the ENGINE composes injected seams only (store,
 * fabric, clock, ids) — deterministic under fixed seams, exactly like the
 * fabric's own gateway.
 */

import type { PermissionVerdict } from "./permissions";
import { TransformationPermissions } from "./permissions";
import { runTransformation, type TransformationError, type TransformationRunOptions, type TransformationReceipt } from "./pipeline";
import type {
  AnyTransformationTaskDescriptor,
  TransformationTaskKind,
  ValidationIssue,
} from "./tasks";
import { isTransformationTaskKind, TRANSFORMATION_TASKS } from "./tasks";
import type { ModelFabric } from "../fabric";

// ---------------------------------------------------------------------------
// The state vocabulary
// ---------------------------------------------------------------------------

/**
 * The explicit transformation operation states. `queued` and `running` are
 * live; `succeeded`, `failed`, and `cancelled` are TERMINAL (no transition
 * leaves them — a completed operation is never silently rewritten).
 */
export type TransformOperationState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

/** Every state, in machine order. */
export const TRANSFORM_OPERATION_STATES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const satisfies readonly TransformOperationState[];

/** Runtime guard for the state vocabulary (accepts untrusted values). */
export function isTransformOperationState(x: unknown): x is TransformOperationState {
  return (
    typeof x === "string" &&
    (TRANSFORM_OPERATION_STATES as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// The transition events (what can happen to an operation)
// ---------------------------------------------------------------------------

/** One typed transition event. `at` is the ISO instant (injected clock). */
export type TransformOperationEvent =
  | { kind: "start"; at: string }
  | { kind: "succeed"; at: string; result: TransformOperationResult }
  | { kind: "fail"; at: string; error: TransformOperationError }
  | { kind: "cancel"; at: string; reason?: string };

/** The closed event-kind vocabulary. */
export const TRANSFORM_OPERATION_EVENT_KINDS = [
  "start",
  "succeed",
  "fail",
  "cancel",
] as const satisfies readonly TransformOperationEvent["kind"][];

// ---------------------------------------------------------------------------
// The operation record (the snapshot the store persists)
// ---------------------------------------------------------------------------

/** The success artifact of an operation (the result reference + payload). */
export interface TransformOperationResult {
  /** The canonical result handle (`wfxtr_` + 26-char ULID body). */
  readonly reference: string;
  /** The provider that produced the terminal outcome (from the fabric trace). */
  readonly providerId: string;
  /** The realized task output (the transformation's result material). */
  readonly output: unknown;
  /** The task's deterministic cost estimate (abstract units). */
  readonly costEstimate: number;
  /** The task's deterministic duration estimate (ms). */
  readonly durationEstimateMs: number;
}

/** The typed failure detail recorded on the `failed` state. */
export interface TransformOperationError {
  /** The closed transformation-error kind (validation | permission | cost-ceiling | fabric). */
  readonly kind: "validation" | "permission" | "cost-ceiling" | "fabric";
  /** Human-readable, actionable detail (never the raw input). */
  readonly detail: string;
}

/**
 * The routing directive captured at submit time — everything `run` needs to
 * drive the fabric deterministically (privacy class, preferred/fallback
 * chain, cost ceiling, timeout). The HOST resolves it from the stored model
 * policy (BYOM replacement applied — `resolveEffectiveModelPolicy`).
 */
export type TransformRunDirective = TransformationRunOptions;

/** One append-only history entry: what changed, when, and why. */
export interface TransformStateHistoryEntry {
  /** The state BEFORE the transition. */
  readonly from: TransformOperationState;
  /** The state AFTER the transition. */
  readonly to: TransformOperationState;
  /** The event kind that caused it. */
  readonly event: TransformOperationEvent["kind"];
  /** ISO 8601 instant of the transition (the injected clock's stamp). */
  readonly at: string;
  /** Optional reason (cancel reasons, failure summary). */
  readonly reason?: string;
}

/**
 * The durable operation snapshot. `stateHistory` is the append-only truth;
 * `progress` is ABSENT unless the fabric reported it (honest progress: the
 * pipeline reports stage boundaries; a one-shot provider is a black box
 * between them). `options` is the routing directive captured at submit —
 * OPAQUE to the store (it round-trips as serialized JSON; the engine, which
 * captured it from the host, knows the shape and restores it at run time).
 */
export interface TransformOperationSnapshot {
  /** Canonical operation id (`wfxop_` + 26-char ULID body). */
  readonly id: string;
  /** The owner key (the effective profile the operation belongs to). */
  readonly ownerKey: string;
  /** The task kind (the closed transformation vocabulary). */
  readonly kind: TransformationTaskKind;
  /** The VALIDATED task input, frozen at submit. */
  readonly input: unknown;
  /** The current state. */
  readonly state: TransformOperationState;
  /** Fabric-reported progress in [0, 1]; ABSENT when none was reported. */
  readonly progress?: number;
  /** The result, present only on `succeeded`. */
  readonly result?: TransformOperationResult;
  /** The failure detail, present only on `failed`. */
  readonly error?: TransformOperationError;
  /** The routing directive captured at submit (opaque to the store). */
  readonly options: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Every transition, in order — append-only. */
  readonly stateHistory: readonly TransformStateHistoryEntry[];
}

// ---------------------------------------------------------------------------
// The pure transition function
// ---------------------------------------------------------------------------

/** The typed refusal of an illegal transition (never thrown by the engine — it answers typed failures). */
export interface IllegalTransition {
  readonly from: TransformOperationState;
  readonly event: TransformOperationEvent["kind"];
  readonly reason: string;
}

/** The outcome of one attempted transition. */
export type TransitionOutcome =
  | { ok: true; to: TransformOperationState; entry: TransformStateHistoryEntry }
  | { ok: false; refusal: IllegalTransition };

/**
 * The transition table, encoded as the pure function:
 *
 * - `start`   : queued → running.
 * - `succeed` : running → succeeded (carries the result).
 * - `fail`    : running → failed (carries the error).
 * - `cancel`  : queued | running → cancelled (the user's undo).
 *
 * Every event against a TERMINAL state is refused; `start` against `running`
 * is refused (one run per operation); `succeed`/`fail` against `queued` are
 * refused (an operation never jumps the running state — the state machine
 * is honest about WHEN work happened).
 */
export function transitionTransformOperation(
  state: TransformOperationState,
  event: TransformOperationEvent,
): TransitionOutcome {
  const refuse = (reason: string): TransitionOutcome => ({
    ok: false,
    refusal: { from: state, event: event.kind, reason },
  });

  switch (event.kind) {
    case "start":
      if (state === "queued") {
        return { ok: true, to: "running", entry: { from: state, to: "running", event: "start", at: event.at } };
      }
      return refuse(
        state === "running"
          ? "the operation is already running — one run per operation"
          : `the operation is terminal ('${state}') — no transition leaves a terminal state`,
      );
    case "succeed":
      if (state === "running") {
        return {
          ok: true,
          to: "succeeded",
          entry: { from: state, to: "succeeded", event: "succeed", at: event.at },
        };
      }
      return refuse(
        state === "queued"
          ? "an operation cannot succeed before it runs (queued → running → succeeded)"
          : `the operation is terminal ('${state}') — no transition leaves a terminal state`,
      );
    case "fail":
      if (state === "running") {
        return {
          ok: true,
          to: "failed",
          entry: { from: state, to: "failed", event: "fail", at: event.at, reason: event.error.detail },
        };
      }
      return refuse(
        state === "queued"
          ? "an operation cannot fail before it runs (queued → running → failed)"
          : `the operation is terminal ('${state}') — no transition leaves a terminal state`,
      );
    case "cancel":
      if (state === "queued" || state === "running") {
        return {
          ok: true,
          to: "cancelled",
          entry: {
            from: state,
            to: "cancelled",
            event: "cancel",
            at: event.at,
            ...(event.reason !== undefined ? { reason: event.reason } : {}),
          },
        };
      }
      return refuse(
        `the operation already finished ('${state}') — only queued or running work can be cancelled`,
      );
  }
}

// ---------------------------------------------------------------------------
// The durable store seam
// ---------------------------------------------------------------------------

/** The typed apply-transition input (engine → store, one atomic step). */
export interface ApplyTransitionInput {
  /** The operation id. */
  readonly id: string;
  /** The owner key (ownership guard — another profile's operation is not-found). */
  readonly ownerKey: string;
  /** The event being applied (the store derives to/reason/result/error from it). */
  readonly event: TransformOperationEvent;
  /** The state the engine believes the operation is in (the guarded update). */
  readonly expectedFrom: TransformOperationState;
}

/** The typed apply-transition outcome. */
export type ApplyTransitionResult =
  | { ok: true; snapshot: TransformOperationSnapshot }
  | { ok: false; failure: TransitionStoreFailure };

/** The closed store-failure vocabulary (engine maps these to typed API answers). */
export type TransitionStoreFailure =
  | { kind: "not-found"; detail: string }
  | { kind: "conflict"; detail: string }
  | { kind: "store-error"; detail: string };

/**
 * The durable transform-operation store seam. The persistence package's
 * `PostgresTransformOperationStore` implements this STRUCTURALLY (the lane
 * law — no cross-import): `transition` appends the history row AND updates
 * the state column in ONE transaction guarded by the expected prior state
 * (a concurrent double-transition answers the typed `conflict`, never a
 * silent overwrite).
 */
export interface TransformOperationStore {
  /** Persist a NEW operation (the queued snapshot). Idempotent per id. */
  create(snapshot: TransformOperationSnapshot): Promise<TransformOperationSnapshot>;
  /** One operation by id + owner (null when unknown or not owned — honest miss). */
  get(id: string, ownerKey: string): Promise<TransformOperationSnapshot | null>;
  /** The owner's operations, newest first. */
  listForOwner(ownerKey: string): Promise<readonly TransformOperationSnapshot[]>;
  /**
   * Apply one transition atomically: insert the history entry, update the
   * state (+ result/error fields), stamp `updatedAt` — all guarded by
   * `expectedFrom` (mismatch ⇒ typed `conflict`).
   */
  transition(input: ApplyTransitionInput): Promise<ApplyTransitionResult>;
  /** Persist a fabric-reported progress update (field update — never a history rewrite). */
  updateProgress(id: string, ownerKey: string, progress: number): Promise<void>;
  /**
   * Result cleanup: clear the result material (payload + reference) and the
   * reported progress from a `succeeded` operation, keeping the record +
   * state history (audit truth). True when a result was cleaned; false when
   * none existed.
   */
  clearResult(id: string, ownerKey: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** Engine dependencies (all injected seams). */
export interface TransformOperationEngineOptions {
  readonly store: TransformOperationStore;
  readonly fabric: ModelFabric;
  /** Time seam (epoch ms). */
  readonly clock: { now(): number };
  /** Id seam (26-char ULID bodies). */
  readonly ids: { next(): string };
  /**
   * The task descriptors the engine serves, keyed by kind. Defaults to the
   * frozen `TRANSFORMATION_TASKS` set (all eight kinds).
   */
  readonly tasks?: readonly AnyTransformationTaskDescriptor[];
  /** Id prefix for operation ids. Default `wfxop_`. */
  readonly operationIdPrefix?: string;
  /** Id prefix for result references. Default `wfxtr_`. */
  readonly resultIdPrefix?: string;
}

/** The typed submit outcome. */
export type SubmitTransformResult =
  | { ok: true; operation: TransformOperationSnapshot }
  | { ok: false; failure: SubmitTransformFailure };

/** The closed submit-failure vocabulary. */
export type SubmitTransformFailure =
  /** The kind is not in the closed vocabulary, or the input failed the task schema (field paths). */
  | { kind: "validation"; problems: readonly ValidationIssue[] }
  /** The J20 constrained truth: the permission authority denied this transformation for this media. */
  | { kind: "permission"; verdict: PermissionVerdict }
  /** The store refused the create (durability failure — typed, never a fake queued record). */
  | { kind: "store-error"; detail: string };

/** The typed run outcome (a FAILED transformation is a successful run — the operation records the failure honestly). */
export type RunTransformResult =
  | { ok: true; operation: TransformOperationSnapshot }
  | { ok: false; failure: RunTransformFailure };

/** The closed run-failure vocabulary. */
export type RunTransformFailure =
  | { kind: "not-found"; detail: string }
  | { kind: "invalid-state"; state: TransformOperationState; detail: string }
  | { kind: "store-error"; detail: string };

/** The typed cancel outcome. */
export type CancelTransformResult =
  | { ok: true; operation: TransformOperationSnapshot }
  | { ok: false; failure: CancelTransformFailure };

/** The closed cancel-failure vocabulary. */
export type CancelTransformFailure =
  | { kind: "not-found"; detail: string }
  | { kind: "invalid-state"; state: TransformOperationState; detail: string }
  | { kind: "store-error"; detail: string };

/** Task lookup by kind (the closed descriptor map). */
function taskMapOf(
  tasks: readonly AnyTransformationTaskDescriptor[],
): Map<TransformationTaskKind, AnyTransformationTaskDescriptor> {
  const map = new Map<TransformationTaskKind, AnyTransformationTaskDescriptor>();
  for (const task of tasks) map.set(task.kind, task);
  return map;
}

/**
 * The explicit transformation operation engine. One instance per host
 * composition; every method answers typed outcomes (never throws across
 * the seam for expected failures).
 */
export class TransformOperationEngine {
  private readonly store: TransformOperationStore;
  private readonly fabric: ModelFabric;
  private readonly clock: { now(): number };
  private readonly ids: { next(): string };
  private readonly tasks: Map<TransformationTaskKind, AnyTransformationTaskDescriptor>;
  private readonly operationIdPrefix: string;
  private readonly resultIdPrefix: string;

  constructor(options: TransformOperationEngineOptions) {
    this.store = options.store;
    this.fabric = options.fabric;
    this.clock = options.clock;
    this.ids = options.ids;
    this.tasks = taskMapOf(options.tasks ?? TRANSFORMATION_TASKS);
    this.operationIdPrefix = options.operationIdPrefix ?? "wfxop_";
    this.resultIdPrefix = options.resultIdPrefix ?? "wfxtr_";
  }

  /** The task kinds this engine serves (the closed map). */
  servedKinds(): readonly TransformationTaskKind[] {
    return [...this.tasks.keys()];
  }

  /**
   * Submit one transformation: validate the kind + input, check PERMISSIONS
   * FIRST (a denial answers the typed verdict and NO operation record is
   * created — the constrained-platform law), then persist the queued
   * snapshot with the routing directive. The caller (host) schedules
   * `run(id)` — inline or background.
   */
  async submit(
    ownerKey: string,
    command: { kind: unknown; input: unknown; options: unknown },
  ): Promise<SubmitTransformResult> {
    if (typeof ownerKey !== "string" || ownerKey.length === 0) {
      return { ok: false, failure: { kind: "store-error", detail: "ownerKey: expected a non-empty string" } };
    }
    if (!isTransformationTaskKind(command.kind)) {
      return {
        ok: false,
        failure: {
          kind: "validation",
          problems: [
            {
              path: "kind",
              message: `expected one of ${[...this.tasks.keys()].join(" | ")}, got ${previewOf(command.kind)}`,
            },
          ],
        },
      };
    }
    const task = this.tasks.get(command.kind);
    if (task === undefined) {
      return {
        ok: false,
        failure: {
          kind: "validation",
          problems: [{ path: "kind", message: `the engine does not serve task kind '${command.kind}'` }],
        },
      };
    }

    const validated = task.validate(command.input);
    if (!validated.ok) {
      return { ok: false, failure: { kind: "validation", problems: validated.issues } };
    }

    // PERMISSION FIRST: the media provenance verdict gates BEFORE the record.
    const verdict = TransformationPermissions.check(validated.value.media, task);
    if (!verdict.allowed) {
      return { ok: false, failure: { kind: "permission", verdict } };
    }

    const nowIso = new Date(this.clock.now()).toISOString();
    const snapshot: TransformOperationSnapshot = {
      id: `${this.operationIdPrefix}${this.ids.next()}`,
      ownerKey,
      kind: command.kind,
      input: validated.value,
      state: "queued",
      options: command.options,
      createdAt: nowIso,
      updatedAt: nowIso,
      stateHistory: [],
    };
    try {
      const created = await this.store.create(snapshot);
      return { ok: true, operation: created };
    } catch (thrown) {
      return { ok: false, failure: { kind: "store-error", detail: describeOf(thrown) } };
    }
  }

  /**
   * Run one queued operation to a terminal state: queued → running →
   * (succeeded | failed). Progress reports the fabric emits are persisted
   * through the store as they arrive. A run that completes after a CANCEL
   * discards its result (cancelled is terminal). A transformation that
   * FAILS is a SUCCESSFUL run — the operation honestly records the failure.
   */
  async run(id: string, ownerKey: string): Promise<RunTransformResult> {
    let current: TransformOperationSnapshot | null;
    try {
      current = await this.store.get(id, ownerKey);
    } catch (thrown) {
      return { ok: false, failure: { kind: "store-error", detail: describeOf(thrown) } };
    }
    if (current === null) {
      return { ok: false, failure: { kind: "not-found", detail: `no transform operation '${id}' for this profile` } };
    }
    if (current.state !== "queued") {
      return {
        ok: false,
        failure: {
          kind: "invalid-state",
          state: current.state,
          detail: `only queued operations can run — this one is '${current.state}'`,
        },
      };
    }
    const task = this.tasks.get(current.kind);
    if (task === undefined) {
      return {
        ok: false,
        failure: { kind: "invalid-state", state: current.state, detail: `the engine no longer serves kind '${current.kind}'` },
      };
    }

    // queued → running (the guarded, atomic transition).
    const started = await this.applyTransition(id, ownerKey, current.state, { kind: "start", at: this.nowIso() });
    if (!started.ok) return started;

    // Drive the pipeline with progress reporting where the fabric emits it.
    // The stored routing directive is restored here (the engine captured it
    // from the host; the store round-tripped it opaquely) — the engine's OWN
    // progress callback is injected, never the stored one.
    let receipt: TransformationReceipt<unknown> | { ok: false; error: TransformationError };
    try {
      receipt = await runTransformation(this.fabric, task as never, current.input, {
        ...(current.options as TransformationRunOptions),
        onProgress: (fraction) => this.reportProgress(id, ownerKey, fraction),
      });
    } catch (thrown) {
      // A progress-report store failure (or an unexpected engine bug) — the
      // operation FAILS explicitly; never a fake success, never a hang.
      await this.failOperation(id, ownerKey, {
        kind: "fabric",
        detail: `the transformation pipeline threw unexpectedly: ${describeOf(thrown)}`,
      });
      return this.reload(id, ownerKey);
    }

    // A cancel may have landed while the pipeline ran: cancelled is
    // terminal — the eventual result is DISCARDED, not recorded.
    const afterRun = await this.store.get(id, ownerKey);
    if (afterRun !== null && afterRun.state === "cancelled") {
      return { ok: true, operation: afterRun };
    }

    if (receipt.ok) {
      const result: TransformOperationResult = {
        reference: `${this.resultIdPrefix}${this.ids.next()}`,
        providerId: receipt.providerId,
        output: receipt.output,
        costEstimate: receipt.costEstimate,
        durationEstimateMs: receipt.durationEstimateMs,
      };
      await this.applyTransition(id, ownerKey, "running", { kind: "succeed", at: this.nowIso(), result });
    } else {
      await this.failOperation(id, ownerKey, transformationErrorOf(receipt.error));
    }
    return this.reload(id, ownerKey);
  }

  /**
   * Cancel one operation (the user's undo). Legal from `queued` and
   * `running`; terminal states answer the typed invalid-state refusal.
   */
  async cancel(id: string, ownerKey: string, reason?: string): Promise<CancelTransformResult> {
    let current: TransformOperationSnapshot | null;
    try {
      current = await this.store.get(id, ownerKey);
    } catch (thrown) {
      return { ok: false, failure: { kind: "store-error", detail: describeOf(thrown) } };
    }
    if (current === null) {
      return { ok: false, failure: { kind: "not-found", detail: `no transform operation '${id}' for this profile` } };
    }
    const outcome = transitionTransformOperation(current.state, { kind: "cancel", at: this.nowIso(), ...(reason !== undefined ? { reason } : {}) });
    if (!outcome.ok) {
      return {
        ok: false,
        failure: { kind: "invalid-state", state: current.state, detail: outcome.refusal.reason },
      };
    }
    const applied = await this.applyTransition(id, ownerKey, current.state, {
      kind: "cancel",
      at: this.nowIso(),
      ...(reason !== undefined ? { reason } : {}),
    });
    if (!applied.ok) {
      return { ok: false, failure: applied.failure };
    }
    return { ok: true, operation: applied.operation };
  }

  // — internals ——————————————————————————————————————————————————————————

  private nowIso(): string {
    return new Date(this.clock.now()).toISOString();
  }

  /** Persist one fabric-reported progress fraction (bounded, typed-safe). */
  private async reportProgress(id: string, ownerKey: string, fraction: number): Promise<void> {
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return; // dishonest fractions are dropped
    await this.store.updateProgress(id, ownerKey, fraction);
  }

  /** Apply a transition through the pure machine + the guarded store. */
  private async applyTransition(
    id: string,
    ownerKey: string,
    expectedFrom: TransformOperationState,
    event: TransformOperationEvent,
  ): Promise<RunTransformResult> {
    const outcome = transitionTransformOperation(expectedFrom, event);
    if (!outcome.ok) {
      return {
        ok: false,
        failure: { kind: "invalid-state", state: expectedFrom, detail: outcome.refusal.reason },
      };
    }
    try {
      const applied = await this.store.transition({ id, ownerKey, event, expectedFrom });
      if (!applied.ok) {
        return {
          ok: false,
          failure:
            applied.failure.kind === "not-found"
              ? { kind: "not-found", detail: applied.failure.detail }
              : applied.failure.kind === "conflict"
                ? { kind: "invalid-state", state: expectedFrom, detail: applied.failure.detail }
                : { kind: "store-error", detail: applied.failure.detail },
        };
      }
      return { ok: true, operation: applied.snapshot };
    } catch (thrown) {
      return { ok: false, failure: { kind: "store-error", detail: describeOf(thrown) } };
    }
  }

  /** Transition running → failed with the typed error detail. */
  private async failOperation(
    id: string,
    ownerKey: string,
    error: TransformOperationError,
  ): Promise<void> {
    const applied = await this.applyTransition(id, ownerKey, "running", { kind: "fail", at: this.nowIso(), error });
    if (!applied.ok) {
      // The machine refused (e.g. cancelled mid-run) — that verdict stands.
      return;
    }
  }

  private async reload(id: string, ownerKey: string): Promise<RunTransformResult> {
    const snapshot = await this.store.get(id, ownerKey);
    if (snapshot === null) {
      return { ok: false, failure: { kind: "not-found", detail: `no transform operation '${id}' for this profile` } };
    }
    return { ok: true, operation: snapshot };
  }
}

// ---------------------------------------------------------------------------
// Shared helpers (bounded, never throwing)
// ---------------------------------------------------------------------------

/** Map a pipeline `TransformationError` to the operation error record. */
function transformationErrorOf(error: TransformationError): TransformOperationError {
  switch (error.kind) {
    case "validation":
      return {
        kind: "validation",
        detail: error.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
      };
    case "permission":
      return { kind: "permission", detail: `permission: ${error.verdict.reason}` };
    case "cost-ceiling":
      return {
        kind: "cost-ceiling",
        detail: `cost-ceiling: deterministic estimate ${error.estimate} exceeds the policy ceiling ${error.ceiling} — denied before invocation`,
      };
    case "fabric":
      return {
        kind: "fabric",
        detail: `fabric: ${error.error.kind} (task '${error.task}')`,
      };
  }
}

function describeOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

function previewOf(value: unknown): string {
  let rendered: string;
  try {
    rendered = JSON.stringify(value) ?? String(value);
  } catch {
    rendered = String(value);
  }
  return rendered.length > 60 ? `${rendered.slice(0, 57)}...` : rendered;
}
