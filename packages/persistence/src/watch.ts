/**
 * @wfx/persistence — watch history + durable playback sessions (WFX-052;
 * R02 profile scoping).
 *
 * Two durable stores over migrations 0003 + 0007:
 *
 * - `PostgresWatchHistoryStore` — the per-item watch-state PROJECTION
 *   (latest position, completion flag, last event type), now PROFILE-SCOPED
 *   (R02): the key is `(COALESCE(profile_id, 'user:' || user_id), item_id)` —
 *   the effective-profile key, exactly what migration 0007 indexes. The
 *   LEGACY API (`record`/`get`/`listRecent` keyed by userId) resolves the
 *   user's effective profile key first (`resolveEffectiveProfileKey` —
 *   materializing the default profile for a registered user on first use,
 *   the pseudo bucket otherwise), so pre-R02 callers keep bit-for-bit
 *   behavior while profile-aware callers pass `profileId` explicitly.
 *   `record*` remains the transactional-outbox write side: the projection
 *   row AND the matching frozen `EntertainmentEvent` commit in ONE
 *   transaction, and the outbox row carries the event's profile
 *   attribution.
 * - `PostgresPlaybackSessionStore` — the frozen `PlaybackSession` entity,
 *   upserted by canonical `wfxpses_` id (user-scoped; the frozen shape has
 *   no profile field and is never edited).
 *
 * Documented port gap (honest): `@wfx/experience`'s report use-cases bind
 * the concrete in-memory `PlaybackSessionStore` class — there is no
 * playback-session PORT to implement (Ports = connector/events/clock/ids
 * only). This durable store is the seam a future service lane composes
 * (e.g. hydrate the in-memory store from Postgres at request start, flush
 * on report); it is NOT wired into the frozen use-cases here because that
 * would require editing a frozen package.
 */

import type { EntertainmentEvent, PlaybackSession } from "@wfx/domain";

import type { Clock, IdGen } from "@wfx/experience";

import { classifyDriverError } from "./classify";
import { PersistenceError } from "./errors";
import { buildEnvelope, enqueueEvent } from "./outbox";
import { PostgresProfileService } from "./profiles";
import { epochMsToIso, toIsoTimestamp, type DbClient, type SqlClient } from "./sql";

/** The per-item watch-state projection row (profile-scoped via `profileId`). */
export interface WatchHistoryEntry {
  readonly userId: string;
  /** The effective profile this row is attributed to (never null post-R02 reads). */
  readonly profileId: string | null;
  readonly itemId: string;
  readonly positionMs: number;
  readonly completed: boolean;
  readonly lastEventType: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One watch-state observation to fold into the projection. */
export interface WatchObservation {
  readonly userId: string;
  /**
   * R02: the profile this observation is attributed to. OPTIONAL — when
   * absent, `record` resolves the user's effective profile key first (the
   * default-profile fallback); direct `recordWithin` callers writing
   * without one land in the legacy pseudo bucket (transition semantics).
   */
  readonly profileId?: string;
  /** Canonical entertainment-item id (`wfxitm_…`). */
  readonly itemId: string;
  /** The frozen watch-state event type this observation comes from. */
  readonly eventType: EntertainmentEvent["type"];
  /** Current position in ms (>= 0). */
  readonly positionMs: number;
  /** Completed when the observation is a `complete` event. */
  readonly completed: boolean;
  /** The experience session id stamped on the event (`sessionId` field). */
  readonly sessionId: string;
  /** Optional canonical source-realization id for event correlation. */
  readonly sourceRealizationId?: string;
  /** ISO 8601 occurrence instant (defaults to the injected clock's now). */
  readonly occurredAt?: string;
}

interface WatchSqlRow {
  user_id: string;
  profile_id: unknown | null;
  item_id: string;
  position_ms: unknown;
  completed: boolean;
  last_event_type: string | null;
  created_at: unknown;
  updated_at: unknown;
}

function mapWatch(row: WatchSqlRow): WatchHistoryEntry {
  return {
    userId: row.user_id,
    profileId:
      row.profile_id === null || row.profile_id === undefined
        ? null
        : String(row.profile_id),
    itemId: row.item_id,
    positionMs: Number(row.position_ms),
    completed: Boolean(row.completed),
    lastEventType: row.last_event_type,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

/** The migration-0007 effective-profile key expression (single source). */
const EFFECTIVE_PROFILE = `COALESCE(profile_id, 'user:' || user_id)`;

/** Constructor dependencies. */
export interface WatchHistoryStoreOptions {
  readonly db: DbClient;
  readonly clock: Clock;
  readonly ids: IdGen;
}

/**
 * The watch-history projection store. `record*` methods write the
 * projection row AND the event (transactional outbox) in one transaction.
 */
export class PostgresWatchHistoryStore {
  private readonly db: DbClient;
  private readonly clock: Clock;
  private readonly ids: IdGen;
  private readonly profiles: PostgresProfileService;

  constructor(options: WatchHistoryStoreOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.ids = options.ids;
    this.profiles = new PostgresProfileService({ db: options.db, ids: options.ids, clock: options.clock });
  }

  /**
   * The effective profile key for one user (the resolution law — see
   * `PostgresProfileService.resolveEffectiveProfileKey`).
   */
  async effectiveProfileKey(userId: string): Promise<string> {
    return this.profiles.resolveEffectiveProfileKey(userId);
  }

  /**
   * Fold one observation into the projection AND enqueue its frozen event,
   * inside the CALLER'S transaction (the outbox write side).
   */
  async recordWithin(tx: SqlClient, observation: WatchObservation): Promise<WatchHistoryEntry> {
    const problems = this.validateObservation(observation);
    if (problems.length > 0) {
      throw new PersistenceError("invalid-input", problems.join("; "), {
        operation: "watchHistory.recordWithin",
      });
    }

    const nowMs = this.clock.now();
    const occurredAt = observation.occurredAt ?? epochMsToIso(nowMs);

    // The event is the truth; the projection is derived. Both in ONE tx.
    const event: EntertainmentEvent = {
      userId: observation.userId,
      itemId: observation.itemId,
      type: observation.eventType,
      occurredAt,
      sessionId: observation.sessionId,
    };
    if (observation.sourceRealizationId !== undefined) {
      event.sourceRealizationId = observation.sourceRealizationId;
    }
    if (observation.positionMs > 0) {
      event.payload = { positionMs: observation.positionMs };
    }
    await enqueueEvent(tx, buildEnvelope(event, this.ids), nowMs, observation.profileId);

    try {
      const rows = await tx.query<WatchSqlRow>(
        `INSERT INTO watch_history (user_id, profile_id, item_id, position_ms, completed, last_event_type,
                                    created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         ON CONFLICT (${EFFECTIVE_PROFILE}, item_id) DO UPDATE SET
           position_ms = EXCLUDED.position_ms,
           completed = EXCLUDED.completed,
           last_event_type = EXCLUDED.last_event_type,
           updated_at = EXCLUDED.updated_at,
           profile_id = EXCLUDED.profile_id
         RETURNING *`,
        [
          observation.userId,
          observation.profileId ?? null,
          observation.itemId,
          observation.positionMs,
          observation.completed,
          observation.eventType,
          occurredAt,
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("recordWithin: no row returned");
      return mapWatch(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "watchHistory.recordWithin");
    }
  }

  /** The standalone form: projection + event in one internal transaction. */
  async record(observation: WatchObservation): Promise<WatchHistoryEntry> {
    // R02: resolve the effective profile key when the caller did not pass
    // one — the default-profile fallback (materializing for registered
    // users, the legacy pseudo bucket otherwise).
    const resolved: WatchObservation =
      observation.profileId === undefined
        ? {
            ...observation,
            profileId: await this.profiles.resolveEffectiveProfileKey(observation.userId),
          }
        : observation;
    return this.db.begin((tx) => this.recordWithin(tx, resolved));
  }

  /** One user-item projection row (null when never watched — a query). */
  async get(userId: string, itemId: string): Promise<WatchHistoryEntry | null> {
    const key = await this.profiles.resolveEffectiveProfileKey(userId);
    return this.getForProfile(key, itemId);
  }

  /** The user's history, most recently updated first (deterministic tiebreak). */
  async listRecent(userId: string, limit = 50): Promise<readonly WatchHistoryEntry[]> {
    const key = await this.profiles.resolveEffectiveProfileKey(userId);
    return this.listRecentForProfile(key, limit);
  }

  /** R02: one PROFILE-scoped projection row (null when never watched). */
  async getForProfile(profileId: string, itemId: string): Promise<WatchHistoryEntry | null> {
    try {
      const rows = await this.db.query<WatchSqlRow>(
        `SELECT * FROM watch_history WHERE ${EFFECTIVE_PROFILE} = $1 AND item_id = $2`,
        [profileId, itemId],
      );
      const row = rows[0];
      return row === undefined ? null : mapWatch(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "watchHistory.getForProfile");
    }
  }

  /** R02: one PROFILE's history, most recently updated first. */
  async listRecentForProfile(
    profileId: string,
    limit = 50,
  ): Promise<readonly WatchHistoryEntry[]> {
    try {
      const rows = await this.db.query<WatchSqlRow>(
        `SELECT * FROM watch_history WHERE ${EFFECTIVE_PROFILE} = $1
         ORDER BY updated_at DESC, item_id LIMIT $2`,
        [profileId, limit],
      );
      return rows.map(mapWatch);
    } catch (thrown) {
      throw classifyDriverError(thrown, "watchHistory.listRecentForProfile");
    }
  }

  private validateObservation(observation: WatchObservation): string[] {
    const problems: string[] = [];
    if (typeof observation.userId !== "string" || observation.userId.length === 0) {
      problems.push("userId: expected a non-empty string");
    }
    if (typeof observation.itemId !== "string" || observation.itemId.length === 0) {
      problems.push("itemId: expected a non-empty string");
    }
    if (typeof observation.sessionId !== "string" || observation.sessionId.length === 0) {
      problems.push("sessionId: expected a non-empty string");
    }
    if (
      typeof observation.positionMs !== "number" ||
      !Number.isFinite(observation.positionMs) ||
      observation.positionMs < 0
    ) {
      problems.push("positionMs: expected a finite non-negative number");
    }
    return problems;
  }
}

// ---------------------------------------------------------------------------
// Durable playback sessions
// ---------------------------------------------------------------------------

interface PlaybackSqlRow {
  id: string;
  user_id: string;
  item_id: string;
  realization: unknown;
  resume_position_ms: unknown;
  created_at: unknown;
  updated_at: unknown;
}

function mapPlaybackSession(row: PlaybackSqlRow): PlaybackSession {
  return {
    id: row.id,
    userId: row.user_id,
    itemId: row.item_id,
    realization: row.realization as PlaybackSession["realization"],
    resumePositionMs: Number(row.resume_position_ms),
    createdAt: toIsoTimestamp(row.created_at),
  };
}

/** Constructor dependencies. */
export interface PlaybackSessionStoreOptions {
  readonly db: DbClient;
  readonly clock: Clock;
}

/** The durable frozen-`PlaybackSession` store (see the module docs for the port gap). */
export class PostgresPlaybackSessionStore {
  private readonly db: DbClient;
  private readonly clock: Clock;

  constructor(options: PlaybackSessionStoreOptions) {
    this.db = options.db;
    this.clock = options.clock;
  }

  /** Insert-or-update one session by canonical id. Returns the stored row. */
  async save(session: PlaybackSession): Promise<PlaybackSession> {
    if (typeof session.id !== "string" || session.id.length === 0) {
      throw new PersistenceError("invalid-input", "session.id: expected a non-empty string", {
        operation: "playbackSessions.save",
      });
    }
    const nowIso = epochMsToIso(this.clock.now());
    try {
      const rows = await this.db.query<PlaybackSqlRow>(
        `INSERT INTO playback_sessions (id, user_id, item_id, realization, resume_position_ms,
                                        created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $6)
         ON CONFLICT (id) DO UPDATE SET
           resume_position_ms = EXCLUDED.resume_position_ms,
           realization = EXCLUDED.realization,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          session.id,
          session.userId,
          session.itemId,
          JSON.stringify(session.realization),
          session.resumePositionMs,
          nowIso,
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("save: no row returned");
      return mapPlaybackSession(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "playbackSessions.save");
    }
  }

  /** One session by id (null when unknown). */
  async get(id: string): Promise<PlaybackSession | null> {
    try {
      const rows = await this.db.query<PlaybackSqlRow>(
        `SELECT * FROM playback_sessions WHERE id = $1`,
        [id],
      );
      const row = rows[0];
      return row === undefined ? null : mapPlaybackSession(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "playbackSessions.get");
    }
  }

  /** Set the resume position; returns the updated session, or null when unknown. */
  async updateResume(id: string, resumePositionMs: number): Promise<PlaybackSession | null> {
    const nowIso = epochMsToIso(this.clock.now());
    try {
      const rows = await this.db.query<PlaybackSqlRow>(
        `UPDATE playback_sessions SET resume_position_ms = $2, updated_at = $3
         WHERE id = $1 RETURNING *`,
        [id, resumePositionMs, nowIso],
      );
      const row = rows[0];
      return row === undefined ? null : mapPlaybackSession(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "playbackSessions.updateResume");
    }
  }

  /** A user's sessions, most recently updated first. */
  async listRecent(userId: string, limit = 50): Promise<readonly PlaybackSession[]> {
    try {
      const rows = await this.db.query<PlaybackSqlRow>(
        `SELECT * FROM playback_sessions WHERE user_id = $1
         ORDER BY updated_at DESC, id LIMIT $2`,
        [userId, limit],
      );
      return rows.map(mapPlaybackSession);
    } catch (thrown) {
      throw classifyDriverError(thrown, "playbackSessions.listRecent");
    }
  }
}
