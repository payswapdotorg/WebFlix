# R27 — The YouTube UX/UI Parity Lab

**Operator directive (2026-09-23, binding):** "run a UX/UI parity lab with youtube between your 3 workers — the end product must look, feel and operate exactly like youtube.com."

This directory is the lab's reference corpus. It was captured by the lead from the
LIVE youtube.com on 2026-09-23 (headless Chromium 1440×900, UTC) and is the single
source of truth for the R27 wave. Every worker branches from a main that contains
this corpus; every deliverable is measured against it.

## The corpus (what is real evidence vs documented)

| File | Provenance | Authority |
| --- | --- | --- |
| `reference/screenshots/yt-search-1440.png` | **[rendered]** live youtube.com search, light | pixel reference |
| `reference/screenshots/yt-search-dark-1440.png` | **[rendered]** live youtube.com search, dark attr | pixel reference |
| `reference/screenshots/yt-watch-1440.png` | **[rendered]** live youtube.com watch shell (media bot-gated; layout complete) | layout reference |
| `reference/screenshots/yt-home-1440.png` | **[rendered]** live youtube.com home shell (feed lazy; shell complete) | shell reference |
| `reference/design-tokens.md` | **[rendered] + [css] + [documented]** (each token tagged) | THE token contract |
| `reference/watch-geometry.md` | **[rendered]** measured live DOM geometry at 1440×900 | THE watch layout |
| `reference/app-shell.md` | **[rendered] + [documented]** | THE shell anatomy |
| `reference/search-card-grammar.json` | **[rendered]** normalized live `ytInitialData` videoRenderer | THE card grammar |
| `reference/youtube-search-raw.html` / `youtube-home-raw.html` | **[rendered]** raw served HTML (1.4MB / 893KB) | deep-dive source |
| `reference/yt-watch-skeleton.css` | **[css]** youtube.com's own served watch-skeleton CSS | exact values |

**Environmental note (recorded 2026-09-22 12:12Z, still true 2026-09-23):** youtube.com
bot-gates MEDIA playback and watch-page `ytInitialPlayerResponse` from this sandbox
(LOGIN_REQUIRED / empty videoDetails), and the home FEED does not hydrate headless.
What is NOT gated: the served HTML, the rendered app shell, search results (full
cards), and the watch-page layout skeleton. The corpus therefore contains complete
rendered evidence for shell/search/watch-layout, and documented evidence (tagged
`[documented]`) for home-feed cards and player-chrome internals — the workers'
implementation of `[documented]` surfaces must match the token sheet and the
captured anatomy, and the lead's final acceptance uses the corpus + the operator's
production journey (the golden rule).

## The three parity dimensions

1. **LOOK** — visual conformance to the corpus: the exact color tokens (`#0f0f0f`
   dark canvas, `#f1f1f1` primary text, `#aaa` secondary, `#606060` tertiary,
   `rgba(0,0,0,0.8)` duration pills, YouTube's red progress), Roboto typography
   ladder, card anatomy (16:9 thumbnail, radius, duration pill, 2-line title,
   channel + meta rows), shell anatomy (56px topbar, 240px labeled rail, chip
   bar, bottom nav), watch geometry (measured), scrollbar styling, skeleton
   loaders. Light mode: white canvas `#fff`, `#0f0f0f` text, `#606060` meta.
2. **FEEL** — motion and state conformance: YouTube's subtle transitions
   (120–300ms ease), hover states (chip/button bg lifts), focus rings, control
   reveals on player hover, hover-scrub behavior, loading skeletons before
   content, no jank, no layout shift.
3. **OPERATE** — the interaction grammar: topbar search with suggestions + mic
   affordance, rail navigation with the Home/Shorts/Subscriptions/You grouping,
   chip filtering, card click → watch, hover previews disclosed progressively,
   watch page interactions (like-style pill, share, save, subscribe-style
   primary channel action, expandable description, related up-next), player
   keyboard grammar (space/k play-pause, j/l ±10s, ←/→ ±5s, f fullscreen,
   m mute, t theater, number keys seek %), settings menu (speed, quality),
   miniplayer/theater/fullscreen modes, Shorts surface (full-bleed vertical +
   action rail).

## The laws (binding — any violation is lead-rejection)

1. **Honest identity.** The product adopts YouTube's exact DESIGN LANGUAGE —
   tokens, layout anatomy, typography, interaction grammar — but keeps its own
   name (WebFlix), its own wordmark, and its own content. Never render
   YouTube's logo, name, or trade dress as if it were ours. Parity of grammar,
   not identity theft.
2. **Capability truth (carried from R26, both directions).** A transport that
   is unavailable in production must never render as usable; a transport that
   serves must never render as unavailable. WebFlix-only capabilities (Where to
   watch groups, peer/authorized-copy realization, Translate gate, AI
   intelligence actions, BYOF, offline) stay FIRST-CLASS but live inside the
   YouTube grammar — progressively disclosed at the moment of intent, never
   removed, never faked. Where YouTube has a feature WebFlix truthfully lacks
   (e.g. comments, live chat), do NOT fabricate a dead imitation: either omit
   the surface or render the honest empty state, and record the divergence in
   your lane report's DIVERGENCES section.
3. **No regressions (the R26 laws stay).** Real thumbnails stay real (the
   `<img>` artwork law: 100/100 cards render real source artwork where the
   catalog carries it); playback keeps the honest cold-invocation control
   plane; the startup law (first frame never waits on enrichment); anonymous
   journeys stay frictionless; no test-only controls masquerading as product.
4. **The battery is the floor.** Baseline 5,028 pass / 1 documented skip. Every
   gate must pass; parity work never trades the floor away.
5. **The corpus is the contract.** Where the corpus tags a token
   `[rendered]`/`[css]`, the implementation matches it exactly. Where it tags
   `[documented]`, the implementation matches the documented value and the
   token sheet. Drift between apps (web vs desktop) is a defect: both render
   from the same sheet.

## Lane scope (the three workers)

- **W1 — shared/intelligence (the reference-keeper).** Encode the corpus as the
  canonical machine-readable token contract + the YouTube card view-model
  grammar in the shared packages, and build the parity conformance harness
  (parses each app's stylesheets/custom-properties and asserts conformance to
  the sheet; structural anatomy assertions). Branch `wfx/r27/shared`.
- **W2 — web (the flagship).** Every web surface rebuilt to the corpus: shell,
  home, search, watch, item, shorts, library, settings, player chrome, dark +
  light. Branch `wfx/r27/web`.
- **W3 — desktop.** The same anatomy on the desktop surfaces from the same
  sheet; desktop browse/watch/search/library + player chrome parity; peer
  realization inside the YouTube-grammar where-to-watch pattern. Branch
  `wfx/r27/desktop`.

## Evidence obligations (per lane)

1. Side-by-side captures: your surface (dark, and light where supported) next
   to the corpus reference, same viewport (1440×900), stored under
   `evidence/r27-w<N>/`.
2. Token conformance: the sheet's values as the active custom properties in
   your app (named in your report, asserted by W1's harness where it lands).
3. Journey evidence: the golden journeys for your surfaces still pass; the
   interaction grammar exercised (click paths, keyboard, hover states).
4. The completion report with the DIVERGENCES section (every honest divergence
   from youtube.com, named).
