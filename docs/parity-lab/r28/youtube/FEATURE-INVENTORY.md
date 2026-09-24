# FEATURE-INVENTORY — the R28 master list (surface | element | trigger | behavior)

Worker A's master interactive-element inventory from the R28 corpus (live youtube.com, logged-out, 1440×900, 2026-09-23). Provenance per row: **[r]** rendered/measured this session · **[d]** documented/established (not exercisable in gated env) · **[l]** lead-recorded (lead-captures @ 0755a38) · **[P]** CORPUS-PENDING. This is the backbone for Worker C's reconciliation matrix — completeness beats polish.

## Masthead
| Element | Trigger | Behavior | |
| --- | --- | --- | --- |
| Guide hamburger | click | toggles rail drawer (240px) | [r] |
| YouTube logo | click | → home | [r] |
| Search box | type + Enter | → /results?search_query=… SPA route | [r] |
| Mic button (40×40 r100) | click | voice search overlay | [d] |
| Settings gear | click | multi-page menu: Your data / Appearance (Light↔Dark) / Display language / Restricted Mode / Location / Keyboard shortcuts / Settings / Help / Send feedback | [r] |
| Sign-in pill (40h r20) | click | → accounts.google.com sign-in | [r] |
| Avatar cluster (logged-in) | click | account menu | [l][P] |
| Notifications bell (logged-in) | click | notifications panel; count in title | [l][P] |

## Rail / guide
| Element | Trigger | Behavior | |
| --- | --- | --- | --- |
| Guide items (40h r10, 14/400) | click | SPA route to surface (Home/Shorts/Subscriptions/You/History/Explore…) | [r] |
| Active item state | — | active pill on current surface | [r] (grammar) |
| Sign-in promo | click Sign in | → accounts.google.com | [r] |
| Show more/less | click | expands/collapses Explore+More-from-YT sections | [r] |
| Subscriptions channel list (logged-in) | click | → channel page | [l][P] |

## Feed surfaces (home family)
| Element | Trigger | Behavior | |
| --- | --- | --- | --- |
| Chip bar (#chip-bar, h50, arrows on overflow) | click chip | refilters feed (active chip inverts) | [r] (sibling surfaces) |
| Chip scroll arrows | click | scrolls chip row | [r] |
| Video card (yt-lockup-view-model) | hover | ~150ms → preview singleton (muted inline video, pop +12px/side) | [r] |
| Video card | un-hover | preview fades (opacity), singleton retained | [r] |
| Video card | click title/thumb | **1 click** → /watch?v=… autoplay | [r] |
| Card 3-dot "More actions" (40×40) | click | menu: Add to queue / Save to playlist / Download / Share / … | [r] |
| Duration badge (r4 0.6-black) | — | static | [r] |
| LIVE badge | — | static | [r] |
| Watched-progress overlay | — | resume bar on watched cards | [P] |
| Shorts shelf card (208×311) | click | → /shorts/<id> | [r] |
| Infinite scroll | scroll bottom | appends next page (~30/page) | [r]/[d] |

## Search
| Element | Trigger | Behavior | |
| --- | --- | --- | --- |
| Result row | hover | preview singleton after ~150ms (subtle: no title color change) | [r] |
| Result row | click | 1 click → /watch?v=… | [r] |
| Chips row (query-contextual) | click chip | refilters results | [r] |
| Filters button | click | 696×518 dialog: TYPE/DURATION/UPLOAD DATE/FEATURES/PRIORITIZE groups | [r] |
| Result 3-dot | click | card menu family | [r] |

## Watch page
| Element | Trigger | Behavior | |
| --- | --- | --- | --- |
| Player | click card (entry) | autoplay with sound; chrome reveal → ~3s auto-hide | [r]/[d] |
| Large Play button `Play (k)` | click | play/pause toggle | [r] (label) |
| Progress bar + scrub | hover/drag | seek; scrub preview tooltip | [d] |
| Time display | — | "0:00 / 0:00" (current / total) | [r] |
| Volume (mute + slider) | click/hover | mute toggle + slider | [d] |
| Captions (c) | click | captions menu | [d] |
| Settings / overflow "More" | click | speed (0.25–2x), quality, captions panels | [r] (mount) [d] (menus) |
| Copy link (player) | click | copies watch URL | [r] (mount) |
| Cards "Show cards" | click | info cards | [r] (mount) |
| Miniplayer (i) | click/key | bottom-right floating persistent player | [d] |
| Theater (t) | click/key | player → 1296px full-content-width | [d] |
| Fullscreen (f) | click/key | fullscreen | [d] |
| Like / dislike split pill | click | sentiment + count update (auth-gated logged-out) | [d]/[r] (grammar) |
| Share pill | click | unified share panel (see share sheet) | [r] (panel via card menu) |
| Download / Save | click | auth-gated (offer sheet logged-out) | [d] |
| More-actions kebab | click | report/transcript/etc | [d] |
| Subscribe pill | click | auth-gated → sign-in sheet logged-out | [d] |
| Description "...more"/"Show less" | click | inline expand/collapse | [d] |
| Comments sort (Top/Newest) | click | resort list | [r] |
| Comment like/dislike/reply | click | auth-gated logged-out | [d] |
| Replies expander ("N replies") | click | loads reply continuation | [r] (mount) |
| Composer simplebox | click | logged-out: no-op (sign-in-gated); logged-in: editor+emoji+Cancel/Comment | [r]/[P] |
| Autoplay toggle | click | up-next auto-advance on/off | [d] |
| Related (up-next) card | click | 1 click → next video | [d] |
| Keyboard: k space j l m f t i arrows 0-9 c | key | player transport + modes | [d] (k in label [r]) |

## Shorts
| Element | Trigger | Behavior | |
| --- | --- | --- | --- |
| Vertical feed | scroll/arrows | pages shorts | [d] |
| Play CTA (gated shell) | click | attempts playback (gated env) | [r] |
| Action rail like/dislike/comments/share/more | click | engagement; counts under icons | [P] |
| Audio toggle | click | mutes/unmutes short | [P] |
| Subscribe (inline) | click | subscribe | [P] |

## Dialogs / system
| Element | Trigger | Behavior | |
| --- | --- | --- | --- |
| Share panel | Share click | 470×337 r12 dialog; tile row (Embed first); youtu.be?si= link; Copy → "Link copied to clipboard" toast; Start at 0:00 | [r] |
| Card menu | 3-dot click | Add to queue / Save to playlist / Download / Share / … | [r] |
| Filters dialog | Filters click | 5-group filter panel; Apply/.Search | [r] |
| Settings menu pages | row click | subpages (Appearance: Dark/Light rows; etc.) | [r] |
| Theme (Appearance ▸ Dark) | click | flips html[dark] app-wide; persists in session | [r] |
| Toast (yt-snackbar) | system | transient feedback (~4s per R27) | [r]/[l] |
| Skip navigation (a11y) | focus/tab | keyboard nav affordance | [r] |

## Logged-in account chrome (all [l] healthy-window or [P])
Avatar menu · bell + panel · subscriptions feed rows · History · Watch later · Liked videos · Playlists · account theme picker default — see logged-in-surfaces.md (CORPUS-PENDING).
