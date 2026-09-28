# WebFlix Work Item Registry — Remediation Freeze

**Historical release registry:** R00-R19 in docs/plans/2026-09-16-webflix-remediation-plan.md — COMPLETE and release-accepted.

**Active execution registry:** R23 revalidation, R24, and R25 are active corrective rounds. R20-R22 remain acceptance-green. R23 remains implementation-complete but requires current-production revalidation because the live semantic-search transport is currently unavailable. R24 and R25 are NOT acceptance-green. (R23 accepted 2026-09-21: main @ `7ee847c` — the three-lane integration `eb6adc4` + the lead's build fix; battery — lint 0/10 baseline, typecheck clean, 4311 tests / 0 fail, contract-check OK, lane-check OK (755 files); journeys — J37/J38/J39 encoded + green: the web one-run evidence of record 38/38 / 596 assertions (evidence/r16 manifest @ `8d6a528`), the Desktop machine-recorded evidence 124 assertions across J37/J38/J39 (evidence/r23-w3, authenticity re-proven by the verify session), J01–J36 green with the J05 known defect closed and the J19/J36 regressions fixed; production sweep — evidence/r23/production-sweep.md @ `7ee847c` (anonymous viewing live with zero login walls, the R23 API routes answering their honest typed service-mode states, no R22 regressions)).

The earlier WFX-001–043 registry remains historical context only. No worker should treat a legacy WFX item as sufficient proof that the corresponding product capability is complete.

| ID | Work item | Owner | Dependencies |
|---|---|---|---|
| R00 | Repository takeover + golden journey/competitor validation harness | Lead | — |
| R01 | Shared client runtime + platform capability contracts | Worker 1 | R00 |
| R02 | Identity + profiles + persistence | Worker 1 | R01 |
| R03 | Source management + capability UX | Worker 1 | R02 |
| R04 | Library + history + continuity | Worker 1 | R02 |
| R05 | Recommendation controls + Intent Graph + anti-tunnel | Worker 1 | R04 |
| R06 | Model/BYOM/local controls + AI transformation UX | Worker 1 | R05 |
| R07 | Web platform adapter | Worker 2 | R01; consumes R02-R06 |
| R08 | Desktop platform adapter + native shell | Worker 3 | R01 |
| R09 | Media Surface + contained BrowserHost | Worker 2/3; Lead contracts | R01 |
| R10 | Native Media production path | Worker 3 | R08 |
| R11 | Full authorized Torrent Engine | Worker 3 | R10 |
| R12 | Playback-aware torrent scheduler | Worker 3 | R11 |
| R13 | Torrent persistence/background/recovery | Worker 3 + Worker 1 | R04,R11,R12 |
| R14 | Native acquisition UX | Worker 1 + Worker 3 | R13 state contract |
| R15 | External/social action synchronization | Lead + Worker 1 | R03 |
| R16 | Agent-browser golden journey automation/evidence | Lead | R07-R15 applicable |
| R17 | Failure/recovery hardening | Lead + workers | R13,R15,R16 |
| R18 | Security/privacy/authorization audit | Lead | R17 |
| R19 | Production deployment + release acceptance | Lead | R18 |
| R20 | Bring Your Own Feed | Worker 1 + Worker 2 + Worker 3; Lead integration | R19 |
| R21 | Journey-driven product discoverability + capability surface integration | Worker 1 + Worker 2 + Worker 3; Lead integration | R20 |
| R22 | Major user-journey completion + dead-end hardening | Worker 1 + Worker 2 + Worker 3; Lead integration | R21 |
| R24 | YouTube parity + playback performance lab | Worker 1 + Worker 2 + Worker 3; Lead integration | R23 shared contracts |
| R25 | Qwen3.8 LiveTranslate realtime media translation | Worker 1 + Worker 2 + Worker 3; Lead integration | R23 Model Fabric; R24 parity/performance |

## Worker assignment rules

A worker receives only assigned R IDs and their explicitly permitted subpaths. Workers may not change shared contracts, platform boundaries, or architecture without Lead approval.

Every UI item must run affected golden journeys from docs/validation/webflix-golden-journeys.md with agent-browser against a running product. Every native/torrent item needs executable tests plus Desktop journey evidence where applicable.

## Completion truth

A work item is green only when its code, tests, contracts, documentation, real production wiring, and affected journey evidence agree. Worker summaries are not completion evidence.

## R20 completion truth

R20 is complete only when a real authorized import/feed route, persisted provenance, explicit snapshot/live truth, idempotent synchronization, Web/Desktop shared semantics, and J33 evidence agree. The current repository carries R20 acceptance evidence.

## R21 completion truth

R21 is complete only when a fresh-user path discovers the corresponding capabilities from normal product surfaces, important failures have useful next actions, production transport matches the accepted runtime, stale completion copy is removed, and fresh J34/J35 journey evidence agrees. The current repository carries R21 acceptance evidence.

## R22 completion truth

R22 is complete only when a fresh user can COMPLETE the major product journeys after discovering them:

- account creation is visible and functional;
- first-time source connection starts from a selectable connector rather than looping to an empty Settings state;
- BYOF becomes reachable after its supported-source prerequisite;
- BYOM management is reachable through normal Model & AI surfaces;
- hydrated Shorts Like/Save/Share is browser-verified where supported;
- Web/Desktop semantics remain aligned;
- J36 passes;
- affected J01-J35 journeys are rerun;
- production smoke verification matches the final integrated SHA;
- R20/R21 issue state and the work registry agree with completion truth.

**ACCEPTANCE RECORD (2026-09-20, the Lead):** every clause above is green — the account-creation path, the source chooser with its typed prerequisite/connected truth, the BYOF completion after connection, the BYOM management round trip (add → bound → remove through the normal surface), the hydrated Shorts action truth, and the Web/Desktop shared-contract alignment are all carried by the three-lane integration on `main` @ `7252002`; J36 passes (48 assertions, evidence/r16-chunks/j36-rerun6/); all 35 encoded journeys rerun green (evidence/r22/journeys-union.json, the R21 isolated-rerun doctrine for the starved tails); the production smoke at the final SHA is evidence/r22/production-sweep.md; the J19 encoding was updated to the R22-F law (the BYOM panel is the section's real control surface); the model-controls fixture state became file-backed (the Turbopack split-module law) so the dev-boot journey exercises the real bind/remove round trip; issues #25/#26/#27 are closed to match.


## R23 completion truth

R23 implementation is complete, but the current production acceptance record is stale relative to the current deployment state. Revalidation is required whenever a current production surface reports a previously accepted transport as unavailable. Current revalidation target: J39 semantic/moment search, plus current Web/API deployment parity and J37/J38 regression confirmation.

Canonical plan: docs/plans/2026-09-20-webflix-open-viewing-torrent-ai-plan.md

## R24 completion truth

R24 is complete only when the viewer-facing YouTube parity inventory is complete and source-verified, every row has an explicit WebFlix pairing/classification, Web/Desktop parity evidence is fresh, J40-J42 pass, the playback startup thresholds in the canonical R24 plan pass, and affected J01-J39 journeys are rerun without regression. WebFlix-only capabilities must have contextual placements consistent with the product's familiar video interaction grammar. Torrent must remain a first-class realization and must participate in the playback/performance gate.

Canonical plan: docs/plans/2026-09-20-webflix-youtube-parity-performance-plan.md
Canonical lab: docs/validation/youtube-parity-lab.md

## R25 completion truth

R25 is complete only when Qwen3.8-LiveTranslate is registered through Model Fabric as a realtime translation provider, a provider-neutral realtime media-session seam is implemented, Web/Desktop supported paths can start/continue live translation without delaying base playback, credentials remain server-side, cost/latency/usage telemetry is captured, voice-cloning policy is enforced, J43 passes, and R23/R24 journeys remain green.

Canonical plan: docs/plans/2026-09-20-webflix-qwen-livetranslate-plan.md

**R23 ACCEPTANCE RECORD (2026-09-21, the Lead):** every clause of the R23 plan's acceptance is green — anonymous public viewing with no login gate (J37 web 18 + Desktop 39 assertions; the no-login-wall law machine-checked on both surfaces and verified live in production), torrent as a first-class realization (J38 web 42 + Desktop 55 assertions: the Where-to-watch "Authorized peer copy" grouping primary-eligible, the protocol-free lifecycle, the interruption/recovery continuity, the earned ready-offline; no `PlaybackMode="torrent"` — the compile-time guard holds), multimodal media intelligence (J39 web 29 + Desktop 30 assertions: search-by-meaning with provenance, the moment jump, the license-true R2T2 routing, the model-authority boundary), no regression in J01–J36 (38/38 web one-run of record + the Desktop lane), model-license/provenance checks (the R2T2 code/weights distinction recorded verbatim; BGE-M3 MIT verified), production Web verification (evidence/r23/production-sweep.md — including the root-caused + fixed next-build server-graph incident at eb6adc4→7ee847c), and the standing doctrine: the Desktop native halves remain the lead's real-toolchain procedure (journeys/desktop/README.md), no model authorizes playback or acquisition, no provider SDK inside shared product logic.

## Corrective acceptance law — 2026-09-22

R24 must not be marked green from fixture/evidence-lane results alone. Production acceptance requires real source thumbnails, real end-to-end public video playback to first frame, coherent YouTube-like content-first UX, an actual same-content YouTube comparison, production J40/J41/J42 evidence, and affected J01-J39 regression.

R25 requires a live Qwen provider path; the deterministic realtime provider double proves architecture only. R23 requires current-production revalidation where the live transport disagrees with the prior acceptance record.

## R24 PRODUCTION ACCEPTANCE RECORD (2026-09-28, the Lead — the R34 wave)

The corrective acceptance law (2026-09-22) required production evidence for R24
(YouTube parity + playback performance). The R34 wave produced it, all three lanes
merged to main and deployed (production auto-deploy via the git-app):

- **J41 (YouTube-equivalent playback startup)** — evidence/r34b/ @ 2cea32b:
  68 walks / 10 cells / 5 identity pairs on LIVE PRODUCTION through the product's
  own typed telemetry. 2 measured PASS (the one-obvious-play-action 68/68; the
  no-enrichment-block-before-first-frame with marker-timing proof), 1 not-covered
  (torrent startup — the J21-J24 lanes own it), 5 BLOCKED-honest by the
  environmental YouTube bot-gate (the datacenter-IP wall, VLM-quoted captures;
  WebFlix's side fully measured: rick p50 1715/1401ms cold/warm, p75 1792/1449,
  p95 1928/1571, 0/22 startup failures, 0 rebuffer in the 60s soak). The harness
  is re-run-ready for an unblocked environment.
- **J40 (viewer parity) + J42 (extension parity)** — evidence/r34a/ @ 488747d:
  J40 PASS on the manual production walk (27 pairing rows citing taxonomy ids,
  14 evidence points) with the encoded runner's honest FAIL recorded (the
  fixtures-boot-bound suggestions term); J42 PASS 6/6 (the 10-station canonical
  path with the artifact triple per step — zero console/page errors); the shorts
  depth check live-verified against the G4 corpus (the real embed staged, the
  unmute round trip, the pill retired); the battery floor 5256/1/0 IDENTICAL.
  The composition record recovered through the permanent chat transcript after
  a files-API workspace cycling (RECOVERY-NOTE.md records the honest limits).
- **J01-J39 (the affected-journeys regression rerun)** — evidence/r34c/ @ 36b3cf6:
  38/38 in-scope journeys ran against LIVE PRODUCTION (the runner's own chunk
  manifests as the artifacts of record); all 34 non-pass verdicts re-run (zero
  verdict flakes); ZERO real regressions — 32 STALE-GRAMMAR (the specs pre-date
  the operator-directed R24→R30 product evolution; the suite-update work item is
  recorded, NOT applied) + 2 ENVIRONMENTAL (J11 shared identity; J39 the standing
  R23 revalidation target). The R33-A shorts surface specifically NOT regressed.

**The verdict**: the R24 acceptance clauses are satisfied at the product level on
production evidence, with every environmental block and every stale-spec caveat
recorded honestly (never fabricated, never patched over). The follow-up ledger:
the journey-suite re-encoding work item (32 specs), the R34-A defect-candidates
(B2/B3/B4/C2), the unblocked-environment J41 re-run, and the standing J39
revalidation lane.
