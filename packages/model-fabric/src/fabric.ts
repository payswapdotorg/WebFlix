/**
 * @wfx/model-fabric — the gateway (WFX-030, Lane A).
 *
 * `ModelFabric.invoke(task, input, policy?, context?)` is the provider-neutral
 * model gateway required by the frozen architecture: it resolves the route
 * plan (router), tries providers in order, enforces a per-provider timeout
 * (default 30s, overridable), records the invocation trace, falls back on
 * provider-error/timeout, and answers the FIRST success with the full
 * fallback chain recorded in the trace.
 *
 * Enforcement layers (router plans, gateway guarantees — defense in depth):
 *
 * - PRIVACY: for `local-only` policies the router excludes cloud providers;
 *   the gateway re-checks the plan against the registry BEFORE any attempt
 *   and refuses with a typed `privacy` error if a cloud provider slipped in
 *   (broken/injected planner). Fail closed: nothing is invoked, not even the
 *   local providers in the plan. Provider credentials never enter model
 *   prompts — the gateway has no credential surface at all.
 * - COST: the router excludes providers whose declared cost exceeds
 *   `maxCostPerOperation`; the gateway additionally tracks the SUM of
 *   declared costs across attempted providers and SKIPS a provider when
 *   attempting it would exceed the budget (this also covers cost drift
 *   between planning and execution). A typed `cost` error is returned only
 *   when every provider was skipped and none was attempted; otherwise the
 *   last provider failure surfaces.
 * - CAPABILITY: plan entries whose provider is unregistered (stale plan) or
 *   no longer declares the task are skipped — the gateway never invokes a
 *   provider for a task it did not declare.
 *
 * Operational failures are typed `FabricError` values carrying the trace —
 * never swallowed, never converted into fake success. Timeouts bound how
 * long the gateway WAITS; the underlying provider promise is not cancelled
 * (its eventual result is discarded and its rejection is always handled).
 */

import type { ModelPolicy, ModelTask } from "@wfx/domain";

import { declaredCostFor, type ProviderDirectory } from "./registry";
import { ModelRouter, type RoutePlan, type RoutePlanner } from "./router";
import {
  costError,
  isModelPolicyPrivacy,
  newInvocationId,
  noProvider,
  policyError,
  privacyError,
  providerError,
  timeoutError,
  type FabricResult,
  type InvocationTrace,
  type ProviderError,
  type TimeoutError,
} from "./types";

// ---------------------------------------------------------------------------
// Options & context
// ---------------------------------------------------------------------------

/** The default per-provider timeout: 30 seconds (WFX-030 packet). */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;

/** Construction options for {@link ModelFabric}. */
export interface ModelFabricOptions {
  /**
   * Default per-provider timeout in milliseconds (default 30000). Must be a
   * positive finite number.
   */
  defaultTimeoutMs?: number;
  /**
   * Route planner seam. Defaults to a `ModelRouter` over the registry.
   * Injection exists so tests (and only tests) can verify the gateway's
   * defense-in-depth re-validation against a broken planner — the gateway
   * NEVER trusts the plan over the registry.
   */
  router?: RoutePlanner;
}

/**
 * Per-invocation context. Intentionally minimal in WFX-030: the timeout
 * override. Later work items (authorization-boundary checks, correlation
 * ids) extend this interface — it is the explicit extension point.
 */
export interface FabricInvocationContext {
  /**
   * Overrides the per-provider timeout for THIS invocation. Must be a
   * positive finite number; invalid values answer a typed `policy` error.
   */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Provider attempt machinery
// ---------------------------------------------------------------------------

/** The outcome of one provider attempt, timeout-raced. */
type AttemptOutcome<T> =
  | { kind: "success"; value: T }
  | { kind: "error"; error: unknown }
  | { kind: "timeout" };

/**
 * Race one provider attempt against its deadline. The thunk form maps a
 * SYNCHRONOUS throw out of `invoke()` to a provider error (never an escape
 * from the gateway). Both promise callbacks are attached immediately, so a
 * post-timeout rejection is always handled — no unhandled rejections.
 */
async function raceAttempt<T>(
  start: () => Promise<T>,
  timeoutMs: number,
): Promise<AttemptOutcome<T>> {
  let promise: Promise<T>;
  try {
    promise = start();
  } catch (error) {
    return { kind: "error", error };
  }
  return new Promise<AttemptOutcome<T>>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (outcome: AttemptOutcome<T>): void => {
      if (timer !== undefined) clearTimeout(timer);
      resolve(outcome);
    };
    timer = setTimeout(() => settle({ kind: "timeout" }), timeoutMs);
    promise.then(
      (value) => settle({ kind: "success", value }),
      (error) => settle({ kind: "error", error }),
    );
  });
}

/** Provider failure detail: the provider's message, bounded, never the input. */
function providerErrorMessage(error: unknown): string {
  let message: string;
  if (error instanceof Error) {
    message = error.message.length > 0 ? error.message : String(error);
  } else {
    message = String(error);
  }
  return message.length > 200 ? `${message.slice(0, 197)}...` : message;
}

// ---------------------------------------------------------------------------
// The gateway
// ---------------------------------------------------------------------------

/**
 * The provider-neutral model gateway. Resolve → enforce → attempt → trace:
 * one `invoke` runs at most one provider at a time, in route-plan order.
 */
export class ModelFabric {
  private readonly directory: ProviderDirectory;
  private readonly planner: RoutePlanner;
  private readonly defaultTimeoutMs: number;

  /**
   * @throws Error when `defaultTimeoutMs` is not a positive finite number or
   *         the injected router is not a planner (wiring-time programmer
   *         errors, fail fast).
   */
  constructor(directory: ProviderDirectory, options: ModelFabricOptions = {}) {
    if (typeof (directory as { get?: unknown }).get !== "function") {
      throw new Error("ModelFabric: directory must expose get(id)");
    }
    if (typeof (directory as { providersFor?: unknown }).providersFor !== "function") {
      throw new Error("ModelFabric: directory must expose providersFor(task)");
    }
    this.defaultTimeoutMs =
      options.defaultTimeoutMs === undefined
        ? DEFAULT_PROVIDER_TIMEOUT_MS
        : options.defaultTimeoutMs;
    if (!Number.isFinite(this.defaultTimeoutMs) || this.defaultTimeoutMs <= 0) {
      throw new Error(
        `ModelFabric: defaultTimeoutMs must be a positive finite number, got ${options.defaultTimeoutMs}`,
      );
    }
    this.planner = options.router ?? new ModelRouter(directory);
    if (typeof (this.planner as { route?: unknown }).route !== "function") {
      throw new Error("ModelFabric: injected router must expose route(task, policy)");
    }
    this.directory = directory;
  }

  /**
   * Invoke the model fabric for `task` with `input`.
   *
   * Policy handling:
   * - A provided policy is validated at runtime (task match, privacy value,
   *   cost ceiling, fallback list shape); violations answer a typed `policy`
   *   error.
   * - WITHOUT a policy, the gateway synthesizes the default policy: every
   *   provider registered for the task, in registration order, privacy
   *   `any-cloud`, no cost ceiling — the CALLER owns the privacy decision.
   *   Production callers should always pass an explicit `ModelPolicy`
   *   derived from user privacy settings.
   *
   * Providers are attempted in route-plan order. The first success wins; its
   * trace records the failed fallback chain. Provider errors and timeouts
   * (and the full chain) surface as typed `FabricError`s carrying the trace.
   */
  async invoke<TIn, TOut>(
    task: ModelTask,
    input: TIn,
    policy?: ModelPolicy,
    context?: FabricInvocationContext,
  ): Promise<FabricResult<TOut>> {
    const invocationId = newInvocationId();
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();

    // --- timeout resolution -------------------------------------------------
    let timeoutMs = this.defaultTimeoutMs;
    if (context?.timeoutMs !== undefined) {
      if (!Number.isFinite(context.timeoutMs) || context.timeoutMs <= 0) {
        return {
          ok: false,
          error: policyError(
            `context.timeoutMs must be a positive finite number, got ${context.timeoutMs}`,
          ),
        };
      }
      timeoutMs = context.timeoutMs;
    }

    // --- policy validation (typed policy errors, never throws) --------------
    if (policy !== undefined) {
      if (policy.task !== task) {
        return {
          ok: false,
          error: policyError(
            `policy.task '${policy.task}' does not match the invocation task '${task}'`,
          ),
        };
      }
      if (!isModelPolicyPrivacy(policy.privacy)) {
        return {
          ok: false,
          error: policyError(
            `policy.privacy must be 'local-only', 'trusted-cloud', or 'any-cloud', got '${String(policy.privacy)}'`,
          ),
        };
      }
      if (
        policy.maxCostPerOperation !== undefined &&
        (!Number.isFinite(policy.maxCostPerOperation) || policy.maxCostPerOperation < 0)
      ) {
        return {
          ok: false,
          error: policyError(
            `policy.maxCostPerOperation must be a finite non-negative number when present, got ${policy.maxCostPerOperation}`,
          ),
        };
      }
      if (!Array.isArray(policy.fallbackProviders)) {
        return {
          ok: false,
          error: policyError(
            `policy.fallbackProviders must be an array of provider ids, got '${String(policy.fallbackProviders)}'`,
          ),
        };
      }
    }

    // --- route resolution ----------------------------------------------------
    const effectivePolicy: ModelPolicy =
      policy === undefined
        ? {
            task,
            fallbackProviders: this.directory.providersFor(task).map((provider) => provider.id),
            privacy: "any-cloud",
          }
        : policy;
    const plan: RoutePlan = this.planner.route(task, effectivePolicy);

    // --- privacy defense in depth (fail closed BEFORE any attempt) -----------
    if (effectivePolicy.privacy === "local-only") {
      const cloudIds: string[] = [];
      for (const entry of plan.entries) {
        const provider = this.directory.get(entry.providerId);
        if (provider !== undefined && provider.privacy === "cloud") {
          cloudIds.push(provider.id);
        }
      }
      if (cloudIds.length > 0) {
        return {
          ok: false,
          error: privacyError(
            `local-only policy: route plan includes cloud provider(s) ${cloudIds.join(", ")} — refusing to invoke anything (defense in depth)`,
          ),
        };
      }
    }

    // --- attempt loop: ordered, timeout-raced, budget-guarded -----------------
    const budget = effectivePolicy.maxCostPerOperation;
    const attempted: Array<{
      providerId: string;
      failure: ProviderError | TimeoutError;
    }> = [];
    const costSkippedIds: string[] = [];
    let spent = 0;
    let anyCostDeclared = false;

    for (const entry of plan.entries) {
      const provider = this.directory.get(entry.providerId);
      if (provider === undefined) continue; // stale/ghost plan entry — never invoked
      if (!provider.capabilities.includes(task)) continue; // capability re-check

      const declaredCost = declaredCostFor(provider, task);
      if (
        budget !== undefined &&
        declaredCost !== undefined &&
        spent + declaredCost > budget
      ) {
        costSkippedIds.push(provider.id);
        continue; // attempting would exceed the budget — skip BEFORE the attempt
      }

      const outcome = await raceAttempt(
        () => provider.invoke<TIn, TOut>(task, input),
        timeoutMs,
      );

      if (outcome.kind === "success") {
        const durationMs = Date.now() - startedAtMs;
        const fallbacks = attempted.map((attempt) => attempt.providerId);
        const totalCost = spent + (declaredCost ?? 0);
        const trace: InvocationTrace =
          anyCostDeclared || declaredCost !== undefined
            ? {
                invocationId,
                taskId: task,
                providerId: provider.id,
                startedAt,
                durationMs,
                cost: totalCost,
                fallbacks,
              }
            : {
                invocationId,
                taskId: task,
                providerId: provider.id,
                startedAt,
                durationMs,
                fallbacks,
              };
        return { ok: true, value: outcome.value, trace };
      }

      const failure: ProviderError | TimeoutError =
        outcome.kind === "timeout"
          ? timeoutError(provider.id, timeoutMs)
          : providerError(provider.id, providerErrorMessage(outcome.error));
      attempted.push({ providerId: provider.id, failure });
      if (declaredCost !== undefined) {
        spent += declaredCost;
        anyCostDeclared = true;
      }
    }

    // --- terminal failure: last attempt's error, with the full chain ---------
    const durationMs = Date.now() - startedAtMs;
    const lastAttempt =
      attempted.length > 0 ? attempted[attempted.length - 1] : undefined;
    if (lastAttempt !== undefined) {
      const fallbacks = attempted.slice(0, -1).map((attempt) => attempt.providerId);
      const trace: InvocationTrace = anyCostDeclared
        ? {
            invocationId,
            taskId: task,
            providerId: lastAttempt.providerId,
            startedAt,
            durationMs,
            cost: spent,
            fallbacks,
          }
        : {
            invocationId,
            taskId: task,
            providerId: lastAttempt.providerId,
            startedAt,
            durationMs,
            fallbacks,
          };
      return { ok: false, error: lastAttempt.failure, trace };
    }

    // --- nothing attempted: cost-skipped, or simply no provider ---------------
    if (costSkippedIds.length > 0 && budget !== undefined) {
      // Every candidate was skipped before any attempt (spent is 0 here by
      // construction — attempts would have taken the branch above).
      return { ok: false, error: costError(budget, spent) };
    }
    return { ok: false, error: noProvider(task) };
  }
}
