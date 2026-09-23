# R27 corpus → contract encoding map (provenance annotation)

**W1 lane annotation (R27-W1).** This file records WHERE the reference
corpus is machine-encoded after the W1 shared lane landed. It changes no
corpus value — `reference/` remains the lead's single source of truth;
the modules below MIRROR it and are asserted against it by the harness.

## The canonical encoding (the single-token-module law)

| Corpus file | Machine encoding (canonical) | Asserted by |
| --- | --- | --- |
| `reference/design-tokens.md` — Canvas & surfaces | `packages/platform-contracts/src/parity-tokens.ts` → `PARITY_TOKENS` (22 tokens, dark default + light, provenance-tagged, `--wfx-*` cssName per row) | `packages/platform-contracts/tests/parity-tokens.test.ts` (independent restatement) + `tests/parity-conformance.test.ts` (active-custom-property assertion per surface) |
| `reference/design-tokens.md` — Typography (Roboto ladder) | same module → `PARITY_TYPE_SCALE` (13 roles: size/weight/line-height/clamp/color-token) | same tests |
| `reference/design-tokens.md` — Geometry + `reference/watch-geometry.md` (measured rects) | same module → `PARITY_GEOMETRY` + `PARITY_GEOMETRY_PROVENANCE` (shell, chips, grid, search, watch two-column @1440 incl. primary 1012 / secondary 412 / gap 16 / player 996×560, player chrome, related 168×94, shorts, scrollbar, skeleton, pill) | same tests + the structural anatomy checks |
| `reference/design-tokens.md` — Motion & states | same module → `PARITY_MOTION` (120–300ms band, 150 pinned; 500ms hover dwell; 3s idle fade; 2px focus ring; 4s toast) | `packages/client-runtime/tests/parity-card-grammar.test.ts` (the interaction policy rows) |
| `reference/design-tokens.md` — Player chrome anatomy (OPERATE) | same module → `PARITY_CHROME_CONTROLS` (the left→right order with `when-queued` / `capability-gated` availability) + `PARITY_KEYBOARD` (space/k, j/l ±10s, ←/→ ±5s, ↑/↓, f, t, m, c, 0–9) + `PARITY_TOUCH` | `packages/platform-contracts/tests/parity-tokens.test.ts` |
| `reference/app-shell.md` + `reference/search-card-grammar.json` (card grammar) | `packages/client-runtime/src/parity-card-grammar.ts` (feed / search-row / related / shorts view-models + grammar descriptors tied to the token contract + the honest-chip/skeleton laws) | `packages/client-runtime/tests/parity-card-grammar.test.ts` |
| The corpus JSON serialization | `paritySheetJson()` / `paritySheet()` in the token module | round-trip test |

## The conformance harness (the proof instrument)

- Engine: `packages/platform-contracts/src/parity-conformance.ts` — the
  CSS parser + the per-surface descriptors (Web: `apps/web/src/app/globals.css`;
  Desktop: the generated `apps/desktop/src/surface/r27-parity-css.ts`
  output) + `evaluateParitySurfaceConformance` (token DIFFs + structural
  anatomy DIFFs) + `renderParityConformanceReport`.
- Suite: `tests/parity-conformance.test.ts` — run via the repo's test
  gate; the `conformance:status` describe block prints the full report
  (contract-present vs surface state, every DIFF).

## App-side mirrors (pre-existing, asserted equal to the canonical)

- Desktop (W3, merged): `apps/desktop/src/surface/r27-parity-tokens.ts`
  mirrors the sheet app-side; the harness asserts it equals the
  canonical contract value-for-value (the no-forked-tokens law).
- Web (W2 lane): retargets `apps/web/src/app/globals.css` onto the same
  `--wfx-*` names; the harness asserts the ACTIVE values per theme and
  the structural anatomy, classifying the surface CONFORMANT / DRIFT /
  SURFACES-PENDING.
