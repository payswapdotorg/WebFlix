# WebFlix Implementation Plan

> For agentic workers: implement only the assigned work item, use the frozen contracts, and do not cross lane boundaries without tech-lead approval.

**Goal:** Build WebFlix as a Universal Entertainment OS with shared entertainment/intelligence graphs, pluggable sources, a unified Media Surface, native media, and web/desktop/mobile clients.

**Architecture:** Modular cloud domain plus isolated native media service. Source connectors normalize capabilities; canonical content is separate from source realization; recommendation/model layers are provider-neutral.

**Tech Stack:** Next.js/TypeScript, PostgreSQL-compatible persistence, Rust native media service preferred, FFmpeg for permitted media processing, native desktop/mobile bridges.

**Spec:** `docs/architecture/webflix-frozen-architecture.md`

## Global constraints

- No provider-specific logic in product core.
- No provider access-control or DRM circumvention.
- Native acquisition is for authorized media.
- Server canonical persistence is PostgreSQL-compatible.
- Shared contracts are versioned and lead-controlled.
- Every connector reports real capabilities.
- Recommendation policy is explicit and user-controlled.
- All clients share domain semantics.

## Work items

### Foundation

**WFX-001 — Repository governance + CI baseline**: workspace/package layout, lint/typecheck/test, CI, ownership, contract checks. Dependencies: none.

**WFX-002 — Shared domain types + event envelope**: canonical IDs, capability enums, events, source references, playback modes, device capabilities, schema validation. Depends 001.

**WFX-003 — Connector SDK**: descriptor, lifecycle, search/metadata/resolve/actions, capability registry, unsupported results. Depends 001/002.

**WFX-004 — Native media service contract**: service boundary, session states, range contract, error taxonomy, fixtures. Depends 001/002.

**WFX-005 — Experience API shell**: source-neutral feed, playback session, library, and action use-cases. Depends 002/003/004.

### Intelligence

**WFX-010 — Entertainment Graph**: canonical items, realizations, creators/topics, events, deduplication, queries. Depends 002.

**WFX-011 — Intent Graph**: persistent/temporary/session/momentary/social intent, confidence, provenance, expiry, policies. Depends 002.

**WFX-020 — Candidate retrieval/index**: source-neutral candidate retrieval preserving capabilities. Depends 003/010/011.

**WFX-021 — Recommendation OS**: retrieval -> features -> scoring -> policy -> intent-aware diversity -> feed composition; long/short feeds; anti-tunnel-vision tests. Depends 010/011/020.

**WFX-030 — Model Fabric**: task registry, provider interface, routing, privacy, cost limits, fallback, tracing. Depends 002.

**WFX-031 — WebFlix recommendation model adapter**: first-party replaceable strategy. Depends 021/030.

**WFX-032 — BYOM adapter**: structured model scoring with policy enforcement. Depends 021/030.

**WFX-033 — Media transformation tools**: transcript, translation, subtitle, summary, speech, permitted dubbing/commentary. Depends 030.

### Sources / native media

**WFX-012 — Connector registry + credential storage**. Depends 003.

**WFX-013 — Reference read-only connector**. Depends 012.

**WFX-014 — Native media engine adapter**. Depends 004.

**WFX-015 — Local HTTP range/media gateway**. Depends 014.

**WFX-022 — External action synchronization**. Depends 012/013.

**WFX-023 — Deadline-aware playback scheduler**. Depends 014/015.

**WFX-024 — Background completion + storage policy**. Depends 023.

### Experience / clients

**WFX-025 — Media Surface resolver**: Native/Embed/Browser/External. Depends 003/005.

**WFX-026 — In-app browser surface**: contained browser session, persistent WebFlix shell, provider handoff, security isolation. Depends 025.

**WFX-027 — Long-form Watch Feed**. Depends 005/021/025.

**WFX-028 — Short Feed**. Depends 005/021/025.

**WFX-029 — Library/history client**. Depends 005/022/024.

**WFX-040 — Cross-platform clients**: web/desktop/mobile capability parity. Depends 026-029.

### Hardening

**WFX-041 — QoE/recommendation telemetry**. Depends 021/025/027/028.

**WFX-042 — Security/privacy audit**. Depends production features.

**WFX-043 — Release acceptance**: golden journeys, capability matrix, media recovery, recommendation regression. Depends 040-042.

## Worker lanes

Lane A: WFX-010/011/020/021/030/031/032/033/041.

Lane B: WFX-003/004/012/013/014/015/022/023/024.

Lane C: WFX-005/025/026/027/028/029/040.

Lead owns WFX-001, shared contract changes, architecture changes, WFX-042, WFX-043.

## Acceptance rule

Every work item has tests, explicit unsupported behavior, no cross-lane private imports, and documentation/fixture updates. External integrations may use recorded fixtures but cannot be marked production-ready without real capability verification.
