# R28 corpus sheet — HOME ANATOMY (R27 corpus + VLM re-analysis; A's lane ABSENT → CORPUS-PENDING)

Sources: `reference/screenshots/yt-home-1440.png` + `yt-home-feed-1440.png` (VLM
re-analysis 2026-09-24), `reference/youtube-home-raw.html` (served HTML; feed lazy as
the R27 environmental note records), the R27 `app-shell.md` / `design-tokens.md`.

## The YouTube home structure (1440×900)

1. **Masthead** (56px): hamburger + wordmark left, centered search pill, right actions.
2. **Guide rail** — expanded 240px with labels (Home / Shorts / Subscriptions / You /
   History / Explore…), white-on-canvas in light; the corpus's logged-out shell shows
   the sign-in prompt block + Explore + More-from-YouTube sections + footer links.
3. **Main column: chip bar immediately** (All / Gaming / Music / … — 32px tall chips,
   8px radius, active chip inverted) — NO hero, NO config section, NO orientation zone.
   On the logged-out cold-start shell the feed area shows the honest empty state
   ("Try searching to get started…") instead of cards.
4. **Card grid** (rich grid, 16px gap; 4 columns at 1440 in the corpus geometry):
   16:9 thumbnail, radius 12px, duration pill bottom-right, avatar left of a 2-line
   title (16px/500), channel row + meta row (views · time) secondary.

## The WebFlix restructure decision (the operator's #5)

- The home page's HERO and the "What your feed shows" CONFIG section (FeedModeControl
  radios + Personalize + SourceStrip + Connect-a-source links) LEAVE the home surface.
- Home becomes: masthead → rail → **chip bar → rows/grid immediately** (Continue
  watching / For you / Trending / Shorts rail — the shelf structure the corpus's feed
  anatomy documents).
- Config surfaces move to Settings (first-run orientation stays available there);
  the hero's featured content is simply the feed's own content (a normal shelf).
