# R34-B — evidence index (the J41 playback-startup acceptance battery)

Lane `wfx/r34b/accept-j41` · base `main @ 09d0205` · production
`https://webflix-steel.vercel.app` · run 2026-09-27/28 UTC · measurement-only
(the product is untouched; the instrument is its own typed telemetry).

## Read in this order

1. **`ACCEPTANCE-SUMMARY.md`** — the J41 gates, verbatim, adjudicated (the verdict).
2. **`TABLES.md`** — the metric tables (every number with citations; machine-generated).
3. **`LEDGER.md`** — the findings ledger (sections A–G; F = the honest-gaps ledger).
4. **`YOUTUBE-BLOCK-RECORD.md`** — the environmental block that gates the five
   YouTube-relative thresholds (VLM-quoted walls).
5. **`guards.md`** — the lane gates + frozen-laws compliance + reproduction.

## The data

- `raw/` — 68 walk records (5 items × cold/warm; verbatim typed-trace harvests)
  + `rick-extended-observations.json` (the post-startup soak trace).
- `screenshots/` — 79 captures: every walk's final state, the extended-observation
  states (audible / 60 s soak / recovery), and the 7 YouTube-side block attempts.
- `vlm/` — 5 VLM reads of the key captures (the wall texts quoted verbatim).
- `aggregate.json` — the machine-readable per-cell stats.
- `battery-test-summary.txt` — the no-battery-change gate (5256/1/0) excerpt.

## The harness (resumable; nothing re-runs what exists)

- `scripts/walk.sh` — the one-walk protocol (hub → real click → typed-trace poll →
  verbatim harvest; cold walks destroy the context first).
- `scripts/cell.sh` — the resumable cell runner (the re-entry law).
- `scripts/battery.sh` — the full battery plan (the content registry's 5 items).
- `scripts/extended.sh` — the post-startup observation walk (audible / control /
  seek / 60 s rebuffer / offline recovery).
- `scripts/aggregate.py`, `scripts/tables.py` — the stats + tables generators.

## Headline numbers

- TTFF (the playable pair, the provider's own `playing` broadcast): cold p50
  **1715.0 ms** (p75 1792.4 / p95 1928.1), warm p50 **1401.3 ms** (p75 1448.8 /
  p95 1571.2).
- Time-to-playable: **≤ 535.0 ms p50** on every cell; navigation-to-player-visible
  **≤ 534.4 ms p50**.
- Play action present **68/68** walks; startup failures on the playable pair **0/22**.
- Provider-refused (environmental): **46/46** on zoo / rainbombs / wettest / ed.
- Control response **279.2 ms** (pause) / **233.8 ms** (resume); 60 s soak rebuffer:
  **0 events** pre-interaction, one 265.5 ms user-resume fill.
- Battery: **5256 tests / 1 skip / 0 fail** (no product code changed).
