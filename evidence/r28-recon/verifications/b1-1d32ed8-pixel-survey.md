# B@1d32ed8 pixel-field survey — home, dark, service boot, 1440×900

Method: 3px-grid sample of `b1-1d32ed8-service-home.png` (144000 samples),
RGB quantized to 8-bit buckets. Same method as the baseline survey
(BASELINE-OBSERVATION §6).

| surface | share |
|---|---|
| near-black field (#0f0f0f-family, ≤24) | **63.1%** |
| dark-gray raised (#202020-family) | 11.7% |
| colorful (artwork / text) | 9.2% |
| top bucket | #080808 55.4% · #202020 9.1% |

## Comparison

| boot | near-black | elevated gray | note |
|---|---|---|---|
| main @ 3304b65 (baseline, dark home) | **26%** | **~47%** | hero + config + gradient thumbs = the wall |
| YouTube dark corpus capture (A) | **64%** | <5% | the reference |
| **B@1d32ed8 (dark home, service)** | **63.1%** | 11.7% | hero/config gone; real artwork fills the field |

## Verdict datum

The dark-mode field composition now matches the YouTube dark capture at
first order (63.1% vs 64%). Residuals: raised-gray share 11.7% vs <5%
(rail + chips + card text rows), and **the default theme still boots DARK
where YouTube logged-out boots LIGHT** (N15) — the remaining O6 divergence.
