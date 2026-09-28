# WebFlix Golden Journey Run — Evidence Summary

- commit: `09d02055f72a41927bc20fca8bbbfe5dd8cfeb1b`
- branch: `wfx/r34c/accept-regression`
- environment: web-fixtures @ https://webflix-steel.vercel.app
- window: 2026-09-27T20:54:01.954Z → 2026-09-27T20:54:14.461Z

**0 passed · 5 failed · 0 not-run (listed with procedures) · 5 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J06 | Item detail / availability / realization choice | **FAIL** | 1 | 2 |
| J07 | Official embed playback | **FAIL** | 1 | 2 |
| J08 | Contained Browser playback | **FAIL** | 1 | 2 |
| J09 | External playback fallback / return context | **FAIL** | 1 | 2 |
| J10 | Like/save/action synchronization truth | **FAIL** | 1 | 2 |

## Explicit limitations (never silent skips)

- **J09** (configuration-limit): The external-rung WIN (the visible external handoff with its return-context link) requires an item whose only realization is external — the fixture catalog carries none (every item resolves embed or browser first). The fallback DECISION trace and the typed failure states are encoded; the handoff itself is not reachable in this configuration.
  - procedure: LOCAL-ONLY: boot the service-mode configuration with a source that declares an external-only realization (or a realization whose embed/browser URLs the provider restricts), open its player, and capture the data-wfx-player-mode="external" handoff + the return-context link under evidence/<run>/.

## Failures

- **J06 Item detail / availability / realization choice**: journey assertion failed: the home feed offers the card "Asteroid Drift"
  expected: an aria-labeled card link for "Asteroid Drift"
  observed: no matching card
- **J07 Official embed playback**: journey assertion failed: the search surface offers the Harbor Lights item (the embed-realized catalog item)
  expected: an item link
  observed: <absent>
- **J08 Contained Browser playback**: journey assertion failed: the search surface offers the browser-realized item
  expected: an item link
  observed: <absent>
- **J09 External playback fallback / return context**: journey assertion failed: the search surface offers the multi-realization item
  expected: an item link
  observed: <absent>
- **J10 Like/save/action synchronization truth**: journey assertion failed: the search surface offers the item
  expected: an item link
  observed: <absent>
