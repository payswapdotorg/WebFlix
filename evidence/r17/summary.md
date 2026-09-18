# WebFlix Golden Journey Run — Evidence Summary

- commit: `60a8e9a270a73d1d3d2b1dad8264ea1c356a9974`
- branch: `wfx/r17/recovery-hardening`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-18T18:14:42.135Z → 2026-09-18T18:15:41.216Z

**1 passed · 2 failed · 0 not-run (listed with procedures) · 3 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J28 | Provider credential expiry/recovery | **FAIL** | 6 | 3 |
| J29 | Network loss / playback recovery | **FAIL** | 10 | 3 |
| J30 | Unsupported capability honesty | PASS | 12 | 3 |

## Explicit limitations (never silent skips)

- **J28** (local-only): The R17 encoding covers the credential-expiry LIFECYCLE over the fixtures' scripted source-auth feed (expiry → the named expired state → the typed unauthorized read → reauthorize → recovery — the same browser-validation pattern as J21-J26's scripted acquisitions). The REAL provider OAuth round trips (a real consent dance, real token exchange, a real expiry) are the service-side source-management lane and remain local-only.
  - procedure: LOCAL-ONLY: boot apps/api over a PostgreSQL database (DATABASE_URL + APP_ENCRYPTION_KEY), boot apps/web in service mode (WFX_API_BASE), drive the /sources connect flow with a stub-OAuth connector (the apps/api test boots' SourceAuthWiring pattern), let the token expire, observe the typed unauthorized degradation in the web surfaces, reauthorize, and capture screenshots per state under evidence/<run>/ — then run this runner with --base-url against that service boot.

## Failures

- **J28 Provider credential expiry/recovery**: journey assertion failed: the signed-in source renders its Connected chip
  expected: text of [data-wfx-source-auth-chip='signedIn'] contains "Connected"
  observed: "CONNECTED"
- **J29 Network loss / playback recovery**: harness/browser failure: agent-browser command failed (1): scrollintoview [data-wfx-acquisition-action='advance']
✗ Element not found: [data-wfx-acquisition-action='advance']. Verify the selector, role, or name is correct and the element exists in the DOM.
