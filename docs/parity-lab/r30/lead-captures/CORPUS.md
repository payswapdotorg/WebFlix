# R30 corpus — the logged-in surfaces (measured grammar)

The binding sheet for the R30-B family. Every line is either **[measured]** (DOM
truth, raw/*.json), **[rendered]** (VLM-read from raw/*.jpg, `vlm/*.json`), or
**[pending]** (uncaptured — cite README gaps). Captured 2026-09-25 09:38-09:48Z,
the operator's logged-in window, 1440x900.

## 1. Masthead account cluster [measured, run-1 09:38]

- **Bell button**: 40x40 at (1306,8); icon-button shell (`style-scope yt-icon-button`);
  unread badge text **"9+"** (the badge caps at 9+ while the title count read 167).
- **Notifications title count**: document title "(167) YouTube" — the count lives
  in the title, 167 at window-open, degraded to "(1)" then stripped at gate-close.
- **Avatar button**: 54x34 button rect at (1354,11) (the rendered avatar image is a
  squircle/rounded shape, not a circle) [rendered].
- **Mic button**: 40x40, radius 50%, at (1010,8) — INSIDE the search bar's right
  edge, left of the search icon [measured + rendered]. (The logged-in corpus HAS
  a mic; the logged-out masthead census had none — D3/N1 divergence note.)
- **End cluster**: 225x40 at (1183,8); order from search rightward: mic (in-bar),
  Create ("+" + "Create" text), Bell ("9+"), Avatar [rendered].

## 2. Notifications bell panel [rendered, run-1 02-bell-panel.jpg]

- **Panel**: anchored top-right under the bell; ~360-400px wide (~25-30% viewport),
  y~60 to ~720 (~80% viewport height).
- **Header**: bold "Notifications" + a settings gear icon + a collapse/close arrow.
- **Row anatomy** (per notification): a blue vertical unread dot (far left) · a
  square ~40-50px thumbnail/avatar · a content block (bold source-name + action,
  e.g. "uploaded:", then regular-weight title, then grey timestamp e.g. "28
  minutes ago") · a kebab (three-dot) menu icon far right.
- Unread state = the blue dot + bold source line [rendered].

## 3. Account menu (avatar dropdown) [rendered, DOUBLE-CONFIRMED: run-1 + run-3 shots]

- **Header**: channel avatar (top-left), bold account name, handle, a
  "View your channel" blue link under the handle.
  Observed identity: name "Spartacus", handle "@spartacus_payswap".
- **Rows in exact order** (14):
  1. Google Account
  2. Switch account (right arrow)
  3. Sign out
  — divider —
  4. YouTube Studio
  5. Purchases and memberships
  6. Your data in YouTube
  7. **Appearance: Device theme** (right arrow; the current theme state is
     embedded in the row label — the account runs "Device theme")
  8. Display language: English (right arrow)
  9. Restricted Mode: Off (right arrow)
  10. Location: Hong Kong (right arrow)
  11. Keyboard shortcuts
  — divider —
  12. Settings
  13. Help
  14. Send feedback
- **Geometry**: top-right anchored, ~15-20% viewport width, tall (to ~70-80% height).
- **Theme-picker submenu rows: [pending]** — never captured open (README gap).

## 4. Subscriptions rail (guide) [measured, run-2 09:45 + rendered]

- **Entry geometry**: 204x40 per guide entry.
- **Channel avatars in the rail: 24x24 rendered** (natural 88x88) — the R28
  corpus-pending avatar measure, now measured.
- **Section taxonomy (exact order)**:
  - [Home, Shorts]
  - [Subscriptions: Les Vidéos de Riles · Marques Brownlee · LastWeekTonight ·
    +7 more channels (flat list, avatars left)]
  - [You: Your channel · History · Playlists · …]
  - [More from YouTube: YouTube Premium · YouTube Music · YouTube Kids]
  - [Explore: Music · Movies · Live · …] (+ "Show more")
  - [Report history] (footer section)

## 5. Home feed (logged-in) [measured + rendered]

- Cards render (run-2 measured 3-6 cards in view; thumbnails present). NO
  watched-progress bar rendered on any home card this window [measured + rendered
  agree] — the home resume-bar stays [pending]; the progress-bar grammar itself was
  observed in history/Liked rows (§6, §8).

## 6. Watch history page [measured + rendered]

- **Right control rail (exact order)**: "Search watch history" (underlined input
  field) · "Clear all watch history" · "Pause watch history" · "Manage all history"
  · "Comments" · "Posts" · "Live chat" (text links).
- **Type chips**: All (selected) · Videos · Shorts · Podcasts · Music.
- **Row anatomy**: thumbnail left (duration badge, e.g. "1:01:13"), title, channel
  + view count line. **The watched-progress red bar renders in the row thumbnail
  area** [rendered] — the N19[P] observed instance.
- 7 row titles measured (the operator's real history: "Alexandr Wang: Building
  Scale AI, Transforming…", "From Idea to $650M Exit…", "30-Minute Masterclass on
  Product Thinking", …).

## 7. Playlists grid [rendered, run-1 09:39 + measured 4-card DOM]

- **Card anatomy**: title · "N videos" count · privacy ("Private"/"Public") ·
  "Playlist" · "View full playlist" link. Single-image thumbnail treatment.
- Observed cards: Watch later (99 videos, Private) · Saved Shorts (1 video,
  Private) · Liked videos (71 videos, Private) · My house (6, Private) · hits (4,
  Public) · Udacity (3, Public) · CS294-112 Fa18 (25 videos, "EECS Archival Course
  Capture 1 · Course · View full course") · MIT 18.065 (36 lessons, "MIT
  OpenCourseWare · Course · View full course").
- Course playlists carry the provider name + "Course" + "View full course" instead
  of "Playlist" + "View full playlist".

## 8. Watch later playlist page [measured + rendered]

- **Header panel**: bold "Watch later" · owner name · "99 videos" · "No views" ·
  "Last updated on Sep 16, 2026" · two pill buttons: "Play all" (white) +
  "Shuffle" (dark).
- **Rows**: index number 1-10 [measured] · thumbnail · bold title · grey meta
  (channel · views · age). 10 rows measured (real titles: "Shay - Thibaut
  Courtois", "Super Mario Odyssey - Nintendo Switch Presentation 2017 Trailer",
  "Tekno - Pana (Official Music Video)", …).

## 9. Liked videos playlist page [rendered, run-1]

- **Header**: "Liked videos" · owner · "71 videos" · "No views" · "Last updated on
  Sep 13, 2026" · "Play all" + "Shuffle" pills.
- **Grey banner**: "6 unavailable videos are hidden" (the honest hidden-entries
  notice — a real surface behavior).
- **Sort chips**: All (selected) · Videos · Shorts.
- **Row anatomy**: watched-progress bar + timestamp badge · bold title · channel ·
  views + age. 4 rows read (real titles quoted in vlm/liked.json).

## 10. Subscriptions feed [rendered, degraded state — honest]

- The feed rendered its DEGRADED live-only state this window: a "Latest" header
  and 3 cards (circular avatar + red "LIVE" badge, bold truncated title, grey
  channel, "1.5K watching" live meta, duration badges on non-live). The healthy
  full VOD grid stays [pending].

## 11. Shorts (N27 re-check) [measured + rendered]

- The gate is STILL ACTIVE logged-in: the vertical player shell + a "Play" CTA
  render; NO action rail, NO like/dislike/comments/share buttons, NO counts, NO
  channel/subscribe, NO title. Confirms the R28 shorts-anatomy risk-engine record.
  The interactive action rail stays [pending].

## Cross-cutting truths

- The bell badge caps at "9+" while the true count (167) surfaces only in the
  document title — two different grammar layers for the same datum.
- The account-menu rows embed their CURRENT STATE in the label ("Appearance:
  Device theme", "Display language: English", "Restricted Mode: Off", "Location:
  Hong Kong").
- The masthead mic exists in the logged-in corpus (40x40, r50, in-bar) — the
  logged-out census had none.
