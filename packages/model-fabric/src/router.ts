/**
 * @wfx/model-fabric — the policy router (WFX-030, Lane A).
 *
 * `ModelRouter.route(task, policy)` resolves the ordered route plan for an
 * invocation: `[preferredProvider?] + fallbackProviders` from the policy,
 * filtered by
 *
 * (a) CAPABILITY — the provider must be registered and declare `task`.
 * (b) PRIVACY   — a `local-only` policy excludes every provider not
 *                 registered with `privacy: 'local'`. `trusted-cloud` and
 *                 `any-cloud` perform NO exclusion here: provider metadata
 *                 (WFX-030) has no trust tier, so trusted vs. any cloud is
 *                 not yet distinguishable at routing time — an explicit,
 *                 documented limitation that concrete cloud providers
 *                 (later work items) will resolve by extending registration
 *                 metadata. Fail-closed behavior for local-only is the part
 *                 the privacy boundary depends on, and it is enforced here
 *                 AND again in the gateway (defense in depth).
 * (c) COST      — a provider whose DECLARED `costPerOperation(task)` exceeds
 *                 `policy.maxCostPerOperation` is excluded. Undeclared costs
 *                 are never excluded.
 *
 * An empty plan is a legal result (the gateway turns it into a typed
 * `no-provider` error at invoke time — routing itself never invents
 * providers). Route-level policy misuse (task mismatch, invalid privacy
 * value) THROWS: `route` is a planning seam, not an envelope; the gateway
 * validates policies first and answers with typed `policy` errors.
 */

import type { ModelPolicy, ModelTask } from "@wfx/domain";

import {
  declaredCostFor,
  type ProviderDirectory,
  type RegisteredModelProvider,
} from "./registry";
import { isModelPolicyPrivacy } from "./types";

// ---------------------------------------------------------------------------
// Route plan
// ---------------------------------------------------------------------------

/** One entry of a route plan: a provider the gateway may attempt. */
export interface RoutePlanEntry {
  /** The registered provider id. */
  providerId: string;
  /** The provider's registration privacy (informational copy from the registry). */
  privacy: RegisteredModelProvider["privacy"];
  /**
   * The provider's declared cost for the routed task; ABSENT when the
   * provider declares no cost for it. Informational copy from the registry —
   * the gateway re-reads live registration data before enforcing budgets.
   */
  declaredCost?: number;
}

/**
 * The ordered route plan: `[preferred? + fallbacks]` after capability,
 * privacy, and cost filtering. `entries` is empty when no listed provider is
 * eligible — the gateway answers that with a typed `no-provider` error.
 */
export interface RoutePlan {
  task: ModelTask;
  entries: readonly RoutePlanEntry[];
}

/**
 * The planning seam the gateway depends on. `ModelRouter` satisfies it
 * structurally; the gateway accepts any planner (its own re-validation is
 * the defense in depth).
 */
export interface RoutePlanner {
  route(task: ModelTask, policy: ModelPolicy): RoutePlan;
}

// ---------------------------------------------------------------------------
// Route-level policy errors (programmer errors — planning-seam misuse)
// ---------------------------------------------------------------------------

/**
 * Thrown by `route()` when the policy cannot be planned: a task/privacy
 * mismatch. The gateway never hits this (it answers typed `policy` errors
 * first); direct router users get a loud failure instead of a nonsense plan.
 */
export class RoutePolicyError extends Error {
  constructor(detail: string) {
    super(`RoutePolicyError: ${detail}`);
    this.name = "RoutePolicyError";
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * The policy router: resolves `[preferred? + fallbacks]` (deduplicated, in
 * policy order) against the registry, applying capability, privacy, and cost
 * filters. Pure planning — no invocation, no I/O, no provider calls beyond
 * reading registration metadata.
 */
export class ModelRouter implements RoutePlanner {
  private readonly directory: ProviderDirectory;

  constructor(directory: ProviderDirectory) {
    if (typeof (directory as { get?: unknown }).get !== "function") {
      throw new Error("ModelRouter: directory must expose get(id)");
    }
    if (typeof (directory as { providersFor?: unknown }).providersFor !== "function") {
      throw new Error("ModelRouter: directory must expose providersFor(task)");
    }
    this.directory = directory;
  }

  /**
   * Resolve the ordered route plan for `task` under `policy`.
   *
   * @throws RoutePolicyError when `policy.task` does not match `task` or
   *         `policy.privacy` is not a frozen privacy value.
   */
  route(task: ModelTask, policy: ModelPolicy): RoutePlan {
    if (policy.task !== task) {
      throw new RoutePolicyError(
        `policy.task '${policy.task}' does not match the routed task '${task}'`,
      );
    }
    if (!isModelPolicyPrivacy(policy.privacy)) {
      throw new RoutePolicyError(
        `policy.privacy must be 'local-only', 'trusted-cloud', or 'any-cloud', got '${String(policy.privacy)}'`,
      );
    }

    // Candidate order: preferred first, then fallbacks, first occurrence wins.
    const orderedIds: string[] = [];
    const seen = new Set<string>();
    const pushId = (id: string | undefined): void => {
      if (id === undefined || seen.has(id)) return;
      seen.add(id);
      orderedIds.push(id);
    };
    pushId(policy.preferredProvider);
    for (const id of policy.fallbackProviders) {
      pushId(id);
    }

    const entries: RoutePlanEntry[] = [];
    for (const providerId of orderedIds) {
      const provider = this.directory.get(providerId);
      if (provider === undefined) continue; // not registered — cannot serve
      if (!provider.capabilities.includes(task)) continue; // capability filter
      if (
        policy.privacy === "local-only" &&
        provider.privacy !== "local"
      ) {
        continue; // privacy filter — local-only never routes to cloud
      }
      const declaredCost = declaredCostFor(provider, task);
      if (
        policy.maxCostPerOperation !== undefined &&
        declaredCost !== undefined &&
        declaredCost > policy.maxCostPerOperation
      ) {
        continue; // cost filter — declared cost exceeds the policy ceiling
      }
      entries.push(
        declaredCost === undefined
          ? { providerId, privacy: provider.privacy }
          : { providerId, privacy: provider.privacy, declaredCost },
      );
    }

    return { task, entries };
  }
}
