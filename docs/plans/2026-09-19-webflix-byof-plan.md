# WebFlix Bring Your Own Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users bring an existing authorized feed relationship into WebFlix while preserving source provenance, source-native ordering, WebFlix recommendation control, and the shared Web/Desktop/Mobile adapter architecture.

**Architecture:** Feed import is a shared Experience/Graph capability. Connectors provide authorized feed/import capabilities; the shared runtime stores normalized feed records with provenance; Web and Desktop provide adapter-specific import and feed experiences.

**Tech Stack:** Existing WebFlix Next.js/TypeScript, PostgreSQL persistence, connector SDK, shared client runtime, durable background synchronization, agent-browser.

**Spec:** docs/architecture/byof-architecture.md

## Global Constraints

- Repository is the source of truth.
- Lead owns shared contract changes.
- Authorized APIs and official exports only.
- No scraping, credential extraction, CAPTCHA/anti-bot/rate-limit bypass, or hidden private endpoints.
- Source-native feed order must never be mislabeled as WebFlix-ranked content.
- Snapshot data must never be presented as live.
- BYOF must not silently overwrite long-term recommendation identity.
- Web/Desktop/Mobile share feed semantics.
- UI work requires agent-browser journey evidence.
- Production connectors must not silently fall back to fixtures.

## Parallel worker plan

### Worker 1 — Shared feed/import lane

**R20-A — Feed import contract and persistence**

Create the feed provenance, import source, feed record, sync status, and reconciliation contracts in the existing shared/runtime/persistence seams.

Expected semantics:

- import method;
- source identity;
- source-native ordering metadata;
- captured timestamp;
- freshness;
- sync status;
- canonical item reference;
- follow/subscription relationship;
- idempotent import keys.

**R20-B — Connector feed/import capability**

Extend the Connector SDK with an explicit feed/import capability rather than overloading generic catalog search.

Implement the first real provider path against official APIs/exports available to the connector. The connector must report unsupported when the provider cannot legally/reliably expose the user's feed.

**R20-C — Feed reconciliation**

Implement snapshot import, incremental synchronization where supported, deduplication, canonical identity resolution, stale/offline semantics, and preservation of WebFlix-local actions.

### Worker 2 — Web lane

**R20-D — BYOF onboarding and feed UI**

Add a consumer-facing flow:

Bring your feed -> choose source -> connect/import -> preview -> confirm -> feed appears

Include:

- source-native vs WebFlix mode;
- freshness/live/snapshot status;
- imported follow/subscription summary;
- clear authorization failures;
- undo/disconnect import without destructive library deletion.

**R20-E — Web golden journey**

Encode J33 with agent-browser and screenshots/snapshots.

### Worker 3 — Desktop/source lane

**R20-F — Desktop import surface**

Add native file import where a connector supports official exports and background sync behavior where supported.

**R20-G — Desktop BYOF feed**

Bind the shared feed runtime to Desktop storage/background capabilities. Preserve the same semantics as Web with a richer platform capability envelope.

### Lead

**R20-H — Integration and release gate**

Ratify contracts, verify provider authorization boundaries, review worker diffs, run J33 on Web and Desktop, and reject any implementation that conflates source-native ordering with WebFlix ranking.

## Dependency graph

R19 -> R20-A
R20-A -> R20-B and R20-D
R20-B -> R20-C
R20-C -> R20-F -> R20-G
R20-D -> R20-E
R20-E + R20-G -> R20-H

R20-D and R20-E can proceed in parallel with R20-B once the shared contract sketch is ratified. R20-F/G can start against frozen contract stubs while Worker 1 builds the provider adapter. R20-C depends on the import record contract, not on the final Web UI.

## Definition of done

- At least one real connector/import route works using an authorized API or official export.
- Imported records are normalized into canonical Entertainment Items.
- Feed provenance and freshness are persisted.
- Snapshot/live distinction is visible.
- Source-native and WebFlix-ranked modes are distinguishable.
- Import is idempotent.
- Disconnect/reauthorize behavior is honest.
- Web and Desktop share semantics.
- J33 has fresh agent-browser evidence on the running Web and Desktop products.
- CI, contract-check, lane-check, source inspection, and persistence inspection are green.