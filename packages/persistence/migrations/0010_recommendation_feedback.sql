-- R05 migration 0010 — recommendation feedback controls (per profile).
--
-- recommendation_feedback: the durable side of the J15 control vocabulary
-- (more-like-this | not-interested | dont-recommend-source |
-- dont-recommend-creator | already-watched). Every control is PER-PROFILE,
-- TIMESTAMPED, and REVERSIBLE: identity is (effective profile, kind, target)
-- — UNIQUE — so re-submitting the same control is idempotent (the earliest
-- created_at wins; the control is one row, not a log). DELETE is a REAL
-- delete (no soft-delete theater — the R05 reversibility law): the row and
-- its composition effect vanish together.
--
-- THE EVENT-SINK LAW (R04, preserved): nothing here touches `event_outbox`
-- or `watch_history` — feedback is a PROJECTION-SIDE control over future
-- candidate composition, never a falsification of recorded viewing events.
--
-- The kind vocabulary is enforced BOTH here (CHECK — the database is the
-- last line of defense) and at the API boundary (the typed 400 channel).
-- `target` is polymorphic BY KIND: a canonical item id (wfxitm_…) for the
-- item-targeted kinds, a connector id for dont-recommend-source, a creator
-- id for dont-recommend-creator — the application layer validates per kind.

CREATE TABLE IF NOT EXISTS recommendation_feedback (
    id         text PRIMARY KEY,
    user_id    text NOT NULL,
    profile_id text,
    kind       text NOT NULL CHECK (kind IN ('more-like-this','not-interested','dont-recommend-source','dont-recommend-creator','already-watched')),
    target     text NOT NULL,
    note       text,
    created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS recommendation_feedback_profile_identity
    ON recommendation_feedback (COALESCE(profile_id, 'user:' || user_id), kind, target);

CREATE INDEX IF NOT EXISTS recommendation_feedback_profile_idx
    ON recommendation_feedback (COALESCE(profile_id, 'user:' || user_id));
