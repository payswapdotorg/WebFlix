-- R03 migration 0008 — source management lifecycle (connect / reauthorize /
-- disconnect, authorization-state truth, pending authorizations).
--
-- Extends migration 0005's `connector_accounts` with the lifecycle columns
-- the source-management surface needs, and adds the durable
-- pending-authorization records for oauth/device handshakes in flight:
--
-- - `authorized_at`      — when the CURRENT authorization was granted (set
--   on every sign-in, incl. re-authorization upserts; NULL while a row has
--   never reached `signedIn`).
-- - `last_state_change`  — when `auth_state` last moved (every save +
--   every setAuthState stamps it; the "see authorization state" recency).
-- - `availability_notes` — per-account quota/health notes (jsonb array of
--   strings; e.g. the YouTube connector's quota truth surfaced per
--   account). NEVER credential material — the model-input privacy law
--   (below) is enforced structurally over everything this table exposes
--   beyond the sealed envelope.
--
-- The envelope discipline is VERBATIM: the credential secret stays an
-- AES-256-GCM envelope (`ciphertext`/`iv`/`auth_tag` under `key_id`), the
-- plaintext never lands in these columns, and the model-input lanes can
-- only ever read the non-secret projection (src/model-input.ts).
--
-- `connector_pending_authorizations` — the R03 connect handshake state,
-- stored SERVER-SIDE keyed by the host-minted CSRF `state` token (the
-- state token appears in URLs; the pending RECORD never does). One live
-- pending per (user, connector) is the supersession law — enforced by the
-- store (`evictPendingAuthorizations` before a new save), not by a UNIQUE
-- constraint, because expired rows may briefly coexist during handover.
-- `flow_kind` mirrors the @wfx/connectors `AuthFlow["kind"]` union (CHECK
-- constraint as the second line of defense against vocabulary drift).

ALTER TABLE connector_accounts
    ADD COLUMN IF NOT EXISTS authorized_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_state_change timestamptz,
    ADD COLUMN IF NOT EXISTS availability_notes jsonb;

CREATE TABLE IF NOT EXISTS connector_pending_authorizations (
    state        text PRIMARY KEY,
    user_id      text NOT NULL,
    connector_id text NOT NULL,
    flow_kind    text NOT NULL CHECK (flow_kind IN ('oauth', 'device', 'local', 'none')),
    redirect_uri text,
    created_at   timestamptz NOT NULL,
    expires_at   timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS connector_pending_authorizations_user_idx
    ON connector_pending_authorizations (user_id, connector_id);
