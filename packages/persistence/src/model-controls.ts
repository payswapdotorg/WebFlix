/**
 * @wfx/persistence — R06 model and AI controls stores (model policy, BYOM
 * provider bindings, transform operations).
 *
 * The durable side of the R06 control surface (migration 0011):
 *
 * - `PostgresModelPolicyStore` — the per-profile model policy in the FROZEN
 *   `ModelPolicy` shape (one per (profile key, task), upserted). The
 *   task/privacy vocabularies are validated HERE (locally-mirrored unions —
 *   the connector-accounts precedent: mirrored LOCALLY, not imported, so no
 *   dependency cycle) and CHECK-enforced in SQL (the last line of defense).
 * - `PostgresModelProviderBindingStore` — the BYOM provider bindings, ONE
 *   per (profile key, provider id), with the API key sealed via
 *   AES-256-GCM envelope encryption (the connector-accounts discipline
 *   verbatim: plaintext NEVER at rest; `key_id` mismatch detected BEFORE
 *   decryption; `loadBinding` opens the secret for the PROVIDER TRANSPORT
 *   lane ONLY — every read surface serves the secret-free record).
 *   THE DOUBLED PRIVACY LAW: BYOM keys never enter logs, URLs, or model
 *   prompts — the only method that can produce the key is `loadBinding`
 *   (the transport lane), mirroring `loadAccount` exactly.
 * - `PostgresTransformOperationStore` — the EXPLICIT AI transformation
 *   operation records with the APPEND-ONLY state history
 *   (`transform_operation_events` is insert-only: no code path updates or
 *   deletes a history row). State transitions are guarded by the expected
 *   prior state (typed `conflict` on mismatch — never a silent overwrite).
 *   Implements the model-fabric `TransformOperationStore` seam
 *   STRUCTURALLY (the lane law — the shapes are identical, no import).
 *
 * Determinism: clock + ids are injected seams; no Date.now, no crypto
 * beyond the envelope module's own primitives.
 */

import { classifyDriverError } from "./classify";
import { CredentialDecryptError, PersistenceError } from "./errors";
import {
  keyIdFor,
  openSecret,
  sealSecret,
  type SealedSecret,
} from "./envelope-crypto";
import { epochMsToIso, toIsoTimestamp, type DbClient } from "./sql";
import type { Clock } from "@wfx/experience";

// ---------------------------------------------------------------------------
// Vocabulary mirrors (frozen unions, mirrored LOCALLY — the precedent law)
// ---------------------------------------------------------------------------

/** The frozen `ModelTask` union (mirrored from @wfx/domain — see module doc). */
export type ModelTaskName =
  | "recommendation"
  | "ranking"
  | "summary"
  | "translation"
  | "transcription"
  | "speechToText"
  | "textToSpeech"
  | "dubbing"
  | "commentary";

/** Runtime list of the frozen ModelTask members. */
export const MODEL_TASK_NAMES: readonly ModelTaskName[] = [
  "recommendation",
  "ranking",
  "summary",
  "translation",
  "transcription",
  "speechToText",
  "textToSpeech",
  "dubbing",
  "commentary",
] as const;

/** The frozen `ModelPolicy["privacy"]` union (mirrored). */
export type ModelPolicyPrivacyName = "local-only" | "trusted-cloud" | "any-cloud";

/** Runtime list of the privacy classes. */
export const MODEL_POLICY_PRIVACY_NAMES: readonly ModelPolicyPrivacyName[] = [
  "local-only",
  "trusted-cloud",
  "any-cloud",
] as const;

/** The transformation task kinds (mirrored from the fabric's closed vocabulary). */
export type TransformKindName =
  | "transcript"
  | "translation"
  | "subtitle"
  | "summary"
  | "speech"
  | "transcribe"
  | "dubbing"
  | "commentary";

/** Runtime list of the transformation kinds. */
export const TRANSFORM_KIND_NAMES: readonly TransformKindName[] = [
  "transcript",
  "translation",
  "subtitle",
  "summary",
  "speech",
  "transcribe",
  "dubbing",
  "commentary",
] as const;

/** The transform operation states (mirrored). */
export type TransformOperationStateName =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

/** Runtime list of the operation states. */
export const TRANSFORM_OPERATION_STATE_NAMES: readonly TransformOperationStateName[] = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

/** The transform transition event kinds (mirrored). */
export type TransformEventKindName = "start" | "succeed" | "fail" | "cancel";

/** Runtime list of the event kinds. */
export const TRANSFORM_EVENT_KIND_NAMES: readonly TransformEventKindName[] = [
  "start",
  "succeed",
  "fail",
  "cancel",
] as const;

// ---------------------------------------------------------------------------
// The persisted shapes (structurally the fabric's — the lane law)
// ---------------------------------------------------------------------------

/**
 * The persisted model policy — the FROZEN `ModelPolicy` shape, mirrored
 * locally (task, preferred provider, non-empty fallback chain, privacy
 * class, optional cost ceiling >= 0).
 */
export interface PersistedModelPolicy {
  readonly task: ModelTaskName;
  readonly preferredProvider?: string;
  readonly fallbackProviders: readonly string[];
  readonly privacy: ModelPolicyPrivacyName;
  readonly maxCostPerOperation?: number;
}

/**
 * The BYOM provider binding record WITHOUT the key (safe to log/hand
 * around — the structurally secret-free projection; the ONLY method that
 * can produce the key is `loadBinding`, the provider-transport lane).
 */
export interface ByomBindingRecord {
  /** Canonical binding id (`wfxbyom_` + 26-char ULID body). */
  readonly id: string;
  readonly profileKey: string;
  readonly providerId: string;
  /** The binding's endpoint URL (public metadata — never key material). */
  readonly endpoint: string;
  /** The frozen ModelTasks this binding covers. */
  readonly tasks: readonly ModelTaskName[];
  /** The binding's privacy class (where the bound model's input may travel). */
  readonly privacy: ModelPolicyPrivacyName;
  /** Rotation fingerprint of the key that sealed the stored API key. */
  readonly keyId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A binding plus its OPENED API key (caller-only visibility — the transport lane). */
export interface OpenedByomBinding extends ByomBindingRecord {
  readonly apiKey: string;
}

/** One append-only state-history row (field-aligned with the fabric's entry — the lane law's structural seam). */
export interface PersistedTransformEvent {
  readonly from: TransformOperationStateName;
  readonly to: TransformOperationStateName;
  readonly event: TransformEventKindName;
  readonly reason?: string;
  readonly at: string;
}

/**
 * The persisted transform operation snapshot — structurally the fabric's
 * `TransformOperationSnapshot` (input/options/result round-trip as jsonb;
 * the state history read from the insert-only events table; the error kind
 * mirrors the fabric's closed union).
 */
export interface PersistedTransformOperation {
  readonly id: string;
  readonly ownerKey: string;
  readonly kind: TransformKindName;
  readonly input: unknown;
  readonly options: unknown;
  readonly state: TransformOperationStateName;
  readonly progress?: number;
  readonly result?: {
    reference: string;
    providerId: string;
    output: unknown;
    costEstimate: number;
    durationEstimateMs: number;
  };
  readonly error?: { kind: "validation" | "permission" | "cost-ceiling" | "fabric"; detail: string };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly stateHistory: readonly PersistedTransformEvent[];
}

// ---------------------------------------------------------------------------
// The model policy store
// ---------------------------------------------------------------------------

/** Constructor options. */
export interface ModelPolicyStoreOptions {
  readonly db: DbClient;
  readonly clock: Clock;
}

/** The maximum fallback-chain length (mirrors the fabric's control-surface bound). */
export const MAX_FALLBACK_PROVIDERS = 8;

/**
 * The per-profile model policy store: ONE policy per (profile key, task),
 * upserted. Validation is TOTAL (every problem named) and the SQL CHECK
 * constraints are the second line of defense.
 */
export class PostgresModelPolicyStore {
  private readonly db: DbClient;
  private readonly clock: Clock;

  constructor(options: ModelPolicyStoreOptions) {
    this.db = options.db;
    this.clock = options.clock;
  }

  /**
   * The stored policy for (profile key, task), or the HONEST null when
   * unset (never a fabricated default-as-if-configured — the R05 honesty
   * law, applied to model policy).
   */
  async loadPolicy(profileKey: string, task: ModelTaskName): Promise<PersistedModelPolicy | null> {
    if (typeof profileKey !== "string" || profileKey.length === 0) {
      throw new PersistenceError("invalid-input", "profileKey: expected a non-empty string", {
        operation: "modelPolicies.loadPolicy",
      });
    }
    if (!MODEL_TASK_NAMES.includes(task)) {
      throw new PersistenceError("invalid-input", "task: expected a frozen ModelTask value", {
        operation: "modelPolicies.loadPolicy",
      });
    }
    try {
      const rows = await this.db.query<PolicySqlRow>(
        `SELECT * FROM model_policies WHERE profile_key = $1 AND task = $2`,
        [profileKey, task],
      );
      const row = rows[0];
      return row === undefined ? null : mapPolicyRow(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "modelPolicies.loadPolicy");
    }
  }

  /** Every stored policy for the profile key (all tasks), keyed by task. */
  async listPolicies(profileKey: string): Promise<readonly PersistedModelPolicy[]> {
    if (typeof profileKey !== "string" || profileKey.length === 0) {
      throw new PersistenceError("invalid-input", "profileKey: expected a non-empty string", {
        operation: "modelPolicies.listPolicies",
      });
    }
    try {
      const rows = await this.db.query<PolicySqlRow>(
        `SELECT * FROM model_policies WHERE profile_key = $1 ORDER BY task`,
        [profileKey],
      );
      return rows.map(mapPolicyRow);
    } catch (thrown) {
      throw classifyDriverError(thrown, "modelPolicies.listPolicies");
    }
  }

  /**
   * Upsert the policy for (profile key, policy.task). TOTAL validation:
   * every problem is named in ONE typed failure (the API's 400 channel
   * echoes them). Re-saving REPLACES the policy for that task (a policy is
   * a configuration, not a log — the connector-accounts upsert law).
   */
  async savePolicy(profileKey: string, policy: PersistedModelPolicy): Promise<PersistedModelPolicy> {
    const problems = policyProblems(policy);
    if (typeof profileKey !== "string" || profileKey.length === 0) {
      problems.unshift("profileKey: expected a non-empty string");
    }
    if (problems.length > 0) {
      throw new PersistenceError("invalid-input", problems.join("; "), {
        operation: "modelPolicies.savePolicy",
      });
    }

    const nowIso = epochMsToIso(this.clock.now());
    try {
      const rows = await this.db.query<PolicySqlRow>(
        `INSERT INTO model_policies (profile_key, task, preferred_provider, fallback_providers,
                                      privacy, max_cost_per_operation, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $7)
         ON CONFLICT (profile_key, task) DO UPDATE SET
           preferred_provider = EXCLUDED.preferred_provider,
           fallback_providers = EXCLUDED.fallback_providers,
           privacy = EXCLUDED.privacy,
           max_cost_per_operation = EXCLUDED.max_cost_per_operation,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          profileKey,
          policy.task,
          policy.preferredProvider ?? null,
          JSON.stringify(policy.fallbackProviders),
          policy.privacy,
          policy.maxCostPerOperation ?? null,
          nowIso,
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("savePolicy: no row returned");
      return mapPolicyRow(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "modelPolicies.savePolicy");
    }
  }

  /** Delete the stored policy for (profile key, task). True when a row was removed. */
  async deletePolicy(profileKey: string, task: ModelTaskName): Promise<boolean> {
    try {
      const rows = await this.db.query<{ task: string }>(
        `DELETE FROM model_policies WHERE profile_key = $1 AND task = $2 RETURNING task`,
        [profileKey, task],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "modelPolicies.deletePolicy");
    }
  }
}

/** Typed validation problems for a claimed policy (aggregated, never thrown). */
function policyProblems(policy: PersistedModelPolicy): string[] {
  const problems: string[] = [];
  if (!MODEL_TASK_NAMES.includes(policy?.task)) {
    problems.push(`task: expected one of ${MODEL_TASK_NAMES.join(" | ")}`);
  }
  if (!MODEL_POLICY_PRIVACY_NAMES.includes(policy?.privacy)) {
    problems.push(`privacy: expected one of ${MODEL_POLICY_PRIVACY_NAMES.join(" | ")}`);
  }
  if (!Array.isArray(policy?.fallbackProviders) || policy.fallbackProviders.length === 0) {
    problems.push("fallbackProviders: expected a NON-EMPTY array of provider ids");
  } else if (policy.fallbackProviders.length > MAX_FALLBACK_PROVIDERS) {
    problems.push(`fallbackProviders: expected at most ${MAX_FALLBACK_PROVIDERS} entries`);
  } else if (!policy.fallbackProviders.every((id) => typeof id === "string" && id.trim().length > 0)) {
    problems.push("fallbackProviders: expected non-empty provider id strings");
  }
  if (
    policy?.preferredProvider !== undefined &&
    (typeof policy.preferredProvider !== "string" || policy.preferredProvider.trim().length === 0)
  ) {
    problems.push("preferredProvider: expected a non-empty string when present");
  }
  if (
    policy?.maxCostPerOperation !== undefined &&
    (typeof policy.maxCostPerOperation !== "number" ||
      !Number.isFinite(policy.maxCostPerOperation) ||
      policy.maxCostPerOperation < 0)
  ) {
    problems.push("maxCostPerOperation: expected a finite number >= 0 when present");
  }
  return problems;
}

interface PolicySqlRow {
  profile_key: string;
  task: string;
  preferred_provider: string | null;
  fallback_providers: unknown;
  privacy: string;
  max_cost_per_operation: number | null;
  created_at: unknown;
  updated_at: unknown;
}

function mapPolicyRow(row: PolicySqlRow): PersistedModelPolicy {
  const fallback = Array.isArray(row.fallback_providers)
    ? (row.fallback_providers as unknown[]).filter((id): id is string => typeof id === "string")
    : [];
  return {
    task: row.task as ModelTaskName,
    ...(row.preferred_provider !== null ? { preferredProvider: row.preferred_provider } : {}),
    fallbackProviders: fallback,
    privacy: row.privacy as ModelPolicyPrivacyName,
    ...(row.max_cost_per_operation !== null && row.max_cost_per_operation !== undefined
      ? { maxCostPerOperation: row.max_cost_per_operation }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// The BYOM provider binding store
// ---------------------------------------------------------------------------

/** Constructor options. */
export interface ModelProviderBindingStoreOptions {
  readonly db: DbClient;
  readonly clock: Clock;
  /** The decoded APP_ENCRYPTION_KEY (see `decodeEncryptionKey`). */
  readonly key: Uint8Array;
  /** Id seam for canonical binding ids (tests inject a sequential gen). */
  readonly ids: { next(): string };
}

/** Typed load outcome (the connector-accounts load law, verbatim). */
export type LoadBindingResult =
  | { ok: true; binding: OpenedByomBinding }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "key-mismatch"; storedKeyId: string; expectedKeyId: string }
  | { ok: false; reason: "decrypt-failed"; detail: string };

/** The persistence-owned binding-id prefix (canonical ULID scheme). */
export const BYOM_BINDING_ID_PREFIX = "wfxbyom_";

/** The maximum tasks a single binding may cover (bounded, reviewable). */
export const MAX_BINDING_TASKS = 9; // the full frozen ModelTask set

/**
 * The BYOM provider binding store: ONE binding per (profile key, provider
 * id), upserted. The API key is SEALED (AES-256-GCM envelope) before it
 * ever reaches SQL; plaintext is NEVER at rest. Re-saving REPLACES the
 * sealed material (rotation / re-binding) and keeps the binding id +
 * created_at stable — the connector-accounts "reauthorize preserves the
 * row" law.
 */
export class PostgresModelProviderBindingStore {
  private readonly db: DbClient;
  private readonly clock: Clock;
  private readonly key: Uint8Array;
  private readonly ids: { next(): string };

  constructor(options: ModelProviderBindingStoreOptions) {
    if (options.key.byteLength !== 32) {
      throw new PersistenceError(
        "config-error",
        "ModelProviderBindingStore requires the decoded 32-byte APP_ENCRYPTION_KEY " +
          "(see decodeEncryptionKey) — got a key of a different length.",
        { operation: "ModelProviderBindingStore" },
      );
    }
    this.db = options.db;
    this.clock = options.clock;
    this.key = options.key;
    this.ids = options.ids;
  }

  /**
   * Insert or update one binding, SEALING the API key under the configured
   * key. One binding per (profile key, provider id): a re-save REPLACES the
   * sealed material and keeps the binding id + created_at stable. Returns
   * the record WITHOUT the key (the PUT answers a handle + metadata only).
   */
  async saveBinding(input: {
    profileKey: string;
    providerId: string;
    endpoint: string;
    tasks: readonly ModelTaskName[];
    privacy: ModelPolicyPrivacyName;
    /** The RAW API key — sealed here, never persisted in the clear. */
    apiKey: string;
  }): Promise<ByomBindingRecord> {
    const problems: string[] = [];
    if (typeof input.profileKey !== "string" || input.profileKey.length === 0) {
      problems.push("profileKey: expected a non-empty string");
    }
    if (typeof input.providerId !== "string" || input.providerId.trim().length === 0) {
      problems.push("providerId: expected a non-empty string");
    }
    if (typeof input.endpoint !== "string" || !/^https?:\/\//.test(input.endpoint)) {
      problems.push("endpoint: expected an absolute http(s) URL");
    }
    if (!Array.isArray(input.tasks) || input.tasks.length === 0) {
      problems.push("tasks: expected a NON-EMPTY array of ModelTask values");
    } else if (input.tasks.length > MAX_BINDING_TASKS) {
      problems.push(`tasks: expected at most ${MAX_BINDING_TASKS} entries`);
    } else if (!input.tasks.every((task) => MODEL_TASK_NAMES.includes(task))) {
      problems.push(`tasks: expected frozen ModelTask values (${MODEL_TASK_NAMES.join(" | ")})`);
    }
    if (!MODEL_POLICY_PRIVACY_NAMES.includes(input.privacy)) {
      problems.push(`privacy: expected one of ${MODEL_POLICY_PRIVACY_NAMES.join(" | ")}`);
    }
    if (typeof input.apiKey !== "string" || input.apiKey.length === 0) {
      problems.push("apiKey: expected a non-empty string");
    } else if (input.apiKey.length > 4096) {
      problems.push("apiKey: expected at most 4096 characters");
    }
    if (problems.length > 0) {
      throw new PersistenceError("invalid-input", problems.join("; "), {
        operation: "modelProviderBindings.saveBinding",
      });
    }

    const nowIso = epochMsToIso(this.clock.now());
    const sealed: SealedSecret = sealSecret(this.key, input.apiKey);
    const id = `${BYOM_BINDING_ID_PREFIX}${this.ids.next()}`;
    try {
      const rows = await this.db.query<BindingSqlRow>(
        `INSERT INTO model_provider_bindings (id, profile_key, provider_id, endpoint, tasks, privacy,
                                               ciphertext, iv, auth_tag, key_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $11)
         ON CONFLICT (profile_key, provider_id) DO UPDATE SET
           endpoint = EXCLUDED.endpoint,
           tasks = EXCLUDED.tasks,
           privacy = EXCLUDED.privacy,
           ciphertext = EXCLUDED.ciphertext,
           iv = EXCLUDED.iv,
           auth_tag = EXCLUDED.auth_tag,
           key_id = EXCLUDED.key_id,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          id,
          input.profileKey,
          input.providerId,
          input.endpoint,
          JSON.stringify(input.tasks),
          input.privacy,
          sealed.ciphertext,
          sealed.iv,
          sealed.authTag,
          sealed.keyId,
          nowIso,
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("saveBinding: no row returned");
      return mapBindingRow(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "modelProviderBindings.saveBinding");
    }
  }

  /**
   * Load one binding and OPEN its API key — the PROVIDER TRANSPORT LANE
   * ONLY (mirroring `loadAccount`: the opened key is handed to the caller
   * only, never logged, never persisted, never surfaced in any read view).
   * Typed outcomes: `not-found`, `key-mismatch` (rotation detection),
   * `decrypt-failed` (tampered envelope).
   */
  async loadBinding(profileKey: string, providerId: string): Promise<LoadBindingResult> {
    let row: BindingSqlRow | undefined;
    try {
      const rows = await this.db.query<BindingSqlRow>(
        `SELECT * FROM model_provider_bindings WHERE profile_key = $1 AND provider_id = $2`,
        [profileKey, providerId],
      );
      row = rows[0];
    } catch (thrown) {
      throw classifyDriverError(thrown, "modelProviderBindings.loadBinding");
    }
    if (row === undefined) return { ok: false, reason: "not-found" };

    const expectedKeyId = keyIdFor(this.key);
    if (row.key_id !== expectedKeyId) {
      return {
        ok: false,
        reason: "key-mismatch",
        storedKeyId: row.key_id,
        expectedKeyId,
      };
    }

    let apiKey: string;
    try {
      apiKey = openSecret(this.key, {
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.auth_tag,
      });
    } catch (thrown) {
      const detail =
        thrown instanceof CredentialDecryptError
          ? thrown.message
          : "binding envelope failed to open";
      return { ok: false, reason: "decrypt-failed", detail };
    }
    return { ok: true, binding: { ...mapBindingRow(row), apiKey } };
  }

  /** The profile's bindings — the SECRET-FREE records (metadata only, never key material). */
  async listBindings(profileKey: string): Promise<readonly ByomBindingRecord[]> {
    try {
      const rows = await this.db.query<BindingSqlRow>(
        `SELECT * FROM model_provider_bindings WHERE profile_key = $1 ORDER BY provider_id`,
        [profileKey],
      );
      return rows.map(mapBindingRow);
    } catch (thrown) {
      throw classifyDriverError(thrown, "modelProviderBindings.listBindings");
    }
  }

  /**
   * Delete one binding (unbind). True when a row was removed — the sealed
   * envelope row is DESTROYED (the vault's delete discipline: the sealed
   * material goes with the row; nothing salvageable remains).
   */
  async deleteBinding(profileKey: string, providerId: string): Promise<boolean> {
    try {
      const rows = await this.db.query<{ id: string }>(
        `DELETE FROM model_provider_bindings WHERE profile_key = $1 AND provider_id = $2 RETURNING id`,
        [profileKey, providerId],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "modelProviderBindings.deleteBinding");
    }
  }
}

interface BindingSqlRow {
  id: string;
  profile_key: string;
  provider_id: string;
  endpoint: string;
  tasks: unknown;
  privacy: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  key_id: string;
  created_at: unknown;
  updated_at: unknown;
}

function mapBindingRow(row: BindingSqlRow): ByomBindingRecord {
  const tasks = Array.isArray(row.tasks)
    ? (row.tasks as unknown[]).filter((task): task is ModelTaskName =>
        MODEL_TASK_NAMES.includes(task as ModelTaskName),
      )
    : [];
  return {
    id: row.id,
    profileKey: row.profile_key,
    providerId: row.provider_id,
    endpoint: row.endpoint,
    tasks,
    privacy: row.privacy as ModelPolicyPrivacyName,
    keyId: row.key_id,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// The transform operation store
// ---------------------------------------------------------------------------

/** Constructor options. */
export interface TransformOperationStoreDeps {
  readonly db: DbClient;
  readonly clock: Clock;
}

interface OperationSqlRow {
  id: string;
  owner_key: string;
  kind: string;
  input: unknown;
  options: unknown;
  state: string;
  progress: number | null;
  result: unknown;
  error_detail: unknown;
  created_at: unknown;
  updated_at: unknown;
}

interface EventSqlRow {
  operation_id: string;
  from_state: string;
  to_state: string;
  event: string;
  reason: string | null;
  occurred_at: unknown;
}

/**
 * The durable transform-operation store: the EXPLICIT state machine's
 * persistence. `transition` is ONE transaction: insert the append-only
 * history row + update the state (guarded by the expected prior state) +
 * stamp `updated_at`. The events table is INSERT-ONLY from this store's
 * surface — no method updates or deletes history rows.
 *
 * Structurally implements the model-fabric `TransformOperationStore` seam
 * (same member names and shapes; no import — the lane law).
 */
export class PostgresTransformOperationStore {
  private readonly db: DbClient;
  private readonly clock: Clock;

  constructor(deps: TransformOperationStoreDeps) {
    this.db = deps.db;
    this.clock = deps.clock;
  }

  /** Persist a NEW operation (the queued snapshot). The id is the caller's. */
  async create(
    snapshot: PersistedTransformOperation,
  ): Promise<PersistedTransformOperation> {
    const problems: string[] = [];
    if (typeof snapshot?.id !== "string" || snapshot.id.length === 0) {
      problems.push("id: expected a non-empty string");
    }
    if (typeof snapshot?.ownerKey !== "string" || snapshot.ownerKey.length === 0) {
      problems.push("ownerKey: expected a non-empty string");
    }
    if (!TRANSFORM_KIND_NAMES.includes(snapshot?.kind as TransformKindName)) {
      problems.push(`kind: expected one of ${TRANSFORM_KIND_NAMES.join(" | ")}`);
    }
    if (snapshot?.state !== "queued") {
      problems.push("state: a NEW operation must be 'queued'");
    }
    if (snapshot?.stateHistory !== undefined && snapshot.stateHistory.length > 0) {
      problems.push("stateHistory: a NEW operation has no history");
    }
    if (problems.length > 0) {
      throw new PersistenceError("invalid-input", problems.join("; "), {
        operation: "transformOperations.create",
      });
    }

    try {
      await this.db.query(
        `INSERT INTO transform_operations (id, owner_key, kind, input, options, state, progress,
                                            result, error_detail, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $10)`,
        [
          snapshot.id,
          snapshot.ownerKey,
          snapshot.kind,
          JSON.stringify(snapshot.input ?? null),
          JSON.stringify(snapshot.options ?? {}),
          snapshot.state,
          null,
          null,
          null,
          epochMsToIso(this.clock.now()),
        ],
      );
      return this.get(snapshot.id, snapshot.ownerKey).then((found) => {
        if (found === null) throw new Error("create: the row vanished after insert");
        return found;
      });
    } catch (thrown) {
      throw classifyDriverError(thrown, "transformOperations.create");
    }
  }

  /** One operation by id + owner (null when unknown or not owned — honest miss). */
  async get(id: string, ownerKey: string): Promise<PersistedTransformOperation | null> {
    try {
      const rows = await this.db.query<OperationSqlRow>(
        `SELECT * FROM transform_operations WHERE id = $1 AND owner_key = $2`,
        [id, ownerKey],
      );
      const row = rows[0];
      if (row === undefined) return null;
      const history = await this.historyOf(id);
      return mapOperationRow(row, history);
    } catch (thrown) {
      throw classifyDriverError(thrown, "transformOperations.get");
    }
  }

  /** The owner's operations, newest first. */
  async listForOwner(ownerKey: string): Promise<readonly PersistedTransformOperation[]> {
    try {
      const rows = await this.db.query<OperationSqlRow>(
        `SELECT * FROM transform_operations WHERE owner_key = $1 ORDER BY created_at DESC, id DESC`,
        [ownerKey],
      );
      if (rows.length === 0) return [];
      const ids = rows.map((row) => row.id);
      const eventRows = await this.db.query<EventSqlRow>(
        `SELECT * FROM transform_operation_events WHERE operation_id = ANY($1::text[]) ORDER BY id`,
        [ids],
      );
      const byOperation = new Map<string, EventSqlRow[]>();
      for (const eventRow of eventRows) {
        const list = byOperation.get(eventRow.operation_id) ?? [];
        list.push(eventRow);
        byOperation.set(eventRow.operation_id, list);
      }
      return rows.map((row) =>
        mapOperationRow(row, (byOperation.get(row.id) ?? []).map(mapEventRow)),
      );
    } catch (thrown) {
      throw classifyDriverError(thrown, "transformOperations.listForOwner");
    }
  }

  /**
   * Apply ONE transition atomically: insert the append-only history row,
   * update the state (+ result/error fields), stamp `updated_at` — guarded
   * by `expectedFrom` (mismatch ⇒ the typed `conflict`, never a silent
   * overwrite). The event's derived fields (to/reason/result/error) come
   * from the event itself.
   */
  async transition(input: {
    id: string;
    ownerKey: string;
    event:
      | { kind: "start"; at: string }
      | { kind: "succeed"; at: string; result: { reference: string; providerId: string; output: unknown; costEstimate: number; durationEstimateMs: number } }
      | { kind: "fail"; at: string; error: { kind: "validation" | "permission" | "cost-ceiling" | "fabric"; detail: string } }
      | { kind: "cancel"; at: string; reason?: string };
    expectedFrom: TransformOperationStateName;
  }): Promise<
    | { ok: true; snapshot: PersistedTransformOperation }
    | { ok: false; failure: { kind: "not-found" | "conflict" | "store-error"; detail: string } }
  > {
    const { id, ownerKey, event, expectedFrom } = input;
    const toState: TransformOperationStateName =
      event.kind === "start"
        ? "running"
        : event.kind === "succeed"
          ? "succeeded"
          : event.kind === "fail"
            ? "failed"
            : "cancelled";
    const reason =
      event.kind === "fail"
        ? event.error.detail
        : event.kind === "cancel"
          ? (event.reason ?? null)
          : null;

    try {
      const updated = await this.db.begin(async (tx) => {
        // 1. The guarded state update (the whole transition's authority).
        const rows = await tx.query<OperationSqlRow>(
          `UPDATE transform_operations
              SET state = $3,
                  result = $4::jsonb,
                  error_detail = $5::jsonb,
                  updated_at = $6
            WHERE id = $1 AND owner_key = $2 AND state = $7
          RETURNING *`,
          [
            id,
            ownerKey,
            toState,
            event.kind === "succeed" ? JSON.stringify(event.result) : null,
            event.kind === "fail" ? JSON.stringify(event.error) : null,
            epochMsToIso(this.clock.now()),
            expectedFrom,
          ],
        );
        if (rows.length === 0) {
          // Not found, or the state moved underneath us — which one?
          const probe = await tx.query<{ state: string }>(
            `SELECT state FROM transform_operations WHERE id = $1 AND owner_key = $2`,
            [id, ownerKey],
          );
          if (probe.length === 0) {
            return { outcome: "not-found" as const };
          }
          return { outcome: "conflict" as const, state: probe[0]!.state };
        }

        // 2. The append-only history row (insert-only — never rewritten).
        await tx.query(
          `INSERT INTO transform_operation_events (operation_id, from_state, to_state, event, reason, occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, expectedFrom, toState, event.kind, reason, event.at],
        );
        return { outcome: "updated" as const };
      });

      if (updated.outcome === "not-found") {
        return {
          ok: false,
          failure: { kind: "not-found", detail: `no transform operation '${id}' for this profile` },
        };
      }
      if (updated.outcome === "conflict") {
        return {
          ok: false,
          failure: {
            kind: "conflict",
            detail: `the operation is '${updated.state}', not '${expectedFrom}' — the transition was refused (never a silent overwrite)`,
          },
        };
      }
      const snapshot = await this.get(id, ownerKey);
      if (snapshot === null) {
        return {
          ok: false,
          failure: { kind: "store-error", detail: "the operation vanished mid-transition" },
        };
      }
      return { ok: true, snapshot };
    } catch (thrown) {
      const classified = classifyDriverError(thrown, "transformOperations.transition");
      return {
        ok: false,
        failure: { kind: "store-error", detail: classified.message },
      };
    }
  }

  /** Persist a fabric-reported progress update (field update — never a history rewrite). */
  async updateProgress(id: string, ownerKey: string, progress: number): Promise<void> {
    if (typeof progress !== "number" || !Number.isFinite(progress) || progress < 0 || progress > 1) {
      throw new PersistenceError("invalid-input", "progress: expected a finite number in [0, 1]", {
        operation: "transformOperations.updateProgress",
      });
    }
    try {
      await this.db.query(
        `UPDATE transform_operations SET progress = $3, updated_at = $4 WHERE id = $1 AND owner_key = $2`,
        [id, ownerKey, progress, epochMsToIso(this.clock.now())],
      );
    } catch (thrown) {
      throw classifyDriverError(thrown, "transformOperations.updateProgress");
    }
  }

  /**
   * Result cleanup: clear the result material AND the reported progress from
   * a `succeeded` operation, keeping the record + state history (audit
   * truth). True when a result was cleaned; false when none existed.
   */
  async clearResult(id: string, ownerKey: string): Promise<boolean> {
    try {
      const rows = await this.db.query<{ id: string }>(
        `UPDATE transform_operations
            SET result = NULL, progress = NULL, updated_at = $3
          WHERE id = $1 AND owner_key = $2 AND result IS NOT NULL
        RETURNING id`,
        [id, ownerKey, epochMsToIso(this.clock.now())],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "transformOperations.clearResult");
    }
  }

  /** The append-only history rows of one operation, in insert order. */
  private async historyOf(id: string): Promise<readonly PersistedTransformEvent[]> {
    const rows = await this.db.query<EventSqlRow>(
      `SELECT * FROM transform_operation_events WHERE operation_id = $1 ORDER BY id`,
      [id],
    );
    return rows.map(mapEventRow);
  }
}

function mapOperationRow(
  row: OperationSqlRow,
  history: readonly PersistedTransformEvent[],
): PersistedTransformOperation {
  const result = row.result as
    | { reference: string; providerId: string; output: unknown; costEstimate: number; durationEstimateMs: number }
    | null;
  const error = row.error_detail as
    | { kind: "validation" | "permission" | "cost-ceiling" | "fabric"; detail: string }
    | null;
  return {
    id: row.id,
    ownerKey: row.owner_key,
    kind: row.kind as TransformKindName,
    input: row.input,
    options: row.options ?? {},
    state: row.state as TransformOperationStateName,
    ...(row.progress !== null && row.progress !== undefined ? { progress: row.progress } : {}),
    ...(result !== null && result !== undefined ? { result } : {}),
    ...(error !== null && error !== undefined ? { error } : {}),
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
    stateHistory: history,
  };
}

function mapEventRow(row: EventSqlRow): PersistedTransformEvent {
  return {
    from: row.from_state as TransformOperationStateName,
    to: row.to_state as TransformOperationStateName,
    event: row.event as TransformEventKindName,
    ...(row.reason !== null && row.reason !== undefined ? { reason: row.reason } : {}),
    at: toIsoTimestamp(row.occurred_at),
  };
}
