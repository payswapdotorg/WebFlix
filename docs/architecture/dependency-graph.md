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
