# R36 — MEASURED FACTS (the lane's own numbers, honestly recorded)

All facts measured on this lane's runs (the fixtures boot + the isolated base
worktrees), never asserted from documentation.

## The channel entity (the fixtures boot's one source)

| Field | Value | Source of truth |
|---|---|---|
| connectorId | `fake-source` | the sources model's row |
| handle | `fake-source` | `channelHandleOf` (the slug law — pure, stable) |
| displayName | `Fake Source (TEST FIXTURE — never production)` | the sources model's own field (the R33-C seam) |
| avatar | the monogram `F` (80px slot) | the honest stand-in (no source declares a channel photo) |
| banner | typed absence | no fixture item carries artwork (the derived-art arm is the service-mode activation) |
| description / links / verified | typed absences (each with its honest sentence) | no source declares any |
| subscriberCount | typed absence ("never fabricates") | no reachable seam declares one |
| connectedSince | declared — the source's own `authorizedAt` | the sources model's row |
| channel items | 9 (6 long-form + 3 short-form) | the discovery-seed hits scoped to the connector, deduped by canonical id |
| sort availability | latest/oldest/popular ALL absent (fixtures declare no dates/counts) | the items' own metadata (validated reads) |

## The handle law (pure derivation, proven stable)

- `fake-source` → `/channel/fake-source`
- `YouTube` → `youtube`; `Some Connector / ID!` → `some-connector-id`;
  `--leads-and-trails--` → `leads-and-trails`; `""` → `channel`

## The channel's shorts (the eligibility split, same law as the shorts feed)

Neon Rain (vertical), Rain Check (type short), Midnight Scoop (vertical 90s) —
exactly the 3 the shorts surface itself surfaces.

## The in-channel search

"rain" → exactly 3 matches (Neon Rain, Rain Check, Desert Rain Doc) — the
title containment law, the same normalization the transport applies.

## The battery (the guards table's own numbers)

- BASE `main @ 8937bb8` (isolated worktree): **5255 pass / 1 skip / 0 fail**,
  33627 expect() calls, 300 files, 225.24s
- LANE `084be57`: **5287 pass / 1 skip / 0 fail**, 33777 expect() calls, 301
  files, 226.55s (re-run after the fix: identical 5287/1/0, 225.34s)
- delta: exactly the lane's +32 tests / +150 expect() calls / +1 file

## The lane tests (the fail-on-main law)

- 32 tests / 145 expect() calls: PASS on the lane; on the isolated
  `8937bb8` worktree the file fails (`Cannot find module
  '../src/host/channel-views'`) — the module does not exist on main.

## The journeys

- J44 (new): **PASS — 57 assertions, 7 artifacts**, 27.9s on the fixtures boot
  (the manifest at `evidence/r36/journeys/manifest.json`, commit `084be57`).
- Affected re-runs: 10 journeys on BOTH trees — identical verdicts + identical
  failure reasons (the stale-grammar debt, zero regressions).

## The build

- `bun run --filter '@wfx/app-web' build` — exit 0; `/channel/[handle]`
  compiled as a dynamic (ƒ) route.

## The bell record

- The per-channel preference persists under the browser's
  `wfx-channel-bells-v1` local record (`{"fake-source":"none"}` — asserted
  through the page's own localStorage in J44); the delivery surface is a later
  wave and the menu says so honestly.
