-- R05 migration 0010 — recommendation feedback (the J15 control set).
--
-- THE REVERSIBILITY LAW (R05 spec §1): every control that shapes
-- recommendations can be UNDONE. Feedback records are per-profile,
-- timestamped rows keyed by (effective profile, kind, target type, target id)
-- — ONE row per control per target (a re-submission updates the row in
-- place: the canonical id stays, created_at/note refresh). DELETE is gone:
-- `DELETE /experience/feedback/:id` removes the row outright (no soft-delete
-- theater — the recommendation OS sees the row or it does not).
--
-- THE EVENT-SINK LAW (R04 precedent, preserved): feedback NEVER touches
-- `event_outbox` or the `watch_history` projection. `already-watched` is a
-- RECOMMENDATION control (deprioritize repeats), not a history edit — the
-- recorded viewing events are the immutable truth and stay untouched.
--
-- Kinds (the J15 control vocabulary, frozen by the R05 spec):
--   more-like-this        (target item)    — boost similarity neighborhoods
--   not-interested        (target item)    — demote the item to the feed tail
--   dont-recommend-source  (target source) — skip the source's realizations
--   dont-recommend-creator (target creator) — skip the creator's candidates
--   already-watched       (target item)    — deprioritize repeats
--
-- Target types are columns, not jsonb, so the uniqueness domain is
-- structural: (COALESCE(profile_id, 'user:' || user_id), kind, target_type,
-- target_id) — the migration-0007 effective-profile key expression, the
-- same scoping law user_intents / library_entries / history_removals use.
--
-- Forward-only, idempotent (IF NOT EXISTS), deterministic (no data seeded,
-- no clock read — created_at comes from the injected seam).

CREATE TABLE IF NOT EXISTS recommendation_feedback (
    id          text PRIMARY KEY,
    user_id     text NOT NULL,
    profile_id  text,
    kind        text NOT NULL CHECK (kind IN ('more-like-this','not-interested','dont-recommend-source','dont-recommend-creator','already-watched')),
    target_type text NOT NULL CHECK (target_type IN ('item','source','creator')),
    target_id   text NOT NULL,
    note        text,
    created_at  timestamptz NOT NULL,
    CHECK (
      (kind IN ('more-like-this','not-interested','already-watched') AND target_type = 'item')
      OR (kind = 'dont-recommend-source' AND target_type = 'source')
      OR (kind = 'dont-recommend-creator' AND target_type = 'creator')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS recommendation_feedback_profile_key
    ON recommendation_feedback (COALESCE(profile_id, 'user:' || user_id), kind, target_type, target_id);

CREATE INDEX IF NOT EXISTS recommendation_feedback_profile_recent_idx
    ON recommendation_feedback (COALESCE(profile_id, 'user:' || user_id), created_at DESC);
