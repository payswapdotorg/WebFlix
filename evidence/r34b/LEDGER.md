# R34-B — the findings ledger

Lane `wfx/r34b/accept-j41` · repo `github.com/payswapdotorg/webflix` · base `main @ 09d0205`
(clone verified against `git ls-remote` before checkout; branch carries evidence only —
zero product-code changes) · production target `https://webflix-steel.vercel.app`
(the frozen law, verified live) · run window 2026-09-27T21:5xZ → 2026-09-28T00:26Z UTC.

Every entry below cites its durable artifact under `evidence/r34b/`. Nothing in this
ledger is synthesized; every number is harvested from the product's own typed
instrumentation or read off its captured screenshots.

## A. Environment & lane integrity

| # | finding | evidence |
| --- | --- | --- |
| A1 | Network reachability + base pin: `git ls-remote` resolved `main` HEAD to `09d0205` exactly; branch `wfx/r34b/accept-j41` created from it; working tree differs from base by untracked `evidence/r34b/` only (`git status`; guards.md) | `guards.md` |
| A2 | Production is live and is the R33 head: home + `/shorts` reachable; `/shorts` SSR carries the shortstage attributes; the immutable CSS chunk sha256 `9be6abf6…` (103067 bytes) contains the pointer-events `auto` re-arm rule from R33-A | session survey (STEP ZERO of the fresh-session delta) |
| A3 | The no-battery-change gate: `bun test` = **5256 tests / 1 skip / 0 fail** across 300 files (5255 pass; 33627 `expect()` calls; 273.49 s; bun test v1.3.14). Matches the frozen 5256/1/0 expectation. | `battery-test-summary.txt` |
| A4 | The silent-death symptom reproduced: the FIRST battery attempt died after printing only the banner (40-byte log) — the same OOM-shaped death the prior session recorded; the re-run (nice/ionice, single-lane parallelism) completed in full. No result taken from the dead run. | `battery-test-summary.txt` (note at end) |
| A5 | The single pre-existing skip is the honest R11 webtorrent evaluation skip ("webtorrent native prebuilt unavailable in this environment (reason recorded)") — unrelated to this lane, unchanged. | `battery-test-summary.txt` |

## B. The YouTube-side environmental block (the J41 baseline)

| # | finding | evidence |
| --- | --- | --- |
| B1 | YouTube watch pages never reach a playing state in this sandbox. Two distinct walls, both captured and VLM-quoted verbatim: **"Sign in to confirm you're not a bot — This helps protect our community"** (zoo; persists after clicking the page's own play affordance) and **"Our systems have detected unusual traffic from your computer network"** (rick; quotes the sandbox egress IP). | `YOUTUBE-BLOCK-RECORD.md`; `screenshots/youtube-watch-*.png`; `vlm/*.json` |
| B2 | The block extends into the provider's **embed** surface for 4 of the 5 battery items: zoo, rainbombs, wettest, ed never receive the provider's `playing` broadcast (0/46 walks). VLM reads show the provider's own sign-in wall rendered inside WebFlix's contained embed while the WebFlix shell stays intact (unmute pill present, typed `(buffering)` state shown). | `YOUTUBE-BLOCK-RECORD.md`; `vlm/vlm-wfx-zoo.json`, `vlm/vlm-wfx-wettest.json` |
| B3 | Only `dQw4w9WgXcQ` (rick) passes the provider's embed gate in this environment (22/22 walks broadcast playing) — while the **site-side** attempt for the same video is walled (B1). Embed path and site path are gated independently by the provider; both truths recorded. | `raw/rick-*.json`; `screenshots/youtube-watch-dQw4w9WgXcQ.png` |
| B4 | Consequence: the five YouTube-relative J41 thresholds are not numerically adjudicable here. No YouTube number was fabricated, estimated, or imported from other rounds. | `ACCEPTANCE-SUMMARY.md` |

## C. The walk battery (68 walks, 10 cells, 5 identity pairs)

| # | finding | evidence |
| --- | --- | --- |
| C1 | The frozen protocol walk works end-to-end on production: item hub → `[data-wfx-item-play]` (the one-obvious-play-action, present on **68/68 walks**) → real agent-browser click → the PlayIntentRecorder click-epoch bridge → the player page's typed trace `play-clicked@0` → poll for the provider's own `playing` broadcast → verbatim harvest + screenshot. | `scripts/walk.sh`; every `raw/*.json` |
| C2 | **TTFF, the playable pair (rick, the provider's own playing broadcast from `play-clicked@0`):** cold n=11: p50 **1715.0**, p75 **1792.4**, p95 **1928.1**, min 1533.6, max 2125.8; warm n=11: p50 **1401.3**, p75 **1448.8**, p95 **1571.2**, min 1156.0, max 1790.9. Corroborates the prior session's 1630–1914 / 1261–1474 ms bands (slightly wider; run-to-run provider/network variance). | `TABLES.md` row 2; `raw/rick-*.json`; `aggregate.json` |
| C3 | **Navigation-to-player-visible (p50, typed markers):** 458.8–534.4 ms across all 10 cells (surface-visible − navigation-start; the click→navigation bridge itself is 0–4.2 ms — `originSkewMs` in every trace). | `TABLES.md` row 1 |
| C4 | **Time-to-playable (p50, the shell's `playable-declared`):** 459.0–535.0 ms across all 10 cells — the product declares playable in under ~535 ms regardless of provider cooperation. | `TABLES.md` row 4 |
| C5 | **Startup-failure incidence:** 0/22 on the playable pair. 46/46 on the four provider-refused items (zoo 15, rainbombs 11, wettest 10, ed 10) — environmental provider refusals, with the product holding typed `buffering`, typed containment (`embedContainment: privacy-host`), bound embed control, and the unmute pill on every refused walk (`playerState: buffering`, `unmutePillPresent: true` in every record). | `TABLES.md` row 5; `raw/*.json` harvest fields |
| C6 | **First-frame honesty law holds under refusal:** the product never fakes a frame — the only `first-frame-rendered` markers on refused walks are the `contained-surface-load` form ("the provider's opaque page is the honest observable boundary"), never a synthetic playing claim. | every refused `raw/*.json` |
| C7 | **One trace-origin variance, kept verbatim:** `ed-cold-02.json` carries a direct-navigation trace (`navigation-start@0`, "direct navigation") instead of the click-bridge form — the walk's click still happened (the record's `playActionPresent: true`), the bridge epoch was absent that walk. No number depends on it (the walk is a refusal). | `raw/ed-cold-02.json` |
| C8 | **Sample counts:** rick cold 11 / rick warm 11 / zoo cold 10 (≥10 target met); rainbombs 6+5, wettest 5+5, ed 5+5, zoo warm 5 — each refused walk occupies its full 60 s window; wall-clock + the OOM-prone environment bounded the counts. Recorded, not padded. | `TABLES.md` battery map |

## D. Post-startup rows (the extended observation, rick warm)

| # | finding | evidence |
| --- | --- | --- |
| D1 | **Control response (typed markers):** pause `control-invoked@47878.7` → `control-confirmed@48157.9` = **279.2 ms**; resume `52820.9 → 53054.7` = **233.8 ms** — the provider's own phase answers. | `TABLES.md` row 8; `raw/rick-extended-observations.json` |
| D2 | **First-60 s rebuffer:** 0 events in the uninterrupted playing span (first frame 1739.5 → pause 47878.7). The only rebuffer is the user-initiated resume buffer-fill: `rebuffer-started@52828.1 → rebuffer-ended@53093.6` = **265.5 ms** (0.44% of the 60 s window). Across the 22 playable battery walks: exactly **1 event of 10.6 ms** (`rick-warm-01`, immediately after the playing broadcast). | `TABLES.md` row 6 |
| D3 | **Click-to-audible:** the unmute pill was clicked; the provider answered `muted=false`; the pill retired (final state `pill: false`, phase `playing`). The wall-clock answer latency was echoed to the run's stdout and **not durably captured — a harness gap recorded honestly; no number asserted**. | `TABLES.md` row 3; `screenshots/rick-extended-audible.png` |
| D4 | **Seek response:** the product's typed contract defines the row (`seek-requested`/`seek-confirmed`, `seek-response-latency`), but the extended walk's 50% scrub-bar click produced **no seek markers** — recorded as **not captured**; no number asserted. | `TABLES.md` row 7; `apps/web/src/components/player/PlayerChrome.tsx:643,702` |
| D5 | **Transient recovery:** 5 s offline → online → recovered to `phase: "playing"` (the provider's own resume broadcast; final typed state). | `TABLES.md` row 9; `screenshots/rick-extended-recovery.png`, `-recovery-15s.png` |

## E. The AI-enrichment non-blocking law (J41 clause 7)

| # | finding | evidence |
| --- | --- | --- |
| E1 | On walks that recorded the observation, enrichment (ai-tray / intelligence / live-captions) mounted at **1648.3–1708.8 ms** — at/after the contained first frame of the same walk (0.1 ms after on `rick-cold-00`; ~959 ms after on `rick-cold-01`), never before `playable-declared` (569.1 / 654.1 ms), and never a serial dependency of the playing broadcast (1848.9 / 2125.8 ms). | `TABLES.md` enrichment table |
| E2 | `rick-warm-01` recorded an empty `startupObservations` object — variance kept verbatim, not smoothed over. | `raw/rick-warm-01.json` |

## F. Honest gaps and deviations (the never-fabricate ledger)

| # | deviation | handling |
| --- | --- | --- |
| F1 | YouTube-side baseline: environmentally blocked (B1–B4) | recorded with VLM-quoted evidence; five thresholds marked BLOCKED; no synthesis |
| F2 | Sample-count shortfall vs ≥10/cell on 7 refused cells (C8) | recorded per cell; refusal result is total (46/46) |
| F3 | click-to-audible latency (D3) | round trip proven, latency not asserted |
| F4 | seek response (D4) | not captured; not asserted |
| F5 | realization-switch time (J41 spec's 10th measure row) | not exercised — embed-only content set; recorded as not covered |
| F6 | One silent battery death (A4) + one dead background watcher during the run (relaunched; no records lost — the resumable `cell.sh` skips existing records) | recorded; the final battery completed in full |

## G. The prior-session findings (the J41 battery this lane was handed) — disposition

| prior finding | this session's disposition |
| --- | --- |
| YouTube bot-gate = environmental block | **Confirmed and extended** — both wall forms VLM-quoted; the embed path is gated per-item (B1–B3) |
| WebFlix protocol walk works; play-clicked@0 → provider "playing" = honest TTFF | **Confirmed** — 68/68 walks carry the typed trace (C1) |
| Rick cold 1630–1914 ms / warm 1261–1474 ms | **Corroborated** — cold 1533.6–2125.8 / warm 1156.0–1790.9 (C2) |
| One silent OOM death | **Symptom reproduced** on the battery's first attempt (A4); completed under nice/ionice |
| Ed Sheeran + Wettest City = provider-refused | **Confirmed** — plus zoo and rainbombs refuse identically in this environment (C5) |
| Canonical ids vary across resolutions | The walk registry records both ids per item (canonical + provider ref) in every record's `itemHref`/`providerRef` — no id confusion in the battery |
