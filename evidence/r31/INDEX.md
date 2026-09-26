# R31 — THE GAP WAVE: THE CORPUS-CITATION TABLE

Lane: `wfx/r31/gaps` (base: `main @ 54e0e4f` — the R31 gap-corpus merge).
The binding grammar: `docs/parity-lab/r30/gap-captures/20260926-052954/GAP-CORPUS.md`
(+ the raw .json/.jpg/.html captures in the same directory, + `g1-targeted-2.json`
the picker attempt of record). Every shipped surface cites its section; every
diverged row cites the honest reason. The two still-pending gaps are NOT built
(recorded in DIVERGENCES.md as PEND).

| Surface | GAP-CORPUS.md section | The captured grammar | The code seam | Proof |
|---|---|---|---|---|
| §G1 THE THEME-PICKER SUB-PAGE (the header) | §G1 ("Header: **'Appearance'** with a **back arrow icon** (left)"; the captured ytd-simple-menu-header-renderer's back button, aria-label="Back") | The header row + the back-arrow ICON returning to the main menu | `components/shell/AccountMenu.tsx` → `AppearancePickerPanel` (the `wfx-account__subhead` family + the `arrowLeft` Icon glyph, `data-wfx-theme-picker-back`/`data-wfx-account-back`) | `tests/gap-theme-picker.test.ts` (the header describe); `captures/02-theme-picker-device.html` |
| §G1 THE SUBTEXT | §G1 ("Subtext: **'Setting applies to this browser only'**") | The verbatim line between the header and the rows | `AppearancePickerPanel` (the `wfx-picker__subtext`, `data-wfx-theme-picker-subtext`) — honestly true of WebFlix's own persistence scope (localStorage is per-browser) | the subtext describe; `captures/02` |
| §G1 THE 3 OPTION ROWS | §G1 ("Exactly **3 option rows**, in order: 1. **'Use device theme'** 2. **'Dark theme'** 3. **'Light theme'**") | The captured order + labels | `components/shell/theme-picker-grammar.ts` → `THEME_PICKER_OPTIONS` (ONE truth, shared by the panel + the tests — the bell-grammar pattern) + `AppearancePickerPanel`'s row map | the grammar-module describes (order, labels, round trip); `captures/02` + `03` |
| §G1 THE ROW GEOMETRY | §G1 ("Row geometry: **300×40** each (x=1108 in a 1440 viewport), stacked at a **40px vertical pitch** (y=162/202/242); the inner label ~72-110×20") | The 300px row box, the contiguous 40px stack, the label's 56px indent | `globals.css` (the `.wfx-picker__row` block: `width: 300px; height: 40px`, no inter-row margins, `padding 0 16px` + the reserved 24px `.wfx-picker__mark` + the 16px gap = the captured 56px label offset) | the CSS seam (lint-clean, additive); `captures/02` |
| §G1 THE CHECK-IN-BOX SELECTED STATE | §G1 ("The SELECTED row ... indicated by a **checkmark icon inside a box** to its left (a check-in-box, not a radio dot — VLM-verified on the open picker)") | The selected row's left slot paints the box+check glyph; the slot is RESERVED on every row (the captured labels all start at x=1164) | `Icon.tsx` (+ the `checkBox` icon: a rect + check path) + `AppearancePickerPanel` (the `.wfx-picker__mark` slot, painted only on the selected row; `data-wfx-theme-selected` + `aria-checked` on the menuitemradio role) | the selected-state describes (exactly one marker, `<rect>` present, `<circle>` NEVER); `captures/02` (device) + `03` (dark) |
| §G1 THE TWO-LAYER TRUTH (the stored seam) | §G1 ("The captured selected state matches the account-menu row's own state label ... the two-layer truth: the menu row carries the STATE, the picker row carries the CHECK"; "No stored choice = 'Use device theme' selected (the captured state); 'Dark theme'/'Light theme' when persisted") | The picker's CHECK follows the SAME stored truth the menu row's label reads | `theme-picker-grammar.ts` (`themeStateOfStored`/`storedThemeOfState` — the `wfx-theme` key's read/write laws; the device write is NULL: the stored choice is REMOVED, the boot law's OS-preference follow resumes) + `AccountMenu.tsx` (`currentThemeState` — the same read the R30-B row used; `writeThemeState` — dark/light persist via the gear's own applyTheme law, device removes + applies the OS preference live; the island's `setThemeState` keeps the row's label current on return) | the grammar-module describes (read/write/round-trip/device-derivation); the persisted-states describes |
| §G1 THE PATH (the row activation) | §G1 ("THE PATH: account menu (avatar click) → the 'Appearance: Device theme' row ... → the picker renders as a SUB-PAGE of the same multi-page menu") + CORPUS.md §3 ("Appearance: Device theme (right arrow)") | The row activation opens the picker as the menu's second page; the back arrow returns | `AccountMenu.tsx` (the Appearance row is now a `menuitem` BUTTON carrying the state label + §3's own right-arrow chevron — `data-wfx-appearance-row`; the island's page union gains `appearance`; the back arrow → `setPage("root")`) | the root-row describes; `captures/01-account-menu-root.html` |
| The pinned control (the closed menu + the signed-out shell) | The task's frozen law ("The signed-out shell and the closed-menu state stay byte-identical to R30-B's verified chrome") | — | UNCHANGED BY CONSTRUCTION: the trigger markup is untouched (the island's initial render = the trigger alone); the AccountMenu renders only in the signed-in chrome (the AppShell's `signedIn` gate — R30-B's own) | `captures/00-account-menu-closed.html`; the signed-out describes in `tests/subscriptions-feed.test.ts` + the R30-B signed-out suites (green, unchanged) |
| §G2 THE TWO-COLUMN BROWSE GRID (the shell) | §G2 ("The cards render in the two-column browse grid (the ytd-two-column-browse-results-renderer shell, grid bar at x=72 y=56 w=1352 in the 1440 viewport)") | The standard browse content area + the card grid | `app/feed/subscriptions/page.tsx` (the corpus URL, a PRESENTATION ROUTE — the /player precedent, the frozen SurfaceId set untouched) + `components/discovery/SubscriptionsFeedSurface.tsx` (the grid) + `globals.css` (the `.wfx-subsfeed__grid` block at the repo's own browse column law: 4 ≥1300 / 3 ≥1000 / 2 ≥600 / 1 <600, 16px gaps — the captured 1352px bar renders 3 full cards + a partial 4th, the 4-column law's own geometry) | the route-law describes; `captures/04-subs-feed-grid.html` |
| §G2 THE "Latest" HEADER | §G2's grid truth (the g2-subs-feed.json `grid.text`: "Latest ... All subscriptions"; the R30 corpus §10: "a 'Latest' header and 3 cards" — present in BOTH captured states) | The feed's section heading | `SubscriptionsFeedSurface` (the `wfx-subsfeed__heading` h1, `data-wfx-subsfeed-heading`) — the "All subscriptions" LAYOUT TOGGLE stays absent (DIVERGENCES.md: no layout-toggle seam) | the heading assertions in the grid describes; `captures/04` |
| §G2 THE CARDS (title, channel, meta, thumbnail) | §G2 ("Real subscription cards with: title, channel name, meta line ('channel · views · age', e.g. 'AFTER FOOT 64K 7h ago'...), thumbnail") | The card anatomy over the subscribed items' content | `SubscriptionsFeedSurface` → `cardOfEntry` (the JOINED connector read: title, canonicalType, durationMs, artwork — through `ItemCard`, the SAME card grammar every feed surface renders; the channel slot = the card's own honest "From \<connector\>" identity; views/age carry NO WebFlix datum — DIVERGENCES.md, never a fabricated "64K 7h ago") | the card-grammar describe; `captures/04` |
| §G2 THE DATA TRUTH (the stored fold) | §G2 (the healthy grid's real cards) + the task's law ("the same truth the rail's Subscriptions section and the Library list render") | The grid lists the stored Subscriptions entries — never a new source | `app/feed/subscriptions/page.tsx` composes the SAME `loadAccountChrome()` (the R30-A `hydrate()` seam's fold — `account-chrome.ts`'s own loader) and passes `account.railSubscriptions` — structurally the SAME array the rail renders | the stored-truth describe (the flow through the REAL POST /api/library subscribe seam); `captures/04` |
| §G2 THE ROUTE LAW (the destinations) | §G2 + the task's law ("bound to the same route law the rail's rows follow") | Each card's destination = the entry's own player surface | `ItemCard` (the internal `playerHref` on the joined identity — the SAME law `RailSubscriptions`' rows follow); an unjoined entry renders the honest UNLINKED cell (`data-wfx-subsfeed-unlinked`, the WatchlistRow pattern — never a fabricated link) | the route-law + unlinked describes; `captures/04` |
| §G2 THE EMPTY STATE | The task's law ("no subscriptions stored = the honest empty state (the capability row's own vocabulary — never fabricated cards)") | The honest empty state | `SubscriptionsFeedSurface` (the `EmptyState` in the rail's own vocabulary: "No subscriptions yet — subscribe from any watch page") | the empty-state describe; `captures/05-subs-feed-empty.html` |
| §G2 THE DESTINATION JOIN (the rail seam) | The corpus taxonomy's Subscriptions entry (CORPUS.md §4; the task: "the rail's Subscriptions section already points at the real destination per R30-B; your grid IS that destination's content surface") | The rail's Subscriptions section heading carries the feed's destination | `components/shell/RailSubscriptions.tsx` (the `<h3>` heading's text becomes the `/feed/subscriptions` anchor — `data-wfx-rail-subscriptions-heading`; ONE element, the heading family's own look, the rows/geometry/position unchanged — the R30-B Playlists-row precedent's exact join class; the signed-out rail is untouched: the section renders only in the signed-in chrome) | the rail-seam describes (+ the signed-out control); `captures/06-shell-rail-heading.html` + `07-rail-subscriptions.html` |

## The corpus-citation coverage

- **SHIPPED (bound, cited)**: §G1 in full (the header + back-arrow icon, the
  subtext, the 3 option rows in the captured order, the 300×40/40px-pitch
  geometry with the 56px label indent, the check-in-box selected state bound
  to the stored truth, the two-layer truth, the row-activation path, the
  write-through) · §G2 in full (the browse grid shell at the corpus URL, the
  "Latest" heading, the cards over the real connector read, the stored-fold
  data truth, the rail-rows' route law, the honest empty state, the rail
  heading's destination join).
- **DIVERGED (honest rows — DIVERGENCES.md)**: §G1's marker re-verification
  note (the corpus's binding check-in-box followed; the fresh VLM + pixel
  read of the raw jpg reads a bare checkmark — recorded), §G2's views/age
  meta (no WebFlix datum), §G2's "All subscriptions" toggle (no layout
  seam), §G2's grid-bar origin measure (the captured x=72 collapsed-guide
  window vs WebFlix's frozen 240px rail), §G2's degraded live-only state
  class (no liveness datum in the domain model — the conditional honestly
  never fires), the card's channel-name slot (the card grammar's own
  "From \<connector\>" identity — the sources-model displayName renders on
  the watch surface's channel row, not on cards).
- **PENDING (never built — the two gaps that stay pending)**: the
  home-surface resume bar (§G3: the captured account's home renders zero
  progress bars — nothing to bind), the shorts action rail (§G4: the
  risk-engine gate blocks the player — the third consistent record;
  WebFlix's own shorts surface untouched).

The full gate battery: `guards.md`. The per-surface captures: `captures/` +
`probe-facts.json` (generated by `apps/web/scripts/r31-gap-probe.ts` — the SSR
composition probe, the R30-B instrument class) — PLUS the browser-level golden
paths proven LIVE in this sandbox (unlike R30-B's): `browser-verification.md`
+ `captures/browser-*.png` (the picker's measured 300×40/40px-pitch geometry,
the Dark/device write-throughs, the real-pill subscribe → the feed grid → the
card's player click-through, the responsive law, zero page errors).
