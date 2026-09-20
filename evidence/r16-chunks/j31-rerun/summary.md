# WebFlix Golden Journey Run — Evidence Summary

- commit: `21c267f00872241df1136b322cf44be978b5d48a`
- branch: `wfx/r22/integration`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-20T17:05:58.220Z → 2026-09-20T17:06:27.255Z

**1 passed · 0 failed · 0 not-run (listed with procedures) · 1 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J31 | Cross-platform Web/Desktop parity (web-side anchors) | PASS | 9 | 3 |

## Explicit limitations (never silent skips)

- **J31** (configuration-limit): The parity COMPARISON (Web vs Desktop semantically equivalent outcomes) requires both adapters running against the same server-side state. The web-side parity anchors (canonical identity, library state, intent, session state) are encoded; the desktop-side comparison is the lead's procedure.
  - procedure: LEAD (the parity run): boot the service-mode api+web and the Desktop adapter against the SAME profile state, run the parity anchor set on both (item identity, library sections, intent composition), and capture both adapters' evidence side by side under evidence/<run>/.
