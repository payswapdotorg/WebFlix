/**
 * @wfx/model-fabric — the transform-operation controller (R06, Lane A).
 *
 * `TransformOperationController` is the control-surface wrapper around the
 * fabric's `runTransformation` pipeline + the persistence layer's
 * `PostgresTransformOperationStore`. It productionizes the EXPLICIT
 * transformation state machine the R06 spec mandates — never implicit
 * background magic:
 *
 *   1. submit() — validate the request, INSERT a `queued` operation
 *      record into the persistence store, run the fabric pipeline
 *      (asynchronously), and answer the freshly-created record. The
 *      caller renders the queued state immediately; the operation runs
 *      in the background.
 *   2. As the pipeline progresses, the controller transitions the
 *      operation's state (queued → running → succeeded | failed). The
 *      persistence store's append-only history records EVERY transition.
 *   3. cancel() — transition a `queued`/`running` operation to
 *      `cancelled` (the explicit cancellation path — never a silent
 *      drop). Succeeded/failed operations are terminal and reject cancel.
 *   4. read() — the current operation record (the snapshot read-model +
 *      the append-only history when requested).
 *   5. clearResult() — DELETE the result of a succeeded transform (the
 *      spec's "DELETE for result cleanup where applicable" — transitions
 *      to cancelled, clears the result_ref, appends the cleanup to
 *      history).
 *
 * PERMISSION enforcement: the controller consults the fabric's
 * `TransformationPermissions` authority BEFORE the operation runs — a
 * denial short-circuits with a `failed` operation (typed error_detail),
 * the fabric is NEVER invoked. J20's "Constrained" truth: a constrained
 * platform answers the typed constraint, never a fake success.
 *
 * THE PRIVACY LAW: provider credentials and BYOM keys are NEVER in
 * model prompts — the controller's request shape is the fabric's
 * `BaseTransformationInput` (the media provenance record + typed
 * references). Keys live in the BYOM-binding store (envelope-encrypted)
 * and flow ONLY to the transport thunk through the binding adapter.
 *
 * Determinism: pure composition over the fabric pipeline + the
 * persistence store + the injected clock/ids seams.
 */

import type { ModelFabric } from "../fabric";
import type { FabricError } from "../types";
import { describeFabricError } from "../types";
import {
  TransformationPermissions,
} from "./permissions";
import {
  runTransformation,
  type TransformationReceipt,
  type TransformationResult,
  type TransformationRunOptions,
} from "./pipeline";
import type {
  AnyTransformationTaskDescriptor,
  BaseTransformationInput,
  TransformationTaskKind,
} from "./tasks";
import { TRANSFORMATION_TASKS } from "./tasks";
import type { ModelPolicy } from "@wfx/domain";

// ---------------------------------------------------------------------------
// Local structural types (avoid a hard @wfx/persistence dependency — the
// lane rule prefers structural typing over cross-package imports when the
// shapes are owned by another lane).
// ---------------------------------------------------------------------------

/** The frozen transform-operation state union (mirrors persistence). */
export type TransformOperationState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

/** A stored transform-operation record (the snapshot read-model). */
export interface TransformOperationRecord {
  readonly id: string;
  readonly userId: string;
  readonly profileId: string | null;
  readonly kind: TransformationTaskKind;
  readonly targetRef: string;
  readonly options: Record<string, unknown>;
  readonly state: TransformOperationState;
  readonly progress: number | null;
  readonly resultRef: string | null;
  readonly errorDetail: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One entry in the append-only state history. */
export interface TransformOperationStateHistoryEntry {
  readonly id: string;
  readonly operationId: string;
  readonly state: TransformOperationState;
  readonly progress: number | null;
  readonly detail: string | null;
  readonly transitionedAt: string;
}

// ---------------------------------------------------------------------------
// Submit options (the request shape the API accepts)
// ---------------------------------------------------------------------------

/** Per-submission options (the policy the fabric sees + provider hints). */
export interface TransformSubmitOptions {
  /** Privacy class. Default: 'local-only' (fail-closed — never leak media). */
  privacy?: ModelPolicy["privacy"];
  /** Preferred provider id — attempted first. */
  preferredProvider?: string;
  /** Fallback provider ids, attempted in order after the preferred. */
  fallbackProviders?: string[];
  /** Cost ceiling (abstract units). */
  maxCostPerOperation?: number;
  /** Per-provider timeout override (ms). */
  timeoutMs?: number;
}

/** The submit request — the API's `POST /experience/transforms` body. */
export interface TransformSubmitRequest {
  /** The kind of transformation to run. */
  kind: TransformationTaskKind;
  /**
   * The validated task input — the fabric's task descriptor's input shape.
   * Validated against the task schema (typed field-path issues).
   */
  input: unknown;
  /** The options (privacy + provider hints). */
  options?: TransformSubmitOptions;
}

// ---------------------------------------------------------------------------
// Submit outcome (the typed result the controller answers)
// ---------------------------------------------------------------------------

/** The typed outcome of a submit. */
export type SubmitTransformResult =
  | { ok: true; operation: TransformOperationRecord }
  | { ok: false; kind: "validation" | "permission"; issues: readonly string[] }
  | { ok: false; kind: "unknown-task"; detail: string };

// ---------------------------------------------------------------------------
// Read outcome (the typed result for `GET /experience/transforms/:id`)
// ---------------------------------------------------------------------------

/** The typed read outcome for one operation. */
export type ReadTransformResult =
  | { ok: true; operation: TransformOperationRecord }
  | { ok: false; reason: "not-found" };

/** The typed read outcome for the operation's history. */
export type ReadTransformHistoryResult =
  | { ok: true; history: readonly TransformOperationStateHistoryEntry[] }
  | { ok: false; reason: "not-found" };

// ---------------------------------------------------------------------------
// Cancel outcome (the typed result for `POST /experience/transforms/:id/cancel`)
// ---------------------------------------------------------------------------

/** The typed cancel outcome. */
export type CancelTransformResult =
  | { ok: true; operation: TransformOperationRecord }
  | { ok: false; reason: "not-found" | "terminal"; detail: string };

// ---------------------------------------------------------------------------
// Clear-result outcome (the typed result for `DELETE /experience/transforms/:id`)
// ---------------------------------------------------------------------------

/** The typed clear-result outcome. */
export type ClearResultTransformResult =
  | { ok: true; operation: TransformOperationRecord }
  | { ok: false; reason: "not-found" | "not-succeeded"; detail: string };

// ---------------------------------------------------------------------------
// Constructor dependencies
// ---------------------------------------------------------------------------

/** The persistence-side transform-operation store. */
export interface TransformOperationStorePort {
  createOperation(input: {
    userId: string;
    profileId: string | null;
    kind: TransformationTaskKind;
    targetRef: string;
    options?: Record<string, unknown>;
  }): Promise<TransformOperationRecord>;
  getOperation(
    operationId: string,
    userId: string,
    profileId: string | null,
  ): Promise<TransformOperationRecord | null>;
  transitionState(input: {
    operationId: string;
    userId: string;
    profileId: string | null;
    to: TransformOperationState;
    progress?: number;
    detail?: string;
  }): Promise<TransformOperationRecord>;
  clearResult(input: {
    operationId: string;
    userId: string;
    profileId: string | null;
  }): Promise<TransformOperationRecord>;
  listStateHistory(
    operationId: string,
  ): Promise<readonly TransformOperationStateHistoryEntry[]>;
}

/** Constructor dependencies for the controller. */
export interface TransformOperationControllerOptions {
  readonly fabric: ModelFabric;
  readonly store: TransformOperationStorePort;
  /** The injected clock — for running the pipeline asynchronously. */
  readonly now: () => number;
}

// ---------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------

/**
 * The transform-operation controller: the control-surface wrapper around
 * the fabric pipeline + the persistence store. Productionizes the
 * EXPLICIT transformation state machine the R06 spec mandates.
 */
export class TransformOperationController {
  private readonly fabric: ModelFabric;
  private readonly store: TransformOperationStorePort;
  private readonly now: () => number;

  constructor(options: TransformOperationControllerOptions) {
    this.fabric = options.fabric;
    this.store = options.store;
    this.now = options.now;
  }

  /**
   * Submit a transformation: validate the request, INSERT a queued
   * operation, run the pipeline ASYNCHRONOUSLY (the controller answers the
   * queued record immediately; the pipeline's outcome transitions the
   * operation's state through the append-only history).
   *
   * Permission check: the fabric's authority is consulted BEFORE the
   * pipeline runs. A denial creates a `failed` operation record (typed
   * error_detail) and never invokes the fabric — J20's "Constrained"
   * truth.
   */
  async submit(
    userId: string,
    profileId: string | null,
    request: TransformSubmitRequest,
  ): Promise<SubmitTransformResult> {
    // 1. Look up the task descriptor.
    const descriptor = findTaskDescriptor(request.kind);
    if (descriptor === null) {
      return {
        ok: false,
        kind: "unknown-task",
        detail: `unknown transformation kind: ${request.kind}`,
      };
    }

    // 2. Validate the input against the task schema (typed field-path issues).
    const validated = descriptor.validate(request.input);
    if (!validated.ok) {
      return {
        ok: false,
        kind: "validation",
        issues: validated.issues.map((issue) => `${issue.path}: ${issue.message}`),
      };
    }
    const value = validated.value as BaseTransformationInput & {
      mediaRef?: string;
      audioRef?: string;
      text?: string;
      segments?: readonly unknown[];
    };

    // 3. Permission check FIRST — J20's "Constrained" truth.
    const verdict = TransformationPermissions.check(value.media, descriptor);
    if (!verdict.allowed) {
      // Create a `failed` operation record with the typed denial reason,
      // never invoke the fabric.
      const targetRef =
        typeof value.mediaRef === "string"
          ? value.mediaRef
          : typeof value.audioRef === "string"
            ? value.audioRef
            : typeof value.text === "string"
              ? `text:${value.text.slice(0, 32)}`
              : `source:${value.media.sourceId}`;
      let op: TransformOperationRecord;
      try {
        op = await this.store.createOperation({
          userId,
          profileId,
          kind: request.kind,
          targetRef,
          options: { ...(request.options ?? {}) },
        });
      } catch {
        return {
          ok: false,
          kind: "validation",
          issues: ["failed to create the operation record"],
        };
      }
      try {
        // queued → failed is NOT legal in the explicit state machine;
        // go queued → running → failed (the legal path).
        await this.store.transitionState({
          operationId: op.id,
          userId,
          profileId,
          to: "running",
        });
        const failed = await this.store.transitionState({
          operationId: op.id,
          userId,
          profileId,
          to: "failed",
          detail: `permission denied: ${verdict.reason}`,
        });
        return { ok: true, operation: failed };
      } catch {
        return { ok: true, operation: op }; // best-effort — the operation exists
      }
    }

    // 4. Create the queued operation record (the explicit submit step).
    const targetRef =
      typeof value.mediaRef === "string"
        ? value.mediaRef
        : typeof value.audioRef === "string"
          ? value.audioRef
          : typeof value.text === "string"
            ? `text:${value.text.slice(0, 32)}`
            : `source:${value.media.sourceId}`;
    let operation: TransformOperationRecord;
    try {
      operation = await this.store.createOperation({
        userId,
        profileId,
        kind: request.kind,
        targetRef,
        options: { ...(request.options ?? {}) },
      });
    } catch (thrown) {
      return {
        ok: false,
        kind: "validation",
        issues: [
          `failed to create the operation record: ${(thrown as Error).message}`,
        ],
      };
    }

    // 5. Run the pipeline ASYNCHRONOUSLY — the controller answers the
    // queued record now; the pipeline's outcome transitions the state.
    void this.runPipeline(
      userId,
      profileId,
      operation.id,
      descriptor,
      validated.value,
      request.options,
    ).catch(() => {
      // The pipeline failure is recorded by runPipeline itself; the
      // unhandled-rejection guard here is defense in depth.
    });

    return { ok: true, operation };
  }

  /**
   * Read one operation's current state. Returns null when not found or
   * not owned by the effective profile (the honest miss).
   */
  async read(
    operationId: string,
    userId: string,
    profileId: string | null,
  ): Promise<ReadTransformResult> {
    const op = await this.store.getOperation(operationId, userId, profileId);
    if (op === null) return { ok: false, reason: "not-found" };
    return { ok: true, operation: op };
  }

  /** Read the operation's append-only state history. */
  async readHistory(operationId: string): Promise<ReadTransformHistoryResult> {
    const history = await this.store.listStateHistory(operationId);
    if (history.length === 0) return { ok: false, reason: "not-found" };
    return { ok: true, history };
  }

  /**
   * Cancel one operation. Only `queued` or `running` operations may be
   * cancelled; terminal states (succeeded, failed, cancelled) reject.
   * Race-safe: if the operation transitioned to a terminal state between
   * the read and the transition (the pipeline finished first), the
   * illegal-transition error is converted to the typed `terminal` outcome
   * — never a 502.
   */
  async cancel(
    operationId: string,
    userId: string,
    profileId: string | null,
  ): Promise<CancelTransformResult> {
    const existing = await this.store.getOperation(operationId, userId, profileId);
    if (existing === null) return { ok: false, reason: "not-found", detail: "operation not found" };
    if (
      existing.state === "succeeded" ||
      existing.state === "failed" ||
      existing.state === "cancelled"
    ) {
      return {
        ok: false,
        reason: "terminal",
        detail: `operation is in terminal state '${existing.state}' — cannot cancel`,
      };
    }
    try {
      const cancelled = await this.store.transitionState({
        operationId,
        userId,
        profileId,
        to: "cancelled",
        detail: "user requested cancellation",
      });
      return { ok: true, operation: cancelled };
    } catch {
      // Race: the operation transitioned to a terminal state between the
      // read above and the transition attempt. Re-read and answer the
      // honest terminal outcome — never a 502.
      const refreshed = await this.store.getOperation(operationId, userId, profileId);
      if (refreshed === null) {
        return { ok: false, reason: "not-found", detail: "operation not found" };
      }
      return {
        ok: false,
        reason: "terminal",
        detail: `operation is in terminal state '${refreshed.state}' — cannot cancel`,
      };
    }
  }

  /**
   * DELETE the result of a succeeded transform (the spec's "DELETE for
   * result cleanup where applicable"). Transitions to cancelled, clears
   * the result_ref, appends the cleanup to history.
   */
  async clearResult(
    operationId: string,
    userId: string,
    profileId: string | null,
  ): Promise<ClearResultTransformResult> {
    const existing = await this.store.getOperation(operationId, userId, profileId);
    if (existing === null) {
      return { ok: false, reason: "not-found", detail: "operation not found" };
    }
    if (existing.state !== "succeeded") {
      return {
        ok: false,
        reason: "not-succeeded",
        detail: `operation is in state '${existing.state}', expected 'succeeded'`,
      };
    }
    const cleared = await this.store.clearResult({
      operationId,
      userId,
      profileId,
    });
    return { ok: true, operation: cleared };
  }

  // -------------------------------------------------------------------------
  // The pipeline runner — runs ASYNCHRONOUSLY after submit() answers.
  // -------------------------------------------------------------------------

  private async runPipeline<TInput extends BaseTransformationInput, TFabricOutput, TOutput>(
    userId: string,
    profileId: string | null,
    operationId: string,
    descriptor: AnyTransformationTaskDescriptor,
    input: TInput,
    options: TransformSubmitOptions | undefined,
  ): Promise<void> {
    // Transition queued → running FIRST (the explicit state machine).
    try {
      await this.store.transitionState({
        operationId,
        userId,
        profileId,
        to: "running",
        progress: 0,
      });
    } catch {
      // The operation may have been cancelled before this fires; the
      // history captures the cancellation. The pipeline does not run.
      return;
    }

    // Re-validate against the descriptor (defensive; the descriptor's
    // validator is total and we already validated in submit()).
    const revalidated = descriptor.validate(input);
    if (!revalidated.ok) {
      await this.store.transitionState({
        operationId,
        userId,
        profileId,
        to: "failed",
        detail: `validation: ${revalidated.issues
          .map((i) => `${i.path}: ${i.message}`)
          .join("; ")}`,
      });
      return;
    }

    const fabricOptions: TransformationRunOptions = {
      privacy: options?.privacy ?? "local-only",
      ...(options?.preferredProvider !== undefined
        ? { preferredProvider: options.preferredProvider }
        : {}),
      ...(options?.fallbackProviders !== undefined
        ? { fallbackProviders: options.fallbackProviders }
        : {}),
      ...(options?.maxCostPerOperation !== undefined
        ? { maxCostPerOperation: options.maxCostPerOperation }
        : {}),
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    };

    let result: TransformationResult<TOutput>;
    try {
      result = (await runTransformation<TInput, TFabricOutput, TOutput>(
        this.fabric,
        // The descriptor's wildcard type is preserved by the cast; the
        // pipeline's runtime is the descriptor's own validate/realize.
        descriptor as never,
        input,
        fabricOptions,
      )) as TransformationResult<TOutput>;
    } catch (thrown) {
      // A throw from the pipeline is a bug (it should answer typed errors);
      // record the bounded message and return.
      const msg =
        thrown instanceof Error ? thrown.message : String(thrown);
      await this.store.transitionState({
        operationId,
        userId,
        profileId,
        to: "failed",
        detail: `pipeline crashed: ${msg.slice(0, 200)}`,
      });
      return;
    }

    if (result.ok) {
      const receipt = result as unknown as TransformationReceipt<TOutput>;
      await this.store.transitionState({
        operationId,
        userId,
        profileId,
        to: "succeeded",
        progress: 1,
        detail: receipt.trace.invocationId, // the result reference
      });
      return;
    }

    // Failed — record the typed error summary (bounded, never the input).
    const error = (result as { ok: false; error: { kind: string } }).error;
    const summary = summarizeTransformationError(
      error as never,
      result as never,
    );
    await this.store.transitionState({
      operationId,
      userId,
      profileId,
      to: "failed",
      detail: summary,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up a transformation task descriptor by kind. */
function findTaskDescriptor(
  kind: TransformationTaskKind,
): AnyTransformationTaskDescriptor | null {
  return TRANSFORMATION_TASKS.find((descriptor) => descriptor.kind === kind) ?? null;
}

/**
 * Summarize a transformation failure as a bounded, human-readable string —
 * never the input, never the key. The transformation pipeline's typed
 * errors carry their own summary shape; this maps them to a single line.
 */
function summarizeTransformationError(
  error: { kind: string },
  result: { ok: false; error: never; trace?: never },
): string {
  // The TransformationError kind carries its own summary; we reuse the
  // fabric's `describeFabricError` when the inner error is a FabricError
  // (the most common case — the pipeline wraps fabric failures).
  const inner = error as unknown as FabricError | { kind: string };
  if (
    typeof inner === "object" &&
    inner !== null &&
    typeof (inner as { kind?: unknown }).kind === "string" &&
    [
      "no-provider",
      "policy",
      "privacy",
      "cost",
      "provider-error",
      "timeout",
    ].includes((inner as { kind: string }).kind)
  ) {
    return describeFabricError(inner as FabricError);
  }
  // The pipeline's own error kinds (validation, permission, cost-ceiling)
  // carry their own summary fields; surface the kind + a bounded reason.
  switch ((error as { kind?: string }).kind) {
    case "validation":
      return `validation: the task input failed the schema`;
    case "permission":
      return `permission: the transformation was denied by the permission authority`;
    case "cost-ceiling":
      return `cost-ceiling: the deterministic estimate exceeded the policy ceiling`;
    case "fabric":
      return `fabric: ${describeFabricError(
        (result as { ok: false; error: FabricError; trace?: never }).error,
      )}`;
    default:
      return `transformation failed (kind: ${(error as { kind?: string }).kind ?? "unknown"})`;
  }
}
