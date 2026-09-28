# WebFlix Golden Journey Run — Evidence Summary

- commit: `0d125160904b0e5ad3b9bed7a75b4593dbeb8f9c`
- branch: `wfx/r36/channels`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-28T08:17:51.909Z → 2026-09-28T08:18:27.402Z

**0 passed · 1 failed · 0 not-run (listed with procedures) · 1 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J44 | Creator channel round trip | **FAIL** | 46 | 7 |

## Failures

- **J44 Creator channel round trip**: journey assertion failed: the channel page's pill renders subscribed on the fresh load (the connector-scoped stored truth — the reload-durability law)
  expected: data-wfx-channel-subscribe-state of [data-wfx-channel-subscribe] is "subscribed"
  observed: "idle"
