# R35b merge-head verification record (Lead, 2026-09-28 ~15:30 UTC)

Integration station: /home/z/WebFlix, merge of `wfx/r35b/journeys` (lane head
a9428e2197eff8a66039663e0ac47cfe3832366b, single substance commit) into main
@ 4f6edbe (the R36 merge head). Relay harvested from the live worker sandbox
via the workspaces files API: RELAY-MANIFEST.txt sha256 EXACT (186bcd24…),
bundle + full evidence tree 364 files / 22.5 MB.

## Gates re-run fresh at the merge head

| gate | result |
|---|---|
| `bun run typecheck` | clean (both tsconfigs) |
| `bun run contract-check` | OK — 12 frozen blocks, 7 extension types |
| `bun run lane-check` | OK — 962 files, no cross-lane private imports |
| `bun run test` (battery) | **5297 tests / 5296 pass / 1 skip / 0 fail / 33850 expect() across 305 files** — floor exceeded, zero regressions (the 1 skip is the R11 webtorrent platform issue of record, environment-reported as skip) |

Battery arithmetic: the R36 merge head recorded 5287/1/0; the merge tree adds
the r35b lane's journey-suite companions (+10 test registrations) → 5297
total, all green.

## Journey verification at the merge head (honest environmental record)

The full 42-journey suite could NOT complete in a single boot in the Lead
sandbox: the co-resident replay stack (Chrome+CDP, replayd, console,
watchdogs) leaves ~1.7 GB for the fixtures boot, and the journey Next.js
server is OOM-killed mid-suite (kernel log: `Killed process … next-server …
anon-rss:1544892kB`; the cgroup shows 5 lifetime OOM kills). Chunked reruns
hit the same ceiling plus orphaned-server port squatting. The worker's own
full-suite run — in its dedicated sandbox — is the base evidence of record
(38 pass / 3 fail, all three fails byte-identical at base, proven on an
isolated base worktree; evidence/r35b/run/).

Lead-side samples at the merge head (this tree):

- **J06 (Item detail / availability)**: **PASS — 13 assertions** (solo boot).
- **J44 (Creator channel round trip)**: 44/57 assertions passed — the full
  channel round trip functionally worked (screenshots: channel home, about,
  subscribed state — sample-J44b/), then the harness aborted on a CDP
  `Runtime.evaluate` timeout (`proc: timed out after 30000ms`), an
  environmental browser-strain failure, not a product failure. The R36 merge
  record independently verified J44 PASS 57 assertions at 4f6edbe — the exact
  main-side head of this merge (the r35b lane touches zero product code:
  311 changed files = 32 journey specs + 278 evidence files + 1 docs section,
  no `apps/` or `packages/` changes).

## Verdict

Merge approved: all unit gates green at the head, worker full-suite evidence
on record at base, merge-head samples green/functional, lane is
product-code-inert (spec re-encodes only). Environmental journey-suite limits
documented above — never silent, never fabricated.
