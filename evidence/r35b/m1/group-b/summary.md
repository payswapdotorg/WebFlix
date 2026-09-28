# WebFlix Golden Journey Run — Evidence Summary

- commit: `acff71b8b363ba6f85ab7a3e9b08ca7ba3e5a419`
- branch: `wfx/r35b/journeys`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-28T12:34:53.080Z → 2026-09-28T12:35:31.966Z

**0 passed · 6 failed · 0 not-run (listed with procedures) · 6 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J06 | Item detail / availability / realization choice | **FAIL** | 1 | 3 |
| J07 | Official embed playback | **FAIL** | 2 | 3 |
| J08 | Contained Browser playback | **FAIL** | 2 | 3 |
| J09 | External playback fallback / return context | **FAIL** | 2 | 3 |
| J10 | Like/save/action synchronization truth | **FAIL** | 2 | 3 |
| J12 | Cross-device resume | **FAIL** | 2 | 3 |

## Explicit limitations (never silent skips)

- **J09** (configuration-limit): The external-rung WIN (the visible external handoff with its return-context link) requires an item whose only realization is external — the fixture catalog carries none (every item resolves embed or browser first). The fallback DECISION trace and the typed failure states are encoded; the handoff itself is not reachable in this configuration.
  - procedure: LOCAL-ONLY: boot the service-mode configuration with a source that declares an external-only realization (or a realization whose embed/browser URLs the provider restricts), open its player, and capture the data-wfx-player-mode="external" handoff + the return-context link under evidence/<run>/.
- **J12** (configuration-limit): Cross-DEVICE resume continuity requires the server-side identity/profile state (the service-mode boot over the shared profile); the fixtures boot is one anonymous session. Additionally, the Turbopack dev server compiles routes as separate module graphs, so the /api/events watch-state fold does not cross pages in the dev boot (documented in apps/web/src/host/acquisition-fixtures.ts).
  - procedure: LOCAL-ONLY: boot the service-mode configuration (api+web), watch an item on one browser profile, sign in on a second profile with the same identity, and verify Continue Watching/resume under evidence/<run>/ (the single-bundle service boot folds the watch state across routes).

## Failures

- **J06 Item detail / availability / realization choice**: journey assertion failed: the item detail surface renders
  expected: [data-wfx-surface='item'] present in the DOM
  observed: 0 matching element(s)
- **J07 Official embed playback**: journey assertion failed: the detail page offers playback
  expected: a play href
  observed: <absent>
- **J08 Contained Browser playback**: journey assertion failed: the detail page offers playback
  expected: a play href
  observed: <absent>
- **J09 External playback fallback / return context**: journey assertion failed: the player renders the Media Surface precedence trace (the fallback decision surface)
  expected: [data-wfx-precedence-trace] matches exactly 1
  observed: 0 matching element(s)
- **J10 Like/save/action synchronization truth**: journey assertion failed: like renders its typed absent state when the source declares it unsupported
  expected: data-wfx-action-absent='like'
  observed: <no absent markers>
- **J12 Cross-device resume**: journey assertion failed: the detail page offers playback
  expected: a play href
  observed: <absent>
