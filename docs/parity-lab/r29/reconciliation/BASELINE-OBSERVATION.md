# R29-C BASELINE OBSERVATION — the second-order red rows on the recon lane base

**Base:** `origin/main @ ab49392` (the R28 lead's player-surface sweep commit)
**Boots:** `apps/web` · fixtures (`WFX_DEV_FIXTURES=1`) + service (`WFX_API_BASE=https://webflix-api.vercel.app`), `next dev -p 3101`
**Instrument:** agent-browser @1440×900 (`AGENT_BROWSER_SESSION=r29c-verify`) — the R28 harness
(`verify.ts` / `verify-corpus.ts` / `capture.ts` from `evidence/r28-recon/`, the R28-C instrument, reused
unmodified as the regression floor) + the NEW R29 probe
(`evidence/r29-recon/r29-probe.ts` — the second-order measurements) + the pixel census
(`evidence/r29-recon/r29-pixels.py`). VLM via z-ai (glm-5v-turbo) on the PNG evidence.
Re-measured, not trusted from any claim — C's own observation. Reports:
`evidence/r29-recon/base-{fixtures,service}.r29probe.json` (+ the R28 harness
reports at `evidence/r28-recon/verifications/base-{fixtures,service}-r29.*.json`).

---

## 0. Regression floor — the R28 VERIFIED set holds on the base

The R28 harness re-run on main @ ab49392 (both boots) confirms the wave-2 state:
`robotoLoaded: true` (O5 fonts), `actionsToPlay: 1` (O2 one-click), fresh boot
`bodyBg rgb(255,255,255)` + `data-theme=light` (O6/N15 light default), hero `null`
+ `feedConfigText: false` (N5/N6), share dialog **470×337 r12 with the full corpus
tile set** (O4), comments section present ("0 Comments" — the honest empty local
transport; O3), service boot 100 real `<img>` thumbs (D15). **No R28 regressions.**
(`base-{fixtures,service}-r29.report.json` + `.corpus.json`)

## 1. D8 — duplicate History in the rail (LIVE)

Rail census (both boots): `Home · Shorts · Watch · Library · History · Offline ·
History · Settings` (+ `Install app` in service mode) — **History ×2**. VLM confirms
two History rows on the fixtures capture. `r29probe.json → checks.rail.historyCount = 2`.

## 2. D14/N21 — player padding 24px (LIVE)

`.wfx-player` padding = **`24px 24px 48px`** (both boots; the corpus documents
**16px** page margins @1440, player @(16,68)). Layout `724px 412px` gap 16px,
stagewrap **724×407 @(264,80)** — the R27/R28 geometry divergence unchanged.
`checks.watchGeometry`.

## 3. N3 — search result rows 360×202 (LIVE)

Fixtures (q=neon, 11 rows) and service (q=rain, 209 rows — q=neon answers 0 on the
service catalog, the fallback is recorded in `checks.searchQueryTried`): row
**1096×248** with thumb **360×202 r12**, title 18/400 — the R27-W2 row grammar.
Corpus (search-anatomy.md): row **1152×281**, thumb **500×281**. The
thumb-geometry delta is live on the base. VLM: horizontal rows, Filters button
present, **no dialog open**.

## 4. N23 — the Filters button is DEAD on the base (LIVE)

`[data-wfx-search-filters]` found (`aria-expanded="false"`); clicking it opens
**NO dialog** (`checks.filters.dialog.found = false`), no controls, no wiring —
a dead pill on both boots. Corpus: 696×518 r12 dialog, 5 groups
(TYPE/DURATION/UPLOAD DATE/FEATURES/PRIORITIZE).

## 5. N9 — the watch action row (LIVE: no split pill, no Download, no kebab)

The watchhead actions row on the base (both boots): **"Like: not available on
this source"** + **"Save: not available on this source"** (static text), Watchlist
save, Save-to-playlist, Share, Mark-as-watched, Stop-and-record-skip pills. **NO
like/dislike split pill** (`checks.likeSplit.likePill = null`), no Download pill,
no watch-row More-actions kebab. Corpus: segmented like/dislike split pill
36–40px r18–20 + Share + Download + Save + kebab, row w≈690 h42.

## 6. N9/D11 — the channel row + Subscribe (LIVE: owner row is the connector truth)

Owner row = monogram avatar + **connector id** (`wfx-experience-service` on
service / `fake-source` on fixtures) + "Playing via embed · …" mode sentence.
No channel name, no subscriber count, **no Subscribe pill** (`checks.subscribe.found = false`,
both boots; VLM on the theater capture: no red Subscribe button). Corpus: avatar
36–40 circular + channel name bold 14–16 + sub count 12 + Subscribe pill h≈36 r18
red #f03-family.

## 7. N9/N10 — description expander (carried, VERIFIED R28)

`.wfx-desc` = `<details>` disclosure, `open=false`, "more" expander text, body
14px/400/20px, collapsed height 64px. R28 N10 verified this panel conformant; the
R29 ask is the full grammar (collapsed 1–2 lines + "...more" inline expander) —
base state recorded for the before/after comparison.

## 8. N24 — no masthead gear menu (LIVE)

Masthead right cluster: "+ Add a feed" (BYOF) · theme toggle · "W Signed out"
badge. **No settings-gear control.** The identity button's own menu (the only
menu that opens from the masthead) carries rows `[Sign in / Create a profile,
Profile & identity settings]` — an account menu, NOT the corpus gear menu
(Your data / Appearance / Display language / Restricted Mode / Location /
Keyboard shortcuts / Settings / Help / Send feedback). `checks.gearMenu` +
`base-service-gear-menu.png` (the menu auto-closed before the screenshot; the
DOM row census is the measurement).

## 9. N12 — no Sign-in pill (LIVE)

The right cluster renders the "W Signed out" badge (175×40 r18, bg #f2f2f2) —
not the corpus compact **"Sign in"** pill (40h r20, border 1px, text #065fd4).

## 10. N25 — the keyboard set beyond m (PARTIAL on base, honestly measured)

Service boot (fixtures in parens): **`m` VERIFIED** (Mute (m) → Unmute (m) label
flip — the R28 result reproduced). **`f` VERIFIED** (fullscreenElement true).
**`t` works** — theater class toggles, stagewrap **1440px full-viewport bleed**
(corpus: **1296px full-content-width** — the geometry diverges; measured
stagewrap 1440 @x120, overflowing the right edge; VLM: player spans edge-to-edge,
secondary column hidden). **`i` NO observable change** — the miniplayer control
does not render in this environment (`pipAvailable` gates it on Document PiP,
absent in headless Chromium; there is NO in-app bottom-right floating persistent
player — the corpus grammar). **`k`, `c`, `j`, `l`, `0`** — no observable state
change (playLabel stays "Play (k)", no captions overlay mounts, no visible
position readout) — the same honest ambiguity R28 recorded: the command channel
round-trips, the visible evidence is iframe-internal.

## 11. N19 — duration badge grammar (LIVE: the "short45s" family)

First card's badge set (fixtures): a **"short45s" transparent text pill 38×43
14px/400** (the type+duration meta pill) + type badge "short" (12/500, **0.8**
alpha, r4, pad 3px 4px) + duration "45s" badge stacked. Service first card
(short): type badge only. Corpus (home-anatomy): ONE corner badge, format
**"0:45"**, 12/500 #fff on **rgba(0,0,0,0.6)**, r4, pad **1px 4px**, 8px inset.
The grammar (format + alpha + pad + stacking) diverges on the base.
VLM: badges read "10h 0m", "48m 6s", "Video" — not the "12:34" format.

## 12. N20 — shorts shelf on home (RE-BASELINED: the shelf EXISTS, geometry diverges)

The R28 matrix row said "WebFlix home has no shorts shelf" — **re-measured on
ab49392: the shelf is present** (`section[data-wfx-row=shorts]` with "Shorts" h2 +
a vertical-card scroller + the "Vertical, swipe-driven — open the short feed"
reason line). Vertical thumbs: **297×528** (fixtures) / **160×284** (service) —
corpus: **208×311** thumb in a 208×387 card, ~4px gutters, 5–6 columns, no
reason line. The row's live delta is the CARD GEOMETRY + the non-YouTube
reason sentence, not shelf absence. (The R28 row's observation was recorded
before the shelf shipped to main — the corpus sheet's shelf grammar remains the
contract.)

## 13. N13 — rail grammar (LIVE, honest mapping)

Items: Home · Shorts · Watch · Library · History · Offline · History · Settings
(· Install app service-only). No Subscriptions, no You, no Explore, no
More-from-YT, no footer links — the known honest-mapping delta (D6) + the
addable-parity sections.

## 14. O6 — the raised-gray residual (LIVE, methodology-bounded)

My pixel census (3px grid, bucket-precise classifier — `r29-pixels.py`):
service light home = 55.0% white field + 27.7% colorful (real artwork) +
**6.6% raised-gray total** (4.6% #272727-family + 2.0% #f2f2f2-family — note:
the artwork's own dark tones mix into the dark-gray bucket; the R28-C classifier
measured 7.7% at 96bb075, B's own claimed 5.0% — the number is
instrument-dependent, the qualitative residual is stable). Fixtures light home:
2.0% raised (gradient placeholders carry no raised surfaces). YouTube corpus
reference: 4.1% light. **A raised band above the reference remains on the
service field** (chips + card text rows + artwork tones).

## 15. N29 — the channel slot renders the connector id (LIVE)

Every card's channel slot reads **"From wfx-experience-service"** (service; VLM
confirms) / "From fake-source" (fixtures). No channel-name field exists in the
service items — the honest connector truth fills the slot. 3/3 sampled.

## 16. D3 — mic absent (LIVE)

No mic/voice control in the masthead (both boots; VLM: no mic in the top bar,
only the search magnifier). Corpus: mic 40×40 r100 bg rgba(0,0,0,0.05) — the
anatomy is fully specified (N1); B may ship it only with a REAL speech transport.

## 17. meta-theme-color stale (LIVE)

`meta[name=theme-color]` = **#0f0f0f** while the fresh boot renders
`data-theme=light` + `bodyBg rgb(255,255,255)` (both boots) — the small COS
residual R28 recorded on O6's row.

---

## The verdict table (base state → the R29 wave's starting line)

| row | expected red | measured on base @ ab49392 | status |
|---|---|---|---|
| D8 History ×2 | red | History ×2 both boots | **LIVE** |
| D14 player pad 24px | red | `24px 24px 48px` both boots | **LIVE** |
| N3 search 360×202 | red | 1096×248 rows, 360×202 thumbs, both boots | **LIVE** |
| N9 action row | red | text-absent likes, no split pill/Download/kebab | **LIVE** |
| N9/D11 channel row + Subscribe | red | connector-id owner row, no Subscribe | **LIVE** |
| N23 filters dead | red | button renders, no dialog, no wiring | **LIVE** |
| N24 gear menu | red | identity menu only, no corpus gear rows | **LIVE** |
| N12 sign-in pill | red | "Signed out" badge, no CTA | **LIVE** |
| N25 keyboard > m | partial | m+f VERIFIED; t works (1440 ≠ 1296); i/k/c/j/l/0 unproven | **LIVE** |
| N25 miniplayer | red | Document PiP-gated; no in-app floating player | **LIVE** |
| N19 duration badge | red | "short45s" + 0.8-alpha stacked badges | **LIVE** |
| N20 shorts shelf | re-baselined | shelf EXISTS; card 160×284/297×528 ≠ 208×311 | **GEOMETRY DELTA** |
| N13 rail set | red | Watch/Offline/Settings mapping, no Explore/footer | **LIVE** |
| O6 raised-gray | red | 6.6% (my census) vs 4.1% YT light | **LIVE (bounded)** |
| N29 channel slot | red | "From wfx-experience-service" ×3 | **LIVE** |
| D3 mic | red | absent | **LIVE** |
| meta-theme-color | red | #0f0f0f stale on light boot | **LIVE** |

The second-order wave's red set is confirmed live on the base. The loop is armed.
