/**
 * @wfx/model-fabric — R06 policy validation, effective-policy resolution, and
 * the provider catalog with capability truth (Lane A — intelligence).
 *
 * The CONTROL SURFACE module over the fabric's routing machinery:
 *
 * 1. `validateModelPolicyInput` — TOTAL validation of an untrusted value
 *    against the FROZEN `ModelPolicy` contract (`packages/domain`):
 *    `task` must be a frozen `ModelTask`; `privacy` must be one of the three
 *    frozen classes; `fallbackProviders` must be a NON-EMPTY array of
 *    non-empty provider ids (the contract's own shape law); `preferredProvider`,
 *    when present, a non-empty string; `maxCostPerOperation`, when present, a
 *    finite number >= 0. Problems aggregate with FIELD PATHS — the API's typed
 *    400 channel names EVERY problem in one answer.
 *
 * 2. `resolveEffectiveModelPolicy` — the R06 REPLACEMENT LAW made real: a
 *    BYOM binding REPLACES the first-party route for its tasks. Given the
 *    stored per-profile policy (may be absent), the profile's BYOM bindings,
 *    and the provider registry, resolve the effective policy the fabric
 *    gateway will be invoked with: the BYOM provider for the task becomes the
 *    preferred provider; the stored preferred/fallback chain follows (the
 *    first-party default provider included when the stored policy did not
 *    already cover it); privacy keeps the STORED class (fail-closed: no
 *    stored policy ⇒ `local-only` — user media never leaves the machine
 *    unless the caller explicitly opted into a cloud class); the cost ceiling
 *    keeps the stored value. A BYOM binding whose privacy disagrees with the
 *    stored class (a cloud binding under a `local-only` policy) is NOT
 *    eligible — the resolver reports it honestly and keeps the first-party
 *    route (the local-only law never bends for BYOM).
 *
 * 3. `buildModelProviderCatalog` — the provider registry VIEW the
 *    `GET /experience/model-providers` route serves: first-party,
 *    BYOM-configured, and local-model rows with PER-TASK capability truth
 *    (declared | not-declared, plus declared cost, plus privacy), and the
 *    honest LOCAL availability per task ("local model where supported" — the
 *    architecture's wording: support is reported, never assumed).
 *
 * Purity: no I/O, no clocks, no randomness — the resolver/catalog are pure
 * functions of their arguments (the R05 host-composition precedent).
 */

import type { ModelPolicy, ModelTask } from "@wfx/domain";

import {
  isModelPolicyPrivacy,
  isModelTask,
  MODEL_TASKS,
} from "./types";
import type { ModelProviderPrivacy, RegisteredModelProvider } from "./registry";
import { declaredCostFor } from "./registry";

// ---------------------------------------------------------------------------
// Policy validation (total, field-path problems)
// ---------------------------------------------------------------------------

/** One field-path validation problem (mirrors the transform-tasks convention). */
export interface ModelPolicyProblem {
  /** Dotted path of the offending field (e.g. `fallbackProviders[0]`). */
  path: string;
  /** What is wrong (human-readable, actionable). */
  message: string;
}

/** The typed validation outcome of an untrusted ModelPolicy value. */
export type ModelPolicyValidation =
  | { ok: true; value: ModelPolicy }
  | { ok: false; problems: readonly ModelPolicyProblem[] };

/**
 * The maximum fallback-chain length accepted by the control surface. The
 * frozen contract requires a non-empty list; a bounded ceiling keeps the
 * stored chain (and the route plan derived from it) honest and reviewable.
 */
export const MAX_FALLBACK_PROVIDERS = 8;

/**
 * Validate an untrusted value against the frozen `ModelPolicy` contract.
 * TOTAL: every problem is collected (never one at a time, never thrown).
 * Unknown extra fields are TOLERATED (structural typing, the domain
 * validators' decision) and IGNORED — only declared fields are checked.
 */
export function validateModelPolicyInput(
  x: unknown,
  path = "policy",
): ModelPolicyValidation {
  const problems: ModelPolicyProblem[] = [];
  if (typeof x !== "object" || x === null || Array.isArray(x)) {
    return {
      ok: false,
      problems: [{ path, message: `expected a ModelPolicy object, got ${preview(x)}` }],
    };
  }
  const record = x as Record<string, unknown>;

  // task — the frozen ModelTask union.
  if (!isModelTask(record.task)) {
    problems.push({
      path: `${path}.task`,
      message: `expected one of ${MODEL_TASKS.join(" | ")}, got ${preview(record.task)}`,
    });
  }

  // privacy — the frozen three-class vocabulary.
  if (!isModelPolicyPrivacy(record.privacy)) {
    problems.push({
      path: `${path}.privacy`,
      message: `expected one of local-only | trusted-cloud | any-cloud, got ${preview(record.privacy)}`,
    });
  }

  // fallbackProviders — non-empty array of non-empty provider id strings.
  if (!Array.isArray(record.fallbackProviders)) {
    problems.push({
      path: `${path}.fallbackProviders`,
      message: `expected an array of provider ids, got ${preview(record.fallbackProviders)}`,
    });
  } else if (record.fallbackProviders.length === 0) {
    problems.push({
      path: `${path}.fallbackProviders`,
      message: "expected a NON-EMPTY array (the frozen contract requires a fallback chain)",
    });
  } else if (record.fallbackProviders.length > MAX_FALLBACK_PROVIDERS) {
    problems.push({
      path: `${path}.fallbackProviders`,
      message: `expected at most ${MAX_FALLBACK_PROVIDERS} entries, got ${record.fallbackProviders.length}`,
    });
  } else {
    for (const [index, entry] of record.fallbackProviders.entries()) {
      if (typeof entry !== "string" || entry.trim().length === 0) {
        problems.push({
          path: `${path}.fallbackProviders[${index}]`,
          message: `expected a non-empty provider id, got ${preview(entry)}`,
        });
      }
    }
  }

  // preferredProvider — optional non-empty string.
  if (
    record.preferredProvider !== undefined &&
    (typeof record.preferredProvider !== "string" || record.preferredProvider.trim().length === 0)
  ) {
    problems.push({
      path: `${path}.preferredProvider`,
      message: `expected a non-empty provider id when present, got ${preview(record.preferredProvider)}`,
    });
  }

  // maxCostPerOperation — optional finite non-negative number.
  if (
    record.maxCostPerOperation !== undefined &&
    (typeof record.maxCostPerOperation !== "number" ||
      !Number.isFinite(record.maxCostPerOperation) ||
      record.maxCostPerOperation < 0)
  ) {
    problems.push({
      path: `${path}.maxCostPerOperation`,
      message: `expected a finite number >= 0 when present, got ${preview(record.maxCostPerOperation)}`,
    });
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: x as ModelPolicy };
}

/** Render the typed problems as one human-readable string (the 400 body). */
export function describeModelPolicyProblems(problems: readonly ModelPolicyProblem[]): string {
  return problems.map((problem) => `${problem.path}: ${problem.message}`).join("; ");
}

// ---------------------------------------------------------------------------
// BYOM bindings (the control-surface view of a stored binding)
// ---------------------------------------------------------------------------

/**
 * The secret-free view of one BYOM provider binding the resolver consumes.
 * The durable binding (endpoint + sealed key) lives in the persistence
 * layer; this is the structurally-safe projection the routing lane sees —
 * BYOM keys never enter model prompts, route plans, or logs (the doubled
 * privacy law: keys flow only to the provider transport).
 */
export interface ByomBindingSummary {
  /** The bound provider's id (the route-plan identity). */
  readonly providerId: string;
  /** The fabric privacy the bound provider runs with (from the binding class). */
  readonly privacy: ModelProviderPrivacy;
  /** The frozen ModelTasks this binding serves. */
  readonly tasks: readonly ModelTask[];
}

// ---------------------------------------------------------------------------
// Effective-policy resolution (the R06 replacement law)
// ---------------------------------------------------------------------------

/**
 * The honest report of what the resolver did — the decision record the
 * control surface can surface for review (auditable, never silent).
 */
export interface EffectivePolicyResolution {
  /** The effective policy the fabric gateway will be invoked with. */
  readonly policy: ModelPolicy;
  /**
   * How the preferred provider was chosen — the replacement law's visible
   * verdict:
   * - `"byom-replacement"` — a BYOM binding replaced the first-party route;
   * - `"stored"` — the stored policy's preferred provider stands;
   * - `"first-party-default"` — no stored preference; the first-party
   *   default is preferred;
   * - `"local-only-fallback"` — nothing eligible under the stored class.
   */
  readonly preferredSource: "byom-replacement" | "stored" | "first-party-default" | "local-only-fallback";
  /** BYOM bindings considered, with per-binding eligibility truth. */
  readonly byomConsidered: readonly ByomEligibility[];
}

/** One BYOM binding's eligibility under the stored policy. */
export interface ByomEligibility {
  readonly providerId: string;
  /** Whether the binding participates in the effective route. */
  readonly eligible: boolean;
  /** Why (actionable on every branch — the honesty law). */
  readonly reason: string;
}

/** Options for {@link resolveEffectiveModelPolicy}. */
export interface ResolveEffectiveModelPolicyOptions {
  /** The task the invocation targets (the policy's own task). */
  readonly task: ModelTask;
  /** The stored per-profile policy, when one exists (pre-validated). */
  readonly stored?: ModelPolicy;
  /** The profile's BYOM bindings (secret-free summaries). */
  readonly byomBindings: readonly ByomBindingSummary[];
  /**
   * The registry the route will resolve against — used to keep only
   * REGISTERED providers in the chain (an unregistered id is dead weight;
   * the router would drop it anyway). `providersFor` (when the concrete
   * registry exposes it) feeds the no-policy default's local-provider
   * reach.
   */
  readonly registry: {
    get(id: string): RegisteredModelProvider | undefined;
    providersFor?(task: ModelTask): readonly RegisteredModelProvider[];
  };
  /** The first-party provider id (the default route when nothing replaces it). */
  readonly firstPartyProviderId: string;
}

/**
 * Resolve the effective model policy for one task (the R06 replacement law):
 *
 * - PRIVACY keeps the STORED class; absent a stored policy it is
 *   `local-only` (fail-closed — the transform pipeline's own default law).
 * - A BYOM binding for the task REPLACES the first-party preferred route
 *   when its privacy is compatible with the policy class (a `cloud` binding
 *   under `local-only` is ineligible — the local-only law never bends).
 * - The fallback chain: the stored chain (in order, deduplicated), with the
 *   first-party default appended when it is not already present (the
 *   first-party route is the recoverable floor unless the stored chain
 *   deliberately replaced it via BYOM replacement).
 * - The cost ceiling keeps the stored value (absent ⇒ no ceiling).
 *
 * The returned policy is a NEW object; the stored policy is never mutated.
 */
export function resolveEffectiveModelPolicy(
  options: ResolveEffectiveModelPolicyOptions,
): EffectivePolicyResolution {
  const stored = options.stored;
  const privacy: ModelPolicy["privacy"] = stored?.privacy ?? "local-only";
  const byomConsidered: ByomEligibility[] = [];

  // --- BYOM replacement eligibility ---------------------------------------
  let replacement: ByomBindingSummary | undefined;
  for (const binding of options.byomBindings) {
    if (!binding.tasks.includes(options.task)) continue;
    const registered = options.registry.get(binding.providerId) !== undefined;
    const privacyOk =
      privacy !== "local-only" || binding.privacy === "local";
    if (!registered) {
      byomConsidered.push({
        providerId: binding.providerId,
        eligible: false,
        reason: "the bound provider is not registered with the fabric in this deployment",
      });
      continue;
    }
    if (!privacyOk) {
      byomConsidered.push({
        providerId: binding.providerId,
        eligible: false,
        reason: "a cloud BYOM binding is ineligible under the local-only privacy class — the policy never bends for BYOM",
      });
      continue;
    }
    byomConsidered.push({
      providerId: binding.providerId,
      eligible: true,
      reason: `the binding replaces the first-party route for task '${options.task}'`,
    });
    // First eligible binding wins (bindings are listed in bind order).
    if (replacement === undefined) replacement = binding;
  }

  // --- the ordered candidate chain -----------------------------------------
  const chain: string[] = [];
  const seen = new Set<string>();
  const push = (id: string | undefined): void => {
    if (id === undefined || id.trim().length === 0 || seen.has(id)) return;
    if (options.registry.get(id) === undefined) return; // unregistered — dead weight
    seen.add(id);
    chain.push(id);
  };

  let preferredSource: EffectivePolicyResolution["preferredSource"];
  let preferred: string | undefined;
  if (replacement !== undefined) {
    preferred = replacement.providerId;
    push(replacement.providerId);
    preferredSource = "byom-replacement";
    // The stored chain follows the replacement; the first-party default is
    // the recoverable floor unless the stored chain already covers it.
    for (const id of stored?.fallbackProviders ?? []) push(id);
    if (stored?.preferredProvider !== undefined) push(stored.preferredProvider);
    push(options.firstPartyProviderId);
  } else if (stored !== undefined) {
    // The stored policy's chain leads (its preferred first, then its
    // fallbacks in order); the first-party default is the recoverable floor.
    preferredSource = "stored";
    if (stored.preferredProvider !== undefined) push(stored.preferredProvider);
    for (const id of stored.fallbackProviders) push(id);
    push(options.firstPartyProviderId);
    if (preferred === undefined && chain.length > 0) preferred = chain[0];
  } else if (privacy === "local-only" && noLocalProviderFor(options.registry, options.task)) {
    // Honest degenerate case: local-only, no stored chain, and the only
    // default candidate would be a cloud provider — the resolver refuses to
    // silently substitute and answers an empty chain the gateway turns into
    // the typed no-provider failure.
    preferredSource = "local-only-fallback";
  } else {
    push(options.firstPartyProviderId);
    preferredSource = "first-party-default";
    // The fail-closed default keeps every LOCAL provider for the task in
    // reach ("local model where supported"): under local-only the input
    // never leaves the machine, so any registered local provider is a
    // legal default route. Cloud providers are NEVER defaulted in.
    if (typeof options.registry.providersFor === "function") {
      for (const provider of options.registry.providersFor(options.task)) {
        if (provider.privacy === "local") push(provider.id);
      }
    }
  }

  const effective: ModelPolicy = {
    task: options.task,
    fallbackProviders: chain,
    privacy,
    ...(preferred !== undefined ? { preferredProvider: preferred } : {}),
    ...(stored?.maxCostPerOperation !== undefined
      ? { maxCostPerOperation: stored.maxCostPerOperation }
      : {}),
  };

  return { policy: effective, preferredSource, byomConsidered };
}

/** Does the registry hold ANY local provider for the task? */
function noLocalProviderFor(
  registry: { get(id: string): RegisteredModelProvider | undefined; providersFor?(task: ModelTask): readonly RegisteredModelProvider[] },
  task: ModelTask,
): boolean {
  if (typeof registry.providersFor !== "function") return false;
  const providers = registry.providersFor(task);
  return !providers.some((provider) => provider.privacy === "local");
}

// ---------------------------------------------------------------------------
// The provider catalog (registry view with capability truth)
// ---------------------------------------------------------------------------

/** How a catalog row relates to the user's configuration. */
export type ModelProviderOrigin = "first-party" | "byom" | "local";

/** Per-task capability truth for one provider. */
export interface ProviderTaskCapability {
  /** The frozen task. */
  readonly task: ModelTask;
  /** Whether the provider DECLARES the task (capability truth — never guessed). */
  readonly available: boolean;
  /** The declared cost for one operation (abstract units); absent = undeclared. */
  readonly declaredCost?: number;
}

/** One provider row of the catalog (the `GET /experience/model-providers` view). */
export interface ModelProviderCatalogEntry {
  /** The provider id (the route-plan identity). */
  readonly id: string;
  /** Where the provider runs (the registration truth). */
  readonly privacy: ModelProviderPrivacy;
  /** How this row relates to the user's configuration. */
  readonly origin: ModelProviderOrigin;
  /**
   * Whether the provider is BOUND for this profile (first-party/local rows
   * are always `"built-in"`; BYOM rows are bound-or-not).
   */
  readonly bound: boolean;
  /** Per-task capability truth over EVERY frozen ModelTask. */
  readonly capabilities: readonly ProviderTaskCapability[];
  /**
   * Human-readable honest note (e.g. the binding endpoint hint for BYOM
   * rows — metadata only, NEVER key material).
   */
  readonly note: string;
}

/** The catalog: every provider row + the honest local-support truth per task. */
export interface ModelProviderCatalog {
  /** Provider rows in registry order. */
  readonly providers: readonly ModelProviderCatalogEntry[];
  /**
   * The honest LOCAL-MODEL support truth per frozen task: which tasks have
   * at least one local provider registered in THIS deployment ("local model
   * where supported" — support is reported, never assumed).
   */
  readonly localSupport: Readonly<Record<ModelTask, boolean>>;
}

/** Options for {@link buildModelProviderCatalog}. */
export interface BuildModelProviderCatalogOptions {
  /** The registry to read (the id × task truth). */
  readonly registry: {
    get(id: string): RegisteredModelProvider | undefined;
    providersFor(task: ModelTask): readonly RegisteredModelProvider[];
    describe(): { providers: readonly { id: string; privacy: ModelProviderPrivacy; capabilities: readonly ModelTask[] }[] };
  };
  /** The profile's BYOM bindings (secret-free summaries). */
  readonly byomBindings: readonly ByomBindingSummary[];
  /** The first-party provider id (origin classification). */
  readonly firstPartyProviderId: string;
  /**
   * Binding metadata for notes (providerId → honest note), e.g. endpoint
   * host hints. Key material NEVER appears here.
   */
  readonly bindingNotes?: ReadonlyMap<string, string>;
}

/**
 * Build the provider catalog view: first-party, BYOM-configured, and local
 * rows with per-task capability truth and the honest local-support report.
 * Pure over the registry + binding summaries.
 */
export function buildModelProviderCatalog(
  options: BuildModelProviderCatalogOptions,
): ModelProviderCatalog {
  const boundIds = new Set(options.byomBindings.map((binding) => binding.providerId));
  const providers: ModelProviderCatalogEntry[] = [];

  for (const row of options.registry.describe().providers) {
    const origin: ModelProviderOrigin =
      row.id === options.firstPartyProviderId
        ? "first-party"
        : boundIds.has(row.id)
          ? "byom"
          : row.privacy === "local"
            ? "local"
            : "byom"; // registered but unbound — surfaced for discovery
    const capabilities: ProviderTaskCapability[] = MODEL_TASKS.map((task) => {
      const declared = row.capabilities.includes(task);
      const cost = declared
        ? declaredCostFor(options.registry.get(row.id) as RegisteredModelProvider, task)
        : undefined;
      return declared
        ? cost === undefined
          ? { task, available: true }
          : { task, available: true, declaredCost: cost }
        : { task, available: false };
    });
    const note =
      row.id === options.firstPartyProviderId
        ? "the WebFlix first-party model — local by construction, no metering"
        : boundIds.has(row.id)
          ? (options.bindingNotes?.get(row.id) ?? "a bound bring-your-own-model provider")
          : row.privacy === "local"
            ? "a locally registered model provider"
            : "a registered model provider — bind it to use it as your model";
    providers.push({
      id: row.id,
      privacy: row.privacy,
      origin,
      bound: row.id === options.firstPartyProviderId || row.privacy === "local" || boundIds.has(row.id),
      capabilities: Object.freeze(capabilities),
      note,
    });
  }

  // Bound-but-UNREGISTERED BYOM providers: the user's configuration is the
  // truth that matters — the row appears with the BINDING's task list as
  // its capability truth and the honest note that routing reports it
  // ineligible until a transport registers it with the fabric.
  const registeredIds = new Set(options.registry.describe().providers.map((row) => row.id));
  for (const binding of options.byomBindings) {
    if (registeredIds.has(binding.providerId)) continue; // already a row above
    const taskSet = new Set(binding.tasks);
    const capabilities: ProviderTaskCapability[] = MODEL_TASKS.map((task) => ({
      task,
      available: taskSet.has(task),
    }));
    providers.push({
      id: binding.providerId,
      privacy: binding.privacy,
      origin: "byom",
      bound: true,
      capabilities: Object.freeze(capabilities),
      note: options.bindingNotes?.get(binding.providerId)
        ?? "a bound bring-your-own-model provider — not registered with the fabric in this deployment, so routing reports it ineligible until a transport registers it",
    });
  }

  const localSupport: Partial<Record<ModelTask, boolean>> = {};
  for (const task of MODEL_TASKS) {
    localSupport[task] = options.registry
      .providersFor(task)
      .some((provider) => provider.privacy === "local");
  }

  return {
    providers: Object.freeze(providers),
    localSupport: localSupport as Readonly<Record<ModelTask, boolean>>,
  };
}

// ---------------------------------------------------------------------------
// Shared preview helper (bounded, never throws — the repo convention)
// ---------------------------------------------------------------------------

function preview(value: unknown): string {
  let rendered: string;
  if (typeof value === "number") {
    rendered = String(value);
  } else {
    try {
      rendered = JSON.stringify(value) ?? String(value);
    } catch {
      rendered = String(value);
    }
  }
  return rendered.length > 60 ? `${rendered.slice(0, 57)}...` : rendered;
}
