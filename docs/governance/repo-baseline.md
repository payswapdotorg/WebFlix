# WebFlix Repository Baseline (WFX-001)

Status: ACTIVE — lead-owned. Changes require tech-lead review.

## Layout

```
packages/domain          @wfx/domain          frozen contracts + lane extension types (graph/, intent/ are Lane A)
packages/connectors      @wfx/connectors      Connector SDK (Lane B)
packages/native-media    @wfx/native-media    Native media service contract + engine adapter (Lane B)
packages/experience      @wfx/experience      Experience API use-cases (Lane C)
packages/recommendation  @wfx/recommendation  Recommendation OS (Lane A)
packages/model-fabric    @wfx/model-fabric    Model Fabric (Lane A)
apps/web                 @wfx/app-web         Web client surface (Lane C)
apps/desktop             @wfx/app-desktop     Desktop (Tauri) scaffold (Lane C)
apps/mobile              @wfx/app-mobile      Mobile scaffold (Lane C)
scripts/                 governance tooling (lead)
tests/                   shared governance tests (lead)
docs/                    frozen architecture (lead)
```

## Commands

- `bun run ci` — lint + typecheck + test + contract-check + lane-check (same as CI).
- `bun run contract-check` — verifies `packages/domain/src/contracts/frozen.ts` is in sync with `docs/architecture/contracts.md` and extension types exist.
- `bun run contract-check -- --write` — lead-only: regenerate frozen.ts after a contracts.md change.
- `bun run lane-check` — rejects deep cross-package imports (`@wfx/<pkg>/src/...`) and relative imports escaping a package.

## Lane rules

1. Workers edit only their lane's paths (see `.github/CODEOWNERS`).
2. Cross-package imports go through public entry points (`@wfx/<pkg>`), never deep paths.
3. `packages/domain/src/contracts/frozen.ts` is generated; hand edits are reverted by CI.
4. `packages/domain/src/contracts/extensions.ts` refines lane-owned extension types; semantic changes require lead review.
5. A proposed contract change pauses the work item until the lead updates `docs/architecture/contracts.md` and regenerates.

## Dispatch protocol (lead → worker)

Every assignment includes: WFX ID, dependencies, frozen interfaces, allowed paths, forbidden scope, tests to write, and acceptance criteria. Workers report changed files and exact test results.

## Definition of done (per work item)

Tests pass; unsupported behavior is explicit (typed unsupported results); no private cross-lane imports; fixtures/docs current; CI green; no fake integration marked production-ready.
