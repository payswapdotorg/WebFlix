# R30-B — partial results (the re-entry file)

The lane's own state, kept current as work completes (the re-entry law: RESUME —
never restart). Format: what is DONE (with the artifact), what REMAINS, the exact
next step.

## DONE (all gates green — see guards.md)

1. **STEP ZERO**: the repo cloned; `main @ f1bdba6` verified; `wfx/r30/b` created;
   `origin/wfx/r30/lead-captures @ b77873b` merged clean; CORPUS.md + README + raw +
   vlm read fully; the account-model survey done (the worklog at
   `/home/z/my-project/worklog.md` records the survey).
2. **§1/§2 the bell family**: `components/shell/bell-grammar.ts` (the two-layer
   grammar — pure), `components/shell/MastheadBell.tsx` (the 40x40 button + the
   panel's honest-empty row), the `bell` icon in `Icon.tsx`, the CSS blocks.
3. **§3 the account menu**: `components/shell/AccountMenu.tsx` (the island + the
   `AccountMenuPanel` export; the profile-switch subpage over the REAL
   `/api/auth/select-profile`; the sign-out over `/api/auth/logout`;
   `displayLanguageLabel` via `Intl.DisplayNames`), the ShortcutsSheet extraction
   (`components/shell/ShortcutsSheet.tsx` + the gear refactored to consume it).
4. **§4 the rail**: `components/shell/RailSubscriptions.tsx` + the CSS (24x24
   avatars, 204x40 entries — also applied to the labeled/drawer rail forms), the
   You-group Playlists row.
5. **The data seams**: `host/account-chrome.ts` (the loader + the pure
   `accountChromeViewOf`: the request session via `readRequestSessionView`, the
   rail subscriptions from the singleton's hydrated fold, the notification truth
   {unread: 0}); `host/request-session-view.ts` widened with the account fields
   (the composer gate unchanged).
6. **The shell wiring**: `AppShell.tsx`'s optional `account` prop (absent =
   byte-identical R29 chrome); the 8 pages wired ((home), library, settings,
   search, watch, shorts, item, player).
7. **§6/§8/§9 the playlist family**: `components/library/PlaylistControls.tsx`
   (Play all/Shuffle via POST /api/queue + navigation; the sort chips via the CSS
   seam; the pure `shuffled`), `LibrarySurface.tsx`'s playlist header grammar +
   the unavailable notice + the row type datum + the session/owner line,
   `formatPlaylistDate` in `components/ui/format.ts`, the CSS blocks.
8. **The tests**: `apps/web/tests/account-chrome.test.ts` (15) +
   `apps/web/tests/playlist-family.test.ts` (8) — every row corpus-cited.
9. **The evidence**: `INDEX.md` (the citation table), `DIVERGENCES.md` (20 rows),
   `captures/` + `probe-facts.json` (the SSR probe:
   `apps/web/scripts/r30-account-chrome-probe.ts`), this file, `guards.md`.

## GATES (all green — the full output in guards.md)

install (frozen, no changes) · lint LANE-CLEAN (repo 115 problems = byte-identical
main debt, the lane's files 0/0) · typecheck (root + journeys + app-level) ·
**battery 5165/1/0** (the floor + exactly the 23 new tests; zero regressions) ·
contract-check 12 blocks · lane-check 931 files · parity-conformance 19/19 ·
build `--filter '@wfx/app-web'` exit 0.

## REMAINS

1. ~~Commit `wfx/r30/b` with the full message~~ DONE (the lane head, see the SHA
   in the completion report).
2. **PUSH — BLOCKED by the sandbox's credentials**: `git push -u origin
   wfx/r30/b` answers "could not read Username for 'https://github.com': No such
   device or address" — this environment carries NO GitHub credentials (no token,
   no credential helper, no ssh, no gh CLI; the clone worked because the repo is
   public). The lane head is COMMITTED locally with the full message; the lead
   re-enters with credentials (or pulls the local head from this environment) and
   pushes — the commit is push-ready, nothing else remains.
3. ~~The completion report~~ DONE (posted with the lane SHA + the honest
   push-blocked row).
