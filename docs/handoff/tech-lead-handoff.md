# WebFlix Tech Lead Handoff

WebFlix is the Universal Entertainment OS. Implement only from the frozen architecture, contracts, dependency graph, and roadmap in `docs/architecture/` and `docs/plans/`.

## Read order

1. `webflix-frozen-architecture.md`
2. `contracts.md`
3. `product-boundaries.md`
4. `dependency-graph.md`
5. `2026-09-13-webflix-implementation-plan.md`
6. GitHub WFX issues

## Three worker lanes

**Lane A — Intelligence:** entertainment graph, intent graph, retrieval, recommendation, model fabric, telemetry.

**Lane B — Sources/Media:** connector SDK, registry/auth, native media service, range gateway, external actions, background media.

**Lane C — Experience:** Experience API, Media Surface, in-app browser, watch feed, short feed, library, web/desktop/mobile.

Workers only edit their lane. Shared contracts are lead-owned.

## Dispatch protocol

Every assignment must include WFX ID, dependencies, frozen interfaces, allowed paths, forbidden scope, tests, and acceptance criteria. Workers report changed files and exact test results. A proposed contract change pauses the item until the lead updates the frozen docs.

## Sequence

WFX-001 first. Then WFX-002/003/004 in parallel. After those are green, run the three lanes concurrently. Converge at WFX-005, WFX-021, WFX-025, then integrate model/client work. Finish with WFX-041/042/043.

## Reject drift

Reject direct provider SDK calls in core code, platform-specific business logic, last-item-only recommendation, model-controlled authorization, native-media internals leaking into domain code, unsafe browser behavior, replacement of canonical server persistence with a local database, fake external success paths, and duplicated cross-platform domain rules.

## Definition of done

Tests pass; unsupported behavior is explicit; no private cross-lane imports; fixtures/docs are current; CI is green; no fake integration is called production-ready.

## Final verification

Inspect source, tests, imports, schemas, persistence, and platform behavior directly before declaring a phase complete. Do not rely on worker summaries alone.
