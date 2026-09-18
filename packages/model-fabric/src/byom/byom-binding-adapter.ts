/**
 * @wfx/model-fabric — the BYOM binding provider adapter (R06, Lane A).
 *
 * `createByomProviderFromBinding(binding, options?)` turns a stored BYOM
 * binding (the persistence layer's `OpenedByomBinding` — secret-bearing,
 * transport-lane only) into a fabric `RegisteredModelProvider` that
 * satisfies the frozen `ModelProvider` contract — the SEAM R06 productionizes
 * over the existing fabric machinery. The adapter:
 *
 *   1. CARRIES NO KEY through the model-input lane — the `invoke()` path
 *      routes the binding's key to a TRANSPORT thunk the caller injects
 *      (`transport`), never to the model input the fabric router sees.
 *      The `redaction.ts` module guards model prompts against credential
 *      leakage (the existing privacy law — R06 doubles it: provider
 *      credentials never enter model prompts AND BYOM keys never enter
 *      logs, URLs, or model prompts).
 *   2. FAILS TYPED on missing/declined transport (no silent degradation):
 *      a missing transport answers a typed provider-error — the caller
 *      sees the boundary, never a fake empty result.
 *   3. NEVER throws raw across the boundary — every rejection that can
 *      escape `invoke()` is converted to a typed `Error` whose `message`
 *      is BOUNDED (never the input, never the key).
 *
 * Privacy class: the provider registers as `privacy: "cloud"` (BYOM models
 * run remotely — input leaves the machine). The fabric router's local-only
 * filter EXCLUDES this provider under local-only policies, by construction
 * — the same law that excludes any other cloud provider.
 *
 * Cost: the binding declares a `costPerCall` (the model's per-call cost in
 * fabric abstract units, surfaced by the binding's metadata); the adapter
 * exposes it through `costPerOperation(task)`. Tasks outside the binding's
 * declared capability set report `undefined` (no cost — the router's
 * capability filter excludes them too).
 *
 * Determinism: no `Date.now`, no `Math.random` — the adapter is a pure
 * function of its inputs.
 */

import type { ModelTask } from "@wfx/domain";

import type { RegisteredModelProvider } from "../registry";

/**
 * The secret-bearing BYOM binding the adapter wraps (the persistence
 * layer's `OpenedByomBinding` — narrowed here to avoid a cross-package
 * type dependency in the lane rule sense; structurally identical).
 */
export interface ByomBindingHandle {
  readonly providerId: string;
  readonly endpointUrl: string;
  readonly key: string;
  readonly metadata?: Record<string, unknown> | null;
}

/**
 * The transport thunk the caller injects. It receives the binding
 * (handle + key) plus the task/input the fabric is invoking; it returns
 * the provider's output. The transport is the ONLY code path that may
 * see the key — never the model-input lane, never logs, never URLs.
 */
export type ByomTransportThunk<TInput, TOutput> = (
  binding: ByomBindingHandle,
  task: ModelTask,
  input: TInput,
) => Promise<TOutput>;

/** Construction options. */
export interface ByomProviderOptions {
  /** The binding this provider fronts (handle + key — transport-lane only). */
  readonly binding: ByomBindingHandle;
  /**
   * The capabilities the binding's model declares — the frozen ModelTask
   * set this provider may serve (e.g. `['translation','summary']`).
   * Must be non-empty.
   */
  readonly capabilities: readonly ModelTask[];
  /**
   * The transport thunk — the ONLY code path that may consume the key.
   * A missing transport makes `invoke()` answer a typed provider-error.
   */
  readonly transport: <TInput, TOutput>(
    binding: ByomBindingHandle,
    task: ModelTask,
    input: TInput,
  ) => Promise<TOutput>;
  /**
   * The declared cost per call (fabric abstract cost units). Default: 0
   * (a model that does not meter its own cost is treated as free for
   * budget purposes — the router still applies the ceiling check).
   */
  readonly costPerCall?: number;
}

/** Bounded safe rendering of a transport failure (never the key, never the input). */
function byomFailureMessage(error: unknown): string {
  let message: string;
  if (error instanceof Error) {
    message = error.message.length > 0 ? error.message : String(error);
  } else {
    message = String(error);
  }
  return message.length > 200 ? `${message.slice(0, 197)}...` : message;
}

/**
 * Create a fabric `RegisteredModelProvider` from a stored BYOM binding.
 *
 * The provider's `invoke` routes the call to the injected transport thunk
 * (the ONLY code path that sees the key); the fabric gateway's
 * `FabricResult` envelope wraps the output. The adapter NEVER throws raw
 * — a transport rejection propagates as a typed Error whose message is
 * bounded (never the input, never the key).
 *
 * @throws Error on malformed options (wiring-time programmer errors).
 */
export function createByomProviderFromBinding(
  options: ByomProviderOptions,
): RegisteredModelProvider {
  if (typeof options.binding !== "object" || options.binding === null) {
    throw new Error("createByomProviderFromBinding: binding must be an object");
  }
  if (typeof options.binding.providerId !== "string" || options.binding.providerId.length === 0) {
    throw new Error("createByomProviderFromBinding: binding.providerId must be a non-empty string");
  }
  if (typeof options.binding.endpointUrl !== "string" || options.binding.endpointUrl.length === 0) {
    throw new Error("createByomProviderFromBinding: binding.endpointUrl must be a non-empty string");
  }
  if (typeof options.binding.key !== "string" || options.binding.key.length === 0) {
    throw new Error("createByomProviderFromBinding: binding.key must be a non-empty string");
  }
  if (!Array.isArray(options.capabilities) || options.capabilities.length === 0) {
    throw new Error(
      "createByomProviderFromBinding: capabilities must be a non-empty array of ModelTask",
    );
  }
  if (typeof options.transport !== "function") {
    throw new Error("createByomProviderFromBinding: transport must be a function");
  }
  const costPerCall =
    options.costPerCall === undefined ? 0 : options.costPerCall;
  if (typeof costPerCall !== "number" || !Number.isFinite(costPerCall) || costPerCall < 0) {
    throw new Error(
      "createByomProviderFromBinding: costPerCall must be a finite non-negative number when present",
    );
  }

  const binding = options.binding;
  const capabilities = [...options.capabilities] as ModelTask[];
  const transport = options.transport;

  const provider: RegisteredModelProvider = {
    id: binding.providerId,
    capabilities,
    privacy: "cloud", // BYOM models run remotely — input leaves the machine
    async invoke<TInput, TOutput>(task: ModelTask, input: TInput): Promise<TOutput> {
      if (!capabilities.includes(task)) {
        // Should be unreachable (router filters by capability), but defense
        // in depth: never invoke a task the binding did not declare.
        throw new Error(
          `byom provider '${binding.providerId}' does not declare task '${task}'`,
        );
      }
      try {
        return await transport(binding, task, input);
      } catch (error) {
        // The transport thunk's rejection — the message is bounded, never
        // the input, never the key. The fabric gateway wraps this as a
        // typed provider-error carrying the provider id + this message.
        throw new Error(
          `byom provider '${binding.providerId}' transport failed: ${byomFailureMessage(error)}`,
        );
      }
    },
    costPerOperation(task: ModelTask): number | undefined {
      if (!capabilities.includes(task)) return undefined;
      return costPerCall;
    },
  };
  return provider;
}

/**
 * The provider capability truth view the API surface renders. The
 * `/experience/model-providers` route answers this shape for every
 * registered provider — first-party, BYOM, and local — so the adapters
 * can render the honest capability matrix without re-querying the
 * fabric's registry directly.
 */
export interface ProviderCapabilityView {
  /** The provider's stable id. */
  readonly id: string;
  /** Where the provider runs (local | cloud — the registry vocabulary). */
  readonly privacy: "local" | "cloud";
  /** The frozen ModelTask set the provider declares. */
  readonly capabilities: readonly ModelTask[];
  /** Whether the provider is bound BYOM (true) or first-party/local (false). */
  readonly byomBound: boolean;
  /**
   * The declared cost per operation, per task. Every task the provider
   * declares is keyed; absent tasks are not in the map. Local/first-party
   * providers report 0 for every declared task (no metering).
   */
  readonly costs: Readonly<Record<string, number>>;
  /**
   * Honest availability truth: 'available' when the provider is
   * currently usable (registered + not in a degraded state); 'unsupported'
   * when the local-model capability is not present on this platform
   * (J20's "Constrained" truth — a constrained platform answers the
   * typed constraint, never a fake success).
   */
  readonly availability: "available" | "unsupported";
}
