/**
 * @wfx/app-api — the outbox relay + the real watch-history fold (WFX-055A).
 *
 * The durable event-delivery path over the 052 transactional outbox:
 *
 * - `runRelayDrain` — the relay proper: FIRST requeue rows a crashed relay
 *   left `in-flight` past the staleness window (at-least-once recovery),
 *   THEN claim due pending rows (`drainEventOutbox` — `FOR UPDATE SKIP
 *   LOCKED`, so concurrent relays never double-claim) and deliver each
 *   envelope through the consumer below.
 * - `makeWatchHistoryDeliverer` — the RELAY'S DOWNSTREAM: the real
 *   watch-history fold the 052 schema owns. Watch-state events
 *   (`start`/`progress`/`complete`/`skip` — the frozen
 *   `WATCH_STATE_EVENT_TYPES`) fold into the `watch_history` projection
 *   with the 052 upsert semantics: the event is the truth, the projection
 *   is derived. Non-watch events (`impression`, `like`, `dislike`,
 *   `save`, `share`, `search`) have NO projection consumer yet — for them
 *   the deliverer is an honest documented no-op (the envelope is marked
 *   delivered; the outbox remains the system of record for those types
 *   until their consumers ship).
 *
 * Fold semantics (documented, idempotent under at-least-once redelivery —
 * and DELIVERY-ORDER-SAFE by construction): the drain claims rows with
 * `UPDATE ... WHERE id IN (SELECT ... ORDER BY ...) RETURNING`, and SQL
 * makes NO guarantee about `RETURNING` row order (PGlite demonstrably
 * returns non-insertion order; real Postgres may reorder after vacuums) —
 * and at-least-once redelivery crosses drain boundaries anyway (an old
 * event can arrive in a LATER drain after a crash + requeue). The fold
 * therefore never trusts delivery order:
 * - `position_ms` is the high-water mark: it advances only when the event
 *   SPEAKS a position (`payload.positionMs`, a finite number ≥ 0) and only
 *   UP (`GREATEST` with the stored value) — an out-of-order or replayed
 *   event can never rewind progress;
 * - `completed` is monotone (once true, always true);
 * - `last_event_type` / `updated_at` reflect the event with the LATEST
 *   `occurredAt` (occurrence order — deterministic under any delivery
 *   order; equal timestamps: the later-processed event wins the label);
 * - `created_at` keeps the EARLIEST `occurredAt` folded (when watching
 *   began), also deterministic under any delivery order.
 * The canonical pure fold remains `deriveWatchHistory` (@wfx/experience);
 * this SQL is its durable store side.
 *
 * - `scheduleOpportunisticDrain` — the packet §4 second delivery lane:
 *   the events endpoint nudges a bounded best-effort drain after
 *   enqueuing (after N events OR once per interval per instance — never a
 *   tight loop). On Vercel serverless the instance may be frozen right
 *   after the response, so this lane is HONESTLY best-effort; the vercel
 *   cron is the guaranteed floor. HOBBY-CRON REALITY: the Vercel Hobby
 *   plan allows DAILY crons only — `vercel.json` schedules one drain per
 *   day (03:00 UTC) and everything finer is opportunistic.
 */

import type { EventEnvelope } from "@wfx/domain";
import { WATCH_STATE_EVENT_TYPES, type Clock } from "@wfx/experience";
import {
  classifyDriverError,
  drainEventOutbox,
  requeueStaleInFlight,
  PostgresHistoryRemovalStore,
  PostgresProfileService,
  type DbClient,
  type DrainEventOutboxResult,
  type OutboxDeliverer,
  type OutboxDeliveryContext,
} from "@wfx/persistence";

/** The watch-state event types as a runtime set (the fold's filter). */
const WATCH_EVENT_TYPES: ReadonlySet<string> = new Set(WATCH_STATE_EVENT_TYPES);

/** Staleness window before an `in-flight` row is considered a crashed relay. */
const STALE_IN_FLIGHT_MS = 10 * 60_000;

/** What one relay run did. */
export interface RelayRunResult {
  /** Rows a crashed relay left in-flight, returned to pending first. */
  readonly requeued: number;
  /** The drain's own outcome (claimed/delivered/rescheduled/failed). */
  readonly drain: DrainEventOutboxResult;
}

/**
 * The relay's downstream fold — R02 PROFILE-SCOPED: the row's
 * ingest-time profile attribution (`context.profileId`) wins; NULL
 * (legacy/anonymous ingest) resolves the user's EFFECTIVE profile (the
 * default-profile fallback, materializing for registered users). No-op
 * (mark delivered) for the event types that have no projection consumer
 * yet.
 *
 * Fold semantics (documented, idempotent under at-least-once redelivery —
 * and DELIVERY-ORDER-SAFE by construction): the drain claims rows with
 * `UPDATE ... WHERE id IN (SELECT ... ORDER BY ...) RETURNING`, and SQL
 * makes NO guarantee about `RETURNING` row order (PGlite demonstrably
 * returns non-insertion order; real Postgres may reorder after vacuums) —
 * and at-least-once redelivery crosses drain boundaries anyway (an old
 * event can arrive in a LATER drain after a crash + requeue). The fold
 * therefore never trusts delivery order:
 * - `position_ms` is the high-water mark: it advances only when the event
 *   SPEAKS a position (`payload.positionMs`, a finite number ≥ 0) and only
 *   UP (`GREATEST` with the stored value) — an out-of-order or replayed
 *   event can never rewind progress;
 * - `completed` is monotone (once true, always true);
 * - `last_event_type` / `updated_at` reflect the event with the LATEST
 *   `occurredAt` (occurrence order — deterministic under any delivery
 *   order; equal timestamps: the later-processed event wins the label);
 * - `created_at` keeps the EARLIEST `occurredAt` folded (when watching
 *   began), also deterministic under any delivery order;
 * - the CONFLICT KEY is the effective profile (migration 0007's COALESCE
 *   index): `profile_id = EXCLUDED.profile_id` normalizes legacy NULL
 *   rows into their bucket on first conflict, and at-least-once
 *   redelivery of the same event is idempotent per (profile, item).
 * The canonical pure fold remains `deriveWatchHistory` (@wfx/experience);
 * this SQL is its durable store side.
 *
 * - `scheduleOpportunisticDrain` — the packet §4 second delivery lane:
 *   the events endpoint nudges a bounded best-effort drain after
 *   enqueuing (after N events OR once per interval per instance — never a
 *   tight loop). On Vercel serverless the instance may be frozen right
 *   after the response, so this lane is HONESTLY best-effort; the vercel
 *   cron is the guaranteed floor. HOBBY-CRON REALITY: the Vercel Hobby
 *   plan allows DAILY crons only — `vercel.json` schedules one drain per
 *   day (03:00 UTC) and everything finer is opportunistic.
 */

/** The migration-0007 effective-profile key expression (single source). */
const EFFECTIVE_PROFILE = `COALESCE(profile_id, 'user:' || user_id)`;

/** Read the position an event speaks (0 = the event says nothing about position). */
function readPositionMs(payload: Record<string, unknown> | undefined): number {
  if (payload === undefined) return 0;
  const value = payload.positionMs;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/**
 * Build the relay's downstream consumer: fold watch-state envelopes into
 * the 052 `watch_history` projection (profile-scoped — see the module
 * doc); no-op (mark delivered) for the event types that have no projection
 * consumer yet.
 *
 * R04 — THE EVENT-SINK LAW RE-MATERIALIZATION HOOK: when a NEW watch-state
 * event arrives for an item the user previously REMOVED from history
 * (`DELETE /experience/history/:itemId`), the fold FIRST clears the removal
 * row — the item re-materializes in history (a re-watch). The frozen event
 * itself is NEVER touched (the event_outbox is the immutable truth; the
 * removal is a projection-side filter only). The removal store is OPTIONAL —
 * when omitted, the fold skips the clear step (the pre-R04 behavior; tests
 * that exercise the fold in isolation without removals).
 *
 * @param profiles the profile service used to resolve the EFFECTIVE
 * profile for legacy/anonymous (NULL-attributed) rows at delivery time —
 * pass the boot's service; a seam-less fallback is built when omitted for
 * direct test callers whose users never materialize profiles.
 * @param removals the R04 history-removal store; when provided, the fold
 * clears any removal row before upserting the projection (re-materialize on
 * re-watch). Optional to keep pre-R04 test callers unchanged.
 */
export function makeWatchHistoryDeliverer(
  db: DbClient,
  clock: Clock,
  profiles?: PostgresProfileService,
  removals?: PostgresHistoryRemovalStore,
): OutboxDeliverer {
  // Fallback service without id seam: legacy NULL rows for UNREGISTERED
  // users resolve the pseudo bucket (no minting); a registered user's
  // materialization honestly throws the typed config-error — pass the
  // boot's service for the real paths.
  const resolver = profiles ?? new PostgresProfileService({ db, clock });
  return async (envelope: EventEnvelope, context: OutboxDeliveryContext): Promise<void> => {
    const event = envelope.event;
    if (!WATCH_EVENT_TYPES.has(event.type)) {
      // Honest no-op consumer: no projection exists for this event type
      // yet — the row is still marked delivered by the drain.
      return;
    }
    const positionMs = readPositionMs(event.payload);
    const completed = event.type === "complete";
    // R02: the ingest-time attribution wins; NULL resolves the effective
    // profile (default-profile fallback — the anonymous transition law).
    const profileId =
      context.profileId !== null
        ? context.profileId
        : await resolver.resolveEffectiveProfileKey(event.userId);
    // R04: clear any removal row first (re-materialize on re-watch). The
    // clear step is best-effort alongside the upsert — a failure here
    // surfaces as the same degradation family (the upsert below is the
    // source of truth for the projection row; the removal-clear is a
    // convenience so the user sees the re-watched item in history again
    // without an extra DELETE).
    if (removals !== undefined) {
      try {
        await removals.clearRemoval(profileId, event.itemId);
      } catch (thrown) {
        // The clear failure is logged but never blocks the fold — the
        // projection row is still upserted; the removal row may briefly
        // mask it. The next fold (at-least-once) re-tries.
        console.error(
          `[webflix-api] history removal clear failed for profile=${profileId} item=${event.itemId}: ${String(thrown)}`,
        );
      }
    }
    try {
      await db.query(
        `INSERT INTO watch_history (user_id, profile_id, item_id, position_ms, completed, last_event_type,
                                    created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         ON CONFLICT (${EFFECTIVE_PROFILE}, item_id) DO UPDATE SET
           position_ms = CASE WHEN $4 > 0
                              THEN GREATEST($4, watch_history.position_ms)
                              ELSE watch_history.position_ms END,
           completed = watch_history.completed OR EXCLUDED.completed,
           last_event_type = CASE WHEN EXCLUDED.updated_at >= watch_history.updated_at
                                  THEN EXCLUDED.last_event_type
                                  ELSE watch_history.last_event_type END,
           updated_at = GREATEST(EXCLUDED.updated_at, watch_history.updated_at),
           created_at = LEAST(watch_history.created_at, EXCLUDED.created_at),
           profile_id = EXCLUDED.profile_id`,
        [event.userId, profileId, event.itemId, positionMs, completed, event.type, event.occurredAt],
      );
    } catch (thrown) {
      // Re-classify so the drain's retry/backoff path sees the typed
      // degradation family (never a raw driver error).
      throw classifyDriverError(thrown, "relay.deliverWatchHistory");
    }
  };
}

/**
 * Run one relay pass: requeue stale in-flight rows, then drain due
 * pending rows through the watch-history fold.
 */
export async function runRelayDrain(
  db: DbClient,
  clock: Clock,
  limit = 50,
  profiles?: PostgresProfileService,
  removals?: PostgresHistoryRemovalStore,
): Promise<RelayRunResult> {
  const requeued = await requeueStaleInFlight(db, {
    now: clock.now(),
    olderThanMs: STALE_IN_FLIGHT_MS,
  });
  const drain = await drainEventOutbox(db, {
    deliver: makeWatchHistoryDeliverer(db, clock, profiles, removals),
    now: clock.now(),
    limit,
  });
  return { requeued, drain };
}

// ---------------------------------------------------------------------------
// The opportunistic drain lane (packet §4)
// ---------------------------------------------------------------------------

/** Drain after this many enqueued events (per instance). */
const OPPORTUNISTIC_AFTER_EVENTS = 10;
/** …or at most once per this interval (per instance) — never a tight loop. */
const OPPORTUNISTIC_MIN_INTERVAL_MS = 60_000;
/** Bound each opportunistic claim (the cron drain uses a larger bound). */
const OPPORTUNISTIC_LIMIT = 20;

let eventsSinceDrain = 0;
let lastOpportunisticDrainMs = 0;
let opportunisticInFlight = false;

/**
 * Nudge a bounded best-effort drain after a successful event enqueue
 * (called by the events endpoint). Fire-and-forget: it NEVER delays the
 * response, NEVER throws into the caller, and is throttled to at most one
 * drain per interval (plus the every-N-events trigger) per instance. If
 * the serverless instance is frozen before it completes, the cron lane
 * still delivers — at-least-once, never lost.
 */
export function scheduleOpportunisticDrain(
  db: DbClient,
  clock: Clock,
  profiles?: PostgresProfileService,
  removals?: PostgresHistoryRemovalStore,
): void {
  eventsSinceDrain += 1;
  const now = clock.now();
  const dueByCount = eventsSinceDrain >= OPPORTUNISTIC_AFTER_EVENTS;
  const dueByInterval = now - lastOpportunisticDrainMs >= OPPORTUNISTIC_MIN_INTERVAL_MS;
  if (!dueByCount && !dueByInterval) return;
  if (opportunisticInFlight) return;

  eventsSinceDrain = 0;
  lastOpportunisticDrainMs = now;
  opportunisticInFlight = true;

  void runRelayDrain(db, clock, OPPORTUNISTIC_LIMIT, profiles, removals)
    .then((result) => {
      const { claimed, delivered, rescheduled, failed } = result.drain;
      console.error(
        `[webflix-api] opportunistic outbox drain: claimed=${claimed} delivered=${delivered} ` +
          `rescheduled=${rescheduled} failed=${failed} requeued=${result.requeued}`,
      );
    })
    .catch((thrown: unknown) => {
      // Best-effort by contract — the cron lane remains the floor.
      console.error(`[webflix-api] opportunistic outbox drain failed: ${String(thrown)}`);
    })
    .finally(() => {
      opportunisticInFlight = false;
    });
}
