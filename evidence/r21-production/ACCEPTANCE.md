# R21 Acceptance — Journey-Driven Discoverability (J34 + J35)

**Date:** 2026-09-20 · **Lead:** resident orchestrator · **Branch:** `main` @ `dc8ce0e`
(R21-I integration of `wfx/r21/discoverability` c828af1 + `wfx/r21/discoverability-web` 12c2da8 + `wfx/r21/discoverability-desktop` 9ead6f6; zero merge conflicts — the web lane had already absorbed shared B/C at 934a831, the desktop lane's G/H was purely additive)

## Gate battery on the integrated tree (lead, worktree r21i-prep)

| Gate | Result |
|---|---|
| `bun install --frozen-lockfile` | clean (616 packages) |
| `bun run lint` | 0 errors / 10 warnings (pre-existing, unchanged) |
| `bun run typecheck` | clean (both tsconfig projects) |
| `bun run test` (`--parallel=1`, hardened) | **3860 pass / 1 skip / 0 fail — 3810→3861 tests across 206 files** (web 3810 + desktop G/H 51) |
| `bun run contract-check` | OK — 11 frozen blocks in sync, 7 extension types |
| `bun run lane-check` | OK — 678 files, no cross-lane private imports |

Environmental battery notes (documented, not product defects): under default 2× parallelism the sandbox OOM-SIGKILLs bun test workers (persistence/ports once; api-directory once, exit 137) and one PGlite teardown race ("PGlite is closed") — every affected file green in isolation and under `--parallel=1`; the hardened run above is the authoritative record.

## J34 — Capability discoverability (integrated tree, fixtures boot)

Full-suite run: **26 passed / 8 failed** — all 8 failures at the run's tail (J20, J28–J34), the progressive renderer-starvation signature (agent-browser CDP `DOM.enable` timeouts; downstream "assertion" failures on dead renderers returning empty DOM) — the same environmental family the R20 acceptance documented. **Every failure re-run green in isolation**: batch J20/J28/J29 → 3/3 PASS; batch J30–J34 → 5/5 PASS. **34/34 journeys green on the integrated product.** J34 itself: 42 assertions, twelve tasks from normal product paths only.

## J35 — Production capability parity (the lead's sweep, live deployment)

Target: **https://webflix-steel.vercel.app** auto-deployed from `main` @ `dc8ce0e` (R21 surfaces verified live: "Personalize" and "Where to watch" exist only in R21 source; both render). The API service (webflix-api.vercel.app, Neon catalog) unchanged by R21 (zero apps/api files touched). Evidence: `evidence/r21-production/*.png` (home, home+personalize open, item hub, player, library), captured 2026-09-20 via agent-browser session `j35`.

The twelve tasks, each from a normal product path on the live surface:

1. **Identity (R02)** — session menu → "Sign in / Create a profile" + "Profile & identity settings"; honest anonymous-session copy ("honestly session-scoped, nothing pretends to be a profile"). ✓
2. **Source connect (R03)** — Home source-strip "Connect a source" CTA. ✓
3. **BYOF (R20)** — Home "Bring your feed" CTA. ✓
4. **Feed modes (R20)** — the Home control renders all four: For you / Following / Your imported feed / Blend. ✓
5. **Temporary intent (R05)** — Personalize control: "What are you in the mood for?" + "Set for this session"; scope stated in the action's own words; **functional**: intent set ("calm rain documentaries"), persisted server-side across reload (`GET /api/personalize` → `intents[{objective, scope:"session", expiryLabel:"ends with this session"}]`). ✓
6. **Attention mode (R05)** — Mindful / Balanced (default) / Immersive / Custom with per-mode descriptions. ✓
7. **Recommendation feedback (R05)** — item hub feedback controls: all four frozen kinds (more-like-this, not-interested, not-interested-source, already-watched). ✓
8. **Model/BYOM controls (R06)** — the AI tray's management link → `/settings?section=model` (the contextual path, not Settings-first). ✓
9. **AI actions (R06)** — tray on content AND player: the five frozen actions (transcript, subtitle, translation, dubbing, commentary). ✓
10. **Where it plays (R09)** — item hub "Where to watch" (canonical identity first, realizations second — this real catalog item honestly offers embed + external); player carries the user-vocabulary mode sentence ("Embedded playback contained in a cookie-isolated surface — … named honestly") and the tray; the switch row is honestly empty for a single-realization item. ✓
11. **Desktop/offline path (R14)** — item hub acquisition affordance: "You can make this title available offline in the WebFlix desktop app — it downloads and verifies a copy you can watch without a connection." ✓
12. **Library** — Watchlist / History / "Offline and verified" (+ "Your imported feeds" for BYOF). ✓

**Stale-completion-copy sweep (J35's own primitive):** the frozen `STALE_COMPLETION_MARKERS` patterns applied to the rendered copy of Home, Settings, Library, the item hub, and the player — **zero hits on every surface**. The live product carries no "arrives later / ships with R0x" states for accepted capabilities.

## Verdict

R21 Definition of Done satisfied: capability-to-surface matrix frozen (R21-A, machine-checked on Web and Desktop); every important accepted capability reachable from contextual product entry points; failure states carry recovery/next actions; stale completion copy eliminated (machine-swept on fixtures and production); Web production transport matches the accepted runtime capability (R21-B/C transport live behind the production surfaces); Web/Desktop preserve shared semantics (R21-G parity matrix, 17 rows machine-checked); J34 and J35 green with fresh browser evidence; affected existing journeys re-encoded where their truth changed (J19, J20) and the full catalog re-run green (34/34 on the integrated tree); no architecture-specific diagnostics required for discovery; the final production deployment smoke-tested from the user perspective (this sweep).
