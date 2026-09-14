/**
 * WFX-031 — the Model Fabric adapter for the first-party recommendation
 * model (Lane A — intelligence).
 *
 * `createWfxModelProvider()` wraps the first-party model as a Model Fabric
 * `ModelProvider` (docs/architecture/contracts.md, "Model Fabric") serving
 * the `recommendation` and `ranking` tasks. The fabric is a provider-neutral
 * gateway: the ADAPTER translates, it never owns policy, persistence, or
 * provider actions.
 *
 * Invocation contract (typed, honest — no fake success paths):
 *
 * - TASK validation first: invoking the provider for any task outside
 *   `WFX_SUPPORTED_TASKS` rejects with a typed `WfxModelProviderError`
 *   (kind "unsupported-task") naming the requested task and the supported
 *   set. The `ranking` task shares the recommendation input contract —
 *   ranking IS scoring the ctx's candidates; the task kind distinguishes
 *   caller intent, not the math.
 * - INPUT validation: `invoke` validates the input against the OS context
 *   shape by reusing the MERGED OS validator `validateRecommendationContext`
 *   (WFX-021, public API of `@wfx/recommendation`) — a mismatch rejects with
 *   a typed `WfxModelProviderError` (kind "invalid-input") whose `details`
 *   carry the aggregated field paths (e.g. `candidatePool[0].itemId: ...`).
 *   Malformed contexts NEVER resolve as silent empty scores.
 * - ROUTING: validated input flows to the wrapped `RecommendationModel`
 *   (`model` — the first-party model by default, injectable for tests via
 *   `WfxModelProviderOptions.model`).
 * - ENVELOPE: the provider resolves the raw `RecommendationScore[]` value —
 *   the fabric gateway wraps it in its typed `FabricResult` envelope
 *   (`{ ok: true; value; trace }`), and typed provider failures flow into
 *   the envelope's failure branch (`provider-error` with this provider's id,
 *   full trace, cost 0). Through the gateway, invalid input therefore yields
 *   a typed ERROR — never an ok:true wrapping of garbage.
 * - `never throws raw`: every rejection that can escape `invoke` is a typed
 *   `WfxModelProviderError`; an unexpected failure of the underlying model
 *   is caught and re-typed (kind "model-failure") — no raw throwable ever
 *   crosses the adapter boundary.
 *
 * Privacy class: LOCAL-ONLY, enforced by construction — this module (and the
 * whole `wfx-model` folder) performs no I/O of any kind: no network imports,
 * no filesystem, no timers. Registration carries `privacy: "local"` (the
 * WFX-030 registry vocabulary), which makes the provider eligible for
 * `local-only` model policies; the adapter cannot send input anywhere
 * because it has no sending capability at all.
 *
 * Cost: first-party, no metering — `costPerOperation` reports a TYPED ZERO
 * (the number 0, never undefined) for both supported tasks, so fabric
 * invocations record `trace.cost === 0`. Tasks the provider does not serve
 * report no declared cost (undefined) — an honest absence, not a zero.
 */

import type {
  ModelTask,
  RecommendationModel,
  RecommendationScore,
} from "@wfx/domain";

import { validateRecommendationContext } from "@wfx/recommendation";

import type { RegisteredModelProvider } from "../registry";
import { createWfxRecommendationModel, WFX_MODEL_ID, WFX_MODEL_VERSION } from "./model";

// ---------------------------------------------------------------------------
// Supported tasks
// ---------------------------------------------------------------------------

/**
 * The Model Fabric tasks this provider serves (frozen ModelTask members).
 * The list is the single source of truth for BOTH the declared capabilities
 * and the runtime task check.
 */
export const WFX_SUPPORTED_TASKS = [
  "recommendation",
  "ranking",
] as const satisfies readonly ModelTask[];

/** One of the two tasks served by the first-party adapter. */
export type WfxSupportedTask = (typeof WFX_SUPPORTED_TASKS)[number];

// ---------------------------------------------------------------------------
// Typed errors (mirrors the OS's RecommendationOSError pattern: kind + details)
// ---------------------------------------------------------------------------

/** The closed error vocabulary of the first-party model adapter. */
export type WfxModelProviderErrorKind =
  /** The requested ModelTask is not one of `WFX_SUPPORTED_TASKS`. */
  | "unsupported-task"
  /** The input does not satisfy the OS `RecommendationContext` shape (field paths in `details`). */
  | "invalid-input"
  /** The underlying model failed unexpectedly; the message is carried in `details`. */
  | "model-failure";

/**
 * The typed error thrown by the adapter — never a raw throwable. `details`
 * carries aggregated, field-path-level problem descriptions (invalid-input),
 * the unsupported-task diagnostic, or the bounded model-failure message.
 */
export class WfxModelProviderError extends Error {
  readonly kind: WfxModelProviderErrorKind;
  /** Field-level problem descriptions (at least one). */
  readonly details: readonly string[];

  constructor(kind: WfxModelProviderErrorKind, details: string | readonly string[]) {
    const list = typeof details === "string" ? [details] : details;
    super(`WfxModelProviderError (${kind}): ${list.join("; ")}`);
    this.name = "WfxModelProviderError";
    this.kind = kind;
    this.details = list;
  }
}

/** Bounded, safe rendering of an unexpected failure (never the input itself). */
function errorMessageOf(error: unknown): string {
  let message: string;
  if (error instanceof Error) {
    message = error.message.length > 0 ? error.message : String(error);
  } else {
    message = String(error);
  }
  return message.length > 200 ? `${message.slice(0, 197)}...` : message;
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

/** Options for {@link createWfxModelProvider}. */
export interface WfxModelProviderOptions {
  /**
   * Version of the default first-party model (validated semver). Ignored
   * when `model` is provided. Default: `WFX_MODEL_VERSION`.
   */
  version?: string;
  /**
   * Inject an alternative `RecommendationModel` behind the SAME adapter —
   * a test/extension seam proving the adapter is model-agnostic. The
   * injected model must satisfy the frozen contract (verify with
   * `assertModelContract`); it is never validated silently here.
   */
  model?: RecommendationModel;
}

/**
 * The first-party provider as registered with the fabric: the WFX-030
 * `RegisteredModelProvider` surface (privacy + declared costs) plus the
 * wrapped model, exposed for adapter introspection and swap-contract tests
 * (production callers should go through the fabric, or use
 * `createWfxRecommendationModel` directly for OS-side injection).
 */
export interface WfxRegisteredModelProvider extends RegisteredModelProvider {
  /** The frozen first-party identity. */
  readonly id: typeof WFX_MODEL_ID;
  /** Always "local": the adapter runs on-device and performs no I/O. */
  readonly privacy: "local";
  /** The wrapped recommendation model the adapter routes to. */
  readonly model: RecommendationModel;
}

/**
 * Create the WebFlix first-party Model Fabric provider.
 *
 * The returned object is ready for `ModelFabricRegistry.register` (see
 * `registerWfxModel`): capabilities `["recommendation", "ranking"]`,
 * privacy `"local"`, and a TYPED zero cost per operation for both tasks.
 */
export function createWfxModelProvider(
  options: WfxModelProviderOptions = {},
): WfxRegisteredModelProvider {
  const model: RecommendationModel =
    options.model ?? createWfxRecommendationModel(options.version ?? WFX_MODEL_VERSION);

  const provider: WfxRegisteredModelProvider = {
    id: WFX_MODEL_ID,
    get capabilities(): ModelTask[] {
      return [...WFX_SUPPORTED_TASKS];
    },
    privacy: "local",
    get model(): RecommendationModel {
      return model;
    },
    costPerOperation(task: ModelTask): number | undefined {
      // Typed zero for the served tasks; no declared cost for anything else.
      return (WFX_SUPPORTED_TASKS as readonly string[]).includes(task) ? 0 : undefined;
    },
    async invoke<TInput, TOutput>(task: ModelTask, input: TInput): Promise<TOutput> {
      // --- task validation (before input validation — the more fundamental mismatch) ---
      if (!(WFX_SUPPORTED_TASKS as readonly string[]).includes(task)) {
        throw new WfxModelProviderError("unsupported-task", [
          `task '${task}' is not served by ${WFX_MODEL_ID} — supported tasks: ${WFX_SUPPORTED_TASKS.join(", ")}`,
        ]);
      }

      // --- input validation against the OS context shape (field paths) ---
      const validation = validateRecommendationContext(input);
      if (!validation.ok) {
        throw new WfxModelProviderError("invalid-input", validation.errors);
      }

      // --- routing to the model; no raw throwable ever escapes the adapter ---
      try {
        const scores: RecommendationScore[] = await model.score(validation.value);
        // The fabric gateway wraps this value in its typed FabricResult
        // envelope; the cast mirrors the merged fixture precedent for the
        // frozen generic invoke method (callers instantiate TOutput as
        // RecommendationScore[]).
        return scores as TOutput;
      } catch (error) {
        if (error instanceof WfxModelProviderError) throw error; // already typed
        throw new WfxModelProviderError("model-failure", [
          `the underlying model "${model.id}" v${model.version} failed: ${errorMessageOf(error)}`,
        ]);
      }
    },
  };

  return provider;
}
