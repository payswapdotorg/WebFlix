-- WFX-052 migration 0003 — user library, watch history, playback sessions.
--
-- library_entries: the user's WebFlix-local library (frozen `LibraryEntry`
-- per (user, connector, externalRef)). This is the "All social actions are
-- first recorded locally" law's durable side: a `save` lands here first,
-- inside the same transaction as its outbox event.
--
-- watch_history: the per-(user, item) watch state — latest playback
-- position, completion flag, last event type. This is what resume surfaces
-- read; the append-only event trail lives in the event outbox / downstream
-- telemetry, not here (this table is the aggregated projection).
--
-- playback_sessions: the frozen `PlaybackSession` entity (id `wfxpses_`,
-- chosen realization as jsonb `PlaybackRealization`, resumePositionMs).
-- Upsert-by-id; the id is the canonical session identity minted by the
-- experience layer.

CREATE TABLE IF NOT EXISTS library_entries (
    user_id      text NOT NULL,
    connector_id text NOT NULL,
    external_ref text NOT NULL,
    title        text NOT NULL,
    added_at     timestamptz NOT NULL,
    metadata     jsonb,
    PRIMARY KEY (user_id, connector_id, external_ref)
);

CREATE INDEX IF NOT EXISTS library_entries_user_recent_idx
    ON library_entries (user_id, added_at DESC);

CREATE TABLE IF NOT EXISTS watch_history (
    user_id         text NOT NULL,
    item_id         text NOT NULL,
    position_ms     bigint NOT NULL DEFAULT 0,
    completed       boolean NOT NULL DEFAULT false,
    last_event_type text,
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS watch_history_user_recent_idx
    ON watch_history (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS playback_sessions (
    id                 text PRIMARY KEY,
    user_id            text NOT NULL,
    item_id            text NOT NULL,
    realization        jsonb NOT NULL,
    resume_position_ms bigint NOT NULL DEFAULT 0,
    created_at         timestamptz NOT NULL,
    updated_at         timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS playback_sessions_user_recent_idx
    ON playback_sessions (user_id, updated_at DESC);
