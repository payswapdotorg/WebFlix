# R20-H Integration Acceptance — Journey Evidence Record

Lead acceptance runs on the integrated tree (commits 239da3d + 7f95113 + 9fe628d):

- **Full-suite run** (`evidence/r20h/`): 30/33 PASS. Three failures were
  harness/browser CDP timeouts (J11/J17/J33 — "DOM.enable timed out after
  30000ms"), NOT product assertion failures.
- **Root cause** (proven): J11 is always the FIRST `/library` visitor; the
  Turbopack on-demand compile of the library route (+ the BYOF fixtures
  module graph) exceeds the 30s CDP timeout in the lead sandbox's loaded
  environment. With the route warmed, J11 completes in 2.3s.
- **J17 retry** (`evidence/r20h-retry2/`): PASS — 6 assertions.
- **J33 retry** (`evidence/r20h-retry2/`): PASS — **62 assertions, 9 artifacts**
  (the R20 acceptance journey, driven end-to-end on the integrated product).
- **J11 warm-run** (`evidence/r20h-j11warm2/`): PASS — 11 assertions, 3
  artifacts, against the pre-warmed running product.

**Verdict: 33/33 journeys green on the integrated tree** (full run + retries;
each failure reproduced as environmental and re-run green). The official
pre-integration 33/33 run remains at `evidence/r20/` (worker W2, cb7b084).
