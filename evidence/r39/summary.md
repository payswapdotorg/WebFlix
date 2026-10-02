# WebFlix Golden Journey Run — Evidence Summary (R39 · WFX-DEPLOY-W3)

- commit: `b0238206a348c5740396d09fd27ffef3997a7b7b`
- branch: `work/wfx-deploy-w3-regression`
- environment: web-fixtures @ http://localhost:3101 (the strengthened suite, chunked sweep — see manifest.environment.determinism)
- window: 2026-10-02T10:26:51.890Z → 2026-10-02T10:47:28.706Z

**46 passed · 0 failed · 0 not-run (46 listed with procedures in the manifest limitations) · 46 total**

| Journey | Title | Status | Assertions | Artifacts | Chunk (evidence) |
|---|---|---|---:|---:|---|
| J01 | First launch / profile selection / onboarding | PASS | 19 | 3 | `chunks/j01-j10/` |
| J02 | Home discovery / hero / rows / intent entry | PASS | 12 | 3 | `chunks/j01-j10/` |
| J03 | Long-form Watch browsing | PASS | 6 | 3 | `chunks/j01-j10/` |
| J04 | Shorts vertical discovery | PASS | 13 | 3 | `chunks/j01-j10/` |
| J05 | Unified search | PASS | 7 | 3 | `chunks/j01-j10/` |
| J06 | Item detail / availability / realization choice | PASS | 13 | 3 | `chunks/j01-j10/` |
| J07 | Official embed playback | PASS | 12 | 3 | `chunks/j01-j10/` |
| J08 | Contained Browser playback | PASS | 9 | 3 | `chunks/j01-j10/` |
| J09 | External playback fallback / return context | PASS | 13 | 3 | `chunks/j01-j10/` |
| J10 | Like/save/action synchronization truth | PASS | 9 | 3 | `chunks/j01-j10/` |
| J11 | Library / watchlist / history | PASS | 11 | 3 | `chunks/j11-j15/` |
| J12 | Cross-device resume | PASS | 5 | 3 | `chunks/j11-j15/` |
| J13 | Account/profile/identity lifecycle | PASS | 5 | 3 | `chunks/j11-j15/` |
| J14 | Source connect / reauthorize / disconnect | PASS | 15 | 3 | `chunks/j11-j15/` |
| J15 | Recommendation feedback controls | PASS | 6 | 3 | `chunks/j11-j15/` |
| J16 | Anti-tunnel / exploration after a single watched topic | PASS | 4 | 3 | `chunks/j16-j20/` |
| J17 | Explicit intent: learn / happier / surprise / tonight / friend taste | PASS | 8 | 3 | `chunks/j16-j20/` |
| J18 | Attention modes: mindful / balanced / immersive / custom | PASS | 4 | 3 | `chunks/j16-j20/` |
| J19 | WebFlix model / BYOM / local model policy | PASS | 11 | 3 | `chunks/j16-j20/` |
| J20 | AI subtitles / translation / transcription / dubbing / commentary | PASS | 19 | 3 | `chunks/j16-j20/` |
| J21 | Authorized torrent acquisition (web limited-status surface) | PASS | 14 | 3 | `chunks/jchain/` |
| J22 | Torrent metadata and file selection (web limited-status surface) | PASS | 7 | 3 | `chunks/jchain/` |
| J23 | Torrent playback before full completion (web status surface) | PASS | 15 | 3 | `chunks/jchain/` |
| J24 | Torrent background completion (web status surface) | PASS | 18 | 3 | `chunks/jchain/` |
| J25 | Torrent interruption / restart / resume (web status surface) | PASS | 19 | 3 | `chunks/j25j28/` |
| J26 | Verified local asset appears in Library (web status/read surface) | PASS | 8 | 3 | `chunks/jchain/` |
| J27 | Native local media playback (web constrained truth) | PASS | 6 | 3 | `chunks/j25j28/` |
| J28 | Provider credential expiry/recovery | PASS | 21 | 3 | `chunks/j25j28/` |
| J29 | Network loss / playback recovery | PASS | 19 | 3 | `chunks/j29j31/` |
| J30 | Unsupported capability honesty | PASS | 15 | 3 | `chunks/j29j31/` |
| J31 | Cross-platform Web/Desktop parity (web-side anchors) | PASS | 10 | 3 | `chunks/j29j31/` |
| J32 | Source-neutral identity: same item, multiple realizations | PASS | 11 | 3 | `chunks/j32j34/` |
| J33 | Bring Your Own Feed: import, preview, confirm, sync, provenance | PASS | 64 | 10 | `chunks/j32j34/` |
| J34 | Capability discoverability from normal product surfaces | PASS | 44 | 3 | `chunks/j32j34/` |
| J36 | Major user journey completion / no dead-end discovery | PASS | 50 | 3 | `chunks/j36-warmup/` |
| J37 | Anonymous public viewing without WebFlix login | PASS | 17 | 3 | `chunks/j37j39/` |
| J38 | First-class torrent playback (web: browser-capable + honest fallbacks) | PASS | 44 | 3 | `chunks/j37j39/` |
| J39 | Multimodal media intelligence / semantic moment discovery | PASS | 29 | 3 | `chunks/j37j39/` |
| J40 | YouTube viewer parity | PASS | 41 | 3 | `chunks/j40/` |
| J41 | YouTube-equivalent playback startup | PASS | 46 | 3 | `chunks/j41/` |
| J43 | Realtime translation | PASS | 38 | 3 | `chunks/j43/` |
| J44 | Creator channel round trip | PASS | 57 | 7 | `chunks/j44j45j46/` |
| J45 | Live watch + live chat | PASS | 30 | 3 | `chunks/j44j45j46/` |
| J46 | Chat replay scrub | PASS | 21 | 3 | `chunks/j44j45j46/` |
| J48 | Studio edit + customize round trip | PASS | 71 | 9 | `chunks/j48/` |
| J49 | Deployment release surface (health / offline / PWA / critical path) | PASS | 41 | 3 | `chunks/j49/` |

**Total assertions: 957**

## The baseline → strengthened delta

- J40: FAIL 7 assertions (stale grammar) → **PASS 41** (re-encoded against the R28-B card grammar)
- J41: FAIL 2 → **PASS 46** (the same re-encode; the startup marker set fully asserted)
- J43: FAIL 2 → **PASS 38** (the same re-encode + the keyboard-activation path for the chrome-panel controls)
- J36: FAIL 45 (the navigation-unsafe §11 wait) → **PASS 50** (the hardened fresh-evaluation polls)
- J49: **NEW — PASS 41** (the deployment release surface: nav / search form-submit / player honesty / health / offline+retry / PWA laws)
- J01–J39, J44–J48: unchanged, all PASS (zero regressions)

## Explicit limitations (never silent skips)

- **J49** (configuration-limit): The WFX-DEPLOY-W3 encoding covers the deployment critical path the fixtures boot can exercise: the shell nav, the search form-submit path into a result, the player's honest resolution mode, the /api/health frozen contract, the /offline zero-configuration render with its PROVEN retry re-attempt, the PWA asset laws (manifest served + linked + standalone + the 1024 icons; sw.js served), and the fixtu…
  - procedure: LOCAL-ONLY (the WFX-057 production-start procedure, recorded in apps/web/DEPLOYMENT.md 'How to verify install'): build the production bundle (bun run build in apps/web), boot it in service mode (WFX_API_BASE=<a reachable Experience API base> bun run start), and drive the production surfaces in a real browser — manifest 200 application/manifest+json, sw.js 200 no-store, the SW registered → activate…
