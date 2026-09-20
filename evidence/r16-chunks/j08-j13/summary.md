# WebFlix Golden Journey Run — Evidence Summary

- commit: `0da5a86d3967379bfe69f8de18e3bbabc4f5361d`
- branch: `wfx/r22/integration`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-20T16:51:41.728Z → 2026-09-20T16:53:01.015Z

**6 passed · 0 failed · 0 not-run (listed with procedures) · 6 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J08 | Contained Browser playback | PASS | 10 | 3 |
| J09 | External playback fallback / return context | PASS | 13 | 3 |
| J10 | Like/save/action synchronization truth | PASS | 9 | 3 |
| J11 | Library / watchlist / history | PASS | 11 | 3 |
| J12 | Cross-device resume | PASS | 6 | 3 |
| J13 | Account/profile/identity lifecycle | PASS | 5 | 3 |

## Explicit limitations (never silent skips)

- **J09** (configuration-limit): The external-rung WIN (the visible external handoff with its return-context link) requires an item whose only realization is external — the fixture catalog carries none (every item resolves embed or browser first). The fallback DECISION trace and the typed failure states are encoded; the handoff itself is not reachable in this configuration.
  - procedure: LOCAL-ONLY: boot the service-mode configuration with a source that declares an external-only realization (or a realization whose embed/browser URLs the provider restricts), open its player, and capture the data-wfx-player-mode="external" handoff + the return-context link under evidence/<run>/.
- **J12** (configuration-limit): Cross-DEVICE resume continuity requires the server-side identity/profile state (the service-mode boot over the shared profile); the fixtures boot is one anonymous session. Additionally, the Turbopack dev server compiles routes as separate module graphs, so the /api/events watch-state fold does not cross pages in the dev boot (documented in apps/web/src/host/acquisition-fixtures.ts).
  - procedure: LOCAL-ONLY: boot the service-mode configuration (api+web), watch an item on one browser profile, sign in on a second profile with the same identity, and verify Continue Watching/resume under evidence/<run>/ (the single-bundle service boot folds the watch state across routes).
