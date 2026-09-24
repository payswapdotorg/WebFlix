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

(counted after the verification rounds — see the verification log)

## Verification log (chronological; every B claim gets a row)

| when | B claim | C's check | verdict |
|---|---|---|---|
| seed | — | baseline observation of `main @ ab49392` complete — BASELINE-OBSERVATION.md + `base-{fixtures,service}.r29probe.json` + VLM set; the R28 regression floor holds (fonts/one-click/light boot/share dialog/comments) | n/a — the loop is armed |
