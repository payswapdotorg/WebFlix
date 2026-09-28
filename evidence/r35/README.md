# R35 — the read-path lane (the R34-A ledger's four defect-candidates, fixed)

Lane `wfx/r35/readpath` · base main @ 2ccb536 · 2026-09-28 UTC · the work
order: fix B2/B3/C2 (the service-mode read-path hydration class) + B4
(the anonymous feedback's viewer-facing copy + recovery path), each with a
regression test that FAILS on main and PASSES on the lane.

## The composition map

| artifact | what it is |
|---|---|
| FIXES.md | the four fixes: the ledger row → the root cause → the change → the test (the lane's core document) |
| REGRESSION-PROOF.md | the fails-on-main / passes-on-lane record (verbatim runner output, both directions) |
| fails-on-main.log | the main-side run's own output (9 tests: 1 pass — the same-instance control — / 8 fail, each at its defect assertion) |
| guards.md | the lane gates G1–G10 (install / lint / typecheck / battery 5265-1-0 vs the 5256/1/0 floor / contract / lane / parity / build) |
| battery-test-summary.txt | the battery run of record (the full guard command's own tail) |
| build.log | the production build's own output (exit 0, all routes) |
| partial-results.md | the re-entry map (the resumption law) — the completed-phase record |

## The one-line summary of every fix

- **B2** — the item hub's `watchlistSaved` now reads the STORED library
  (joined by source identity) before the per-instance fold
  (`view-models.ts`: `readStoredLibrary` + `storedWatchlistSavedOf`).
- **B3** — the Library read resolves the stored rows' source realizations
  through the runtime's own search seam when entries are unresolved
  (`view-models.ts`: `resolveStoredRealizations`); rows the source no
  longer serves stay honestly unjoined (the §9 notice keeps its truth).
- **C2** — the personalize/discovery reads HYDRATE the durable intent
  store and merge the request-carried session objectives (the
  `wfx_session_intent` session cookie — the session-scoped carrier the
  IntentStore law requires); every intent-writing page read reflects the
  write on ANY instance.
- **B4** — the feedback route maps the service's typed failures into a
  closed viewer-safe vocabulary (`host/feedback-viewer-copy.ts`: the
  identity-absent class → `identity-required` + the typed detail riding
  `detail`); the failure element renders honest viewer copy + the
  sign-in recovery path; the raw typed error never renders (console.warn
  + the network body keep the engineer's evidence); never a fake success.

## The lane's own law

One read law, every read path: **hydrate-or-read-the-store BEFORE any
per-instance runtime fold** — the R30 reload-durability law lifted from
the watch page's shell to the item hub (B2), the Library's resolution
(B3), and the discovery/personalize reads (C2). Never a fabricated state:
a failing stored read degrades to the local fold (the honest degradation),
an unresolvable row stays behind the §9 notice, an unsigned feedback
failure stays a failure. B4 is the presentation half of the same honesty:
the typed truth is kept (network + console) but the VIEWER surface speaks
the product's voice and names the recovery path.
