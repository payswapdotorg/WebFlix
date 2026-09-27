# R33-B — partial results (the re-entry file)

Lane: `wfx/r33b/shell-residuals` (base `main @ 178873a`, branch created clean).
This file records the lane's in-flight state so a session interruption can be
resumed surgically — never restarted.

## THE LANE IS COMPLETE (the final state)

Every gate passed on the lane head; the evidence pack is committed; the relay
is the only remaining transport step (see the end of this file).

### The commit chain

- `7661a17` — the D6+N33 code batch: `AppShell.tsx` (the state-conditional
  primary group, the href-based RailEntry, the bottom-nav grammar, the
  `activeRailHref` seam), `Icon.tsx` (the subscriptions glyph),
  `app/feed/subscriptions/page.tsx` (the active-rail claim),
  `tests/shell-residuals.test.ts` (17 lane tests),
  `tests/subscriptions-feed.test.ts` (the honest R31 call-site update).
- `9276502` — the matrix updates + the evidence pack (INDEX.md, guards.md,
  DIVERGENCES.md, browser-verification.md, 13 captures, 2 VLM reads, this
  file).
- `<the final commit>` — this file's final update (+ nothing else).

### The gates (all green, on the lane head)

1. **Battery**: `5217/1/0` (5218 tests, 298 files) — the base floor
   `5200/1/0` DIRECTLY re-measured on the isolated base worktree
   `/home/z/webflix-base` @ 178873a (5201 tests, 297 files) + exactly 17.
2. **Lint**: lane-scoped 0/0; repo 115/32/83 byte-identical to the base.
3. **Typecheck**: root + journeys + app — zero diagnostics.
4. **contract-check**: OK (12 frozen blocks, 7 extension types).
5. **lane-check**: OK (943 files).
6. **parity-conformance**: 19/19.
7. **build --filter '@wfx/app-web'**: exit 0.
8. **Browser-verified live**: 13 captures + 2 VLM reads, zero page errors —
   see browser-verification.md. The instrument note: the pass runs on the
   `http://localhost:3101` origin (the `127.0.0.1` origin trips Next 16's
   cross-origin dev-resource block — the HMR refusal leaves the islands
   unhydrated; recorded honestly in the evidence).

### The row closures (the short form — INDEX.md carries the full table)

- **D6 FIXED** (7661a17): the state-conditional rail grammar, both corpus
  cites bound; the Watch surface holds no rail slot; the flat list verified
  (the "Show more" bound stays CORPUS-PENDING — DIVERGENCES row 3).
- **N33 added + landed** (the fresh sweep's one new shell residual — D6's
  mobile form).
- **D8 VERIFIED** (R29-B held; the stale matrix status recorded).
- **D4 VERIFIED** (R30-B held; the stale matrix status recorded).
- **D3 WONT-FIX honest re-adjudicated + pinned** (no voice-search transport).
- **N28 re-adjudicated** (the rail install entry: real transport, kept).
- **O6's meta theme-color residual CLOSED** (R29-B's seam; re-verified live:
  light → #ffffff, dark → #0f0f0f, no stored → OS preference).

## REMAINS (the transport only)

- `git bundle create webflix-r33b-thin.bundle 178873a..wfx/r33b/shell-residuals`
- Relay `evidence/r33b/` (every file, same relative paths) + the bundle +
  RELAY-MANIFEST.txt (the file list with sha256s + the lane SHAs) into the
  workspace storage root (`/home/z/my-project` — where package.json/src/
  live).
- The completion report (=== R33-B COMPLETION REPORT ===).

## Sandbox mechanics learned (for any re-entry)

- Background processes (dev server, bun test) DIE with each Bash tool
  session — run long jobs in the foreground (the 600s timeout fits the
  ~230s battery) or inside one driver script.
- The dev server must be probed on `http://localhost:3101` (not 127.0.0.1).
- The agent-browser daemon resets between sessions (about:blank) — the
  browser cookie state may persist across a daemon restart within a sandbox
  lifetime; re-verify the session truth before asserting signed-in states.
