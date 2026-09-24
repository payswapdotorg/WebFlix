# R29 RECONCILIATION MATRIX — the second-order wave's scoreboard

**Lane:** `wfx/r29/recon` · **Base:** `origin/main @ ab49392`
**Maintainer:** Worker C (the reconciler). B's claim is a hypothesis until C verifies.
**Doctrine (R28, unchanged):** an unverified fix is a RED row, never green; a silent
pass is worse than a loud fail; every verdict cites evidence. **Lineage:** this matrix
CONTINUES the R28 row numbering (`docs/parity-lab/r28/reconciliation/MATRIX.md` @
main — the O/D/N/F/L families; the R29 wave works the second-order rows the R28
scoreboard left red). New rows discovered this wave take N-numbers after N29.

**Legend — gap class:** `OB` = OPERATOR-BLOCKING · `PAR` = PARITY · `COS` = COSMETIC ·
`HD` = HONEST-DIVERGENCE. **Fix status:** `OPEN` (red) · `B-lane <sha>` (landed,
UNVERIFIED — still red) · `VERIFIED` (green — C reproduced the fix) · `WONT-FIX honest`.

**Corpus citations:** A's R28 sheets @ the corpus head (25ba5e7 / per-sheet SHAs as
cited in the R28 matrix) — watch-page-anatomy.md, search-anatomy.md,
FEATURE-INVENTORY.md, home-anatomy.md, color-survey.md, shorts-anatomy.md,
comments-anatomy.md, hover-preview.md, share-dialog.md, fonts.md, logged-in-surfaces.md.
WebFlix values cite C's own measurements (`evidence/r29-recon/` reports).

**Baseline:** `docs/parity-lab/r29/reconciliation/BASELINE-OBSERVATION.md` — every
row below was confirmed LIVE on the base (both boots) before the loop began.
**B's truth source:** lane `wfx/r29/web` — the verified head is `7ade74e`
("R29-B stage 1 (early): the watch page's second act").

---

## SECTION 1 — THE SECOND-ORDER RED SET (the R28 scoreboard's carry-over, re-baselined @ ab49392)

| # | feature | YouTube behavior (corpus citation) | WebFlix state (C's measurement) | class | status | verdict notes |
|---|---|---|---|---|---|---|
| D8/N4 | Rail duplicate History | corpus home-anatomy: single History entry | History ×2 — UNCHANGED on B's build (`chrome.railHistoryCount=2`, both boots) | COS | OPEN | Not claimed in B's stage 1; stands red. |
| D14/F3 | `.wfx-player` padding | corpus watch-geometry: **16px** @1440 (player @(16,68)); 24px @≥1600 | **FIXED + VERIFIED @ 7ade74e** (both boots): `playerPadding "16px 0px 48px 16px"` @1440 (left 16 = the page margin; right 0 = the ≥1016 flush-right law); `@≥1600: "24px 24px 48px"` + playerX 24 — `r29probe.json → watchGeometry`, `s1probe.json → geometry.w1600` | PAR | **VERIFIED (B-lane 7ade74e)** | The corpus two-band law reproduced exactly. |
| N21 | Watch two-column geometry | corpus watch-page-anatomy: page margins 16px @1440; player **996×560 @(16,68)**; primary 1012; secondary **412 @x1028**, 16px gutter; the rail stays CLOSED on watch (guide-collapsed) | **FIXED + VERIFIED @ 7ade74e** (both boots): `shellGuide=hidden`, rail `display:none` on watch (home keeps the 240px rail); **stagewrap 996×560 @(16,72)** (x=16 EXACT; y 72 vs corpus 68 — the 56px masthead's own bottom margin, a 4px in-kind note); `layoutCols 996px 412px` gap 16px; secondary **412 @x1028 flush-right (edge delta 0)**; the hamburger opens the overlay drawer at any width (240×844 @x0, Escape-closable) — `r29probe.json → watchGeometry`, `s1probe.json → watchRouteGeometry/hiddenGuideDrawer/homeRailRegression` | PAR | **VERIFIED (B-lane 7ade74e)** | Baseline: 724×407 @(264,80) with the rail open. The corpus watch anatomy reproduced. |
| N9-a | Watch action row: like/dislike split pill | corpus watch-page-anatomy: segmented split pill 36–40px r18–20 + Share + Download + Save + "More actions" kebab (row w≈690 h42) | **FIXED + VERIFIED @ 7ade74e** (both boots): split pill **111×40 r20** segmented with divider (like 62×40 + divider + dislike); Share pill + Save pill + kebab in the row; **Download honestly absent** (probe null both boots; VLM confirms); kebab rows = Add-to-queue / Save / watch-state reports / Details — **REAL writes**: Add-to-queue → `/api/queue` GET shows the item in the session queue (`kebabQueueAdd.added=true` + `queueGetTruth`); rowBox 345×40 (h40 ✓; width is content-sum — Download honestly absent + short labels, a magnitude note vs the corpus 690 label-sum) | PAR | **VERIFIED (B-lane 7ade74e)** | **HONESTY GATE PASSED** — see N9-a-h below. |
| N9-a-h | Reactions local transport (honesty gate) | corpus: counts are real engagement; a dislike never renders a count | **VERIFIED @ 7ade74e** (both boots): the like count renders **ONLY this browser's own record** — fresh state → no count; like click → count "1" + `wfx-reactions-v1 {"<itemId>":"like"}`; like again → toggle-off (count gone, entry removed); dislike → **NO count anywhere in the row** (`anyCountInRow=[]`) + store flips to dislike; like again → mutual exclusion (store back to like, count "1") — `s1probe.json → reactionsHonesty` (fixtures + service), the store persisted across probes (a prior probe's like rendered as count "1" on reload — durability demonstrated) | HD | **VERIFIED (B-lane 7ade74e)** | The R28 comments law applied to reactions: only real local actions, never fabricated counts. |
| N9-b/D11 | Channel row + Subscribe pill | corpus watch-page-anatomy: avatar 36–40 circular + name bold 14–16 + sub count 12 + **Subscribe h≈36 r18 red #f03-family** | **FIXED + VERIFIED @ 7ade74e** (both boots): avatar **40×40 r50%**; name 16px/500 = **the sources model's own displayName** (fixtures: "Fake Source (TEST FIXTURE…)" — cross-checked against `/api/sources`; service: the connector id, the model's honest fallback); **sub-count honestly absent** (probe null, never fabricated); Subscribe pill **95×36 r18 bg rgb(255,0,51)** — the corpus red family EXACT; **the click is a REAL write**: `POST /api/library {op:save, listName:"Subscriptions"}` → `{ok:true, entry:{listName:"Subscriptions", sync:"synced"}}` — and **the Library page renders the Subscriptions named list with the subscribed item** (service boot: `subsFound=true`, VLM-confirmed "1 HOUR Rainy Day in Airport ✈️…") | PAR | **VERIFIED (B-lane 7ade74e, with divergence #7)** | **HONESTY GATE PASSED at the seam**: not a decorative CTA — the real library write + the visible Library list (service boot). The dev-boot reload-state split is divergence 7 (environment, pre-existing). |
| N9-c | Description "...more" inline expander | corpus watch-page-anatomy: collapsed 1–2 lines + "...more" inline expander 14px/400; expands inline (no dialog) | **UPGRADED + VERIFIED @ 7ade74e** (both boots): the full inline grammar — collapsed **2-line clamp** (`-webkit-line-clamp:2`, h68, text 14px/400) + the **"...more" BUTTON** (not a `<details>`); click → **expands INLINE** (open=true, bodyVisible, h68→112, **no dialog opened** — probed `anyDialogOpened=false`); toggle flips to "Show less"; re-collapse verified | PAR | **VERIFIED (B-lane 7ade74e — full corpus grammar)** | Was R28-carried VERIFIED (`<details>` form); B shipped the corpus inline form — re-verified end-to-end. |
| N22 | Related/up-next column | corpus watch-page-anatomy: `ytd-compact-video-renderer` rows: thumb **168×94** left, title 14px/500 2-line + channel + meta right, **4px gap**; autoplay toggle row with **paper switch** at section head; hover row → preview singleton | **FIXED + VERIFIED @ 7ade74e** (both boots): the section head "Up next" + the **Autoplay paper-switch BEFORE the list** (`role=switch`, aria-checked, `.wfx-switch__knob` — the toggle click performs the REAL policy write: queue autoplay true→false via `/api/queue`, reverted after); **compact rows: thumb 168×95** (aspect 16:9), title **14px/500 clamp-2** + connector meta, **row pitch measured 4px** (`rowPitch=4`, `listRowGap=4px`); rowCount 57 (service) / 7 (fixtures); **one-click play** — parameterized `/player` hrefs; **dwell preview: the singleton MOUNTED on hover** (`wfx-hoverpreview--open` + iframe `wfx-hoverpreview__frame`, both boots; VLM: the floating preview player over the rows — the provider's REAL embed serves its anonymous sign-in wall, honest content) — `s1probe.json → relatedColumn/autoplayToggle/dwellPreview` + VLM | PAR | **VERIFIED (B-lane 7ade74e)** | Baseline: checkbox autoplay + card-class rows. The corpus renderer grammar reproduced, incl. the real preview transport. |
| N3 | Search result row geometry | corpus search-anatomy: row **1152×281**, thumb **500×281** r12, title 18/400/26 clamp-2, meta 12/400 split-spans | UNCHANGED on B's build: row **1096×248**, thumb **360×202** r12, title 18/400 (service n=209; fixtures n=10) — `r29probe.json → searchRows` | PAR | OPEN | Not claimed in stage 1; stands red. |
| N23 | Search filters dialog | corpus search-anatomy: **Filters button → 696×518** dialog r12 + corpus shadow; 5 groups TYPE/DURATION/UPLOAD DATE/FEATURES/PRIORITIZE | UNCHANGED on B's build: the Filters pill renders, click → **no dialog, no controls, no wiring** (`filters.dialog.found=false`, `wiring.toggled=false`, both boots) | PAR | OPEN | Not claimed in stage 1; the dead pill stands red. HONESTY GATE still pending B's claim. |
| N24 | Masthead settings gear menu | corpus FEATURE-INVENTORY: gear → multi-page menu (Your data / Appearance / Display language / Restricted Mode / Location / Keyboard shortcuts / Settings / Help / Send feedback) | UNCHANGED on B's build: no gear control; the identity button's menu = the account set, not the corpus gear | PAR | OPEN | Not claimed in stage 1. |
| N12 | Sign-in pill (masthead right) | corpus core.json/color-survey: **40h r20, border 1px rgba(0,0,0,0.2), text #065fd4** | UNCHANGED on B's build: "W Signed out" badge 175×40 r18 bg #f2f2f2 (`masthead.signinPill`) | PAR | OPEN | Not claimed in stage 1. |
| N25-a | Player keyboard set | corpus FEATURE-INVENTORY/watch-page-anatomy: k space j l m f t i arrows 0-9 c | RE-MEASURED on B's build: **m VERIFIED** (Mute↔Unmute), **f VERIFIED** (fullscreen), **t works** (theater toggles — class + 1440 stagewrap), **k/c/j/l/0-9 unproven** (no observable state change — `press_k` play label does not flip; the R28 ambiguity persists) | PAR | OPEN (partial: m+f+t) | Not claimed in stage 1; per-key evidence still owed for the full set. |
| N25-b | Theater mode geometry | corpus watch-page-anatomy: theater → player **1296px full-content-width** | UNCHANGED on B's build: `t` toggles a REAL mode (theater class + single-column) but stagewrap = **1440px full-viewport bleed** ≠ 1296 content width (`press_t → stagewrapW 1440`) | PAR | OPEN | Not claimed in stage 1; the in-kind geometry divergence stands. |
| N25-c | Miniplayer mode | corpus watch-page-anatomy: "i" → **bottom-right floating player, persistent across navigation** (in-app) | UNCHANGED on B's build: no in-app floating miniplayer; the control is Document-PiP-gated (absent in this environment); `i` produces no observable change | PAR | OPEN | Not claimed in stage 1. HONESTY GATE (real mode + persistence) still pending. |
| N19 | Duration badge grammar | corpus home-anatomy: ONE corner badge bottom-right 8px inset — "0:45" 12/500 #fff on **rgba(0,0,0,0.6)**, r4, pad **1px 4px** | UNCHANGED on B's build: "short45s" transparent text pill + stacked type badge ("short" 0.8-alpha, r4, pad 3px 4px) — `r29probe.json → badge` (both boots) | PAR | OPEN | Not claimed in stage 1. |
| N20 | Shorts shelf on home | corpus home-anatomy/shorts-anatomy: shelf with **208×387 cards (208×311 9:16 thumbs), ~4px gutters, 5–6 cols**, title below, no badge | UNCHANGED on B's build: the shelf EXISTS; vertical thumbs **160×284** (service) / **297×528** (fixtures) + the reason line (`r29probe.json → shorts`) | PAR | OPEN (geometry + reason-line delta) | Not claimed in stage 1. |
| N13/D6 | Rail grammar | corpus home-anatomy: Home · Shorts · Subscriptions · You · History → Explore (Music/Movies/Live) → More from YT (…) → footer links + location + sign-in promo | UNCHANGED on B's build: Home · Shorts · Watch · Library · History · Offline · History · Settings (+Install app service-only); no Subscriptions/You/Explore/footer (`r29probe.json → rail`) | PAR | OPEN | Not claimed in stage 1. |
| O6-res | Raised-gray field residual | corpus color-survey: light raised **4.1%** (≈<5% band) | UNCHANGED on B's build: service light home **6.6%** by C's census (4.6% dark-family + 2.0% light-family; identical to base) — `r29-pixels.py` on `b-7ade74e-service-home-field.png` | COS | OPEN | Not claimed in stage 1; instrument-bound magnitude (see divergence 3). |
| N29 | Card channel slot | corpus home-anatomy: card meta carries the channel row (avatar 36 + real channel name) | The HOME card slot UNCHANGED ("From wfx-experience-service", VLM-confirmed). **Note: B's stage-1 resolved the WATCH-surface channel name** through the sources model's displayName (see N9-b — the N29 truth applied there, verified); the home-card scope stands | PAR | OPEN (home-card scope) | The watch-surface resolution is verified; the row's home-card scope remains the operator's ask. |
| D3/N1 | Mic (voice search) | corpus core.json: 40×40 r100 bg rgba(0,0,0,0.05), masthead center-right of search | **Honestly absent on B's build** — no mic control shipped (probe `micButton: null`; the AppShell carries the no-transport law in code). The verify.ts `hasMic:true` was an instrument FALSE POSITIVE (the substring "mic" matched "Cos**mic** Phenomena" card labels — divergence 8) | PAR | OPEN (honestly absent until a real transport exists) | The doctrine holds: no decorative mic shipped, none claimed. |
| O6-meta | meta-theme-color follows the boot | (implied by the light logged-out default; color-survey) | UNCHANGED on B's build: `meta[name=theme-color]` = **#0f0f0f stale** while `data-theme=light` + body #ffffff (both boots) | COS | OPEN | Not claimed in stage 1. |

---

## SCOREBOARD

**Machine-counted verdict census (this file's Section-1 rows, per `r29-pixels`-style
scripted count over the table cells):**

| measure | count |
|---|---|
| Section-1 rows (the second-order set) | **22** (19 carried + N21/N22 added — B claimed them, re-baselined + the N9-a-h honesty-gate row) |
| PARITY (PAR) | **18** |
| COSMETIC (COS) | **3** (D8/N4, O6-res, O6-meta) |
| HONEST-DIVERGENCE (HD) | **1** (N9-a-h — the reactions local-truth law, verified) |
| OPEN (red) | **15** (the un-claimed set: duplicate History, search rows, filters, gear, sign-in, keyboard full set, theater 1296, miniplayer, badge grammar, shorts geometry, rail grammar, raised-gray, N29 home-card, mic, meta-theme) |
| VERIFIED (green — C reproduced @ B-lane 7ade74e) | **7** (D14/F3, N21, N9-a, N9-a-h, N9-b, N9-c, N22) |
| WONT-FIX honest | 0 |
| B claims pushed to `wfx/r29/web` | **1** (the stage-1 push @ 7ade74e — ALL its claims verified: reactions transport, action row, channel row + Subscribe, description expander, N22 grammar, N21/D14 geometry, Download/sub-count honestly absent) |

**The honest closing state of this window:** B's lane LANDED (`7ade74e`, "stage 1
(early)" — the hardened push law delivered after the R29-B session loss). C verified
the full claim set through independent reproduction in BOTH boots
(`b-7ade74e-fixtures` + `b-7ade74e-service` rounds: s1probe + r29-probe + R28
regression floor + captures + pixel census + 6 VLM checks) plus a dedicated
differential probe (`r29-diffprobe.ts`) that isolated the library-write seam. Every
claim in B's commit message reproduced — including both honesty gates (the reactions
local-truth law; the Subscribe real-write with the Library-list confirmation in the
service boot). The R28 regression floor HOLDS on B's build (fonts, one-click,
light boot, share dialog 470×337 r12 with 10 targets, comments — zero corpus-spec
fails, both boots). The remaining 15 red rows are the un-claimed set (B's stages
2+ owe them).

**The kept honest red rows (the operator's next ask):** search rows 360×202 + the
dead Filters pill, the masthead gear menu + sign-in pill, the keyboard set beyond
m+f+t (per-key visible evidence), theater 1296-geometry re-anchor, the in-app
miniplayer, duration-badge grammar, shorts-shelf card geometry, rail grammar +
duplicate History, the raised-gray residual, N29's home-card slot, the mic (until a
real speech transport exists), stale meta-theme-color.

## Honesty-check verdicts (the doctrine's gates, this round)

| gate | check performed | verdict |
|---|---|---|
| Like/dislike split pill shows ONLY real local user actions | click sequences in both boots: fresh→no count; like→"1"; toggle-off; dislike→NO count; mutual exclusion; store read | **PASS** (`reactionsHonesty`, both boots) |
| Subscribe pill wired to a real save/follow capability | click + raw POST receipt + `/library` render + reload + the watchlist differential | **PASS** (real write + Library list @ service boot; dev-boot reload split = divergence 7, pre-existing seam law) |
| Gear-menu rows real or honestly absent | gear census on B's build | **no gear shipped, none claimed** — honestly absent (the row stays red for the corpus ask) |
| Filters dialog controls all really wired | click probe both boots | **not claimed this stage; the pill is still dead** — red row stands |
| Theater/miniplayer REAL modes (geometry + persistence) | `t`/`i` key probes + control click | **theater REAL (1440-bleed divergence stands); miniplayer env-gated** — both un-claimed, rows stand |
| Mic — a real speech transport or honestly absent | selector census + code audit + the hasMic false-positive isolation | **honestly absent** — no mic control, no transport claimed/shipped |

## Verification log (chronological; every B claim gets a row)

| when | B claim | C's check | verdict |
|---|---|---|---|
| seed | — | baseline observation of `main @ ab49392` complete — BASELINE-OBSERVATION.md + `base-{fixtures,service}.r29probe.json` + VLM set; the R28 regression floor holds | n/a — the loop is armed |
| 2026-09-24 (window 1 close) | **none pushed** — `wfx/r29/web` absent across the entire polling window | nothing to verify; the red baseline stands | **no B claims — honestly reported** |
| 2026-09-24 (this window) | **7ade74e stage 1 (early)**: reactions local transport (`wfx-reactions-v1`); the action row (split pill + Share + Save + kebab + honest reports; Download honestly absent); the channel row (displayName via the sources model; Subscribe → the Subscriptions named list; sub-count honestly absent); the description inline "...more" expander; N22's related-column grammar (paper-switch Autoplay @ head, 168×94 rows @ 4px pitch, one-click play, dwell preview); N21/D14 geometry (guide hidden, 16px margins @1440, secondary flush-right, 24px @≥1600) | **full independent reproduction, BOTH boots** (fixtures + service rounds: s1probe + r29-probe + R28 floor + captures + pixels + VLM) + the differential probe isolating the library seam; every sub-claim probed by interaction, every geometry measured, the honesty gates exercised by real clicks | **ALL CLAIMS VERIFIED** — 6 rows green (D14/F3, N21, N9-a + N9-a-h, N9-b, N9-c, N22); divergences 7–10 recorded (the dev-boot library split, the instrument false positive, the y-72 note, the preview-content note); the R28 floor holds |

---

## DIVERGENCES — for the operator

1. **B's lane landed after the session loss.** The R29-B worker was lost mid-Stage-1
   by a platform outage and resumed under the hardened push law (push at the end of
   every stage). The lane head `7ade74e` ("stage 1 (early)") arrived and was verified
   this window — the law worked. B's UNPUSHED work remains unverifiable by
   construction; the loop watches for the next stage push.
2. **N20 re-baseline (a correction to the R28 matrix):** the shorts shelf EXISTS on
   main @ ab49392 — the row tracks the CARD GEOMETRY delta (160×284 / 297×528 vs
   corpus 208×311 in 208×387) + the non-YouTube reason line. Unchanged on B's build.
3. **The raised-gray number is instrument-bound:** C's bucket-precise census reads
   6.6% on the service light home (identical on base and B's 7ade74e — B did not
   touch it) vs the corpus 4.1% light reference. Artwork-internal darks inflate the
   count; a region-scoped survey would settle the operator-facing number.
4. **Theater geometry diverges in kind:** WebFlix's `t` mode is a REAL mode but
   renders a 1440px full-viewport bleed where the corpus records 1296px
   full-content-width. Un-claimed and unchanged on B's build.
5. **The miniplayer is environment-gated:** Document-PiP unavailable in headless
   Chromium; the corpus's in-app bottom-right floating persistent player is the
   contract. Un-claimed and unchanged.
6. **`k`/`c`/`j`/`l`/`0–9` remain honestly unproven** — no observable state change
   on base OR on B's build (the `press_k` play label does not flip). B's full-set
   claim (if it comes) needs per-key visible evidence.
7. **The dev-boot library round-trip split (NEW — the Subscribe verification's
   environment boundary):** in the dev server's per-route module graph, the
   `/api/library` write lands in the API-route module's runtime instance while the
   page SSRs read their own instances — so the Subscribe/Watchlist writes return
   `{ok:true, sync:"synced"}` but the watch-page RELOAD shows idle, and (in the
   fixtures boot) the Library page renders nothing. C's differential probe
   (`r29-diffprobe.ts`) proved the seam split is PRE-EXISTING (the R24 watchlist
   write behaves identically on B's build — not a B regression) and that the
   SERVICE boot — the production-truth seam — round-trips: the Library page
   hydrates the Subscriptions named list from the remote (VLM-confirmed). The
   bridge also rewrites the itemId (page `4DDNSA6R…` → route `4M2KGR5T…`), so
   page-id-keyed reads can never match in dev. In the single-bundle production
   boot the runtimes are one (the documented R24 dev-boot bridge doctrine). The
   honest verdict: the Subscribe capability is REAL and verified; the
   reload-state visibility is dev-environment-bound (lead-owned: a
   production-boot verification or a dev-graph unification would close it).
8. **verify.ts `hasMic` is a substring false positive:** the selector
   `[aria-label*=mic i]` matched "Cos**mic** Phenomena" card labels on the service
   home — there is NO mic control on B's build (C's precise probe + code audit
   confirm). The R28 harness needs a word-boundary fix before the next wave.
9. **The watch second act's y-anchor:** B's player sits at y=72 where the corpus
   records y=68 — the 56px masthead's own bottom margin (4px in-kind; x=16 and the
   996×560 box are EXACT).
10. **The dwell preview's honest content:** the preview singleton mounts the
    provider's REAL embed on hover (the transport is real — the R28 hover-preview
    law); in this anonymous headless session the provider serves its
    "Sign in to confirm you're not a bot" wall, which the preview renders verbatim
    (never a fabricated video loop). The grammar is verified; the content is the
    provider's own truth for this session.

## ESCALATIONS — lead-owned

- The remaining 15 red rows are B's stages 2+ debt (search rows + filters dialog,
  masthead gear + sign-in pill, the keyboard full set, theater 1296 re-anchor, the
  in-app miniplayer, duration-badge grammar, shorts-shelf geometry, rail grammar +
  duplicate History, raised-gray, N29 home-card slot, mic transport, meta-theme).
- Divergence 7 (the dev-boot library split) — the lead owns the decision: verify
  the Subscribe/watchlist round-trip in a production single-bundle boot, or unify
  the dev module graph. C's differential evidence (`diff-b-fixtures.diffprobe.json`)
  is committed.
- Divergence 8 (the verify.ts hasMic false positive) — a one-line word-boundary fix
  in the R28 harness before the next wave reuses it.
