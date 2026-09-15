/**
 * @wfx/persistence — the durable intent store (WFX-052).
 *
 * Migration 0004's `user_intents` table storing the frozen `UserIntent` plus
 * the `IntentRecord` bookkeeping columns (WFX-011): createdAt / updatedAt /
 * lastReinforcedAt / evidenceCount. The store ROUND-TRIPS records verbatim:
 * weight/confidence decay, snapshot liveness, and the create-or-reinforce
 * law are DOMAIN logic (`@wfx/domain` IntentGraph) — recomputing them here
 * would be provider logic leaking into persistence. Identity is the frozen
 * triple (userId, scope, objective), enforced UNIQUE by the table: the
 * upsert keeps the record's canonical `wfxint_` id stable across merges.
 */

import {
  INTENT_OBJECTIVE_MAX_LENGTH,
  isIntentId,
  isIntentProvenance,
  isIntentScope,
  isIso8601,
  type IntentRecord,
} from "@wfx/domain";

import { classifyDriverError } from "./classify";
import { PersistenceError } from "./errors";
import { toIsoTimestamp, type DbClient } from "./sql";

/** A stored intent record (frozen UserIntent + bookkeeping), ISO timestamps. */
export type PersistedIntent = IntentRecord;

/** Input accepted by `upsertIntent` — a full record (id included). */
export type IntentUpsertInput = IntentRecord;

/**
 * Structural validation of an `IntentUpsertInput` against the frozen
 * `UserIntent` contract + the IntentRecord bookkeeping law. The domain ships
 * the vocabulary guards (scope/provenance/id/timestamps); this composes them
 * into the record-level check the store enforces before SQL.
 */
export function validateIntentRecordInput(input: IntentUpsertInput): readonly string[] {
  const problems: string[] = [];
  if (!isIntentId(input.id)) {
    problems.push("id: expected a canonical intent id (wfxint_ prefix + 26-char ULID body)");
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    problems.push("userId: expected a non-empty string");
  }
  if (!isIntentScope(input.scope)) {
    problems.push("scope: expected one of the five frozen intent scopes");
  }
  if (
    typeof input.objective !== "string" ||
    input.objective.trim().length === 0 ||
    input.objective.length > INTENT_OBJECTIVE_MAX_LENGTH
  ) {
    problems.push(`objective: expected 1..${INTENT_OBJECTIVE_MAX_LENGTH} characters`);
  }
  if (typeof input.weight !== "number" || !Number.isFinite(input.weight) || input.weight < 0) {
    problems.push("weight: expected a finite non-negative number");
  }
  if (
    typeof input.confidence !== "number" ||
    !Number.isFinite(input.confidence) ||
    input.confidence < 0 ||
    input.confidence > 1
  ) {
    problems.push("confidence: expected a finite number in [0, 1]");
  }
  if (!isIntentProvenance(input.provenance)) {
    problems.push("provenance: expected explicit | inferred | imported");
  }
  if (input.expiresAt !== undefined && !isIso8601(input.expiresAt)) {
    problems.push("expiresAt: expected an ISO 8601 datetime string when present");
  }
  if (!isIso8601(input.createdAt)) problems.push("createdAt: expected an ISO 8601 instant");
  if (!isIso8601(input.updatedAt)) problems.push("updatedAt: expected an ISO 8601 instant");
  if (!isIso8601(input.lastReinforcedAt)) {
    problems.push("lastReinforcedAt: expected an ISO 8601 instant");
  }
  if (!Number.isInteger(input.evidenceCount) || input.evidenceCount < 1) {
    problems.push("evidenceCount: expected an integer >= 1");
  }
  return problems;
}

interface IntentSqlRow {
  id: string;
  user_id: string;
  scope: string;
  objective: string;
  weight: number;
  confidence: number;
  provenance: string;
  expires_at: unknown | null;
  created_at: unknown;
  updated_at: unknown;
  last_reinforced_at: unknown;
  evidence_count: number;
}

function mapIntent(row: IntentSqlRow): PersistedIntent {
  const record: PersistedIntent = {
    id: row.id as PersistedIntent["id"],
    userId: row.user_id,
    scope: row.scope as PersistedIntent["scope"],
    objective: row.objective,
    weight: Number(row.weight),
    confidence: Number(row.confidence),
    provenance: row.provenance as PersistedIntent["provenance"],
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
    lastReinforcedAt: toIsoTimestamp(row.last_reinforced_at),
    evidenceCount: Number(row.evidence_count),
  };
  if (row.expires_at !== null) {
    record.expiresAt = toIsoTimestamp(row.expires_at);
  }
  return record;
}

/** Constructor dependencies. */
export interface IntentStoreOptions {
  readonly db: DbClient;
}

/** The durable intent store. */
export class PostgresIntentStore {
  private readonly db: DbClient;

  constructor(options: IntentStoreOptions) {
    this.db = options.db;
  }

  /**
   * Insert or merge-update one intent keyed by the frozen identity triple
   * (userId, scope, objective). On conflict the incoming record's values win
   * (the domain layer decides WHAT the merged record is; the store persists
   * it) and the canonical `wfxint_` id stays the one already stored — stable
   * identity, exactly like graph realizations.
   */
  async upsertIntent(input: IntentUpsertInput): Promise<PersistedIntent> {
    const problems = validateIntentRecordInput(input);
    if (problems.length > 0) {
      throw new PersistenceError("invalid-input", `intent: ${problems.join("; ")}`, {
        operation: "upsertIntent",
      });
    }
    try {
      const rows = await this.db.query<IntentSqlRow>(
        `INSERT INTO user_intents (id, user_id, scope, objective, weight, confidence, provenance,
                                   expires_at, created_at, updated_at, last_reinforced_at,
                                   evidence_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (user_id, scope, objective) DO UPDATE SET
           weight = EXCLUDED.weight,
           confidence = EXCLUDED.confidence,
           provenance = EXCLUDED.provenance,
           expires_at = EXCLUDED.expires_at,
           updated_at = EXCLUDED.updated_at,
           last_reinforced_at = EXCLUDED.last_reinforced_at,
           evidence_count = EXCLUDED.evidence_count
         RETURNING *`,
        [
          input.id,
          input.userId,
          input.scope,
          input.objective,
          input.weight,
          input.confidence,
          input.provenance,
          input.expiresAt ?? null,
          input.createdAt,
          input.updatedAt,
          input.lastReinforcedAt,
          input.evidenceCount,
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("upsertIntent: no row returned");
      return mapIntent(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "upsertIntent");
    }
  }

  /** The user's intents, heaviest first (id ascending as tiebreak). */
  async listForUser(userId: string): Promise<readonly PersistedIntent[]> {
    try {
      const rows = await this.db.query<IntentSqlRow>(
        `SELECT * FROM user_intents WHERE user_id = $1 ORDER BY weight DESC, id ASC`,
        [userId],
      );
      return rows.map(mapIntent);
    } catch (thrown) {
      throw classifyDriverError(thrown, "listForUser");
    }
  }

  /** One intent by canonical id (null when unknown). */
  async getIntent(intentId: string): Promise<PersistedIntent | null> {
    try {
      const rows = await this.db.query<IntentSqlRow>(
        `SELECT * FROM user_intents WHERE id = $1`,
        [intentId],
      );
      const row = rows[0];
      return row === undefined ? null : mapIntent(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "getIntent");
    }
  }

  /** Delete one intent by id. True when a row was removed. */
  async deleteIntent(intentId: string): Promise<boolean> {
    try {
      const rows = await this.db.query<{ id: string }>(
        `DELETE FROM user_intents WHERE id = $1 RETURNING id`,
        [intentId],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "deleteIntent");
    }
  }
}
