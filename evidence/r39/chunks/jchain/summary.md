# WebFlix Golden Journey Run — Evidence Summary

- commit: `b0238206a348c5740396d09fd27ffef3997a7b7b`
- branch: `work/wfx-deploy-w3-regression`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-10-02T10:29:45.984Z → 2026-10-02T10:30:38.335Z

**5 passed · 0 failed · 0 not-run (listed with procedures) · 5 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J21 | Authorized torrent acquisition (web limited-status surface) | PASS | 14 | 3 |
| J22 | Torrent metadata and file selection (web limited-status surface) | PASS | 7 | 3 |
| J23 | Torrent playback before full completion (web status surface) | PASS | 15 | 3 |
| J24 | Torrent background completion (web status surface) | PASS | 18 | 3 |
| J26 | Verified local asset appears in Library (web status/read surface) | PASS | 8 | 3 |

## Explicit limitations (never silent skips)

- **J21** (desktop-procedure): The native ACQUISITION protocol path (real magnet/.torrent ingestion through the torrent engine) is the Desktop native-media lane. The web journey encodes the limited-status lifecycle UX over the deterministic scripted feed (the R14 surface); the native protocol path is the Desktop equivalent procedure.
  - procedure: DESKTOP (journeys/desktop/README.md): run the Desktop app with the native-media engine against an authorized source, drive the real acquisition lifecycle, and capture per-state screenshots + the same manifest format via agent-browser attached to the desktop webview (or the platform's instrumentation).
- **J23** (desktop-procedure): Native playback-before-completion (real verified-range streaming from an in-progress torrent session) is the Desktop path. The web encodes the honest status sequence (buffering → playing with runway → deadline-risk demotion).
  - procedure: DESKTOP (journeys/desktop/README.md): start an authorized acquisition, begin playback before completion, and capture the buffering/playing/rebuffer states with the real scheduler evidence.
- **J24** (desktop-procedure): Native background completion with real integrity verification is the Desktop path. The web encodes the completing/verifying/ready-offline status sequence and the earned-verdict grammar.
  - procedure: DESKTOP (journeys/desktop/README.md): let the acquisition complete in the background (app unfocused), capture the verification and Ready-offline states, and the Library exposure.
