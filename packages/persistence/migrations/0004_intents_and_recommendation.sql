-- WFX-052 migration 0004 — intent graph + recommendation state.
--
-- user_intents: the durable side of the frozen `UserIntent` +
-- `IntentRecord` (WFX-011 bookkeeping columns). Identity is the frozen
-- triple (userId, scope, objective) — UNIQUE — so the create-or-reinforce
-- law is structural. Weight/confidence decay and snapshot liveness remain
-- DOMAIN logic (@wfx/domain IntentGraph); this table stores and round-trips
-- records verbatim, it never recomputes them.
--
-- recommendation_state: one row per user holding the frozen
-- `RecommendationPolicy` (jsonb) plus an opaque engine-state blob (jsonb).
-- The policy is user-controlled by frozen invariant 6; the state blob is
-- owned by the recommendation engine and treated as opaque JSON here.

CREATE TABLE IF NOT EXISTS user_intents (
    id                 text PRIMARY KEY,
    user_id            text NOT NULL,
    scope              text NOT NULL CHECK (scope IN ('persistent','temporary','session','momentary','social')),
    objective          text NOT NULL,
    weight             double precision NOT NULL,
    confidence         double precision NOT NULL,
    provenance         text NOT NULL CHECK (provenance IN ('explicit','inferred','imported')),
    expires_at         timestamptz,
    created_at         timestamptz NOT NULL,
    updated_at         timestamptz NOT NULL,
    last_reinforced_at timestamptz NOT NULL,
    evidence_count     integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS user_intents_identity
    ON user_intents (user_id, scope, objective);

CREATE INDEX IF NOT EXISTS user_intents_user_idx ON user_intents (user_id);

CREATE TABLE IF NOT EXISTS recommendation_state (
    user_id    text PRIMARY KEY,
    policy     jsonb NOT NULL,
    state      jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL
);
