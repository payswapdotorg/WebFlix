# R34-B — the J41 acceptance summary (threshold adjudication)

Lane `wfx/r34b/accept-j41` on `main @ 09d0205`. The gates below are quoted **verbatim**
from `docs/validation/webflix-golden-journeys.md` § J41 (lines 272–280). Every measured
number cites `TABLES.md` / the raw records; nothing is synthesized, and no YouTube-side
number is invented to fill a blocked cell.

## The adjudication

| # | J41 acceptance gate (verbatim) | verdict | the measured basis |
| --- | --- | --- | --- |
| 1 | `p50 TTFF <= YouTube + 150 ms` | **BLOCKED — not numerically adjudicable** | The YouTube side of every identity pair is environment-blocked (bot-check + unusual-traffic walls; `YOUTUBE-BLOCK-RECORD.md`). WebFlix-side absolute, the only playable pair (rick): **p50 1715.0 ms cold / 1401.3 ms warm** (`TABLES.md` row 2). |
| 2 | `p75 TTFF <= YouTube + 300 ms` | **BLOCKED — not numerically adjudicable** | Same block. WebFlix-side: **p75 1792.4 ms cold / 1448.8 ms warm**. |
| 3 | `p95 TTFF <= YouTube + 750 ms` | **BLOCKED — not numerically adjudicable** | Same block. WebFlix-side: **p95 1928.1 ms cold / 1571.2 ms warm**. |
| 4 | `startup failure <= YouTube + 0.5 percentage points` | **BLOCKED — not numerically adjudicable** | Same block (the YouTube side never starts at all in this environment). WebFlix-side incidence: **0/22 walks failed on the playable pair**; 46/68 walks provider-refused on the other four items — environmental (the provider's own wall inside the contained embed), with the product holding typed `buffering` states and honest surfaces throughout (`TABLES.md` row 5, `YOUTUBE-BLOCK-RECORD.md`). |
| 5 | `first-60-second rebuffer ratio <= YouTube + 0.25 percentage points` | **BLOCKED — not numerically adjudicable** | Same block. WebFlix-side: **0 rebuffer events in the uninterrupted playing span** of the 60 s soak; the only event is the user-initiated resume buffer-fill (**265.5 ms**, 0.44% of the observation window); across the 22 playable battery walks exactly **1 event of 10.6 ms** (`TABLES.md` row 6). |
| 6 | `one obvious play action for supported content` | **PASS (measured)** | `[data-wfx-item-play]` present and clicked on **68/68 walks** across all 10 cells; zero `no-play-action` records (`TABLES.md` battery map — every raw record carries `playActionPresent: true`). |
| 7 | `no nonessential AI/recommendation/indexing work blocks first frame` | **PASS (measured)** | The typed `startupObservations.enrichmentMountedAtMs` (ai-tray / intelligence / live-captions) mount at **1648.3–1708.8 ms** on the walks that recorded them — at/after the same walks' contained first frame (744.9 / 1648.2 ms) and never before their `playable-declared` (569.1 / 654.1 ms); the provider's playing broadcast then lands at 1848.9 / 2125.8 ms — no serial dependency ahead of it (`TABLES.md` enrichment table; the third cited walk recorded an empty observation object, variance kept verbatim). |
| 8 | `authorized torrent playback starts from verified playable data where supported` | **NOT COVERED in this battery** | The battery's content set ran the embed realization only (the identity pairs' provider refs). No torrent-realization startup row was measured and **no claim is made**; the row belongs to a multi-realization content set (the J21–J24 lanes own the torrent journeys). |

## The honest verdict

- **3 of 8 clauses adjudicated in this environment**: two measured PASSes (the
  absolute product clauses) and one recorded not-covered.
- **5 of 8 clauses blocked at the environment level**, all five by the same root
  cause: the YouTube side (site and, for four of five items, the embed surface) is
  bot-gated from this sandbox. The block is recorded with captured, VLM-quoted
  evidence — not asserted from memory (`YOUTUBE-BLOCK-RECORD.md`).
- **No number was fabricated to force a verdict.** The frozen laws hold: same
  content, thresholds verbatim, no product code changes, honest instrumentation.
- The WebFlix side is fully measured where the environment permits: the playable
  pair (rick) carries a complete 22-walk TTFF distribution (cold 1533.6–2125.8 ms,
  warm 1156.0–1790.9 ms — consistent with, and slightly wider than, the prior
  session's 1630–1914 / 1261–1474 ms), the refused items carry complete honest
  startup-failure rows, and the post-startup rows (control, rebuffer, recovery)
  carry the product's own typed markers.
- **Re-run readiness**: the battery is YouTube-baseline-ready — in an unblocked
  environment, the same walk protocol against the YouTube side produces the
  baseline numbers, and the same aggregator computes the deltas; the five blocked
  gates then adjudicate without any harness change.

## The sample-count honesty note

The battery law targeted ≥10 samples per cell. Met: rick cold (11), rick warm (11),
zoo cold (10). The seven provider-refused cells carry 5–6 samples each: each refused
walk occupies its full 60 s window, the battery ran wall-clock-bound in the
OOM-prone environment (one silent battery death recorded in
`battery-test-summary.txt`), and the refusing cells' result is total (46/46 walks,
100% refusal — the distribution of a constant). The counts are recorded per cell in
`TABLES.md`; no cell was padded and no sample duplicated.
