-- R06 migration 0011 — model policy, BYOM provider bindings, transform ops.
--
-- Three durable stores backing the R06 Model and AI controls surface:
--
-- 1. model_policy — the FROZEN `ModelPolicy` shape per profile: preferred
--    provider, fallback chain, privacy class, cost ceiling. One row per
--    (effective profile, ModelTask). The frozen contract is the single
--    source of truth — the column CHECK constraints are the database's
--    last line of defense against vocabulary drift (the same law as
--    0010's feedback kind CHECK).
--
-- 2. byom_provider_bindings — envelope-encrypted BYOM credentials. ONE
--    per (effective profile, providerId) — UNIQUE, upserted. The key
--    material is sealed with AES-256-GCM (the 0005 envelope-crypto
--    pattern verbatim): ciphertext + iv + auth_tag + key_id. Plaintext
--    is NEVER at rest (the R03 discipline, applied to BYOM keys per the
--    R06 spec). key_id rotation is observable BEFORE decryption is
--    attempted (the connector-accounts rotation pattern).
--
-- 3. transform_operations — explicit transformation operations with
--    append-only state history. Each row is one submitted transform:
--    kind, target reference, options, the EXPLICIT state machine
--    (queued | running | succeeded | failed | cancelled), a result
--    reference (null until success), an error detail (null until
--    failure), and progress where the fabric reports it. State
--    transitions are RECORDED in transform_operation_states — every
--    transition is APPENDED (never overwritten), so the operation's
--    lifecycle is honest audit truth.
--
-- THE PRIVACY LAW (R06, doubled): provider credentials never enter
-- model prompts AND BYOM keys never enter logs, URLs, or model prompts.
-- The byom_provider_bindings row carries the sealed envelope ONLY; the
-- fabric router transports the opened key to the provider transport
-- ALONE — the model-input lane (model-input.ts) is structurally unable
-- to read it. A test pins this (see packages/persistence/tests/
-- model-controls.test.ts).

CREATE TABLE IF NOT EXISTS model_policy (
    id            text PRIMARY KEY,
    user_id       text NOT NULL,
    profile_id    text,
    task          text NOT NULL CHECK (task IN ('recommendation','ranking','summary','translation','transcription','speechToText','textToSpeech','dubbing','commentary')),
    preferred_provider text,
    fallback_providers text NOT NULL DEFAULT '[]'::jsonb,
    privacy       text NOT NULL CHECK (privacy IN ('local-only','trusted-cloud','any-cloud')),
    max_cost_per_operation double precision,
    created_at    timestamptz NOT NULL,
    updated_at    timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS model_policy_profile_task_identity
    ON model_policy (COALESCE(profile_id, 'user:' || user_id), task);

CREATE TABLE IF NOT EXISTS byom_provider_bindings (
    id              text PRIMARY KEY,
    user_id         text NOT NULL,
    profile_id      text,
    provider_id     text NOT NULL,
    endpoint_url    text NOT NULL,
    ciphertext      text NOT NULL,
    iv              text NOT NULL,
    auth_tag        text NOT NULL,
    key_id          text NOT NULL,
    metadata        jsonb,
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS byom_provider_bindings_profile_provider_identity
    ON byom_provider_bindings (COALESCE(profile_id, 'user:' || user_id), provider_id);

CREATE TABLE IF NOT EXISTS transform_operations (
    id            text PRIMARY KEY,
    user_id       text NOT NULL,
    profile_id    text,
    kind          text NOT NULL CHECK (kind IN ('transcript','translation','subtitle','summary','speech','transcribe','dubbing','commentary')),
    target_ref    text NOT NULL,
    options       jsonb NOT NULL DEFAULT '{}'::jsonb,
    state         text NOT NULL CHECK (state IN ('queued','running','succeeded','failed','cancelled')),
    progress      double precision CHECK (progress IS NULL OR (progress >= 0 AND progress <= 1)),
    result_ref    text,
    error_detail  text,
    created_at    timestamptz NOT NULL,
    updated_at    timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS transform_operations_profile_idx
    ON transform_operations (COALESCE(profile_id, 'user:' || user_id));

CREATE TABLE IF NOT EXISTS transform_operation_states (
    id            text PRIMARY KEY,
    operation_id  text NOT NULL,
    state         text NOT NULL CHECK (state IN ('queued','running','succeeded','failed','cancelled')),
    progress     double precision CHECK (progress IS NULL OR (progress >= 0 AND progress <= 1)),
    detail       text,
    transitioned_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS transform_operation_states_op_idx
    ON transform_operation_states (operation_id, transitioned_at);
