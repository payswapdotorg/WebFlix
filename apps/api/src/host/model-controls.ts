/**
 * @wfx/app-api — the R06 model-and-AI-controls host adapter.
 *
 * The composition seam between the `/experience/model-*` and
 * `/experience/transforms/**` routes and:
 *
 * - the persistence stores (`PostgresModelPolicyStore` +
 *   `PostgresModelProviderBindingStore` +
 *   `PostgresTransformOperationStore`) — the durable control state;
 * - the model fabric (`ModelFabricRegistry` + `ModelFabric` + the
 *   `TransformOperationEngine`) — the routing/invocation machinery.
 *
 * R06 CONTROL LAWS this host owns:
 *
 * - POLICY (`GET/PUT /experience/model-policy?task=`): the active profile's
 *   model policy for ONE task (the frozen `ModelPolicy` is per-task) — the
 *   stored policy or the HONEST null when unset, alongside the fail-closed
 *   DEFAULTS visibly labeled as defaults (never as configured choices —
 *   the anonymous-honesty law) and the per-task capability truth. Writes
 *   are validated against the FROZEN contract (total validation: the typed
 *   400 names EVERY problem).
 * - PROVIDERS (`GET /experience/model-providers`): the registry view —
 *   first-party, BYOM-bound, and local — with per-task capability truth
 *   and the honest local-model support report.
 * - BYOM BINDINGS (`PUT/DELETE /experience/model-providers/byom/:id`):
 *   sealed key storage (envelope-encrypted; the PUT answers a handle +
 *   metadata ONLY — key material never appears in any response); DELETE
 *   destroys the sealed row (the vault's delete discipline).
 * - TRANSFORMS (`POST/GET/DELETE /experience/transforms[/:id]`, `POST
 *   …/:id/cancel`): EXPLICIT operations with the state machine
 *   queued → running → succeeded | failed | cancelled, progress where the
 *   fabric reports it, and the result reference on success. The routing
 *   directive is resolved from the STORED policy (BYOM replacement
 *   applied) at submit — the transform never bypasses the user's
 *   privacy/cost constraints.
 *
 * PRODUCTION PROVIDER TRUTH (honest): the production boot registers ONLY
 * the first-party model provider (local, recommendation/ranking). No real
 * transformation providers exist yet (the fabric's transform fakes are
 * TEST FIXTURES — never production providers), so production transform
 * submissions honestly reach the fabric's typed `no-provider` failure on
 * the operation record. The fabric documents this: concrete providers
 * arrive in later work items. Tests inject the fabric's testing doubles
 * (the WFX-055A test-boot pattern).
 *
 * Determinism: pure composition over injected seams (db, clock, ids,
 * scheduler); no Date.now / Math.random of its own.
 */

import type { ModelPolicy, ModelTask } from "@wfx/domain";
import type { Clock, IdGen } from "@wfx/experience";
import {
  buildModelProviderCatalog,
  createWfxModelProvider,
  isModelTask,
  ModelFabric,
  ModelFabricRegistry,
  resolveEffectiveModelPolicy,
  TransformOperationEngine,
  validateModelPolicyInput,
  type ByomBindingSummary,
  type EffectivePolicyResolution,
  type ModelProviderCatalog,
  type RegisteredModelProvider,
  type TransformOperationSnapshot,
} from "@wfx/model-fabric";
import {
  PostgresModelPolicyStore,
  PostgresModelProviderBindingStore,
  PostgresTransformOperationStore,
  type ByomBindingRecord,
  type DbClient,
  type ModelPolicyPrivacyName,
  type ModelTaskName,
  type PersistedModelPolicy,
  type PersistedTransformOperation,
} from "@wfx/persistence";

import { WFX_MODEL_ID } from "@wfx/model-fabric";

// ---------------------------------------------------------------------------
// Wire shapes (the routes' answers — structurally shared with client-runtime)
// ---------------------------------------------------------------------------

/** The model-policy view: the stored policy + the visibly-labeled defaults. */
export interface ModelPolicyView {
  readonly task: ModelTask;
  /** The stored policy for this task and profile — HONEST null when unset. */
  readonly policy: PersistedModelPolicy | null;
  /** The fail-closed defaults, always labeled as defaults (never as configured choices). */
  readonly defaults: {
    readonly source: "default";
    readonly preferredProvider: string;
    readonly fallbackProviders: readonly string[];
    readonly privacy: "local-only";
  };
  /** Per-task capability truth for every provider (local availability included). */
  readonly providers: readonly ModelProviderCatalog["providers"][number][];
  /** The honest local-model support truth for this task. */
  readonly localSupport: boolean;
}

/** The BYOM binding command `PUT /experience/model-providers/byom/:id` accepts. */
export interface ByomBindingCommandWire {
  readonly providerId: string;
  readonly endpoint: string;
  readonly tasks: readonly string[];
  readonly privacy: string;
  readonly apiKey: string;
}

/** The transform command `POST /experience/transforms` accepts. */
export interface TransformCommandWire {
  readonly kind: string;
  readonly input: unknown;
  /** Optional per-submission timeout override (ms) — routing stays policy-derived. */
  readonly timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Validation (typed, every problem collected — the 400 channel's body)
// ---------------------------------------------------------------------------

/** Validate a BYOM binding command; returns EVERY problem (never one at a time). */
export function byomBindingCommandProblems(
  command: ByomBindingCommandWire,
): readonly string[] {
  const problems: string[] = [];
  if (
    typeof command?.providerId !== "string" ||
    command.providerId.trim().length === 0 ||
    command.providerId.length > 128
  ) {
    problems.push(
      `providerId: expected 1..128 characters, got ${preview(command?.providerId)}`,
    );
  }
  if (typeof command?.endpoint !== "string" || !/^https?:\/\//.test(command.endpoint)) {
    problems.push(`endpoint: expected an absolute http(s) URL, got ${preview(command?.endpoint)}`);
  }
  if (!Array.isArray(command?.tasks) || command.tasks.length === 0) {
    problems.push(
      `tasks: expected a NON-EMPTY array of ModelTask values, got ${preview(command?.tasks)}`,
    );
  } else {
    for (const [index, task] of command.tasks.entries()) {
      if (!isModelTask(task)) {
        problems.push(`tasks[${index}]: expected a frozen ModelTask value, got ${preview(task)}`);
      }
    }
  }
  if (
    command?.privacy !== "local-only" &&
    command?.privacy !== "trusted-cloud" &&
    command?.privacy !== "any-cloud"
  ) {
    problems.push(
      `privacy: expected one of local-only | trusted-cloud | any-cloud, got ${preview(command?.privacy)}`,
    );
  }
  if (typeof command?.apiKey !== "string" || command.apiKey.length === 0) {
    problems.push("apiKey: expected a non-empty string (the key is sealed, never echoed)");
  } else if (command.apiKey.length > 4096) {
    problems.push("apiKey: expected at most 4096 characters");
  }
  return problems;
}

/** Validate a transform command's shape (the task input is validated by the engine). */
export function transformCommandProblems(command: TransformCommandWire): readonly string[] {
  const problems: string[] = [];
  if (typeof command?.kind !== "string" || command.kind.length === 0) {
    problems.push(`kind: expected a transformation kind, got ${preview(command?.kind)}`);
  }
  if (command?.input === undefined || command.input === null) {
    problems.push("input: expected the transformation's task input object");
  }
  if (
    command?.timeoutMs !== undefined &&
    (typeof command.timeoutMs !== "number" || !Number.isFinite(command.timeoutMs) || command.timeoutMs <= 0)
  ) {
    problems.push(
      `timeoutMs: expected a positive finite number when present, got ${preview(command?.timeoutMs)}`,
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

/** Constructor dependencies (all injected). */
export interface ModelControlsHostOptions {
  readonly db: DbClient;
  readonly clock: Clock;
  readonly ids: IdGen;
  /** The decoded APP_ENCRYPTION_KEY (seals BYOM binding keys). */
  readonly key: Uint8Array;
  /**
   * EXTRA providers to register with the fabric (the TEST lane: the
   * fabric's testing doubles — never production providers; the WFX-055A
   * test-boot `sourceOverrides` pattern).
   */
  readonly extraProviders?: readonly RegisteredModelProvider[];
  /**
   * The run scheduler: how a submitted transformation's run is kicked off.
   * DEFAULT: fire-and-forget background (the honest async answer — the
   * operation record carries the state). TESTS inject a scheduler that
   * collects the run promises for deterministic awaiting.
   */
  readonly scheduler?: (run: () => Promise<unknown>) => void;
}

/** The typed outcome of a transform submission. */
export type SubmitTransformHostResult =
  | { ok: true; operation: TransformOperationSnapshot }
  | { ok: false; failure: SubmitTransformHostFailure };

/** The closed submission-failure vocabulary (the route maps each to its typed status). */
export type SubmitTransformHostFailure =
  | { kind: "validation"; problems: readonly { path: string; message: string }[] }
  | { kind: "permission"; reason: string }
  | { kind: "store-error"; detail: string };

/**
 * The R06 model-and-AI-controls host: model policy, provider catalog, BYOM
 * bindings, and explicit transform operations over the persistence stores +
 * the model fabric. Created once per service boot.
 */
export class ModelControlsHost {
  private readonly policies: PostgresModelPolicyStore;
  private readonly bindings: PostgresModelProviderBindingStore;
  private readonly operations: PostgresTransformOperationStore;
  private readonly registry: ModelFabricRegistry;
  private readonly fabric: ModelFabric;
  private readonly engine: TransformOperationEngine;
  private readonly clock: Clock;
  private readonly scheduler: (run: () => Promise<unknown>) => void;

  constructor(options: ModelControlsHostOptions) {
    this.policies = new PostgresModelPolicyStore({ db: options.db, clock: options.clock });
    this.bindings = new PostgresModelProviderBindingStore({
      db: options.db,
      clock: options.clock,
      key: options.key,
      ids: options.ids,
    });
    this.operations = new PostgresTransformOperationStore({
      db: options.db,
      clock: options.clock,
    });
    this.registry = new ModelFabricRegistry();
    // The first-party model provider — the ONLY production registration.
    this.registry.register(createWfxModelProvider());
    for (const provider of options.extraProviders ?? []) {
      this.registry.register(provider);
    }
    this.fabric = new ModelFabric(this.registry);
    this.engine = new TransformOperationEngine({
      store: this.operations,
      fabric: this.fabric,
      clock: options.clock,
      ids: options.ids,
    });
    this.clock = options.clock;
    this.scheduler =
      options.scheduler ?? ((run) => void run().catch(() => undefined));
  }

  /** The raw fabric registry (tests + diagnostics). */
  fabricRegistry(): ModelFabricRegistry {
    return this.registry;
  }

  /** The transform operation engine (tests + future durable workers). */
  transformEngine(): TransformOperationEngine {
    return this.engine;
  }

  // — policy ——————————————————————————————————————————————————————————————

  /**
   * The active profile's model-policy view for ONE task: the stored policy
   * (HONEST null when unset) + the fail-closed defaults visibly labeled as
   * defaults + the per-task capability truth (local availability included).
   */
  async readModelPolicy(profileKey: string, task: ModelTask): Promise<ModelPolicyView> {
    const stored = await this.policies.loadPolicy(profileKey, task as ModelTaskName);
    const catalog = await this.readModelProviders(profileKey);
    return {
      task,
      policy: stored,
      defaults: {
        source: "default",
        preferredProvider: WFX_MODEL_ID,
        fallbackProviders: [WFX_MODEL_ID],
        privacy: "local-only",
      },
      providers: catalog.providers,
      localSupport: catalog.localSupport[task],
    };
  }

  /**
   * Write the model policy for ONE task (the frozen per-task ModelPolicy).
   * The command is validated against the frozen contract FIRST (total
   * validation — every problem named); the store re-validates (defense in
   * depth). Returns the written policy.
   */
  async writeModelPolicy(
    profileKey: string,
    command: unknown,
  ): Promise<{ ok: true; policy: PersistedModelPolicy } | { ok: false; problems: readonly string[] }> {
    const validated = validateModelPolicyInput(command);
    if (!validated.ok) {
      return {
        ok: false,
        problems: validated.problems.map(
          (problem) => `${problem.path}: ${problem.message}`,
        ),
      };
    }
    const policy = validated.value;
    const written = await this.policies.savePolicy(profileKey, {
      task: policy.task as ModelTaskName,
      ...(policy.preferredProvider !== undefined ? { preferredProvider: policy.preferredProvider } : {}),
      fallbackProviders: policy.fallbackProviders,
      privacy: policy.privacy as ModelPolicyPrivacyName,
      ...(policy.maxCostPerOperation !== undefined
        ? { maxCostPerOperation: policy.maxCostPerOperation }
        : {}),
    });
    return { ok: true, policy: written };
  }

  /** Delete the stored policy for one task (reversibility — the undo law). */
  async deleteModelPolicy(profileKey: string, task: ModelTask): Promise<boolean> {
    return this.policies.deletePolicy(profileKey, task as ModelTaskName);
  }

  // — providers ————————————————————————————————————————————————————————————

  /**
   * The provider registry view: first-party, BYOM-bound, and local rows with
   * per-task capability truth and the honest local-support report.
   */
  async readModelProviders(profileKey: string): Promise<ModelProviderCatalog> {
    const bound = await this.bindings.listBindings(profileKey);
    const summaries: ByomBindingSummary[] = bound.map((record) => ({
      providerId: record.providerId,
      privacy: record.privacy === "local-only" ? "local" : "cloud",
      tasks: record.tasks as readonly ModelTask[],
    }));
    const notes = new Map<string, string>();
    for (const record of bound) {
      notes.set(
        record.providerId,
        `a bound bring-your-own-model provider (endpoint ${endpointHostOf(record.endpoint)})`,
      );
    }
    return buildModelProviderCatalog({
      registry: this.registry,
      byomBindings: summaries,
      firstPartyProviderId: WFX_MODEL_ID,
      bindingNotes: notes,
    });
  }

  // — BYOM bindings ————————————————————————————————————————————————————————

  /**
   * Store (or replace) a BYOM provider binding: the API key is SEALED via
   * the envelope-encrypted account-store pattern — plaintext never at rest,
   * and the ANSWER is the handle + metadata ONLY (key material never
   * appears in any response).
   */
  async bindByomProvider(
    profileKey: string,
    command: ByomBindingCommandWire,
  ): Promise<ByomBindingRecord> {
    return this.bindings.saveBinding({
      profileKey,
      providerId: command.providerId,
      endpoint: command.endpoint,
      tasks: command.tasks as readonly ModelTaskName[],
      privacy: command.privacy as ModelPolicyPrivacyName,
      apiKey: command.apiKey,
    });
  }

  /**
   * Remove a BYOM binding: the sealed envelope row is DESTROYED (the
   * vault's delete discipline — nothing salvageable remains). True when a
   * binding was removed; false when none existed.
   */
  async unbindByomProvider(profileKey: string, providerId: string): Promise<boolean> {
    return this.bindings.deleteBinding(profileKey, providerId);
  }

  /** The profile's bindings — the SECRET-FREE records (metadata only). */
  async listByomBindings(profileKey: string): Promise<readonly ByomBindingRecord[]> {
    return this.bindings.listBindings(profileKey);
  }

  // — transforms ——————————————————————————————————————————————————————————

  /**
   * Submit ONE explicit transformation. The routing directive is resolved
   * from the STORED policy for the task's fabric capability (BYOM
   * replacement applied) — the transform never bypasses the user's
   * privacy/cost constraints. The run is scheduled through the injected
   * scheduler (background by default). Validation + permission failures
   * answer BEFORE any operation record exists.
   */
  async submitTransform(
    profileKey: string,
    command: TransformCommandWire,
  ): Promise<SubmitTransformHostResult> {
    const shapeProblems = transformCommandProblems(command);
    if (shapeProblems.length > 0) {
      return {
        ok: false,
        failure: {
          kind: "validation",
          problems: shapeProblems.map((message) => ({ path: "command", message })),
        },
      };
    }

    // Resolve the routing directive from the stored policy — the task kind's
    // fabric capability decides WHICH policy governs the run.
    const directive = await this.resolveDirectiveForKind(profileKey, command.kind, command.timeoutMs);

    const submitted = await this.engine.submit(profileKey, {
      kind: command.kind,
      input: command.input,
      options: directive,
    });
    if (!submitted.ok) {
      const failure = submitted.failure;
      if (failure.kind === "validation") {
        return { ok: false, failure: { kind: "validation", problems: failure.problems } };
      }
      if (failure.kind === "permission") {
        return { ok: false, failure: { kind: "permission", reason: failure.verdict.reason } };
      }
      return { ok: false, failure: { kind: "store-error", detail: failure.detail } };
    }

    // Schedule the run (background by default; tests collect deterministically).
    const id = submitted.operation.id;
    this.scheduler(() => this.engine.run(id, profileKey));
    return { ok: true, operation: submitted.operation };
  }

  /** Read one operation's current truth (state, progress, result, history). */
  async readTransform(
    profileKey: string,
    id: string,
  ): Promise<PersistedTransformOperation | null> {
    return this.operations.get(id, profileKey);
  }

  /** The profile's operations, newest first. */
  async listTransforms(profileKey: string): Promise<readonly PersistedTransformOperation[]> {
    return this.operations.listForOwner(profileKey);
  }

  /** Cancel one operation (legal from queued/running — the user's undo). */
  async cancelTransform(
    profileKey: string,
    id: string,
  ): Promise<
    | { ok: true; operation: PersistedTransformOperation }
    | { ok: false; failure: { kind: "not-found" | "invalid-state"; detail: string; state?: string } }
  > {
    const cancelled = await this.engine.cancel(id, profileKey);
    if (cancelled.ok) {
      const snapshot = await this.operations.get(id, profileKey);
      if (snapshot === null) {
        return { ok: false, failure: { kind: "not-found", detail: "the operation vanished" } };
      }
      return { ok: true, operation: snapshot };
    }
    const failure = cancelled.failure;
    if (failure.kind === "not-found") {
      return { ok: false, failure: { kind: "not-found", detail: failure.detail } };
    }
    return {
      ok: false,
      failure: {
        kind: "invalid-state",
        detail: failure.detail,
        ...(failure.kind === "invalid-state" ? { state: failure.state } : {}),
      },
    };
  }

  /** Result cleanup: clear the result material, keep the record + history. */
  async clearTransformResult(profileKey: string, id: string): Promise<boolean> {
    return this.operations.clearResult(id, profileKey);
  }

  // — internals ——————————————————————————————————————————————————————————

  /**
   * Resolve the routing directive for one transformation kind: the stored
   * policy for the kind's fabric ModelTask, with the BYOM replacement
   * applied (a binding REPLACES the first-party route for its tasks).
   * Absent a stored policy the directive is fail-closed `local-only`.
   */
  private async resolveDirectiveForKind(
    profileKey: string,
    kind: string,
    timeoutMs?: number,
  ): Promise<Record<string, unknown>> {
    const modelTask = modelTaskOfKind(kind);
    if (modelTask === null) {
      // Unknown kinds are refused by the engine's validation; the directive
      // for that path is irrelevant — answer the fail-closed floor.
      return { privacy: "local-only", fallbackProviders: [], ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
    }
    const resolution = await this.resolveEffective(profileKey, modelTask);
    const options = resolution.policy;
    return {
      privacy: options.privacy,
      ...(options.preferredProvider !== undefined ? { preferredProvider: options.preferredProvider } : {}),
      fallbackProviders: options.fallbackProviders,
      ...(options.maxCostPerOperation !== undefined
        ? { maxCostPerOperation: options.maxCostPerOperation }
        : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    };
  }

  private async resolveEffective(
    profileKey: string,
    task: ModelTask,
  ): Promise<EffectivePolicyResolution> {
    const stored = await this.policies.loadPolicy(profileKey, task as ModelTaskName);
    const bound = await this.bindings.listBindings(profileKey);
    const summaries: ByomBindingSummary[] = bound.map((record) => ({
      providerId: record.providerId,
      privacy: record.privacy === "local-only" ? "local" : "cloud",
      tasks: record.tasks as readonly ModelTask[],
    }));
    return resolveEffectiveModelPolicy({
      task,
      ...(stored !== null ? { stored: stored as unknown as ModelPolicy } : {}),
      byomBindings: summaries,
      registry: this.registry,
      firstPartyProviderId: WFX_MODEL_ID,
    });
  }
}

/** The fabric ModelTask a transformation kind routes through (the task map). */
const KIND_TO_MODEL_TASK: Readonly<Record<string, ModelTask>> = {
  transcript: "transcription",
  translation: "translation",
  subtitle: "translation",
  summary: "summary",
  speech: "textToSpeech",
  transcribe: "speechToText",
  dubbing: "dubbing",
  commentary: "commentary",
};

function modelTaskOfKind(kind: string): ModelTask | null {
  return KIND_TO_MODEL_TASK[kind] ?? null;
}

/** The host part of an endpoint URL (display metadata — never key material). */
function endpointHostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid-url";
  }
}

function preview(value: unknown): string {
  let rendered: string;
  try {
    rendered = JSON.stringify(value) ?? String(value);
  } catch {
    rendered = String(value);
  }
  return rendered.length > 60 ? `${rendered.slice(0, 57)}...` : rendered;
}
