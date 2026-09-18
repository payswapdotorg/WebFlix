# WebFlix Golden Journey Run — Evidence Summary

- commit: `e12bafe4ea628f0e7da601a29d0044d9013131be`
- branch: `main`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-18T18:59:45.953Z → 2026-09-18T19:00:37.066Z

**3 passed · 0 failed · 0 not-run (listed with procedures) · 3 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J28 | Provider credential expiry/recovery | PASS | 22 | 3 |
| J29 | Network loss / playback recovery | PASS | 19 | 3 |
| J30 | Unsupported capability honesty | PASS | 12 | 3 |

## Explicit limitations (never silent skips)

- **J28** (local-only): The R17 encoding covers the credential-expiry LIFECYCLE over the fixtures' scripted source-auth feed (expiry → the named expired state → the typed unauthorized read → reauthorize → recovery — the same browser-validation pattern as J21-J26's scripted acquisitions). The REAL provider OAuth round trips (a real consent dance, real token exchange, a real expiry) are the service-side source-management lane and remain local-only.
  - procedure: LOCAL-ONLY: boot apps/api over a PostgreSQL database (DATABASE_URL + APP_ENCRYPTION_KEY), boot apps/web in service mode (WFX_API_BASE), drive the /sources connect flow with a stub-OAuth connector (the apps/api test boots' SourceAuthWiring pattern), let the token expire, observe the typed unauthorized degradation in the web surfaces, reauthorize, and capture screenshots per state under evidence/<run>/ — then run this runner with --base-url against that service boot.
