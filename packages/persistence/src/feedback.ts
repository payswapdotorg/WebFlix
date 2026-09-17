/**
 * @wfx/persistence — the recommendation feedback store (R05).
 *
 * Migration 0010's `recommendation_feedback` table: the durable side of the
 * J15 control vocabulary (`more-like-this` | `not-interested` |
 * `dont-recommend-source` | `dont-recommend-creator` | `already-watched`).
 * Every control is PER-PROFILE (the migration-0007 effective-profile key),
 * TIMESTAMPED, and REVERSIBLE:
 *
 * - `addForProfile` upserts idempotently over the identity
 *   `(effective profile, kind, target)` keeping the EARLIEST `created_at`
 *   (a control is one row, not a log — re-submitting "not interested" on
 *   the same item is a no-op that answers the existing record);
 * - `deleteForProfile` is a REAL delete (the row and its composition
 *   effect vanish together — no soft-delete theater);
 * - `listForProfile` answers the profile's controls, oldest first (stable,
 *   id ascending as tiebreak).
 *
 * THE EVENT-SINK LAW (R04, preserved): nothing in this store touches
 * `event_outbox` or `watch_history` — feedback shapes future candidate
 * composition only; recorded viewing events stay immutable audit truth.
 *
 * The KIND vocabulary check here is structural (non-empty string ≤ 64
 * chars); the CLOSED five-member vocabulary is enforced at the API
 * boundary, which owns the typed 400 channel. The store never interprets
 * `target` (item id / connector id / creator id — per-kind semantics live
 * in the Recommendation OS, `@wfx/recommendation` os/feedback.ts).
 */

import { classifyDriverError } from "./classify";
import { PersistenceError } from "./errors";
import { PostgresProfileService } from "./profiles";
import { epochMsToIso, toIsoTimestamp, type DbClient } from "./sql";
import type { Clock, IdGen } from "@wfx/experience";

/** Prefix for feedback control ids minted by this store. */
export const FEEDBACK_ID_PREFIX = "wfxfb_";

/** Maximum length of a stored target string. */
export const TARGET_MAX_LENGTH = 200;

/** Maximum length of a stored note. */
export const NOTE_MAX_LENGTH = 500;

/** A stored feedback control record (the R05 wire shape). */
export interface PersistedFeedback {
  readonly id: string;
  readonly kind: string;
  readonly target: string;
  readonly note?: string;
  readonly createdAt: string;
}

/** Input accepted by `addForProfile`. */
export interface FeedbackAddInput {
  readonly userId: string;
  readonly kind: string;
  readonly target: string;
  readonly note?: string;
}

/** Constructor dependencies. */
export interface FeedbackStoreOptions {
  readonly db: DbClient;
  readonly clock: Clock;
  readonly ids: IdGen;
}

/** Structural validation of one feedback input (the API adds the closed vocabulary). */
export function validateFeedbackInput(input: FeedbackAddInput): readonly string[] {
  const problems: string[] = [];
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    problems.push("userId: expected a non-empty string");
  }
  if (
    typeof input.kind !== "string" ||
    input.kind.trim().length === 0 ||
    input.kind.length > 64
  ) {
    problems.push("kind: expected a non-empty string of at most 64 characters");
  }
  if (
    typeof input.target !== "string" ||
    input.target.trim().length === 0 ||
    input.target.length > TARGET_MAX_LENGTH
  ) {
    problems.push(`target: expected 1..${TARGET_MAX_LENGTH} characters`);
  }
  if (
    input.note !== undefined &&
    (typeof input.note !== "string" || input.note.length > NOTE_MAX_LENGTH)
  ) {
    problems.push(`note: expected a string of at most ${NOTE_MAX_LENGTH} characters when present`);
  }
  return problems;
}

interface FeedbackSqlRow {
  id: string;
  user_id: string;
  profile_id: unknown | null;
  kind: string;
  target: string;
  note: unknown | null;
  created_at: unknown;
}

function mapFeedback(row: FeedbackSqlRow): PersistedFeedback {
  const record: PersistedFeedback = {
    id: row.id,
    kind: row.kind,
    target: row.target,
    createdAt: toIsoTimestamp(row.created_at),
    ...(row.note === null ? {} : { note: String(row.note) }),
  };
  return record;
}

/** The migration-0007 effective-profile key expression (single source). */
const EFFECTIVE_PROFILE = `COALESCE(profile_id, 'user:' || user_id)`;

/**
 * The durable recommendation-feedback store. Created once per service boot;
 * route handlers call the profile-explicit forms after resolving the active
 * profile through `resolveScopedIdentity`.
 */
export class PostgresRecommendationFeedbackStore {
  private readonly db: DbClient;
  private readonly clock: Clock;
  private readonly ids: IdGen;
  private readonly profiles: PostgresProfileService;

  constructor(options: FeedbackStoreOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.ids = options.ids;
    this.profiles = new PostgresProfileService({
      db: options.db,
      ids: options.ids,
      clock: options.clock,
    });
  }

  /**
   * The LEGACY userId-resolved form: resolves the effective profile key
   * first (the default-profile fallback), then upserts for that profile.
   */
  async add(input: FeedbackAddInput): Promise<PersistedFeedback> {
    const problems = [...validateFeedbackInput(input)];
    if (problems.length > 0) {
      throw new PersistenceError("invalid-input", `feedback: ${problems.join("; ")}`, {
        operation: "feedback.add",
      });
    }
    const profileId = await this.profiles.resolveEffectiveProfileKey(input.userId);
    return this.addForProfile(input, profileId);
  }

  /**
   * Insert one control for the EFFECTIVE PROFILE, idempotently: the same
   * (profile, kind, target) keeps the EARLIEST row (created_at stable).
   */
  async addForProfile(
    input: FeedbackAddInput,
    profileId: string,
  ): Promise<PersistedFeedback> {
    const problems = [...validateFeedbackInput(input)];
    if (typeof profileId !== "string" || profileId.length === 0) {
      problems.push("profileId: expected a non-empty string");
    }
    if (problems.length > 0) {
      throw new PersistenceError("invalid-input", `feedback: ${problems.join("; ")}`, {
        operation: "feedback.add",
      });
    }
    const nowIso = epochMsToIso(this.clock.now());
    const id = FEEDBACK_ID_PREFIX + this.ids.next();
    try {
      const rows = await this.db.query<FeedbackSqlRow>(
        `INSERT INTO recommendation_feedback (id, user_id, profile_id, kind, target, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (${EFFECTIVE_PROFILE}, kind, target) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           profile_id = EXCLUDED.profile_id
         RETURNING *`,
        [
          id,
          input.userId,
          profileId,
          input.kind,
          input.target,
          input.note ?? null,
          nowIso,
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("feedback.add: no row returned");
      return mapFeedback(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "feedback.add");
    }
  }

  /**
   * The LEGACY userId-resolved form: the user's controls via the effective
   * profile key.
   */
  async listForUser(userId: string): Promise<readonly PersistedFeedback[]> {
    const profileId = await this.profiles.resolveEffectiveProfileKey(userId);
    return this.listForProfile(profileId);
  }

  /** One PROFILE's controls, oldest first (id ascending as tiebreak). */
  async listForProfile(profileId: string): Promise<readonly PersistedFeedback[]> {
    try {
      const rows = await this.db.query<FeedbackSqlRow>(
        `SELECT * FROM recommendation_feedback WHERE ${EFFECTIVE_PROFILE} = $1
         ORDER BY created_at ASC, id ASC`,
        [profileId],
      );
      return rows.map(mapFeedback);
    } catch (thrown) {
      throw classifyDriverError(thrown, "feedback.list");
    }
  }

  /** One control by id, visible to this profile (null when unknown/not owned). */
  async getForProfile(profileId: string, id: string): Promise<PersistedFeedback | null> {
    try {
      const rows = await this.db.query<FeedbackSqlRow>(
        `SELECT * FROM recommendation_feedback
         WHERE id = $1 AND ${EFFECTIVE_PROFILE} = $2`,
        [id, profileId],
      );
      const row = rows[0];
      return row === undefined ? null : mapFeedback(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "feedback.get");
    }
  }

  /**
   * Delete one control (a REAL delete — the row and its composition effect
   * vanish together). True when a row was removed; false when unknown to
   * this profile.
   */
  async deleteForProfile(profileId: string, id: string): Promise<boolean> {
    try {
      const rows = await this.db.query<{ id: string }>(
        `DELETE FROM recommendation_feedback
         WHERE id = $1 AND ${EFFECTIVE_PROFILE} = $2
         RETURNING id`,
        [id, profileId],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "feedback.delete");
    }
  }
}
