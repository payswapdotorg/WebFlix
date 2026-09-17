-- R04 migration 0009 — canonical-keyed library + history removals/exclusions.
--
-- THE CANONICAL-KEY DISCIPLINE (the R04 spec §1):
-- The library becomes CANONICAL-KEYED: ONE row per (effective profile,
-- canonical item id) — NOT per realization. A second save of the same
-- canonical item from a DIFFERENT source is a no-op on the list (already
-- saved); the realization set in `metadata.realizations` GROWS. The frozen
-- `LibraryEntry` wire shape is unchanged (`connectorId` + `externalRef` +
-- `title` + `addedAt` + `metadata?`) — the row keeps its PRIMARY realization
-- reference (the write-through handle the runtime's library read joins through
-- the canonical registry); the realization SET lives in `metadata.realizations`
-- as `[{connectorId, externalRef, addedAt}, ...]`.
--
-- CROSS-SOURCE REALIZATION REPLACEMENT (the R04 spec §1):
-- When a canonical item gains a new realization (a better-quality source, a
-- re-upload), the library row's realization reference updates per the
-- conversion law — a saved item NEVER breaks when a source disappears IF
-- another realization exists; when the LAST realization vanishes, the row
-- stays listed (the save is the user's intent, not a lease on a source's
-- lifetime) and answers honestly `unavailable-for-playback`.
--
-- THE CONVERSION LAW (deterministic, idempotent, no data loss):
-- 1. ADD the `item_id` column (text, NULL for legacy rows whose realization
--    has vanished from source_realizations — these stay listed honestly).
-- 2. POPULATE `item_id` from `source_realizations` joined by
--    (connector_id, external_ref). Every row whose realization still exists
--    gets the canonical item id; rows whose realization vanished stay NULL
--    (the catalog's `requireItemIdForRef` will refuse to invent identities on
--    the next save attempt — these rows are no longer writable, only listed).
-- 3. MERGE duplicate (effective_profile, item_id) rows: the EARLIEST-SAVED
--    row wins (added_at ASC, external_ref ASC tiebreaker); the loser rows'
--    realization references MERGE into the winner's `metadata.realizations`
--    (no data loss: every realization the user ever saved survives); the
--    title from the earliest row wins. The losers are then DELETEd — the
--    winner row survives as the single canonical-keyed row.
-- 4. CREATE the canonical-keyed unique index
--    `library_entries_profile_canonical_key` on (effective_profile,
--    item_id) ALONGSIDE the realization-keyed one (kept). Rows with NULL
--    item_id (realization vanished) are outside the canonical uniqueness
--    domain — they stay listed honestly but cannot be re-saved.
-- 5. KEEP `connector_id` + `external_ref` columns on the row as the PRIMARY
--    realization reference (the write-through handle).
--
-- THE EVENT-SINK LAW (R04 spec §2): the recorded events are the immutable
-- truth; the history read model is their projection. Removal/exclusion NEVER
-- falsifies recorded events. Two NEW tables:
-- - `history_removals`: one row per (effective profile, item_id) the user
--   removed from history (`DELETE /experience/history/:itemId`). The history
--   read model and Continue Watching filter these out; a re-watch (a new
--   watch event arriving through the relay) DELETES the removal row — the
--   item re-materializes in history. The event_outbox is NEVER touched.
-- - `history_exclusions`: one row per (effective profile, item_id) the user
--   excluded from history-derived surfaces (`POST /experience/history/exclusions`).
--   These stay excluded until explicitly removed
--   (`DELETE /experience/history/exclusions/:itemId`). The event_outbox is
--   NEVER touched.
--
-- Forward-only, idempotent (IF NOT EXISTS / IF EXISTS), deterministic (no
-- data seeded, no clock read — applied_at comes from the injected seam).

-- 1. The canonical item id column.
ALTER TABLE library_entries ADD COLUMN IF NOT EXISTS item_id text;

-- 2. Populate from source_realizations (idempotent — only fills NULLs).
UPDATE library_entries l
SET item_id = r.entertainment_item_id
FROM source_realizations r
WHERE l.item_id IS NULL
  AND l.connector_id = r.connector_id
  AND l.external_ref = r.external_ref;

-- 3a. Merge each loser row's realization reference into the WINNER's
--     metadata.realizations (the conversion law's "realizations merge" —
--     no data loss). The winner is the earliest-saved row of its
--     (effective_profile, item_id) partition; every other row of that
--     partition is a loser whose (connector_id, external_ref, added_at)
--     reference is appended (deduped against what the winner already
--     carries; statement-re-play safe). addedAt is rendered in UTC with a
--     fixed format — deterministic, never session-timezone dependent.
UPDATE library_entries AS winner
SET metadata = jsonb_set(
      COALESCE(winner.metadata, '{}'::jsonb),
      '{realizations}',
      COALESCE(
        CASE WHEN jsonb_typeof(winner.metadata -> 'realizations') = 'array'
             THEN winner.metadata -> 'realizations' END,
        '[]'::jsonb
      ) || (
        SELECT COALESCE(
          jsonb_agg(cand ORDER BY cand ->> 'addedAt', cand ->> 'externalRef'),
          '[]'::jsonb
        )
        FROM (
          SELECT jsonb_build_object(
                   'connectorId', winner.connector_id,
                   'externalRef', winner.external_ref,
                   'addedAt', to_char(
                     winner.added_at AT TIME ZONE 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                   )
                 ) AS cand
          UNION ALL
          SELECT jsonb_build_object(
                   'connectorId', loser.connector_id,
                   'externalRef', loser.external_ref,
                   'addedAt', to_char(
                     loser.added_at AT TIME ZONE 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                   )
                 ) AS cand
          FROM library_entries AS loser
          WHERE loser.item_id IS NOT NULL
            AND COALESCE(loser.profile_id, 'user:' || loser.user_id)
                = COALESCE(winner.profile_id, 'user:' || winner.user_id)
            AND loser.item_id = winner.item_id
            AND (loser.added_at, loser.external_ref)
                > (winner.added_at, winner.external_ref)
        ) AS candidates
        WHERE NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(winner.metadata -> 'realizations') = 'array'
                 THEN winner.metadata -> 'realizations' ELSE '[]'::jsonb END
          ) AS prior
          WHERE prior ->> 'connectorId' = candidates.cand ->> 'connectorId'
            AND prior ->> 'externalRef' = candidates.cand ->> 'externalRef'
        )
      )
    )
WHERE winner.item_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM library_entries AS dup
    WHERE dup.item_id IS NOT NULL
      AND COALESCE(dup.profile_id, 'user:' || dup.user_id)
          = COALESCE(winner.profile_id, 'user:' || winner.user_id)
      AND dup.item_id = winner.item_id
      AND (dup.added_at, dup.external_ref)
          > (winner.added_at, winner.external_ref)
  );

-- 3b. DELETE the losers — the winner row (earliest added_at, external_ref
--     tiebreak) survives as the partition's single canonical-keyed row.
--     (Idempotent: a no-op once duplicates are gone; 3a already collected
--     every loser's realization reference into the winner.)
DELETE FROM library_entries
WHERE ctid IN (
  SELECT loser.ctid
  FROM (
    SELECT
      ctid,
      COALESCE(profile_id, 'user:' || user_id) AS pkey,
      item_id,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(profile_id, 'user:' || user_id), item_id
        ORDER BY added_at, external_ref
      ) AS rn
    FROM library_entries
    WHERE item_id IS NOT NULL
  ) loser
  WHERE loser.rn > 1
);

-- 4. Add the canonical-keyed unique index ALONGSIDE the realization-keyed
--    one (kept). Two coexisting unique indexes:
--    - `library_entries_profile_key` (existing, from 0007) on
--      (effective_profile, connector_id, external_ref) — enforces ONE row
--      per realization (the pre-R04 law; preserved for the realization-
--      keyed fallback when a save's realization has no catalog row, i.e.
--      item_id is NULL — the legacy "listed honestly even when the
--      realization vanished" path).
--    - `library_entries_profile_canonical_key` (new) on
--      (effective_profile, item_id) — enforces ONE row per canonical item
--      (the R04 law). Postgres treats NULLs as DISTINCT in unique indexes,
--      so rows with NULL item_id (realization vanished) are NOT unique-
--      keyed against each other under this index — the realization-keyed
--      index above still catches them.
CREATE UNIQUE INDEX IF NOT EXISTS library_entries_profile_canonical_key
    ON library_entries (COALESCE(profile_id, 'user:' || user_id), item_id);

CREATE INDEX IF NOT EXISTS library_entries_profile_recent_idx
    ON library_entries (COALESCE(profile_id, 'user:' || user_id), added_at DESC);

-- 5. History removals + exclusions (the event-sink law — projections only).
CREATE TABLE IF NOT EXISTS history_removals (
    profile_id  text,
    user_id     text NOT NULL,
    item_id     text NOT NULL,
    removed_at  timestamptz NOT NULL,
    CHECK (item_id LIKE 'wfxitm_%')
);

CREATE UNIQUE INDEX IF NOT EXISTS history_removals_profile_key
    ON history_removals (COALESCE(profile_id, 'user:' || user_id), item_id);

CREATE TABLE IF NOT EXISTS history_exclusions (
    profile_id   text,
    user_id      text NOT NULL,
    item_id      text NOT NULL,
    excluded_at  timestamptz NOT NULL,
    CHECK (item_id LIKE 'wfxitm_%')
);

CREATE UNIQUE INDEX IF NOT EXISTS history_exclusions_profile_key
    ON history_exclusions (COALESCE(profile_id, 'user:' || user_id), item_id);
