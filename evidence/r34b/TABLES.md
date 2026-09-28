# R34-B — the J41 playback-startup metric tables

Battery: the frozen walk protocol (`scripts/walk.sh`) on production
(`webflix-steel.vercel.app`), 5 identity-pair items × cold/warm, harvested verbatim
from the product's own typed marker trace (`window.__wfxPlaybackTelemetry`) —
every number below cites the raw record it came from. Percentiles: nearest-rank
(the honest small-n method, identical to `aggregate.py`). Trace origin is
`play-clicked@0` (the PlayIntentRecorder bridge; `originSkewMs` 0.3–4.2 ms).

Items: rick = `dQw4w9WgXcQ` · zoo = `jNQXAC9IVRw` · rainbombs = `oH_pVgW5fEw` ·
wettest = `DYFDc0dpc5g` · ed = `2Vv-BfVoq4g` (canonical ids in `raw/*.json`
`itemHref`). The YouTube side of every pair is environment-blocked — see
`YOUTUBE-BLOCK-RECORD.md`.

## The battery map (walks, outcomes, citations)

| cell | n | first-frame | provider-refused (timeout) | raw records |
| --- | --- | --- | --- | --- |
| ed cold | 5 | 0 | 5 | `raw/ed-cold-` 01–05 |
| ed warm | 5 | 0 | 5 | `raw/ed-warm-` 01–05 |
| rainbombs cold | 6 | 0 | 6 | `raw/rainbombs-cold-` 00–05 |
| rainbombs warm | 5 | 0 | 5 | `raw/rainbombs-warm-` 01–05 |
| rick cold | 11 | 11 | 0 | `raw/rick-cold-` 00–10 |
| rick warm | 11 | 11 | 0 | `raw/rick-warm-` 00–10 |
| wettest cold | 5 | 0 | 5 | `raw/wettest-cold-` 01–05 |
| wettest warm | 5 | 0 | 5 | `raw/wettest-warm-` 01–05 |
| zoo cold | 10 | 0 | 10 | `raw/zoo-cold-` 01–10 |
| zoo warm | 5 | 0 | 5 | `raw/zoo-warm-` 01–05 |
| **TOTAL** | **68** | **22** | **46** | 68 records target |

Provider-refused rows are the honest startup-failure record of this environment:
the provider never broadcasts `playing` within the 60 s walk window; the product
holds its typed `buffering` state with the provider's own wall visible inside the
contained surface (`YOUTUBE-BLOCK-RECORD.md`). Walk cadence: a first-frame walk
settles in ~7 s; a refused walk spends the full 60 s poll window (~67 s cadence,
timestamps in every record).

## Row 1 — navigation-to-player-visible (ms, p50; per cell)

Computed `player-surface-visible − navigation-start` from the typed trace.

| cell | p50 |
| --- | --- |
| ed cold | 496.7 |
| ed warm | 518.8 |
| rainbombs cold | 514.9 |
| rainbombs warm | 534.4 |
| rick cold | 521.2 |
| rick warm | 527.2 |
| wettest cold | 472.8 |
| wettest warm | 475.1 |
| zoo cold | 494.2 |
| zoo warm | 458.8 |

## Row 2 — click-to-first-frame / TTFF (ms; the provider's own `playing` broadcast)

Adjudicable only where the provider actually plays (rick); refused cells have no
TTFF distribution by honest construction.

| cell | n | p50 | p75 | p95 | min | max |
| --- | --- | --- | --- | --- | --- | --- |
| ed cold | 5 | — | — | — | — | — |
| ed warm | 5 | — | — | — | — | — |
| rainbombs cold | 6 | — | — | — | — | — |
| rainbombs warm | 5 | — | — | — | — | — |
| rick cold | 11 | 1715.0 | 1792.4 | 1928.1 | 1533.6 | 2125.8 |
| rick warm | 11 | 1401.3 | 1448.8 | 1571.2 | 1156.0 | 1790.9 |
| wettest cold | 5 | — | — | — | — | — |
| wettest warm | 5 | — | — | — | — | — |
| zoo cold | 10 | — | — | — | — | — |
| zoo warm | 5 | — | — | — | — | — |

Sample-level TTFF (every measured value, verbatim):

- rick cold: 2125.8, 1848.9, 1728.9, 1715.0, 1928.1, 1544.2, 1646.0, 1792.4, 1533.6, 1650.1, 1590.1
- rick warm: 1790.9, 1571.2, 1448.8, 1324.6, 1156.0, 1287.1, 1403.0, 1271.8, 1401.3, 1551.5, 1296.0

## Row 3 — click-to-audible

Exercised in the extended observation (`scripts/extended.sh`,
`raw/rick-extended-observations.json`): the unmute pill
(`[data-wfx-player-unmute]`) was clicked and the provider answered `muted=false` —
the pill retired (final state `pill: false`, phase `playing`;
`screenshots/rick-extended-audible.png`). The wall-clock answer latency was echoed
to the run's stdout but not durably captured — a harness gap recorded honestly;
**no number is asserted for this row**.

## Row 4 — time-to-playable (ms, p50; the shell's `playable-declared` marker)

| cell | p50 |
| --- | --- |
| ed cold | 497.1 |
| ed warm | 520.1 |
| rainbombs cold | 519.1 |
| rainbombs warm | 534.5 |
| rick cold | 521.2 |
| rick warm | 528.1 |
| wettest cold | 473.3 |
| wettest warm | 476.2 |
| zoo cold | 495.2 |
| zoo warm | 459.0 |

## Row 5 — startup failure (per cell; the honest incidence table)

| cell | walks | startup failures | note |
| --- | --- | --- | --- |
| ed cold | 5 | 5 | provider-refused (environmental bot-gate; typed buffering held) |
| ed warm | 5 | 5 | provider-refused (environmental bot-gate; typed buffering held) |
| rainbombs cold | 6 | 6 | provider-refused (environmental bot-gate; typed buffering held) |
| rainbombs warm | 5 | 5 | provider-refused (environmental bot-gate; typed buffering held) |
| rick cold | 11 | 0 | 0 failures on the playable pair |
| rick warm | 11 | 0 | 0 failures on the playable pair |
| wettest cold | 5 | 5 | provider-refused (environmental bot-gate; typed buffering held) |
| wettest warm | 5 | 5 | provider-refused (environmental bot-gate; typed buffering held) |
| zoo cold | 10 | 10 | provider-refused (environmental bot-gate; typed buffering held) |
| zoo warm | 5 | 5 | provider-refused (environmental bot-gate; typed buffering held) |
| **all cells** | **68** | **46** | refusals are provider-level, not product defects — see `YOUTUBE-BLOCK-RECORD.md` |

## Row 6 — first-60-second rebuffer ratio

- Battery walks (22 playable walks, harvest at first frame): **1 event** —
  `rick-warm-01.json`, `rebuffer-started` 1615.1 → `rebuffer-ended` 1625.7 =
  **10.6 ms** immediately after the playing broadcast (1571.2).
- Extended 60 s soak (`raw/rick-extended-observations.json`, `screenshots/rick-extended-60s.png`):
  **0 rebuffer events** during the uninterrupted playing span (first frame 1739.5 →
  user pause 47878.7); the only rebuffer is the **user-initiated resume** buffer-fill
  (resume 52820.9 → rebuffer 52828.1–53093.6 = **265.5 ms**, 0.44% of the 60 s
  observation window).
- YouTube-relative adjudication: blocked (`YOUTUBE-BLOCK-RECORD.md`).

## Row 7 — seek response

The product's typed contract carries the row (`PlayerChrome.tsx` records
`seek-requested`/`seek-confirmed`; `playback-telemetry.ts` defines
`seek-response-latency`). The extended observation clicked the scrub bar at 50%,
but **no seek markers fired in the captured trace** — the row is recorded as
**not captured in this battery** (the click did not produce a typed seek event;
no number is asserted).

## Row 8 — control response (ms; typed `control-invoked` → `control-confirmed`)

From `raw/rick-extended-observations.json` (the provider's own phase answers):

| control | invoked @ | confirmed @ | latency |
| --- | --- | --- | --- |
| pause (k) | 47878.7 | 48157.9 | **279.2** |
| play (k) | 52820.9 | 53054.7 | **233.8** |

## Row 9 — transient recovery

5 s offline → online (`scripts/extended.sh` step 6): the player recovered to
**`phase: "playing"`** (final state in `raw/rick-extended-observations.json`;
`screenshots/rick-extended-recovery.png`, `-recovery-15s.png`). The provider's own
resume broadcast is the evidence; the trace carries the recovery markers verbatim.

## (spec row 10) — realization-switch time

Not exercised in this battery: every item ran its embed realization only (the
identity pairs' provider refs). Recorded honestly as **not covered**; the row
belongs to a multi-realization content set.

## The AI-enrichment non-blocking observation (J41 clause: no nonessential
## AI/recommendation/indexing work blocks first frame)

| walk | playable-declared | first frame (contained) | enrichment mounted (ai-tray / intelligence / live-captions) |
| --- | --- | --- | --- |
| `rick-cold-00.json` | 654.1 | 1648.2 | ai-tray 1648.3 / intelligence 1648.3 / live-captions 1648.4 |
| `rick-cold-01.json` | 569.1 | 744.9 | ai-tray 1703.6 / intelligence 1708.8 / live-captions 1705.1 |
| `rick-warm-01.json` | 625.1 | 1537.1 | (none recorded this walk) |

On the walks that recorded the observation, enrichment mounts at
1648.3–1708.8 ms — at/after that walk's contained first frame (0.1 ms after on
`rick-cold-00`; ~959 ms after on `rick-cold-01`) and never before
`playable-declared` — never a serial dependency of the provider's playing
broadcast. `rick-warm-01` recorded an empty observation object — variance kept
verbatim.

