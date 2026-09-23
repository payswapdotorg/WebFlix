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
| O1 | **Hover thumbnail preview** ("hovering over thumbnails doesn't display gifs") | **corpus: A@f3dc4ba `raw/hover-search-result2.during.json`** — dwell **~147ms** → `ytd-video-preview` singleton overlay mounts → **~193ms** inline `video-stream.html5-main-video` + `#inline-preview-player` (ytp-hide-controls); preview box **524×305** | 3.6s dwell on `.wfx-card` → **0 videos, 0 gifs, `.wfx-cardpreview` ×11 ALL EMPTY (0 children)**; thumbs are CSS gradient + initials. `evidence/r28-recon/baseline/hover-dwell-1.6s.png` + BASELINE-OBSERVATION §3 | OB | OPEN | YouTube mounts the preview video in <200ms; WebFlix never mounts any media. A's probe saw the video element mount with `src:""` (streamingData stripped by the bot-gate — the MECHANISM is the truth: overlay+video in ~150-200ms). |
| O2 | **Clicks to play** ("you have to click 3 times before a video plays") | Card click (1) → watch page opens with media starting | C's trace: card click (1) → `/item` interstitial (no media) → Play click (2) → `/player` chrome w/ iframe + **`Play (k)` button still required (3)**; fixture provider network-blocked on top. `evidence/r28-recon/baseline/item-interstitial.png`, `player-step3.png` | OB | OPEN | The `/item` interstitial is structural friction YouTube has no analog for. Confirms lead's production recon. |
| O3 | **Comments** ("there's no comments") | Comments section under the player: 20px/400 heading + list + composer (corpus watch-geometry.md) | 0 comment elements on `/watch`, `/player`, AND `/item`; no region/heading/list/composer anywhere. BASELINE-OBSERVATION §4 | OB | OPEN | R27 logged this as "honest omission" (DIVERGENCES #9) — the operator has OVERRULED that: comments are now required parity. Re-triaged OB. |
| O4 | **Share** ("sharing doesn't work the same") | Share modal: social-target row + Copy (clean short URL) + Embed + Start-at | `<details>` popup on BOTH `/item` AND `/player` (C's first snapshot missed the folded `<summary>` — corrected by the harness re-run; truth over speed). Contents: 2 controls — "Copy WebFlix link" + "Open on fake-source"; raw internal path with all params (`/item?id=...&connector=...&ref=...`); NO embed, NO start-at, NO social targets. `evidence/r28-recon/baseline/share-popup.png` + `verifications/baseline-seed.report.json` | OB | OPEN | Confirms lead's recon (the "Copy WebFlix link" button). Also a URL-design gap (share target is an internal param-laden route, not a stable public short URL). |
| O5 | **Theme + fonts** ("the theme and fonts used are not the same") | **corpus: A@f3dc4ba `raw/search-light.core.json`** — `document.fonts` = **Roboto 300/400/500/700 (+italics) + YouTube Sans 300–900 + Roboto Mono**; 3 Roboto woff2 ACTUALLY loaded from fonts.gstatic.com; root stack `Roboto, Arial, sans-serif` @ 10px root | `font-family: Roboto, Arial, Helvetica, sans-serif` declared but **`document.fonts` = Geist×4 only — Roboto NEVER loaded** → OS fallback rendering. BASELINE-OBSERVATION §1 | OB | OPEN | YouTube serves+loads Roboto; WebFlix declares and never loads. Fix = next/font/google Roboto 400/500/700 self-hosted. YouTube Sans is trade-dress (HONEST IDENTITY) — Roboto-only is the honest parity. |
| O6 | **Background color** ("the background color is different") | Dark field `#0f0f0f` dominant (64% of pixels in corpus dark capture); light `#ffffff`/`#f9f9f9` | Tokens correct (`#0f0f0f` dark / `#ffffff` light) BUT field composition: **26% `#0f0f0f` + ~47% elevated grays (#272727-class)** — hero panel + gradient placeholder thumbs + config panels dominate the first screen. BASELINE-OBSERVATION §6 + pixel survey | OB | OPEN | The token is right; the FIELD is wrong. Root causes: the 1200×775 hero, the gradient placeholder thumbs (no real artwork in fixtures), and the feed-config stack above the grid. |
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
| D6 | Rail entry "Subscriptions" | corpus rail: Home · Shorts · Subscriptions · You… | "Watch" (long-form browse) instead | PAR | OPEN | Honest mapping, but operator-visible. A's R28 rail sheet decides the exact anatomy; B could rename/extend if a subscription-equivalent surface exists. |
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
| L1 | fonts declared-not-loaded | document.fonts EMPTY of Roboto; OS fallback | **REPRODUCED** — document.fonts = Geist×4; fontFamily declares Roboto | OB | OPEN | = O5. |
| L2 | 3-click play (card → /item → Play → player) | measured on production | **REPRODUCED** — trace in BASELINE §2 (+ Play (k) still pending = 3rd action) | OB | OPEN | = O2. |
| L3 | home = 1184px hero + "What your feed shows" above grid | measured 1184 | **REPRODUCED** — 1200×775 hero + feed-config radios + Personalize line + chips, grid starts ~1084px | OB | OPEN | = O6 driver + O7 rows N5/N6. |
| L4 | share = "Copy WebFlix link" button | observed | **REPRODUCED** — details popup, 1 button, raw param-laden path, player page has none | OB | OPEN | = O4. |
| L5 | comments absent | observed | **REPRODUCED** — 0 comment surfaces anywhere | OB | OPEN | = O3. |
| L6 | hover preview absent | observed | **REPRODUCED** — 3.6s dwell, 0 media, empty preview scaffolding | OB | OPEN | = O1. |
| L7 | dark body #0f0f0f token-correct | measured | **REPRODUCED** + nuance: field composition 47% elevated gray (pixel survey) | OB | OPEN | Token ✓, field ✗ → O6. |

---

## SECTION 5 — Worker A's FEATURE-INVENTORY.md (lane `wfx/r28/corpus`)

**Status: lane not pushed at matrix seed (fetch loop running).** Every sheet A
lands extends this section — each YouTube feature row gets the same columns and
cites A's sheet + measured value. Placeholder until first fetch lands:

| # | feature | YouTube behavior (A's sheet) | WebFlix state | class | status | verdict notes |
|---|---|---|---|---|---|---|
| N1 | Mic button anatomy | **corpus: A@f3dc4ba core.json** — 40×40, radius 100px, bg `rgba(0,0,0,0.05)` (light) | Absent | PAR | OPEN | = D3. Anatomy now fully specified by A. |
| N2 | Notifications bell anatomy | `corpus: PENDING-A` (not in A's first sheet — logged-out surface hides it) | Absent | PAR | OPEN | = D4. A's bot-gate (Sign-in-to-confirm wall) limits logged-in chrome observation; the bell is logged-in-only chrome. |
| N3 | Search result row anatomy | **corpus: A@f3dc4ba search.json** — row **1152×281**; thumb **500×281 radius 12px**, img 720×404 object-fit cover; title **18px/400/26px** #0f0f0f clamp 2; meta 12px/400/18px #606060; channel name 12px/400 #606060; avatar **24×24**; snippet 12px/18px clamp 2; live badge | C's base check: search rows exist w/ 360×202-class grammar (R27 sheet); needs re-measure against A's row spec on the live app | PAR | OPEN | The R27 corpus sheet (360×202) was a different capture; A's live 1440 measure is 500×281 — B's search rows must be re-verified at these dims. |
| N4 | Rail duplicate History | single entry | History ×2 | COS | OPEN | = D8. |
| N5 | Home hero ("Featured" panel) | YouTube home has NO hero — chips + grid immediately | 1200×775 hero above grid | OB | OPEN | Operator-visible structural difference (O-look). |
| N6 | Feed-config panel above grid ("What your feed shows" / For you / Following / …) | YouTube home has no feed-config stack | radios + Manage-feeds link + "Personalize · Balanced" | OB | OPEN | Operator-visible (O-look). YouTube personalization is implicit (chips). |
| N7 | Real artwork in feed | real thumbnails | gradient placeholders | OB | OPEN | = D15. |
| N8 | Share control placement + anatomy | watch action row carries Share; modal with socials + embed + start-at | Share `<details>` popup present on `/item` AND `/player` (corrected); 2 controls, no embed/start-at/socials | OB | OPEN | = O4. |
| N9 | Like/dislike segmented pills | corpus owner row: like/dislike segmented | "Like: not available on this source" text only | PAR | OPEN | Corpus anatomy exists (R27 watch-geometry). `corpus: PENDING-A` for full sheet. |
| N10 | Description panel | corpus: description panel 14px/20px below actions | Absent on /player (no description block) | PAR | OPEN | Corpus-carried; operator-visible. |
| N11 | Comments anatomy (headers/threads) | **corpus: A@f3dc4ba cssmined.json** — `ytd-comments-header-renderer` margin-top 24px / margin-bottom 32px; `ytd-comment-thread-renderer` margin-bottom 16px | 0 comment elements anywhere | OB | OPEN | = O3. A's css-mined live rules give the exact spacing contract. |
| N12 | Sign-in button (right cluster) | **corpus: A@f3dc4ba core.json** — 40px height, radius 20px, color `#065fd4`, 14px/500, border 1px rgba(0,0,0,0.2) | "Signed out" + avatar badge (no CTA button) | PAR | OPEN | Operator-visible chrome delta; the anatomy is specified. |
| N13 | Rail geometry + items | **corpus: A@f3dc4ba core.json** — drawer 240px, items 40px height radius 10px, text 14px/400/20px; first items Home · Shorts · Subscriptions · You · History · Music · Movies · Live | Rail 240px ✓ item-height ~40 ✓ but item SET differs (Watch/Offline/Settings, no Music/Movies/Live/Show more) | PAR | OPEN | The item-set delta is the known honest mapping (D6) + missing Explore section. `corpus: PENDING-A` for the full logged-in guide. |

---

## SCOREBOARD

| measure | count |
|---|---|
|  Total rows | 7 + 21 + 5 + 7 + 13 = **53** |
| OPERATOR-BLOCKING (OB) | **12** (O1–O7, D9, D15, L-series dedup into O-series) |
| PARITY (PAR) | **13** |
| COSMETIC (COS) | **2** |
| HONEST-DIVERGENCE (HD) | **10** (4 WONT-FIX honest accepted, 6 open-lead/env) |
| CLOSED on base | **4** (D5, D18, D20, F1) |
| VERIFIED (green) | **0** — no B fixes have landed yet (lane `wfx/r28/web` not pushed at seed) |

**The red core (the operator's first screen, 30 seconds in):** no hover preview,
3 clicks to a play attempt, no comments, a one-button share with a raw internal
URL, no Roboto loaded, a hero + config wall of #272727 where YouTube has a
chips+grid field of artwork on #0f0f0f.

---

## Verification log (chronological; every B claim gets a row)

| when | B claim | C's check | verdict |
|---|---|---|---|
| seed | — | baseline observation of `main @ 3304b65` complete (BASELINE-OBSERVATION.md) | n/a |
