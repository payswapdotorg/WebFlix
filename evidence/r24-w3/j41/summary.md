# WebFlix J41 Desktop — the startup benchmark evidence (machine-generated)

- commit: `uncommitted`
- branch: `wfx/r24/desktop`
- window: 2026-09-21T17:52:15.443Z → 2026-09-21T17:52:15.455Z
- benchmark titles: 3 (1 torrent + 2 provider embed) × cold/warm
- measurements recorded: 7
- assertions recorded: 84

## The aggregate TTFF record

- p50: 0.100 ms
- p75: 0.270 ms
- p95: 2.768 ms
- threshold verdict: The same-content reference baseline is not measurable in this environment — the R24-E thresholds (p50 ≤ ref+150ms, p75 ≤ ref+300ms, p95 ≤ ref+750ms) are the real-device lab procedure's verdict, recorded here as pending (never silently passed).

## The per-pass measurements

### Family Archive Feature Presentation — authorized-peer-copy (cold)
- navigation-to-player-visible: 0.643 ms
- click-to-first-frame (TTFF): 2.768 ms
- click-to-audible: 2.770 ms
- time-to-playable: 2.584 ms
- startup failed: false
- seek response: 0.197 ms
- control response: 0.142 ms
- transient recovery: 0.137 ms
- torrent: metadata 2.571 ms, file 2.572 ms, first verified range 2.584 ms, background completion 3.268 ms, integrity 0.001 ms, Ready offline 3.286 ms
- first frame: runway 25000 ms, verified fraction 0.4444444444444444
- LAW 1 (no nonessential work in the startup window): holds
- LAW 2 (verified ranges prioritized over completion): holds

### Backyard Concert (provider embed) — provider-embed (cold)
- navigation-to-player-visible: 0.022 ms
- click-to-first-frame (TTFF): 0.270 ms
- click-to-audible: not observed
- time-to-playable: not observed
- startup failed: false
- seek response: not observed
- control response: 0.006 ms
- transient recovery: not observed
- torrent: metadata not observed, file not observed, first verified range not observed, background completion not observed, integrity not observed, Ready offline not observed
- first frame: runway 0 ms, verified fraction 1
- LAW 1 (no nonessential work in the startup window): holds
- LAW 2 (verified ranges prioritized over completion): n/a (provider rung)

### Conference Talk (provider embed) — provider-embed (cold)
- navigation-to-player-visible: 0.008 ms
- click-to-first-frame (TTFF): 0.044 ms
- click-to-audible: not observed
- time-to-playable: not observed
- startup failed: false
- seek response: not observed
- control response: 0.007 ms
- transient recovery: not observed
- torrent: metadata not observed, file not observed, first verified range not observed, background completion not observed, integrity not observed, Ready offline not observed
- first frame: runway 0 ms, verified fraction 1
- LAW 1 (no nonessential work in the startup window): holds
- LAW 2 (verified ranges prioritized over completion): n/a (provider rung)

### Family Archive Feature Presentation — authorized-peer-copy (warm)
- navigation-to-player-visible: 0.180 ms
- click-to-first-frame (TTFF): 0.125 ms
- click-to-audible: 0.127 ms
- time-to-playable: 0.113 ms
- startup failed: false
- seek response: 0.008 ms
- control response: 0.006 ms
- transient recovery: 0.008 ms
- torrent: metadata 0.088 ms, file 0.104 ms, first verified range 0.113 ms, background completion 0.164 ms, integrity 0.000 ms, Ready offline 0.166 ms
- first frame: runway 25000 ms, verified fraction 0.4444444444444444
- LAW 1 (no nonessential work in the startup window): holds
- LAW 2 (verified ranges prioritized over completion): holds

### Family Archive Feature Presentation — authorized-peer-copy (warm)
- navigation-to-player-visible: 0.033 ms
- click-to-first-frame (TTFF): 0.100 ms
- click-to-audible: 0.101 ms
- time-to-playable: 0.086 ms
- startup failed: false
- seek response: 0.009 ms
- control response: 0.011 ms
- transient recovery: 0.009 ms
- torrent: metadata 0.079 ms, file 0.080 ms, first verified range 0.086 ms, background completion 0.143 ms, integrity 0.001 ms, Ready offline 0.150 ms
- first frame: runway 25000 ms, verified fraction 0.4444444444444444
- LAW 1 (no nonessential work in the startup window): holds
- LAW 2 (verified ranges prioritized over completion): holds

### Backyard Concert (provider embed) — provider-embed (warm)
- navigation-to-player-visible: 0.005 ms
- click-to-first-frame (TTFF): 0.029 ms
- click-to-audible: not observed
- time-to-playable: not observed
- startup failed: false
- seek response: not observed
- control response: 0.003 ms
- transient recovery: not observed
- torrent: metadata not observed, file not observed, first verified range not observed, background completion not observed, integrity not observed, Ready offline not observed
- first frame: runway 0 ms, verified fraction 1
- LAW 1 (no nonessential work in the startup window): holds
- LAW 2 (verified ranges prioritized over completion): n/a (provider rung)

### Conference Talk (provider embed) — provider-embed (warm)
- navigation-to-player-visible: 0.005 ms
- click-to-first-frame (TTFF): 0.027 ms
- click-to-audible: not observed
- time-to-playable: not observed
- startup failed: false
- seek response: not observed
- control response: 0.003 ms
- transient recovery: not observed
- torrent: metadata not observed, file not observed, first verified range not observed, background completion not observed, integrity not observed, Ready offline not observed
- first frame: runway 0 ms, verified fraction 1
- LAW 1 (no nonessential work in the startup window): holds
- LAW 2 (verified ranges prioritized over completion): n/a (provider rung)

## The walk log

### B1
Benchmark passes recorded: 7 (3 titles × cold/warm; the torrent title's warm mode adds a second play over the same composition).

### B2
The no-serial-chain law holds on every pass: no recommendation/AI/indexing/analytics call sat between the play click and the first frame.

### B3
The verified-ranges-first law holds on every torrent pass: the first frame arrives with a verified runway while the copy is still in progress.

### B4
Every pass measured its metric set honestly (the torrent passes carry the full track: metadata → file → verified range → first frame → completion → integrity → Ready offline).

### B5
Transient failures recover with a useful next action: the failed view carries the typed retry, and the retry executes through the same surface (a fresh session over the same authorized source).

### B6
TTFF over 7 passes: p50=0.100ms, p75=0.270ms, p95=2.768ms (REAL measurements of the composition executing; the same-content YouTube comparison + the R24-E thresholds are the lead's real-device procedure — recorded as pending, never silently passed).

### B7
Realization switch (provider embed → authorized peer copy): click-to-first-frame 0.067ms, window clean.

## The honest scope (never silent skips)

- The timings are REAL measurements of the REAL TypeScript composition executing in this sandbox (performance.now over the deterministic doubles) — they prove the STARTUP ARCHITECTURE ORDERING (no serial chain, verified ranges first), not device playback latency: the network/swarm/decode latencies are absent by construction.
- The same-content YouTube baseline comparison (the R24-E thresholds: p50 ≤ ref+150ms, p75 ≤ ref+300ms, p95 ≤ ref+750ms) is NOT measurable in this sandbox — the verdict machinery ran and records the comparison as pending the lead's real-device procedure.
- The provider rung's first-frame observation point is the contained-surface engagement; the real embed's first rendered video frame is the lead's real-toolchain procedure.
- The native halves (the real engine binary behind createShellEngineProcess, the real swarm's verified-range arrival timing) follow journeys/desktop/README.md — the same honest scoping as J21–J27.
- Worker 1's shared R24-A telemetry contract was NOT on the remote at instrumentation time (no origin/wfx/r24/shared); the Desktop-side instrument's vocabulary (the R24-E metric set + the torrent track) reconciles with the shared contract when it lands — recorded as an escalation.