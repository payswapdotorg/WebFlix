# WebFlix Golden Journey Run — Evidence Summary

- commit: `09d02055f72a41927bc20fca8bbbfe5dd8cfeb1b`
- branch: `wfx/r34c/accept-regression`
- environment: web-fixtures @ https://webflix-steel.vercel.app
- window: 2026-09-27T20:48:37.636Z → 2026-09-27T20:48:42.985Z

**0 passed · 1 failed · 0 not-run (listed with procedures) · 1 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J02 | Home discovery / hero / rows / intent entry | **FAIL** | 1 | 2 |

## Failures

- **J02 Home discovery / hero / rows / intent entry**: journey assertion failed: the hero renders the featured start card on a fresh session
  expected: data-wfx-hero of [data-wfx-hero] is "start"
  observed: <attribute absent>
