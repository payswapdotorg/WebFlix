# WebFlix Golden Journey Run — Evidence Summary

- commit: `b0238206a348c5740396d09fd27ffef3997a7b7b`
- branch: `work/wfx-deploy-w3-regression`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-10-02T10:31:19.047Z → 2026-10-02T10:32:06.714Z

**3 passed · 0 failed · 0 not-run (listed with procedures) · 3 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J29 | Network loss / playback recovery | PASS | 19 | 3 |
| J30 | Unsupported capability honesty | PASS | 15 | 3 |
| J31 | Cross-platform Web/Desktop parity (web-side anchors) | PASS | 10 | 3 |

## Explicit limitations (never silent skips)

- **J31** (configuration-limit): The parity COMPARISON (Web vs Desktop semantically equivalent outcomes) requires both adapters running against the same server-side state. The web-side parity anchors (canonical identity, library state, intent, session state) are encoded; the desktop-side comparison is the lead's procedure.
  - procedure: LEAD (the parity run): boot the service-mode api+web and the Desktop adapter against the SAME profile state, run the parity anchor set on both (item identity, library sections, intent composition), and capture both adapters' evidence side by side under evidence/<run>/.
