# R35 — guards

Lane `wfx/r35/readpath` · base main @ 2ccb536 · the read-path fix lane
(B2/B3/C2/B4 of the R34-A ledger). Every gate run on the lane head's
tree with the repo's own commands.

## The lane gates

| gate | requirement | result |
|---|---|---|
| G1 — the lane's boundaries | only the read-path sources + their tests + evidence/r35/** change; no shared package touched | PASS — `git status`/the lane commit lists exactly: 10 modified (`apps/web/src/host/view-models.ts`, `discoverability.ts`, `api/personalize/route.ts`, `api/feedback/route.ts`, the four page wirings `(home)`/`settings`/`shorts`/`watch`, `components/discovery/FeedbackControls.tsx`, `tests/discovery-surface.test.ts`, `tests/playlist-family.test.ts`) + 3 new host modules (`feedback-viewer-copy.ts`, `session-intent-cookie.ts`, `request-session-intents.ts`) + 4 new test files + `evidence/r35/**`. Zero paths outside `apps/web` + `evidence/r35` |
| G2 — install | `bun install --frozen-lockfile` | PASS — "Checked 338 installs across 353 packages (no changes)" |
| G3 — lint | `bun run lint` — the lane's files clean | PASS-with-honest-caveat — the lane's own files contribute ZERO problems (scoped verification: no error/warning names any lane file). The command itself exits 1 IDENTICALLY ON MAIN: 32 pre-existing errors + 83 warnings, ALL in `evidence/r28-recon/**` + `evidence/r29-recon/**` probe `.ts` files tracked on main (the eslint config has no `evidence/**` ignore; the R28/R29 lanes committed them — a pre-existing main condition, never a lane regression, never patched from this lane: both roots are outside the allowed paths — recorded, not worked around) |
| G4 — typecheck | `bun run typecheck` (both tsconfig projects) | PASS — exit 0. (One pre-existing call-site updated: `discovery-surface.test.ts` line 460 — `loadPersonalizeView` is async since the C2 hydration; the call was already inside an async test, `await` added with the law's comment) |
| G5 — the battery | `nice -n 19 ionice -c3 bun test --parallel=1` vs the 5256/1/0 floor, zero regressions | PASS — **5265 tests / 1 skip / 0 fail** across 304 files (5264 pass; 33700 expect() calls; 230.27 s; bun test v1.3.14) — the floor + the 9 new lane tests, ZERO regressions. battery-test-summary.txt is the run of record |
| G6 — contract-check | `bun run contract-check` | PASS — "12 frozen blocks in sync, 7 extension types present" |
| G7 — lane-check | `bun run lane-check` | PASS — "955 files, no cross-lane private imports" |
| G8 — parity-conformance | `bun test tests/parity-conformance.test.ts` stays CONFORMANT | PASS — 19 pass / 0 fail; the Web surface CONFORMANT (the lane touches no stylesheet/token bytes) |
| G9 — build | the web app's production build | PASS — `bun run --filter '@wfx/app-web' build` exit 0 (all routes compiled; `/offline` static, the rest dynamic — build.log; the filter-first form per the R33-A record: the task's literal `build --filter` form is not a bun flag) |
| G10 — the regression proof | each fix's test FAILS on main, PASSES on the lane | PASS — REGRESSION-PROOF.md + fails-on-main.log (main: 1 pass — the same-instance control — / 8 fail, each at its defect assertion; lane: 9/9 green) |

## The frozen laws — compliance

- **Never a fabricated state**: every stored read degrades honestly (a
  failing read keeps the local fold — never a fake empty); the §9 notice
  keeps its truth for rows the source no longer serves; the unsigned
  feedback failure stays a failure (status + role="alert"); the session
  mark renders only when an objective actually rides the request or the
  runtime's own fold.
- **Capability truth both directions**: the item hub's pill renders the
  STORED truth (saved AND unsaved); the B4 recovery path offers sign-in
  only for the identity class (never a wrong-class fabrication).
- **Anonymous journeys frictionless**: B4's copy names what failed and
  the optional upgrade — the anonymous browse/search/play paths are
  untouched; the cookie carries no identity (the frozen transport law).
- **No test-only controls**: the fixes are product reads/writes the
  surfaces themselves use; the tests drive the REAL handlers, the REAL
  runtime seams, and the persona's own typed write paths.
- **The IntentStore law preserved**: session scopes never enter the
  durable records (the cookie is the web adapter's session-scoped
  carrier; `endSession` + the cookie clear are one truth).
- **The identity law preserved**: identity travels as headers, never in
  URLs — and never in the cookie either; the service's own typed error
  is untouched (the fix is the web adapter's presentation law).

## Reproduction

```bash
bun install --frozen-lockfile
bun test apps/web/tests/r35-b2-item-watchlist-reload.test.ts \
          apps/web/tests/r35-b3-library-playlist-resolution.test.ts \
          apps/web/tests/r35-c2-session-intent-reflection.test.ts \
          apps/web/tests/r35-b4-feedback-viewer-copy.test.ts   # 9/9 green
# the fails-on-main proof:
git stash push -u && cp <the four files> apps/web/tests/ \
  && bun test apps/web/tests/r35-*.test.ts                    # 8/9 fail (the defects)
nice -n 19 ionice -c3 bun test --parallel=1                   # 5265/1/0
bun run lint && bun run typecheck && bun run contract-check && bun run lane-check
bun test tests/parity-conformance.test.ts
bun run --filter '@wfx/app-web' build
```
