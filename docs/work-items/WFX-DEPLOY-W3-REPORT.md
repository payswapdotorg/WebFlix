# WFX-DEPLOY-W3 — Completion Report (the browser-regression / release-surface lane)

Date: 2026-10-02 · Lane: `work/wfx-deploy-w3-regression` · Base: main @ `fbbef9b`
(verified at setup: the wind-down ledger with R37 + R38-B merged) · HEAD: **`a3743fa`**

## 1. Branch + commits

| Commit | What |
|---|---|
| `75a7e42` | The work order verbatim (`docs/work-items/WFX-DEPLOY-W3.md`, dated 2026-10-02) — the first-commit law |
| `b023820` | The strengthened journey suite (J49 NEW + J40/J41/J43 re-encodes + J36 wait hardening) + the DEPLOYMENT.md accuracy pass |
| `a3743fa` | The r39 evidence packet (the suite's 46/46 GREEN run + the deployment-surface proofs) |

Pushed: `work/wfx-deploy-w3-regression` → origin (no PR, no merge — TL-owned).

## 2. Changed files (all inside the lane's ownership: `journeys/**`, `apps/web/DEPLOYMENT.md`, `evidence/r39/**`, `docs/work-items/WFX-DEPLOY-W3*.md`)

- `journeys/web/j49-deployment-release-surface.ts` — **NEW** (the deployment release surface journey)
- `journeys/web/j40-youtube-parity.ts`, `j41-playback-startup.ts`, `j43-realtime-translation.ts` — re-encoded against the current grammar
- `journeys/web/j36-major-journey-completion.ts` — the three reload-following waits hardened to the navigation-safe fresh-evaluation poll
- `journeys/web/index.ts` — J49 registered + the J49 limitation entry (the production-only PWA behaviors + procedure)
- `journeys/lib/journeys.ts` — the `detailHrefFromSearch` helper (the R28-B deep-surface path)
- `journeys/report.test.ts` — the catalog-integrity test updated (45 → 46, J49 in the set)
- `apps/web/DEPLOYMENT.md` — the accuracy pass (4 verified corrections; see §5)
- `evidence/r39/**` — the evidence packet (207 files; see §8)
- NO changes to `apps/web/src/**`, `packages/**`, `package.json`, `bun.lock`, root tsconfig, or the work-items index (TL-owned surfaces untouched — verified by the diff stat).

## 3. The journey-coverage delta

| Journey | Baseline | Strengthened | The delta |
|---|---|---|---|
| **J49 (NEW)** | — | **PASS 41** | The deployment critical path: the shell nav destinations (Home/Shorts/Subscriptions/Library/Settings/Offline — 7 assertions); the search FORM-SUBMIT path (query → Enter → /search?q= → the results state → open a result — 8); the player's honest resolution mode (`data-wfx-player-mode` embed/browser — 3); **the /api/health contract in-suite** (200 + application/json + the exact frozen body — 3, per the work order's explicit demand); **/offline** (the honest state, zero chrome, ZERO feed content — stale-feed ≠ offline, the inline CSS + retry script in the served HTML, and the retry PROVEN to re-attempt navigation via the reload probe — 14); the PWA laws of this configuration (manifest 200 + media type + standalone + the two 1024 any/maskable icons + the layout link; sw.js served; NO SW registration in dev; NO install chrome in dev — 9). |
| J40 | FAIL 7 | **PASS 41** | The stale-grammar re-encode: search → the card kebab's **Details deep action** → the item hub; the queue-add from the **player's watch kebab** (the R28-B+ placement) with its outcome state; the playlist round trip on the hub's `offerPlaylist` surface; the realization-switch walk through the hub. The full parity walk now runs end to end (was dying at assertion 7 since R28-B). |
| J41 | FAIL 2 | **PASS 46** | The same navigation re-encode; the complete startup marker set asserted again (both benchmark titles). |
| J43 | FAIL 2 | **PASS 38** | The same re-encode + the keyboard-activation path for the chrome-panel translate controls (the card-art layer covers their pointer click points — focus+Enter, the product's own keyboard-operable law). |
| J36 | FAIL 45 | **PASS 50** | The §11 death point FIXED: the three reload-following waits (register / BYOM remove / logout) switched from the navigation-UNSAFE raw wait to the harness's own fresh-evaluation poll (`pollEvalTruthy`) — the documented stale-poll race class. |
| J01–J35, J37–J39, J44–J48 | PASS ×41 | PASS ×41 | Unchanged — **zero regressions**. |

**Suite totals: 45 → 46 encoded journeys; 41/45 PASS → 46/46 PASS; 957 assertions.**

## 4. The deployment-surface verdict table

| Surface | Verdict | Evidence |
|---|---|---|
| /api/health (in-suite, fixtures boot) | **VERIFIED-REPRODUCED** | J49 §2 — 200 + application/json + `{"ok":true,"service":"webflix-web","version":"0.1.0"}` exactly |
| /api/health (production boot, service mode) | **VERIFIED-REPRODUCED** | `evidence/r39/health-offline-pwa/pwa-production-start-verification.md` §1 |
| /api/health (the live steel deployment) | **OBSERVED** | `evidence/r39/production-sweep.md` §1 — 200, the identical body |
| /offline render (zero configuration, zero chrome, no feed) | **VERIFIED-REPRODUCED** | J49 §3 — 14 assertions incl. the stale-feed exclusions + the inline CSS/script in the served HTML |
| /offline retry honestly re-attempts navigation | **VERIFIED-REPRODUCED** | J49 §3 — the reload probe (the pre-click marker gone after the click, the URL preserved, the state re-rendered) |
| SW offline FALLBACK at the original URL + recovery | **REPRODUCED** | The production-start verification §4–5 + `pwa-offline-fallback.png` / `pwa-offline-recovered.png` (server down → /shorts serves the honest offline shell AT /shorts; server back + Try again → the live feed) |
| SW registration (production + service mode) | **REPRODUCED** | The verification §2 — 1 registration, scope /, **activated**, **controlling** |
| SW NON-registration (the fixtures dev law) | **VERIFIED** | J49 §4 — zero registrations asserted |
| Manifest presence + wiring | **VERIFIED-REPRODUCED** | J49 §4 (served + linked + standalone + the 1024 icons) |
| InstallPrompt island (service mode only) | **VERIFIED-REPRODUCED** | `pwa-prod-installed.png` (the rail's Install app affordance in service mode) + J49 §4 (its fixtures-boot absence) |
| beforeinstallprompt / native install dialog / appinstalled | **UNRESOLVED** (the headless gap — not exercisable headless; the documented limit + the lead's production procedure) | The verification §3 + the J49 limitation entry |
| The update flow (waiting worker → Update available → one reload) | **DOCUMENTED** (the WFX-057 delivery record + the DEPLOYMENT.md procedure; exercising it needs a changed `sw.js` — an `apps/web/public/` change outside this lane's ownership) | The verification's honest-limits section |
| Internal API failure laws (actions/events/shorts) | **VERIFIED-REPRODUCED** | `evidence/r39/health-offline-pwa/api-route-probes.txt` (live: actions malformed→400 ×2; events `type:start`→400 **with the closed-vocabulary reason verbatim**; events valid→200; shorts→200) + `apps/web/tests/adapter-api-routes.test.ts` (machine) |
| DEPLOYMENT.md accuracy | **FIXED-`b023820`** (4 verified corrections) | `evidence/r39/DEPLOYMENT-accuracy.md` — the route inventory completed (9 missing pages, force-dynamic verified per file + the build table), the API table extended 4→21 routes, the "five islands" claim corrected (56 client components), the `#0b0a10`→`#0f0f0f` color corrections + the R29-B theme-color seam |
| The steel deployment's staleness | **OBSERVED** | `production-sweep.md` — `/studio` → **404** (the R38-B surfaces absent): the STALE pre-R38-B designation proven; `/live` + `/channel` present (post-R36/R37) |
| The live Experience API | **OBSERVED** | `production-sweep.md` §2 — health 200 + real catalog search hits |
| The env law / boot law / transport table / Vercel settings rows in DEPLOYMENT.md | **VERIFIED accurate** (no change) | `DEPLOYMENT-accuracy.md` (verified against `src/host/config.ts`, `version.ts`, the route sources) |

## 5. Gates at HEAD (`a3743fa`) — actual numbers

| Gate | Baseline (§1 recorded) | HEAD | Regression? |
|---|---|---|---|
| `bun run typecheck` | CLEAN | **CLEAN** | none |
| `bun run lint` | 116 problems (33e/83w) — pre-existing RED outside the lane (the frozen list) | **33e/83w — the error set BYTE-IDENTICAL to the baseline frozen list** (diff-verified); every file this lane touched lints **0 problems** | none |
| `bun run test` | 5418 / 5417 pass / 1 skip / 0 fail · 34,269 expect() · 316 files | **5418 / 5417 / 1 / 0 · 34,276 expect() · 316 files** — EXACT (the +7 expects are the strengthened catalog test's own assertions) | **none** |
| `bun run contract-check` | OK — 12 frozen blocks, 7 extension types | **OK — 12 frozen blocks, 7 extension types** | none |
| `bun run lane-check` | OK — 1014 files | **OK — 1014 files** | none |
| `bun run journeys:web` | 41 PASS / 4 FAIL (the recorded baseline truth) | **46/46 PASS · 957 assertions** (the chunked sweep; every chunk's verbatim log + manifest committed) | **none — the 4 failures FIXED** |

## 6. HANDOFF list (proposals for the TL; nothing outside the lane's ownership was touched)

1. **The channel route directory rename** — `apps/web/src/app/channel/andle]` is literally
   named `andle]` (a mangled `[handle]` from the R36 lane; its own commit message names it
   verbatim). The ROUTE BEHAVIOR IS CORRECT (`/channel/<any-handle>` renders that channel —
   REPRODUCED live; J44's 57 assertions pass over it) but the build table displays the
   literal segment and a future Next upgrade could tighten the segment parser. A rename is
   an `apps/web/src/app/**` change — TL-coordinated only.
2. **The J43 chrome-panel click-point coverage** — in the live-translate state, an up-next
   card-art layer geometrically covers the pointer click points of the chrome settings
   panel's translate controls (the agent-browser honesty check refuses the click; the
   journey now uses keyboard activation). If the panel's stacking is a product bug (the
   card art above the chrome panel), it belongs to the W1/W2 lanes; if it is accepted
   layout, the keyboard path is the documented user path.
3. **The deployed production check** — the final install/update verification on
   https://webflix-steel.vercel.app after the release deployment (the lead's
   deployed-preview verification per the mission plan; the local production-start evidence
   + the reachability probes are this lane's contribution).
4. **The work-items index** — `docs/work-items/index.md` is TL-owned; this lane's item
   (WFX-DEPLOY-W3) + this report await the TL's index update.

## 7. UNRESOLVED list (honest)

1. **beforeinstallprompt / the native install dialog / `appinstalled`** — not exercisable
   in headless Chromium (the browser does not fire the install-eligibility event headless).
   The procedure: a real desktop Chrome/Edge session against the deployed production URL
   (DEPLOYMENT.md "How to verify install"; the WFX-057 delivery verified it in a real
   session). The lead's deployed-preview check owns the final answer.
2. **The SW update flow end-to-end** (waiting worker → "Update available — Reload" → one
   reload) — requires serving a CHANGED `sw.js` (a `CACHE_VERSION` bump in
   `apps/web/public/sw.js`, outside this lane's ownership). The WFX-057 delivery verified
   it against a local production start; the procedure is documented in DEPLOYMENT.md.
3. **iOS Safari Add to Home Screen** — requires a real iOS device (the documented platform
   limit; unchanged since WFX-057).

## 8. The evidence-packet index (`evidence/r39/`)

- `INDEX.md` — **the packet's map**: every §2 golden-set item → its journey + run log +
  artifacts; every §3 deployment-surface verdict → its evidence file.
- `manifest.json` + `summary.md` — the combined suite manifest (46/46, chunk provenance,
  the chunked-sweep determinism notes) + the summary table + the baseline→strengthened delta.
- `baseline-truth.md` — the §1/§2 baseline numbers verbatim (the gates table + the 4
  baseline failures byte-identical to the standing records).
- `DEPLOYMENT-accuracy.md` — the DEPLOYMENT.md change record (each of the 4 corrections + evidence).
- `production-sweep.md` — the real-platform probes (steel STALE-proven + the live API).
- `health-offline-pwa/` — the live API route probe battery + the production-start PWA
  verification (the WFX-057 procedure EXECUTED: SW activated/controlling, the offline
  fallback at the original URL, the retry recovery, the install affordance) + 3 screenshots.
- `logs/` — every chunk's full runner output verbatim (including the three environmental
  OOM-death runs, preserved honestly, each followed by its recorded GREEN re-run).
- `chunks/` — the per-chunk evidence directories (each journey's screenshot + interactive
  snapshot + narration + the raw chunk manifest + the dev-server log).

## 9. The environmental record (honest)

This 4.16GB box carries the documented heavy-journey OOM class (kernel kills of next-server
at ~2.3–2.5GB anon-rss — the r38b base-identical record). The sweep ran chunked (the
documented r38b procedure); three runs died in the class mid-walk (preserved in
`logs/j40j41j43.run.log`, `logs/j40.run.log`, `logs/j49.run.log`, `logs/j49.run2.log`);
every affected journey was re-run to its recorded GREEN result the same session (the
warm-cache/cold-cache procedure notes ride the run logs). J36's baseline §11 wait-race
failure is FIXED by this lane's hardening (the 45-assertion death point is past — 50
assertions recorded); its remaining sensitivity is the pure memory ceiling, documented.
