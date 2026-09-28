# WebFlix Golden Journey Run — Evidence Summary

- commit: `084be571bfdd8e92f998f2853fcbfb27d9988fdf`
- branch: `wfx/r36/channels`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-28T08:43:35.197Z → 2026-09-28T08:44:13.394Z

**3 passed · 5 failed · 0 not-run (listed with procedures) · 8 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J01 | First launch / profile selection / onboarding | **FAIL** | 2 | 3 |
| J02 | Home discovery / hero / rows / intent entry | **FAIL** | 1 | 3 |
| J03 | Long-form Watch browsing | PASS | 6 | 3 |
| J04 | Shorts vertical discovery | PASS | 13 | 3 |
| J05 | Unified search | **FAIL** | 4 | 3 |
| J06 | Item detail / availability / realization choice | **FAIL** | 1 | 3 |
| J11 | Library / watchlist / history | PASS | 11 | 3 |
| J37 | Anonymous public viewing without WebFlix login | **FAIL** | 7 | 3 |

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
- **J06 Item detail / availability / realization choice**: journey assertion failed: the item detail surface renders
  expected: [data-wfx-surface='item'] present in the DOM
  observed: 0 matching element(s)
- **J37 Anonymous public viewing without WebFlix login**: journey assertion failed: the item page offers Play to the anonymous viewer
  expected: a play href
  observed: <absent>
