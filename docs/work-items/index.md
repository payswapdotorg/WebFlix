# WebFlix Work Item Registry — Remediation Freeze

**Historical release registry:** R00-R19 in `docs/plans/2026-09-16-webflix-remediation-plan.md` — COMPLETE and release-accepted.

**Active execution registry:** R20 in `docs/plans/2026-09-19-webflix-byof-plan.md`.

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

## Worker assignment rules

A worker receives only assigned R IDs and their explicitly permitted subpaths. Workers may not change shared contracts, platform boundaries, or architecture without Lead approval.

Every UI item must run affected golden journeys from `docs/validation/webflix-golden-journeys.md` with agent-browser against a running product. Every native/torrent item needs executable tests plus Desktop journey evidence where applicable.

## Completion truth

A work item is green only when its code, tests, contracts, documentation, real production wiring, and affected journey evidence agree. Worker summaries are not completion evidence.


## R20 completion truth

R20 is not complete because connected-source management or generic feed search exists. It requires a real authorized import/feed route, persisted provenance, explicit snapshot/live truth, idempotent synchronization, Web/Desktop shared semantics, and J33 journey evidence.


## R21 completion truth

R21 is not complete because architecture contracts, routes, or tests exist. It requires a fresh-user path to discover the corresponding capability from a normal product surface, a useful next action for important failures, production transport parity, removal of stale completion copy, and fresh J34/J35 journey evidence.