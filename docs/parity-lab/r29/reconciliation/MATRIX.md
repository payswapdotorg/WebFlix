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

---

## SECTION 1 — THE SECOND-ORDER RED SET (the R28 scoreboard's carry-over, re-baselined @ ab49392)

| # | feature | YouTube behavior (corpus citation) | WebFlix state (C's baseline observation @ ab49392) | class | status | verdict notes |
|---|---|---|---|---|---|---|
| D8/N4 | Rail duplicate History | corpus home-anatomy: single History entry | History ×2 (both boots; VLM-confirmed) — `base-*.r29probe.json → rail.historyCount=2` | COS | OPEN | The baseline datum for the B claim. |
| D14/F3 | `.wfx-player` padding | corpus watch-geometry: **16px** @1440 (player @(16,68)) | **`24px 24px 48px`** both boots — `watchGeometry.playerPadding` | PAR | OPEN | Unchanged from R27/R28. |
| N3 | Search result row geometry | corpus search-anatomy: row **1152×281**, thumb **500×281** r12, title 18/400/26 clamp-2, meta 12/400 split-spans | row **1096×248**, thumb **360×202** r12, title 18/400 (fixtures q=neon n=11; service q=rain n=209 — q=neon answers 0 on the service catalog, fallback recorded) | PAR | OPEN | The R27-W2 row grammar; thumb geometry is the live delta. |
| N9-a | Watch action row: like/dislike split pill | corpus watch-page-anatomy: segmented split pill 36–40px r18–20 + Share + Download + Save + "More actions" kebab (row w≈690 h42) | Actions = "Like: not available on this source" + "Save: not available…" static text + Watchlist/playlist/Share/Mark-watched/skip pills; **no split pill, no Download, no kebab** (`watchhead.actionsText`, `likeSplit.*` all null) | PAR | OPEN | The second act's centerpiece row. |
| N9-b/D11 | Channel row + Subscribe pill | corpus watch-page-anatomy: avatar 36–40 circular + name bold 14–16 + sub count 12 + **Subscribe h≈36 r18 red #f03-family** | Owner row = monogram + **connector id** + "Playing via embed·…" mode sentence; **no Subscribe** (`subscribe.found=false`, both boots; VLM: no red Subscribe) | PAR | OPEN | HONESTY GATE for the B claim: the Subscribe pill must be wired to a REAL save/follow capability — a decorative CTA = RED. |
| N9-c | Description "...more" inline expander | corpus watch-page-anatomy: collapsed 1–2 lines + "...more" inline expander 14px/400; expands inline (no dialog) | `.wfx-desc` `<details>` disclosure, open=false, "more", body 14/400/20, h64 (R28 N10 carried VERIFIED) | PAR | **VERIFIED (R28 carry, conformant)** | The R29 ask: full grammar (collapsed lines + "...more" inline) — base state recorded. |
| N23 | Search filters dialog | corpus search-anatomy: **Filters button → 696×518** dialog r12 + corpus shadow; 5 groups TYPE/DURATION/UPLOAD DATE/FEATURES/PRIORITIZE | Filters pill renders (`aria-expanded=false`); click → **NO dialog, no controls, no wiring** (both boots — a dead pill) | PAR | OPEN | HONESTY GATE: every dialog control must be REALLY wired (no dead checkboxes). |
| N24 | Masthead settings gear menu | corpus FEATURE-INVENTORY: gear → multi-page menu: Your data / Appearance (Light↔Dark) / Display language / Restricted Mode / Location / Keyboard shortcuts / Settings / Help / Send feedback | No gear control; the identity button's menu = [Sign in / Create a profile, Profile & identity settings] — an account menu, not the corpus gear set | PAR | OPEN | HONESTY GATE: every gear-menu row must be a real surface or honestly absent. |
| N12 | Sign-in pill (masthead right) | corpus core.json/color-survey: **40h r20, border 1px rgba(0,0,0,0.2), text #065fd4**, "Sign in" CTA | "W Signed out" badge 175×40 r18 bg #f2f2f2 (identity surface, no CTA) | PAR | OPEN | The corpus's logged-out CTA anatomy. |
| N25-a | Player keyboard set | corpus FEATURE-INVENTORY/watch-page-anatomy: k space j l m f t i arrows 0-9 c (labels carry hints) | **m VERIFIED** (Mute→Unmute flip, service boot — R28 result reproduced), **f VERIFIED** (fullscreen), **t works** (theater toggles), **k/c/j/l/0-9 unproven** (no observable state change; the honest R28 ambiguity) | PAR | OPEN (partial: m+f) | The channel is proven for m; B's full-set claim needs per-key evidence. |
| N25-b | Theater mode geometry | corpus watch-page-anatomy: theater → player **1296px full-content-width** | Theater is a REAL mode (class toggle + single-column layout + VLM-confirmed edge-to-edge) BUT stagewrap = **1440px full-viewport bleed @x120** (overflows the right edge) ≠ 1296 content width | PAR | OPEN | Mode real; geometry diverges. |
| N25-c | Miniplayer mode | corpus watch-page-anatomy: "i" → **bottom-right floating player, persistent across navigation** (in-app) | **No in-app floating miniplayer** — the control is Document-PiP-gated (`pipAvailable`), absent in this environment; `i` produces no observable change | PAR | OPEN | HONESTY GATE: theater/miniplayer must be REAL modes (geometry + persistence). |
| N19 | Duration badge grammar | corpus home-anatomy: ONE corner badge bottom-right 8px inset — "0:45" 12/500 #fff on **rgba(0,0,0,0.6)**, r4, pad **1px 4px** | "short45s" transparent text pill (38×43 14px/400) + stacked type badge "short" + duration "45s" (12/500, **0.8** alpha, r4, pad 3px 4px) — VLM: "10h 0m"/"48m 6s"/"Video" formats | PAR | OPEN | Format + alpha + pad + stacking all diverge from the corpus grammar. |
| N20 | Shorts shelf on home | corpus home-anatomy/shorts-anatomy: shelf with **208×387 cards (208×311 9:16 thumbs), ~4px gutters, 5–6 cols**, title below, no badge | **RE-BASELINED: the shelf EXISTS** (`section[data-wfx-row=shorts]`, "Shorts" h2 + scroller) — vertical thumbs **160×284** (service) / **297×528** (fixtures) + the "Vertical, swipe-driven — open the short feed" reason line | PAR | OPEN (geometry + reason-line delta; NOT absence) | The R28 row said "no shorts shelf" — the re-baseline corrects it: the shelf shipped to main after that observation. Corpus grammar remains the contract. |
| N13/D6 | Rail grammar | corpus home-anatomy: Home · Shorts · Subscriptions · You · History → Explore (Music/Movies/Live) → More from YT (Premium/YT Music/YT Kids) → footer links + location + sign-in promo | Home · Shorts · Watch · Library · History · Offline · History · Settings (+Install app service-only) — no Subscriptions/You/Explore/More-from-YT/footer | PAR | OPEN | The honest capability mapping (D6 lineage) + the addable parity sections. |
| O6-res | Raised-gray field residual | corpus color-survey: light raised **4.1%** (≈<5% band) | Service light home: **6.6%** raised by C's r29-pixels census (4.6% dark-family + 2.0% light-family; artwork darks mixed in — methodology-bounded; R28-C's classifier said 7.7% @ 96bb075, B claimed 5.0%) | COS | OPEN | A residual band above the reference remains (chips + card text rows + artwork tones). |
| N29 | Card channel slot | corpus home-anatomy: card meta carries the channel row (avatar 36 + real channel name) | **"From wfx-experience-service"** fills every card's channel slot (service; VLM-confirmed); "From fake-source" (fixtures) | PAR | OPEN | Honest data-truth (no fabricated names — the frozen law); B may resolve a channel-name field if the realization carries one. |
| D3/N1 | Mic (voice search) | corpus core.json: 40×40 r100 bg rgba(0,0,0,0.05), masthead center-right of search | **Absent** (both boots; VLM: no mic in top bar) | PAR | OPEN | HONESTY GATE (the doctrine): B may ship it ONLY with a REAL speech transport — a decorative mic = RED. |
| O6-meta | meta-theme-color follows the boot | (implied by the light logged-out default; color-survey) | `meta[name=theme-color]` = **#0f0f0f stale** while `data-theme=light` + body #ffffff (both boots) | COS | OPEN | The small R28-recorded residual, now its own tracked row. |

---

## SCOREBOARD

**Machine-counted verdict census (this file's Section-1 rows, per `r29-pixels`-style
scripted count over the table cells):**

| measure | count |
|---|---|
| Section-1 rows (the second-order set) | **19** |
| PARITY (PAR) | **16** |
| COSMETIC (COS) | **3** (D8/N4, O6-res, O6-meta) |
| OPEN (red — the baseline-confirmed set) | **18** |
| VERIFIED (green) | **1** (N9-c — the R28-carried description panel, conformant) |
| WONT-FIX honest | 0 (no HD rows in this wave's set yet) |
| B claims pushed to `wfx/r29/web` | **0** |

**The honest closing state of this window:** B's lane `wfx/r29/web` was polled
continuously (30-second intervals, ~2.5 h of polling windows from the baseline
push at `283dbd5` through the final window) and **never appeared on origin** —
zero B commits, zero claims, therefore zero verifications. Per the doctrine, an
unverified fix is a red row and an ABSENT fix is the red row it already was:
every row above stands at its C-measured baseline state (all 18 red rows
confirmed LIVE on `main @ ab49392` in BOTH boots — BASELINE-OBSERVATION.md).
The loop is armed: the instrument (`r29-probe.ts` + `r29-pixels.py` +
`r29-round.sh` over the reused R28 harness) is committed, tested against the
base, and carries the honesty instrumentation (mic getUserMedia/WebSpeech taps,
like-count local-truth read, subscribe real-save click probe, filters
wiring-toggle probe, gear row census, theater/miniplayer geometry + persistence
checks). The next B push verifies through:
`bash evidence/r29-recon/r29-round.sh <sha> <tag> [fixtures|service]`.

**The kept honest red rows (the operator's next ask):** the full Section-1 OPEN
set — action row/channel row (the watch second act), search rows 360×202 +
dead Filters pill, gear menu, sign-in pill, keyboard set beyond m+f, theater
1296-geometry, in-app miniplayer, duration-badge grammar, shorts-shelf card
geometry, rail grammar, duplicate History, player padding 24px, raised-gray
residual, N29 channel slot, mic (honestly absent until a real transport
exists), stale meta-theme-color.

## Verification log (chronological; every B claim gets a row)

| when | B claim | C's check | verdict |
|---|---|---|---|
| seed | — | baseline observation of `main @ ab49392` complete — BASELINE-OBSERVATION.md + `base-{fixtures,service}.r29probe.json` + VLM set; the R28 regression floor holds (fonts/one-click/light boot/share dialog/comments) | n/a — the loop is armed |
| 2026-09-24 (window close) | **none pushed** — `wfx/r29/web` absent from origin across the entire polling window (16 windows × ~9 min, 30s cadence, from lane head 283dbd5 through 31c2670) | nothing to verify; the red baseline stands; the instrument is armed and committed | **no B claims verified — honestly reported, not silently passed** |

---

## DIVERGENCES — for the operator

1. **B's lane never landed in this window.** The R29 second-order implementation
   set (watch second act, search rows + filters, masthead gear + sign-in +
   keyboard + modes, rail/badge/shelf, O6/N29/mic) was issued to lane
   `wfx/r29/web`, which origin never received during ~2.5 h of continuous
   30s-cadence polling. The recon lane's verdict set therefore contains ZERO
   B-side rows — every red row is the baseline truth, honestly kept. (If B's
   session ran long/failed, this is the loud record of it — the operator should
   re-issue or check B's environment.)
2. **N20 re-baseline (a correction to the R28 matrix):** "WebFlix home has no
   shorts shelf" is no longer true on main @ ab49392 — a Shorts shelf section
   IS live (vertical scroller + "Shorts" h2). The R28 row's observation was
   recorded against an earlier main; the row now tracks the CARD GEOMETRY delta
   (160×284 service / 297×528 fixtures vs corpus 208×311 in 208×387, 4px
   gutters, 5–6 cols) + the non-YouTube "Vertical, swipe-driven" reason line.
3. **The raised-gray number is instrument-bound.** C's R29 census (bucket-precise
   classifier, `r29-pixels.py`) reads **6.6%** on the service light home vs the
   R28-C classifier's 7.7% at 96bb075 and B's claimed 5.0% — all against the
   corpus 4.1% light reference. The residual is real but its magnitude depends
   on how artwork-internal darks are classified; a region-scoped (UI-surfaces
   only) survey would settle the operator-facing number if exactness matters.
4. **Theater geometry diverges in kind, not just magnitude:** WebFlix's `t`
   mode is a REAL mode (verified live) but renders a 1440px full-viewport bleed
   (measured stagewrap 1440 @x120 — overflowing the right viewport edge) where
   the corpus records 1296px full-content-width. B's fix should re-anchor the
   mode to the content-width law, not just toggle.
5. **The miniplayer is environment-gated on base:** the control's render is
   gated on Document Picture-in-Picture availability (absent in headless
   Chromium — and not the corpus's in-app bottom-right floating persistent
   player in any case). The corpus grammar (in-app floating + persistence
   across navigation) is the contract; the probe carries the persistence check
   ready.
6. **`k`/`c`/`j`/`l`/`0–9` remain honestly unproven** (no observable state
   change on base; the command channel round-trips through /api/playback but
   the visible evidence is iframe-internal in this egress) — the same ambiguity
   the R28 matrix recorded. B's full-keyboard claim will need per-key visible
   evidence (label flips, overlay mounts, position readouts).

## ESCALATIONS — lead-owned

- The B-lane absence (divergence 1) — the lead owns re-issuing/confirming the
  R29-B dispatch; C's loop is armed and will verify on the next push.
- The N20 re-baseline (divergence 2) touches the R28 matrix's recorded state —
  the lead may want the R28 doc footnoted on the next merge.
