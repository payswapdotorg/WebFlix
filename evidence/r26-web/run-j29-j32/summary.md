# WebFlix Golden Journey Run — Evidence Summary

- commit: `d178a79ff627c6e4600a960486257ccbc7b9c35b`
- branch: `wfx/r26/web`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-22T17:23:35.673Z → 2026-09-22T17:24:29.592Z

**4 passed · 0 failed · 0 not-run (listed with procedures) · 4 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J29 | Network loss / playback recovery | PASS | 19 | 3 |
| J30 | Unsupported capability honesty | PASS | 12 | 3 |
| J31 | Cross-platform Web/Desktop parity (web-side anchors) | PASS | 9 | 3 |
| J32 | Source-neutral identity: same item, multiple realizations | PASS | 9 | 3 |

## Explicit limitations (never silent skips)

- **J31** (configuration-limit): The parity COMPARISON (Web vs Desktop semantically equivalent outcomes) requires both adapters running against the same server-side state. The web-side parity anchors (canonical identity, library state, intent, session state) are encoded; the desktop-side comparison is the lead's procedure.
  - procedure: LEAD (the parity run): boot the service-mode api+web and the Desktop adapter against the SAME profile state, run the parity anchor set on both (item identity, library sections, intent composition), and capture both adapters' evidence side by side under evidence/<run>/.
