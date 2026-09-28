# WebFlix Golden Journey Run — Evidence Summary

- commit: `acff71b8b363ba6f85ab7a3e9b08ca7ba3e5a419`
- branch: `wfx/r35b/journeys`
- environment: web-fixtures @ https://webflix-steel.vercel.app
- window: 2026-09-28T13:26:50.822Z → 2026-09-28T13:27:02.973Z

**1 passed · 0 failed · 0 not-run (listed with procedures) · 1 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J38 | First-class torrent playback (web: browser-capable + honest fallbacks) | PASS | 8 | 3 |

## Explicit limitations (never silent skips)

- **J38** (configuration-limit): The R23-W2 web encoding drives the FIRST-CLASS peer-copy surfaces end to end over the fixtures' scripted acquisition feed (the same protocol-free facts through the REAL acquisition store the J21-J26 chain validates), the honest Desktop next step for ordinary swarms, and the adapter/WebRTC environment truth behind progressive disclosure. A REAL WebRTC swarm — live hybrid peers streaming bytes into the browser video element through the R23-D adapter — requires a reachable swarm the sandbox does not have; the adapter binding (webtorrent@3.0.21 browser build, lazy-loaded) is the real code path for that environment.
  - procedure: LOCAL-ONLY (the WebRTC-capable scenario): serve a .torrent whose swarm includes WebRTC-capable peers (a WebTorrent hybrid client seeding legally-owned content) over a reachable wss tracker, register the authorized copy on the source, open its player, and capture the live streaming + the verified-asset landing under evidence/<run>/; the Desktop native path is Worker 3's J38 procedure.
