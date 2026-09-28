# R35 — the regression proof (fails on main / passes on the lane)

The work order's law: each fix carries a regression test that FAILS on
main and PASSES on `wfx/r35/readpath`. Both directions were run with the
repo's own runner (`bun test v1.3.14`), same working tree state, same
fixture persona resets.

## The method (durable, re-runnable)

1. On the lane head: `git stash push -u` (ALL lane changes — the nine
   modified files + the untracked source/test/evidence files) — the tree
   is pristine main @ 2ccb536 (`git status --porcelain` empty before the
   test files return).
2. The four test files alone are copied back into `apps/web/tests/`
   (they are untracked additions; main's source answers them).
3. `bun test apps/web/tests/r35-*.test.ts` — the fails-on-main run of
   record (fails-on-main.log, the runner's own output).
4. The test files removed; `git stash pop` — the lane restored; the
   test files returned; the same four files re-run green (the lane-side
   run of record, below).

## The main-side run (verbatim — fails-on-main.log)

```
 1 pass
 8 fail
 24 expect() calls
Ran 9 tests across 4 files. [3.07s]
```

Every failure at its defect assertion (the runner's own expected/received
pairs, abridged here — the full log is the artifact):

| test | main's answer (the defect verbatim) |
|---|---|
| B2 reload | `watchlistSaved` — `Expected: true / Received: false` (the item hub offers "Save to Watchlist" after save+reload — the ledger row's own probe `data-wfx-watchlist-saved="false"`) |
| B2 same-instance control | PASS on main too (the control — the defect is reload-only, exactly the ledger's "cannot reproduce on the single-instance dev boot" mirror) |
| B3 reload | `joined` — `Expected: not to be null / Received: null` (the §9 hide: the row the source still serves renders "unavailable") |
| B4 route (identity 400) | `error` — `Expected to not contain: "x-wfx-user-id" / Received: "{"error":"invalid-request","detail":"x-wfx-user-id: required identity header is absent (identity travels as headers, never in URLs)"}"` (the ledger row's quote, character for character) |
| B4 route (502) | `error` — `Expected: "the feedback control could not be saved right now — retry in a moment" / Received: "{"ok":false,"detail":"service boot failed"}"` (the raw-passthrough class) |
| B4 client (copy+signin) | `Element type is invalid … got: undefined` (the `FeedbackFailure` export does not exist on main — the law did not exist; honestly recorded as such) |
| B4 client (sanitize) | same export-not-found (the law did not exist) |
| C2 reflection | the fresh bundle's intents — `Expected to contain: "slow documentaries about deep space" / Received: []` (no intent mark on the fresh instance's SSR read — `markInDom:false`, the ledger row's own probe) |
| C2 clear | the carrier's objectives — `Expected to contain: "loud action tonight" / Received: []` (no carrier existed on main) |

## The lane-side run (the same four files, the lane head's tree)

```
apps/web/tests/r35-b2-item-watchlist-reload.test.ts: 2 pass
apps/web/tests/r35-b3-library-playlist-resolution.test.ts: 1 pass
apps/web/tests/r35-c2-session-intent-reflection.test.ts: 2 pass
apps/web/tests/r35-b4-feedback-viewer-copy.test.ts: 4 pass

 9 pass
 0 fail
 65 expect() calls
```

(First verified per-file during composition, then the full battery
carried them green — see battery-test-summary.txt: 5265 tests / 1 skip /
0 fail, the 5256/1/0 floor + the 9 new lane tests, ZERO regressions.)

## The honesty notes

- The B4 client-side blocks' main-side failure is an export-not-found
  error, not a defect-assertion failure — the rendered-copy law had no
  main counterpart to fail against (main rendered the raw string; the
  route-side blocks carry that defect demonstration). Recorded as such,
  never presented as an assertion-level fail.
- The B2 same-instance control passing on main is the proof the harness
  isolates the SERVICE-MODE split (the reload), not the write path —
  the same shape the ledger's "cannot reproduce on the single-instance
  dev boot" note demands.
- The battery's pre-existing R30-B §9 test (playlist-family.test.ts) was
  updated to the post-R35 law (its premise WAS the B3 defect — rows the
  source still serves, hiding): it now seeds retired rows the source no
  longer serves, and the §9 notice still fires for them. The premise
  change is documented in the test itself. No other pre-existing test
  changed behavior (the battery: 5265/1/0, every prior test green).
