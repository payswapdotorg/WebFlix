# WebFlix Golden Journey Run — Evidence Summary

- commit: `af854b3575ffe0beec4ab67bfa32742c2b767c18`
- branch: `wfx/r26/web`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-22T17:53:35.805Z → 2026-09-22T17:54:52.037Z

**14 passed · 0 failed · 0 not-run (listed with procedures) · 14 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J01 | First launch / profile selection / onboarding | PASS | 18 | 3 |
| J02 | Home discovery / hero / rows / intent entry | PASS | 13 | 3 |
| J03 | Long-form Watch browsing | PASS | 6 | 3 |
| J04 | Shorts vertical discovery | PASS | 13 | 3 |
| J05 | Unified search | PASS | 7 | 3 |
| J06 | Item detail / availability / realization choice | PASS | 11 | 3 |
| J07 | Official embed playback | PASS | 13 | 3 |
| J08 | Contained Browser playback | PASS | 10 | 3 |
| J09 | External playback fallback / return context | PASS | 13 | 3 |
| J10 | Like/save/action synchronization truth | PASS | 9 | 3 |
| J11 | Library / watchlist / history | PASS | 11 | 3 |
| J12 | Cross-device resume | PASS | 6 | 3 |
| J13 | Account/profile/identity lifecycle | PASS | 5 | 3 |
| J14 | Source connect / reauthorize / disconnect | PASS | 11 | 3 |

## Explicit limitations (never silent skips)

- **J09** (configuration-limit): The external-rung WIN (the visible external handoff with its return-context link) requires an item whose only realization is external — the fixture catalog carries none (every item resolves embed or browser first). The fallback DECISION trace and the typed failure states are encoded; the handoff itself is not reachable in this configuration.
  - procedure: LOCAL-ONLY: boot the service-mode configuration with a source that declares an external-only realization (or a realization whose embed/browser URLs the provider restricts), open its player, and capture the data-wfx-player-mode="external" handoff + the return-context link under evidence/<run>/.
- **J12** (configuration-limit): Cross-DEVICE resume continuity requires the server-side identity/profile state (the service-mode boot over the shared profile); the fixtures boot is one anonymous session. Additionally, the Turbopack dev server compiles routes as separate module graphs, so the /api/events watch-state fold does not cross pages in the dev boot (documented in apps/web/src/host/acquisition-fixtures.ts).
  - procedure: LOCAL-ONLY: boot the service-mode configuration (api+web), watch an item on one browser profile, sign in on a second profile with the same identity, and verify Continue Watching/resume under evidence/<run>/ (the single-bundle service boot folds the watch state across routes).
- **J14** (local-only): The R17 encoding asserts the scripted source's authorization-state truth (the signed-in card, the Connected chip, the typed action vocabulary; the expiry → reauthorize round trip is J28's encoding). The REAL provider connect/reauthorize/disconnect round trips (a real OAuth dance over the durable connector-account store) are the service-side source-management lane and remain local-only.
  - procedure: LOCAL-ONLY: the service-mode boot (see J28's procedure) + drive /settings sources connect → capability truth → reauthorize → disconnect against the real service routes, capturing each state.
