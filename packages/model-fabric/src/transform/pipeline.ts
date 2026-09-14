/**
 * @wfx/model-fabric/src/transform — the transformation pipeline (WFX-033, Lane A).
 *
 * `runTransformation(fabric, task, input, options?)` is the ONLY way the tool
 * layer invokes the Model Fabric for a transformation:
 *
 *  1. VALIDATE the caller's options and the input against the task schema —
 *     typed errors with FIELD PATHS, aggregated, never thrown.
 *  2. CHECK PERMISSIONS FIRST (fail fast): `TransformationPermissions` judges
 *     the embedded provenance record before ANY fabric invocation — a denial
 *     short-circuits with the typed verdict echoed verbatim, and no provider
 *     ever sees the input. Input validation necessarily precedes the
 *     permission check because the provenance record lives inside the input
 *     and unvalidated input cannot ground a permission decision; "first"
 *     means first against the fabric (observable via provider call logs).
 *  3. PRE-FLIGHT THE COST CEILING: the task's DETERMINISTIC estimate is
 *     compared against `options.maxCostPerOperation` — over-ceiling answers a
 *     typed `cost-ceiling` denial BEFORE invocation (never a silent overrun).
 *     The fabric independently re-enforces the ceiling against providers'
 *     DECLARED costs — layered defense, both semantics reused, not duplicated.
 *  4. ROUTE through the fabric with an explicit synthesized `ModelPolicy`
 *     (task registry + router + gateway semantics: privacy class, provider
 *     fallback, per-provider timeout, declared-cost budget, tracing). The
 *     trace on the receipt is the FABRIC's own `InvocationTrace` — reused,
 *     never reconstructed.
 *  5. REALIZE (composing tasks only): the subtitle task composes cues from
 *     the provider's translation output via the pure builders; a provider
 *     that violates its output contract surfaces as a typed `fabric`
 *     provider-error carrying the trace — never fake success.
 *
 * Privacy default: when the caller provides no privacy class, the pipeline
 * synthesizes `local-only` (fail-closed — user media never leaves the machine
 * unless the caller explicitly opts into a cloud class), with an empty
 * fallback plan unless providers are named. This is deliberate and stricter
 * than the gateway's own no-policy default (`any-cloud`): the pipeline is a
 * production caller and always passes an explicit policy.
 *
 * The receipt on success: output, provider used, deterministic cost and
 * duration estimates, the permission verdict echo, and the fabric trace.
 */

import type { ModelPolicy } from "@wfx/domain";
import { previewValue } from "@wfx/domain";

import type { FabricInvocationContext, ModelFabric } from "../fabric";
import { isModelPolicyPrivacy, providerError, type FabricError, type InvocationTrace } from "../types";
import { TransformationPermissions, type PermissionVerdict } from "./permissions";
import type {
  BaseTransformationInput,
  TransformationTaskDescriptor,
  TransformationTaskKind,
  ValidationIssue,
} from "./tasks";

// ---------------------------------------------------------------------------
// Run options
// ---------------------------------------------------------------------------

/** Per-invocation options for {@link runTransformation}. */
export interface TransformationRunOptions {
  /**
   * Privacy class for the fabric policy. Default `'local-only'`
   * (fail-closed): cloud providers are never routed unless the caller opts
   * in via `'trusted-cloud'` / `'any-cloud'`.
   */
  privacy?: ModelPolicy["privacy"];
  /** Preferred provider id — attempted first. */
  preferredProvider?: string;
  /** Fallback provider ids, attempted in order after the preferred. Default: none. */
  fallbackProviders?: string[];
  /**
   * Cost ceiling in abstract cost units. The pipeline denies (typed) BEFORE
   * invocation when the deterministic estimate exceeds it; the fabric
   * additionally enforces it against providers' declared costs.
   */
  maxCostPerOperation?: number;
  /** Per-provider timeout override in milliseconds. */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Result envelope
// ---------------------------------------------------------------------------

/** The success artifact of a transformation run. */
export interface TransformationReceipt<TOutput> {
  ok: true;
  /** The task kind that ran. */
  task: TransformationTaskKind;
  /** The realized task output. */
  output: TOutput;
  /** The provider that produced the terminal outcome (from the fabric trace). */
  providerId: string;
  /** The task's DETERMINISTIC cost estimate (abstract units), computed pre-flight. */
  costEstimate: number;
  /** The task's DETERMINISTIC processing-duration estimate (ms). */
  durationEstimateMs: number;
  /** The permission verdict that gated the run (echoed verbatim). */
  permission: PermissionVerdict;
  /** The fabric's own invocation trace — reused, never duplicated. */
  trace: InvocationTrace;
}

/**
 * The closed error union of the transformation pipeline:
 * - `validation`    — malformed options or task input, with FIELD-PATH issues.
 * - `permission`    — denied by the permission authority; verdict echoed.
 * - `cost-ceiling`  — deterministic estimate exceeds the policy ceiling.
 * - `fabric`        — a fabric failure (provider/timeout/policy/privacy/
 *                     cost/no-provider), carrying the `FabricError` and the
 *                     fabric trace when a provider was actually invoked.
 */
export type TransformationError =
  | { kind: "validation"; task: TransformationTaskKind; issues: readonly ValidationIssue[] }
  | { kind: "permission"; task: TransformationTaskKind; verdict: PermissionVerdict }
  | { kind: "cost-ceiling"; task: TransformationTaskKind; estimate: number; ceiling: number }
  | { kind: "fabric"; task: TransformationTaskKind; error: FabricError; trace?: InvocationTrace };

/** The result envelope of {@link runTransformation}. */
export type TransformationResult<TOutput> =
  | TransformationReceipt<TOutput>
  | { ok: false; error: TransformationError };

// ---------------------------------------------------------------------------
// Options validation (typed, field-path)
// ---------------------------------------------------------------------------

function validateRunOptions(options: TransformationRunOptions | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (options === undefined) return issues;

  if (options.privacy !== undefined && !isModelPolicyPrivacy(options.privacy)) {
    issues.push({
      path: "options.privacy",
      message: `expected 'local-only', 'trusted-cloud', or 'any-cloud', got ${previewValue(options.privacy)}`,
    });
  }
  if (
    options.preferredProvider !== undefined &&
    (typeof options.preferredProvider !== "string" || options.preferredProvider.trim().length === 0)
  ) {
    issues.push({
      path: "options.preferredProvider",
      message: `expected a non-empty string, got ${previewValue(options.preferredProvider)}`,
    });
  }
  if (
    options.fallbackProviders !== undefined &&
    (!Array.isArray(options.fallbackProviders) ||
      !options.fallbackProviders.every((id) => typeof id === "string" && id.trim().length > 0))
  ) {
    issues.push({
      path: "options.fallbackProviders",
      message: `expected an array of non-empty provider ids, got ${previewValue(options.fallbackProviders)}`,
    });
  }
  if (
    options.maxCostPerOperation !== undefined &&
    (typeof options.maxCostPerOperation !== "number" ||
      !Number.isFinite(options.maxCostPerOperation) ||
      options.maxCostPerOperation < 0)
  ) {
    issues.push({
      path: "options.maxCostPerOperation",
      message: `expected a finite non-negative number, got ${previewValue(options.maxCostPerOperation)}`,
    });
  }
  if (
    options.timeoutMs !== undefined &&
    (typeof options.timeoutMs !== "number" || !Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
  ) {
    issues.push({
      path: "options.timeoutMs",
      message: `expected a positive finite number, got ${previewValue(options.timeoutMs)}`,
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * Run a transformation task through the Model Fabric with permission
 * enforcement. `input` is UNTRUSTED: it is validated against the task schema
 * (typed field-path errors) before anything else touches it.
 */
export async function runTransformation<
  TInput extends BaseTransformationInput,
  TFabricOutput,
  TOutput,
>(
  fabric: ModelFabric,
  task: TransformationTaskDescriptor<TInput, TFabricOutput, TOutput>,
  input: unknown,
  options?: TransformationRunOptions,
): Promise<TransformationResult<TOutput>> {
  // --- 1a. options validation (caller contract, fail fast) ----------------
  const optionIssues = validateRunOptions(options);
  if (optionIssues.length > 0) {
    return { ok: false, error: { kind: "validation", task: task.kind, issues: optionIssues } };
  }

  // --- 1b. input validation against the task schema ------------------------
  const validated = task.validate(input);
  if (!validated.ok) {
    return { ok: false, error: { kind: "validation", task: task.kind, issues: validated.issues } };
  }
  const value: TInput = validated.value;

  // --- 2. permission check FIRST (fabric never invoked on denial) ----------
  const verdict = TransformationPermissions.check(value.media, task);
  if (!verdict.allowed) {
    return { ok: false, error: { kind: "permission", task: task.kind, verdict } };
  }

  // --- 3. deterministic cost estimate vs the policy ceiling -----------------
  const costEstimate = task.estimateCost(value);
  const ceiling = options?.maxCostPerOperation;
  if (ceiling !== undefined && costEstimate > ceiling) {
    return {
      ok: false,
      error: { kind: "cost-ceiling", task: task.kind, estimate: costEstimate, ceiling },
    };
  }

  // --- 4. synthesize the explicit fabric policy (fail-closed defaults) ------
  const policy: ModelPolicy = {
    task: task.modelTask,
    fallbackProviders: options?.fallbackProviders ?? [],
    privacy: options?.privacy ?? "local-only",
    ...(options?.preferredProvider !== undefined
      ? { preferredProvider: options.preferredProvider }
      : {}),
    ...(ceiling !== undefined ? { maxCostPerOperation: ceiling } : {}),
  };
  const context: FabricInvocationContext | undefined =
    options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : undefined;

  // --- 5. fabric invocation (registry + router + gateway semantics) ---------
  const fabricResult = await fabric.invoke<TInput, TFabricOutput>(
    task.modelTask,
    value,
    policy,
    context,
  );
  if (!fabricResult.ok) {
    return {
      ok: false,
      error:
        fabricResult.trace === undefined
          ? { kind: "fabric", task: task.kind, error: fabricResult.error }
          : { kind: "fabric", task: task.kind, error: fabricResult.error, trace: fabricResult.trace },
    };
  }

  // --- 6. realize (composing tasks only) ------------------------------------
  let output: TOutput;
  if (task.realize !== undefined) {
    const realized = task.realize(fabricResult.value, value);
    if (!realized.ok) {
      return {
        ok: false,
        error: {
          kind: "fabric",
          task: task.kind,
          error: providerError(
            fabricResult.trace.providerId,
            `violated the ${task.kind} output contract: ${realized.issues.join("; ")}`,
          ),
          trace: fabricResult.trace,
        },
      };
    }
    output = realized.value;
  } else {
    // realize absent ⇒ the descriptor was constructed with TOutput = TFabricOutput.
    output = fabricResult.value as unknown as TOutput;
  }

  // --- 7. receipt -------------------------------------------------------------
  return {
    ok: true,
    task: task.kind,
    output,
    providerId: fabricResult.trace.providerId,
    costEstimate,
    durationEstimateMs: task.estimateDurationMs(value),
    permission: verdict,
    trace: fabricResult.trace,
  };
}

// ---------------------------------------------------------------------------
// Human-readable summaries
// ---------------------------------------------------------------------------

/**
 * Render a one-line, human-readable summary of a typed transformation error.
 * Always names the kind so a degraded rendering is never mistaken for
 * success (`describeFabricError` / `describeConnectorError` precedent).
 */
export function describeTransformationError(error: TransformationError): string {
  switch (error.kind) {
    case "validation":
      return `validation: ${error.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`;
    case "permission":
      return `permission: ${error.verdict.reason}`;
    case "cost-ceiling":
      return `cost-ceiling: deterministic estimate ${error.estimate} exceeds the policy ceiling ${error.ceiling} — denied before invocation`;
    case "fabric":
      return `fabric: ${error.error.kind} (task '${error.task}')`;
  }
}
