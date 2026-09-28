# WebFlix Golden Journey Run — Evidence Summary

- commit: `09d02055f72a41927bc20fca8bbbfe5dd8cfeb1b`
- branch: `wfx/r34c/accept-regression`
- environment: web-fixtures @ https://webflix-steel.vercel.app
- window: 2026-09-27T21:01:53.347Z → 2026-09-27T21:02:10.972Z

**0 passed · 6 failed · 0 not-run (listed with procedures) · 6 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J21 | Authorized torrent acquisition (web limited-status surface) | **FAIL** | 1 | 2 |
| J22 | Torrent metadata and file selection (web limited-status surface) | **FAIL** | 1 | 2 |
| J23 | Torrent playback before full completion (web status surface) | **FAIL** | 0 | 2 |
| J24 | Torrent background completion (web status surface) | **FAIL** | 0 | 2 |
| J25 | Torrent interruption / restart / resume (web status surface) | **FAIL** | 1 | 2 |
| J26 | Verified local asset appears in Library (web status/read surface) | **FAIL** | 2 | 2 |

## Explicit limitations (never silent skips)

- **J21** (desktop-procedure): The native ACQUISITION protocol path (real magnet/.torrent ingestion through the torrent engine) is the Desktop native-media lane. The web journey encodes the limited-status lifecycle UX over the deterministic scripted feed (the R14 surface); the native protocol path is the Desktop equivalent procedure.
  - procedure: DESKTOP (journeys/desktop/README.md): run the Desktop app with the native-media engine against an authorized source, drive the real acquisition lifecycle, and capture per-state screenshots + the same manifest format via agent-browser attached to the desktop webview (or the platform's instrumentation).
- **J23** (desktop-procedure): Native playback-before-completion (real verified-range streaming from an in-progress torrent session) is the Desktop path. The web encodes the honest status sequence (buffering → playing with runway → deadline-risk demotion).
  - procedure: DESKTOP (journeys/desktop/README.md): start an authorized acquisition, begin playback before completion, and capture the buffering/playing/rebuffer states with the real scheduler evidence.
- **J24** (desktop-procedure): Native background completion with real integrity verification is the Desktop path. The web encodes the completing/verifying/ready-offline status sequence and the earned-verdict grammar.
  - procedure: DESKTOP (journeys/desktop/README.md): let the acquisition complete in the background (app unfocused), capture the verification and Ready-offline states, and the Library exposure.
- **J25** (desktop-procedure): Native interruption/restart with persistent session recovery (crash-safe journals, piece-map reuse) is the Desktop path. The web encodes the recoverable-failure/retry/resuming-status grammar.
  - procedure: DESKTOP (journeys/desktop/README.md): interrupt an in-progress acquisition (kill the engine), restart the app, capture the resumed-not-fresh evidence (retained progress, no false completion), then complete it.

## Failures

- **J21 Authorized torrent acquisition (web limited-status surface)**: journey assertion failed: the search surface offers the scripted authorized acquisition item
  expected: an item link
  observed: <absent>
- **J22 Torrent metadata and file selection (web limited-status surface)**: journey assertion failed: the scripted acquisition is in its preparing phase (the deterministic run order from J21)
  expected: the preparing state
  observed: <none>
- **J23 Torrent playback before full completion (web status surface)**: harness/browser failure: agent-browser command failed (1): scrollintoview [data-wfx-acquisition-action='advance']
✗ Element not found: [data-wfx-acquisition-action='advance']. Verify the selector, role, or name is correct and the element exists in the DOM.
- **J24 Torrent background completion (web status surface)**: harness/browser failure: agent-browser command failed (1): scrollintoview [data-wfx-acquisition-action='advance']
✗ Element not found: [data-wfx-acquisition-action='advance']. Verify the selector, role, or name is correct and the element exists in the DOM.
- **J25 Torrent interruption / restart / resume (web status surface)**: journey assertion failed: the search surface offers the interrupted-acquisition item
  expected: an item link
  observed: <absent>
- **J26 Verified local asset appears in Library (web status/read surface)**: journey assertion failed: the offline-and-verified section lists the earned offline copies (the seed's verified Harbor Lights + the J24-earned Asteroid Drift)
  expected: 2 offline entries
  observed: 0 entries
