/**
 * @wfx/persistence — the per-profile model policy store (R06).
 *
 * Migration 0011's `model_policy` table: the durable side of the frozen
 * `ModelPolicy` contract (`packages/domain/src/contracts/frozen.ts` —
 * FROZEN, consumed as-is, never redefined here):
 *
 *   {
 *     task: ModelTask;
 *     preferredProvider?: string;
 *     fallbackProviders: string[];
 *     privacy: 'local-only' | 'trusted-cloud' | 'any-cloud';
 *     maxCostPerOperation?: number;
 *   }
 *
 * One row per (effective profile, ModelTask). The effective-profile key
 * is the migration-0007 pattern (the R04/R05 effective-profile law):
 * COALESCE(profile_id, 'user:' || user_id) — a NULL profile_id falls back
 * to the per-user bucket. Reads/writes are profile-scoped; the active
 * profile's policy never crosses into another profile.
 *
 * LAWS:
 * - VALIDATION: the store validates against the frozen contract's
 *   vocabulary (privacy class membership, non-empty fallback list, cost
 *   ceiling >= 0 when present). The closed ModelTask vocabulary is
 *   enforced at the API boundary (the typed 400 channel) AND by the
 *   database's CHECK constraint (the last line of defense). The store
 *   never silently coerces bad input — a malformed policy throws the
 *   typed `PersistenceError` (kind `invalid-input`).
 * - UPSERT: re-writing a task's policy REPLACES it (rotation) while
 *   keeping the canonical id + created_at stable (the same law as
 *   connector-accounts: reauthorize preserves the row).
 * - HONEST NULL: a read for a task with no stored policy answers null —
 *   NEVER a fabricated default-as-if-configured (the R05 honesty law).
 *
 * THE PRIVACY LAW: this store carries NO credentials, NO model prompts,
 * NO BYOM keys — only the routing POLICY. The fabric router enforces it
 * against the registry at invoke time. Provider credentials and BYOM
 * keys live in `byom-bindings.ts` (envelope-encrypted).
 */

import { classifyDriverError } from "./classify";
import { PersistenceError } from "./errors";
import { epochMsToIso, toIsoTimestamp, type DbClient } from "./sql";
import type { Clock, IdGen } from "@wfx/experience";
import type { ModelPolicy, ModelTask } from "@wfx/domain";

/** Prefix for model-policy ids minted by this store. */
export const MODEL_POLICY_ID_PREFIX = "wfxmp_";

/** The frozen privacy vocabulary (mirrors the domain contract). */
export const MODEL_POLICY_PRIVACIES: readonly ModelPolicy["privacy"][] = [
  "local-only",
  "trusted-cloud",
  "any-cloud",
];

/** The frozen ModelTask vocabulary (mirrors the domain contract). */
export const MODEL_TASKS: readonly ModelTask[] = [
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

/** Runtime membership check against the frozen `ModelTask` union. */
export function isModelTask(x: unknown): x is ModelTask {
  return typeof x === "string" && (MODEL_TASKS as readonly string[]).includes(x);
}

/** Runtime membership check against the frozen `privacy` union. */
export function isModelPolicyPrivacy(x: unknown): x is ModelPolicy["privacy"] {
  return (
    typeof x === "string" &&
    (MODEL_POLICY_PRIVACIES as readonly string[]).includes(x as ModelPolicy["privacy"])
  );
}

/** A stored model-policy row (the frozen ModelPolicy shape, profile-scoped). */
export interface PersistedModelPolicy {
  /** Canonical id (`wfxmp_` + 26-char ULID body). */
  readonly id: string;
  readonly userId: string;
  /** The effective profile id (null when the policy is user-scoped). */
  readonly profileId: string | null;
  readonly task: ModelTask;
  readonly preferredProvider: string | null;
  readonly fallbackProviders: readonly string[];
  readonly privacy: ModelPolicy["privacy"];
  readonly maxCostPerOperation: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Constructor dependencies. */
export interface ModelPolicyStoreOptions {
  readonly db: DbClient;
  readonly clock: Clock;
  readonly ids: IdGen;
}

interface PolicySqlRow {
  id: string;
  user_id: string;
  profile_id: string | null;
  task: string;
  preferred_provider: string | null;
  fallback_providers: unknown;
  privacy: string;
  max_cost_per_operation: number | null;
  created_at: unknown;
  updated_at: unknown;
}

function mapPolicy(row: PolicySqlRow): PersistedModelPolicy {
  const fallbackRaw = row.fallback_providers;
  let fallback: string[];
  if (Array.isArray(fallbackRaw)) {
    fallback = fallbackRaw.filter((id): id is string => typeof id === "string");
  } else if (typeof fallbackRaw === "string") {
    // Some drivers return jsonb columns as the JSON text (PGlite path).
    try {
      const parsed: unknown = JSON.parse(fallbackRaw);
      fallback = Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      fallback = [];
    }
  } else {
    fallback = [];
  }
  return {
    id: row.id,
    userId: row.user_id,
    profileId: row.profile_id,
    task: row.task as ModelTask,
    preferredProvider: row.preferred_provider,
    fallbackProviders: Object.freeze(fallback),
    privacy: row.privacy as ModelPolicy["privacy"],
    maxCostPerOperation: row.max_cost_per_operation,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

/** Validate a ModelPolicy against the frozen contract vocabulary. */
export function validateModelPolicy(policy: {
  task: unknown;
  fallbackProviders?: unknown;
  privacy?: unknown;
  maxCostPerOperation?: unknown;
}): readonly string[] {
  const problems: string[] = [];
  if (!isModelTask(policy.task)) {
    problems.push(
      `task: expected one of ${MODEL_TASKS.join(" | ")}, got ${JSON.stringify(policy.task)}`,
    );
  }
  if (policy.privacy !== undefined && !isModelPolicyPrivacy(policy.privacy)) {
    problems.push(
      `privacy: expected one of ${MODEL_POLICY_PRIVACIES.join(" | ")}, got ${JSON.stringify(policy.privacy)}`,
    );
  }
  if (policy.fallbackProviders !== undefined) {
    if (!Array.isArray(policy.fallbackProviders)) {
      problems.push(
        `fallbackProviders: expected an array of provider ids, got ${JSON.stringify(policy.fallbackProviders)}`,
      );
    } else if (
      !policy.fallbackProviders.every(
        (id) => typeof id === "string" && id.trim().length > 0,
      )
    ) {
      problems.push(
        `fallbackProviders: expected every entry to be a non-empty string, got ${JSON.stringify(policy.fallbackProviders)}`,
      );
    }
  }
  if (
    policy.maxCostPerOperation !== undefined &&
    (typeof policy.maxCostPerOperation !== "number" ||
      !Number.isFinite(policy.maxCostPerOperation) ||
      policy.maxCostPerOperation < 0)
  ) {
    problems.push(
      `maxCostPerOperation: expected a finite non-negative number when present, got ${JSON.stringify(policy.maxCostPerOperation)}`,
    );
  }
  return problems;
}

/**
 * The durable model-policy store. One row per (effective profile, ModelTask);
 * writes are UPSERTs (rotation preserves the canonical id + created_at).
 */
export class PostgresModelPolicyStore {
  private readonly db: DbClient;
  private readonly clock: Clock;
  private readonly ids: IdGen;

  constructor(options: ModelPolicyStoreOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.ids = options.ids;
  }

  /**
   * Read ONE task's policy for the effective profile. Returns null when
   * no policy is stored — the HONEST empty answer (never a fabricated
   * default-as-if-configured).
   */
  async readForTask(
    userId: string,
    profileId: string | null,
    task: ModelTask,
  ): Promise<PersistedModelPolicy | null> {
    if (!isModelTask(task)) {
      throw new PersistenceError("invalid-input", `task: expected a frozen ModelTask, got ${JSON.stringify(task)}`, {
        operation: "modelPolicy.readForTask",
      });
    }
    try {
      const rows = await this.db.query<PolicySqlRow>(
        `SELECT * FROM model_policy
          WHERE user_id = $1 AND COALESCE(profile_id, 'user:' || user_id) = COALESCE($2, 'user:' || user_id)
            AND task = $3`,
        [userId, profileId, task],
      );
      const row = rows[0];
      return row === undefined ? null : mapPolicy(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "modelPolicy.readForTask");
    }
  }

  /**
   * Read EVERY task's policy for the effective profile (oldest first).
   * Empty array when none stored (the honest empty list).
   */
  async listForProfile(
    userId: string,
    profileId: string | null,
  ): Promise<readonly PersistedModelPolicy[]> {
    try {
      const rows = await this.db.query<PolicySqlRow>(
        `SELECT * FROM model_policy
          WHERE user_id = $1 AND COALESCE(profile_id, 'user:' || user_id) = COALESCE($2, 'user:' || user_id)
          ORDER BY created_at, id`,
        [userId, profileId],
      );
      return rows.map(mapPolicy);
    } catch (thrown) {
      throw classifyDriverError(thrown, "modelPolicy.listForProfile");
    }
  }

  /**
   * UPSERT one task's policy for the effective profile. The canonical id
   * + created_at are preserved across re-writes (rotation law — same as
   * connector-accounts). Validation is against the frozen contract.
   */
  async upsertForTask(input: {
    userId: string;
    profileId: string | null;
    policy: ModelPolicy;
  }): Promise<PersistedModelPolicy> {
    const problems = validateModelPolicy(input.policy);
    if (problems.length > 0) {
      throw new PersistenceError("invalid-input", problems.join("; "), {
        operation: "modelPolicy.upsertForTask",
      });
    }
    if (input.policy.task === undefined) {
      // unreachable (validateModelPolicy rejects); kept for type safety
      throw new PersistenceError("invalid-input", "task: required", {
        operation: "modelPolicy.upsertForTask",
      });
    }
    const nowIso = epochMsToIso(this.clock.now());

    // Check for an existing row to preserve the canonical id + created_at.
    let existingId: string | null = null;
    let existingCreatedAt: string | null = null;
    try {
      const rows = await this.db.query<{ id: string; created_at: unknown }>(
        `SELECT id, created_at FROM model_policy
          WHERE user_id = $1 AND COALESCE(profile_id, 'user:' || user_id) = COALESCE($2, 'user:' || user_id)
            AND task = $3`,
        [input.userId, input.profileId, input.policy.task],
      );
      if (rows.length > 0) {
        existingId = rows[0]!.id;
        existingCreatedAt = toIsoTimestamp(rows[0]!.created_at);
      }
    } catch (thrown) {
      throw classifyDriverError(thrown, "modelPolicy.upsertForTask.existing");
    }

    const id = existingId ?? `${MODEL_POLICY_ID_PREFIX}${this.ids.next()}`;
    const createdAt = existingCreatedAt ?? nowIso;

    try {
      const rows = await this.db.query<PolicySqlRow>(
        `INSERT INTO model_policy
            (id, user_id, profile_id, task, preferred_provider, fallback_providers,
             privacy, max_cost_per_operation, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
         ON CONFLICT (COALESCE(profile_id, 'user:' || user_id), task) DO UPDATE SET
           preferred_provider = EXCLUDED.preferred_provider,
           fallback_providers = EXCLUDED.fallback_providers,
           privacy = EXCLUDED.privacy,
           max_cost_per_operation = EXCLUDED.max_cost_per_operation,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          id,
          input.userId,
          input.profileId,
          input.policy.task,
          input.policy.preferredProvider ?? null,
          JSON.stringify(input.policy.fallbackProviders),
          input.policy.privacy,
          input.policy.maxCostPerOperation ?? null,
          createdAt,
          nowIso,
        ],
      );
      const row = rows[0];
      if (row === undefined) {
        throw new Error("upsertForTask: no row returned");
      }
      return mapPolicy(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "modelPolicy.upsertForTask");
    }
  }

  /**
   * Delete one task's policy for the effective profile (REVERSIBILITY —
   * the same undo law as R05 feedback). True when a row was removed.
   */
  async deleteForTask(
    userId: string,
    profileId: string | null,
    task: ModelTask,
  ): Promise<boolean> {
    if (!isModelTask(task)) {
      throw new PersistenceError("invalid-input", `task: expected a frozen ModelTask, got ${JSON.stringify(task)}`, {
        operation: "modelPolicy.deleteForTask",
      });
    }
    try {
      const rows = await this.db.query<{ id: string }>(
        `DELETE FROM model_policy
          WHERE user_id = $1 AND COALESCE(profile_id, 'user:' || user_id) = COALESCE($2, 'user:' || user_id)
            AND task = $3 RETURNING id`,
        [userId, profileId, task],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "modelPolicy.deleteForTask");
    }
  }
}
