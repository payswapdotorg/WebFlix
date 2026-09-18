-- R15 migration 0011 — the durable action outbox, the local action audit,
-- and the persisted sync log.
--
-- THE PATTERN (frozen architecture, "Jobs: transactional outbox + durable
-- workers"; the remediation freeze: "All social actions are first recorded
-- locally. Outbound sync is attempted only through supported official
-- capabilities."): every user action (like/save/follow/comment/download/
-- transform) is RECORDED FIRST — one transactional write that lands the
-- action_outbox row AND its action_audit row TOGETHER (the local-first
-- recording law: a durable outbox row never exists without its audit row).
-- A durable worker (the SyncDispatcher over @wfx/actions' store contract)
-- then drains due rows through registered official connectors only.
--
-- A RECORDED action is WebFlix-confirmed; a DELIVERED action is
-- provider-confirmed. These are DIFFERENT states (golden journey J10) and
-- are never conflated: `status` is the closed six-state machine, and
-- `delivered` requires the provider's confirming receipt (the CHECK
-- constraint below).
--
-- Idempotency: `id` is the deterministic `wfxout_<idempotency-key>` digest
-- (@wfx/actions), `idempotency_key` is UNIQUE — the enqueue's ON CONFLICT
-- DO NOTHING + read-back answers the typed duplicate/conflict distinction
-- without ever overwriting.
--
-- Crash safety: `claimed_at` stamps the beginAttempt claim; a fresh claim
-- is never stolen (multi-worker), a stale one (crashed worker, past the
-- worker's staleness window) is reclaimable — at-least-once, exactly the
-- event_outbox relay's documented semantics; the connector-side dedupe key
-- is the record's idempotency key.
--
-- Privacy: NO credential or secret columns exist here — rows carry the
-- action identity (user/profile/connector/ref/token), the action payload
-- (user content), locale/region, the provider's receipt, and the typed
-- closed-vocabulary failure cause. The sync log's `cause` strings come from
-- the closed describe* vocabularies — never credentials, never tokens.

CREATE TABLE IF NOT EXISTS action_outbox (
    id                   text PRIMARY KEY,
    idempotency_key      text NOT NULL UNIQUE,
    user_id              text NOT NULL,
    profile_id           text,
    connector_id         text NOT NULL,
    action_type          text NOT NULL CHECK (action_type IN ('like','save','follow','comment','download','transform')),
    external_ref         text NOT NULL,
    client_request_token text NOT NULL,
    payload              jsonb,
    locale               text NOT NULL,
    region               text,
    status               text NOT NULL CHECK (status IN ('pending','in-flight','delivered','failed','unsupported','conflict')),
    attempts             integer NOT NULL DEFAULT 0,
    next_attempt_at      timestamptz NOT NULL,
    enqueued_at          timestamptz NOT NULL,
    claimed_at           timestamptz,
    delivered_at         timestamptz,
    receipt              jsonb,
    last_cause           jsonb,
    CONSTRAINT action_outbox_delivered_receipt CHECK (status <> 'delivered' OR receipt IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS action_outbox_due_idx
    ON action_outbox (status, next_attempt_at, id);

CREATE INDEX IF NOT EXISTS action_outbox_user_recent_idx
    ON action_outbox (user_id, enqueued_at DESC);

-- The local-first event record: one row per RECORDED action, written in the
-- SAME transaction as its action_outbox row (never after a sync attempt —
-- the ordering is the law and is test-enforced).
CREATE TABLE IF NOT EXISTS action_audit (
    id                   text PRIMARY KEY,
    user_id              text NOT NULL,
    profile_id           text,
    connector_id         text NOT NULL,
    action_type          text NOT NULL CHECK (action_type IN ('like','save','follow','comment','download','transform')),
    external_ref         text NOT NULL,
    client_request_token text NOT NULL,
    outbox_record_id     text NOT NULL,
    recorded_at          timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS action_audit_user_recent_idx
    ON action_audit (user_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS action_audit_record_idx
    ON action_audit (outbox_record_id);

-- The persisted sync audit trail: one row per dispatcher transition
-- (the durable SyncAuditLog implementation).
CREATE TABLE IF NOT EXISTS action_sync_log (
    seq             bigserial PRIMARY KEY,
    recorded_at     timestamptz NOT NULL,
    record_id       text NOT NULL,
    idempotency_key text NOT NULL,
    from_status     text NOT NULL CHECK (from_status IN ('pending','in-flight','delivered','failed','unsupported','conflict')),
    to_status       text NOT NULL CHECK (to_status IN ('pending','in-flight','delivered','failed','unsupported','conflict')),
    attempt         integer NOT NULL,
    cause           text NOT NULL
);

CREATE INDEX IF NOT EXISTS action_sync_log_record_idx
    ON action_sync_log (record_id, seq);
