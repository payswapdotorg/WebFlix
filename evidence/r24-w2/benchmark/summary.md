# R24-W2 — the Web playback-startup benchmark record (R24-E / J41 web-side)

- Commit: `cd5ad45b8404c817a53eb4431147cf1f241d5259`
- Generated: 2026-09-21T17:34:31.275Z
- Environment: Chrome 153.0.0.0 on unknown OS, viewport 1280x800, unthrottled (the deterministic fixtures boot; the provider URLs blocked at the network layer)
- Runs: 6 (3 cold / 3 warm)

## The per-title cold/warm record (raw observations retained under raw/)

| Title | Realization | Pass | TTFF (ms) | time-to-playable (ms) | nav→visible (ms) | seek (ms) | control (ms) |
|---|---|---|---:|---:|---:|---:|---:|
| Deep Field Diary | browser | cold | 843 | 338 | 336 | 90 | 34 |
| Deep Field Diary | browser | warm | 930 | 271 | 270 | 33 | 31 |
| Desert Rain Doc | embed | cold | 816 | 254 | 252 | 35 | 30 |
| Desert Rain Doc | embed | warm | 866 | 303 | 303 | 33 | 38 |
| Signal Fade | browser | cold | 1177 | 393 | 391 | 39 | 32 |
| Signal Fade | browser | warm | 763 | 273 | 271 | 37 | 54 |

## The aggregate percentiles (the complete battery)

| Metric | n | p50 (ms) | p75 (ms) | p95 (ms) |
|---|---:|---:|---:|---:|
| navigation-to-player-visible | 6 | 287 | 327 | 377 |
| click-to-first-frame | 6 | 854 | 914 | 1115 |
| time-to-playable | 6 | 288 | 329 | 379 |
| seek-response-latency | 6 | 36 | 38 | 77 |
| control-responsiveness | 6 | 33 | 37 | 50 |

## The YouTube comparative baseline

no identical public YouTube content exists for the fixture catalog's titles (WebFlix-internal content): the same-content law answers samePublicContentOnYouTube=false and the threshold evaluation records the typed no-youtube-baseline blocker — the comparative baseline is the LEAD's protocol (the plan's 'Lead owns the comparative performance test protocol') over real same-content on both systems

## The internal verdict (the R24-E startup architecture laws)

the WebFlix-internal benchmark laws (one obvious play action; no nonessential work blocking the first frame; no fake buffering progress; zero startup failures over the complete battery) — NOT the YouTube-delta thresholds (those require the same-content baseline)

**Verdict: PASS**
