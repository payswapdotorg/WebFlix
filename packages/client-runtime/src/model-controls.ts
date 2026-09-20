/**
 * @wfx/client-runtime — the model-controls store (R21-C).
 *
 * The runtime's read/write model behind the Model & AI surfaces: the
 * ACTIVE profile's model policy per task, the provider registry view
 * (first-party + BYOM + local with per-task capability truth), the BYOM
 * binding writes, and the AI transform operations (submit / read /
 * cancel / clear-result). The R06 SHARED SEMANTICS made UI-ready — no
 * new recommendation algorithm, no product policy here: the store
 * projects the ServerPort's typed answers into honest read models
 * (in-model degradation — an error state is an ERROR MODEL, never a fake
 * empty/absent one), exactly the law the source-state store keeps.
 *
 * LAWS:
 *
 * 1. HONEST AVAILABILITY — a port that does not implement an optional
 *    R06 operation answers the typed `unavailable` ERROR model naming
 *    the missing transport (the same honest law `sources.ts` kept for
 *    `readSources` before the R21-B wiring; production ports implement
 *    the ops — the model is the safety net for partial ports).
 * 2. IN-MODEL DEGRADATION — a failing read keeps the LAST observed
 *    truth visible alongside the typed error section (never a fake
 *    empty list, never a fabricated default policy).
 * 3. THE HONEST NULL — an unset policy is `null` (never a fabricated
 *    default-as-if-configured — the R06 honesty law).
 * 4. WRITES ARE TYPED — policy/binding/transform writes answer the
 *    typed `ServerResult` verbatim (a write failure is an ERROR STATE,
 *    never a fabricated success); the store does not fabricate local
 *    echoes of server-owned state.
 * 5. SECRETS NEVER COME BACK — BYOM binding handles are the
 *    secret-free projections the port validated (the R06 privacy law).
 * 6. DETERMINISM — no clock, no ids, no fetching beyond the port's own
 *    calls; ordering is the call order.
 */

import type { ModelPolicy, ModelTask } from "@wfx/domain";

import { errorSection, readySection, type ModelSectionStatus } from "./models";
import { serverFailureKind } from "./errors";
import type {
  ByomBindingCommand,
  ByomBindingHandle,
  ModelPolicyCommand,
  ModelProviderInfo,
  ServerPort,
  ServerResult,
  TransformOperation,
  TransformSubmitCommand,
} from "./server-port";

// ---------------------------------------------------------------------------
// The read models
// ---------------------------------------------------------------------------

/**
 * One task's policy read model: the honest status + the policy (null
 * when unset — never a fabricated default). `status.state === "error"`
 * keeps the LAST observed policy visible alongside the failure.
 */
export interface ModelPolicyModel {
  readonly task: ModelTask;
  readonly status: ModelSectionStatus;
  /** The last observed policy (null when unset or never read). */
  readonly policy: ModelPolicy | null;
}

/** The provider registry read model (the "see actual capabilities" view). */
export interface ModelProvidersModel {
  readonly status: ModelSectionStatus;
  /** The last observed provider rows (empty before the first refresh). */
  readonly providers: readonly ModelProviderInfo[];
}

/**
 * The model-controls operations the runtime exposes (surfaces consume
 * through `runtime.modelControls` — the ADD-ONLY R21-C wiring).
 */
export interface ModelControlsOperations {
  /** The last observed policy for one task (never fetched — the cache view). */
  policy(task: ModelTask): ModelPolicyModel;
  /**
   * Refresh one task's policy from the server. Answers the typed model:
   * an error keeps the last observed policy; the honest null stays null.
   */
  refreshPolicy(task: ModelTask): Promise<ModelPolicyModel>;
  /**
   * Write the ACTIVE profile's model policy (the validated command). The
   * typed `ServerResult` answers verbatim — never a fabricated success;
   * a successful write refreshes the observed policy view.
   */
  writePolicy(command: ModelPolicyCommand): Promise<ServerResult<void>>;
  /** The last observed provider registry (never fetched — the cache view). */
  providers(): ModelProvidersModel;
  /** Refresh the provider registry from the server (typed model). */
  refreshProviders(): Promise<ModelProvidersModel>;
  /**
   * Store a BYOM provider binding (the key SEALED server-side; the
   * transport answers the secret-free handle ONLY). Typed verbatim.
   */
  bindByomProvider(command: ByomBindingCommand): Promise<ServerResult<ByomBindingHandle>>;
  /** DELETE one BYOM binding (the vault's delete discipline). Typed verbatim. */
  unbindByomProvider(providerId: string): Promise<ServerResult<void>>;
  /** Submit one explicit transformation (answers the queued operation). Typed verbatim. */
  submitTransform(command: TransformSubmitCommand): Promise<ServerResult<TransformOperation>>;
  /** Read one transform operation's current state. Typed verbatim. */
  readTransform(operationId: string): Promise<ServerResult<TransformOperation>>;
  /** Cancel a queued/running transform operation. Typed verbatim. */
  cancelTransform(operationId: string): Promise<ServerResult<TransformOperation>>;
  /** DELETE the result of a succeeded transform. Typed verbatim. */
  clearTransformResult(operationId: string): Promise<ServerResult<TransformOperation>>;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/**
 * Create the model-controls store over one server port. Created by
 * `createRuntime`; usable standalone in tests. Pure bookkeeping: no
 * clock, no ids, no fetching beyond the port's own calls.
 */
export function createModelControlsStore(server: ServerPort): ModelControlsOperations {
  const policies = new Map<ModelTask, ModelPolicy | null>();
  const policyStatuses = new Map<ModelTask, ModelSectionStatus>();
  let observedProviders: readonly ModelProviderInfo[] = [];
  let providersStatus: ModelSectionStatus = readySection();

  const unavailable = (operation: string): ModelSectionStatus =>
    errorSection(
      "unavailable",
      `the adapter transport has not implemented ${operation} (the R06 ServerPort extension the Model & AI surfaces need)`,
    );

  function policyModelOf(task: ModelTask): ModelPolicyModel {
    return {
      task,
      status: policyStatuses.get(task) ?? unavailable(`readModelPolicy('${task}')`),
      policy: policies.get(task) ?? null,
    };
  }

  return {
    policy: policyModelOf,

    async refreshPolicy(task: ModelTask): Promise<ModelPolicyModel> {
      if (typeof server.readModelPolicy !== "function") {
        policyStatuses.set(task, unavailable(`readModelPolicy('${task}')`));
        return policyModelOf(task);
      }
      const result = await server.readModelPolicy(task);
      if (!result.ok) {
        // In-model degradation: the last observed policy stays visible.
        policyStatuses.set(task, errorSection(serverFailureKind(result.failure), result.failure.detail));
        return policyModelOf(task);
      }
      policies.set(task, result.value);
      policyStatuses.set(task, readySection());
      return policyModelOf(task);
    },

    async writePolicy(command: ModelPolicyCommand): Promise<ServerResult<void>> {
      if (typeof server.writeModelPolicy !== "function") {
        return {
          ok: false,
          failure: {
            kind: "unavailable",
            detail:
              "the adapter transport has not implemented writeModelPolicy (the R06 ServerPort extension the Model & AI surfaces need)",
          },
        };
      }
      const result = await server.writeModelPolicy(command);
      if (result.ok) {
        // The write succeeded server-side; refresh the observed view so
        // the surfaces render the server's own truth (never a fabricated
        // local echo of un-observed state).
        await this.refreshPolicy(command.task);
      }
      return result;
    },

    providers: () => ({ status: providersStatus, providers: [...observedProviders] }),

    async refreshProviders(): Promise<ModelProvidersModel> {
      if (typeof server.readModelProviders !== "function") {
        providersStatus = unavailable("readModelProviders");
        return { status: providersStatus, providers: [...observedProviders] };
      }
      const result = await server.readModelProviders();
      if (!result.ok) {
        providersStatus = errorSection(serverFailureKind(result.failure), result.failure.detail);
        return { status: providersStatus, providers: [...observedProviders] };
      }
      observedProviders = [...result.value];
      providersStatus = readySection();
      return { status: providersStatus, providers: [...observedProviders] };
    },

    async bindByomProvider(command: ByomBindingCommand): Promise<ServerResult<ByomBindingHandle>> {
      if (typeof server.bindByomProvider !== "function") {
        return {
          ok: false,
          failure: { kind: "unavailable", detail: "the adapter transport has not implemented bindByomProvider" },
        };
      }
      return server.bindByomProvider(command);
    },

    async unbindByomProvider(providerId: string): Promise<ServerResult<void>> {
      if (typeof server.unbindByomProvider !== "function") {
        return {
          ok: false,
          failure: { kind: "unavailable", detail: "the adapter transport has not implemented unbindByomProvider" },
        };
      }
      return server.unbindByomProvider(providerId);
    },

    async submitTransform(command: TransformSubmitCommand): Promise<ServerResult<TransformOperation>> {
      if (typeof server.submitTransform !== "function") {
        return {
          ok: false,
          failure: { kind: "unavailable", detail: "the adapter transport has not implemented submitTransform" },
        };
      }
      return server.submitTransform(command);
    },

    async readTransform(operationId: string): Promise<ServerResult<TransformOperation>> {
      if (typeof server.readTransform !== "function") {
        return {
          ok: false,
          failure: { kind: "unavailable", detail: "the adapter transport has not implemented readTransform" },
        };
      }
      return server.readTransform(operationId);
    },

    async cancelTransform(operationId: string): Promise<ServerResult<TransformOperation>> {
      if (typeof server.cancelTransform !== "function") {
        return {
          ok: false,
          failure: { kind: "unavailable", detail: "the adapter transport has not implemented cancelTransform" },
        };
      }
      return server.cancelTransform(operationId);
    },

    async clearTransformResult(operationId: string): Promise<ServerResult<TransformOperation>> {
      if (typeof server.clearTransformResult !== "function") {
        return {
          ok: false,
          failure: { kind: "unavailable", detail: "the adapter transport has not implemented clearTransformResult" },
        };
      }
      return server.clearTransformResult(operationId);
    },
  };
}
