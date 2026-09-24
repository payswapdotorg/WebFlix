# R28 lead-captures — the operator's logged-in YouTube tab (partial; honestly gated)

Lead-owned raw captures from the operator's live logged-in youtube.com tab
(replay browser, 1440x900), taken 2026-09-23 ~23:0x-23:2xZ.

## What happened
- The operator logged in at ~22:05Z (2FA completed). The tab was FULLY
  logged in for ~1h: avatar cluster present, title "(94) YouTube" (94
  notifications), feed cards rendering.
- At ~23:15Z the account-bound surfaces began returning empty (avatar
  cluster, feed contents, notifications count all stopped rendering) —
  YouTube's risk engine gating this automated/datacenter context. This is
  the SAME gate Worker A documented in its sandbox ("Sign-in-to-confirm
  wall, streamingData stripped"). The session cookies remain; the server
  declines account-bound data.
- Captures below are the honest record: what rendered before/during the
  gate. The logged-in corpus beyond these = CORPUS-PENDING (an honest
  gap, not a silent skip).

## Files
- 00-home-loggedin.json / .jpg — home, logged-in rail visible (post-gate:
  avatar cluster absent, feed thin; the rail's subscription list still
  renders — see 03)
- 02-subs-feed.jpg — /feed/subscriptions post-gate: the grid container
  renders but rows empty (the gate's signature)
- 03-rail-grammar.json / .jpg — the rail DOM late in degradation; the
  STILL-VALID lead observation from the healthy window (recorded here
  verbatim): the rail's subscriptions section read
  "Les Vidéos de Riles | Marques Brownlee | Hasan Minhaj | LastWeekTonight |
  Jimmy Kimmel Live | Bloomberg Originals | Mastar | Show more" — i.e. the
  logged-in rail carries a flat channel list under a "Subscriptions"
  section heading (no avatars measured before degradation — CORPUS-PENDING).

## What this means for the corpus (Worker A)
- The LOGGED-OUT corpus remains the priority: ALL SEVEN operator complaints
  are logged-out observable (hover preview, click-to-play, fonts, colors,
  comments view, share dialog, theme default). Keep going.
- The logged-in sheets (11: logged-in-surfaces) should be marked
  CORPUS-PENDING with this README as the citation. Do NOT fabricate them.
- The initial healthy-window observations (avatar present, 94 notifications,
  the subscriptions rail list) are recorded here for the account-chrome
  grammar: the masthead carries the avatar button rightmost; the
  notifications count appears in the document title.
