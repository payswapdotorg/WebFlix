# R29 RECONCILIATION MATRIX — the second-order wave's FINAL scoreboard

**Lane:** `wfx/r29/recon` · **Base:** `origin/main @ ab49392`
**Maintainer:** Worker C (the reconciler). B's claim is a hypothesis until C verifies.
**Doctrine (R28, unchanged):** an unverified fix is a RED row, never green; a silent
pass is worse than a loud fail; every verdict cites evidence. **Lineage:** this matrix
CONTINUES the R28 row numbering (`docs/parity-lab/r28/reconciliation/MATRIX.md` @
main — the O/D/N/F/L families; the R29 wave works the second-order rows the R28
scoreboard left red, plus the R28-token carry-overs D16/F4 and N16 B closed in Stage 5).

**Legend — gap class:** `OB` = OPERATOR-BLOCKING · `PAR` = PARITY · `COS` = COSMETIC ·
`HD` = HONEST-DIVERGENCE. **Fix status:** `OPEN` (red) · `VERIFIED` (green — C
reproduced the fix) · `WONT-FIX honest`.

**Corpus citations:** A's R28 sheets @ the corpus head (per-sheet SHAs as cited in
the R28 matrix) — watch-page-anatomy.md, search-anatomy.md, FEATURE-INVENTORY.md,
home-anatomy.md, color-survey.md, shorts-anatomy.md, comments-anatomy.md,
hover-preview.md, share-dialog.md, fonts.md, logged-in-surfaces.md, design-tokens.md.
WebFlix values cite C's own measurements (`evidence/r29-recon/` reports).

**Baseline:** `docs/parity-lab/r29/reconciliation/BASELINE-OBSERVATION.md` — every
row below was confirmed LIVE on the base (both boots) before the loop began.
**B's truth source:** lane `wfx/r29/web` — the full arc landed in five stages:
`7ade74e` → `c6f21c8` (Stage 1, verified earlier) → `bcd8120` (Stage 2) →
`01dc579` (Stage 3) → `b852d977` (Stage 4) → `d92f5ff` (Stage 5 + the final
report). **C verified EVERY stage head in BOTH boots** (fixtures + service; the
final head ran the full instrument). The verified lane head is **`d92f5ff`**.

---

## SECTION 1 — THE SECOND-ORDER RED SET (the R28 scoreboard's carry-over, re-baselined @ ab49392; every row verdicted at the final head d92f5ff unless noted)

| # | feature | YouTube behavior (corpus citation) | WebFlix state (C's measurement) | class | status | verdict notes |
|---|---|---|---|---|---|---|
| D8/N4 | Rail duplicate History | corpus home-anatomy: single History entry | **FIXED + VERIFIED @ b852d977** (both boots; re-verified @ d92f5ff): `historyCount=1`, the entry's href `/library?section=history` — `b-{b852d977,d92f5ff}-{fixtures,service}.s4probe.json → rail.historyCount/historyHref` (baseline ×2; main re-confirmed ×2 in the `main-ref-*` rounds) | COS | **VERIFIED (B-lane b852d977)** | The duplicate top-level entry removed. |
| D14/F3 | `.wfx-player` padding | corpus watch-geometry: **16px** @1440 (player @(16,68)); 24px @≥1600 | **FIXED + VERIFIED @ c6f21c8** (both boots; re-verified at every later head through d92f5ff): `playerPadding "12px 0px 48px 16px"` @1440 — 12px top gap (y=68 below the 56px masthead), 16px left, right 0 (the ≥1016 flush-right law); `@≥1600: "24px 24px 48px"` + playerX 24 — `b-d92f5ff-*.{r29probe,s1probe}.json → watchGeometry/geometry1600` | PAR | **VERIFIED (B-lane c6f21c8)** | The corpus two-band law + the top gap reproduced byte-exact. |
| N21 | Watch two-column geometry | corpus watch-page-anatomy: page margins 16px @1440; player **996×560 @(16,68)**; primary 1012; secondary **412 @x1028**, 16px gutter; rail CLOSED on watch | **FIXED + VERIFIED @ c6f21c8** (both boots; re-verified through d92f5ff): rail `display:none` on watch; **stagewrap 996×560 @(16,68) — BYTE-EXACT**; `layoutCols 996px 412px` gap 16px; secondary 412 @x1028 flush-right; the hamburger opens the 240×844 overlay drawer — `b-d92f5ff-*.s1probe.json → watchRouteGeometry/hiddenGuideDrawer` | PAR | **VERIFIED (B-lane c6f21c8)** | Baseline: 724×407 @(264,80) with the rail open. |
| N9-a | Watch action row: like/dislike split pill | corpus watch-page-anatomy: segmented split pill 36–40px r18–20 + Share + Download + Save + "More actions" kebab (row w≈690 h42) | **FIXED + VERIFIED @ c6f21c8** (verified at 7ade74e; re-verified at c6f21c8, bcd8120, 01dc579, b852d977, d92f5ff — both boots): split pill **111×40 r20** segmented with divider; Share + Save + kebab; **Download honestly absent** (probe null, VLM confirms); kebab rows real writes (Add-to-queue → the session queue); rowBox 345×40 (content-sum note vs the corpus 690 label-sum — the honest consequence of Download-absent) — `b-d92f5ff-*-s1.s1probe.json → actionRow` | PAR | **VERIFIED (B-lane c6f21c8)** | **HONESTY GATE PASSED** — see N9-a-h. |
| N9-a-h | Reactions local transport (honesty gate) | corpus: counts are real engagement; a dislike never renders a count | **VERIFIED @ c6f21c8; RE-VERIFIED @ d92f5ff (service)**: fresh → no count; like → "1" + `wfx-reactions-v1`; toggle-off; dislike → **`anyCountInRow=[]`** + store flips; like again → mutual exclusion — `b-d92f5ff-service-s1.s1probe.json → reactionsLike/…Dislike/…MutualExclusion` | HD | **VERIFIED (B-lane c6f21c8 → d92f5ff)** | The R28 comments law applied to reactions: only real local actions, never fabricated counts. |
| N9-b/D11 | Channel row + Subscribe pill | corpus watch-page-anatomy: avatar 36–40 circular + name bold 14–16 + sub count 12 + **Subscribe h≈36 r18 red #f03-family** | **FIXED + VERIFIED @ c6f21c8** (re-verified at every later head; final-head service): avatar **40×40 r50%**; name 16px/500 = **the sources model's own displayName** (service: the connector id, the model's honest fallback); **sub-count honestly absent**; Subscribe pill **95×36 r18 bg rgb(255,0,51)** — the corpus red family EXACT; **the click is a REAL write**: `POST /api/library {op:save, listName:"Subscriptions"}` → `{ok:true, sync:"synced"}` — and **the Library page renders the Subscriptions named list with the subscribed item** (final head: `subsFound=true`, entry "1 HOUR Rainy Day in Airport ✈️…") — `b-d92f5ff-service-s1.s1probe.json → subscribeClick/librarySubscriptions` | PAR | **VERIFIED (B-lane c6f21c8, with divergence 7)** | **HONESTY GATE PASSED at the seam** — the real library write + the visible Library list (service boot). The dev-boot reload-state split is divergence 7 (environment, pre-existing). |
| N9-c | Description "...more" inline expander | corpus watch-page-anatomy: collapsed 1–2 lines + "...more" inline expander 14px/400; expands inline (no dialog) | **UPGRADED + VERIFIED @ c6f21c8** (re-verified through d92f5ff): collapsed 2-line clamp + the "...more" BUTTON; click → expands INLINE (no dialog); "Show less" toggle — `b-d92f5ff-*-s1.s1probe.json → description/descriptionExpanded` | PAR | **VERIFIED (B-lane c6f21c8)** | Both states in the DOM (the SSR contract). |
| N22 | Related/up-next column | corpus watch-page-anatomy: compact rows thumb **168×94** left, title 14/500 2-line, **4px gap**; autoplay paper-switch at section head; hover → preview singleton | **FIXED + VERIFIED @ c6f21c8** (re-verified through d92f5ff): "Up next" + the Autoplay paper-switch BEFORE the list (real policy write via `/api/queue`); compact rows 168×95, title 14px/500 clamp-2, **row pitch 4px**; one-click `/player` hrefs; the dwell preview singleton MOUNTS on hover (the provider's real embed; honest content) — `b-d92f5ff-*-s1.s1probe.json → relatedColumn/autoplayToggle/dwellPreview*` | PAR | **VERIFIED (B-lane c6f21c8)** | Baseline: checkbox autoplay + card-class rows. |
| N3 | Search result row geometry | corpus search-anatomy: row **1152×281**, thumb **500×281** r12, title 18/400/26 clamp-2, meta 12/400/18, channel avatar **24×24** | **FIXED + VERIFIED @ bcd8120** (both boots; re-verified @ d92f5ff service + fixtures): row **1152×281** — BYTE-EXACT; thumb **500×281 r12**; title **18/400/26 clamp-2**; meta line **12/400/18 rgb(96,96,96)**; avatar **24×24 r50% monogram** (the connector-initial — no channel photos on this host, never fabricated); channel name 12/400 — `b-d92f5ff-service.s2probe.json → rowAnatomy` | PAR | **VERIFIED (B-lane bcd8120)** | Baseline: 1096×248, thumb 360×202. Every corpus value byte-exact. |
| N23 | Search chips + the filters dialog | corpus search-anatomy: contextual chips bar; **Filters → 696×518 dialog r12**, shadow `rgba(0,0,0,0.15) 0 0 24px 12px`, title "Search filters", 5 groups TYPE/DURATION/UPLOAD DATE/FEATURES/PRIORITIZE | **FIXED + VERIFIED @ bcd8120** (both boots; re-verified @ d92f5ff): chips **only the types really present** (service q=the: All/Videos/Shorts; no Unwatched/Watched/Live — honest); the dialog: **696px wide, r12, bg #fff, shadow `rgba(0, 0, 0, 0.15) 0px 0px 24px 12px` — BYTE-EXACT**, title "Search filters", X close 40×40 circular; **TYPE + DURATION honestly wired** as real link-options over the real result set; **UPLOAD DATE/FEATURES/PRIORITIZE honestly absent, named in-dialog**; the state is the URL: `?q=the&type=video`→7, `&type=short`→10, `&type=bogus`→17 (invalid ignored, never guessed); durations on real data: `under-3`→1, `3-20`→0 → the honest **"Nothing matches this filter"** filtered-empty, `over-20`→6 + "(filtered)"; `q=lofi` (no durations) → every bucket honestly empty; the no-matches state keeps its own different truth; the dialog X closes — `b-d92f5ff-service.s2probe.json → chips/filtersDialog/urlState/wiring` | PAR | **VERIFIED (B-lane bcd8120)** | **HONESTY GATE PASSED**: every control a real filter over the real set (server-rendered presentation filter, shareable URL state); the unsupported groups honestly absent + named. Dialog height 308 vs corpus 518 = the honest 2-group content-sum (5 groups would fabricate 3). |
| N24 | Masthead settings gear menu | corpus FEATURE-INVENTORY: gear → multi-page menu (Your data / Appearance / Display language / Restricted Mode / Location / Keyboard shortcuts / Settings / Help / Send feedback) | **FIXED + VERIFIED @ 01dc579** (both boots; re-verified @ d92f5ff): the gear opens the corpus paper-menu family (r12, the corpus dialog shadow); **root rows: Your data → `/settings?section=general` (real href), Appearance› (subpage), Keyboard shortcuts› (subpage), Settings → `/settings` (real href)**; the Appearance subpage: Dark/Light rows (aria-checked radio semantics) — **the LIVE theme seam** (click Light → `data-theme` + persisted `wfx-theme` + **theme-color meta #ffffff** + body bg all flip together; Dark reverts); the Shortcuts subpage: the real key sheet (11 rows — Space/K, J/L, ←/→, ↑/↓, 0–9, M, F, T, I, C, ?); **Display language / Restricted Mode / Location / Help / Send feedback honestly absent — ALL FIVE named by the menu's own absence note**; the R28 ThemeToggle retired (probe: `[data-wfx-theme-toggle]` absent, the old aria-labels absent) — `b-d92f5ff-*.s3probe.json → gear.root/appearance*/shortcuts/retiredThemeToggle` | PAR | **VERIFIED (B-lane 01dc579)** | **HONESTY GATE PASSED**: every shipped row real (hrefs + live subpages), every unbacked row honestly named. |
| N12 | Sign-in pill (masthead right) | corpus FEATURE-INVENTORY/color-survey: **40h r20, #065fd4, 14/500, border 1px rgba(0,0,0,0.2)** | **FIXED + VERIFIED @ 01dc579** (both boots; re-verified @ d92f5ff): **101×40, r20, bg rgb(6,95,212), 14px/500, border 1px solid rgba(0,0,0,0.2), the person mark, white ink — EVERY VALUE BYTE-EXACT**; wired to the REAL identity path (`/settings?section=general` — the SessionControls surface over the completed identity transport) — `b-d92f5ff-*.s3probe.json → signinPill` | PAR | **VERIFIED (B-lane 01dc579)** | Baseline: the "W Signed out" badge 175×40 r18 #f2f2f2. |
| N25-a | Player keyboard set | corpus FEATURE-INVENTORY/watch-page-anatomy: k space j l m f t i arrows 0-9 c ? | **FIXED + VERIFIED @ 01dc579** (both boots; re-verified @ d92f5ff — the per-key instrumented set): **m** → the label flips `Mute (m)`↔`Unmute (m)` + volume 0 (service, the provider-acked cluster); **↑/↓** → the volume slider steps 1 → 0.9 with Mute↔Unmute acks; **f** → `document.fullscreenElement` = the stagewrap; **t** → the 1296 theater (see N25-b); **i** → the full dock flow (see N25-c); **?** → the keyboard sheet opens (`[data-wfx-chrome-keyboard-sheet] open`, the full row set); **k/space/j/l/←/→/0–9** → **ALL round-trip `POST /api/playback` 200 with correct command payloads** (play; seeks: j 0, l +10000, ← −5000, → +5000, 5 → 22500 = 50%×45s duration — the deltas exact), the visible play-state display stays honestly evidence-gated (the provider's stream never loads in this sandbox — never a fabricated playing state); **c honestly gated** (the control renders only with a real transcript; none on this host) — `b-d92f5ff-*.s3probe.json → keyboard.*` (the fetch-instrumented per-key table) | PAR | **VERIFIED (B-lane 01dc579)** | The R28 k-ambiguity closed the honest way: the command path is proven live, the display gates on the provider's own broadcasts (B's per-key evidence table `stage3-keyboard-perkey.md` reproduced check-for-check). |
| N25-b | Theater mode geometry | corpus watch-page-anatomy: theater → player **1296px full-content-width** | **FIXED + VERIFIED @ 01dc579** (both boots; re-verified @ d92f5ff): press `t` → **stagewrap 1296×729 @(72,68) — BYTE-EXACT**, viewport-centered (gutters 72/72), `theaterClass` on, `layoutCols 1424px`; second `t` reverts to 996×560 @(16,68) — `b-d92f5ff-*.s3probe.json → theater.before/after/reverted` | PAR | **VERIFIED (B-lane 01dc579)** | THE STANDING DIVERGENCE CLOSED: the pre-R29 1440px full-viewport bleed is gone; the corpus 1296 content-width re-anchor reproduced in both boots. |
| N25-c | Miniplayer mode | corpus watch-page-anatomy: "i" → **bottom-right floating player, persistent across navigation** (in-app) | **FIXED + VERIFIED @ 01dc579** (both boots; re-verified @ d92f5ff): the Document-PiP stand-in retired; the in-app **MiniplayerDock** — press `i` (or the chrome control) stores `{href, title, positionMs}` in sessionStorage + navigates to the browse surface; the dock renders **bottom-right @16/16, 400×262 (the 400px stage + the 36px title row), the compact iframe `/player?…&miniplayer=1` (398×224)**; **persists across / and /search**; **the ~3s position-write seam is LIVE** (C overrode the stored position to 777; the compact player rewrote it to the real session position within ~3s — the mechanism proven, not asserted); **Expand** → the full player surface (no double player); **the REPLACE rule** (a different item on the main stage clears the entry — probed); **the SUPPRESSION law** (the same item's player page keeps the entry but never renders the dock); **Close** clears both; the compact doc carries `Expand (i)` and no shell/theater — `b-d92f5ff-*.s3probe.json → miniplayer.*` | PAR | **VERIFIED (B-lane 01dc579)** | **HONESTY GATE PASSED**: a REAL persistent mode (geometry + navigation-persistence + the live position seam), honestly documented as the MPA mechanism (the iframe re-mounts per page, resuming from the real reported position — never claimed as an SPA transplant). |
| N19 | Duration badge grammar | corpus home-anatomy/search-anatomy: ONE corner badge bottom-right **8px inset** — 12/500 `#fff` on **rgba(0,0,0,0.6)**, r4, pad **1px 4px**, m:ss/h:mm:ss | **FIXED + VERIFIED @ b852d977** (both boots; re-verified @ d92f5ff): the corner badge **`12px/500, color rgb(255,255,255), bg rgba(0,0,0,0.6), radius 4px, padding 1px 4px, inset right 8 bottom 8 — EVERY VALUE BYTE-EXACT**; format m:ss/h:mm:ss ("0:45", "10:00:02", "48:06" measured); **the visible type badge GONE** (0 across 41 home badges + the search rows; the type stays in the aria-label `"Neon Rain (short, 0:45)"` + the chip-filter seam + the detail meta); the search variant's badge inside the 500×281 thumb ("2:30:27" @ 8/8 — B's exact live measure reproduced); **the shorts variant never carries a badge** (the variant gate) — `b-d92f5ff-*.s4probe.json → badge*`, `b-b852d977-service-searchbadge.json` | PAR | **VERIFIED (B-lane b852d977)** | Baseline: "short45s" text pill + the stacked 0.8-alpha type badge. The R28-era floor check `cards.badgePresent` newly-red at d92f5ff = the card[0] assumption meeting the duration-conditional grammar (41 badges render on duration-bearing cards) — an instrument note, not a regression (see divergences 11). |
| N20 | Shorts shelf on home | corpus home-anatomy/shorts-anatomy: shelf with **208×387 cards (208×311 9:16 thumbs), ~4px gutters, 5–6 cols**, title below, no badge | **FIXED + VERIFIED @ b852d977** (both boots; re-verified @ d92f5ff service): the shelf `data-wfx-row="shorts"` → `.wfx-row__scroller--shorts`: **thumbs 208×311, ALL card widths 208 (24 cards, zeroWidthCards=0), gutters 4px, 6 columns, computed track widths uniform "208px"** (grid-auto-columns 208px, auto-flow column, template-columns none at every breakpoint); **title below only** (no channel row, no meta), **no badge**; **THE LONG-STANDING ZERO-WIDTH SHELF BUG FIXED — and C re-confirmed the bug LIVE on main @ ab49392 first** (service: the first FOUR cards at **0×0** in `'0px','160px'` explicit tracks — `main-ref-service.s4probe.json`; C's baseline had missed it: the vertical-card filter's width>100 excluded the zero-width cards) — `b-d92f5ff-service.s4probe.json → shortsShelf` | PAR | **VERIFIED (B-lane b852d977)** | The B-flagged main re-verification delivered: the defect was real, pre-R29, and invisible to the baseline instrument; the fix holds at every breakpoint. |
| N13/D6 | Rail grammar | corpus home-anatomy: Home · Shorts · Subscriptions · You · History → Explore (Music/Movies/Live) → More from YT (…) → footer links + location + **sign-in promo** | **PARTIALLY VERIFIED @ b852d977** (both boots; re-verified @ d92f5ff): **the item anatomy in the labeled forms = the corpus measure: 40h r10 14px/400/20px** (measured on an INACTIVE item — the active item's 500 is the active-pill grammar; the <1280 DRAWER carries the SAME 40h r10 14/400/20 + the promo; the icon-rail/bottom-nav bands keep their own grammar); **THE SIGN-IN PROMO byte-exact**: "Sign in to like videos, comment, and subscribe." + the 97×36 r20 #065fd4 pill → the real identity path — `b-d92f5ff-*.s4probe.json → rail/railInactive/railDrawer`; the corpus's Subscriptions/You-groups/Explore/More-from-YT/footer-links/location honestly absent (probe-confirmed; WebFlix's rail = its REAL surfaces: Home·Shorts·Watch·Library·History·Offline·Settings) | PAR | **VERIFIED-in-scope (B-lane b852d977)** — the anatomy + promo claims verified; the absent corpus destinations remain the honest-divergence ledger (divergence 5 in R28's set, B's HOLD list) | B claimed the item anatomy + the promo (delivered); the full corpus taxonomy is CORPUS-PENDING (B's HOLD ledger — never built from memory). |
| O6-res | Raised-gray field residual | corpus color-survey: light raised **4.1%** (≈<5% band) | UNCHANGED on B's build: service light home **6.6%** by C's census (4.6% dark-family + 2.0% light-family; identical to base at every head); fixtures 2.0% — `r29-pixels.py` on `b-d92f5ff-*-home-field.png` | COS | OPEN | Never claimed by B (correctly — the field's artwork-internal darks inflate the count; instrument-bound magnitude, divergence 3). |
| N29 | Card channel slot | corpus home-anatomy: card meta carries the channel row (avatar 36 + real channel name) | The HOME card slot UNCHANGED: "From wfx-experience-service" (the service items carry no channel-name field — the frozen never-fabricate law). **The WATCH-surface resolution VERIFIED (Stage 1, N9-b).** The home-card scope remains the operator's ask — `b-d92f5ff-*.r29probe.json → channelSlot` | PAR | OPEN (home-card scope; honest-divergence class) | B's standing divergence record is honest: the connector id is the truth the sources model carries for cards. |
| D3/N1 | Mic (voice search) | corpus core.json: 40×40 r100 bg rgba(0,0,0,0.05), masthead center-right of search | **Honestly absent on B's build — verified at the final head**: no mic control (masthead `micButton: null`); the probe's instrumented click produced **`getUserMediaCalls: []`** — no speech transport ever invoked (the `micTransport.present:true` reading is the aria-label substring artifact — divergence 8; the instrument's own truth table shows zero transport calls) | PAR | OPEN (honestly absent until a real transport exists — B's HOLD ledger: CORPUS-PENDING) | The doctrine holds: no decorative mic shipped, none claimed. |
| O6-meta | meta-theme-color follows the boot | (implied by the light logged-out default; color-survey) | **FIXED + VERIFIED @ 01dc579** (both boots; re-verified @ d92f5ff): the seam's `<meta data-wfx-theme-color>` set before first paint by the same inline head script that sets `data-theme` (served-HTML check: the meta + the inline seam script present, meta before `<body>`); **light boots #ffffff + `data-theme=light` + body #ffffff; dark boots #0f0f0f** — both branches, both boots; the Appearance rows keep it in sync live (the gear flip test) — `b-d92f5ff-*.s3probe.json → metaBoot/gear.appearance*` | COS | **VERIFIED (B-lane 01dc579)** | Baseline: the stale #0f0f0f on a light boot. The WFX-057 no-drift law re-pinned to the seam. |
| D16/F4 | 9 surface-scoped tokens → canonical `--wfx-*` names | R28 matrix D16/F4: 9 tokens rendered literally, not as custom props (the conformance informational note) | **FIXED + VERIFIED @ d92f5ff** (both boots): **all NINE declared** (`--wfx-border-hairline, --wfx-pill-bg, --wfx-pill-fg, --wfx-scrollbar-thumb, --wfx-toast-bg, --wfx-toast-fg, --wfx-chrome-scrim, --wfx-chrome-fg, --wfx-stage-black`) — **SOURCE-level byte-exact 18/18** (the subject's globals.css declarations equal the contract's own literals, whitespace-normalized; cross-checked against the subject's frozen `parity-tokens.ts` — 9/9 match); **COMPUTED-level byte-exact 18/18** (a probe element carrying `background: var(--token)` computes IDENTICALLY to a twin carrying the contract literal — the browser's own canonical form, both themes); the rules use the canonical names (scrollbar/chrome-scrim/chrome-ink/badge-base/toast/stage-black `var()` usages probed); **the conformance informational line GONE** — C ran the subject tree's own `tests/parity-conformance.test.ts`: **19/19 pass, "wave state: BOTH surfaces conformant"**, no surface-scoped note — `b-d92f5ff-*.s5probe.json → tokenVerdicts/ruleUsage/contractCrossCheck` | COS | **VERIFIED (B-lane d92f5ff)** | The two remaining `rgba(0,0,0,0.8)` literals (a floating control + the hoverpreview unmute:hover) are outside the claimed replacement set — recorded, not a defect of the claim. |
| N16 | Duration pill alpha | corpus A@298fa55: **rgba(0,0,0,0.6)** (R27's 0.8 superseded) | **FIXED + VERIFIED @ b852d977 → d92f5ff**: the duration badge's computed bg **`rgba(0, 0, 0, 0.6)`** — the corpus 0.6, verified POST-token-work at the final head (`badgeAlpha.isCorpus06: true`); the app's badge follows the R28 corpus, NOT the stale R27 contract token's 0.8 — `b-d92f5ff-*.s5probe.json → badgeAlpha` | COS | **VERIFIED (B-lane d92f5ff)** | The contract token's 0.8 update is a shared-package change outside B's lane — ESCALATED (see below). |

---

## SCOREBOARD

**Machine-counted verdict census (Section-1 rows, per `evidence/r29-recon/r29-census.py`):**

| measure | count |
|---|---|
| Section-1 rows (the second-order set + the R28 token carry-overs) | **24** (22 + D16/F4 + N16 added when B claimed them) |
| PARITY (PAR) | **18** |
| COSMETIC (COS) | **5** (D8/N4, O6-res, O6-meta, D16/F4, N16) |
| HONEST-DIVERGENCE (HD) | **1** (N9-a-h — the reactions local-truth law, verified) |
| VERIFIED (green — C reproduced) | **21** (every claimed row across the five stages: stage 1 ×7, stage 2 ×2, stage 3 ×6, stage 4 ×4 — N13/D6 verified-in-scope, stage 5 ×2) |
| OPEN (red) | **3** (O6-res raised-gray — instrument-bound, un-claimed; N29 home-card channel slot — the connector-id truth, un-claimed; D3/N1 mic — honestly absent, no transport, B's HOLD ledger) |
| WONT-FIX honest | 0 |
| B claims pushed to `wfx/r29/web` | **6 commits, 5 stages** (`7ade74e`, `c6f21c8`, `bcd8120`, `01dc579`, `b852d977`, `d92f5ff` — the full arc; **every stage head verified in both boots**; the final head ran the complete instrument: r29-probe + s1 + s2 + s3 + s4 + s5 + the R28 floor + conformance + pixels) |

**The honest closing state:** B's five-stage arc landed in full under the hardened push
law. C independently reproduced **every claim at every stage head, in both boots**
(fixtures + service), with byte-exact geometry/anatomy/tokens wherever the corpus pins
values, interaction-level proofs for every wiring claim (real writes, real navigation,
real state machines), and the honesty gates re-exercised at the final head. The
**R28 regression floor holds** at every head (the flag set identical to c6f21c8's,
both boots; the single newly-red `cards.badgePresent` at d92f5ff is the instrument's
card[0] assumption meeting the duration-conditional badge grammar — divergence 11, not
a regression). The honest red remainder: the raised-gray census (instrument-bound),
N29's home-card channel slot (the connector-id truth), the mic (no transport —
honestly absent), and the corpus-taxonomy ledger (Subscriptions/Explore/footer/
bell/watched-progress/shorts-action-rail — CORPUS-PENDING, never built from memory).

## Honesty-check verdicts (the doctrine's gates — FINAL, @ d92f5ff both boots)

| gate | check performed | verdict |
|---|---|---|
| Like/dislike split pill shows ONLY real local user actions | the full click sequence at the final head (service): fresh→no count; like→"1"; toggle-off; dislike→NO count anywhere; mutual exclusion; the store read | **PASS** (`b-d92f5ff-service-s1.s1probe.json → reactions*`) |
| Subscribe pill wired to a real save/follow capability | final-head service round: the pill's real write + the Library Subscriptions named list rendered with the entry | **PASS** (real write + visible Library list; the dev-boot reload split = divergence 7, pre-existing) |
| Gear-menu rows real or honestly absent | the multi-page census at the final head: 4 wired rows (2 real hrefs + 2 live subpages), the live theme seam, the 5 unbacked rows named in the menu | **PASS** |
| Filters dialog controls all really wired | the URL-state machine on real data (17/7/10; 1/0/6), the link-options, the invalid-value law, the two distinct empty truths | **PASS** |
| Theater/miniplayer REAL modes (geometry + persistence) | theater 1296×729 @(72,68) byte-exact + revert; the dock flow: geometry, /-and-/search persistence, the live ~3s position seam, expand/replace/suppression/close | **PASS** |
| Mic — a real speech transport or honestly absent | masthead census + the instrumented click at the final head: no control, `getUserMediaCalls: []` | **PASS (honestly absent)** — no decorative mic, none claimed (B's HOLD ledger) |
| No fabricated counts anywhere | the reactions count law, the sub-count absence, the duration-conditional badge, the evidence-gated play-state display (the k/space/j/l display never fabricates playing), the filtered-empty state | **PASS** |

## Verification log (chronological; every B claim gets a row)

| when | B claim | C's check | verdict |
|---|---|---|---|
| seed | — | baseline observation of `main @ ab49392` complete — BASELINE-OBSERVATION.md + `base-{fixtures,service}.r29probe.json` + VLM set; the R28 regression floor holds; the shelf zero-width defect NOT yet visible to the baseline instrument (the width>100 filter — divergence 12) | n/a — the loop armed |
| window 1 close | **none pushed** — `wfx/r29/web` absent across the entire polling window | nothing to verify; the red baseline stands | **no B claims — honestly reported** |
| window 2 | **7ade74e stage 1 (early)** | full independent reproduction, both boots + the library-seam differential probe | **ALL CLAIMS VERIFIED** |
| window 2 | **c6f21c8 STAGE 1 COMPLETE** | delta verification, both boots — 996×560 @(16,68) byte-exact | **VERIFIED** — the head moves to c6f21c8 |
| window 3 | **bcd8120 STAGE 2 COMPLETE** — N3 anatomy byte-exact; N23 chips + the 696px dialog + the URL filter state; the honest filtered-empty | the `b-bcd8120-{fixtures,service}` rounds (r29+s1+s2 + the R28 floor + conformance + pixels + captures): row 1152×281/thumb 500×281 r12/title 18/400/26 clamp-2/meta 12/400/18/avatar 24×24 — all byte-exact both boots; the dialog 696 r12 shadow byte-exact; service q=the: **17/7/10/17, durations 1/0/6 + "(filtered)"**, the honest filtered-empty, invalid ignored, the no-matches truth distinct; the wiring click-through → `?q=the&type=video` 7 rows | **ALL STAGE-2 CLAIMS VERIFIED** — 2 rows green |
| window 3 | **01dc579 STAGE 3 COMPLETE** — N24 gear multi-page; N12 sign-in byte-exact; the O6 meta residual; the theater re-anchor; the in-app miniplayer; the per-key keyboard set | the `b-01dc579-{fixtures,service}` rounds (r29+s1+s3 + the floor + conformance + pixels): the gear root/subpages/absence-note/live-seam; the pill 101×40 r20 rgb(6,95,212) 14/500 border 1px rgba(0,0,0,0.2); meta #ffffff/#0f0f0f both branches + the served-HTML seam; **theater 1296×729 @(72,68) byte-exact**; the dock flow end-to-end (geometry, persistence, the override-777→real-position seam proof, expand, replace, suppression, close, the compact doc); the per-key table (m/↑/↓ state flips; k/space/j/l/←/→/0-9 POST 200 with exact seek deltas; ? sheet; c gated) | **ALL STAGE-3 CLAIMS VERIFIED** — 5 rows green (N24, N12, N25-a/b/c, O6-meta) |
| window 3 | **b852d977 STAGE 4 COMPLETE** — the History dedupe; the rail anatomy + promo; the corner badge; the shorts shelf + the zero-width-bug fix | the `b-b852d977-{fixtures,service}` rounds (r29+s1+s4 + the floor + conformance + pixels): History ×1 both boots; 40h r10 14/400/20 (inactive + drawer) + the promo byte-exact + the honest absences; the badge grammar byte-exact (12/500 #fff 0.6 r4 1px 4px 8px-inset m:ss/h:mm:ss; 0 type badges; the search variant "2:30:27" @8/8); the shelf 208×311/4px/6-col/all-208-widths; **the main-reference rounds re-confirmed the zero-width bug LIVE on ab49392 (first four cards 0×0 in '0px','160px' tracks, service boot)** | **ALL STAGE-4 CLAIMS VERIFIED** — 4 rows green (D8/N4, N13-in-scope, N19, N20) |
| window 3 (final) | **d92f5ff STAGE 5 COMPLETE + the final report** — D16 the nine tokens canonical (both themes, byte-exact, the note GONE); N16 the 0.6 post-token; the HOLD ledger; the final gates | the `b-d92f5ff-{fixtures,fixtures-b,service,service}` full-instrument rounds (r29 + s1 + s2 + s3 + s4 + s5 + the R28 floor + conformance + pixels + captures): **source-level 18/18 + computed-level 18/18 byte-exact** (the twin-element differential through the browser's own canonicalization, both themes); the rules' var() usages; **the conformance run on the subject tree: 19/19, "BOTH surfaces conformant", the informational line ABSENT**; the badge 0.6 re-measured POST-token (`isCorpus06: true`); every earlier stage's claims RE-VERIFIED at this head (the completeness law); the floor holds (divergence 11 recorded) | **ALL STAGE-5 CLAIMS VERIFIED** — 2 rows green (D16/F4, N16); **the verified lane head = d92f5ff** |

---

## DIVERGENCES — for the operator (C's ledger, final)

1. **The action row's width is a content-sum (345px) vs the corpus 690 label-sum** —
   the honest consequence of Download-absent + WebFlix's shorter labels. Magnitude
   note, not a grammar defect.
2. **The search dialog's height is 308 vs the corpus 518** — the corpus 5-group
   dialog against B's honest 2-real-groups + the absence note. The width/radius/shadow
   are byte-exact; the height is the content-sum of honest content.
3. **The raised-gray number is instrument-bound** — C's whole-field census measures
   6.6% (service) where the corpus records 4.1%: artwork-internal darks inflate the
   count. A region-scoped survey would settle the operator-facing number. Un-claimed
   by B (correctly). The row stays OPEN with this note.
4. *(reserved — the R28-era theater note, superseded by the 1296 verification)*
5. **The corpus rail taxonomy is honestly absent** — Subscriptions/You-groups/
   Explore/More-from-YT/footer-links/location carry no real backing on this host;
   B's HOLD ledger records them CORPUS-PENDING. The delivered claims (item anatomy
   in all labeled forms + the sign-in promo) are verified.
6. **k/space/j/l/←/→/0–9 display evidence is provider-gated** — the command paths
   round-trip (POST 200, exact deltas); the visible play-state/position display
   gates on the provider's own broadcasts, which never advance in this sandbox
   (the stream never loads). Honest by construction — never a fabricated playing
   state. Same class as C's R28 k-verdict.
7. **The dev-boot library round-trip split (pre-existing)** — in the dev server's
   per-route module graph, the `/api/library` write lands in the API-route runtime
   while page SSRs read their own instances; the SERVICE boot (the production-truth
   seam) round-trips. Lead-owned: a production-boot verification or a dev-graph
   unification would close it. C's differential evidence (`r29-diffprobe.ts`)
   committed.
8. **verify.ts `hasMic` is a substring false positive** ("Cos**mic** Phenomena") —
   the same class struck the s3/r29 probe's `[aria-label*=mic i]` at the final head
   (`micTransport.present: true` with `getUserMediaCalls: []` — no control, no
   transport). The R28 harness needs a word-boundary fix before the next wave.
9. *(closed — the y-anchor note: resolved by c6f21c8's 12px top gap, 996×560 @(16,68))*
10. **The dwell preview's honest content** — the singleton mounts the provider's
    REAL embed; in this anonymous headless session the provider serves its bot-wall,
    rendered verbatim. The grammar is verified; the content is the provider's truth.
11. **The R28 floor's `cards.badgePresent` newly-red at d92f5ff (service)** — the
    corpus check reads card[0]'s badge; the R29 grammar made the badge
    duration-conditional (no durationMs ⇒ no badge — the stage-2 honesty law), and
    card[0] on the service feed carries no duration. 41 badges render on
    duration-bearing cards (s4probe). An instrument-vs-grammar note, NOT a
    regression; the floor check needs a any-card-scope update next wave.
12. **C's baseline instrument missed the shelf zero-width cards** — the
    vertical-card filter's `width>100` excluded the 0×0 cards, so the baseline
    recorded "160×284 thumbs" (the visible ones) while the first four cards were
    silently 0×0. B's re-anchor surfaced it; C's main-reference rounds re-confirmed
    the defect LIVE on ab49392 (service: first-4 0×0, tracks '0px','160px') —
    the record now straight.
13. **B's own recorded divergences (their final report — C acknowledges each as
    honestly reported):** N15's OS-follow boot mechanism (the Appearance menu is
    the corpus's full path); N29's connector-id channel truth (the frozen
    never-fabricate law); the miniplayer's MPA mechanism (sessionStorage + the
    compact route — never claimed as an SPA transplant); the evidence-gated
    play-state display (divergence 6 above); the HOLD ledger (bell/mic/
    subscriptions-rail/watched-progress/shorts-action-rail — CORPUS-PENDING);
    the pre-existing r28-recon lint errors (below).

## ESCALATIONS — lead-owned

- **The parity-tokens contract's `pill-surface` still encodes the superseded 0.8**
  (R27 vintage) where the R28 corpus pins `rgba(0,0,0,0.6)` — the app's badge
  follows the corpus (verified); the CONTRACT token update is a shared-package
  change (`packages/platform-contracts/src/parity-tokens.ts`) outside B's lane
  paths. **Lead ruling needed**: update the contract token to 0.6 (the corpus
  supersession) or pin the corpus to the contract.
- **The pre-existing repo-wide lint errors** — 20 `no-explicit-any` in
  `evidence/r28-recon/*.ts` (C's own R28 harness, main lineage 095c73c/d34900b),
  unchanged by B's lane; B's paths lint-clean. (C's R29 probe set carries 7 more
  of the same class — the instrument lane's known debt, one per probe file.)
- **The verify.ts `hasMic` false positive + the `badgePresent` card[0] scope
  (divergences 8 + 11)** — two one-line harness fixes before the next wave reuses
  the R28 floor.
- **The dev-boot library split (divergence 7)** — the lead owns the production-boot
  verification or the dev-graph unification.
- **The corpus-pending set** (B's HOLD ledger + the N13 taxonomy + N29's
  home-card slot + the bell) — the operator's next corpus capture window decides.
