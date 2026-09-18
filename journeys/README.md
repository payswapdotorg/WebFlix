# WebFlix Golden Journey Harness (R16)

The reusable agent-browser journey automation for the WebFlix golden
journey catalog (`docs/validation/webflix-golden-journeys.md`): the
helpers, the encoded journeys, the runner, and the evidence procedure.

## The laws this harness keeps

1. **Journeys are checks, not theater.** Every encoded journey asserts
   the doc's expected states and FAILS on regression (a failed
   assertion throws; the runner captures failure evidence and exits
   red). A journey that cannot fail is not a check.
2. **The layering law.** `journeys/` imports NOTHING from any `@wfx`
   package. The harness consumes the running product as a user — HTTP +
   the browser (enforced by the lane-guard test over this tree).
3. **The browser-validation protocol** (the frozen rule): every
   navigation is `open → wait --load networkidle → snapshot -i`; a
   fresh snapshot follows every DOM-changing interaction; final
   screenshots + failure evidence are captured per journey.
4. **Determinism where possible.** The product boots through its own
   documented deterministic fixture path (`WFX_DEV_FIXTURES=1`,
   `next dev -p 3101`, the loud dev badge). The scripted acquisition
   drive state is reset before every run so J21–J26 assert the scripted
   sequence from step 0. One isolated agent-browser session per run.
   No external network (fixture embed URLs are `.invalid` — the
   assertions bind to the DOM grammar, never to provider content).
5. **Honest listing, never silent skips.** Journeys this configuration
   cannot execute (or cannot fully exercise) are listed in the manifest
   with their exact reason and the local/Desktop procedure — see
   `web/index.ts`'s `JOURNEY_LIMITATIONS` and `desktop/README.md`.
6. **Evidence is committed.** Each run writes `manifest.json` +
   `summary.md` + per-journey screenshots/snapshots/narrations under
   `evidence/r16/` (the rNN convention, following `evidence/r14/`).

## Running

```bash
bun run journeys:web          # boot the product (fixtures mode) + run every encoded journey
bun run journeys:list         # print the catalog
bun run journeys:ci           # the CI configuration (same set, strict)
bun run journeys:web -- --filter J01,J21   # a subset
bun run journeys:web -- --base-url http://localhost:3101   # consume a running product
```

Exit code 0 = every executed journey passed; 1 = any failure (the CI
gate's signal).

## Layout

- `lib/browser.ts` — the agent-browser CLI driver (typed wrapper; one
  named session per run; every failure is the typed `BrowserError`).
- `lib/assertions.ts` — the assertion vocabulary: records
  expected/observed, throws the typed `AssertionError` on regression.
- `lib/state.ts` — the product's stable `data-wfx-*` state grammar,
  parsed into typed observations (pure; unit-tested).
- `lib/report.ts` — the manifest schema + summary rendering (pure;
  unit-tested).
- `lib/product.ts` — the deterministic product boot (web fixtures mode,
  port 3101, readiness polling, teardown, drive-state reset).
- `lib/proc.ts` — the spawn seam.
- `web/j*.ts` — the encoded journeys (one file per journey, in catalog
  order; J01–J27, J29–J32 encoded; J28 declared not-run with its
  procedure).
- `desktop/README.md` — the Desktop native-only equivalent evidence
  procedure (J21/J23/J24/J25/J27 native paths).
- `runner.ts` — the CLI entry.
- `*.test.ts` — the unit tests for the harness's pure logic (discovered
  by the repo's `bun test` gate).

## Adding a journey

Encode the doc's expected states as assertions over the `data-wfx-*`
grammar, navigate the user path (never hardcoded canonical ids — read
the DOM's own hrefs), capture a final screenshot + narrations, and
declare any reach limits in `JOURNEY_LIMITATIONS` instead of skipping.
If the journey needs a new product hook, request it through the lead —
the harness never imports product internals.
