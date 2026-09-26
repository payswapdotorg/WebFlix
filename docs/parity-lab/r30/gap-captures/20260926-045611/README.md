# Gap-capture attempt 20260926-045611 — HONEST NEGATIVE (logged-out window)

The trigger: tab title `"(15) YouTube"` (the notification-count pattern = the
historical logged-in signal) at 04:47-04:56Z. The four-gap ladder fired at
04:56:11Z (25s after detection — the responder doctrine worked).

The finding: **the window was LOGGED OUT** (VLM read of g1-0-home-baseline:
generic placeholder masthead buttons, no avatar, no bell). The title count was
a stale false-positive. Results, all consistent with logged-out + gate states:
- g1-theme-picker: no avatar -> no menu -> no picker (rows scan found only the
  guide rail: Home/Shorts/Subscriptions/You + promos)
- g2-subs-feed: 0 cards, "An error occurred while retrieving sharing
  information" banners (the degraded state)
- g3-home-progress: feed renders (6 cards) but withProgress=0 (no account ->
  no resume bars)
- g4-shorts: shell + Play CTA only (the logged-out/gate shorts state)

THE LESSON (now in the responder design + AGENT_BOOT_PROMPT lesson-167 (renumbered — the shared console has a parallel lineage)): a
notification-count title is a HINT, never a FIRE signal. The unattended
responder fires only on the STRONG signal (a successful eval: #avatar-btn
present AND no sign-in link). A stalled eval = UNKNOWN (retry), never
logged-out. No gap corpus was captured; the four gaps stay CORPUS-PENDING.
The capture itself was harmless (read-only + failed clicks on logged-out UI).
