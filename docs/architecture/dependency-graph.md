# WebFlix Dependency Graph and Three-Worker Remediation Model

The R-series graph supersedes the earlier WFX-040-centric client sequence. Legacy WFX items remain historical implementation context; the R-series is the active execution order.

```text
R00
  |
  v
R01 Shared Client Runtime
  +----> R02 Identity/Profile ----> R03 Sources ----> R15 Actions
  |           |
  |           +----> R04 Library ----> R05 Recommendation/Intent ----> R06 Model/AI
  |
  +----> R07 Web Adapter
  +----> R08 Desktop Adapter
  +----> R09 Media Surface/BrowserHost
  |
  +----> R10 Native Media
              |
              v
            R11 Torrent Engine
              |
              v
            R12 Playback-aware Scheduler
              |
              v
            R13 Torrent Persistence/Recovery
              |
            R14 Acquisition UX

R07 + R08 + R09 + R14 -> R16 Golden Journey Harness
R13 + R15 + R16 -> R17 Recovery Hardening
R17 -> R18 Security/Privacy/Authorization Audit -> R19 Production Acceptance
R19 -> R20 Bring Your Own Feed
R20-A -> R20-B -> R20-C
R20-A -> R20-D -> R20-E
R20-A -> R20-F -> R20-G
R20-C + R20-E + R20-G -> R20-H
R20 -> R21
R21-A -> R21-B -> R21-C
R21-A -> R21-D -> R21-F
R21-A -> R21-G -> R21-H
R21-C + R21-D -> R21-E
R21-B + R21-E + R21-F + R21-H -> R21-I -> J34 + J35
R21 -> R22

R22-A -> R22-D -> R22-G
R22-A -> R22-H -> R22-J
R22-B -> R22-E -> R22-G
R22-B -> R22-H
R22-C -> R22-F -> R22-G
R22-C -> R22-I -> R22-J
R22-D + R22-E + R22-F -> R22-K/R22-L
R22-G + R22-J -> J36 + affected J01-J35 -> production acceptance -> R22-M
```

## Worker 1 — Shared Experience/Intelligence

Owns R01-R06 and assigned shared R15/R20/R21/R22 work.

Private paths: packages/client-runtime/**, packages/platform-contracts/**, packages/experience/**, packages/domain/**, packages/recommendation/**, packages/model-fabric/**, packages/persistence/**, packages/actions/**.

## Worker 2 — Web Adapter

Owns R07 and Web portions of R09/R16 plus Web work in R20-R22.

Private paths: apps/web/** plus the Web platform adapter package and approved Web journey evidence.

## Worker 3 — Desktop/Native/Torrent

Owns R08, R10-R14 and Desktop portions of R16-R17 plus Desktop work in R20-R22.

Private paths: apps/desktop/**, packages/native-media/**, packages/torrent-engine/**, and the Desktop/native platform adapter package.

## Lead-only

R00, shared contract changes, architecture changes, dependency changes affecting multiple lanes, final journey integration, R18/R19 acceptance, production/source verification, and any cross-lane exception.

## Parallelization rules

1. R00 is mandatory first.
2. R01 establishes the shared runtime boundary.
3. After R01 is frozen, R02-R06, R07, and R08 fan out in parallel where dependencies permit.
4. R09 can proceed once the playback/platform capability contract is frozen.
5. R10-R13 remain the native-media dependency chain owned by Worker 3.
6. R14 can begin once the acquisition state contract is frozen.
7. R15 can proceed against the existing connector/action seams after R03.
8. R16/R17/R18/R19 converge the three lanes.

Workers communicate through versioned contracts and fixtures, not private imports. A contract change pauses affected work until Lead updates the frozen contract document and graph.

## R20 — Bring Your Own Feed

Worker 1 owns R20-A/B/C.
Worker 2 owns R20-D/E.
Worker 3 owns R20-F/G.
Lead owns R20-H, authorization review, integration and J33.

R20-A freezes the shared feed-import/provenance contract. R20-B/R20-D/R20-F then proceed concurrently; R20-C and R20-G follow their shared/provider seams; R20-H integrates and validates J33.

## R21 — Journey-driven product discoverability

Worker 1 owns R21-A/B/C.
Worker 2 owns R21-D/E/F.
Worker 3 owns R21-G/H.
Lead owns R21-I and J34/J35.

R21 operating law: a capability is not product-complete when it is merely present in a contract or hidden in diagnostics. Every accepted capability must have a contextual discovery affordance and a recovery/next-action path.

## R22 — Major user-journey completion + dead-end hardening

R22 exists because R21 proved capability discoverability but the deeper journey audit found remaining completion gaps: first-time source connection can return to the same empty state, account registration is implemented but not exposed in the signed-out UI, and BYOM binding operations exist in the shared runtime without a normal user-facing management control.

### Worker allocation

Worker 1 owns:
- R22-A source-discovery/first-connect contract
- R22-B account-creation journey contract
- R22-C BYOM management contract/read models

Worker 2 owns:
- R22-D Web source onboarding
- R22-E account creation UX
- R22-F Web BYOM management
- R22-G fresh hydrated browser evidence

Worker 3 owns:
- R22-H Desktop source/auth parity
- R22-I Desktop model/BYOM parity
- R22-J Desktop major-journey evidence

Lead owns R22-K contract ratification, R22-L integration, production parity, and R22-M issue/work-registry reconciliation.

### R22 parallelization

1. Freeze A/B/C.
2. Then Worker 2 and Worker 3 run concurrently.
3. D/E/F can run concurrently within Web after their shared seam is frozen.
4. H/I can run concurrently within Desktop after shared semantics are frozen.
5. G depends on D/E/F; J depends on H/I.
6. Lead integration consumes G/J and reruns J36 plus affected J01-J35.
7. R22-M closes governance drift only after production acceptance.

R22 must not add primary navigation routes for conceptual areas such as Feed or BYOF; those capabilities remain contextual/management surfaces under the R21 law.


## R23 — Open viewing, first-class torrent, AI media intelligence

R22 -> R23-A -> R23-B -> R23-C
R23-C -> R23-D + R23-E
R22 -> R23-F -> R23-G/R23-H/R23-I/R23-J
R23-A -> R23-K
R23-G/R23-H/R23-I/R23-J + R23-C/R23-E -> Lead integration -> J37 + J38 + J39 -> affected J01-J36 -> production gate

Worker 1 owns A/B/C/F/G/H/I/J/K shared semantics and Model Fabric.
Worker 2 owns anonymous Web playback, browser torrent adapter/product surfaces, multimodal Web UX and Web evidence.
Worker 3 owns Desktop/native torrent realization, recovery/offline continuity and local-model/runtime packaging.
Lead owns authorization/licensing review, contract ratification, integration, production verification and final journey acceptance.

R23 operating laws:
- public playback must not require a WebFlix account;
- provider authorization is distinct from WebFlix account authentication;
- torrent is a realization/source kind, not a generic Media Surface playback mode;
- authorized torrent realizations may satisfy native playback on Desktop and a browser rung only where the platform/source actually supports it;
- model output never authorizes acquisition/playback;
- open-model licenses and revisions are part of Model Fabric provenance.


## R24 — YouTube parity + playback performance lab

R23 shared contracts -> R24-A/B/C lab lanes (parallel)  
R24-A + R24-B + R24-C -> R24-D parity matrix + performance baseline  
R24-D -> Web/Desktop implementation lanes  
R24 implementation -> J40 + J41 + J42 -> affected J01-J39 -> production acceptance

Worker 1 owns R24-A shared parity taxonomy, performance telemetry, startup contracts and regression tests.  
Worker 2 owns R24-B Web YouTube viewer audit, Web parity UI, Web performance harness and browser evidence.  
Worker 3 owns R24-C Desktop/native/torrent parity, startup/recovery measurements and Desktop evidence.  
Lead owns R24-D lab synthesis, feature/source verification, classification ratification, integration and final acceptance.

R24 may begin its observational lab after R23 shared contracts are frozen and may run concurrently with unrelated R23 implementation. R24 must not create a second architecture or duplicate product rules.

R24 operating laws:
- every relevant viewer-facing YouTube capability has an explicit WebFlix pairing;
- WebFlix-only capabilities use contextual/familiar video-product interaction grammar;
- playback startup is not blocked by AI, recommendation, analytics or indexing;
- torrent remains a first-class realization and participates in the same player/performance contract;
- no UI branding or proprietary visual structure is copied from YouTube;
