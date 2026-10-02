# WFX-DEPLOY-W3 — the real-platform deployment probes (2026-10-02, live from this environment)

Both production surfaces were REACHABLE from this environment; every row below is a live
observation (OBSERVED / REPRODUCED), not a reconstruction.

## 1. https://webflix-steel.vercel.app — the production web host (STALE, pre-R38-B — a reference, NOT the release target)

| Probe | Result | Verdict |
|---|---|---|
| `GET /api/health` | `HTTP 200` `{"ok":true,"service":"webflix-web","version":"0.1.0"}` (0.94s) | OBSERVED — the frozen contract answers in production |
| `GET /` | `HTTP 200`, 792,170 bytes, `text/html` — real content rows (`data-wfx-row="for-you" / "shorts" / "trending"`), seeded titles present ("1,000 Years Of English Monarchy In 4 Hours") | OBSERVED — the WFX-055B activation still serving real content |
| `GET /search?q=lofi` | `HTTP 200`, 126,662 bytes | OBSERVED |
| `GET /shorts` | `HTTP 200`, 96,912 bytes | OBSERVED |
| `GET /offline` | `HTTP 200`, 17,856 bytes (the offline shell) | OBSERVED |
| `GET /manifest.webmanifest` | `HTTP 200`, `application/manifest+json`, 662 bytes | OBSERVED |
| `GET /sw.js` | `HTTP 200`, `application/javascript`, 6,485 bytes, **`cache-control: no-store`** | OBSERVED — the update-law header live in production |
| `GET /live` | `HTTP 200` (the R37 live surface) | OBSERVED |
| `GET /channel/<handle>` | `HTTP 200` (the R36 channel surface) | OBSERVED |
| `GET /settings`, `/library`, `/feed/subscriptions` | `HTTP 200` | OBSERVED |
| `GET /studio` | **`HTTP 404`** | OBSERVED — **PROOF the deployment predates the R38-B merge** (the studio surfaces exist at main @ fbbef9b but not in this deployment): the mission context's STALE designation is verified, this deployment is NOT the release target |

## 2. https://webflix-api.vercel.app — the live Experience API

| Probe | Result | Verdict |
|---|---|---|
| `GET /api/health` | `HTTP 200` `{"ok":true,"service":"webflix-api","version":"0.1.0"}` (0.31s) | OBSERVED |
| `GET /experience/search?query=rain` (`x-wfx-user-id: wfx-anonymous`) | `HTTP 200`, 5,643 bytes — real catalog hits ("1 HOUR Rainy Day in Airport…", "Best thunder sound for sleep…", "Caught In Heavy Rain Storm!…") | OBSERVED — the live search port answering |
| `GET /experience/library` | `HTTP 200`, 1,074 bytes (the shared anonymous user's stored library) | OBSERVED |

## 3. What the live surfaces were used for in this lane

- The **production-start PWA verification** (`health-offline-pwa/pwa-production-start-verification.md`)
  booted the LOCAL production build in service mode against this live API
  (`WFX_API_BASE=https://webflix-api.vercel.app`) — the SW registration, the offline fallback,
  and the retry recovery were all exercised against the real deployment configuration.
- The steel deployment's answers were cross-checked against the local fixtures-boot and
  production-boot answers for the health contract (all three identical — deterministic).

## 4. What could NOT be exercised from this environment (honest limits)

- **The deployed steel PWA surfaces in a real browser** (SW registration state, install prompt,
  offline fallback on the DEPLOYED origin): this environment's browser automation reaches
  localhost only through the gateway; the deployed origin was exercised over HTTP probes (the
  table above). The lead's deployed-preview verification covers the deployed browser journey.
- **The Experience API's write paths** (actions/events/library writes against production): NOT
  exercised — this lane does not write test data to the production service (the local
  fixtures boot + the unit suites cover the write paths; the WFX-055B record covers the live
  write verification).
