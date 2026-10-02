# WFX-DEPLOY-W3 — the production-start PWA verification (the WFX-057 local procedure, executed)

Date: 2026-10-02 (UTC) · Executor: WFX-DEPLOY-W3 (the browser-regression/release-surface lane)
Boot: `bun run build` (clean, route table below) → `WFX_API_BASE=https://webflix-api.vercel.app PORT=3123 bun run start`
(the production bundle booted in SERVICE MODE against the LIVE deployed Experience API — the real
deployment configuration, not the fixtures boot) · Browser: agent-browser (Chromium) session `w3-pwa-verify`.

## The build (route table, verbatim from `bun run build`)

`○ /offline` — the ONE static route (every page route `ƒ` dynamic — the documented law held in the
build output; the full table is in the lane's build log excerpt below).

```
├ ƒ /channel/andle]
├ ƒ /feed/subscriptions
├ ƒ /item
├ ƒ /library
├ ƒ /live
├ ○ /offline
├ ƒ /player
├ ƒ /search
├ ƒ /settings
├ ƒ /shorts
├ ƒ /studio
├ ƒ /studio/analytics
├ ƒ /studio/comments
├ ƒ /studio/customization
├ ƒ /studio/video
└ ƒ /watch
```

## 1. Service-mode boot — VERIFIED-REPRODUCED

- `GET /api/health` → `200 {"ok":true,"service":"webflix-web","version":"0.1.0"}` (identical to
  the fixtures-boot answer and to the deployed production's answer — deterministic, dependency-free).
- `GET /` → `200`, 791,532 bytes, REAL content rows (the live API's seeded catalog), the
  **"live service"** mode badge present (service mode — no fixtures).

## 2. Service-worker registration — VERIFIED-REPRODUCED (the production-only law)

`navigator.serviceWorker.getRegistrations()` after the first navigation:

```json
{
  "controller": true,
  "count": 1,
  "scope": "http://localhost:3123/",
  "script": "http://localhost:3123/sw.js",
  "state": "activated"
}
```

One registration, scope `/`, script `/sw.js`, **activated**, **controlling the page** — the
UpdatePrompt island's registration law (production build + service mode only) reproduced live.
(The fixtures boot answers ZERO registrations — asserted by journey J49 in the same lane.)

## 3. The install affordance in service mode — VERIFIED-REPRODUCED

The rail mounts the InstallPrompt island (service-mode-only mounting — J49 asserts its ABSENCE in
the fixtures boot): the quiet-first disclosure `button "Install app"` + `button "Not now — stop
offering the install"` render in the interactive snapshot (screenshot: `pwa-prod-installed.png`).
The NATIVE `beforeinstallprompt` event does not fire in this headless Chromium (the documented
headless gap — WFX-057 recorded the same limit); completing Chrome's native install dialog and
`appinstalled` need a real desktop session (the lead's production check).

## 4. The offline fallback — VERIFIED-REPRODUCED (stale-feed is NOT offline)

With the server STOPPED (connection refused confirmed), navigating to `http://localhost:3123/shorts`:

- the URL bar STILL SHOWS `/shorts` (the SW serves the precached offline shell as the navigation
  FALLBACK at the original destination);
- the rendered page is the honest offline state, verbatim:

```
WebFlix

You're offline

WebFlix needs a connection to load your feeds. Your watch progress is safe — everything
you watched while online is already recorded.

Try again
```

NO feed content, NO cards, NO rows — the SW never serves a stale cached feed (the honesty law;
journey J49 asserts the same absences on the /offline route in the fixtures boot). Screenshot:
`pwa-offline-fallback.png`.

## 5. The retry recovery — VERIFIED-REPRODUCED

Server restarted (health 200 again) → click **Try again** (`location.reload()` re-attempts the
ORIGINAL destination through the network-first strategy) → `http://localhost:3123/shorts` renders
the live content again ("live service" badge + the real feed). Screenshot: `pwa-offline-recovered.png`.

## Honest limits of this configuration (the exact reasons + procedures)

- **beforeinstallprompt / the native install dialog / `appinstalled`** — not exercisable headless
  (Chromium headless does not fire the install-eligibility event). Procedure: a REAL desktop
  Chrome/Edge session against the deployed production URL (the DEPLOYMENT.md "How to verify
  install" row; the lead's deployed-preview verification).
- **The update flow (waiting worker → "Update available — Reload" → one reload)** — requires a
  CHANGED `sw.js` (a `CACHE_VERSION` bump is a source change in `apps/web/public/sw.js`, outside
  this lane's ownership). Procedure: the WFX-057 delivery verified it against a local production
  start (the DEPLOYMENT.md row documents the steps: bump CACHE_VERSION → waiting worker → the
  UpdatePrompt affordance → the user's click posts WFX_SKIP_WAITING → one reload, old cache
  deleted); re-run the same procedure on any new build.
- **iOS Safari Add to Home Screen** — requires a real iOS device (the documented platform limit).

## Artifact map (this directory)

- `pwa-prod-installed.png` — the service-mode landing: the rail with the install affordance
  (the SW registered + controlling underneath).
- `pwa-offline-fallback.png` — the server-down navigation: the honest offline shell AT the
  original URL (/shorts), no feed content.
- `pwa-offline-recovered.png` — after Try again with the server back: the live feed at /shorts.
- `api-route-probes.txt` — the live fixtures-boot API route-table probe battery (health 200;
  actions malformed→400; events closed-vocabulary 'start'→400 WITH the reason; events valid
  progress→200; shorts 200; offline/manifest/sw.js 200s with the header rows).
