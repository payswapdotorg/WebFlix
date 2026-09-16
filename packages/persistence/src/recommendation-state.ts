/**
 * @wfx/persistence — the recommendation-state store (WFX-052; R02
 * profile scoping).
 *
 * The `recommendation_state` table (over the migration-0007 profile-scoped
 * key): ONE row per EFFECTIVE PROFILE holding
 *
 * - the frozen `RecommendationPolicy` (jsonb, validated with the domain's
 *   `validatePolicy` on write and on read — the policy is user-controlled by
 *   frozen invariant 6, so a drifted row is a typed failure, never a
 *   silently accepted fake policy), and
 * - an OPAQUE engine-state blob (jsonb). The Recommendation OS
 *   (`@wfx/recommendation`) is pure and stateless by design; whatever
 *   per-profile engine state a later wave chooses to persist (fatigue
 *   accumulators, telemetry aggregates) round-trips verbatim here. This
 *   module never interprets the blob.
 *
 * The LEGACY API (`save`/`load` keyed by userId) resolves the effective
 * profile key first (the default-profile fallback); the R02 profile-aware
 * forms (`saveForProfile`/`loadForProfile`) take the profile key
 * explicitly. `userId` remains on the row (the frozen policy carries it).
 */

import { validatePolicy, type RecommendationPolicy } from "@wfx/domain";

import { classifyDriverError } from "./classify";
import { PersistenceError } from "./errors";
import { PostgresProfileService } from "./profiles";
import { epochMsToIso, toIsoTimestamp, type DbClient } from "./sql";
import type { Clock, IdGen } from "@wfx/experience";

/** What one user's recommendation state row contains. */
export interface RecommendationState {
  readonly userId: string;
  readonly policy: RecommendationPolicy;
  /** Opaque engine-owned state (never interpreted by the persistence layer). */
  readonly state: Record<string, unknown>;
  readonly updatedAt: string;
}

/** What `loadRecommendationState` answers when no row exists. */
export interface LoadedRecommendationState {
  readonly found: boolean;
  readonly state: RecommendationState | null;
}

/** Constructor dependencies. */
export interface RecommendationStateStoreOptions {
  readonly db: DbClient;
  readonly clock: Clock;
  /** R02: the id seam (profile materialization for registered users). */
  readonly ids?: IdGen;
}

/** The migration-0007 effective-profile key expression (single source). */
const EFFECTIVE_PROFILE = `COALESCE(profile_id, 'user:' || user_id)`;

interface StateSqlRow {
  user_id: string;
  profile_id: unknown | null;
  policy: unknown;
  state: unknown;
  updated_at: unknown;
}

/** The durable recommendation-state store. */
export class PostgresRecommendationStateStore {
  private readonly db: DbClient;
  private readonly clock: Clock;
  private readonly profiles: PostgresProfileService;

  constructor(options: RecommendationStateStoreOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.profiles = new PostgresProfileService({
      db: options.db,
      ...(options.ids !== undefined ? { ids: options.ids } : {}),
      clock: options.clock,
    });
  }

  /**
   * Upsert one user's policy + opaque engine state (the LEGACY,
   * userId-resolved form — effective-profile key). The policy is validated
   * with the domain validator (typed invalid-input on drift); the state
   * blob only needs to be a JSON object.
   */
  async save(input: {
    userId: string;
    policy: RecommendationPolicy;
    state?: Record<string, unknown>;
  }): Promise<RecommendationState> {
    const profileId = await this.profiles.resolveEffectiveProfileKey(input.userId);
    return this.saveForProfile({ ...input, profileId });
  }

  /** R02: the profile-explicit upsert — one row per effective profile. */
  async saveForProfile(input: {
    userId: string;
    profileId: string;
    policy: RecommendationPolicy;
    state?: Record<string, unknown>;
  }): Promise<RecommendationState> {
    if (typeof input.userId !== "string" || input.userId.length === 0) {
      throw new PersistenceError("invalid-input", "userId: expected a non-empty string", {
        operation: "recommendationState.save",
      });
    }
    if (typeof input.profileId !== "string" || input.profileId.length === 0) {
      throw new PersistenceError("invalid-input", "profileId: expected a non-empty string", {
        operation: "recommendationState.save",
      });
    }
    const policyCheck = validatePolicy(input.policy);
    if (!policyCheck.ok) {
      throw new PersistenceError(
        "invalid-input",
        `policy: ${policyCheck.errors.join("; ")}`,
        { operation: "recommendationState.save" },
      );
    }
    if (input.state !== undefined && (typeof input.state !== "object" || input.state === null)) {
      throw new PersistenceError("invalid-input", "state: expected an object when present", {
        operation: "recommendationState.save",
      });
    }

    const nowIso = epochMsToIso(this.clock.now());
    try {
      const rows = await this.db.query<StateSqlRow>(
        `INSERT INTO recommendation_state (user_id, profile_id, policy, state, updated_at)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
         ON CONFLICT (${EFFECTIVE_PROFILE}) DO UPDATE SET
           policy = EXCLUDED.policy,
           state = EXCLUDED.state,
           updated_at = EXCLUDED.updated_at,
           profile_id = EXCLUDED.profile_id
         RETURNING *`,
        [
          input.userId,
          input.profileId,
          JSON.stringify(input.policy),
          JSON.stringify(input.state ?? {}),
          nowIso,
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("save: no row returned");
      return this.mapRow(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "recommendationState.save");
    }
  }

  /**
   * Load one user's state (the LEGACY, userId-resolved form).
   * `found: false` (state null) when no row exists — a query, not an error.
   * A stored policy that no longer validates is a TYPED failure (schema
   * drift is an incident, not a silent default).
   */
  async load(userId: string): Promise<LoadedRecommendationState> {
    const profileId = await this.profiles.resolveEffectiveProfileKey(userId);
    return this.loadForProfile(profileId);
  }

  /** R02: load one PROFILE's state (same laws as `load`). */
  async loadForProfile(profileId: string): Promise<LoadedRecommendationState> {
    let row: StateSqlRow | undefined;
    try {
      const rows = await this.db.query<StateSqlRow>(
        `SELECT * FROM recommendation_state WHERE ${EFFECTIVE_PROFILE} = $1`,
        [profileId],
      );
      row = rows[0];
    } catch (thrown) {
      throw classifyDriverError(thrown, "recommendationState.load");
    }
    if (row === undefined) return { found: false, state: null };
    return { found: true, state: this.mapRow(row) };
  }

  /** Delete one user's row. True when a row was removed. */
  async delete(userId: string): Promise<boolean> {
    try {
      const rows = await this.db.query<{ user_id: string }>(
        `DELETE FROM recommendation_state WHERE user_id = $1 RETURNING user_id`,
        [userId],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "recommendationState.delete");
    }
  }

  private mapRow(row: StateSqlRow): RecommendationState {
    const policyCheck = validatePolicy(row.policy);
    if (!policyCheck.ok) {
      throw new PersistenceError(
        "invalid-input",
        `stored policy for user ${row.user_id} failed validation: ${policyCheck.errors.join("; ")}`,
        { operation: "recommendationState.load" },
      );
    }
    const stateBlob = row.state;
    if (typeof stateBlob !== "object" || stateBlob === null || Array.isArray(stateBlob)) {
      throw new PersistenceError(
        "invalid-input",
        `stored engine state for user ${row.user_id} is not a JSON object`,
        { operation: "recommendationState.load" },
      );
    }
    return {
      userId: row.user_id,
      policy: policyCheck.value,
      state: stateBlob as Record<string, unknown>,
      updatedAt: toIsoTimestamp(row.updated_at),
    };
  }
}
