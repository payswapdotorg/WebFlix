# WebFlix Golden Journey Run — Evidence Summary

- commit: `abe6824b93edea99e1cd40e5c5ad35bac114b4cf`
- branch: `work/wfx-r23-reval`
- environment: web-fixtures @ https://webflix-steel.vercel.app
- window: 2026-10-03T08:57:00.747Z → 2026-10-03T08:57:07.039Z

**0 passed · 1 failed · 0 not-run (listed with procedures) · 1 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J37 | Anonymous public viewing without WebFlix login | **FAIL** | 4 | 2 |

## Failures

- **J37 Anonymous public viewing without WebFlix login**: journey assertion failed: the search surface offers the public title's one-click play path anonymously
  expected: an id-first /player link (the R28-B play decision — no gate, no extra hop)
  observed: <absent>
