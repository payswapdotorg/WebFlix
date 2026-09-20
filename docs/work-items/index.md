# WebFlix Work Item Registry — Remediation Freeze

**Historical release registry:** R00-R19 in docs/plans/2026-09-16-webflix-remediation-plan.md — COMPLETE and release-accepted.

**Active execution registry:** R23/R24/R25 are registered (docs/plans/2026-09-20-webflix-open-viewing-torrent-ai-plan.md, -youtube-parity-performance-plan.md, -qwen-livetranslate-plan.md). **R20, R21 and R22 are implementation-complete and acceptance-green** (R22 accepted 2026-09-20: main @ `7252002`; battery — lint 0/10 baseline, typecheck clean, 4039 tests / 0 fail, contract-check OK, lane-check OK, 35/35 encoded journeys green per evidence/r22/journeys-union.json; production sweep — evidence/r22/production-sweep.md; issues #25/#26/#27 closed to match).

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

R23 is complete only when public playback works without requiring a WebFlix account, provider-auth boundaries remain truthful, torrent is a first-class realization/playback path rather than only an offline utility, browser-capable torrent scenarios are exercised where technically supported, AI media intelligence is production-wired through Model Fabric with license/provenance truth, and J37-J39 pass without regressions to J01-J36.

Canonical plan: docs/plans/2026-09-20-webflix-open-viewing-torrent-ai-plan.md

## R24 completion truth

R24 is complete only when the viewer-facing YouTube parity inventory is complete and source-verified, every row has an explicit WebFlix pairing/classification, Web/Desktop parity evidence is fresh, J40-J42 pass, the playback startup thresholds in the canonical R24 plan pass, and affected J01-J39 journeys are rerun without regression. WebFlix-only capabilities must have contextual placements consistent with the product's familiar video interaction grammar. Torrent must remain a first-class realization and must participate in the playback/performance gate.

Canonical plan: docs/plans/2026-09-20-webflix-youtube-parity-performance-plan.md
Canonical lab: docs/validation/youtube-parity-lab.md

## R25 completion truth

R25 is complete only when Qwen3.8-LiveTranslate is registered through Model Fabric as a realtime translation provider, a provider-neutral realtime media-session seam is implemented, Web/Desktop supported paths can start/continue live translation without delaying base playback, credentials remain server-side, cost/latency/usage telemetry is captured, voice-cloning policy is enforced, J43 passes, and R23/R24 journeys remain green.

Canonical plan: docs/plans/2026-09-20-webflix-qwen-livetranslate-plan.md
