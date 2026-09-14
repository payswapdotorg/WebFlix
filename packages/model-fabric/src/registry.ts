/**
 * @wfx/model-fabric — the provider registry (WFX-030, Lane A).
 *
 * The single place that answers "which model providers exist, where do they
 * run, what tasks do they declare, and what do they cost?". NO real providers
 * are registered by this package: concrete cloud/local providers arrive in
 * later work items. This registry is the routing/policy machinery only.
 *
 * Registration extension to the frozen `ModelProvider` (documented per the
 * WFX-030 packet): providers register with
 *
 * - `privacy: 'local' | 'cloud'` — WHERE the provider runs. `'local'` means
 *   the model executes on the user's device or a local process (input never
 *   leaves the machine); `'cloud'` means input is sent to a remote service.
 *   This is the field the router's local-only filter and the gateway's
 *   defense-in-depth privacy check key on.
 * - `costPerOperation(task)` — the provider's DECLARED cost for one operation
 *   of a task, in abstract cost units (the same units as
 *   `ModelPolicy.maxCostPerOperation`). Returns `undefined` when the provider
 *   declares no cost for that task: no cost exclusion, no cost accounting
 *   contribution. Runtime-invalid values (non-number, non-finite, negative)
 *   are sanitized to "undeclared" (see `declaredCostFor`) — they never crash
 *   routing and never silently become zero.
 *
 * Providers are contractually immutable after registration: mutating a
 * registered provider's `capabilities` array leaves the capability index
 * stale. The router re-checks live capabilities at plan time and the gateway
 * re-checks again before every attempt, so invocation correctness does not
 * depend on index freshness; `providersFor` freshness is the caller's
 * contract. Duplicate ids throw — ids are stable identities, never slots to
 * be overwritten (connectors registry precedent).
 */

import type { ModelProvider, ModelTask } from "@wfx/domain";

import { isModelTask, MODEL_TASKS } from "./types";

// ---------------------------------------------------------------------------
// Registration surface
// ---------------------------------------------------------------------------

/**
 * Where a provider executes. `'local'` = on-device / local process (input
 * never leaves the machine). `'cloud'` = remote service.
 */
export type ModelProviderPrivacy = "local" | "cloud";

/**
 * A `ModelProvider` as registered with the fabric: the frozen provider
 * surface plus the registration metadata (privacy, declared costs) that
 * routing, privacy, and cost accounting key on.
 */
export interface RegisteredModelProvider extends ModelProvider {
  /** Registration metadata: where the provider runs. */
  privacy: ModelProviderPrivacy;
  /**
   * The declared cost of one operation of `task`, in abstract cost units
   * (same units as `ModelPolicy.maxCostPerOperation`); `undefined` = no
   * declared cost (no cost constraint, no accounting contribution).
   */
  costPerOperation(task: ModelTask): number | undefined;
}

// ---------------------------------------------------------------------------
// Thrown registration errors (programmer errors — wiring bugs, not envelope values)
// ---------------------------------------------------------------------------

/** Thrown when registering a provider id that is already registered. */
export class DuplicateProviderError extends Error {
  public readonly id: string;

  constructor(id: string) {
    super(
      `model provider '${id}' is already registered — provider ids are stable and must be unique`,
    );
    this.name = "DuplicateProviderError";
    this.id = id;
  }
}

/** Thrown when a provider registration fails structural validation. */
export class InvalidProviderRegistrationError extends Error {
  constructor(issues: readonly string[]) {
    super(`invalid model provider registration: ${issues.join("; ")}`);
    this.name = "InvalidProviderRegistrationError";
  }
}

// ---------------------------------------------------------------------------
// Directory surface (the minimal registry shape router + gateway depend on)
// ---------------------------------------------------------------------------

/**
 * The minimal registry surface consumed by the router and the gateway.
 * `ModelFabricRegistry` satisfies it structurally; the interface exists so
 * the gateway depends on a seam, not a concrete class.
 */
export interface ProviderDirectory {
  /** The provider registered under `id`, or `undefined` for unknown ids. */
  get(id: string): RegisteredModelProvider | undefined;
  /** Providers registered for `task`, in registration order. */
  providersFor(task: ModelTask): readonly RegisteredModelProvider[];
}

// ---------------------------------------------------------------------------
// Declared-cost semantics
// ---------------------------------------------------------------------------

/**
 * The declared cost of one `task` operation, sanitized: non-number,
 * non-finite, or negative values are treated as UNDECLARED (undefined). The
 * single source of truth for cost semantics across router and gateway.
 */
export function declaredCostFor(
  provider: RegisteredModelProvider,
  task: ModelTask,
): number | undefined {
  const raw = provider.costPerOperation(task);
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
  return raw;
}

// ---------------------------------------------------------------------------
// describe(): the id × task matrix
// ---------------------------------------------------------------------------

/** One provider row of the id × task matrix (registration order). */
export interface ProviderSummary {
  id: string;
  privacy: ModelProviderPrivacy;
  capabilities: readonly ModelTask[];
}

/**
 * The registry as an id × task matrix:
 * - `providers` — one row per registered provider, in registration order.
 * - `byTask` — task-major view: EVERY frozen ModelTask maps to the ids
 *   registered for it (empty list when none), in registration order.
 */
export interface ModelFabricDescription {
  providers: readonly ProviderSummary[];
  byTask: Readonly<Record<ModelTask, readonly string[]>>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * The model fabric provider registry. Register providers with capability
 * indexing by ModelTask, query them by task or id, and render the id × task
 * matrix. Registration shape failures and duplicate ids throw (programmer
 * errors); the registry never fabricates providers and never silently
 * overwrites an id.
 */
export class ModelFabricRegistry implements ProviderDirectory {
  private readonly byId = new Map<string, RegisteredModelProvider>();
  private readonly byTask = new Map<ModelTask, RegisteredModelProvider[]>();

  /** Number of registered providers. */
  size(): number {
    return this.byId.size;
  }

  /**
   * Register a provider, indexing it under every declared capability.
   *
   * @throws InvalidProviderRegistrationError when the registration is
   *         malformed (empty id, non-function invoke/costPerOperation,
   *         invalid privacy, capabilities that are not frozen ModelTasks).
   * @throws DuplicateProviderError when the id is already registered.
   */
  register(provider: RegisteredModelProvider): this {
    const issues: string[] = [];

    if (
      typeof provider !== "object" ||
      provider === null ||
      typeof (provider as { id?: unknown }).id !== "string" ||
      (provider as { id: string }).id.length === 0
    ) {
      issues.push("id must be a non-empty string");
    }
    const capabilities = (provider as { capabilities?: unknown }).capabilities;
    if (
      !Array.isArray(capabilities) ||
      !capabilities.every((task) => isModelTask(task))
    ) {
      issues.push(`capabilities must be an array of ModelTask values, got ${safePreview(capabilities)}`);
    }
    const privacy = (provider as { privacy?: unknown }).privacy;
    if (privacy !== "local" && privacy !== "cloud") {
      issues.push(`privacy must be 'local' or 'cloud', got ${safePreview(privacy)}`);
    }
    if (typeof (provider as { invoke?: unknown }).invoke !== "function") {
      issues.push("invoke must be a function");
    }
    if (typeof (provider as { costPerOperation?: unknown }).costPerOperation !== "function") {
      issues.push("costPerOperation must be a function");
    }

    if (issues.length > 0) throw new InvalidProviderRegistrationError(issues);

    const id = (provider as { id: string }).id;
    if (this.byId.has(id)) throw new DuplicateProviderError(id);

    this.byId.set(id, provider);
    for (const task of capabilities as ModelTask[]) {
      const list = this.byTask.get(task);
      if (list === undefined) {
        this.byTask.set(task, [provider]);
      } else {
        list.push(provider);
      }
    }
    return this;
  }

  /** The provider registered under `id`, or `undefined` (unknown id). */
  get(id: string): RegisteredModelProvider | undefined {
    return this.byId.get(id);
  }

  /** Providers registered for `task`, in registration order (defensive copy). */
  providersFor(task: ModelTask): readonly RegisteredModelProvider[] {
    const list = this.byTask.get(task);
    return list === undefined ? [] : [...list];
  }

  /**
   * The id × task matrix: one row per provider (registration order) plus the
   * task-major view covering EVERY frozen ModelTask. Fresh data on every call
   * — mutating the result never corrupts the registry.
   */
  describe(): ModelFabricDescription {
    const providers: ProviderSummary[] = [];
    for (const provider of this.byId.values()) {
      providers.push({
        id: provider.id,
        privacy: provider.privacy,
        capabilities: [...provider.capabilities],
      });
    }

    const byTask: Partial<Record<ModelTask, readonly string[]>> = {};
    for (const task of MODEL_TASKS) {
      byTask[task] = this.providersFor(task).map((provider) => provider.id);
    }

    return { providers, byTask: byTask as Record<ModelTask, readonly string[]> };
  }
}

/** Compact, safe preview of an untrusted value for error messages (never throws). */
function safePreview(value: unknown): string {
  let rendered: string;
  try {
    rendered = JSON.stringify(value) ?? String(value);
  } catch {
    rendered = String(value); // circular structures and other exotic input
  }
  return rendered.length > 60 ? `${rendered.slice(0, 57)}...` : rendered;
}
