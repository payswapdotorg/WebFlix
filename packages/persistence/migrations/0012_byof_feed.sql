-- R20-A migration 0012 — Bring Your Own Feed: feed imports, preview
-- staging, and the idempotent feed records.
--
-- Three tables, three laws (docs/architecture/byof-architecture.md):
--
-- - `feed_imports` — one import TRANSACTION (the frozen `FeedImport`
--   entity): preview → confirmed → running → complete | failed |
--   reauthorization-required. `sync_state` is the import-level freshness
--   truth (live/snapshot/stale/...); `last_synced_at` records the last
--   SUCCESSFUL capture. An import NEVER deletes on failure — the survival
--   law lives in the state machine, not in the rows.
--
-- - `feed_preview_items` — the staged capture BETWEEN previewImport and
--   confirmImport. The user confirms WHAT THEY SAW: confirm promotes the
--   staged rows; it never re-fetches. Staged rows are keyed by (import_id,
--   import_key) so even staging is duplicate-proof.
--
-- - `feed_records` — the imported feed relationships with FULL provenance
--   (frozen `FeedRecord` + the store columns the frozen shape references
--   opaquely: external_ref, title, metadata). THE IDEMPOTENT IMPORT LAW is
--   structural: `import_key` (the deterministic domain key over (profile,
--   connector, relationship, container, external item)) carries a UNIQUE
--   constraint per profile — a re-import UPSERTS the same row, never a
--   duplicate. `source_order` is the SOURCE-NATIVE order (data with
--   provenance — never a WebFlix rank); `captured_at` is the capture
--   timestamp; `sync_state` rides per record so a stale/reauth transition
--   is visible per relationship.
--
--   SEPARATION LAW (structural): feed_records never FK to library_entries /
--   watch_history / user_intents / recommendation_* — WebFlix-local
--   actions live in their own tables and reconciliation writes ONLY this
--   table family. A source disconnection (or any sync failure) marks
--   sync_state and KEEPS the rows; only an explicit user deletion removes
--   them.
--
-- No credentials ever land here: the provenance columns are identity +
-- ordering + freshness truth only (the model-input privacy law).

CREATE TABLE IF NOT EXISTS feed_imports (
    id              text PRIMARY KEY,
    user_id         text NOT NULL,
    profile_id      text NOT NULL,
    connector_id    text NOT NULL,
    method          text NOT NULL CHECK (method IN ('api', 'official-export', 'user-file', 'snapshot')),
    status          text NOT NULL CHECK (status IN ('preview', 'confirmed', 'running', 'complete', 'failed', 'reauthorization-required')),
    sync_state      text NOT NULL CHECK (sync_state IN ('live', 'syncing', 'snapshot', 'stale', 'reauthorization-required', 'unsupported', 'degraded')),
    continuous_sync boolean NOT NULL DEFAULT false,
    source_ref      text,
    item_count      integer NOT NULL DEFAULT 0,
    started_at      timestamptz NOT NULL,
    completed_at    timestamptz,
    last_synced_at  timestamptz,
    error           text
);

CREATE INDEX IF NOT EXISTS feed_imports_profile_idx
    ON feed_imports (profile_id, started_at DESC);

CREATE INDEX IF NOT EXISTS feed_imports_connector_idx
    ON feed_imports (profile_id, connector_id, status);

CREATE TABLE IF NOT EXISTS feed_preview_items (
    import_id     text NOT NULL REFERENCES feed_imports (id) ON DELETE CASCADE,
    import_key    text NOT NULL,
    position      integer NOT NULL,
    external_ref  text NOT NULL,
    relationship  text NOT NULL CHECK (relationship IN ('follow', 'subscription', 'playlist', 'watchlist', 'like', 'save', 'ranked-feed', 'history', 'unknown')),
    source_ref    text,
    source_order  integer NOT NULL,
    captured_at   timestamptz NOT NULL,
    source_updated_at timestamptz,
    title         text,
    metadata      jsonb,
    canonical_item_id text NOT NULL,
    -- The record id confirm will use (minted at staging; stable identity
    -- when no prior record exists — a re-import upsert keeps the EXISTING
    -- record's id, the import-key law).
    record_id     text NOT NULL,
    PRIMARY KEY (import_id, import_key)
);

CREATE INDEX IF NOT EXISTS feed_preview_items_import_idx
    ON feed_preview_items (import_id, position);

CREATE TABLE IF NOT EXISTS feed_records (
    id                    text PRIMARY KEY,
    user_id               text NOT NULL,
    profile_id            text NOT NULL,
    import_id             text NOT NULL REFERENCES feed_imports (id),
    import_key            text NOT NULL,
    connector_id          text NOT NULL,
    import_method         text NOT NULL CHECK (import_method IN ('api', 'official-export', 'user-file', 'snapshot')),
    relationship          text NOT NULL CHECK (relationship IN ('follow', 'subscription', 'playlist', 'watchlist', 'like', 'save', 'ranked-feed', 'history', 'unknown')),
    source_ref            text,
    external_ref          text NOT NULL,
    source_order          integer NOT NULL,
    captured_at           timestamptz NOT NULL,
    sync_state            text NOT NULL CHECK (sync_state IN ('live', 'syncing', 'snapshot', 'stale', 'reauthorization-required', 'unsupported', 'degraded')),
    imported_at           timestamptz NOT NULL,
    source_updated_at     timestamptz,
    title                 text,
    metadata              jsonb,
    entertainment_item_id text NOT NULL,
    -- THE IDEMPOTENT IMPORT LAW: one relationship per profile per key.
    UNIQUE (profile_id, import_key)
);

CREATE INDEX IF NOT EXISTS feed_records_profile_recent_idx
    ON feed_records (profile_id, imported_at DESC);

CREATE INDEX IF NOT EXISTS feed_records_relationship_idx
    ON feed_records (profile_id, relationship, source_order);

CREATE INDEX IF NOT EXISTS feed_records_import_idx
    ON feed_records (import_id);

CREATE INDEX IF NOT EXISTS feed_records_canonical_idx
    ON feed_records (entertainment_item_id);
