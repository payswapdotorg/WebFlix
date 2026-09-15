/**
 * @wfx/persistence — watch history + durable playback sessions (WFX-052).
 *
 * Two durable stores over migration 0003:
 *
 * - `PostgresWatchHistoryStore` — the per-(user, item) watch-state
 *   PROJECTION (latest position, completion flag, last event type). The
 *   append-only truth is the event outbox; this table is the aggregate a
 *   resume surface reads without folding the whole stream. `recordWithin`
 *   is the transactional-outbox write side: the projection row AND the
 *   matching frozen `EntertainmentEvent` commit in ONE transaction.
 * - `PostgresPlaybackSessionStore` — the frozen `PlaybackSession` entity,
 *   upserted by canonical `wfxpses_` id.
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
import { epochMsToIso, toIsoTimestamp, type DbClient, type SqlClient } from "./sql";

/** The per-item watch-state projection row. */
export interface WatchHistoryEntry {
  readonly userId: string;
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
    itemId: row.item_id,
    positionMs: Number(row.position_ms),
    completed: Boolean(row.completed),
    lastEventType: row.last_event_type,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

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

  constructor(options: WatchHistoryStoreOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.ids = options.ids;
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
    await enqueueEvent(tx, buildEnvelope(event, this.ids), nowMs);

    try {
      const rows = await tx.query<WatchSqlRow>(
        `INSERT INTO watch_history (user_id, item_id, position_ms, completed, last_event_type,
                                    created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (user_id, item_id) DO UPDATE SET
           position_ms = EXCLUDED.position_ms,
           completed = EXCLUDED.completed,
           last_event_type = EXCLUDED.last_event_type,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          observation.userId,
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
    return this.db.begin((tx) => this.recordWithin(tx, observation));
  }

  /** One user-item projection row (null when never watched — a query). */
  async get(userId: string, itemId: string): Promise<WatchHistoryEntry | null> {
    try {
      const rows = await this.db.query<WatchSqlRow>(
        `SELECT * FROM watch_history WHERE user_id = $1 AND item_id = $2`,
        [userId, itemId],
      );
      const row = rows[0];
      return row === undefined ? null : mapWatch(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "watchHistory.get");
    }
  }

  /** The user's history, most recently updated first (deterministic tiebreak). */
  async listRecent(userId: string, limit = 50): Promise<readonly WatchHistoryEntry[]> {
    try {
      const rows = await this.db.query<WatchSqlRow>(
        `SELECT * FROM watch_history WHERE user_id = $1
         ORDER BY updated_at DESC, item_id LIMIT $2`,
        [userId, limit],
      );
      return rows.map(mapWatch);
    } catch (thrown) {
      throw classifyDriverError(thrown, "watchHistory.listRecent");
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
