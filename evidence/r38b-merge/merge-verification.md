# R38B merge-head verification — 2026-09-28 23:4xZ (lead-A/ali10 console, the replay2 lineage)

Merge: `03a0dd9` — `wfx/r38b/studio @ c0ae73c` → `main @ 3010137` (merge-base 37effa3;
main's delta = the R37 merge 2dc3da2 + its evidence — conflict resolution in exactly the
three additive registration files: journeys/report.test.ts (both sides' registrations —
the encoded set is now 45: J01–J34 + J36–J41 + J43–J46 + J48), journeys/web/index.ts
(both import blocks + entries), docs/validation/webflix-golden-journeys.md (both dated
sections). No product-code conflicts.)

## Gates at the merge head (fresh runs on the merged tree, this console)

| gate | command | result |
|---|---|---|
| typecheck | `bun run typecheck` | CLEAN (root + journeys) |
| contract-check | `bun run contract-check` | OK — 12 frozen blocks in sync, 7 extension types present |
| lane-check | `bun run lane-check` | OK — 1014 files, no cross-lane private imports |
| battery | `bun test --parallel=2` | **5418 ran / 5417 pass / 1 skip / 0 fail**, 34269 expect() calls, 316 files — EXACTLY the R37 merge head (5356/5355/1/0) + the r38b lane's +62, zero regressions |
| J44 (creator channel) | `--filter J44` | **PASS — 57 assertions** (unchanged by this merge) |
| J45 (live watch + chat) | `--filter J45` | **PASS — 30 assertions** (R37's, unchanged) |
| J46 (chat replay) | `--filter J46` | **PASS — 21 assertions** (R37's, unchanged) |
| J48 (studio) | `--filter J48` | **ENV-BLOCKED locally** — 3 attempts (27/32/32 assertions), all died in the documented heavy-journey OOM class (dmesg: `Out of memory: Killed process … next-server … anon-rss:1474700kB` — the fixtures dev server kernel-killed; DIVERGENCES row 5's class, proven base-identical by the lane). The worker's final-run evidence stands: PASS 71 assertions / 9 artifacts, full expected/observed records committed at `evidence/r38b/journeys/final-run/` (harvest relay 8/8 sha256 EXACT incl. the bundle). |

## Clean-room review (lane head c0ae73c, this console)

battery 5359/5358/1/0 EXACT (+62: 13 domain-graph + 49 studio-store) · typecheck/contract
(12 blocks)/lane (993 files) green · J44 PASS 57 · relay RELAY-MANIFEST 8/8 sha EXACT ·
bundle verified (thin, base 37effa3, head c0ae73c = the substance head; tip a7df35df is
the worker's relay-artifacts commit).

## The deferred merge-time composes (honest record)

DIVERGENCES.md rows 1–2 document the two ONE-PLACE bindings the lane could not make
inside its ownership (R36/R28 files frozen per lane law):
1. `channelIdentityOf`'s return (channel-views.ts:440–467) overlaid with
   `composeChannelProfile(base, readStudioProfileEdit(connectorId))` — the channel page
   rendering the customized profile.
2. The watch surface's pinned-badge slot (CommentsSection.tsx:177–178) reading the
   studio's moderation record.

Deferred deliberately: both composes would flip J48 §10's calibrated assertions
(the journey asserts the STABLE derived handle pre-compose), and this sandbox cannot
re-run J48 (the OOM class above) — a compose without a locally verifiable journey run
would violate the gates-of-record law. The bindings land recorded, not fabricated:
the compose functions themselves (`composeChannelProfile`) are already written, tested
(13 domain-graph tests), and used by the studio's preview. J44 PASS 57 proves the
read-side byte-compatibility (no edit → base identity).

## Provenance

- Worker chat `271c6d81` (19:44Z dispatch under ali10); tab closed 20:31 by
  stall_recovery's dead-turn detector; the session completed server-side ~21:22Z
  (chat_updated_at 1790630554) — the r37 pattern (server-side sessions outlive their
  DOM tabs) reproduced. Completion read from the reopened tab (01EDEC24) 23:19Z.
- Harvest: `r38b_harvest_direct.py` (the r37 pattern) → 110 files, 4.06MB,
  `/home/z/webflix-harvest/r38b`.
- Wind-down: ledger 4c1316c — finish in-flight lanes, dispatch nothing new.
