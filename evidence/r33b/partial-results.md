# R33-B — partial results (the re-entry file)

Lane: `wfx/r33b/shell-residuals` (base `main @ 178873a`, branch created clean).
This file records the lane's in-flight state so a session interruption can be
resumed surgically — never restarted.

## DONE (the state at the last write)

1. **STEP ZERO** — repo cloned at `/home/z/webflix`; `main @ 178873a`
   checked out; branch `wfx/r33b/shell-residuals` created; full survey
   complete (MATRIX.md rows D3/D4/D6/D8/N28 + O6's meta theme-color
   residual; app-shell.md; r30 lead-captures/CORPUS.md; R31/R32 evidence
   packs; the shell code). Survey conclusions recorded in
   `/home/z/my-project/worklog.md` (Task ID 0).
2. **D6 + N33 — the code** — COMMITTED @ `7661a17`:
   - `apps/web/src/components/shell/Icon.tsx`: the `subscriptions` glyph
     (hand-rolled stacked-tile + play mark).
   - `apps/web/src/components/shell/AppShell.tsx`: `RailEntry` now carries
     explicit href+icon (the presentation-route class); the
     state-conditional primary group (`RAIL_PRIMARY_SIGNED_OUT` = Home ·
     Shorts · Subscriptions · Library / `RAIL_PRIMARY_SIGNED_IN` = Home ·
     Shorts · Library — the R30-B section carries Subscriptions, never a
     duplicate); the bottom nav = Home · Shorts · Subscriptions · Library;
     the new optional `activeRailHref` prop (the aria-current seam); the
     stale RAIL_YOU absent-list comment corrected.
   - `apps/web/src/app/feed/subscriptions/page.tsx`: passes
     `activeRailHref="/feed/subscriptions"`.
   - `apps/web/tests/shell-residuals.test.ts`: 17 lane tests (all green).
   - `apps/web/tests/subscriptions-feed.test.ts`: the R31 signed-out href
     control honestly flipped to the D6 grammar (the only call-site
     update; documented in the test).
3. **MATRIX.md** — updated (uncommitted at this write): D3, D4, D6, D8,
   N28 rows re-verified statuses; N33 added (the fresh-sweep row); O6's
   verdict note closes the meta theme-color residual; the R33-B
   scoreboard addendum + the verification-log row.
4. **Typecheck** — PASS (root tsc via
   `./node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json`, 0
   diagnostics). Shell-rendering suites re-run green (77 + 118 pass
   across the AppShell-rendering files).

## IN FLIGHT

5. **The base floor battery** — running on the isolated worktree
   `/home/z/webflix-base` @ `178873a` (`bun install --frozen-lockfile`
   done): `nice -n 19 ionice -c3 bun test --parallel=1` →
   `/tmp/battery-base.log`. Expect the 5200/1/0 floor (the R32 merge
   commit's claim — this run re-measures it directly).
   NOTE: an earlier base-battery attempt died after 3 lines (resource
   contention with concurrent lane test runs — restarted alone).

## REMAINS (the exact next steps)

6. **Browser verification** (agent-browser @1440×900 + @390×844 against
   `WFX_DEV_FIXTURES=1 next dev -p 3101` from `/home/z/webflix`):
   the signed-out rail reads Home · Shorts · Subscriptions · Library;
   the Subscriptions entry navigates to /feed/subscriptions with
   aria-current painted; the signed-in chrome (fixture persona through
   /settings?section=general) reads Home · Shorts · Library + the
   Subscriptions section + the bell (no badge); ONE History entry; the
   mic honestly absent; the meta theme-color follows the boot (persisted
   light → #ffffff, dark → #0f0f0f, no stored choice → OS preference);
   the bottom nav at mobile width; captures → `captures/`.
7. **The final lane battery** — `nice -n 19 ionice -c3 bun test
   --parallel=1` on the lane tree (expect 5200 + 17 = 5217/1/0).
8. **The remaining gates** — lint (repo + lane-scoped), typecheck (root +
   journeys + app), contract-check, lane-check, parity-conformance
   (19/19), build `--filter '@wfx/app-web'`.
9. **The evidence pack** — finish `INDEX.md` (the closure table),
   `guards.md` (the gates table), `browser-verification.md`,
   `DIVERGENCES.md` (written below), captures; commit.
10. **The relay** — `git bundle create webflix-r33b-thin.bundle
    178873a..wfx/r33b/shell-residuals`; relay `evidence/r33b/` + the
    bundle + RELAY-MANIFEST.txt (sha256s) into the workspace storage
    root (`/home/z/my-project`); the completion report.

## The commit plan

- `7661a17` — the D6+N33 code + tests (DONE).
- next — the matrix + evidence pack (after the gates).
- the lane head for the lead's re-verification = the final commit.
