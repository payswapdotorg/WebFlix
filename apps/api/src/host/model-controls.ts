/**
 * @wfx/app-api — the R06 model-and-AI-controls host adapter.
 *
 * The composition seam between the `/experience/{model-policy,
 * model-providers, transforms}/**` routes and the persistence-layer stores
 * (`PostgresModelPolicyStore` + `PostgresByomBindingStore` +
 * `PostgresTransformOperationStore`) + the fabric's transform-operation
 * controller. It owns the R06 CONTROL LAWS the routes answer with:
 *
 * - MODEL POLICY (`GET/PUT /experience/model-policy`): the active
 *   profile's frozen `ModelPolicy` per ModelTask — preferred provider,
 *   fallback chain, privacy class, cost ceiling — or the HONEST null
 *   when unset (the R05 honesty law carried into R06). Writes MERGE
 *   the validated command into the stored policy (canonical id + created_at
 *   preserved across re-writes). Anonymous reads answer the honest
 *   DEFAULTS-AS-DEFAULTS (the privacy class default is `local-only`; the
 *   fallback chain default is empty — never a fabricated
 *   default-as-if-configured).
 * - MODEL PROVIDERS (`GET /experience/model-providers`): the provider
 *   registry view — first-party, BYOM-configured, and local (where
 *   supported) with per-task capability truth (the "see actual
 *   capabilities" law applied to models). BYOM bindings are listed as
 *   secret-free projections ONLY (the response NEVER contains key
 *   material — the R06 privacy law).
 * - BYOM BINDINGS (`PUT/DELETE /experience/model-providers/byom/:providerId`):
 *   stores/removes a BYOM provider binding. The key is SEALED via the
 *   envelope-encrypted account-store pattern (the 0005 connector-accounts
 *   discipline verbatim — plaintext NEVER at rest). The PUT answers a
 *   HANDLE + metadata ONLY (never the key). DELETE destroys the sealed
 *   material (the vault's delete discipline).
 * - TRANSFORMS (`POST/GET/DELETE /experience/transforms[/:id]`): explicit
 *   transformation operations with progress and results — never implicit
 *   background magic. Submit creates a `queued` operation; the pipeline
 *   runs ASYNCHRONOUSLY and transitions the state through
 *   queued → running → succeeded | failed | cancelled (the explicit
 *   state machine). Cancel works on queued/running; succeeded/failed/
 *   cancelled are terminal. The append-only state history is honest
 *   audit truth.
 *
 * The wire shapes are structurally identical to the runtime's — the API
 * does NOT depend on `@wfx/client-runtime` (the lane rule). The fabric's
 * router enforces privacy (local-only NEVER routes to cloud), cost (over-
 * ceiling → typed failure), and fallback chain (in order, with honest
 * exhausted-fallback failure) — the host WRAPS the policy storage and the
 * transform-operation controller over the existing fabric machinery.
 *
 * Determinism: pure composition over the persistence stores + the
 * injected clock/ids seams (no Date.now / Math.random of its own).
 */

import type { ModelPolicy, ModelTask } from "@wfx/domain";
import type { Clock, IdGen } from "@wfx/experience";
import {
  PostgresByomBindingStore,
  PostgresModelPolicyStore,
  PostgresTransformOperationStore,
  type ByomProviderBindingRecord,
  type DbClient,
  type PersistedModelPolicy,
} from "@wfx/persistence";
import {
  ModelFabric,
  ModelFabricRegistry,
  TransformOperationController,
  WFX_MODEL_ID,
  registerWfxModel,
  type ProviderCapabilityView,
} from "@wfx/model-fabric";

// ---------------------------------------------------------------------------
// Wire shapes (structurally identical to the runtime's — the lane rule)
// ---------------------------------------------------------------------------

/** The model-policy command the runtime's `writeModelPolicy` sends. */
export interface ModelPolicyCommandWire {
  readonly task: string;
  readonly preferredProvider?: string;
  readonly fallbackProviders: readonly string[];
  readonly privacy: string;
  readonly maxCostPerOperation?: number;
}

/** The BYOM binding command `PUT /experience/model-providers/byom/:providerId` accepts. */
export interface ByomBindingCommandWire {
  readonly endpointUrl: string;
  readonly key: string;
  readonly metadata?: Record<string, unknown>;
  /** The capabilities the binding's model declares (the frozen ModelTask set). */
  readonly capabilities?: readonly string[];
  /** The model's declared cost per call (fabric abstract units). */
  readonly costPerCall?: number;
}

/** The transform submit command `POST /experience/transforms` accepts. */
export interface TransformSubmitCommandWire {
  readonly kind: string;
  readonly input: unknown;
  readonly options?: {
    readonly privacy?: string;
    readonly preferredProvider?: string;
    readonly fallbackProviders?: readonly string[];
    readonly maxCostPerOperation?: number;
    readonly timeoutMs?: number;
  };
}

// ---------------------------------------------------------------------------
// Validation (typed, every problem collected — the 400 channel's body)
// ---------------------------------------------------------------------------

/**
 * Validate a model-policy command against the frozen contract. Returns
 * EVERY problem (never one at a time). The closed ModelTask + privacy
 * vocabularies are enforced here (the typed 400 channel); the database's
 * CHECK constraint is the last line of defense.
 */
export function modelPolicyCommandProblems(
  command: ModelPolicyCommandWire,
): readonly string[] {
  const problems: string[] = [];
  if (
    typeof command?.task !== "string" ||
    !MODEL_TASKS_LIST.includes(command.task as ModelTask)
  ) {
    problems.push(
      `task: expected one of ${MODEL_TASKS_LIST.join(" | ")}, got ${preview(command?.task)}`,
    );
  }
  if (
    command?.privacy !== undefined &&
    !MODEL_POLICY_PRIVACIES_LIST.includes(command.privacy as ModelPolicy["privacy"])
  ) {
    problems.push(
      `privacy: expected one of ${MODEL_POLICY_PRIVACIES_LIST.join(" | ")}, got ${preview(command?.privacy)}`,
    );
  }
  if (
    command?.fallbackProviders !== undefined &&
    !Array.isArray(command.fallbackProviders)
  ) {
    problems.push(
      `fallbackProviders: expected an array of provider ids, got ${preview(command?.fallbackProviders)}`,
    );
  } else if (
    Array.isArray(command?.fallbackProviders) &&
    !command.fallbackProviders.every(
      (id) => typeof id === "string" && id.trim().length > 0,
    )
  ) {
    problems.push(
      `fallbackProviders: expected every entry to be a non-empty string, got ${preview(command.fallbackProviders)}`,
    );
  }
  if (
    command?.maxCostPerOperation !== undefined &&
    (typeof command.maxCostPerOperation !== "number" ||
      !Number.isFinite(command.maxCostPerOperation) ||
      command.maxCostPerOperation < 0)
  ) {
    problems.push(
      `maxCostPerOperation: expected a finite non-negative number when present, got ${preview(command.maxCostPerOperation)}`,
    );
  }
  // The fallback list MUST be non-empty (the spec law: a typed 400 names
  // every problem; an empty fallback is one).
  if (
    Array.isArray(command?.fallbackProviders) &&
    command.fallbackProviders.length === 0 &&
    (command?.preferredProvider === undefined || command.preferredProvider.trim().length === 0)
  ) {
    problems.push(
      "fallbackProviders: the list must not be empty when no preferredProvider is set (the routing plan cannot be empty)",
    );
  }
  return problems;
}

/** Validate a BYOM binding command (the typed 400 channel). */
export function byomBindingCommandProblems(
  command: ByomBindingCommandWire,
): readonly string[] {
  const problems: string[] = [];
  if (
    typeof command?.endpointUrl !== "string" ||
    !/^https?:\/\//i.test(command.endpointUrl) ||
    command.endpointUrl.length > 2048
  ) {
    problems.push(
      `endpointUrl: expected an absolute http(s) URL of at most 2048 characters, got ${preview(command?.endpointUrl)}`,
    );
  }
  if (typeof command?.key !== "string" || command.key.trim().length === 0) {
    problems.push("key: expected a non-empty string (the BYOM key, sealed at rest)");
  }
  if (
    command?.capabilities !== undefined &&
    (!Array.isArray(command.capabilities) ||
      !command.capabilities.every(
        (task) =>
          typeof task === "string" && MODEL_TASKS_LIST.includes(task as ModelTask),
      ))
  ) {
    problems.push(
      `capabilities: expected an array of ModelTask values when present, got ${preview(command?.capabilities)}`,
    );
  }
  if (
    command?.costPerCall !== undefined &&
    (typeof command.costPerCall !== "number" ||
      !Number.isFinite(command.costPerCall) ||
      command.costPerCall < 0)
  ) {
    problems.push(
      `costPerCall: expected a finite non-negative number when present, got ${preview(command?.costPerCall)}`,
    );
  }
  return problems;
}

/** Validate a transform-submit command (the typed 400 channel). */
export function transformSubmitCommandProblems(
  command: TransformSubmitCommandWire,
): readonly string[] {
  const problems: string[] = [];
  if (
    typeof command?.kind !== "string" ||
    !TRANSFORM_KINDS_LIST.includes(command.kind as never)
  ) {
    problems.push(
      `kind: expected one of ${TRANSFORM_KINDS_LIST.join(" | ")}, got ${preview(command?.kind)}`,
    );
  }
  if (command?.input === undefined || typeof command.input !== "object" || command.input === null) {
    problems.push("input: expected an object (the task's validated input shape)");
  }
  if (command?.options !== undefined && typeof command.options !== "object") {
    problems.push("options: expected an object when present");
  }
  if (command?.options?.privacy !== undefined) {
    if (
      typeof command.options.privacy !== "string" ||
      !MODEL_POLICY_PRIVACIES_LIST.includes(
        command.options.privacy as ModelPolicy["privacy"],
      )
    ) {
      problems.push(
        `options.privacy: expected one of ${MODEL_POLICY_PRIVACIES_LIST.join(" | ")}, got ${preview(command.options.privacy)}`,
      );
    }
  }
  if (
    command?.options?.maxCostPerOperation !== undefined &&
    (typeof command.options.maxCostPerOperation !== "number" ||
      !Number.isFinite(command.options.maxCostPerOperation) ||
      command.options.maxCostPerOperation < 0)
  ) {
    problems.push(
      `options.maxCostPerOperation: expected a finite non-negative number when present, got ${preview(command.options.maxCostPerOperation)}`,
    );
  }
  if (
    command?.options?.timeoutMs !== undefined &&
    (typeof command.options.timeoutMs !== "number" ||
      !Number.isFinite(command.options.timeoutMs) ||
      command.options.timeoutMs <= 0)
  ) {
    problems.push(
      `options.timeoutMs: expected a positive finite number when present, got ${preview(command.options.timeoutMs)}`,
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Constants — the frozen vocabularies (mirrors the domain contract)
// ---------------------------------------------------------------------------

const MODEL_TASKS_LIST: readonly ModelTask[] = [
  "recommendation",
  "ranking",
  "summary",
  "translation",
  "transcription",
  "speechToText",
  "textToSpeech",
  "dubbing",
  "commentary",
];

const MODEL_POLICY_PRIVACIES_LIST: readonly ModelPolicy["privacy"][] = [
  "local-only",
  "trusted-cloud",
  "any-cloud",
];

const TRANSFORM_KINDS_LIST: readonly string[] = [
  "transcript",
  "translation",
  "subtitle",
  "summary",
  "speech",
  "transcribe",
  "dubbing",
  "commentary",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function preview(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

/** Constructor dependencies (all injected). */
export interface ModelControlsHostOptions {
  readonly db: DbClient;
  readonly clock: Clock;
  readonly ids: IdGen;
  /** The decoded APP_ENCRYPTION_KEY (for the BYOM binding store). */
  readonly key: Uint8Array;
}

/**
 * The R06 model-and-AI-controls host: policy + BYOM bindings + transform
 * operations over the profile-scoped persistence stores, composed with the
 * fabric's transform-operation controller. Created once per service boot.
 */
export class ModelControlsHost {
  private readonly policies: PostgresModelPolicyStore;
  private readonly byomBindings: PostgresByomBindingStore;
  private readonly transforms: PostgresTransformOperationStore;
  private readonly clock: Clock;
  private readonly ids: IdGen;
  private readonly fabric: ModelFabric;
  private readonly registry: ModelFabricRegistry;
  private readonly transformController: TransformOperationController;

  constructor(options: ModelControlsHostOptions) {
    this.policies = new PostgresModelPolicyStore({
      db: options.db,
      clock: options.clock,
      ids: options.ids,
    });
    this.byomBindings = new PostgresByomBindingStore({
      db: options.db,
      clock: options.clock,
      key: options.key,
      ids: options.ids,
    });
    this.transforms = new PostgresTransformOperationStore({
      db: options.db,
      clock: options.clock,
      ids: options.ids,
    });
    this.clock = options.clock;
    this.ids = options.ids;

    // The fabric: a fresh registry + the first-party model provider
    // registered (privacy "local", cost 0). BYOM providers are registered
    // dynamically per-binding at invoke time (the binding's transport thunk
    // is the model's invoke path).
    this.registry = new ModelFabricRegistry();
    registerWfxModel(this.registry);
    this.fabric = new ModelFabric(this.registry);
    this.transformController = new TransformOperationController({
      fabric: this.fabric,
      store: this.transforms,
      now: () => this.clock.now(),
    });
  }

  /** The raw persistence stores (for the routes' edge cases + tests). */
  policyStore(): PostgresModelPolicyStore {
    return this.policies;
  }

  byomBindingStore(): PostgresByomBindingStore {
    return this.byomBindings;
  }

  transformStore(): PostgresTransformOperationStore {
    return this.transforms;
  }

  fabricRegistry(): ModelFabricRegistry {
    return this.registry;
  }

  // — model policy ——————————————————————————————————————————————————————————

  /**
   * Read ONE task's policy for the effective profile, or null when unset
   * (the HONEST empty answer — never a fabricated default-as-if-configured).
   */
  async readModelPolicy(
    userId: string,
    profileId: string | null,
    task: ModelTask,
  ): Promise<PersistedModelPolicy | null> {
    return this.policies.readForTask(userId, profileId, task);
  }

  /**
   * Write (UPSERT) one task's policy for the effective profile. The
   * canonical id + created_at are preserved across re-writes (rotation
   * law — same as connector-accounts). Validation is against the frozen
   * contract; failures throw the typed `PersistenceError` (the routes
   * answer the 400 channel).
   */
  async writeModelPolicy(
    userId: string,
    profileId: string | null,
    command: ModelPolicyCommandWire,
  ): Promise<PersistedModelPolicy> {
    const policy: ModelPolicy = {
      task: command.task as ModelTask,
      fallbackProviders: [...command.fallbackProviders],
      privacy: command.privacy as ModelPolicy["privacy"],
      ...(command.preferredProvider !== undefined
        ? { preferredProvider: command.preferredProvider }
        : {}),
      ...(command.maxCostPerOperation !== undefined
        ? { maxCostPerOperation: command.maxCostPerOperation }
        : {}),
    };
    return this.policies.upsertForTask({ userId, profileId, policy });
  }

  // — model providers ——————————————————————————————————————————————————————

  /**
   * The provider registry view: first-party (the WFX model, local,
   * cost 0) and BYOM-configured (cloud, the binding's declared cost) and
   * local (where supported) with per-task capability truth (the "see
   * actual capabilities" law applied to models). BYOM bindings are
   * listed as secret-free projections ONLY.
   */
  async listModelProviders(
    userId: string,
    profileId: string | null,
  ): Promise<readonly ProviderCapabilityView[]> {
    const views: ProviderCapabilityView[] = [];

    // First-party providers (the registry's local entries).
    const description = this.registry.describe();
    for (const provider of description.providers) {
      if (provider.privacy === "local") {
        const costs: Record<string, number> = {};
        for (const task of provider.capabilities) {
          const registered = this.registry.get(provider.id);
          if (registered !== undefined) {
            const cost = registered.costPerOperation(task);
            if (cost !== undefined) costs[task] = cost;
          }
        }
        views.push({
          id: provider.id,
          privacy: "local",
          capabilities: [...provider.capabilities],
          byomBound: false,
          costs,
          availability: "available",
        });
      }
    }

    // BYOM bindings (secret-free projections).
    const bindings = await this.byomBindings.listForProfile(userId, profileId);
    for (const binding of bindings) {
      const meta = (binding.metadata ?? {}) as {
        capabilities?: string[];
        costPerCall?: number;
      };
      const capabilities = (meta.capabilities ?? []) as ModelTask[];
      const costPerCall = typeof meta.costPerCall === "number" ? meta.costPerCall : 0;
      const costs: Record<string, number> = {};
      for (const task of capabilities) costs[task] = costPerCall;
      views.push({
        id: binding.providerId,
        privacy: "cloud", // BYOM models run remotely
        capabilities,
        byomBound: true,
        costs,
        availability: "available",
      });
    }

    return views;
  }

  // — byom bindings ———————————————————————————————————————————————————————

  /**
   * Store a BYOM provider binding: the key is SEALED via the envelope-
   * encrypted account-store pattern (plaintext NEVER at rest). Returns
   * the HANDLE + metadata ONLY (the response NEVER contains key material).
   */
  async bindByomProvider(
    userId: string,
    profileId: string | null,
    providerId: string,
    command: ByomBindingCommandWire,
  ): Promise<ByomProviderBindingRecord> {
    const meta: Record<string, unknown> = { ...(command.metadata ?? {}) };
    if (command.capabilities !== undefined) {
      meta.capabilities = [...command.capabilities];
    }
    if (command.costPerCall !== undefined) {
      meta.costPerCall = command.costPerCall;
    }
    return this.byomBindings.saveBinding({
      userId,
      profileId,
      providerId,
      endpointUrl: command.endpointUrl,
      key: command.key,
      metadata: meta,
    });
  }

  /**
   * DELETE one BYOM binding (the vault's delete discipline — the sealed
   * material is destroyed). True when a row was removed.
   */
  async unbindByomProvider(
    userId: string,
    profileId: string | null,
    providerId: string,
  ): Promise<boolean> {
    return this.byomBindings.deleteBinding(userId, profileId, providerId);
  }

  /**
   * Open one BYOM binding for the TRANSPORT LANE only (never the model-
   * input lane). The fabric's BYOM binding adapter wraps the opened
   * binding into a `RegisteredModelProvider` the fabric can route to.
   */
  async openByomBinding(
    userId: string,
    profileId: string | null,
    providerId: string,
  ): Promise<
    | { ok: true; binding: import("@wfx/persistence").OpenedByomBinding }
    | { ok: false; reason: "not-found" | "key-mismatch" | "decrypt-failed"; detail?: string }
  > {
    const result = await this.byomBindings.loadBinding(userId, profileId, providerId);
    if (result.ok) return { ok: true, binding: result.binding };
    if (result.reason === "not-found") return { ok: false, reason: "not-found" };
    if (result.reason === "key-mismatch") {
      return {
        ok: false,
        reason: "key-mismatch",
        detail: `stored key id ${result.storedKeyId} does not match the active key id ${result.expectedKeyId}`,
      };
    }
    return { ok: false, reason: "decrypt-failed", detail: result.detail };
  }

  // — transforms ——————————————————————————————————————————————————————————

  /**
   * Submit one transformation: validate the request, INSERT a queued
   * operation, run the pipeline ASYNCHRONOUSLY. Answers the queued
   * operation record immediately (the caller renders the queued state).
   */
  async submitTransform(
    userId: string,
    profileId: string | null,
    command: TransformSubmitCommandWire,
  ): Promise<ReturnType<TransformOperationController["submit"]>> {
    return this.transformController.submit(userId, profileId, {
      kind: command.kind as never,
      input: command.input,
      ...(command.options !== undefined
        ? {
            options: {
              privacy: command.options.privacy as never,
              ...(command.options.preferredProvider !== undefined
                ? { preferredProvider: command.options.preferredProvider }
                : {}),
              ...(command.options.fallbackProviders !== undefined
                ? { fallbackProviders: [...command.options.fallbackProviders] }
                : {}),
              ...(command.options.maxCostPerOperation !== undefined
                ? { maxCostPerOperation: command.options.maxCostPerOperation }
                : {}),
              ...(command.options.timeoutMs !== undefined
                ? { timeoutMs: command.options.timeoutMs }
                : {}),
            },
          }
        : {}),
    });
  }

  /** Read one transform operation's current state. */
  async readTransform(
    operationId: string,
    userId: string,
    profileId: string | null,
  ) {
    return this.transformController.read(operationId, userId, profileId);
  }

  /** Read the operation's append-only state history. */
  async readTransformHistory(operationId: string) {
    return this.transformController.readHistory(operationId);
  }

  /** Cancel a queued/running transform operation. */
  async cancelTransform(
    operationId: string,
    userId: string,
    profileId: string | null,
  ) {
    return this.transformController.cancel(operationId, userId, profileId);
  }

  /** DELETE the result of a succeeded transform (result cleanup). */
  async clearTransformResult(
    operationId: string,
    userId: string,
    profileId: string | null,
  ) {
    return this.transformController.clearResult(operationId, userId, profileId);
  }
}

/** Re-exported for the routes' target validation. */
export { WFX_MODEL_ID };
