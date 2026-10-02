# WebFlix Golden Journey Run — Evidence Summary

- commit: `b0238206a348c5740396d09fd27ffef3997a7b7b`
- branch: `work/wfx-deploy-w3-regression`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-10-02T10:45:11.980Z → 2026-10-02T10:45:41.890Z

**1 passed · 0 failed · 0 not-run (listed with procedures) · 1 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J49 | Deployment release surface (health / offline / PWA / critical path) | PASS | 41 | 3 |

## Explicit limitations (never silent skips)

- **J49** (configuration-limit): The WFX-DEPLOY-W3 encoding covers the deployment critical path the fixtures boot can exercise: the shell nav, the search form-submit path into a result, the player's honest resolution mode, the /api/health frozen contract, the /offline zero-configuration render with its PROVEN retry re-attempt, the PWA asset laws (manifest served + linked + standalone + the 1024 icons; sw.js served), and the fixtures-boot registration/mounting laws (NO service worker, NO install chrome in dev). The internal API route table's failure laws (actions/events 400s, shorts 200/502) are machine-tested by apps/web/tests/adapter-api-routes.test.ts and verified live by the lane's committed HTTP probe evidence (the r39 packet) — not journey-encoded. The PRODUCTION-only PWA behaviors — the service worker actually REGISTERING (the production-build NODE_ENV guard), the SW's offline FALLBACK serving /offline at the original navigation URL, the real beforeinstallprompt install flow, and the waiting-worker update flow — cannot be exercised in the fixtures dev boot (the documented WFX-057 law: registration is production-build + service-mode only; fixtures never register).
  - procedure: LOCAL-ONLY (the WFX-057 production-start procedure, recorded in apps/web/DEPLOYMENT.md 'How to verify install'): build the production bundle (bun run build in apps/web), boot it in service mode (WFX_API_BASE=<a reachable Experience API base> bun run start), and drive the production surfaces in a real browser — manifest 200 application/manifest+json, sw.js 200 no-store, the SW registered → activated → controlling, the offline fallback (stop the server → navigate → the SW serves /offline at the original URL; Try again recovers when the server returns), and the update flow (bump CACHE_VERSION → waiting worker → Update available → one reload). The final production install check on the deployed URL belongs to the lead's deployed-preview verification.
