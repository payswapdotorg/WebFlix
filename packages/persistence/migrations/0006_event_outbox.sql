-- WFX-052 migration 0006 — the transactional event outbox.
--
-- THE pattern (frozen architecture: "Jobs: transactional outbox + durable
-- workers initially"): a domain event and the state change it describes are
-- written in ONE Postgres transaction — the event row IS the commit record.
-- A relay (`drainEventOutbox`, src/outbox.ts) then claims pending rows and
-- delivers them onward (downstream projections, analytics, webhooks).
-- Delivery semantics are AT-LEAST-ONCE: a crash between claim and
-- mark-delivered leaves the row `in-flight`, and `requeueStaleInFlight`
-- returns it to `pending` — consumers must be idempotent (documented in the
-- package README).
--
-- `id` is the canonical event identity (`wfxevt_` + ULID body, the frozen
-- EventEnvelope.eventId) — one row per envelope, enforced by the primary
-- key; `envelope` stores the full frozen EventEnvelope (schemaVersion 1).
-- The claim query walks (status, next_attempt_at, id) with
-- FOR UPDATE SKIP LOCKED, so multiple relays can drain concurrently without
-- double-claiming (at-least-once, not exactly-once — crash windows still
-- replay; that is the documented contract).

CREATE TABLE IF NOT EXISTS event_outbox (
    id              text PRIMARY KEY,
    user_id         text NOT NULL,
    item_id         text NOT NULL,
    event_type      text NOT NULL,
    envelope        jsonb NOT NULL,
    status          text NOT NULL CHECK (status IN ('pending','in-flight','delivered','failed')),
    attempts        integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL,
    created_at      timestamptz NOT NULL,
    claimed_at      timestamptz,
    delivered_at    timestamptz,
    last_error      text
);

CREATE INDEX IF NOT EXISTS event_outbox_claim_idx
    ON event_outbox (status, next_attempt_at, id);

CREATE INDEX IF NOT EXISTS event_outbox_user_recent_idx
    ON event_outbox (user_id, created_at DESC);
