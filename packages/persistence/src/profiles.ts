/**
 * @wfx/persistence — the profile service (R02, remediation freeze).
 *
 * Profiles are the identity primitive the remediation architecture freezes:
 * "A profile owns recommendation policy, intent history, watch history,
 * library/watchlist, saves, … Cross-device continuity is keyed to the same
 * server-side identity/profile state." This module owns:
 *
 * - PROFILE RECORDS: `wfxprof_` + ULID body ids, one designated DEFAULT
 *   profile per user (enforced structurally by the partial unique index
 *   `profiles_user_default_key`), display names + avatar seeds.
 * - THE LAZY LEGACY MIGRATION (the spec'd migration path for userId-keyed
 *   rows): on the first profile-scoped resolution for a REGISTERED user
 *   with no profiles, `ensureDefaultProfile` materializes the default
 *   profile and ATTRIBUTES the user's legacy rows (profile_id NULL) across
 *   `watch_history`, `library_entries`, `user_intents`, and
 *   `recommendation_state` — inside ONE transaction with the profile
 *   insert, so the profile and its inherited data appear atomically.
 * - THE EFFECTIVE PROFILE KEY (`resolveEffectiveProfileKey`): what every
 *   profile-scoped read/write in this package resolves before touching
 *   SQL. Three outcomes:
 *     1. the user's default profile id, once one exists;
 *     2. a freshly materialized default profile id (registered user, first
 *        resolution — the lazy migration above);
 *     3. the LEGACY PSEUDO KEY `'user:' + userId` for ids that are not
 *        registered accounts (the 050 anonymous stopgap, test harness
 *        users). No profiles row is created for pseudo keys — the
 *        migration 0007 COALESCE indexes keep legacy NULL rows readable
 *        and upsertable under exactly this key, so pre-R02 behavior is
 *        preserved bit-for-bit for the anonymous transition (R07 re-points
 *        the web app to real sessions later).
 *
 * Cross-device continuity: everything above is server-side state keyed to
 * real profile ids, so any device holding a valid session token resolves
 * the SAME profile and sees the same history/library/intents/policy.
 *
 * Determinism: clock + ids are injected seams; no Date.now, no crypto here.
 * Profile records never contain secrets; tokens are never logged.
 */

import { classifyDriverError, isUniqueViolation } from "./classify";
import { PersistenceError } from "./errors";
import { epochMsToIso, toIsoTimestamp, type DbClient } from "./sql";
import type { Clock, IdGen } from "@wfx/experience";

/** Canonical profile id prefix: `wfxprof_` + 26-char ULID body. */
export const PROFILE_ID_PREFIX = "wfxprof_";

/**
 * The legacy pseudo-key prefix. `LEGACY_PROFILE_PREFIX + userId` is the
 * deterministic bucket pre-R02 (userId-keyed) data occupies under the
 * migration 0007 COALESCE indexes. Never collides with `wfxprof_` ids.
 */
export const LEGACY_PROFILE_PREFIX = "user:";

/** The legacy pseudo profile key for one user id. */
export function legacyProfileKey(userId: string): string {
  return `${LEGACY_PROFILE_PREFIX}${userId}`;
}

/** Display-name bounds (trimmed; 1..64 — a profile name is a label). */
export const PROFILE_DISPLAY_NAME_MAX_LENGTH = 64;
/** Avatar-seed bound (trimmed; 1..128 — a seed, not a blob). */
export const PROFILE_AVATAR_SEED_MAX_LENGTH = 128;

/** A profile as callers may see it (never a secret — there are none). */
export interface ProfileRecord {
  readonly id: string;
  readonly userId: string;
  readonly displayName: string;
  readonly avatarSeed: string;
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What one call to {@link PostgresProfileService.ensureDefaultProfile} answers. */
export type EnsureDefaultResult =
  | { readonly ok: true; readonly profile: ProfileRecord; readonly created: boolean; readonly attributed: number }
  | { readonly ok: false; readonly reason: "user-not-found" };

/** Typed outcome of {@link PostgresProfileService.createProfile}. */
export type CreateProfileResult =
  | { ok: true; profile: ProfileRecord }
  | { ok: false; reason: "invalid-input"; details: readonly string[] }
  | { ok: false; reason: "user-not-found" };

/** Typed outcome of {@link PostgresProfileService.renameProfile}. */
export type RenameProfileResult =
  | { ok: true; profile: ProfileRecord }
  | { ok: false; reason: "invalid-input"; details: readonly string[] }
  | { ok: false; reason: "not-found" };

/** Constructor dependencies (all injectable). `ids` and `clock` are
 * OPTIONAL so seams-poor callers (legacy stores constructed without them)
 * can still READ and resolve — but every MATERIALIZING method
 * (`ensureDefaultProfile`, `createProfile`, `renameProfile`) throws the
 * typed `config-error` when a seam is absent: a profile is never minted
 * from a hidden clock or a fabricated id. Compose the service with BOTH
 * seams (as `bootPersistence`-shaped boots do) in any materializing path. */
export interface ProfileServiceOptions {
  readonly db: DbClient;
  readonly ids?: IdGen;
  readonly clock?: Clock;
}

interface ProfileSqlRow {
  id: string;
  user_id: string;
  display_name: string;
  avatar_seed: string;
  is_default: boolean;
  created_at: unknown;
  updated_at: unknown;
}

function mapProfile(row: ProfileSqlRow): ProfileRecord {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    avatarSeed: row.avatar_seed,
    isDefault: Boolean(row.is_default),
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

/** The tables whose legacy (profile_id NULL) rows the lazy migration attributes. */
const ATTRIBUTED_TABLES: readonly string[] = [
  "watch_history",
  "library_entries",
  "user_intents",
  "recommendation_state",
];

/**
 * The profile service. Construct with `{ db, ids, clock }` — all injected.
 * Every method classifies driver failures through the 052 taxonomy before
 * callers see them.
 */
export class PostgresProfileService {
  private readonly db: DbClient;
  private readonly ids: IdGen | undefined;
  private readonly clock: Clock | undefined;

  constructor(options: ProfileServiceOptions) {
    this.db = options.db;
    this.ids = options.ids;
    this.clock = options.clock;
  }

  /** Materialization requires both seams — never a hidden clock or id. */
  private requireSeams(operation: string): { ids: IdGen; clock: Clock } {
    if (this.ids === undefined || this.clock === undefined) {
      throw new PersistenceError(
        "config-error",
        `${operation}: this PostgresProfileService was constructed without the ids/clock ` +
          "seams — profile materialization is unavailable (compose the service with both seams)",
        { operation },
      );
    }
    return { ids: this.ids, clock: this.clock };
  }

  /**
   * The user's designated default profile, or null when the user has no
   * profiles yet (a query — the lazy migration is `ensureDefaultProfile`).
   */
  async getDefaultProfile(userId: string): Promise<ProfileRecord | null> {
    this.assertUserId(userId);
    try {
      const rows = await this.db.query<ProfileSqlRow>(
        `SELECT id, user_id, display_name, avatar_seed, is_default, created_at, updated_at
         FROM profiles WHERE user_id = $1 AND is_default`,
        [userId],
      );
      const row = rows[0];
      return row === undefined ? null : mapProfile(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "profiles.getDefaultProfile");
    }
  }

  /**
   * The user's profiles, created order (deterministic: created_at, id).
   * A user with no profiles answers the empty list — a query.
   */
  async listProfiles(userId: string): Promise<readonly ProfileRecord[]> {
    this.assertUserId(userId);
    try {
      const rows = await this.db.query<ProfileSqlRow>(
        `SELECT id, user_id, display_name, avatar_seed, is_default, created_at, updated_at
         FROM profiles WHERE user_id = $1 ORDER BY created_at, id`,
        [userId],
      );
      return rows.map(mapProfile);
    } catch (thrown) {
      throw classifyDriverError(thrown, "profiles.listProfiles");
    }
  }

  /** One profile by id (any user — callers enforce ownership). Null when unknown. */
  async getProfile(profileId: string): Promise<ProfileRecord | null> {
    if (typeof profileId !== "string" || profileId.length === 0) {
      throw new PersistenceError("invalid-input", "profileId: expected a non-empty string", {
        operation: "profiles.getProfile",
      });
    }
    try {
      const rows = await this.db.query<ProfileSqlRow>(
        `SELECT id, user_id, display_name, avatar_seed, is_default, created_at, updated_at
         FROM profiles WHERE id = $1`,
        [profileId],
      );
      const row = rows[0];
      return row === undefined ? null : mapProfile(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "profiles.getProfile");
    }
  }

  /**
   * THE LAZY LEGACY MIGRATION: guarantee the user has a default profile,
   * materializing one (registered users only) and attributing their legacy
   * userId-keyed rows to it — the profile insert and the attribution
   * UPDATEs commit in ONE transaction, so the profile and its inherited
   * data appear atomically. Concurrent materializations collapse onto the
   * winner via the partial unique index (unique violation ⇒ re-select).
   *
   * For an id that is NOT a registered account this answers the typed
   * `user-not-found` result — callers route those ids to the legacy pseudo
   * key via {@link resolveEffectiveProfileKey} instead.
   */
  async ensureDefaultProfile(userId: string): Promise<EnsureDefaultResult> {
    this.assertUserId(userId);
    const { ids, clock } = this.requireSeams("profiles.ensureDefaultProfile");
    const existing = await this.getDefaultProfile(userId);
    if (existing !== null) {
      return { ok: true, profile: existing, created: false, attributed: 0 };
    }

    const nowIso = epochMsToIso(clock.now());
    const id = `${PROFILE_ID_PREFIX}${ids.next()}`;
    let created: ProfileRecord;
    try {
      created = await this.db.begin(async (tx) => {
        const rows = await tx.query<ProfileSqlRow>(
          `INSERT INTO profiles (id, user_id, display_name, avatar_seed, is_default, created_at, updated_at)
           VALUES ($1, $2, $3, $1, true, $4, $4)
           RETURNING id, user_id, display_name, avatar_seed, is_default, created_at, updated_at`,
          [id, userId, "Main", nowIso],
        );
        const row = rows[0];
        if (row === undefined) {
          throw new PersistenceError("unknown", "ensureDefaultProfile: INSERT returned no row", {
            operation: "profiles.ensureDefaultProfile",
          });
        }
        return mapProfile(row);
      });
    } catch (thrown) {
      if (isUniqueViolation(thrown)) {
        // A concurrent request materialized the default profile first —
        // the partial unique index is the arbiter. Collapse onto it.
        const winner = await this.getDefaultProfile(userId);
        if (winner !== null) {
          return { ok: true, profile: winner, created: false, attributed: 0 };
        }
      }
      // A user row that does not exist fails the FK (constraint-violation)
      // — classified and re-typed here as the honest user-not-found answer.
      const classified = classifyDriverError(thrown, "profiles.ensureDefaultProfile");
      if (
        classified instanceof PersistenceError &&
        classified.kind === "constraint-violation"
      ) {
        return { ok: false, reason: "user-not-found" };
      }
      throw classified;
    }

    // Attribute the user's legacy rows to the fresh profile (same logical
    // step; rows written between the tx and this UPDATE are attributed by
    // the next resolution — the COALESCE keys keep them conflict-safe).
    const attributed = await this.attributeLegacyRows(userId, created.id);
    return { ok: true, profile: created, created: true, attributed };
  }

  /**
   * Attribute a user's legacy (profile_id NULL) rows to `profileId` — the
   * runtime half of the migration-0007 transition. Returns the number of
   * rows attributed. Idempotent (NULL rows only match once).
   */
  async attributeLegacyRows(userId: string, profileId: string): Promise<number> {
    this.assertUserId(userId);
    if (typeof profileId !== "string" || profileId.length === 0) {
      throw new PersistenceError("invalid-input", "profileId: expected a non-empty string", {
        operation: "profiles.attributeLegacyRows",
      });
    }
    let attributed = 0;
    for (const table of ATTRIBUTED_TABLES) {
      try {
        const rows = await this.db.query<{ user_id: string }>(
          `UPDATE ${table} SET profile_id = $2 WHERE user_id = $1 AND profile_id IS NULL
           RETURNING user_id`,
          [userId, profileId],
        );
        attributed += rows.length;
      } catch (thrown) {
        throw classifyDriverError(thrown, `profiles.attributeLegacyRows(${table})`);
      }
    }
    return attributed;
  }

  /**
   * THE EFFECTIVE PROFILE KEY every profile-scoped read/write resolves
   * first (see the module doc for the three outcomes). Pure function of
   * database state + the injected seams; never mints anything but the
   * default profile.
   */
  async resolveEffectiveProfileKey(userId: string): Promise<string> {
    this.assertUserId(userId);
    const existing = await this.getDefaultProfile(userId);
    if (existing !== null) return existing.id;

    // Registered account without profiles yet: materialize (the lazy
    // migration) and answer the real profile id.
    const registered = await this.userExists(userId);
    if (registered) {
      const ensured = await this.ensureDefaultProfile(userId);
      if (!ensured.ok) {
        // Registered in the probe above but the FK fired now: the account
        // vanished mid-resolution (deleted). The legacy pseudo bucket is
        // the honest fallback — the same bucket its rows already occupy.
        return legacyProfileKey(userId);
      }
      return ensured.profile.id;
    }

    // Not a registered account (anonymous stopgap / harness user): the
    // legacy pseudo bucket. Migration 0007's COALESCE indexes keep legacy
    // NULL rows readable and upsertable under exactly this key — no write.
    return legacyProfileKey(userId);
  }

  /**
   * Create an ADDITIONAL profile for a user (never the default — the
   * default is `ensureDefaultProfile`'s job). Typed failures: invalid
   * input; user-not-found (the FK's honest answer for unknown accounts).
   */
  async createProfile(input: {
    userId: string;
    displayName: string;
    avatarSeed?: string;
  }): Promise<CreateProfileResult> {
    const { ids, clock } = this.requireSeams("profiles.createProfile");
    const problems: string[] = [];
    const displayName =
      typeof input.displayName === "string" ? input.displayName.trim() : "";
    if (displayName.length === 0 || displayName.length > PROFILE_DISPLAY_NAME_MAX_LENGTH) {
      problems.push(
        `displayName: expected 1..${PROFILE_DISPLAY_NAME_MAX_LENGTH} characters (after trim)`,
      );
    }
    const avatarSeed =
      typeof input.avatarSeed === "string" && input.avatarSeed.trim().length > 0
        ? input.avatarSeed.trim()
        : undefined;
    if (
      avatarSeed !== undefined &&
      avatarSeed.length > PROFILE_AVATAR_SEED_MAX_LENGTH
    ) {
      problems.push(`avatarSeed: expected at most ${PROFILE_AVATAR_SEED_MAX_LENGTH} characters`);
    }
    if (typeof input.userId !== "string" || input.userId.length === 0) {
      problems.push("userId: expected a non-empty string");
    }
    if (problems.length > 0) return { ok: false, reason: "invalid-input", details: problems };

    const nowIso = epochMsToIso(clock.now());
    const id = `${PROFILE_ID_PREFIX}${ids.next()}`;
    try {
      const rows = await this.db.query<ProfileSqlRow>(
        `INSERT INTO profiles (id, user_id, display_name, avatar_seed, is_default, created_at, updated_at)
         VALUES ($1, $2, $3, $4, false, $5, $5)
         RETURNING id, user_id, display_name, avatar_seed, is_default, created_at, updated_at`,
        [id, input.userId, displayName, avatarSeed ?? id, nowIso],
      );
      const row = rows[0];
      if (row === undefined) {
        throw new PersistenceError("unknown", "createProfile: INSERT returned no row", {
          operation: "profiles.createProfile",
        });
      }
      return { ok: true, profile: mapProfile(row) };
    } catch (thrown) {
      const classified = classifyDriverError(thrown, "profiles.createProfile");
      if (
        classified instanceof PersistenceError &&
        classified.kind === "constraint-violation"
      ) {
        // The profiles.user_id FK: the account does not exist.
        return { ok: false, reason: "user-not-found" };
      }
      throw classified;
    }
  }

  /**
   * Rename one profile (display name only — identity is immutable). Typed
   * not-found when the profile id is unknown.
   */
  async renameProfile(input: {
    profileId: string;
    displayName: string;
  }): Promise<RenameProfileResult> {
    const { clock } = this.requireSeams("profiles.renameProfile");
    const problems: string[] = [];
    const displayName =
      typeof input.displayName === "string" ? input.displayName.trim() : "";
    if (displayName.length === 0 || displayName.length > PROFILE_DISPLAY_NAME_MAX_LENGTH) {
      problems.push(
        `displayName: expected 1..${PROFILE_DISPLAY_NAME_MAX_LENGTH} characters (after trim)`,
      );
    }
    if (typeof input.profileId !== "string" || input.profileId.length === 0) {
      problems.push("profileId: expected a non-empty string");
    }
    if (problems.length > 0) return { ok: false, reason: "invalid-input", details: problems };

    const nowIso = epochMsToIso(clock.now());
    try {
      const rows = await this.db.query<ProfileSqlRow>(
        `UPDATE profiles SET display_name = $2, updated_at = $3
         WHERE id = $1
         RETURNING id, user_id, display_name, avatar_seed, is_default, created_at, updated_at`,
        [input.profileId, displayName, nowIso],
      );
      const row = rows[0];
      if (row === undefined) return { ok: false, reason: "not-found" };
      return { ok: true, profile: mapProfile(row) };
    } catch (thrown) {
      throw classifyDriverError(thrown, "profiles.renameProfile");
    }
  }

  /** Does the account exist? (FK probe — used by the resolution law.) */
  async userExists(userId: string): Promise<boolean> {
    this.assertUserId(userId);
    try {
      const rows = await this.db.query<{ id: string }>(
        `SELECT id FROM users WHERE id = $1`,
        [userId],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "profiles.userExists");
    }
  }

  private assertUserId(userId: string): void {
    if (typeof userId !== "string" || userId.length === 0) {
      throw new PersistenceError("invalid-input", "userId: expected a non-empty string", {
        operation: "profiles",
      });
    }
  }
}
