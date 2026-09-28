# WebFlix Golden Journey Run — Evidence Summary

- commit: `09d02055f72a41927bc20fca8bbbfe5dd8cfeb1b`
- branch: `wfx/r34c/accept-regression`
- environment: web-fixtures @ https://webflix-steel.vercel.app
- window: 2026-09-27T20:56:51.526Z → 2026-09-27T20:57:11.373Z

**0 passed · 5 failed · 0 not-run (listed with procedures) · 5 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J27 | Native local media playback (web constrained truth) | **FAIL** | 3 | 2 |
| J28 | Provider credential expiry/recovery | **FAIL** | 1 | 2 |
| J29 | Network loss / playback recovery | **FAIL** | 10 | 2 |
| J30 | Unsupported capability honesty | **FAIL** | 11 | 2 |
| J31 | Cross-platform Web/Desktop parity (web-side anchors) | **FAIL** | 1 | 2 |

## Explicit limitations (never silent skips)

- **J28** (local-only): The R17 encoding covers the credential-expiry LIFECYCLE over the fixtures' scripted source-auth feed (expiry → the named expired state → the typed unauthorized read → reauthorize → recovery — the same browser-validation pattern as J21-J26's scripted acquisitions). The REAL provider OAuth round trips (a real consent dance, real token exchange, a real expiry) are the service-side source-management lane and remain local-only.
  - procedure: LOCAL-ONLY: boot apps/api over a PostgreSQL database (DATABASE_URL + APP_ENCRYPTION_KEY), boot apps/web in service mode (WFX_API_BASE), drive the /sources connect flow with a stub-OAuth connector (the apps/api test boots' SourceAuthWiring pattern), let the token expire, observe the typed unauthorized degradation in the web surfaces, reauthorize, and capture screenshots per state under evidence/<run>/ — then run this runner with --base-url against that service boot.
- **J27** (desktop-procedure): Native local media playback (the local range gateway + verified asset replay) is the Desktop path. The web encodes the constrained capability truth (settings table + the desktop-elsewhere note).
  - procedure: DESKTOP (journeys/desktop/README.md): play a verified offline asset from the Library through the native media engine, capture the playback + replay states.
- **J31** (configuration-limit): The parity COMPARISON (Web vs Desktop semantically equivalent outcomes) requires both adapters running against the same server-side state. The web-side parity anchors (canonical identity, library state, intent, session state) are encoded; the desktop-side comparison is the lead's procedure.
  - procedure: LEAD (the parity run): boot the service-mode api+web and the Desktop adapter against the SAME profile state, run the parity anchor set on both (item identity, library sections, intent composition), and capture both adapters' evidence side by side under evidence/<run>/.

## Failures

- **J27 Native local media playback (web constrained truth)**: journey assertion failed: the search surface offers an unscripted item (no acquisition session)
  expected: an item link
  observed: <absent>
- **J28 Provider credential expiry/recovery**: journey assertion failed: the search surface offers the item while the source is signed in
  expected: an item link
  observed: <absent>
- **J29 Network loss / playback recovery**: journey assertion failed: the search surface offers the network-loss item
  expected: an item link
  observed: <absent>
- **J30 Unsupported capability honesty**: journey assertion failed: the playback surface's like/save render their typed absent notes (unsupported never looks like success)
  expected: absent like + save notes
  observed: <no absent markers>
- **J31 Cross-platform Web/Desktop parity (web-side anchors)**: journey assertion failed: the search surface anchors the canonical item
  expected: an item link
  observed: <absent>
