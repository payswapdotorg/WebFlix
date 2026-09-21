# R24-W2 — the Web playback-startup benchmark record (R24-E / J41 web-side)

- Commit: `04212274b98d6ae83a8cce699b83f369d73c2773`
- Generated: 2026-09-21T16:09:40.847Z
- Environment: Chrome 153.0.0.0 on unknown OS, viewport 1280x800, unthrottled (the deterministic fixtures boot; the provider URLs blocked at the network layer)
- Runs: 6 (3 cold / 3 warm)

## The per-title cold/warm record (raw observations retained under raw/)

| Title | Realization | Pass | TTFF (ms) | time-to-playable (ms) | nav→visible (ms) | seek (ms) | control (ms) |
|---|---|---|---:|---:|---:|---:|---:|
| Deep Field Diary | browser | cold | 773 | 253 | 0 | 75 | 65 |
| Deep Field Diary | browser | warm | 728 | 299 | 0 | 46 | 31 |
| Desert Rain Doc | embed | cold | 956 | 363 | 0 | 33 | 51 |
| Desert Rain Doc | embed | warm | 656 | 268 | 0 | 36 | 37 |
| Signal Fade | browser | cold | 942 | 305 | 0 | 45 | 32 |
| Signal Fade | browser | warm | 1087 | 568 | 0 | 41 | 32 |

## The aggregate percentiles (the complete battery)

| Metric | n | p50 (ms) | p75 (ms) | p95 (ms) |
|---|---:|---:|---:|---:|
| navigation-to-player-visible | 6 | 0 | 0 | 0 |
| click-to-first-frame | 6 | 857 | 953 | 1054 |
| time-to-playable | 6 | 302 | 349 | 517 |
| seek-response-latency | 6 | 43 | 46 | 68 |
| control-responsiveness | 6 | 34 | 47 | 61 |

## The YouTube comparative baseline

no identical public YouTube content exists for the fixture catalog's titles (WebFlix-internal content): the same-content law answers samePublicContentOnYouTube=false and the threshold evaluation records the typed no-youtube-baseline blocker — the comparative baseline is the LEAD's protocol (the plan's 'Lead owns the comparative performance test protocol') over real same-content on both systems

## The internal verdict (the R24-E startup architecture laws)

the WebFlix-internal benchmark laws (one obvious play action; no nonessential work blocking the first frame; no fake buffering progress; zero startup failures over the complete battery) — NOT the YouTube-delta thresholds (those require the same-content baseline)

**Verdict: PASS**
