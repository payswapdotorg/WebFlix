-- R26-W4 migration 0014 — the media-intelligence derived-artifact store
-- + the source-realization metadata column (the artwork projection's
--   carrier).
--
-- media_intelligence_artifacts: ONE row per canonical item — the R23-F
-- derived artifact set (jsonb, validated by the writer against the frozen
-- @wfx/model-fabric shapes BEFORE it lands here; the DB stores, the
-- pipeline validates — drift is rejected upstream, never coerced), the
-- R23-G legal-audio truth, the honest derivation lifecycle (derived |
-- derivation-failed + the one-sentence truth), the per-stage outcome
-- record (the prerequisite truth the route's honest answers derive from),
-- and the derivation timestamps.
--
-- source_realizations.metadata: the connector's per-realization metadata
-- projection (jsonb, default '{}'). The webflix-catalog connector's
-- artwork projection writes the well-known `thumbnailUrl` key here (the
-- provider's own artwork address — see apps/api/src/host/seed.ts, the
-- connector's projection layer in this deployment). SCHEMA ONLY in this
-- migration: the DATA convergence is app-owned (the 052 decision record —
-- app-owned data must not leak into the package-level baseline; the
-- seed's boot convergence step backfills every environment idempotently).
--
-- No data is seeded and no clock is read by the SQL itself (the runner's
-- determinism law); statements are plain DDL, `;` at line-ends.

ALTER TABLE source_realizations
    ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS media_intelligence_artifacts (
    item_id                       text PRIMARY KEY
                                  REFERENCES entertainment_items (id) ON DELETE CASCADE,
    artifacts                     jsonb NOT NULL,
    audio_stream_legally_available boolean NOT NULL DEFAULT false,
    derivation_status             text NOT NULL
                                  CHECK (derivation_status IN ('derived', 'derivation-failed')),
    derivation_detail             text NOT NULL DEFAULT '',
    stage_outcomes                jsonb NOT NULL DEFAULT '[]'::jsonb,
    derived_at                    timestamptz NOT NULL,
    updated_at                    timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS media_intelligence_derived_idx
    ON media_intelligence_artifacts (derivation_status);
