# WebFlix Golden Journey Run — Evidence Summary

- commit: `09d02055f72a41927bc20fca8bbbfe5dd8cfeb1b`
- branch: `wfx/r34c/accept-regression`
- environment: web-fixtures @ https://webflix-steel.vercel.app
- window: 2026-09-27T21:03:27.527Z → 2026-09-27T21:03:38.610Z

**0 passed · 3 failed · 0 not-run (listed with procedures) · 3 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J37 | Anonymous public viewing without WebFlix login | **FAIL** | 4 | 2 |
| J38 | First-class torrent playback (web: browser-capable + honest fallbacks) | **FAIL** | 1 | 2 |
| J39 | Multimodal media intelligence / semantic moment discovery | **FAIL** | 2 | 2 |

## Explicit limitations (never silent skips)

- **J38** (configuration-limit): The R23-W2 web encoding drives the FIRST-CLASS peer-copy surfaces end to end over the fixtures' scripted acquisition feed (the same protocol-free facts through the REAL acquisition store the J21-J26 chain validates), the honest Desktop next step for ordinary swarms, and the adapter/WebRTC environment truth behind progressive disclosure. A REAL WebRTC swarm — live hybrid peers streaming bytes into the browser video element through the R23-D adapter — requires a reachable swarm the sandbox does not have; the adapter binding (webtorrent@3.0.21 browser build, lazy-loaded) is the real code path for that environment.
  - procedure: LOCAL-ONLY (the WebRTC-capable scenario): serve a .torrent whose swarm includes WebRTC-capable peers (a WebTorrent hybrid client seeding legally-owned content) over a reachable wss tracker, register the authorized copy on the source, open its player, and capture the live streaming + the verified-asset landing under evidence/<run>/; the Desktop native path is Worker 3's J38 procedure.

## Failures

- **J37 Anonymous public viewing without WebFlix login**: journey assertion failed: the search surface offers the public title anonymously
  expected: an item link
  observed: <absent>
- **J38 First-class torrent playback (web: browser-capable + honest fallbacks)**: journey assertion failed: the search surface offers the peer-copy-capable title
  expected: an item link
  observed: <absent>
- **J39 Multimodal media intelligence / semantic moment discovery**: journey assertion failed: the meaning result finds the space documentary by what it IS (not its name)
  expected: Deep Field Diary
  observed: <none>
