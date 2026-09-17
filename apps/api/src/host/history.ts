/**
 * @wfx/app-api — the R04 history + removal/exclusion host adapter.
 *
 * The composition seam between the API routes
 * (`app/experience/history/**`) and the persistence-layer stores
 * (`PostgresWatchHistoryStore` + the new `PostgresHistoryRemovalStore` +
 * `PostgresHistoryExclusionStore`). It composes the EVENT-DERIVED history
 * read model (the watch_history projection) with the removal/exclusion
 * filters (the event-sink law: events stay recorded; the read model is a
 * PROJECTION).
 *
 * WHAT THE ROUTES SEE:
 * - `readHistory(profileId)`: the profile's viewing history, newest-first,
 *   removal/exclusion-aware (Continue Watching is `readContinueWatching`).
 * - `removeFromHistory(profileId, itemId)`: adds a removal row (idempotent).
 *   The item leaves the history READ MODEL + Continue Watching; the
 *   underlying events stay recorded (audit truth).
 * - `excludeFromHistory(profileId, itemId)`: adds an exclusion row
 *   (idempotent). The item never appears in history-derived surfaces until
 *   the user explicitly removes the exclusion.
 * - `removeExclusion(profileId, itemId)`: removes the exclusion row.
 *
 * THE EVENT-SINK LAW (testable): `removeFromHistory` and `excludeFromHistory`
 * NEVER touch the `event_outbox` table — the events are the immutable
 * truth. The removal/exclusion rows are PROJECTION-SIDE filters.
 *
 * WIRE SHAPE: `ProfileHistoryEntry` is the wire shape `GET /experience/history`
 * returns — structurally identical to the runtime's `ProfileHistoryEntry`
 * (`@wfx/client-runtime`'s server-port.ts); the adapters parse the JSON
 * into the runtime's type. The API does NOT depend on `@wfx/client-runtime`
 * (the lane rule); the two types are structurally identical, so TypeScript's
 * structural typing keeps them compatible.
 *
 * Determinism: pure composition over the persistence stores; no clock, no
 * randomness of its own (everything resolves through the injected seams).
 */

import type { Clock, IdGen } from "@wfx/experience";
import {
  PostgresHistoryExclusionStore,
  PostgresHistoryRemovalStore,
  PostgresWatchHistoryStore,
  type DbClient,
} from "@wfx/persistence";

/**
 * The wire shape `GET /experience/history` returns. Structurally identical
 * to the runtime's `ProfileHistoryEntry` (`@wfx/client-runtime`'s
 * server-port.ts) — the adapters parse the JSON into the runtime's type.
 */
export interface ProfileHistoryEntry {
  /** The canonical entertainment-item id (`wfxitm_…`). */
  readonly itemId: string;
  /** Latest known playback position in ms (>= 0). */
  readonly positionMs: number;
  /** Monotone completion flag (once true, always true). */
  readonly completed: boolean;
  /** The last folded watch-state event type, when the server reports one. */
  readonly lastEventType: string | null;
  /** ISO 8601 instant of the latest update (the recency order key). */
  readonly updatedAt: string;
}

/** One item in the Continue Watching shelf (J12). */
export interface ContinueWatchingEntry {
  /** The canonical item id (`wfxitm_…`). */
  readonly itemId: string;
  /** Latest known playback position in ms (>= 0). */
  readonly positionMs: number;
  /** The monotone completion flag. */
  readonly completed: boolean;
  /** The last folded watch-state event type, when the server reports one. */
  readonly lastEventType: string | null;
  /** ISO 8601 instant of the latest update (the recency order key). */
  readonly updatedAt: string;
}

/** Constructor dependencies (all injected). */
export interface HistoryHostOptions {
  readonly db: DbClient;
  readonly clock: Clock;
  readonly ids: IdGen;
}

/**
 * The R04 history host: the read-model composition over the watch-history
 * projection + the removal/exclusion filters. Created once per service boot
 * (alongside the identity/session/profile services).
 */
export class HistoryHost {
  private readonly watch: PostgresWatchHistoryStore;
  private readonly removals: PostgresHistoryRemovalStore;
  private readonly exclusions: PostgresHistoryExclusionStore;

  constructor(options: HistoryHostOptions) {
    this.watch = new PostgresWatchHistoryStore({
      db: options.db,
      clock: options.clock,
      ids: options.ids,
    });
    this.removals = new PostgresHistoryRemovalStore({
      db: options.db,
      clock: options.clock,
    });
    this.exclusions = new PostgresHistoryExclusionStore({
      db: options.db,
      clock: options.clock,
    });
  }

  /** The watch-history store (the raw projection). */
  watchStore(): PostgresWatchHistoryStore {
    return this.watch;
  }

  /** The removal store (for the relay's re-materialization hook). */
  removalStore(): PostgresHistoryRemovalStore {
    return this.removals;
  }

  /** The exclusion store. */
  exclusionStore(): PostgresHistoryExclusionStore {
    return this.exclusions;
  }

  /**
   * The profile's viewing history, newest-first, removal/exclusion-aware
   * (the R04 `GET /experience/history` shape: `ProfileHistoryEntry[]`).
   * Excludes items the user removed OR excluded — the events stay recorded
   * (audit truth); only the read model filters them.
   */
  async readHistory(
    profileId: string,
    limit = 50,
  ): Promise<readonly ProfileHistoryEntry[]> {
    const [rows, removed, excluded] = await Promise.all([
      this.watch.listRecentForProfile(profileId, limit),
      this.removals.listRemoved(profileId),
      this.exclusions.listExcluded(profileId),
    ]);
    const hidden = new Set<string>([...removed, ...excluded]);
    return rows
      .filter((row) => !hidden.has(row.itemId))
      .map((row): ProfileHistoryEntry => ({
        itemId: row.itemId,
        positionMs: row.positionMs,
        completed: row.completed,
        lastEventType: row.lastEventType,
        updatedAt: row.updatedAt,
      }));
  }

  /**
   * The Continue Watching shelf (J12): in-progress (not completed) items
   * with a resumable position (> 0), ordered by most-recent progress, capped
   * (the Netflix-style shelf), removal/exclusion-aware. Completed items
   * leave the shelf; a re-watch re-materializes them via the relay's
   * removal-clear hook (a new `start` event clears the removal row).
   */
  async readContinueWatching(
    profileId: string,
    limit = 20,
  ): Promise<readonly ContinueWatchingEntry[]> {
    const [rows, removed, excluded] = await Promise.all([
      this.watch.listRecentForProfile(profileId, limit * 4),
      this.removals.listRemoved(profileId),
      this.exclusions.listExcluded(profileId),
    ]);
    const hidden = new Set<string>([...removed, ...excluded]);
    return rows
      .filter((row) => !hidden.has(row.itemId))
      .filter((row) => !row.completed && row.positionMs > 0)
      .slice(0, limit)
      .map((row): ContinueWatchingEntry => ({
        itemId: row.itemId,
        positionMs: row.positionMs,
        completed: row.completed,
        lastEventType: row.lastEventType,
        updatedAt: row.updatedAt,
      }));
  }

  /**
   * Add a removal row (idempotent — keeps earliest removed_at). The item
   * leaves the history READ MODEL + Continue Watching; the underlying
   * events stay recorded (audit truth). A re-watch (a new watch-state event
   * arriving through the relay) DELETES the removal row — the item
   * re-materializes in history.
   */
  async removeFromHistory(
    input: { userId: string; itemId: string; profileId?: string },
  ): Promise<void> {
    await this.removals.add(input);
  }

  /**
   * Add an exclusion row (idempotent — keeps earliest excluded_at). The
   * item never appears in history-derived surfaces (Continue Watching,
   * already-watched signals) until the user explicitly removes the
   * exclusion. A re-watch does NOT clear an exclusion (the user's explicit
   * choice persists).
   */
  async excludeFromHistory(
    input: { userId: string; itemId: string; profileId?: string },
  ): Promise<void> {
    await this.exclusions.add(input);
  }

  /**
   * Remove an exclusion row (re-include the item in history-derived
   * surfaces). Returns true when an exclusion was removed.
   */
  async removeExclusion(profileId: string, itemId: string): Promise<boolean> {
    return this.exclusions.removeExclusion(profileId, itemId);
  }
}
