# WebFlix Golden Journey Run — Evidence Summary

- commit: `acff71b8b363ba6f85ab7a3e9b08ca7ba3e5a419`
- branch: `wfx/r35b/journeys`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-28T12:34:21.742Z → 2026-09-28T12:34:49.150Z

**1 passed · 3 failed · 0 not-run (listed with procedures) · 4 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J01 | First launch / profile selection / onboarding | **FAIL** | 2 | 3 |
| J02 | Home discovery / hero / rows / intent entry | **FAIL** | 1 | 3 |
| J04 | Shorts vertical discovery | PASS | 13 | 3 |
| J05 | Unified search | **FAIL** | 4 | 3 |

## Failures

- **J01 First launch / profile selection / onboarding**: journey assertion failed: the navigation landmarks expose every product surface twice (desktop + mobile)
  expected: nav a matches exactly 12
  observed: 13 matching element(s)
- **J02 Home discovery / hero / rows / intent entry**: journey assertion failed: the hero renders the featured start card on a fresh session
  expected: data-wfx-hero of [data-wfx-hero] is "start"
  observed: <attribute absent>
- **J05 Unified search**: journey assertion failed: every result links the canonical item detail
  expected: 3 cards all linking /item?id=wfxitm_…
  observed: 0 of 3
