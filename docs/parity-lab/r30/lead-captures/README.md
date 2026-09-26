# R30 lead-captures — the operator's logged-in YouTube window (corpus-pending family)

Lead-owned corpus captures for the R30-B family: the bell (N2/D4), the account
menu + logged-in surfaces, the subscriptions rail avatars (N13/D6), watched-progress
(N19[P]), the playlists family (History/Watch later/Liked), the subscriptions feed
row grammar, and the shorts action rail re-check (N27). Captured from the operator's
live logged-in youtube.com tab in the replay browser (1440x900, CDP :9222).

## The window (binding context)

- The operator logged into YouTube through the replay at ~09:2x-09:34Z (2026-09-25).
  The poller's 09:34:03Z round first read the healthy state: title "(167) YouTube",
  `signin=false avatar=true` — the flag `yt-loggedin` written, window declared OPEN.
- The lead ran the capture ladder immediately (the r30-cycle-4 directive:
  gate-vulnerable surfaces first). Run 1 (09:38:58-09:40:56Z): all 12 surface
  screenshots + the masthead DOM truth landed healthy.
- **The gate came down mid-capture** (the R28 risk-engine signature, faster this
  time): at 09:45-09:46 the rail still measured (avatars live), the bell button was
  already null at 09:46:25, the title count degraded 167 -> "(1)" -> stripped by
  ~09:48, and by 09:48:30 the masthead end cluster rendered empty (logged-out shell).
- Run 2/3 (09:44:50-09:47:35Z) captured what it could during the decline.
- Per the standing directive (lead, 2026-09-23): no login retries, no fighting the
  gate. What landed = the corpus; the gaps are recorded below, honestly.

## Provenance map

- `raw-run1/` — the PRISTINE healthy-window set (09:38-09:40Z). The bell panel and
  the account menu are OPEN in shots 02/03. The masthead truth (01) is the measured
  healthy grammar.
- `raw/` — the consolidated final set: run-1 truths where they stand (01, 09),
  run-2 truths (05-08, 10, modern-DOM selectors), run-3 menu re-captures (03 = a
  SECOND open-menu shot during the decline, `03-account-menu-healthy.jpg` = the
  run-1 original), plus the gate-closed evidence (`02-bell-panel-gateclosed.jpg`).
- `vlm/` — the VLM reads (one JSON per surface; the visual anatomy extraction).
- `CORPUS.md` — **the binding corpus sheet** (the measured grammar per surface).
  Workers cite THIS file plus the raw evidence.

## Honest gaps (corpus-pending remains)

- **The Appearance/theme-picker submenu rows** (Account default / Use device theme /
  Dark / Light) were NEVER captured open — the row click did not register in either
  run. What IS captured: the account-menu row reads "Appearance: Device theme"
  (the account's current theme state, double-confirmed in two screenshots). The
  picker rows stay corpus-pending; do NOT build them from memory.
- **Home watched-progress (N19[P])**: no resume bar rendered on any home card in
  this window (measured + VLM agree). The watched-progress grammar WAS observed in
  the history rows and the Liked-videos rows (red bar in the thumb area) — cite
  those; the home-surface resume bar stays pending.
- **The healthy subscriptions feed grid**: the subs feed rendered only its degraded
  live-only state (3 cards, LIVE badges, "Latest" header). The full VOD row grammar
  stays pending.
- **Shorts (N27)**: the gate is STILL ACTIVE logged-in — the player shell + Play
  CTA render; NO action rail, NO channel, NO title. This CONFIRMS the R28
  shorts-anatomy sheet's risk-engine record. N27's interactive rail stays pending.

## What this means for R30-B

The captured grammar (bell geometry + badge + panel, the full account menu, the
rail taxonomy with measured avatars, history controls, playlists family headers +
rows, the account identity cluster) is now BINDING for the account-chrome work.
The four gaps above stay CORPUS-PENDING with this README as the citation — the
same law as R28: never build from memory, never fabricate.
