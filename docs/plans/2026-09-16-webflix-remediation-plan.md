# WebFlix Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete WebFlix as a real Universal Entertainment OS with shared Web/Desktop runtime semantics, a future-Mobile-ready adapter boundary, and a production authorized torrent/native-media path.

**Architecture:** Experience Core -> Shared Client Runtime -> Platform Adapter. Web and Desktop are adapters over the same runtime; Mobile later uses the same boundary. Native Media owns local playback, torrent orchestration, range access, scheduling, persistence, and recovery.

**Tech Stack:** Next.js/TypeScript, PostgreSQL-compatible persistence, Rust-preferred native media, mature BitTorrent library behind an adapter, FFmpeg only for permitted processing, Tauri/equivalent Desktop shell, durable workers/outbox, agent-browser for UI validation.

**Spec:** `docs/architecture/webflix-remediation-architecture.md`

## Global Constraints

- Repository is the source of truth.
- Lead owns shared-contract changes.
- Authorized media only; no DRM/access-control/captcha/anti-bot/rate-limit/geo circumvention.
- Torrent internals stay behind native-media; do not reimplement BitTorrent in product-core TypeScript.
- No production fallback to fixtures or `stubEngine()`.
- Web/Desktop/Mobile share product semantics; adapters own platform capabilities.
- PostgreSQL-compatible persistence is canonical.
- No direct provider SDK logic in shared product code.
- UI work requires agent-browser validation against affected golden journeys.
- CI results never substitute for source/platform/browser inspection.

## Work items

### Lead R00 — Repository takeover and acceptance harness

Create/maintain the frozen architecture, golden journeys, competitor validation, dependency graph, work registry, and tech-lead handoff. Replace legacy sequencing wherever it conflicts with the R-series plan.

### Worker 1 R01 — Shared client runtime

Create `packages/client-runtime` and platform capability contracts. The runtime owns navigation, playback commands, library semantics, watch state, actions, intent submission, and error states; it knows nothing about Web/Desktop implementation details.

### Worker 1 R02 — Identity and profiles

Complete account/profile persistence, server-side identity, profile selection, profile-scoped history/library/recommendation policy, and cross-device continuity.

### Worker 1 R03 — Source management

Connect/reauthorize/disconnect sources, capability truth, authorization state, and consumer-facing source management. Keep credentials out of model prompts.

### Worker 1 R04 — Library and history

Implement source-neutral save/watchlist/history/Continue Watching, canonical-item identity, cross-source realization replacement, and history exclusion/removal.

### Worker 1 R05 — Recommendation controls

Implement reversible feedback, anti-tunnel tests, temporary/session intent, source/creator suppression, exploration controls, and Mindful/Balanced/Immersive/Custom policy behavior.

### Worker 1 R06 — Model and AI controls

Implement WebFlix model/BYOM/local-model policy, privacy/cost/fallback constraints, and explicit transcription/subtitle/translation/dubbing/commentary operation states.

### Worker 2 R07 — Web adapter

Make `apps/web` a pure platform adapter over the shared runtime. Remove Guest-only product framing, add Library/source/profile UX, real media presentation, recommendation controls, production service wiring, and responsive parity.

### Worker 3 R08 — Desktop adapter

Make `apps/desktop` a real native adapter. Add Tauri/equivalent shell, filesystem storage, lifecycle/background capability, native browser host, and real native-media service binding. Production must not use `stubEngine()`.

### Worker 2/3 R09 — Media Surface + BrowserHost

Implement Native > Embed > Browser > External resolution. Build a contained Web BrowserHost and a native Desktop BrowserHost while preserving provider security boundaries.

### Worker 3 R10 — Native Media production path

Productionize `packages/native-media`: real service process, persistent sessions, local storage, range serving, buffering, integrity state, recovery, and background completion.

### Worker 3 R11 — Torrent Engine

Create `packages/torrent-engine`. Use a mature BitTorrent implementation. Support authorized magnet and `.torrent` ingestion, metadata, file selection, sessions, peer/piece state, integrity verification, pause/resume, persistent recovery, and a narrow native-media adapter.

### Worker 3 R12 — Playback-aware torrent scheduler

Map playback byte/range deadlines to torrent pieces; prioritize startup/seek/playback windows; fall back to completion priority outside active windows; surface truthful buffering when deadlines cannot be met.

### Worker 3 + Worker 1 R13 — Torrent persistence/recovery

Persist recoverable torrent/native sessions, resume after restart/interruption, verify complete assets before `Ready offline`, and expose verified native assets to Library.

### Worker 1 + Worker 3 R14 — Native acquisition UX

Expose `Available -> Preparing -> Buffering -> Playing -> Completing -> Ready offline -> Failed/Recoverable`. Keep torrent protocol terminology in an advanced diagnostic surface only.

### Lead + Worker 1 R15 — External/social actions

Implement confirmed/unsupported/failed outbound action states, official connector-only sync, local-first event recording, and social-intent inputs within privacy boundaries.

### Lead R16 — Golden journey automation

Create reusable agent-browser journey helpers, encode J01–J32 where feasible, capture screenshots/snapshots, and add Web journey checks to CI. Desktop native-only journeys must have an equivalent evidence procedure.

### Lead + all workers R17 — Recovery hardening

Validate expired credentials, unavailable realizations, network loss, torrent metadata failure, peer starvation, interrupted native sessions, failed external actions, and unsupported capabilities.

### Lead R18 — Security/privacy/authorization audit

Audit tenant/profile isolation, credentials, model-input privacy, native acquisition authorization, BrowserHost security, persistence deletion/export, and connector permissions.

### Lead R19 — Production and release acceptance

Verify environment configuration, Web deployment/API parity, Desktop packaging/native binding, full Web golden journeys, full applicable Desktop journeys including torrent lifecycle, CI, source/import/persistence inspection, and release evidence.

## Dependency graph

```text
R00
 └─> R01
      ├─> R02 ──> R03 ──> R15
      │    └────> R04 ──> R05 ──> R06
      ├─> R07
      ├─> R08 ──> R10 ──> R11 ──> R12 ──> R13
      └─> R09
R04 + R11 + R12 + R13 -> R14
R07 + R08 + R09 + R14 -> R16
R13 + R15 + R16 -> R17 -> R18 -> R19
```

R02-R06, R07, and R08 can proceed concurrently after R01 contracts are frozen. R10-R13 are Worker 3's native-media dependency chain. R14 consumes native acquisition contracts but can be developed in parallel with R13 after its state contract is frozen.

## Browser validation rule

For every UI-affecting item, run:

```bash
agent-browser open <url>
agent-browser wait --load networkidle
agent-browser snapshot -i
```

After navigation or DOM changes, take a fresh snapshot before using refs. Capture final screenshots and failure evidence. Workers report the exact journey IDs exercised; the Lead reruns affected journeys after integration.

## Definition of done

Implementation exists; tests cover it; unsupported/error behavior is explicit; no forbidden cross-lane private imports; docs/contracts match code; production paths are real; and affected golden journeys have direct execution evidence.
