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
```

## Worker 1 — Shared Experience/Intelligence

Owns R01-R06 and R15-R18 work delegated within its lane.

Private paths: `packages/client-runtime/**`, `packages/platform-contracts/**`, `packages/experience/**`, `packages/domain/**`, `packages/recommendation/**`, `packages/model-fabric/**`, `packages/persistence/**`, `packages/actions/**`.

## Worker 2 — Web Adapter

Owns R07 and Web portions of R09 and R16.

Private paths: `apps/web/**` plus the Web platform adapter package.

## Worker 3 — Desktop/Native/Torrent

Owns R08, R10-R14 and Desktop portions of R16-R17.

Private paths: `apps/desktop/**`, `packages/native-media/**`, `packages/torrent-engine/**`, and the Desktop/native platform adapter package.

## Lead-only

R00, shared contract changes, architecture changes, dependency changes affecting multiple lanes, R16 integration harness, R18, R19, and final browser/source verification.

## Parallelization rules

1. R00 is mandatory first.
2. R01 establishes the shared runtime boundary.
3. After R01 is frozen, R02-R06, R07, and R08 fan out in parallel.
4. R09 can proceed in parallel once the playback/platform capability contract is frozen.
5. R10-R13 remain a native-media dependency chain owned by Worker 3.
6. R14 can begin once the acquisition state contract is frozen; it does not require the complete torrent engine to design its UX states.
7. R15 can proceed against the existing connector/action seams after R03.
8. R16/R17/R18/R19 converge the three lanes.

Workers communicate through versioned contracts and fixtures, not private imports. A contract change pauses affected work until Lead updates the frozen contract document and graph.

## R20 — Bring Your Own Feed

### Worker 1 — Shared feed/import
Owns R20-A/R20-B/R20-C.

### Worker 2 — Web
Owns R20-D/R20-E.

### Worker 3 — Desktop/source
Owns R20-F/R20-G.

### Lead
Owns R20-H, shared contract changes, provider-authorization review, integration, and J33 acceptance.

### R20 parallelization rules
1. R20-A freezes the shared feed-import/provenance contract.
2. R20-B and R20-D can run concurrently once R20-A is ratified.
3. R20-F can begin from the frozen contract while R20-B is implemented.
4. R20-C depends on R20-B and owns reconciliation/idempotency.
5. R20-E depends on the Web contract but may use deterministic connector fixtures.
6. R20-G consumes the same shared runtime semantics as Web.
7. R20-H is the integration gate and does not become a feature-worker lane.

## R21 — Journey-driven product discoverability

R20 -> R21-A

R21-A -> R21-B -> R21-C
R21-A -> R21-D
R21-C -> R21-E
R21-D -> R21-F
R21-A -> R21-G -> R21-H
R21-E + R21-F + R21-H -> R21-I
R21-B -> R21-I
R21-I -> J34 + J35

### Worker allocation

Worker 1 owns R21-A/B/C shared capability/view-model and production transport wiring.
Worker 2 owns R21-D/E/F Web product surfaces and browser evidence.
Worker 3 owns R21-G/H Desktop/native product surfaces.
Lead owns R21-I integration, production parity, and final journey acceptance.

### Parallelization

After R21-A is ratified, R21-B, R21-D, and R21-G can proceed concurrently.
R21-C follows R21-B.
R21-E follows R21-C and consumes the Web surface work from R21-D.
R21-F follows R21-D/E as browser-evidence stabilization.
R21-H follows R21-G.
R21-I waits for B/E/F/H and must independently rerun the affected journeys.

### R21 operating law

A capability is not product-complete when it is merely present in a contract or hidden in diagnostics. Every accepted capability must have a contextual discovery affordance and a recovery/next-action path.