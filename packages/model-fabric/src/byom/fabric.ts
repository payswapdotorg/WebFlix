/**
 * WFX-032 — the BYOM Model Fabric wrapper (Lane A — intelligence).
 *
 * `createByomProvider(byom, options?)` wraps the BYOM ADAPTER (adapter.ts —
 * the full privacy/cost/validation/enforcement pipeline) as a Model Fabric
 * `ModelProvider` serving the `recommendation` and `ranking` tasks:
 *
 * - TASKS: `["recommendation", "ranking"]` — the frozen ModelTask members a
 *   candidate-scoring model serves. `ranking` shares the recommendation
 *   input contract (ranking IS scoring the ctx's candidates; the task kind
 *   distinguishes caller intent, not the math — the WFX-031 precedent).
 * - PRIVACY: from the byom class — `local-only` registers as fabric privacy
 *   `"local"` (eligible for local-only model policies); `trusted-cloud` and
 *   `any-cloud` register as `"cloud"`. The merged WFX-030 router cannot yet
 *   distinguish trusted from any cloud (its documented limitation — provider
 *   metadata has no trust tier); the BYOM class distinction is preserved in
 *   the ADAPTER's redaction (trusted-cloud keeps event payloads, any-cloud
 *   minimizes them) and carried on the registered provider for introspection.
 * - ROUTING + COST: through the MERGED fabric APIs only — the provider
 *   declares capabilities and `costPerOperation(task)` = `byom.costPerCall`
 *   for the two served tasks (undefined elsewhere — an honest absence); the
 *   merged router filters by capability/privacy/declared cost and the merged
 *   gateway enforces the budget and traces the invocation. Nothing here
 *   re-implements fabric machinery.
 * - INPUT/FAILURES: `invoke` delegates to the adapter — ONE validation path,
 *   zero drift. The adapter's typed `ByomError` rejections propagate through
 *   the fabric gateway as typed `provider-error`s carrying the message (and
 *   the gateway's fallback machinery can fall back to the next provider);
 *   the adapter NEVER substitutes on failure.
 *
 * `registerByom(fabric, byom, options?)` is the registration glue: the merged
 * `ModelFabricRegistry.register` API, indexed under every declared task.
 * Duplicate ids throw the merged registry's typed `DuplicateProviderError`
 * (ids are stable identities — never overwritten).
 */

import type { ModelTask, ModelProvider } from "@wfx/domain";

import type { ModelFabricRegistry, ModelProviderPrivacy, RegisteredModelProvider } from "../registry";
import type { ByomAdapter, ByomAdapterOptions } from "./adapter";
import { createByomAdapter } from "./adapter";
import type { ByomModel, ByomPrivacyClass } from "./byom";
import { assertValidByomModel } from "./byom";

// ---------------------------------------------------------------------------
// Supported tasks
// ---------------------------------------------------------------------------

/**
 * The Model Fabric tasks this provider serves (frozen ModelTask members).
 * The single source of truth for BOTH the declared capabilities and the
 * runtime task check.
 */
export const BYOM_SUPPORTED_TASKS = ["recommendation", "ranking"] as const satisfies readonly ModelTask[];

/** One of the two tasks served by the BYOM provider. */
export type ByomSupportedTask = (typeof BYOM_SUPPORTED_TASKS)[number];

// ---------------------------------------------------------------------------
// Typed provider error (the WFX-031 adapter-error precedent)
// ---------------------------------------------------------------------------

/** The closed error vocabulary of the BYOM fabric wrapper. */
export type ByomProviderErrorKind =
  /** The requested ModelTask is not one of `BYOM_SUPPORTED_TASKS`. */
  "unsupported-task";

/**
 * The typed error thrown by the provider wrapper. Everything else that can
 * escape `invoke` is the adapter's own typed `ByomError` (input validation,
 * cost refusal, output validation, degraded verdict, model failure) —
 * propagated as-is, never rebranded.
 */
export class ByomProviderError extends Error {
  readonly kind: ByomProviderErrorKind;
  /** Field-level problem descriptions (at least one). */
  readonly details: readonly string[];

  constructor(kind: ByomProviderErrorKind, details: string | readonly string[]) {
    const list = typeof details === "string" ? [details] : details;
    super(`ByomProviderError (${kind}): ${list.join("; ")}`);
    this.name = "ByomProviderError";
    this.kind = kind;
    this.details = list;
  }
}

// ---------------------------------------------------------------------------
// Privacy class → fabric provider privacy
// ---------------------------------------------------------------------------

/**
 * Map a BYOM privacy class to the fabric registry's provider privacy:
 * `local-only` runs on the user's machine (`"local"`); both cloud classes
 * send input to a remote service (`"cloud"`). The trusted/any distinction
 * lives in the ADAPTER's redaction (and on `byom.privacyClass`), not in the
 * fabric's current local/cloud vocabulary.
 */
export function byomProviderPrivacy(privacyClass: ByomPrivacyClass): ModelProviderPrivacy {
  return privacyClass === "local-only" ? "local" : "cloud";
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

/**
 * The BYOM provider as registered with the fabric: the merged
 * `RegisteredModelProvider` surface plus the wrapped byom model and adapter,
 * exposed for introspection and assertions (production callers go through
 * the fabric, or use `createByomAdapter` directly for OS-side injection).
 */
export interface ByomRegisteredProvider extends RegisteredModelProvider, ModelProvider {
  /** Always derived from the byom privacy class via {@link byomProviderPrivacy}. */
  readonly privacy: ModelProviderPrivacy;
  /** The wrapped bring-your-own model (the seam). */
  readonly byom: ByomModel;
  /** The enforcement adapter every invocation flows through. */
  readonly adapter: ByomAdapter;
}

/**
 * Create the BYOM Model Fabric provider: capabilities
 * `["recommendation", "ranking"]`, privacy from the byom class, and a
 * declared cost of `byom.costPerCall` per served-task operation (no declared
 * cost for anything else — an honest absence, never a silent zero).
 *
 * Ready for `ModelFabricRegistry.register` (see {@link registerByom}).
 *
 * @throws InvalidByomModelError when the byom model violates the port shape
 *         (validated here AND inside the adapter — one construction path).
 * @throws InvalidByomPolicyError when the adapter options' policy is malformed.
 */
export function createByomProvider(
  byom: ByomModel,
  options: ByomAdapterOptions = {},
): ByomRegisteredProvider {
  assertValidByomModel(byom);
  const adapter = createByomAdapter(byom, options);

  const provider: ByomRegisteredProvider = {
    id: byom.id,
    get capabilities(): ModelTask[] {
      return [...BYOM_SUPPORTED_TASKS];
    },
    privacy: byomProviderPrivacy(byom.privacyClass),
    get byom(): ByomModel {
      return byom;
    },
    get adapter(): ByomAdapter {
      return adapter;
    },
    costPerOperation(task: ModelTask): number | undefined {
      // byom.costPerCall for the served tasks; no declared cost otherwise.
      return (BYOM_SUPPORTED_TASKS as readonly string[]).includes(task)
        ? byom.costPerCall
        : undefined;
    },
    async invoke<TInput, TOutput>(task: ModelTask, input: TInput): Promise<TOutput> {
      // --- task validation (the more fundamental mismatch, checked first) ---
      if (!(BYOM_SUPPORTED_TASKS as readonly string[]).includes(task)) {
        throw new ByomProviderError("unsupported-task", [
          `task '${task}' is not served by the BYOM provider for model "${byom.id}" — supported tasks: ${BYOM_SUPPORTED_TASKS.join(", ")}`,
        ]);
      }

      // --- delegate to the adapter: ONE validation/enforcement path -------
      // The adapter's typed ByomError rejections propagate untouched (the
      // fabric gateway wraps them into typed provider-errors with fallback);
      // the cast mirrors the merged fixture precedent for the frozen generic
      // invoke method (callers instantiate TOutput as RecommendationScore[]).
      const scores = await adapter.score(input as unknown as Parameters<typeof adapter.score>[0]);
      return scores as TOutput;
    },
  };

  return provider;
}

// ---------------------------------------------------------------------------
// Registration glue
// ---------------------------------------------------------------------------

/**
 * Register a BYOM provider with the fabric's provider registry, under BOTH
 * served tasks (`recommendation` + `ranking`), via the merged WFX-030 public
 * registration API (the `ModelFabric` gateway itself exposes no registration
 * API, by design).
 *
 * @param fabric the fabric's provider registry (merged public surface).
 * @param byom the bring-your-own model to wrap and register.
 * @param options forwarded to the adapter (enforcement policy, clock, salt).
 * @returns the registered provider (for introspection and assertions).
 *
 * @throws InvalidByomModelError when the byom model violates the port shape.
 * @throws InvalidByomPolicyError when the adapter options' policy is malformed.
 * @throws DuplicateProviderError (merged registry) when `byom.id` is already
 *         registered — the typed refusal; the first registration stands.
 */
export function registerByom(
  fabric: ModelFabricRegistry,
  byom: ByomModel,
  options: ByomAdapterOptions = {},
): ByomRegisteredProvider {
  const provider = createByomProvider(byom, options);
  fabric.register(provider); // indexed under every declared capability
  return provider;
}
