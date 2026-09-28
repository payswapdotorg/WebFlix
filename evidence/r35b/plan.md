# R35b — The Grammar Survey (M1, before any edit)

**Lane:** `wfx/r35b/journeys` · **Base:** `acff71b8b363ba6f85ab7a3e9b08ca7ba3e5a419` (main, R35-A)

Every one of the 32 R34-C-adjudicated STALE-GRAMMAR specs was run ALONE
on the fixtures boot (`bun journeys/runner.ts --filter <ids>
--evidence-dir evidence/r35b/m1/group-<x>`, fresh product boot per
group; the J21→J24+J26 scripted-acquisition chain ran together per the
runner's own chain law). The observed first-failing assertions reproduce
the R34-C adjudication table's local column exactly: **26 fail on the
current tree's own fixtures boot** (the grammar drift proper, §A) and
**6 pass locally** (the production-only bindings, §B: J04 J14 J15 J16
J33 J38 — their production failures were re-verified live against
`https://webflix-steel.vercel.app` during this survey; the production
grammar facts below cite those probes).

The grammar deltas (from `git log`, the wave shorthands of
`evidence/r34c/adjudication-table.md`):

- **R28-B `1d32ed8` (HOME RESTRUCTURE)** — home renders chip bar + rows
  immediately (hero + feed config moved to Settings→General); ONE-CLICK
  PLAY (cards link `/player?id=…`, never `/item?id=…`; the canonical
  identity rides the player URL's id param; `/item` demoted to the card
  kebab's Details deep action); `ActionButtons` (the typed-absent
  like/save notes) mounts on `ItemDetailSurface` only; the acquisition
  panel + its typed actions/diagnostics mount on `ItemDetailSurface`
  (and `TorrentPlaybackStage`); the home `SourceStrip` mount is gone
  (`SourceStrip` imports resolve only through `DiscoveryHeader`, which
  no surface mounts — the feed-mode/Personalize controls moved to the
  watch/shorts `CompactDiscoveryControls` band + Settings→General).
- **R29-B `01dc579`/`b852d97` + R30-B `eb52685` + R33-B `7661a17` (the
  shell/masthead/rail grammar)** — the rail primary group (signed-out):
  Home · Shorts · Subscriptions · Library; the You group: History ·
  Playlists · Offline · Settings; the rail sign-in promo link; the
  bottom nav: 4 items. Current DOM: desktop rail 9 links + mobile bar
  4 = 13 `nav a` (matches the R34-C production parse). The player's
  like/save became the R29-B `WatchActions` split pill (local reaction
  transport, no provider-sync claim when the source declares neither).
- **R33-A `09d0205`** — the shorts media stage (J04's surface changed
  but the pill/typed-absence grammar held; J04 passes locally).
- **Catalog/config truth** — the fixtures catalog (3 rain titles, the
  scripted acquisition items) vs the production catalog (24 shorts
  cards, no torrent-realized item, no fixtures source, the service-mode
  note wording, no dev drives).

## The survey table

| Jid | first-failing assertion (fixtures boot, this survey) | grammar delta | re-encode approach |
|---|---|---|---|
| J01 | `nav a` count 13 vs 12 (M1 group-a) | R29-B/R30-B/R33-B rail grammar | Assert the CURRENT rail: 2 landmarks, 13 links (rail 9 + bottom 4), the 4-item primary set in BOTH landmarks, the You group (History/Playlists/Offline/Settings) on the desktop rail, the `/settings` href; the landing binds the R28-B chip-bar composition (no hero). |
| J02 | `data-wfx-hero` attribute absent (group-a) | R28-B home restructure | Hero block → the chip bar (`[data-wfx-chipbar]`, `data-wfx-feed-filter="all"`) + For-you/Trending rows + shorts rail + cards + the masthead search box; Continue-Watching honest absence unchanged. |
| J04 | (passes locally — 13 assertions) | production page-size binding | **M3 neutral:** the position-pill grammar `N / M` (M ≥ 2, advance/return semantics) instead of `"1 / 3"`; all other assertions already hold on both boots (verified live: production pill "1 / 24" → "2 / 24" → "1 / 24", like/save 0, share 1). |
| J05 | result cards link `/player?id=…` (0 of 3 link `/item`) | R28-B one-click play | "Every result links the canonical item detail" → "every result links the CANONICAL identity (the id-first `/player` href — R28-B)"; the fixtures-catalog count (3 rain titles) stays. |
| J06 | `[data-wfx-surface='item']` 0 (card → `/player`) | R28-B | Reach the item hub via the card kebab's Details link (`[data-wfx-card-details]`, read from the DOM's own href — the harness's established href-reading law); every detail-surface assertion then holds unchanged (verified: title/availability/capabilities/typed-absent like/save/acquisition panel/related/gated diagnostics). |
| J07 | "the detail page offers playback — a play href `<absent>`" (the browser sat on `/player`) | R28-B | The search card IS the play decision (one-click): navigate the card's own `/player` href; the embed-surface assertions (mode/containment/sandbox/referrer/attestation/phase/report controls) hold on the player. |
| J08 | same as J07 (Deep Field Diary) | R28-B | Same one-click path; the browser-mode assertions (mode browser, contained frame, containment note, mode label) hold on the player. |
| J09 | `[data-wfx-precedence-trace]` 0 (the journey had fallen back to `/`) | R28-B | Navigate the card's `/player` href directly; the precedence trace (inside `[data-wfx-playback-diagnostics]`) renders on the player (verified); the missing-params + unresolvable-realization states unchanged. |
| J10 | like/save typed-absent markers `<no absent markers>` (read from the player) | R28-B (`ActionButtons` → item surface) | Read the actionbar from the ITEM surface (via the kebab Details path); the watch-report flow then runs from the item's own play link. |
| J12 | "the detail page offers playback — a play href `<absent>`" | R28-B | The one-click card href carries the resume param; the resume/phase/report/no-resume-contrast assertions hold on the player. |
| J14 | (passes locally — 11 assertions) | production fixtures-source binding | **M3 neutral:** the boot's own badge (`data-wfx-mode`) branches — fixtures: the scripted source card's full typed truth (unchanged); service: the R23-sweep truth (the source chooser + the anonymous prerequisite + zero fabricated source cards). |
| J15 | (passes locally — 6 assertions) | service-vs-fixtures note wording | **M3 neutral:** the re-rank note predicate binds the frozen replacement-semantics vocabulary (replaced/replacement/kept/slot/re-rank/runway) — fixtures: "the fresh page replaced nothing — every slot is kept runway"; production: "applied 16 replacement(s); 8 slot(s) kept" (both verified live). |
| J16 | (passes locally — 4 assertions) | same as J15 | **M3 neutral:** the kept-runway predicate accepts the service wording ("8 slot(s) kept") as well as the fixtures wording ("kept runway"). |
| J17 | `[data-wfx-hero]` 0 after the intents | R28-B | The "no corrupted feed" check binds the home composition grammar (surface + chip bar + rows + cards) instead of the removed hero. |
| J20 | `[data-wfx-ai-tray-surface='player']` 0 (the journey had navigated to `/` via a null item-play read) | R28-B | The item-hub tray flow runs on `/item` (via the kebab Details path — the tray's `surface="item"` mount); the player half then reads the item's own play link (the player's tray `surface="player"` renders — verified). |
| J21 | the provenance line `<none>` (the browser sat on `/player`) | R28-B (acquisition panel → item surface) | The scripted-acquisition chain drives on `/item` (kebab Details path); every lifecycle assertion then holds unchanged (verified: provenance "vault:family-media (user-owned)", available state, acquire action). |
| J22 | preparing state `<none>` (same mount-path) | R28-B | Same Details path; the choosing-files step + gated diagnostics hold on `/item`. |
| J23 | harness: `[data-wfx-acquisition-action='advance']` not found (the browser sat on `/player`) | R28-B | Same Details path; the buffering → playing → deadline-risk demotion sequence drives on `/item`. |
| J24 | same as J23 | R28-B | Same Details path; the completing → verifying → ready-offline sequence drives on `/item` (the J24-earned offline copy then lands — J26's cascade closes). |
| J25 | `data-wfx-acquisition-state="failed"` absent (the browser sat on `/player`) | R28-B | Same Details path for both the failed item (Desert Rain Doc) and the resumed item (Deep Field Diary). |
| J26 | 1 vs 2 offline entries (the J23/J24 cascade — the drive never ran on `/item`) | R28-B cascade | The chain passing on `/item` re-earns the J24 copy (2 entries); the offline-entry links re-bind to the id-first `/player` href (the library cards are one-click now); the harbor item read via the kebab Details path. |
| J27 | `[data-wfx-acquisition-none]` 0 (the browser sat on `/player`) | R28-B | The unscripted item's no-session note is on `/item` (kebab Details path — verified). |
| J28 | "the item page offers its play decision — a player link `<absent>`" | R28-B | The player link is the search card's own one-click href (captured while signed in); the expiry → typed unauthorized read → reauthorize → recovery flow unchanged. |
| J29 | harness: `[data-wfx-acquisition-action='acquire']` not found (the browser sat on `/player`) | R28-B | Same Details path for the network-loss item; the starvation/interruption/restart sequence drives on `/item`. |
| J30 | like/save typed-absent notes `<no absent markers>` on the playback surface | R28-B (`ActionButtons` → item surface; R29-B player pill) | The typed-absent grammar is read from the ITEM surface (Details path); the player half binds the R29-B grammar: the reaction pill's honest `data-wfx-reaction="none"` state + zero settled action states + no provider-sync note. |
| J31 | "the detail carries `<the search id>`" → `<none>` (the browser sat on `/player`) | R28-B | The canonical identity is the id-first `/player` href's `id` param (the search card); the detail surface (kebab Details path) and the item's play link both carry the SAME id (verified). |
| J32 | "the search card links the CANONICAL identity — an `/item?id=` link" → observed the `/player?id=` href | R28-B | Re-bind to the CURRENT canonical-link grammar: the id-first `/player` href; the realization capability truth on `/item` (Details path); the precedence walk on the player; the identity-keyed search join (the id params). |
| J33 | (passes locally — 62 assertions) | production dev-route binding | **M3 neutral:** the determinism pre-step binds the typed drive truth (fixtures 200 OR the service boot's typed invalid-input refusal — verified live: HTTP 400 `"'dev-reset' is a fixtures-mode dev drive…"`); the boot badge branches the import walk (fixtures: the full flow unchanged; service: the panel + zero fabricated source cards). |
| J34 | `[data-wfx-source-connect-cta]` 0 (the home SourceStrip mount is gone) | R28-B (+ R29-B masthead) | Task 2/3 re-bind to the current entries: the masthead create affordance `[data-wfx-byof-entry]` (＋ → Settings→Sources) + the rail Settings link; tasks 4/5/6 re-bind to the Watch surface's `CompactDiscoveryControls` band (feed modes + Personalize — verified: 4 options render on `/watch`); the item hub via the kebab Details path. |
| J36 | `[data-wfx-feed-mode-option]` 0 on home | R28-B | Step 5 (feed modes) + step 6 (personalize) re-bind to the Watch surface's compact band; the imported-mode transition law binds the byof option's availability truth; step 7's item hub via the kebab Details path; every other step unchanged. |
| J37 | "the item page offers Play — a play href `<absent>`" (the browser sat on `/player`) | R28-B | The one-click card href IS the anonymous play path (asserted as the R28-B grammar); the access-truth/frame/no-redirect/progress-scope/resume/switch assertions hold on the player (the access truth already passed there in this survey's run). |
| J38 | (passes locally — 42 assertions) | production torrent-catalog binding | **M3 neutral:** the boot badge branches — fixtures: the full first-class lifecycle walk (unchanged); service: the R23-sweep truth (the grouping law: the webflix-source group renders, NO fabricated peer-copy entry; the item's acquisition panel carries the honest Desktop-next-step state; the drive answers the typed "web transport serves reads only" refusal — all verified live). |

## The production grammar facts (the M3 neutral bindings' evidence)

Verified live against `https://webflix-steel.vercel.app` during this
survey (agent-browser probes, the same driver the journeys use):

- The shell badge: `data-wfx-mode="service"` (locally `"fixtures"` —
  the loud environment law is the branch truth the six neutral
  re-encodes read).
- J04: the pill `1 / 24` → next `2 / 24` → back `1 / 24`; like 0, save
  0, share 1, current card 1.
- J14: `[data-wfx-settings-sources]` 1, `[data-wfx-source-chooser]` 1,
  `[data-wfx-source-chooser-prerequisite]` 1,
  `[data-wfx-source-chooser-signin]` 1, source cards `[]`, the section
  nav links present (the R23 sweep's "source chooser, 7 markers" line).
- J15/J16: the re-rank note after 5 swipes: "applied 16 replacement(s);
  8 slot(s) kept".
- J33: `POST /api/byof {"action":"dev-reset"}` → HTTP 400
  `{"ok":false,"failure":{"kind":"invalid-input","detail":"'dev-reset'
  is a fixtures-mode dev drive — the scripted source lifecycle does not
  exist in a service boot"}}`; the BYOF panel renders
  (`[data-wfx-byof-panel]` 1) with zero source cards.
- J38: an item's where-to-watch groups `["webflix-source"]`, zero
  peer-copy entries; the item's acquisition panel renders
  `[data-wfx-acquisition-none]` + the elsewhere note "You can make this
  title available offline in the WebFlix desktop app — it downloads and
  verifies a copy you can watch without a connection." (the R23 sweep's
  exact line); `POST /api/acquisition` answers `{"error":"native
  acquisition actions run in the WebFlix desktop app — the web
  transport serves reads only"}`.
- The card kebab → Details deep path (`[data-wfx-card-actions]` →
  `[data-wfx-card-details]`) works on BOTH boots (verified on each).

## The shared re-encode mechanism (the R28-B deep-surface path)

`/item` is now the DEEP surface: the card's primary link is the
one-click `/player` href; the card's quiet action row (the kebab
`[data-wfx-card-actions]`) carries the Details link
(`[data-wfx-card-details]`) whose server-rendered href is the `/item`
URL. The re-encoded journeys read that href from the DOM (the same
href-reading law the harness's `openHomeAndClickCard` and the
closed-disclosure reads like J22's `diagnosticsSessionState` already
follow — the SSR markup carries the contract) and navigate it. Each
re-encoded spec carries its own local helper (the owned surface is the
32 spec files only; `journeys/lib/**` is untouchable).
