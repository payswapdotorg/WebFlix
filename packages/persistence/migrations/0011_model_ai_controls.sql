-- R06 migration 0011 — model and AI controls (per profile).
--
-- Three durable surfaces for the R06 control state:
--
-- model_policies: the per-profile model policy (the FROZEN ModelPolicy shape,
-- consumed as-is — packages/domain contracts/frozen.ts). ONE policy per
-- (effective profile, task) — UNIQUE, upserted. The task/privacy vocabularies
-- are enforced BOTH here (CHECK — the database is the last line of defense)
-- and at the API boundary (the typed 400 channel). `fallback_providers` is a
-- NON-EMPTY jsonb array of provider id strings (the frozen contract's own
-- shape law; the application layer validates non-emptiness + entries).
--
-- model_provider_bindings: the BYOM provider bindings — ONE per (effective
-- profile, provider) — UNIQUE, upserted. The API key is sealed with
-- AES-256-GCM (the connector_accounts discipline verbatim): ciphertext + iv
-- + auth_tag + key_id stored, plaintext NEVER at rest; key-rotation mismatch
-- is detectable BEFORE decryption (the typed key-mismatch load outcome).
-- The BYOM privacy law is doubled here: the sealed key is opened ONLY for
-- the provider transport lane (loadBinding — caller-only visibility); every
-- read surface (listBinding, the API responses) serves the secret-free
-- record. `tasks` is the jsonb array of frozen ModelTask values the binding
-- covers. `endpoint` is the binding's endpoint URL (public metadata — never
-- key material).
--
-- transform_operations + transform_operation_events: the EXPLICIT AI media
-- transformation operations (queued → running → succeeded | failed |
-- cancelled). The operations row carries the current state (CHECK-enforced
-- vocabulary), the frozen-at-submit input + routing directive (jsonb), the
-- optional progress (double precision, [0,1], enforced by the app layer),
-- the result (jsonb: reference + providerId + output + estimates), and the
-- error detail. transform_operation_events is the APPEND-ONLY state
-- history: insert-only rows (from_state, to_state, event, at, reason) —
-- NO code path updates or deletes them (the store exposes transition only).
-- The state-column update is guarded by the expected prior state (the
-- UPDATE ... WHERE state = expected, answering the typed conflict on
-- mismatch — never a silent overwrite).

CREATE TABLE IF NOT EXISTS model_policies (
    profile_key           text NOT NULL,
    task                  text NOT NULL CHECK (task IN ('recommendation','ranking','summary','translation','transcription','speechToText','textToSpeech','dubbing','commentary')),
    preferred_provider    text,
    fallback_providers    jsonb NOT NULL,
    privacy               text NOT NULL CHECK (privacy IN ('local-only','trusted-cloud','any-cloud')),
    max_cost_per_operation double precision,
    created_at            timestamptz NOT NULL,
    updated_at            timestamptz NOT NULL,
    PRIMARY KEY (profile_key, task)
);

CREATE TABLE IF NOT EXISTS model_provider_bindings (
    id            text PRIMARY KEY,
    profile_key   text NOT NULL,
    provider_id   text NOT NULL,
    endpoint      text NOT NULL,
    tasks         jsonb NOT NULL,
    privacy       text NOT NULL CHECK (privacy IN ('local-only','trusted-cloud','any-cloud')),
    ciphertext    text NOT NULL,
    iv            text NOT NULL,
    auth_tag      text NOT NULL,
    key_id        text NOT NULL,
    created_at    timestamptz NOT NULL,
    updated_at    timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS model_provider_bindings_identity
    ON model_provider_bindings (profile_key, provider_id);

CREATE TABLE IF NOT EXISTS transform_operations (
    id            text PRIMARY KEY,
    owner_key     text NOT NULL,
    kind          text NOT NULL CHECK (kind IN ('transcript','translation','subtitle','summary','speech','transcribe','dubbing','commentary')),
    input         jsonb NOT NULL,
    options       jsonb NOT NULL,
    state         text NOT NULL CHECK (state IN ('queued','running','succeeded','failed','cancelled')),
    progress      double precision,
    result        jsonb,
    error_detail  jsonb,
    created_at    timestamptz NOT NULL,
    updated_at    timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS transform_operations_owner_idx
    ON transform_operations (owner_key, created_at DESC);

CREATE TABLE IF NOT EXISTS transform_operation_events (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation_id text NOT NULL REFERENCES transform_operations(id) ON DELETE CASCADE,
    from_state   text NOT NULL CHECK (from_state IN ('queued','running','succeeded','failed','cancelled')),
    to_state     text NOT NULL CHECK (to_state IN ('queued','running','succeeded','failed','cancelled')),
    event        text NOT NULL CHECK (event IN ('start','succeed','fail','cancel')),
    reason       text,
    occurred_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS transform_operation_events_operation_idx
    ON transform_operation_events (operation_id, id);
