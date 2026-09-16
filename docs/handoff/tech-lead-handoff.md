# WebFlix Tech Lead Handoff — Remediation Freeze

WebFlix is the **Universal Entertainment OS**. The repository is the source of truth.

## Canonical read order

1. `docs/architecture/webflix-remediation-architecture.md`
2. `docs/architecture/webflix-frozen-architecture.md`
3. `docs/architecture/contracts.md`
4. `docs/architecture/product-boundaries.md`
5. `docs/architecture/dependency-graph.md`
6. `docs/work-items/index.md`
7. `docs/plans/2026-09-16-webflix-remediation-plan.md`
8. `docs/validation/webflix-golden-journeys.md`
9. `docs/validation/competitor-validation.md`
10. Actual source/tests/imports/configuration in the assigned worktree

The 2026-09-16 remediation documents supersede the legacy client/native-media sequencing. Do not infer completion from legacy WFX issues or summaries.

## Mission

Deliver a working product, not merely architecture scaffolding:

- source-neutral entertainment discovery;
- real account/profile identity;
- connected source management;
- Library/history/Continue Watching;
- long-form and Shorts experiences;
- explicit recommendation controls and anti-tunnel behavior;
- WebFlix/BYOM/local model control;
- AI media transformations;
- contained BrowserHost where permitted;
- production Web adapter;
- production Desktop adapter;
- real native media service;
- full authorized torrent engine;
- playback-aware torrent scheduling;
- background completion and recovery;
- one shared runtime that makes future Mobile an adapter rather than a rewrite.

## Three-worker dispatch

### Worker 1 — Shared Experience/Intelligence

R01-R06, plus assigned R15 work.

Private paths principally include `packages/client-runtime/**`, `packages/platform-contracts/**`, `packages/experience/**`, `packages/domain/**`, `packages/recommendation/**`, `packages/model-fabric/**`, `packages/persistence/**`, and `packages/actions/**`.

### Worker 2 — Web

R07, Web portion of R09, and Web journey evidence.

Private paths principally include `apps/web/**` and the Web platform adapter.

### Worker 3 — Desktop/Native/Torrent

R08, R10-R14, Desktop journey evidence, and native recovery work.

Private paths principally include `apps/desktop/**`, `packages/native-media/**`, `packages/torrent-engine/**`, and the Desktop/native platform adapter.

### Lead

R00, shared-contract changes, architecture changes, cross-lane dependencies, R16-R19, integration, browser validation, security/privacy review, deployment, and final acceptance.

## Critical torrent directive

The torrent engine is a first-class product subsystem.

It must support, through a mature protocol implementation:

`authorized magnet/.torrent -> metadata -> file selection -> torrent session -> piece map -> integrity -> playback-aware prioritization -> buffering -> playback -> background completion -> verified local asset -> Library`

It must support interruption/restart/recovery. It must not be implemented as a mock, fixture, copied protocol implementation in TypeScript, or an external-download handoff presented as native playback.

The production Desktop path must not use `stubEngine()`.

## Platform rule

Web/Desktop/Mobile are adapters over the shared Client Runtime. The runtime owns product semantics. Platform adapters own storage, browser, lifecycle, native media, notifications, background work, sharing, and other platform capabilities.

No provider SDK calls belong in shared product logic.

## Browser validation rule

UI-affecting work is not complete without agent-browser evidence.

Worker loop:

```text
implement -> run app -> agent-browser journey -> snapshot/screenshot -> inspect -> fix -> test -> report
```

After navigation or DOM changes, workers must obtain fresh snapshots before using element references. The Lead independently reruns affected journeys after integration.

## Dispatch packet required for every assignment

Include:

- R ID;
- dependency IDs;
- frozen interfaces consumed/produced;
- allowed paths;
- forbidden scope;
- tests required;
- affected golden journey IDs;
- expected evidence;
- integration handoff requirements.

## Reject drift

Reject:

- direct provider SDK calls in shared product/core code;
- duplicated Web/Desktop product rules;
- fixture fallback in production;
- Desktop `stubEngine()` as production behavior;
- torrent protocol logic escaping `packages/torrent-engine`;
- unauthorized acquisition;
- DRM/access-control/captcha/anti-bot circumvention;
- source capability claims not backed by real adapter behavior;
- recommendation systems that permanently tunnel on the last topic;
- model-controlled authorization;
- credentials entering AI prompts;
- local storage replacing canonical server persistence;
- external actions reported successful without provider confirmation;
- engineering diagnostics presented as the primary entertainment UX.

## Integration sequence

1. Land R00 governance freeze.
2. Freeze R01 shared runtime/platform contracts.
3. Dispatch Worker 1 R02-R06, Worker 2 R07, Worker 3 R08 concurrently where dependencies permit.
4. Dispatch R09 and R10 once their contract seams are frozen.
5. Worker 3 runs the R10 -> R11 -> R12 -> R13 native/torrent chain.
6. Worker 1 + 3 integrate R14 native acquisition UX.
7. Integrate R15 actions.
8. Lead runs R16 browser/golden journey harness against Web and Desktop.
9. Run R17 failure/recovery hardening.
10. Run R18 security/privacy/authorization audit.
11. Run R19 production/release acceptance.

## Final verification

Before declaring any item or phase complete, inspect the actual repository state, tests, imports, persistence, schemas, runtime wiring, platform packaging, and browser/native behavior directly. Worker summaries are evidence of intent, not evidence of completion.
