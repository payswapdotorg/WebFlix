# WebFlix Golden Journey Run — Evidence Summary

- commit: `b0238206a348c5740396d09fd27ffef3997a7b7b`
- branch: `work/wfx-deploy-w3-regression`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-10-02T10:26:51.890Z → 2026-10-02T10:28:25.582Z

**10 passed · 0 failed · 0 not-run (listed with procedures) · 10 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J01 | First launch / profile selection / onboarding | PASS | 19 | 3 |
| J02 | Home discovery / hero / rows / intent entry | PASS | 12 | 3 |
| J03 | Long-form Watch browsing | PASS | 6 | 3 |
| J04 | Shorts vertical discovery | PASS | 13 | 3 |
| J05 | Unified search | PASS | 7 | 3 |
| J06 | Item detail / availability / realization choice | PASS | 13 | 3 |
| J07 | Official embed playback | PASS | 12 | 3 |
| J08 | Contained Browser playback | PASS | 9 | 3 |
| J09 | External playback fallback / return context | PASS | 13 | 3 |
| J10 | Like/save/action synchronization truth | PASS | 9 | 3 |

## Explicit limitations (never silent skips)

- **J09** (configuration-limit): The external-rung WIN (the visible external handoff with its return-context link) requires an item whose only realization is external — the fixture catalog carries none (every item resolves embed or browser first). The fallback DECISION trace and the typed failure states are encoded; the handoff itself is not reachable in this configuration.
  - procedure: LOCAL-ONLY: boot the service-mode configuration with a source that declares an external-only realization (or a realization whose embed/browser URLs the provider restricts), open its player, and capture the data-wfx-player-mode="external" handoff + the return-context link under evidence/<run>/.
