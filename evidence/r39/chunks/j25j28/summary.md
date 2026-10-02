# WebFlix Golden Journey Run — Evidence Summary

- commit: `b0238206a348c5740396d09fd27ffef3997a7b7b`
- branch: `work/wfx-deploy-w3-regression`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-10-02T10:30:38.387Z → 2026-10-02T10:31:18.954Z

**3 passed · 0 failed · 0 not-run (listed with procedures) · 3 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J25 | Torrent interruption / restart / resume (web status surface) | PASS | 19 | 3 |
| J27 | Native local media playback (web constrained truth) | PASS | 6 | 3 |
| J28 | Provider credential expiry/recovery | PASS | 21 | 3 |

## Explicit limitations (never silent skips)

- **J28** (local-only): The R17 encoding covers the credential-expiry LIFECYCLE over the fixtures' scripted source-auth feed (expiry → the named expired state → the typed unauthorized read → reauthorize → recovery — the same browser-validation pattern as J21-J26's scripted acquisitions). The REAL provider OAuth round trips (a real consent dance, real token exchange, a real expiry) are the service-side source-management lane and remain local-only.
  - procedure: LOCAL-ONLY: boot apps/api over a PostgreSQL database (DATABASE_URL + APP_ENCRYPTION_KEY), boot apps/web in service mode (WFX_API_BASE), drive the /sources connect flow with a stub-OAuth connector (the apps/api test boots' SourceAuthWiring pattern), let the token expire, observe the typed unauthorized degradation in the web surfaces, reauthorize, and capture screenshots per state under evidence/<run>/ — then run this runner with --base-url against that service boot.
- **J25** (desktop-procedure): Native interruption/restart with persistent session recovery (crash-safe journals, piece-map reuse) is the Desktop path. The web encodes the recoverable-failure/retry/resuming-status grammar.
  - procedure: DESKTOP (journeys/desktop/README.md): interrupt an in-progress acquisition (kill the engine), restart the app, capture the resumed-not-fresh evidence (retained progress, no false completion), then complete it.
- **J27** (desktop-procedure): Native local media playback (the local range gateway + verified asset replay) is the Desktop path. The web encodes the constrained capability truth (settings table + the desktop-elsewhere note).
  - procedure: DESKTOP (journeys/desktop/README.md): play a verified offline asset from the Library through the native media engine, capture the playback + replay states.
