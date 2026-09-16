-- R02 migration 0007 — identity + profiles: profile records, session-bound
-- active profiles, and profile-scoped user data.
--
-- Forward-only, idempotent (IF NOT EXISTS / IF EXISTS), deterministic (no
-- data seeded, no clock read — the legacy-row attribution is a RUNTIME lazy
-- migration, deliberately: profile ids are minted by the app layer from the
-- injected IdGen, which SQL cannot and must not reproduce).
--
-- profiles: one row per profile per user. id = `wfxprof_` + ULID body
-- (app-minted, never a DB serial). ONE designated default profile per user
-- is enforced STRUCTURALLY by the partial unique index on (user_id) WHERE
-- is_default. user_id carries the full FK to users — profiles are a
-- property of a REAL account (the anonymous stopgap never materializes a
-- profiles row; see src/profiles.ts for the legacy pseudo-bucket).
--
-- sessions.active_profile_id: the profile the session currently operates
-- as (PUT /profiles/:id/select). Nullable: a fresh session resolves to the
-- user's default profile until the user picks one. ON DELETE SET NULL so a
-- future profile-deletion lane degrades to the default profile instead of
-- dangling.
--
-- PROFILE SCOPING (the R02 core): watch_history, library_entries,
-- user_intents, and recommendation_state each gain a `profile_id` column.
-- The OLD per-user primary/unique keys are REPLACED by unique indexes over
--
--     ( COALESCE(profile_id, 'user:' || user_id), <the old key columns> )
--
-- WHY the COALESCE expression (the transition law):
-- - Legacy rows (profile_id NULL) keep upsert/read semantics under the
--   deterministic pseudo key 'user:<userId>' — the exact bucket the
--   pre-R02 userId-keyed behavior occupied. No data backfill is needed and
--   no duplicate rows can appear during the transition.
-- - On FIRST profile-scoped resolution for a REGISTERED user with no
--   profiles, the runtime materializes the default profile and attributes
--   the legacy rows (UPDATE ... SET profile_id WHERE ... IS NULL — see
--   PostgresProfileService.ensureDefaultProfile). After attribution the
--   rows key under the real profile id.
-- - Two profiles of one user watching/saving the SAME item produce two
--   isolated rows (the acceptance criterion: profile A's data never leaks
--   to profile B) — impossible under the old (user_id, item_id) key.
-- - Post-R02 production write paths ALWAYS resolve an effective profile
--   key first, so profile_id is only NULL for pre-0007 rows (documented
--   law; the expression index is what makes the window safe anyway).
--
-- event_outbox.profile_id: events are attributed to the ACTIVE profile of
-- the session that emitted them AT INGEST (the events endpoint knows the
-- bearer session's active profile; the frozen EntertainmentEvent shape
-- itself carries no profile field and is never edited). NULL = legacy /
-- anonymous ingest; the relay's watch-history fold resolves the user's
-- effective profile at delivery time (default-profile fallback).

CREATE TABLE IF NOT EXISTS profiles (
    id           text PRIMARY KEY,
    user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    display_name text NOT NULL,
    avatar_seed  text NOT NULL,
    is_default   boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS profiles_user_idx ON profiles (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_user_default_key
    ON profiles (user_id) WHERE is_default;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS active_profile_id text
    REFERENCES profiles (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sessions_active_profile_idx
    ON sessions (active_profile_id);

-- watch_history: (user, item) -> (effective profile, item)
ALTER TABLE watch_history ADD COLUMN IF NOT EXISTS profile_id text;

ALTER TABLE watch_history DROP CONSTRAINT IF EXISTS watch_history_pkey;

CREATE UNIQUE INDEX IF NOT EXISTS watch_history_profile_key
    ON watch_history (COALESCE(profile_id, 'user:' || user_id), item_id);

-- library_entries: (user, connector, ref) -> (effective profile, connector, ref)
ALTER TABLE library_entries ADD COLUMN IF NOT EXISTS profile_id text;

ALTER TABLE library_entries DROP CONSTRAINT IF EXISTS library_entries_pkey;

CREATE UNIQUE INDEX IF NOT EXISTS library_entries_profile_key
    ON library_entries (COALESCE(profile_id, 'user:' || user_id), connector_id, external_ref);

-- user_intents: the frozen identity triple (user, scope, objective) gains the profile
ALTER TABLE user_intents ADD COLUMN IF NOT EXISTS profile_id text;

DROP INDEX IF EXISTS user_intents_identity;

CREATE UNIQUE INDEX IF NOT EXISTS user_intents_profile_identity
    ON user_intents (COALESCE(profile_id, 'user:' || user_id), scope, objective);

-- recommendation_state: one row per user -> one row per effective profile
ALTER TABLE recommendation_state ADD COLUMN IF NOT EXISTS profile_id text;

ALTER TABLE recommendation_state DROP CONSTRAINT IF EXISTS recommendation_state_pkey;

CREATE UNIQUE INDEX IF NOT EXISTS recommendation_state_profile_key
    ON recommendation_state (COALESCE(profile_id, 'user:' || user_id));

-- event_outbox: ingest-time profile attribution (NULL = legacy/anonymous)
ALTER TABLE event_outbox ADD COLUMN IF NOT EXISTS profile_id text;

CREATE INDEX IF NOT EXISTS event_outbox_profile_idx ON event_outbox (profile_id);
