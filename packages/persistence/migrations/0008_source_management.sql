-- R03 (source management) migration 0008 — account lifecycle truth +
-- pending authorizations.
--
-- Extends `connector_accounts` (0005) with the lifecycle columns the source
-- management surface reports, and adds the durable PENDING AUTHORIZATION
-- records an in-flight oauth/device/local handshake persists server-side
-- (never in URLs — the `state` column is the caller-minted OPAQUE token the
-- provider echoes back; the authorization ITSELF — user, connector, flow,
-- expiry — lives only here).
--
-- `authorized_at`        — when the CURRENT credential completed
--                          authorization (rotated on reauthorize-upsert).
-- `last_state_change`    — when `auth_state` last changed (the projection's
--                          clock truth; never silently stale).
-- `health`               — per-account quota/health notes (jsonb, typed at
--                          the store layer; NEVER credential material — the
--                          store rejects secret-shaped fields at write).
--
-- Pending authorizations: ONE live pending per (user_id, connector_id) is
-- the application-level law (a new begin supersedes the old one — the
-- connector SDK's evict-on-begin rule); the UNIQUE index below enforces it
-- at the storage layer. `flow_kind` is one of the three COMPLETABLE flow
-- kinds (`none` flows never create a pending — the connector needs no
-- authorization).

ALTER TABLE connector_accounts
    ADD COLUMN IF NOT EXISTS authorized_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_state_change timestamptz,
    ADD COLUMN IF NOT EXISTS health jsonb;

CREATE TABLE IF NOT EXISTS connector_pending_authorizations (
    id           text PRIMARY KEY,
    user_id      text NOT NULL,
    connector_id text NOT NULL,
    state        text NOT NULL,
    flow_kind    text NOT NULL CHECK (flow_kind IN ('oauth','device','local')),
    expires_at   timestamptz NOT NULL,
    created_at   timestamptz NOT NULL,
    metadata     jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS connector_pending_authorizations_live
    ON connector_pending_authorizations (user_id, connector_id);

CREATE UNIQUE INDEX IF NOT EXISTS connector_pending_authorizations_state
    ON connector_pending_authorizations (state);
