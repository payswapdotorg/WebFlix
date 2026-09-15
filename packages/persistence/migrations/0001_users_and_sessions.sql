-- WFX-052 migration 0001 — identity: users + sessions.
-- Forward-only, idempotent (IF NOT EXISTS), deterministic (no data, no clock defaults).
--
-- users: the platform identity. `id` is a canonical opaque WebFlix user id
-- (`wfxusr_` + 26-char ULID body, minted by the app layer — never a DB
-- serial, so no enumeration and no drift with the domain's opaque-string
-- `userId` contract). `email` is stored LOWERCASED by the app layer and is
-- UNIQUE. `password_hash` is a scrypt envelope string (see
-- src/passwords.ts) — a plaintext or reversible password never touches this
-- table. No plaintext secrets at rest.
--
-- sessions: opaque bearer tokens. ONLY the SHA-256 hash of a token is
-- stored (`token_hash` UNIQUE) — a database disclosure does not yield
-- usable session tokens. Revocation is a timestamp (`revoked_at`), so
-- revoking is idempotent and auditable. Expiry is checked by the app layer
-- against `expires_at` with the injected clock (deterministic tests).

CREATE TABLE IF NOT EXISTS users (
    id            text PRIMARY KEY,
    email         text NOT NULL,
    display_name  text NOT NULL,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL,
    updated_at    timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

CREATE TABLE IF NOT EXISTS sessions (
    id         text PRIMARY KEY,
    user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash text NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_key ON sessions (token_hash);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
