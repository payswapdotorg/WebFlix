# WebFlix Golden Journey Run — Evidence Summary

- commit: `acff71b8b363ba6f85ab7a3e9b08ca7ba3e5a419`
- branch: `wfx/r35b/journeys`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-28T12:37:05.291Z → 2026-09-28T12:37:52.101Z

**0 passed · 6 failed · 0 not-run (listed with procedures) · 6 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J27 | Native local media playback (web constrained truth) | **FAIL** | 4 | 3 |
| J28 | Provider credential expiry/recovery | **FAIL** | 2 | 3 |
| J29 | Network loss / playback recovery | **FAIL** | 10 | 3 |
| J30 | Unsupported capability honesty | **FAIL** | 11 | 3 |
| J31 | Cross-platform Web/Desktop parity (web-side anchors) | **FAIL** | 2 | 3 |
| J32 | Source-neutral identity: same item, multiple realizations | **FAIL** | 1 | 3 |

## Explicit limitations (never silent skips)

- **J28** (local-only): The R17 encoding covers the credential-expiry LIFECYCLE over the fixtures' scripted source-auth feed (expiry → the named expired state → the typed unauthorized read → reauthorize → recovery — the same browser-validation pattern as J21-J26's scripted acquisitions). The REAL provider OAuth round trips (a real consent dance, real token exchange, a real expiry) are the service-side source-management lane and remain local-only.
  - procedure: LOCAL-ONLY: boot apps/api over a PostgreSQL database (DATABASE_URL + APP_ENCRYPTION_KEY), boot apps/web in service mode (WFX_API_BASE), drive the /sources connect flow with a stub-OAuth connector (the apps/api test boots' SourceAuthWiring pattern), let the token expire, observe the typed unauthorized degradation in the web surfaces, reauthorize, and capture screenshots per state under evidence/<run>/ — then run this runner with --base-url against that service boot.
- **J27** (desktop-procedure): Native local media playback (the local range gateway + verified asset replay) is the Desktop path. The web encodes the constrained capability truth (settings table + the desktop-elsewhere note).
  - procedure: DESKTOP (journeys/desktop/README.md): play a verified offline asset from the Library through the native media engine, capture the playback + replay states.
- **J31** (configuration-limit): The parity COMPARISON (Web vs Desktop semantically equivalent outcomes) requires both adapters running against the same server-side state. The web-side parity anchors (canonical identity, library state, intent, session state) are encoded; the desktop-side comparison is the lead's procedure.
  - procedure: LEAD (the parity run): boot the service-mode api+web and the Desktop adapter against the SAME profile state, run the parity anchor set on both (item identity, library sections, intent composition), and capture both adapters' evidence side by side under evidence/<run>/.

## Failures

- **J27 Native local media playback (web constrained truth)**: journey assertion failed: the offline-copy panel renders its no-session state
  expected: [data-wfx-acquisition-none] present in the DOM
  observed: 0 matching element(s)
- **J28 Provider credential expiry/recovery**: journey assertion failed: the item page offers its play decision while the source is signed in
  expected: a player link
  observed: <absent>
- **J29 Network loss / playback recovery**: harness/browser failure: agent-browser command failed (1): scrollintoview [data-wfx-acquisition-action='acquire']
✗ Element not found: [data-wfx-acquisition-action='acquire']. Verify the selector, role, or name is correct and the element exists in the DOM.
- **J30 Unsupported capability honesty**: journey assertion failed: the playback surface's like/save render their typed absent notes (unsupported never looks like success)
  expected: absent like + save notes
  observed: <no absent markers>
- **J31 Cross-platform Web/Desktop parity (web-side anchors)**: journey assertion failed: the item detail surface carries the SAME canonical identity the search card linked
  expected: the detail carries wfxitm_4TF83YJ6VNBEEQYB6VC4V6ZVPR
  observed: <none>
- **J32 Source-neutral identity: same item, multiple realizations**: journey assertion failed: the search card links the CANONICAL identity (id-first, not source-first)
  expected: an /item?id=wfxitm_… link
  observed: /player?id=wfxitm_4TF83YJ6VNBEEQYB6VC4V6ZVPR&connector=fake-source&ref=fake%3Amovie-1&title=Asteroid+Drift&type=movie&duration=7200000
