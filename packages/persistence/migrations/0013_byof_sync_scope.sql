-- R20-C migration 0013 — the sync scope discipline: persist the import
-- request's relationship filter on the import transaction.
--
-- WHY (docs/architecture/byof-architecture.md "Sync model" + the R20
-- truth laws): an incremental sync re-reads the route and reconciles it
-- against the persisted records. The reconcile scope MUST equal the
-- capture's coverage: a sync of a likes-only import may never remove
-- follow records that a different import owns — removal happens ONLY for
-- relationships inside the scope the original request addressed.
--
-- `relationships` is the request's filter as a jsonb array of the frozen
-- FeedRelationship union members, or NULL when the capture requested the
-- route's full set (the scope is then the connector's whole importable
-- relationship set for that profile). Together with the existing
-- `source_ref` (the container pin) and `method` columns, the import row
-- carries the complete request fingerprint a sync reproduces.
--
-- Add-only (no existing column changes; NULL = the pre-0013 "full set"
-- reading, which is exactly what an unfiltered capture meant).

ALTER TABLE feed_imports
    ADD COLUMN IF NOT EXISTS relationships jsonb;

-- The relationship vocabulary is the same frozen union every feed table
-- already CHECKs — enforced at the application seam (the domain
-- validators); a jsonb CHECK would duplicate the frozen union into SQL a
-- THIRD time in this migration family, so the CHECK stays at the
-- feed_preview_items/feed_records boundary where it already lives.
