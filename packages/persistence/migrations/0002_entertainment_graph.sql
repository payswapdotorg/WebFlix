-- WFX-052 migration 0002 — the Entertainment Graph tables (canonical
-- content identity + source realizations).
--
-- entertainment_items: one row per canonical `wfxitm_` identity. Mirrors the
-- frozen `EntertainmentItem` contract (canonicalType | canonicalTitle |
-- durationMs | orientation) plus the graph's bookkeeping fields
-- (creators/topics reference lists as jsonb — registry tables are not part
-- of WFX-052's scope; the reference lists round-trip verbatim) and the
-- deterministic createdAt/updatedAt pair the in-memory graph maintains.
-- CHECK constraints encode the frozen unions so bad data cannot land even
-- from a rogue client.
--
-- source_realizations: "one content identity, many realizations" — each row
-- is a frozen `SourceRealization` (id `wfxsrc_`, capabilities jsonb,
-- availability) attached to exactly ONE canonical item, plus `playback`
-- (jsonb array of frozen `PlaybackRealization`) — the realization's concrete
-- playback answers. Identity is (connector_id, external_ref): UNIQUE, so one
-- source ref maps to exactly one canonical item (the graph merge law, made
-- structural). Re-reporting a pair UPDATES the row and keeps the ORIGINAL id
-- (stable canonical identity — the app-layer upsert never rewrites it).

CREATE TABLE IF NOT EXISTS entertainment_items (
    id              text PRIMARY KEY,
    canonical_type  text NOT NULL CHECK (canonical_type IN ('movie','series','episode','video','short','post','audio')),
    canonical_title text,
    duration_ms     bigint,
    orientation     text CHECK (orientation IN ('horizontal','vertical','square','unknown')),
    creators        jsonb NOT NULL DEFAULT '[]'::jsonb,
    topics          jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL
);

-- Title search is a lowercase substring match (the in-memory graph's search
-- law). At the current catalog scale a plain index on lower(title) serves
-- prefix-shaped probes; a trigram index (pg_trgm) is a documented later
-- upgrade if search becomes hot — NOT silently assumed now.
CREATE INDEX IF NOT EXISTS entertainment_items_title_idx
    ON entertainment_items (lower(canonical_title));

CREATE TABLE IF NOT EXISTS source_realizations (
    id                    text PRIMARY KEY,
    entertainment_item_id text NOT NULL REFERENCES entertainment_items (id) ON DELETE CASCADE,
    connector_id          text NOT NULL,
    external_ref          text NOT NULL,
    capabilities          jsonb NOT NULL,
    availability          text NOT NULL CHECK (availability IN ('available','unknown','unavailable')),
    playback              jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at            timestamptz NOT NULL,
    updated_at            timestamptz NOT NULL
);

-- Realization identity: ONE row per (connector_id, external_ref) globally.
CREATE UNIQUE INDEX IF NOT EXISTS source_realizations_source_key
    ON source_realizations (connector_id, external_ref);

CREATE INDEX IF NOT EXISTS source_realizations_item_idx
    ON source_realizations (entertainment_item_id);
