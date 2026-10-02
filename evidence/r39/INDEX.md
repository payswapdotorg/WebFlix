# R39 — THE WFX-DEPLOY-W3 EVIDENCE PACKET (the browser evidence for the release)

**Lane:** `work/wfx-deploy-w3-regression` (base main @ `fbbef9b` — the wind-down ledger
with R37 + R38-B merged, verified at setup) · **The work:** the browser journey coverage,
the deployment-assumption verification, and the browser evidence packet for the WebFlix
deployment release (WFX-DEPLOY-W3, dated 2026-10-02).

**The suite verdict: 46/46 journeys PASS · 957 assertions · 0 failures** (the strengthened
suite; the baseline truth it improved on: 41 PASS / 4 FAIL — see `baseline-truth.md`).

## The §2 golden set → evidence map (every release critical-path item)

| Release critical-path item | Journey (assertions) | The run record | The per-journey artifacts |
|---|---|---|---|
| Home (rows / composition / intent entry) | J02 (12) | `logs/j01-j10.run.log` | `chunks/j01-j10/j02-*.png/.snapshot.txt/.narration.txt` |
| Home nav (the shell destinations) | **J49 §1 (7)** | `logs/j49.run3.log` | `chunks/j49/j49-*.png/.snapshot.txt/.narration.txt` |
| Search: query → SUBMIT → results → open result | **J49 §5 (8)** + J05 (7) | `logs/j49.run3.log` + `logs/j01-j10.run.log` | `chunks/j49/…` + `chunks/j01-j10/j05-…` |
| Watch browse (cards open, rows) | J03 (6) | `logs/j01-j10.run.log` | `chunks/j01-j10/j03-…` |
| Shorts feed (loads, next item, controls) | J04 (13) | `logs/j01-j10.run.log` | `chunks/j01-j10/j04-…` |
| Item detail (metadata, related, player entry) | J06 (13) | `logs/j01-j10.run.log` | `chunks/j01-j10/j06-…` |
| Player resolution-state honesty | **J49 §5 (3)** + J07 (12) + J08 (9) + J09 (13) | `logs/j49.run3.log` + `logs/j01-j10.run.log` | `chunks/j49/…` + `chunks/j01-j10/j0[789]-…` |
| /api/health contract (in-suite, per the work order) | **J49 §2 (3)** | `logs/j49.run3.log` | `chunks/j49/…` |
| /offline render + honest retry (stale-feed ≠ offline) | **J49 §3 (14)** | `logs/j49.run3.log` | `chunks/j49/…` |
| PWA surfaces (this configuration's laws) | **J49 §4 (9)** | `logs/j49.run3.log` | `chunks/j49/…` |
| The full parity walk (search→hub→play→controls→queue/watchlist/playlist→shorts→feedback→library) | J40 (41) — the re-encode | `logs/j40.run2.log` | `chunks/j40/…` |
| Playback startup (the marker set, measured) | J41 (46) — the re-encode | `logs/j41.run.log` | `chunks/j41/…` |
| Realtime translation (the bridge walk) | J43 (38) — the re-encode | `logs/j43.run.log` | `chunks/j43/…` |
| Major journey completion (no dead ends) | J36 (50) — the hardened waits | `logs/j36-warmup.run.log` | `chunks/j36-warmup/…` |
| The rest of the catalog (J01, J07–J35, J37–J39, J44–J48) | all PASS, zero regressions | `logs/*.run.log` | `chunks/*/…` |

## The §3 deployment-surface verdicts → evidence map

| Surface | Verdict | The evidence |
|---|---|---|
| /api/health (fixtures boot, in-suite) | VERIFIED-REPRODUCED | J49 §2 (3 assertions: 200 + application/json + the exact body) |
| /api/health (production boot, service mode) | VERIFIED-REPRODUCED | `health-offline-pwa/pwa-production-start-verification.md` §1 |
| /api/health (the live steel deployment) | OBSERVED | `production-sweep.md` §1 |
| /offline render (zero config, zero chrome, no feed) | VERIFIED-REPRODUCED | J49 §3 (14 assertions incl. the stale-feed exclusions) |
| /offline retry actually re-attempts navigation | VERIFIED-REPRODUCED | J49 §3 (the reload probe: the pre-click marker gone after the click, URL preserved, state re-rendered) |
| The SW offline FALLBACK at the original URL + recovery | REPRODUCED | `health-offline-pwa/pwa-offline-fallback.png` + `pwa-offline-recovered.png` + the verification record §4–5 |
| SW registration (production + service mode) | REPRODUCED | `health-offline-pwa/pwa-production-start-verification.md` §2 (activated + controlling) |
| SW NON-registration (the fixtures dev law) | VERIFIED | J49 §4 (zero registrations asserted) |
| Manifest presence + wiring | VERIFIED-REPRODUCED | J49 §4 (served 200 + media type + standalone + the two 1024 icons + the layout link) |
| InstallPrompt mounting (service mode only) | VERIFIED-REPRODUCED | `pwa-prod-installed.png` (the rail's Install app affordance) + J49 §4 (its fixtures-boot absence asserted) |
| beforeinstallprompt / native install / appinstalled | UNRESOLVED (headless gap — the documented limit + procedure) | `health-offline-pwa/pwa-production-start-verification.md` §3 + the limitations manifest |
| The update flow (waiting worker → Reload) | DOCUMENTED (the WFX-057 record + procedure; needs a changed sw.js — outside this lane's ownership) | `health-offline-pwa/pwa-production-start-verification.md` (honest limits) |
| The internal API failure laws (actions/events/shorts) | VERIFIED-REPRODUCED | `health-offline-pwa/api-route-probes.txt` (live) + `apps/web/tests/adapter-api-routes.test.ts` (machine) |
| DEPLOYMENT.md accuracy | FIXED (4 verified corrections) | `DEPLOYMENT-accuracy.md` (the change record) |
| The steel deployment's staleness (pre-R38-B) | OBSERVED | `production-sweep.md` §1 (/studio → 404) |
| The live Experience API | OBSERVED | `production-sweep.md` §2 |

## The packet's files

- `manifest.json` — the COMBINED run manifest (all 46 journeys, schema
  `wfx-journey-manifest/1`, chunk provenance per journey, the chunked-sweep determinism
  notes). The RAW per-chunk manifests live verbatim under `chunks/<name>/manifest.json`.
- `summary.md` — the suite summary table + the baseline→strengthened delta.
- `baseline-truth.md` — the §1/§2 baseline numbers recorded before any change (the gates
  table + the 4 baseline failures byte-identical to the standing records).
- `DEPLOYMENT-accuracy.md` — the DEPLOYMENT.md change record (each change + evidence).
- `production-sweep.md` — the real-platform probes (steel + the live API).
- `health-offline-pwa/` — the API route probe battery + the production-start PWA
  verification (the WFX-057 local procedure, executed: SW activated/controlling, the
  offline fallback at the original URL, the retry recovery, the install affordance).
- `logs/` — every chunk's full runner output, verbatim (including the environmental
  OOM-death runs `j40j41j43.run.log`, `j40.run.log`, `j49.run.log`, `j49.run2.log` —
  preserved honestly, each followed by its recorded GREEN re-run).
- `chunks/` — the per-chunk evidence directories (each journey's screenshot + interactive
  snapshot + narration + the chunk's raw manifest + the dev-server log).

## The environmental record (honest)

This 4.16GB box carries the documented heavy-journey OOM class (the r38b base-identical
record: kernel kills of next-server at ~2.3–2.5GB anon-rss). The sweep ran chunked (the
documented procedure); three runs died in the OOM class mid-walk (preserved in logs/);
every affected journey was re-run to its recorded GREEN result the same session. J36 and
J40 needed the warm-cache procedure (the failed run primes the Turbopack incremental
cache; the recorded run passes) — the same class the r38b lane documented, now with the
fixes this lane shipped (the J36 §11 wait race is FIXED — the baseline's deterministic
45-assertion death point is past, 50 assertions recorded).
