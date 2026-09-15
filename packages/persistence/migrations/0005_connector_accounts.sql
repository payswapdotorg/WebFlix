-- WFX-052 migration 0005 — connector accounts with envelope-encrypted
-- credentials.
--
-- One account per (user_id, connector_id) — UNIQUE. The credential secret is
-- stored as an AES-256-GCM envelope: `ciphertext`, `iv` (12 bytes), and
-- `auth_tag` (16 bytes), all base64, produced with APP_ENCRYPTION_KEY (see
-- src/envelope-crypto.ts). The plaintext secret NEVER lands in this table —
-- not in the row, not in metadata, not in logs. `key_id` is a rotation
-- fingerprint (leading hex of SHA-256(key)) so an account written under a
-- different key is detectable BEFORE a decrypt is attempted.
--
-- `kind` mirrors the @wfx/connectors `SecretKind` union; `auth_state`
-- mirrors its `AuthSessionState` union (signedOut | authorizing | signedIn |
-- expired | failed) — the durable account state a connector's auth session
-- machine projects onto. CHECK constraints encode both unions.

CREATE TABLE IF NOT EXISTS connector_accounts (
    id           text PRIMARY KEY,
    user_id      text NOT NULL,
    connector_id text NOT NULL,
    kind         text NOT NULL CHECK (kind IN ('oauth-token','device-token','local-token','local-userpass')),
    auth_state   text NOT NULL CHECK (auth_state IN ('signedOut','authorizing','signedIn','expired','failed')),
    ciphertext   text NOT NULL,
    iv           text NOT NULL,
    auth_tag     text NOT NULL,
    key_id       text NOT NULL,
    metadata     jsonb,
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS connector_accounts_identity
    ON connector_accounts (user_id, connector_id);

CREATE INDEX IF NOT EXISTS connector_accounts_connector_idx
    ON connector_accounts (connector_id);
