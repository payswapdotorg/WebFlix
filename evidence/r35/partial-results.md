# R35 partial results — the resumption map (the re-entry law)

Lane `wfx/r35/readpath` · base main @ 2ccb536 · work: the R34-A ledger's
four read-path defect-candidates (B2/B3/C2/B4).

## Phase record (updated as work lands)

### Phase 1 — STEP ZERO (DONE)
- Clone verified at main @ 2ccb536; branch `wfx/r35/readpath` created from it.
- `evidence/r34a/LEDGER.md` read END TO END; the four rows:
  - **B2** — the item hub's watchlist truth reads the un-hydrated per-instance
    runtime fold: after a successful save + RELOAD, the item hub still offers
    "Save to Watchlist" (`data-wfx-watchlist-saved="false"`) while the Library
    page's read (the service store) sees the write. Service-mode specific
    (each page render a cold runtime); cannot reproduce on the single-instance
    dev boot. Fix class: hydrate-or-read-the-store BEFORE the item page's
    `watchlistSaved` fold.
  - **B3** — the playlist write lands and is visible ("Parity Walk" in the
    Library's Playlists section) but the section answers "1 unavailable video
    is hidden" — the Library read cannot resolve the item's source realization
    in its own instance. Same read-path class as B2.
  - **B4** — the anonymous recommendation-feedback submit renders the service's
    raw typed error verbatim in the failure element
    (`{"error":"invalid-request","detail":"x-wfx-user-id: required identity
    header is absent …"}`). Honest (never fake success) but engineering-grade
    copy on a viewer-facing surface, and no user-facing recovery path (the
    sign-in upgrade) is offered. Fix class: copy/recovery grade.
  - **C2** — POST `/api/personalize` `{kind:"intent"}` answers 200 and the
    route's own GET reads both intents back, but the watch page's SSR discovery
    bundle renders no intent mark (the per-instance read — the same
    serverless class as B2).
- Cited evidence (j40-step08b, j40-step11, j40-step10b, j42-step06) + the R30
  reload-durability law context reviewed: NEVER a fabricated state — read the
  real store; `subscribe-reload-durability.test.ts` is the harness pattern.
- The four read paths surveyed: `loadDetailView`'s `watchlistSaved` fold
  (view-models.ts), `loadLibraryView`'s `joinedItemOf` resolution
  (view-models.ts), `loadDiscoveryBundle`/`loadPersonalizeView` (the watch
  page's SSR discovery read — discoverability.ts), the feedback failure
  element (`FeedbackControls.tsx` + `/api/feedback`'s raw-detail passthrough).

### Phase 2 — the B2/B3/C2 source fixes (DONE — carried from the resumed turn)
- `apps/web/src/host/view-models.ts`:
  - `readStoredLibrary(host)` — the shared stored-library read (the R30 law
    lifted to one seam; null = the honest degradation, the local fold answers).
  - `storedWatchlistSavedOf(host, item)` — **B2**: the item hub's
    `watchlistSaved` now joins the STORED rows by source identity
    (connectorId + externalRef); the local fold answers only when the stored
    read fails. `loadDetailView` wired to it.
  - `resolveStoredRealizations(host)` — **B3**: when any watchlist/history
    entry is unresolved, the stored rows' source realizations resolve through
    the runtime's OWN search seam (the `/api/library` bridge law) and the
    entries re-join. A row the source no longer serves stays honestly
    unjoined (the §9 notice keeps its truth).
  - `loadPlayerViewShell`'s subscribe read refactored onto the shared
    `readStoredLibrary` seam (one law, every read path).
- `apps/web/src/host/session-intent-cookie.ts` (NEW) — the C2 session-scoped
  carrier: the `wfx_session_intent` cookie (httpOnly, session-scoped — the
  intent's own scope; the IntentStore law keeps session scopes OUT of durable
  records). Bounded, deduped, order-stable, structurally guarded.
- `apps/web/src/host/request-session-intents.ts` (NEW) — the pages'
  request-scoped read (next/headers → the guarded objectives).
- `apps/web/src/host/discoverability.ts` — `loadPersonalizeView` now HYDRATES
  the durable intent store first (the R05 seam — a failing hydrate keeps the
  local view, the honest degradation) and merges the request-carried session
  objectives (local entries win per objective). `loadDiscoveryBundle` takes
  `requestCarriedIntents` and passes them through.
- `apps/web/src/app/api/personalize/route.ts` — the intent write sets the
  carrier cookie (merged active set); clear-intent empties it (one truth, both
  stores); every answer composes the request-carried objectives.
- Page wiring: `(home)/page.tsx`, `settings/page.tsx`, `shorts/page.tsx`,
  `watch/page.tsx` read the request-carried intents and pass them to the
  discovery/personalize reads.

### Phase 3 — B4 + the four regression tests (DONE)
- `apps/web/src/host/feedback-viewer-copy.ts` (NEW) — the B4 copy law
  (the closed `identity-required` code, the viewer copy, the sign-in
  recovery href, the route-side + client-side maps; the typed detail
  extracted honestly from the service body).
- `apps/web/src/app/api/feedback/route.ts` — the three `!response.ok`
  branches map through the copy law (viewer-safe error + `detail`; the
  status stays the service's own typed status).
- `apps/web/src/components/discovery/FeedbackControls.tsx` — the failure
  state carries `{error, detail?}`; `FeedbackFailure` (exported) renders
  the copy + `data-wfx-feedback-signin` (`/settings?section=general`);
  the typed detail `console.warn`s (never `error`); never a fabricated
  success.
- The four regression tests written (r35-b2 / r35-b3 / r35-c2 /
  r35-b4 in `apps/web/tests/`), each pinned to its defect assertion.
- THE FAILS-ON-MAIN PROOF RUN: `git stash push -u` → the four test files
  re-run against pristine main @ 2ccb536 → **1 pass (the same-instance
  control) / 8 fail** — every failure at its defect assertion (B2
  saved=false; B3 joined=null; B4 the raw `{"error":"invalid-request",
  "detail":"x-wfx-user-id: …"}` verbatim + the 502 raw body; the B4
  client blocks export-not-found — the law did not exist; C2 the fresh
  bundle's intents []). `git stash pop` — the lane restored. The full
  runner output: fails-on-main.log.
- Two pre-existing call sites updated honestly (both inside the allowed
  paths): `discovery-surface.test.ts` (loadPersonalizeView is async
  since the C2 hydration — await added) and `playlist-family.test.ts`
  (the R30-B §9 premise WAS the B3 defect — it now seeds retired rows
  the source no longer serves; documented in the test).

### Phase 4 — guards + evidence + relay (DONE)
- Guards: install PASS (no changes); lint — lane files ZERO problems
  (the command exits 1 IDENTICALLY on main: 32 pre-existing errors in
  evidence/r28-recon + r29-recon tracked on main — recorded, never
  worked around); typecheck PASS (both projects); the battery
  **5265/1/0** (the 5256/1/0 floor + 9 new lane tests, zero
  regressions; 33700 expect calls; 230.27 s); contract-check PASS (12
  frozen blocks); lane-check PASS (955 files); parity-conformance PASS
  (19/19, CONFORMANT); build PASS (`bun run --filter '@wfx/app-web'
  build`, exit 0).
- The evidence pack: README.md, FIXES.md, REGRESSION-PROOF.md,
  fails-on-main.log, guards.md, battery-test-summary.txt, build.log,
  this partial-results.md.
- The lane committed; the evidence + the sha256 manifest relayed to the
  WORKSPACE STORAGE ROOT (RELAY-MANIFEST.txt).
