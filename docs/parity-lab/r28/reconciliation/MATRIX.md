# R28 RECONCILIATION MATRIX — the operator's scoreboard

**Lane:** `wfx/r28/recon` · **Base:** `origin/main @ 3304b65`
**Maintainer:** Worker C (the reconciler). B's claim is a hypothesis until C verifies.
**Rules:** every row cites evidence; every YouTube value cites A's corpus sheet
(`corpus: PENDING-A` until A's FEATURE-INVENTORY.md lands). An unverified fix is a
RED row, never green. A silent pass is worse than a loud fail.

**Legend — gap class:** `OB` = OPERATOR-BLOCKING (an operator complaint, verbatim) ·
`PAR` = PARITY gap (YouTube has it, WebFlix differs, operator-general) ·
`COS` = COSMETIC · `HD` = HONEST-DIVERGENCE (frozen-law honest, WONT-FIX candidate).
**Fix status:** `OPEN` (red) · `B-lane <sha>` (landed, UNVERIFIED — still red) ·
`VERIFIED` (green — C reproduced the fix) · `WONT-FIX honest` (HD accepted).

Counts are in the [SCOREBOARD](#scoreboard) at the end.

---

## SECTION 1 — THE OPERATOR'S 7 COMPLAINTS (verbatim, 2026-09-23 escalation — first rows, all OB)

| # | feature | YouTube behavior | WebFlix state (C's observation) | class | status | verdict notes |
|---|---|---|---|---|---|---|
| O1 | **Hover thumbnail preview** ("hovering over thumbnails doesn't display gifs") | **corpus: A@97a5d22 `youtube/hover-preview.md`** — dwell **~150ms** (supersedes R27's 500ms) → `ytd-video-preview` SINGLETON overlay (reuse, not per-card) → video @~193ms; preview pops **+24px (~12px/side)** over the thumb (524×305 for a 500×281); hidden-chrome player + "Tap to unmute" + 2x speed pill + progress bar; un-hover = **opacity fade, element retained**; card itself NEVER transforms; shorts cards exempt | 3.6s dwell on `.wfx-card` → **0 videos, 0 gifs, `.wfx-cardpreview` ×11 ALL EMPTY (0 children)**; thumbs are CSS gradient + initials. `evidence/r28-recon/baseline/hover-dwell-1.6s.png` | OB | OPEN | A's full contract: 150ms dwell, singleton reuse, +24px pop, muted autoplay, fade-out retention. WebFlix mounts nothing, ever. |
| O2 | **Clicks to play** ("you have to click 3 times before a video plays") | **corpus: A@97a5d22 `youtube/click-to-play.md`** — **ONE click from any card** (search title, channel grid lockup, home card) → SPA soft-nav → `/watch?v=<11-char id>`; shell mounts ~1.2s; `video.html5-main-video` present immediately after mount; player **996×560 @(16,68)**; autoplay after click-through (no second gesture); chrome reveal-then-~3s-auto-hide; player chrome carries Play(k) + **Copy link** + More overflow + playlist menu | **FIXED by B@1d32ed8** — C reproduced (both boots): card href → **`/player` directly** (no `/item` interstitial), `userActionsToPlayAttempt: 1`, iframe `youtube-nocookie.com/embed/<id>?enablejsapi=1&autoplay=1&mute=1` + **"Sound off — tap to unmute"** + `Mute (m)`; `Play (k)` labels present. `b1-1d32ed8-{fixtures,service,spec}` + PNGs | OB | **VERIFIED (B-lane 1d32ed8)** | The complaint (3 clicks) is fixed: 1 click → autoplaying muted embed with unmute affordance. Honest residuals (sub-law, not complaint): card click = `nav: navigate` full reload, NOT the corpus's SPA soft-nav; player URL is `/player?id=` not `/watch?v=`; fixture-boot embed is netblocked (service boot is the operator-representative proof). |
| O3 | **Comments** ("there's no comments") | **corpus: A@4b1bc77 `youtube/comments-anatomy.md`** — header "85 Comments" **15px/700** + sort menu **Top/Newest**; rows 996w×~82h: avatar **36×36 circular**, author **@handle 12px/500** #0f0f0f, time 12px/400 #606060, body **14px/400/20** #0f0f0f, like/dislike **32×32 pills ~48px pitch** + count, Reply 12px/500 #606060, replies expander "N replies", creator heart + pinned badge slots; composer = avatar 24 + "Add a comment..." collapsed (editor sign-in-gated honestly); initial 20 threads, continuation loading | 0 comment elements on `/watch`, `/player`, AND `/item`; no region/heading/list/composer anywhere. BASELINE-OBSERVATION §4 | OB | OPEN | Full measured contract (VLM cross-checked). R27's "honest omission" overruled by the operator. WebFlix has 0% of this surface. |
| O4 | **Share** ("sharing doesn't work the same") | **corpus: A@4b1bc77 `youtube/share-dialog.md`** — unified panel **470×337 r12**, shadow rgba(0,0,0,0.15) 0 0 24 12; "Share" header + X 24×24; **scrollable social tiles 70×93**: Embed FIRST, Messages, WhatsApp, Facebook, X, Email, Reddit, Pinterest, LinkedIn + overflow arrows; link field **`youtu.be/<id>?si=<token>`** 14px/400 + **Copy pill 64×40 r20** → **"Link copied to clipboard" toast**; "**Start at 0:00**" checkbox → `&t=`; entry points: watch action-row Share pill + card 3-dot menu (Add to queue / Save to playlist / Download / Share) | `<details>` popup on `/item` AND `/player`: 2 controls — "Copy WebFlix link" + "Open on fake-source"; raw internal path `/item?id=...&connector=...&ref=...`; NO dialog, NO tiles, NO short URL, NO embed, NO start-at, NO toast. `evidence/r28-recon/baseline/share-popup.png` | OB | OPEN | Every dimension of the YouTube share contract is measured; WebFlix matches none of the anatomy beyond a copy affordance. |
| O5 | **Theme + fonts** ("the theme and fonts used are not the same") | **corpus: A@298fa55 `youtube/fonts.md`** — census of ~4000 elements: **every role resolves to `Roboto, Arial, sans-serif`** (8 stacks, one Roboto+Noto); Roboto **400/500/700 actually loaded** (3 woff2 v51); **YouTube Sans declared NEVER loaded** (licensing: B must not ship it — Roboto is what YT renders); per-role table: title 18/400, meta 12/400, card title 16/500, chips 14/500, buttons 14/500, comments 12/500/14/400, h1 20/700/28; html root **10px** | **FONTS FIXED by B@1d32ed8** — C reproduced (both boots): FontFaceSet now contains **Roboto ×2 (latin + latin-ext, variable 100–900, self-hosted woff2 in `public/fonts/`)**, one face `loaded`; role ladder measured conformant: card title **16/500**, meta **12/400**, chips **14/500**; **YouTube Sans NOT shipped** (licensing law ✓). `b1-1d32ed8-{fixtures,service}` | OB | **VERIFIED — fonts half (B-lane 1d32ed8)** | O5 has two halves. Fonts: VERIFIED (Roboto actually loaded; per-role ladder at the measured roles). Theme: still open — see O6/N15 (WebFlix boots dark; YouTube logged-out default light). Row stays OB until both halves land. |
| O6 | **Background color** ("the background color is different") | **corpus: A@298fa55 `youtube/color-survey.md`** — logged-out default = **LIGHT** (`html` #ffffff; theme via `html[dark]` attribute, gear▸Appearance menu; body transparent, **`ytd-app` carries the bg**); core pair #ffffff/#0f0f0f + text #0f0f0f/#f1f1f1 + meta #606060/#aaaaaa; duration pill **alpha 0.6** (R27's 0.8 superseded); raised surfaces #f2f2f2/#272727; hashed-var warning (copy VALUES not names) | **PARTIAL FIX by B@1d32ed8** — the hero/config wall (the #272727 first-screen driver) is GONE (N5/N6 VERIFIED); service boot renders **real artwork thumbs** (100 imgs measured); **pixel-field survey: dark home now 63.1% near-black vs baseline 26% and YouTube dark capture 64%** (`b1-1d32ed8-pixel-survey.md`). STILL OPEN: **boots DARK where YouTube logged-out boots LIGHT** (`themeAttr: dark`, bodyBg #0f0f0f — N15); raised-gray share 11.7% vs YT <5%. `b1-1d32ed8-*` | OB | OPEN (partial: hero + field-composition fixed; theme default remains) | Three causes recorded at baseline: default theme mismatch (open), the hero (FIXED), gradient placeholder thumbs (fixtures-data artifact — service mode carries real artwork). The operator's literal complaint ("background is different") tracks the default-theme divergence most closely — N15 is the remaining fix. |
| O7 | **"and I can go on and on"** (standing row) | — | Every new operator-visible finding found by C extends this row; see the growing list §5 rows N1+ (mic absent, notifications absent, duplicate History, hero presence, feed-config presence, player padding, artwork placeholders…) | OB | OPEN | The standing complaint = the operator's expectation of YouTube-look at EVERY granularity; the rows below ARE the "on and on". |

---

## SECTION 2 — R27's 21 honest divergences, re-triaged for R28

Re-triage rules: the operator's escalation re-frames "honest omission" rows that
the operator can SEE (comments, fonts…) as OB; capability-honest rows that are
invisible to the look (backgroundWork, storage) stay HD; dev-env rows stay HD/lead.

| # | feature | YouTube behavior | WebFlix state | class | status | verdict notes |
|---|---|---|---|---|---|---|
| D1 | Wordmark/logo | YouTube wordmark | "WebFlix" wordmark | HD | WONT-FIX honest | Frozen law HONEST IDENTITY — brand never imitated. Not operator-complaint scope (look≠trademark). |
| D2 | Mode badge | none | `dev fixtures` badge | HD | WONT-FIX honest | Dev-only boot truth; absent in service boot. |
| D3 | Mic (voice search) button | masthead center, 40px circle (corpus app-shell.md) | Absent | PAR | OPEN | Corpus carries it. Capability-honest omission BUT operator-visible "on and on". B may ship it only with a real transport, else stays honest-absent. `corpus: PENDING-A` for exact anatomy. |
| D4 | Notifications bell | masthead right | Absent | PAR | OPEN | Same class as D3. |
| D5 | Rail "Search" link | corpus: Search lives in masthead, not rail | Conforms (no Search in rail) | — | CLOSED by corpus | J01 journey grammar is stale, not the app. No action. |
| D6 | Rail entry "Subscriptions" | corpus rail: Home · Shorts · Subscriptions · You…; **A@25ba5e7 logged-in-surfaces.md (lead healthy-window record)**: flat channel list under a "Subscriptions" section heading (observed: Les Vidéos de Riles · Marques Brownlee · Hasan Minhaj · LastWeekTonight · Jimmy Kimmel Live · Bloomberg Originals · Mastar · Show more — CORPUS-PENDING anatomy) | "Watch" (long-form browse) instead | PAR | OPEN | Honest mapping, but operator-visible. A's home-anatomy rail grammar + the lead's logged-in flat-channel-list record are the spec; B could rename/extend if a subscription-equivalent surface exists (from memory-beyond-record is barred by the lead ruling). |
| D7 | "Offline" rail entry | none | WebFlix-specific surface | HD | WONT-FIX honest | Real WebFlix capability, honest exposure. |
| D8 | Duplicate "History" in rail | single History entry | History ×2 (You-section + top-level) — **re-verified live on base** | COS | OPEN | Operator-visible sloppiness; trivial fix for B. |
| D9 | Comments section | corpus watch-geometry: comments 20px/400 heading + list | Absent | **OB** | OPEN | **ESCALATED from HD → OB** (operator complaint O3). R27's "honest omission" is overruled by the binding escalation. |
| D10 | Live-chat / membership / premiere | on live content | Absent | HD | WONT-FIX honest | No transport; YouTube shows these only for live/member content. |
| D11 | Subscribe button (owner row) | corpus owner row: Subscribe-style CTA | Channel-name + mode label, no CTA | PAR | OPEN | Corpus carries the CTA anatomy. Operator-visible "on and on". B can ship an honest follow/save CTA in the anatomy. `corpus: PENDING-A`. |
| D12 | Settings popup rows | speed/quality | speed rows + WebFlix capability rows (Translate/AI/Provenance…) | HD | WONT-FIX honest | Real capabilities in-grammar; honest. |
| D13 | Watch primary column width | corpus 1012px @1440 guide-collapsed | 724px (guide-open) + 412px secondary — **re-verified** `724px 412px` | PAR | OPEN | Corpus is guide-collapsed measure; YT guide-open is also narrower. Low-priority geometry; A's sheet to settle default state. |
| D14 | `.wfx-player` padding | corpus: 16px @1440 / 24px @≥1600 | **`24px 24px 48px` re-verified on base — still open** | PAR | OPEN | Lead-owned R27 follow-up, NOT fixed on main. B-lane candidate. |
| D15 | Real artwork on cards | colorful real thumbnails everywhere | Gradient + initials placeholders (fixtures carry no artwork URLs); `ArtworkImage` renders null | **OB** | OPEN | **ESCALATED from HD → OB**: this is a first-order driver of O6 (background "different") and O-look ("doesn't look like youtube"). Fixtures need real artwork (or B ships a real-content source). |
| D16 | 9 tokens rendered literally not as `--wfx-*` | — | 13/22 tokens as custom props; 9 literal | COS | OPEN | Lead follow-up; harness reports informational. |
| D17 | Journey suite flakiness (dev boot) | — | 41-journey suite non-deterministic in sandbox boot | HD | OPEN (lead) | Environment limit; production sweep is the lead's instrument. |
| D18 | J01 stale grammar | — | journey expects pre-parity nav | — | CLOSED | Corpus wins; journey-side fix, not app. |
| D19 | Watch browse empty state | YT always has content | Honest typed empty state | HD | WONT-FIX honest | No fabricated content — frozen law. |
| D20 | Shorts honest empty (films never shorts) | YT shorts feed | Fixture shorts present (stage renders content, "1 / 3") | — | CLOSED on base | Base renders fixture shorts; the honest-empty case remains law-abiding. |
| D21 | Signed-out session truth | logged-in avatar | "Signed out" + avatar honestly | HD | WONT-FIX honest | No fabricated profile. |

---

## SECTION 3 — R27's 5 lead-owned follow-ups

| # | feature | YouTube behavior | WebFlix state | class | status | verdict notes |
|---|---|---|---|---|---|---|
| F1 | J01 grammar (2× Search nav links) | corpus rail grammar | App conforms; journey stale | — | CLOSED | D5. |
| F2 | J36 byof timeout | — | journey-side timing | HD | OPEN (lead) | Not app-visible. |
| F3 | `.wfx-player` padding 16px@1440 | corpus 16/24 | 24px live — re-measured | PAR | OPEN | = D14. |
| F4 | 9 literal tokens → canonical names | — | 9 literal | COS | OPEN | = D16. |
| F5 | Journey flakiness (dev boot) | — | documented env limits | HD | OPEN (lead) | = D17. |

---

## SECTION 4 — THE LEAD'S RECON (production @ 3304b65) — C's independent reproduction

| # | feature | lead's claim (production) | C's reproduction (local fixtures boot @ 3304b65) | class | status | verdict notes |
|---|---|---|---|---|---|---|
| L1 | fonts declared-not-loaded | document.fonts EMPTY of Roboto; OS fallback | **FIXED on B-lane 1d32ed8** — FontFaceSet carries Roboto ×2 (self-hosted variable woff2), faces loaded; ladder roles conformant (C reproduced both boots) | OB | **VERIFIED** | = O5 (fonts half). |
| L2 | 3-click play (card → /item → Play → player) | measured on production | **FIXED on B-lane 1d32ed8** — card → `/player` directly, 1 action, iframe `autoplay=1&mute=1` + unmute affordance (C reproduced both boots) | OB | **VERIFIED** | = O2. |
| L3 | home = 1184px hero + "What your feed shows" above grid | measured 1184 | **FIXED on B-lane 1d32ed8** — hero = null, feed-config false on home (C reproduced both boots; = N5/N6) | OB | **VERIFIED** | = O6 driver + O7 rows N5/N6. |
| L4 | share = "Copy WebFlix link" button | observed | **REPRODUCED** — details popup, 1 button, raw param-laden path, player page has none | OB | OPEN | = O4. |
| L5 | comments absent | observed | **REPRODUCED** — 0 comment surfaces anywhere | OB | OPEN | = O3. |
| L6 | hover preview absent | observed | **REPRODUCED** — 3.6s dwell, 0 media, empty preview scaffolding | OB | OPEN | = O1. |
| L7 | dark body #0f0f0f token-correct | measured | **REPRODUCED** + nuance: field composition 47% elevated gray (pixel survey) | OB | OPEN | Token ✓, field ✗ → O6. |

---

## SECTION 5 — Worker A's corpus (lane `wfx/r28/corpus` @ **25ba5e7 — COMPLETE, 12 sheets**)

**Status: A finished 2026-09-24 at 25ba5e7** — all 12 sheets landed
(hover-preview · click-to-play · fonts · color-survey · comments-anatomy ·
share-dialog · home-anatomy · watch-page-anatomy · search-anatomy ·
shorts-anatomy · logged-in-surfaces · FEATURE-INVENTORY). C verified all 10
sheets previously cited are byte-identical at the corpus head, so every
`corpus: A@<sha>` citation in this matrix stands. The logged-in family is
**CORPUS-PENDING per the lead's ruling** — cite
`docs/parity-lab/r28/lead-captures/README.md` on `wfx/r28/lead-captures`
@ **0755a38** (the operator's logged-in tab, honest partial record; do NOT
retry login or fight YouTube's risk gate; account-chrome must not be built
from memory beyond the lead-recorded grammar).

| # | feature | YouTube behavior (A's sheet) | WebFlix state | class | status | verdict notes |
|---|---|---|---|---|---|---|
| N1 | Mic button anatomy | **corpus: A@f3dc4ba core.json** — 40×40, radius 100px, bg `rgba(0,0,0,0.05)` (light) | Absent | PAR | OPEN | = D3. Anatomy now fully specified by A. |
| N2 | Notifications bell anatomy | **corpus: A@25ba5e7 `youtube/logged-in-surfaces.md` (CORPUS-PENDING)** — logged-in-only chrome; lead healthy-window record: count surfaces in the document title ("(94) YouTube"); avatar cluster rightmost in masthead; bell anatomy NOT measured (next healthy window; see lead-captures README @ 0755a38) | Absent | PAR | OPEN | = D4. Per the lead ruling: B must NOT build account chrome from memory beyond the lead-recorded grammar — the bell ships only behind honest sign-in chrome, and its exact anatomy waits for the pending capture. |
| N3 | Search result row anatomy | **corpus: A@f3dc4ba search.json** — row **1152×281**; thumb **500×281 radius 12px**, img 720×404 object-fit cover; title **18px/400/26px** #0f0f0f clamp 2; meta 12px/400/18px #606060; channel name 12px/400 #606060; avatar **24×24**; snippet 12px/18px clamp 2; live badge | C's live measure: `.wfx-result__thumb` = **360×202** (R27 spec) vs A's YouTube 500×281 — row geometry delta confirmed. `evidence/r28-recon/baseline/search-rows.dark.png` | PAR | OPEN | The R27 corpus sheet (360×202) was a different capture; A's live 1440 measure is 500×281 — B's search rows must be re-verified at these dims. |
| N4 | Rail duplicate History | single entry | History ×2 | COS | OPEN | = D8. |
| N5 | Home hero ("Featured" panel) | **corpus: A@7aa0e94 `youtube/home-anatomy.md`** — **NO hero banner, NO feed-config section** — masthead → chip bar → grid immediately (confirmed on every populated sibling surface) | **FIXED by B@1d32ed8** — C reproduced (both boots): hero = **null** (the `section[aria-label^="Featured"]`/[class*=hero] element no longer exists); home = chips → card rows. `b1-1d32ed8-{fixtures,service}.capture.json` + `-home.png` | OB | **VERIFIED (B-lane 1d32ed8)** | The structural home divergence is gone; hero moved to Settings→General per B's commit. |
| N6 | Feed-config panel above grid ("What your feed shows" / For you / …) | **corpus: A@7aa0e94 home-anatomy.md** — no feed-config stack; personalization is the chip bar | **FIXED by B@1d32ed8** — C reproduced (both boots): `feedConfigText: false`; the radios/Manage-feeds/Personalize line are gone from home (moved to Settings→General). `b1-1d32ed8-*` | OB | **VERIFIED (B-lane 1d32ed8)** | With N5, the two structural walls between masthead and grid are gone. |
| N7 | Real artwork in feed | real thumbnails | gradient placeholders | OB | OPEN | = D15. |
| N8 | Share control placement + anatomy | watch action row carries Share; modal with socials + embed + start-at | Share `<details>` popup present on `/item` AND `/player` (corrected); 2 controls, no embed/start-at/socials | OB | OPEN | = O4. |
| N9 | Like/dislike + action row (watch) | **corpus: A@7aa0e94 watch-page-anatomy.md** — action row: like/dislike **split pill** (segmented, 36–40px, r18–20), Share pill, Download, Save, overflow kebab "More actions" (row w≈690 h42); channel row: avatar 36–40 circular + name bold 14–16 + sub count 12 + **Subscribe pill h≈36 r18 red #f03-family**; description collapsed 1–2 lines + "...more" inline expander 14px/400 | "Like: not available on this source" text only; no split pills, no Download, no description expander, no subscribe CTA | PAR | OPEN | The action row + channel row + description are the watch page's second act — all absent on WebFlix. |
| N10 | Description panel | corpus: description panel 14px/20px below actions | Absent on /player (no description block) | PAR | OPEN | Corpus-carried; operator-visible. |
| N11 | Comments anatomy (headers/threads) | **corpus: A@f3dc4ba cssmined.json** — `ytd-comments-header-renderer` margin-top 24px / margin-bottom 32px; `ytd-comment-thread-renderer` margin-bottom 16px | 0 comment elements anywhere | OB | OPEN | = O3. A's css-mined live rules give the exact spacing contract. |
| N12 | Sign-in button (right cluster) | **corpus: A@f3dc4ba core.json** — 40px height, radius 20px, color `#065fd4`, 14px/500, border 1px rgba(0,0,0,0.2) | "Signed out" + avatar badge (no CTA button) | PAR | OPEN | Operator-visible chrome delta; the anatomy is specified. |
| N13 | Rail geometry + items | **corpus: A@7aa0e94 home-anatomy.md** — drawer 240px; items 40h r10, 14/400/20; full grammar: Home · Shorts · Subscriptions · You · History → Explore (Music · Movies · Live) → More from YouTube (Premium · YT Music · YT Kids) → footer links + location chip + sign-in promo in open guide | Rail 240px ✓ item-height ~40 ✓; item set differs (Watch/Offline/Settings, no Explore/More-from-YT/footer links); duplicate History | PAR | OPEN | The item-set delta is the known honest mapping (D6); Explore/footer sections are addable parity. |
| N14 | Chips anatomy (feed filters) | **corpus: A@298fa55 color-survey.md** — chip h **32px** r **8px** padding 0 12, text 14px/500; active = **inverted pair** bg #0f0f0f/text #f1f1f1 (light) — dark inverts; inactive bg rgba(0,0,0,0.05) | **CONFORMANT (re-measured on B@1d32ed8, both modes)**: h **32** r **8** pad **0 12** text **14px/500** ✓; active dark-mode pair measured **bg #f1f1f1 / text #0f0f0f** (the dark-mode inversion — exact corpus match), inactive bg **#272727**/text #f1f1f1 ✓. Geometry identical on main (baseline-seed corpus) — the inversion pair is now measured too. `b1-1d32ed8-spec.json` | PAR | **VERIFIED — conformant (re-measure)** | The signature YouTube chip look is present. Chips found: All/short (+movie/series in fixtures). |
| N15 | Theme default + mechanism | **corpus: A@298fa55 color-survey.md** — logged-out default **LIGHT**; `html[dark]` attribute mechanism; gear▸Appearance switch; device-pref ignored logged-out | WebFlix boots **DARK** by default, media-query/JS toggle | OB | OPEN | Operator's "theme is not the same" — the DEFAULT differs. YouTube fresh-session = light. |
| N16 | Duration pill alpha | **corpus: A@298fa55** — `rgba(0,0,0,0.6)` bg (R27's 0.8 superseded) | WebFlix duration pill: needs computed check on B's build (R27 token sheet carried 0.8) | COS | OPEN | Current-build value is 0.6; drift class cosmetic. |
| N17 | Dialog/popup anatomy | **corpus: A@298fa55 color-survey.md** — dialog bg #ffffff, radius **12px**, shadow `rgba(0,0,0,0.15) 0 0 24px 12px`; dark raised #282727-family (R27 ref) | WebFlix share = `<details>` inline popup, not a raised dialog; filters/settings popups need geometry check | PAR | OPEN | The share modal (O4) and settings popups should adopt the dialog anatomy. |
| N18 | Card 3-dot "More actions" menu | **corpus: A@4b1bc77 share-dialog.md** — 40×40 bottom-right of card meta; items: Add to queue, Save to playlist, Download, Share | WebFlix cards carry inline Queue/Save buttons (no 3-dot menu; actions exposed inline) | PAR | OPEN | YouTube hides actions behind the 3-dot; WebFlix exposes them inline — a look-and-density difference. |
| N19 | Card grid geometry | **corpus: A@7aa0e94 home-anatomy.md** — home grid 4 cols @≥1300 (R27); channel surface 3 cols @1440: card **347×~251**, gutter **16px**, row pitch ~306; thumb **r12 16:9**; duration badge **8px inset**, `rgba(0,0,0,0.6)` bg, 12/500, r4, pad 1px 4px; title **16px/500** 2-line clamp (style the anchor, not the h3); meta 12px #606060 + channel row (avatar 36 + name) on home variant; ~30 initial items + infinite scroll; FEATURE-INVENTORY adds **watched-progress overlay** (resume bar on watched cards — [P] CORPUS-PENDING pixels) | B@1d32ed8 (fixtures): card **288×312**, thumb **288×162 r12 16:9 ✓**; title **16/500** ✓, meta **12/400** ✓; duration present BUT as a **type+duration text pill ("short45s" / "video10h 0m")**, not the YT corner badge (`0:45` 12/500 r4 0.6-alpha 8px-inset) — the measured "pill" was 49×43 14/400 transparent (a meta element, not the corner badge). `b1-1d32ed8-{fixtures,service}.corpus.json` + `-spec.json` | PAR | OPEN (geometry largely conformant; badge grammar diverges) | Card box 288 vs corpus 347 (3-col @1440 channel surface — home-grid variant differs; near-parity class). The duration-badge grammar (format + styling) is the remaining measurable delta. Watched-progress overlay is corpus-pending — not a B ask until pixels land. |
| N20 | Shorts shelf card | **corpus: A@7aa0e94 home-anatomy.md** — `ytm-shorts-lockup-view-model` **208×387 card, 208×311 (9:16) thumb**, ~4px gutters, 5–6 columns in 1152 width, title below, no duration badge | WebFlix shorts surface exists (stage with content, 1/3 counter) — shelf-on-home card grammar needs B-side check | PAR | OPEN | The shelf interleaving on home is YouTube's rhythm; WebFlix home has no shorts shelf. |
| N21 | Watch two-column geometry | **corpus: A@7aa0e94 watch-page-anatomy.md** — page margins **16px sides @1440** (player x=16); player **996×560 @(16,68)** below 56px masthead; primary 1012; secondary **412 @x1028, 16px gutter**; below player: title → info/actions → description → comments; flexy theater/fullscreen/miniplayer states | C measured: `.wfx-player__layout` 724px+412px gap 16px (rail-open); `.wfx-player` padding **24px** (corpus 16px); player is an iframe stage, not a 16:9 996×560 box | PAR | OPEN | D14 re-confirmed: A measured page margins 16px — the `.wfx-player` 24px padding is a live drift on main. |
| N22 | Related/up-next column | **corpus: A@7aa0e94 watch-page-anatomy.md** — `ytd-compact-video-renderer` rows: thumb **168×94** left, title 14px/500 2-line + channel + meta right, **4px gap**; autoplay toggle row with paper switch at section head; hover row → preview singleton | WebFlix has "Up next" + "More to explore" (cards with 168px-class thumbs per R27 harness) + Autoplay checkbox — re-verify row pitch/toggle grammar on B's build | PAR | OPEN | Closest-to-parity surface already; the paper-switch toggle + 4px pitch are the refinements. |
| N23 | Search filters dialog | **corpus: A@25ba5e7 search-anatomy.md** — Filters button → **696×518** dialog r12 + shadow; groups TYPE/DURATION/UPLOAD DATE/FEATURES/PRIORITIZE; query-contextual chips (All, Shorts, Unwatched, Watched, Videos, Recently uploaded, Live) | WebFlix search has no filters dialog, no chips row | PAR | OPEN | A full 5-group dialog contract; B can build type/duration honestly. |
| N24 | Settings gear menu (masthead) | **corpus: A@25ba5e7 FEATURE-INVENTORY.md** — multi-page menu: Your data / Appearance (Light↔Dark) / Display language / Restricted Mode / Location / Keyboard shortcuts / Settings / Help / Send feedback | WebFlix has no masthead settings gear (theme toggle button instead) | PAR | OPEN | The gear menu is YouTube's theme path (N15). B's theme toggle ≠ the Appearance menu. |
| N25 | Player keyboard transport | **corpus: A@25ba5e7 FEATURE-INVENTORY.md** — k space j l m f t i arrows 0-9 c (labels carry hints, e.g. `Play (k)`); mode grammar: **theater (t) → 1296px full-content-width player**, **miniplayer (i) → bottom-right floating persistent player**, captions (c) menu | Labels `Play (k)` + `Fullscreen (f)` + `Theater view (t)` + `Mute (m)` exist. C's key probe on B@1d32ed8 (service boot): **`m` VERIFIED** (label flips Mute↔Unmute — the postMessage control channel round-trips); **`k` UNVERIFIED** (no chrome change; play-state label tracking unclear — iframe-internal state unobservable); j/l/f/t/i/arrows/0-9/c untested. `b1-1d32ed8-keyboard-probe.md` | PAR | OPEN (partial: m verified) | The channel is proven; the play-state label tracking and the full key set remain to verify (honestly: k's silence is ambiguous, not a confirmed failure). Theater/miniplayer mode geometry (1296px / floating bottom-right) is FEATURE-INVENTORY [d] grammar — B-side state to check if B ships the keys. |
| N26 | Toast/snackbar family | **corpus: A@25ba5e7 FEATURE-INVENTORY.md** — `yt-snackbar` transient feedback ~4s (R27) | WebFlix has a toast surface (R27 grammar) — Copy action currently gives no "copied" toast | PAR | OPEN | O4's Copy→toast is the concrete case. |
| N27 | Shorts vertical shell | **corpus: A@25ba5e7 shorts-anatomy.md** — `/shorts/<id>` route; reel renderer + #shorts-player; shell controls Play CTA / Close / More / playlist / watch-later / nav arrows; action rail (like/dislike/comments-count/share/more) + audio toggle + inline title/@channel/Subscribe — CORPUS-PENDING pixels | WebFlix shorts surface: stage + speed menu + swipe hints + "1 / 3" counter; no action rail, no audio toggle | PAR | OPEN | Shell grammar partially there; the action rail + audio toggle are the parity deltas. |
| N28 | PWA install prompt on home | YouTube: no install prompt on the home field (app-install lives in the 3-dot browser chrome, never in-page) | **C@1d32ed8 (VLM sighting, service home)**: "Install WebFlix" PWA prompt bottom-right of the home viewport — in-page install chrome YouTube never shows. `b1-1d32ed8-vlm-home.json` | COS | OPEN | New row (O7 "on and on"): real WebFlix capability honestly exposed, but in-page placement is operator-visible non-YouTube chrome. B candidate: move to settings/menu surface. |

---

## SCOREBOARD

| measure | count |
|---|---|
|  Total rows | 7 (operator) + 21 (R27 divergences) + 5 (lead follow-ups) + 7 (lead recon reproductions) + 28 (corpus + C-found rows) = **68** (N28 added 2026-09-24) |
| OPERATOR-BLOCKING (OB) | **22** (machine-counted: class-cell census; corrects the seed's "20" — the seed counter evidently deduped the L-mirror rows; this count is reproducible: O1–O7 · D9 · D15 · L1–L7 · N5 · N6 · N7 · N8 · N11 · N15) |
| PARITY (PAR) | **26** |
| COSMETIC (COS) | **6** (N28 added) |
| HONEST-DIVERGENCE (HD) | **10** |
| class `—` (closed-by-corpus, seed rows) | **4** (D5, D18, D20, F1) |
| WONT-FIX honest | **7** (machine-counted: D1, D2, D7, D10, D12, D19, D21 — corrects the seed's "9") |
| CLOSED on base | **5** (the 4 `—` rows + the share-placement correction) |
| VERIFIED (green) | **8** — O2, O5 (fonts half), N5, N6, N14 (conformant re-measure) + recon mirrors L1/L2/L3 |

**The red core after wave 1 (B@1d32ed8):** hover preview still mounts nothing
(O1), comments still 0 everywhere (O3), share is still the 2-button details
popup (O4), the app still boots dark where YouTube logged-out boots light
(O6/N15). The click-count, the fonts, and the hero/config wall are GREEN with
evidence.

---

## Verification log (chronological; every B claim gets a row)

| when | B claim | C's check | verdict |
|---|---|---|---|
| seed | — | baseline observation of `main @ 3304b65` complete (BASELINE-OBSERVATION.md) | n/a |
| 2026-09-24 resumption | (platform incident wiped C's sandbox; lane restored from `wfx/r28/recon` @ e28b64a) | `resumption-calib.report.json` — the fresh sandbox reproduces the recorded baseline exactly (hero 1200×775, robotoLoaded false, actionsToPlay 3, bodyBg #0f0f0f) | environment OK — no rework |
| B@5c4c28c | repro of the operator's 7 complaints on B's service-mode dev boot (`evidence/r28-web/repro/`, port 3000, WFX_API_BASE → production) | cross-checked against C's recorded baseline (independent boots: C fixtures-mode @3101, B service-mode @3000) — same 7 states: 3-click trace (B adds: 3rd click lands inside the YouTube embed iframe — no autoplay param), 0 hover media, Geist-only fonts, hero+config home, 0 comments, `<details>` share | **consistent — B's repro CONFIRMED**; no fix claims yet, nothing to verify |
| B@1d32ed8 | wave 1: fonts (self-hosted Roboto variable 400/500/700) + ONE-CLICK PLAY (card→player autoplay+muted-unmute; /item demoted to Details) + HOME RESTRUCTURE (chip bar + rows immediately; hero + feed config → Settings→General) | **ROUND 1+2 (fixtures @3101 + service @3101, harness + capture + spec checks, 15 PNGs)**: actionsToPlay **1** ✓ (card href → /player direct, no /item interstitial); iframe `autoplay=1&mute=1` + "Sound off — tap to unmute" + Mute(m) ✓; FontFaceSet Roboto ×2 loaded (self-hosted woff2, YT Sans not shipped) ✓; card title 16/500 + meta 12/400 ✓; hero **null** ✓; feedConfigText **false** ✓; chips h32/r8/14-500/0 12 + dark inverted pair #f1f1f1/#0f0f0f (exact corpus) ✓; duration present as type+duration text pill ("short45s" — grammar diverges from YT 0:45 corner badge) ✗; nav=navigate full reload (corpus SPA law) ✗ residual | **O2 VERIFIED · O5 fonts-half VERIFIED · N5 VERIFIED · N6 VERIFIED · N14 VERIFIED (re-measure) · L1/L2/L3 VERIFIED** — evidence: `b1-1d32ed8-{fixtures,service,spec}` |
| 2026-09-24 (resumption 2) | — (corpus event, not a B claim) | A's corpus verified COMPLETE @ 25ba5e7: all 10 previously-cited sheets byte-identical at head (citations stand); the 11th sheet (logged-in-surfaces.md) integrated — N2/D6 extended with the lead healthy-window record, lead-captures README citation added per the ruling; FEATURE-INVENTORY grammar extras folded into N19/N25 (watched-progress overlay [P]; theater 1296px + miniplayer bottom-right [d]) | corpus integrated — matrix current with all 12 sheets |
