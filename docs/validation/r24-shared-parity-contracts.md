# R24 Shared Parity Contracts — Worker 1 Lane Deliverable

**Status:** FROZEN LANE CONTRACT (Worker 1 — shared taxonomy + telemetry; `wfx/r24/shared`)
**Date:** 2026-09-21
**Canonical plan:** docs/plans/2026-09-20-webflix-youtube-parity-performance-plan.md (R24-A taxonomy schema, R24-B extension law, R24-C pairing matrix, R24-D torrent parity, R24-E performance contract)
**Canonical lab contract:** docs/validation/youtube-parity-lab.md

This document is the integration handoff for the R24 shared contracts. Everything described here lives as typed, machine-checked code in `@wfx/client-runtime` (import ONLY from the package entry point — the lane checker forbids deep paths). Workers 2/3 bind their Web/Desktop parity surfaces to these contracts so Web/Desktop cannot diverge; the lead's J40/J41/J42 acceptance verifies against the same objects.

## The four frozen contracts

| Module | What it freezes | Plan section |
|---|---|---|
| `packages/client-runtime/src/parity-taxonomy.ts` | The R24-A parity taxonomy: the typed 17-field feature-inventory schema + the complete 65-row matrix | R24-A |
| `packages/client-runtime/src/playback-telemetry.ts` | The shared performance telemetry contract: metric shapes, thresholds, benchmark records, startup instrumentation | R24-E |
| `packages/client-runtime/src/capability-placement.ts` | The feature capability matrix + placement contracts: the R24-B laws 1–6 as machine-checkable contracts | R24-B |
| `packages/client-runtime/src/interaction-policy.ts` | The interaction-policy seams: the startup law, the enrichment boundary, attention-aware autoplay, the aggregate regression invariants | R24-E + R24-C autoplay |

## R24-A — The parity taxonomy (65 rows, every row classified)

The typed schema is exactly the plan's 17 fields: `referenceCapability`, `referenceSurface`, `referenceBehavior`, `webflixTreatment`, `classification`, user entry point, Web/Desktop applicability, anonymous/auth requirement (the R23-A `ViewerAuthClass`), source/realization implications, persistence expectation, accessibility requirement, performance relevance, test/journey id, evidence link, implementation owner, dependency ids.

The frozen matrix (`PARITY_TAXONOMY`) covers:

- the plan's ENTIRE R24-C pairing matrix — Discovery (10 rows), Watch/player (26 rows), Shorts (7 rows), Identity/continuity (8 rows); the plan's Watch cell "Cast/second screen" consolidates with the Identity cell "TV/second-screen continuation" into one `tv-second-screen-continuation` row, exactly as the frozen lab inventory consolidates them;
- the frozen lab inventory's extra reference rows (natural-language search, channel pages, save queue, description, continue watching, device handoff, offline viewing, replay);
- every R24-B WebFlix-only extension (all 14).

**Classification distribution:** 11 `parity` / 45 `native-equivalent` / 9 `platform-variant` / 0 `intentionally-out-of-scope`. The classification vocabulary includes `intentionally-out-of-scope` with machine-required companions (`outOfScopeReason` + `nearestWebFlixPath`); no current row uses it because neither the R24-C matrix nor the lab inventory contains an out-of-scope row. Scope-boundary questions (the plan's viewer-product scope vs. the creator backend; ad-supported playback) are escalated to the lead for the Session 1 challenge rather than silently classified here.

**Machine checks** (`validateParityTaxonomy()`): unique/complete row ids; real copy in every field; evidence links are doc/evidence paths or URLs; journey ids match `J##`; dependency ids match `R##`/`R##-A`; the pending-classification guard (nothing "to be considered"/"TBD"/"unclassified"); out-of-scope companions; entry-point laws (a WebFlix-only extension may never be settings-only — an R24 rejection); and plan coverage (`PLAN_R24C_*` cell lists + `PLAN_R24B_EXTENSION_ITEMS` + `LAB_INVENTORY_EXTRA_ROWS`).

## R24-E — The shared performance telemetry contract

- **Metrics** (`PlaybackDurationMetricId` + `PlaybackRatioMetricId`): the plan's nine primary metrics plus `realization-switch-time` (J41/lab metric 10).
- **Thresholds** (frozen constants): TTFF p50 ≤ +150 ms, p75 ≤ +300 ms, p95 ≤ +750 ms vs the same-content YouTube baseline; startup failure ≤ +0.5 pp; first-60s rebuffer ≤ +0.25 pp. Published as `PLAYBACK_PERFORMANCE_THRESHOLD_CONTRACT` (one derivation source). The lead may tighten after baseline measurement; changing these values is lead-owned ratification.
- **Instrumentation** (`PlaybackStartupMarkerId` + `PLAYBACK_METRIC_MARKER_PAIRS`): the typed marker vocabulary and the metric→marker-pair table. Record the same marker pairs on Web and Desktop so the numbers mean the same thing.
- **Benchmark records** (`PlaybackBenchmarkRun`): cold/warm `cachePass`; `environment` carries commit SHA, browser, OS/device, viewport, network profile, YouTube page context; `content` carries the same-content law (`samePublicContentOnYouTube` + the reference id); duration metrics retain RAW observations (`valuesMs`); ratio metrics retain raw counts; `qualitative` carries the three J41 observations (one obvious play action / nonessential blocking / fake buffering).
- **Evaluation** (`evaluatePlaybackThresholds(webflix, youtubeBaseline)`): the pure fold that computes percentile deltas (standard linear-interpolation percentile — the lab's one definition) and pass/fail per threshold. Comparability is CHECKED: mismatched content/cache-pass/environment is a typed blocker, never a silent comparison. The qualitative J41 laws fold into `pass` — no number rescues an ambiguous play action, a first frame that waited on nonessential work, or fake buffering progress.

## The capability matrix + placement contracts (R24-B laws 1–6)

`CAPABILITY_PLACEMENTS` carries one placement record per taxonomy capability (65, machine-checked). Each record freezes: the stable term, the ONE primary action, secondary actions, the disclosure ladder, the platform truth, the four honest states (empty/loading/success/failure-with-recovery), anonymous vs authenticated behavior, mobile readiness, reduced-motion and keyboard/screen-reader behavior, `blocksPlayback` (false for every capability — the R24-E startup hook), `settingsManaged` (true only for the `notifications` reference capability), and evidence.

`checkPlacementLaws(record)` / `validateCapabilityPlacementMatrix()` machine-check:

1. **point-of-intent** — a WebFlix-only extension has a contextual entry; settings-only is an R24 rejection;
2. **one-primary-action** — one non-blank primary; secondaries never duplicate it;
3. **progressive-disclosure** — the ladder starts at `summary` and strictly climbs `summary → detail → diagnostics`;
4. **no-dashboard-requirement** — every entry surface is inside the CLOSED product-surface union (Home/Watch/Shorts/Search/Library/Settings + item/player; no dashboard route exists in the union by construction); `settingsManaged` is lawful only for reference capabilities;
5. **stable-terminology** — terms unique across records except inside a declared shared-term family (frozen families: `playback-speed`, `feedback`, `history`, `following`, `offline`; families need ≥2 members);
6. **platform-capability-truth** — placement truth must EQUAL the taxonomy applicability; an honest `native-only-next-step` must point at a platform whose entry is `supported`.

`capabilityMatrix()` is the joined read model (classification + placement) the surfaces render; `capabilityMatrixEntryOf(id)` is the per-capability lookup.

## The interaction-policy seams (playback never waits on recommendations/AI)

- **The two lanes** (`interaction-policy.ts`): the ESSENTIAL lane (`resolve-canonical-item → resolve-playback-realization → load-resume-state → engage-media-surface → await-first-frame-evidence`) is the only work first frame may wait for. The DEFERRED lane (`fetch-poster`, `fetch-nonessential-metadata`, `recommendation-enrichment`, `ai-enrichment`, `semantic-indexing`, `analytics`, `social-surface-enrichment`) runs and renders when ready — never awaited before first frame.
- **`planPlaybackStartup(requested)`** splits requested work into the lanes; **`startupLawViolations(plan)`** is the machine check (smuggling deferred work onto the awaited lane, an incomplete five-step path, unknown/duplicated work all fail).
- **`resolvePlaybackStartEligibility(gates)`** is the start decision over the essential gates ONLY — enrichment has no parameter, by construction.
- **`renderPlaybackStartupSeam(gates, enrichmentStates)`** is the view surfaces render: playback may be `mayStart` while every enrichment kind is `pending`; enrichment failures are typed `failed-nonessential`.
- **Attention-policy-aware autoplay**: the frozen `AUTOPLAY_POLICY` table (Mindful stops with the next item offered; Balanced/Immersive auto-advance; Custom follows the user's dial). `resolveAutoplayDecision` fires only after playback ends, never gates startup, and is IDENTICAL for anonymous and authenticated viewers (R23-A).

## The aggregate regression invariant

`checkParityRegressionInvariants()` (one callable, used by CI + the lead's harness) folds:

- taxonomy completeness (the lab rule),
- the placement laws + coverage,
- the startup law (plan + enrichment boundary),
- the autoplay law (every mode decided, ends-only, anonymous-identical),
- the frozen thresholds (exactly 150/300/750 ms and 0.5/0.25 pp — a silent loosening fails here).

## How Workers 2/3 bind (integration handoff)

1. **Parity surfaces**: render classification + placement from `capabilityMatrix()`; never re-derive placement semantics or invent terminology (the stable term is the one derivation source). A capability your adapter cannot run stays discoverable with its honest next step (`native-only-next-step`), never a dead end.
2. **Performance harnesses**: record `PlaybackStartupMarker` pairs through your platform's instrumentation; build `PlaybackBenchmarkRun`s (cold + warm, both cache passes per run set); evaluate against the YouTube baseline with `evaluatePlaybackThresholds`; retain raw observations. A benchmark passing through synthetic fixture behavior is an R24 rejection.
3. **Startup guarantees**: build your startup wiring so that only `PLAYBACK_STARTUP_ESSENTIAL_WORK` is awaited before first frame; render enrichment through `renderPlaybackStartupSeam` (pending enrichment is honest and non-blocking); autoplay through `resolveAutoplayDecision` only.
4. **Evidence**: J40/J41/J42 evidence should reference taxonomy row ids (`ParityTaxonomyRowId`) and the placement decisions, so the lead's ratification is mechanical.

## Frozen product laws preserved (machine-checked)

- Primary navigation stays Home / Watch / Shorts / Search / Library / Settings — every entry point renders inside the closed `ProductSurfaceId` union; no architecture dashboard route exists in the vocabulary.
- The taxonomy is inventory + classification — it creates no second product architecture (the rows never mint navigation).
- Playback startup never depends on recommendation/AI work; never fake buffering progress (the qualitative J41 laws + the startup seam).
- Anonymous viewing stays frictionless (R23-A/B: `anonymous-public-viewing` is `anonymous` + startup-critical; autoplay is account-independent).
- Torrent stays first-class (R23-C: `authorized-peer-copy` is a startup-critical `native-equivalent` realization; the placement keeps the "Authorized peer copy" vocabulary under Where to watch).
- Repository is the source of truth: contract changes beyond this lane are lead-owned (the frozen `docs/architecture/contracts.md` + `check-contracts` flow was NOT touched by this lane).

## Test coverage (this lane)

| Test file | Contract | Tests |
|---|---|---|
| `packages/client-runtime/tests/parity-taxonomy.test.ts` | R24-A | 23 |
| `packages/client-runtime/tests/playback-telemetry.test.ts` | R24-E telemetry | 15 |
| `packages/client-runtime/tests/capability-placement.test.ts` | R24-B laws 1–6 | 19 |
| `packages/client-runtime/tests/interaction-policy.test.ts` | startup/autoplay/regression seams | 17 |

Total: 74 tests for the frozen contracts, including guard-catches-broken-record cases (the checks are real, not decorative).
