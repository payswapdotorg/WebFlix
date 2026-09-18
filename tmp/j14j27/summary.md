# WebFlix Golden Journey Run — Evidence Summary

- commit: `9fd479d422bad29aad3271ff286c09b939d7d7af`
- branch: `main`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-18T19:21:00.089Z → 2026-09-18T19:21:14.569Z

**2 passed · 0 failed · 0 not-run (listed with procedures) · 2 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J14 | Source connect / reauthorize / disconnect | PASS | 11 | 3 |
| J27 | Native local media playback (web constrained truth) | PASS | 6 | 3 |

## Explicit limitations (never silent skips)

- **J14** (local-only): The R17 encoding asserts the scripted source's authorization-state truth (the signed-in card, the Connected chip, the typed action vocabulary; the expiry → reauthorize round trip is J28's encoding). The REAL provider connect/reauthorize/disconnect round trips (a real OAuth dance over the durable connector-account store) are the service-side source-management lane and remain local-only.
  - procedure: LOCAL-ONLY: the service-mode boot (see J28's procedure) + drive /settings sources connect → capability truth → reauthorize → disconnect against the real service routes, capturing each state.
- **J27** (desktop-procedure): Native local media playback (the local range gateway + verified asset replay) is the Desktop path. The web encodes the constrained capability truth (settings table + the desktop-elsewhere note).
  - procedure: DESKTOP (journeys/desktop/README.md): play a verified offline asset from the Library through the native media engine, capture the playback + replay states.
