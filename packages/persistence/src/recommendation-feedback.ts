/**
 * @wfx/persistence — the recommendation-feedback store (R05, the J15
 * control set).
 *
 * THE REVERSIBILITY LAW (R05 spec §1): every control that shapes
 * recommendations can be undone. One row per
 * (effective profile, kind, target type, target id) — the migration-0010
 * unique key. A re-submission of the same control UPDATES the row in place
 * (the canonical `wfxfeed_` id stays stable; `created_at` restamps; the note
 * replaces). `deleteForProfile` removes the row OUTRIGHT — delete is gone,
 * no soft-delete theater: the Recommendation OS sees the row or it does not.
 *
 * THE EVENT-SINK LAW (R04 precedent, preserved verbatim): this module NEVER
 * touches `event_outbox`, `watch_history`, or any history projection.
 * `already-watched` is a recommendation control (deprioritize repeats), not
 * a history edit — recorded viewing events are the immutable truth.
 *
 * Profile scoping mirrors migration 0007's effective-profile key:
 * `(COALESCE(profile_id, 'user:' || user_id), kind, target_type, target_id)`.
 * Reads/deletes are profile-EXPLICIT (the API layer resolves the caller's
 * effective profile first) so one profile can never enumerate or remove
 * another profile's controls.
 *
 * Determinism: clock + ids are injected seams; no Date.now, no crypto.
 */

import { classifyDriverError } from "./classify";
import { PersistenceError } from "./errors";
import { epochMsToIso, toIsoTimestamp, type DbClient } from "./sql";
import type { Clock, IdGen } from "@wfx/experience";

/** The migration-0007 effective-profile key expression (single source). */
const EFFECTIVE_PROFILE = `COALESCE(profile_id, 'user:' || user_id)`;

/** The J15 feedback-control vocabulary (frozen by the R05 spec). */
export const RECOMMENDATION_FEEDBACK_KINDS = [
  "more-like-this",
  "not-interested",
  "dont-recommend-source",
  "dont-recommend-creator",
  "already-watched",
] as const;

/** One feedback-control kind. */
export type RecommendationFeedbackKind = (typeof RECOMMENDATION_FEEDBACK_KINDS)[number];

/** What a control may target (structural, paired with the kind). */
export const FEEDBACK_TARGET_TYPES = ["item", "source", "creator"] as const;

/** One control's target type. */
export type FeedbackTargetType = (typeof FEEDBACK_TARGET_TYPES)[number];

/** The kind -> target-type law (structural, mirrors the migration CHECK). */
export const FEEDBACK_KIND_TARGETS: Readonly<Record<RecommendationFeedbackKind, FeedbackTargetType>> =
  Object.freeze({
    "more-like-this": "item",
    "not-interested": "item",
    "dont-recommend-source": "source",
    "dont-recommend-creator": "creator",
    "already-watched": "item",
  });

/** Canonical feedback-record id: `wfxfeed_` prefix + 26-char body. */
export const FEEDBACK_ID_PREFIX = "wfxfeed_";

/** Structural guard: a canonical feedback id. */
export function isFeedbackId(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(FEEDBACK_ID_PREFIX) && value.length === FEEDBACK_ID_PREFIX.length + 26;
}

/** The longest accepted note (bounded, honest — a note is a memo, not an essay). */
export const FEEDBACK_NOTE_MAX_LENGTH = 500;

/** One stored feedback record (the R05 wire shape). */
export interface FeedbackRecord {
  /** Canonical identity: `wfxfeed_` + 26-char ULID body. */
  readonly id: string;
  readonly userId: string;
  /** Null for legacy rows (the pseudo bucket); set on every R05 write. */
  readonly profileId: string | null;
  /** The J15 control kind. */
  readonly kind: RecommendationFeedbackKind;
  /** The control's target type (item | source | creator). */
  readonly targetType: FeedbackTargetType;
  /** The target's id: canonical item id (`wfxitm_…`), connector id, or creator id. */
  readonly targetId: string;
  /** Optional user note (memo, never rendered as control truth). */
  readonly note: string | null;
  /** ISO 8601 instant of the submission/last re-submission. */
  readonly createdAt: string;
}

/** Input accepted by {@link PostgresRecommendationFeedbackStore.addForProfile}. */
export interface FeedbackAddInput {
  readonly userId: string;
  readonly profileId: string;
  readonly kind: RecommendationFeedbackKind;
  readonly targetId: string;
  readonly note?: string;
}

interface FeedbackSqlRow {
  id: string;
  user_id: string;
  profile_id: string | null;
  kind: string;
  target_type: string;
  target_id: string;
  note: string | null;
  created_at: unknown;
}

function mapRow(row: FeedbackSqlRow): FeedbackRecord {
  return {
    id: row.id,
    userId: row.user_id,
    profileId: row.profile_id,
    kind: row.kind as RecommendationFeedbackKind,
    targetType: row.target_type as FeedbackTargetType,
    targetId: row.target_id,
    note: row.note,
    createdAt: toIsoTimestamp(row.created_at),
  };
}

/** Constructor dependencies. */
export interface RecommendationFeedbackStoreOptions {
  readonly db: DbClient;
  readonly clock: Clock;
  readonly ids: IdGen;
}

/**
 * Structural validation of one feedback add. Returns every problem (the
 * field-level law — nothing coerced, everything named).
 */
export function feedbackInputProblems(input: FeedbackAddInput): readonly string[] {
  const problems: string[] = [];
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    problems.push("userId: expected a non-empty string");
  }
  if (typeof input.profileId !== "string" || input.profileId.length === 0) {
    problems.push("profileId: expected a non-empty string");
  }
  if (!(RECOMMENDATION_FEEDBACK_KINDS as readonly string[]).includes(input.kind)) {
    problems.push(`kind: expected one of ${RECOMMENDATION_FEEDBACK_KINDS.join(" | ")}`);
  }
  if (typeof input.targetId !== "string" || input.targetId.trim().length === 0) {
    problems.push("targetId: expected a non-empty string (after trim)");
  }
  if (input.note !== undefined && (typeof input.note !== "string" || input.note.length > FEEDBACK_NOTE_MAX_LENGTH)) {
    problems.push(`note: expected a string of at most ${FEEDBACK_NOTE_MAX_LENGTH} characters when present`);
  }
  return problems;
}

/**
 * The durable recommendation-feedback store (migration 0010). Created once
 * per service boot; usable standalone in tests.
 */
export class PostgresRecommendationFeedbackStore {
  private readonly db: DbClient;
  private readonly clock: Clock;
  private readonly ids: IdGen;

  constructor(options: RecommendationFeedbackStoreOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.ids = options.ids;
  }

  /**
   * Insert or update-in-place one control for one profile. The unique key
   * is (effective profile, kind, target_type, target_id) — the target type
   * is derived from the kind (the structural law), never caller-chosen. On
   * conflict the canonical id stays and created_at/note refresh.
   */
  async addForProfile(input: FeedbackAddInput): Promise<FeedbackRecord> {
    const problems = [...feedbackInputProblems(input)];
    if (problems.length > 0) {
      throw new PersistenceError("invalid-input", `feedback: ${problems.join("; ")}`, {
        operation: "recommendationFeedback.add",
      });
    }
    const nowIso = epochMsToIso(this.clock.now());
    const id = FEEDBACK_ID_PREFIX + this.ids.next();
    try {
      const rows = await this.db.query<FeedbackSqlRow>(
        `INSERT INTO recommendation_feedback (id, user_id, profile_id, kind, target_type, target_id, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (${EFFECTIVE_PROFILE}, kind, target_type, target_id) DO UPDATE SET
           note = EXCLUDED.note,
           created_at = EXCLUDED.created_at,
           profile_id = EXCLUDED.profile_id
         RETURNING *`,
        [
          id,
          input.userId,
          input.profileId,
          input.kind,
          FEEDBACK_KIND_TARGETS[input.kind],
          input.targetId.trim(),
          input.note ?? null,
          nowIso,
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("add: no row returned");
      return mapRow(row);
    } catch (thrown) {
      if (thrown instanceof PersistenceError) throw thrown;
      throw classifyDriverError(thrown, "recommendationFeedback.add");
    }
  }

  /**
   * One profile's feedback records, newest first (id ascending as the
   * stable tiebreak). The order the J15 controls surface lists in.
   */
  async listForProfile(profileId: string): Promise<readonly FeedbackRecord[]> {
    if (typeof profileId !== "string" || profileId.length === 0) {
      throw new PersistenceError("invalid-input", "profileId: expected a non-empty string", {
        operation: "recommendationFeedback.list",
      });
    }
    try {
      const rows = await this.db.query<FeedbackSqlRow>(
        `SELECT * FROM recommendation_feedback WHERE ${EFFECTIVE_PROFILE} = $1
          ORDER BY created_at DESC, id ASC`,
        [profileId],
      );
      return rows.map(mapRow);
    } catch (thrown) {
      throw classifyDriverError(thrown, "recommendationFeedback.list");
    }
  }

  /** One record by id, PROFILE-SCOPED (null when unknown OR another profile's). */
  async getForProfile(profileId: string, id: string): Promise<FeedbackRecord | null> {
    if (typeof profileId !== "string" || profileId.length === 0 || typeof id !== "string" || id.length === 0) {
      throw new PersistenceError("invalid-input", "profileId and id: expected non-empty strings", {
        operation: "recommendationFeedback.get",
      });
    }
    try {
      const rows = await this.db.query<FeedbackSqlRow>(
        `SELECT * FROM recommendation_feedback WHERE id = $1 AND ${EFFECTIVE_PROFILE} = $2`,
        [id, profileId],
      );
      const row = rows[0];
      return row === undefined ? null : mapRow(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "recommendationFeedback.get");
    }
  }

  /**
   * Remove one record, PROFILE-SCOPED. True when a row was removed; false
   * when it never existed here. Delete is GONE (the reversibility law's
   * other half: undo must be as real as apply).
   */
  async deleteForProfile(profileId: string, id: string): Promise<boolean> {
    if (typeof profileId !== "string" || profileId.length === 0 || typeof id !== "string" || id.length === 0) {
      throw new PersistenceError("invalid-input", "profileId and id: expected non-empty strings", {
        operation: "recommendationFeedback.delete",
      });
    }
    try {
      const rows = await this.db.query<{ id: string }>(
        `DELETE FROM recommendation_feedback WHERE id = $1 AND ${EFFECTIVE_PROFILE} = $2 RETURNING id`,
        [id, profileId],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "recommendationFeedback.delete");
    }
  }
}
