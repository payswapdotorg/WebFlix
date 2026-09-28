# WebFlix Golden Journey Run — Evidence Summary

- commit: `09d02055f72a41927bc20fca8bbbfe5dd8cfeb1b`
- branch: `wfx/r34c/accept-regression`
- environment: web-fixtures @ https://webflix-steel.vercel.app
- window: 2026-09-27T20:58:53.721Z → 2026-09-27T20:59:29.578Z

**0 passed · 4 failed · 0 not-run (listed with procedures) · 4 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J01 | First launch / profile selection / onboarding | **FAIL** | 2 | 2 |
| J02 | Home discovery / hero / rows / intent entry | **FAIL** | 1 | 2 |
| J04 | Shorts vertical discovery | **FAIL** | 3 | 2 |
| J05 | Unified search | **FAIL** | 3 | 2 |

## Failures

- **J01 First launch / profile selection / onboarding**: journey assertion failed: the navigation landmarks expose every product surface twice (desktop + mobile)
  expected: nav a matches exactly 12
  observed: 13 matching element(s)
- **J02 Home discovery / hero / rows / intent entry**: journey assertion failed: the hero renders the featured start card on a fresh session
  expected: data-wfx-hero of [data-wfx-hero] is "start"
  observed: <attribute absent>
- **J04 Shorts vertical discovery**: journey assertion failed: the feed states its position (card 1 of the composed page)
  expected: text of [data-wfx-shorts-position] is exactly "1 / 3"
  observed: "1 / 24"
- **J05 Unified search**: journey assertion failed: the unified search joins the whole catalog (3 canonical rain titles across types)
  expected: 3 canonical result cards
  observed: 19 result cards
