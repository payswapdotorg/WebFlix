# WebFlix Web Host — Deployment Guide (WFX-050; WFX-051 experience shell; WFX-057 installable surfaces)

**Status:** canonical deployment contract for `apps/web` (the Next.js web host), written for WFX-056 (Vercel deployment lane). The app is a standard Next.js App Router application — no custom bundler plugins, no exotic output. Everything below is exact.

## What this app is (and is not)

- **Is:** the production Next.js host that boots the frozen shared client runtime (`@wfx/experience` + `@wfx/domain` through `src/shared/` → `bootWebClient`) and renders the WFX-051 experience shell: the persistent app chrome + home (hero/continue/rows), search, the long-form watch browse, the short-form vertical feed, content detail, and the player surface — plus the internal API routes below. All data flows through the 050 boot law (fixtures behind `WFX_DEV_FIXTURES=1` dev-only; the `WFX_API_BASE` remote ports in service mode).
- **Is not:** the Experience API service, the persistence layer, or the sources backend. This host **consumes** `WFX_API_BASE` (split-runtime service consumption); it contains **no SQL, no database driver, no provider SDK**. Those belong to the service lanes (WFX-052/054) and their packages — never to this dependency closure.

## Route inventory (what WFX-056 deploys)

Pages (every page `force-dynamic` server components except where noted; every page renders inside the persistent `AppShell` chrome except `/offline`, which is deliberately self-contained — see "Installable surfaces"):

| Route | Surface | Notes |
|---|---|---|
| `/` | Home | Hero (resume-or-start) + continue-watching + For you / Trending rows + shorts rail. |
| `/watch` | Long-form browse (WFX-027 mode) | Continue row first, then composed browse rows. |
| `/shorts` | Short feed (WFX-028 mode) | Server-composed boot payload + the client vertical stack island. |
| `/search` | Search | `?q=<query>` → both surfaces browsed (watch first) → results grid. |
| `/item` | Content detail | `?connector=&ref=&title=` → connector metadata + capabilities + related. |
| `/player` | Player | Starts a REAL playback session; renders the resolved Media Surface mode (embed iframe / visible browser panel / visible external handoff — never fake playback). |
| `/offline` | Offline shell (WFX-057) | **Static** (the one non-dynamic route, by design): the honest offline state + retry. No host boot, no env read, inline critical CSS + inline retry script — renders with zero configuration and zero network. |
| `/_not-found` | Static | Next default. |

Internal API routes (same-origin; the client islands' bridges):

| Route | Method | Purpose | Failure law |
|---|---|---|---|
| `/api/health` | GET | Deployment verification (`{ok,service,version}`). | Deterministic, dependency-free. |
| `/api/actions` | POST | Like/save through the actions use-case; answers the frozen `ActionReceipt` verbatim. | Malformed body → 400; port violation → 502. |
| `/api/events` | POST | Watch-state/engagement reports (progress/complete/skip/share only — a CLOSED vocabulary; `start` and `like`/`save` are use-case-emitted and rejected here with the reason). | Sink rejection → 502 — a lost watch-state event is never a silent success. |
| `/api/shorts` | GET | Fresh projected OS short page for the short feed's re-rank loop. | Load failure → 502. |

Client JS is limited to five small islands (`ShortsFeed`, `ActionButtons`, `WatchStateReporter`, and the WFX-057 PWA islands `InstallPrompt` + `UpdatePrompt`, mounted by `AppShell` in service mode) — everything else is server-rendered; the search box and avatar menu are plain HTML (form + `details`).

## Vercel project settings (for WFX-056)

Import the GitHub repo `payswapdotorg/webflix` and configure:

| Setting | Value |
|---|---|
| Framework Preset | **Next.js** |
| Root Directory | **`apps/web`** |
| Install Command | **`bun install`** (runs at the repo root — Vercel detects `bun.lock`; installs all workspace packages) |
| Build Command | **`bun run build`** (i.e. `next build`, run in `apps/web`) |
| Output Directory | **default** (`.next` — leave untouched) |
| Node.js / Runtime | Vercel's default (the app uses only web-standard APIs + `next`) |

⚠️ Project-name note from WFX-053: a pre-existing unrelated Vercel project named **`web`** exists in the team — do not collide with it; name the WebFlix project distinctly (e.g. `webflix-web`).

## Environment variables (names are canonical — see repo `.env.example`)

### Required at RUNTIME (production)

| Name | Value for WFX-056 | Notes |
|---|---|---|
| `WFX_API_BASE` | The base URL of the Experience API (e.g. `https://<experience-api-host>`) | **Required.** The host boots its production ports against this base. If unset (and `WFX_DEV_FIXTURES` unset), every request fails LOUDLY: typed `HostConfigError` naming `WFX_API_BASE` → HTTP 500, detail in server logs (`vercel logs`). It is deliberately NOT defaulted — see "Boot law" below. **[RESOLVED by WFX-055B, 2026-09-16: production + preview now have `WFX_API_BASE=https://webflix-api.vercel.app` (the deployed Experience API service) — the home page serves real content; the typed-500 interim state is retired. Service record: `docs/infrastructure/deployment.md` §9.]** |

### Required NEVER (production)

| Name | Rule |
|---|---|
| `WFX_DEV_FIXTURES` | **Must be unset in production.** The boot law treats it set + `NODE_ENV=production` as a typed configuration error (`HostConfigError`), and Vercel always serves the production build with `NODE_ENV=production`. It is the explicit opt-in for deterministic local fixture content (`1` or `true`) in `next dev` only. |

### NOT consumed by this app (do not add to the web project)

`DATABASE_URL`, `APP_ENCRYPTION_KEY`, `R2_*`, `UPSTASH_*`, `YOUTUBE_*` — these belong to the Experience API service / persistence / sources lanes (WFX-052/054/055). Adding them to the web project would widen the web host's secret surface for no benefit. (Vercel env vars are project-scoped; the web project needs only the two rows above.)

### R25 realtime translation bridge (the WebSocket lane — 2026-09-22)

The R25 realtime translation lane ships a **dev-boot prototype bridge** plus the honest production gap:

| Name | Value | Notes |
|---|---|---|
| `WFX_DEV_FIXTURES=1` | (dev only) | The documented dev boot starts the WebFlix realtime bridge (`ws`, port **3102**) + the deterministic dev provider double (**3103**) inside the dev process (the `src/instrumentation.ts` hook — Next's server-boot seam). The browser talks ONLY to the bridge; the provider endpoint never appears in the client. |
| `WFX_REALTIME_BRIDGE=1` | optional | Starts the bridge WITHOUT the dev provider double (the honest typed `no-realtime-provider-registered` gap until the Model-Fabric-registered adapter binds the seam — the lead's integration step). |
| `WFX_REALTIME_BRIDGE_PORT` / `WFX_DEV_REALTIME_PROVIDER_PORT` | `3102` / `3103` | Port overrides for parallel local runs. |

**Production truth (honest):** the default production/serverless boot starts NO bridge — the realtime surfaces render the typed `bridge-unavailable` state (never a claimed capability). The production WebSocket transport (a Vercel WebSocket-capable function holding the same provider session seam) is the lead's R25 deployment verification lane; when it lands, the same `ws`-based bridge module (`src/host/realtime/realtime-bridge.ts` — pure `node:http` + `ws`, no native deps) binds behind it. The bridge persists only continuity + telemetry state (never raw media) and has no capability over playback by construction.

## Build behavior (verified)

`next build` completes cleanly **without any environment variables**: the home route is `force-dynamic` (its content depends on the environment and the configured service's answer at request time), so nothing env-dependent is evaluated during the build. Health is a static deterministic route. A production deployment then either has `WFX_API_BASE` (works) or fails loudly per request (visible, typed) — there is no third, silent-fixture outcome.

## Boot law (the WFX-050 contract)

All boot paths (`src/host/boot.ts`, and `src/main.ts` when ports are omitted) funnel through one selection law (`src/host/config.ts`):

1. `WFX_DEV_FIXTURES=1` (or `true`) and `NODE_ENV ≠ production` → deterministic fixture ports (dev content).
2. `WFX_DEV_FIXTURES` unset → real service ports: HTTP against `WFX_API_BASE`.
3. Anything else → **`HostConfigError`** naming the offending variables. Never a silent fixture fallback.

Machine-tested in `apps/web/tests/host-boot.test.ts`: production boot without `WFX_API_BASE` → typed loud error naming the variable; the fixture path is impossible without the explicit flag (including via `bootWebClient()` with omitted ports).

## The `WFX_API_BASE` transport contract

The service side (a later productionization lane) must implement the mapping the web host's remote ports (`src/host/remote-ports.ts`) consume. Identity travels as request headers — never in URLs:

| Ports call | HTTP | Body / query | Headers |
|---|---|---|---|
| `connector.search` | `GET {base}/experience/search` | `?query=<q>` | identity headers |
| `connector.metadata` | `GET {base}/experience/metadata` | `?ref=<ref>` | identity headers |
| `connector.resolve` | `GET {base}/experience/resolve` | `?ref=<ref>` | identity headers |
| `connector.executeAction` | `POST {base}/experience/actions` | `UserAction` JSON | identity headers |
| `connector.readLibrary` | `GET {base}/experience/library` | — | identity headers |
| `connector.writeLibrary` | `POST {base}/experience/library` | `LibraryCommand` JSON | identity headers |
| `events.emit` | `POST {base}/experience/events` | `EntertainmentEvent` JSON | `x-wfx-user-id`, `x-wfx-session-id` |

Identity headers: `x-wfx-user-id`, `x-wfx-session-id` (where the call carries a session), `x-wfx-locale`, `x-wfx-region`.

Failure semantics (the WFX-003 SDK degrade law, mirrored): read failures (network, non-2xx, malformed JSON/payload) degrade to the empty answer (`[]` / `null`); action failures answer `status: "failed"` receipts with the transport detail; **event delivery failures throw the typed `HostTransportError`** — a lost watch-state event is never a silent success. Requests time out after 10 s (configurable in code) so a hung service cannot pin a serverless handler.

## Health endpoint (deployment verification)

`GET /api/health` → `200` `{"ok":true,"service":"webflix-web","version":"0.1.0"}` — deterministic, dependency-free; proves the web host process is serving. It does not probe `WFX_API_BASE` or any database (those are the service lanes' health surfaces).

## Local development

```bash
# repo root
bun install

# deterministic fixture content (the only way fixtures are reachable):
cd apps/web
WFX_DEV_FIXTURES=1 bun run dev        # http://localhost:3101

# service mode against a running Experience API:
WFX_API_BASE=http://localhost:PORT bun run dev

# production build + serve (needs WFX_API_BASE at request time, else loud 500):
bun run build && WFX_API_BASE=https://host bun run start
```

Tests: `bun test` from the repo root (host boot laws, remote transport with stubbed fetch, and the WFX-051 surface composition suites — home/search/player/shorts/actions — all offline and deterministic).

## Installable surfaces (WFX-057)

WebFlix is an installable PWA: a normal user can install it from the production URL in under a minute, it launches standalone with its own window/icon, and the offline state is honest. What shipped, all inside `apps/web`:

| Piece | File | What it is |
|---|---|---|
| Web app manifest | `public/manifest.webmanifest` | name/short_name "WebFlix", `start_url "/"`, `scope "/"`, `display "standalone"`, `background_color` + `theme_color` `#0b0a10` (both = `--wfx-bg` in `globals.css`; the topbar paints `rgba(11,10,16,0.92)` over exactly that base). Icons: the two lead-provided PNGs declared **1024×1024 `any`/`maskable`** — their TRUE dimensions (IHDR-parsed; `tests/pwa-manifest.test.ts` proves declared == actual). |
| Identity assets | `public/icon-main.png`, `public/icon-maskable.png` | 1024×1024 PNGs (rounded-square mark + wordmark; edge-to-edge maskable). `public/favicon.svg` is the tiny hand-written SVG favicon carrying the same rose-gradient play mark (`--wfx-accent` → `--wfx-accent-strong`). |
| Layout wiring | `src/app/layout.tsx` | `manifest` link (served `application/manifest+json`), SVG favicon, `apple-touch-icon` (icon-main 1024), `appleWebApp` (capable / black status bar / title — Next 16 emits `mobile-web-app-capable` — the modern unprefixed equivalent of `apple-mobile-web-app-capable` — plus `apple-mobile-web-app-title` and `apple-mobile-web-app-status-bar-style`; verified in the served HTML), `viewport.themeColor` (`#0b0a10`), plus a before-interactive script that stashes `beforeinstallprompt` the moment the browser fires it (the event can precede hydration; the island claims the REAL deferred prompt — never a fabricated one). |
| Service worker | `public/sw.js` | Hand-written, zero dependencies. Versioned cache (`wfx-static-v1`; activation deletes every other cache). **Strategy:** same-origin GET **navigations → network-first**, offline fallback = the precached `/offline` shell (never a stale dynamic page — no fake cached feed); `/_next/static/*` → **stale-while-revalidate** (content-hashed; cached on first fetch — hashed names are not statically knowable, nothing is precached that the file cannot name truthfully); **everything else passes through**, and `/api/*` is NEVER intercepted or cached (the honesty law — offline API calls fail visibly). `Cache-Control: no-store` on `/sw.js` via `next.config.ts` headers keeps update checks prompt. |
| Offline route | `src/app/offline/page.tsx` | The honest offline state (StateViews grammar): "You're offline — WebFlix needs a connection to load your feeds. Your watch progress is safe." + a **Try again** button (`location.reload()` — the SW serves this page as a navigation FALLBACK, so the URL bar still shows the original destination and reload re-attempts it). **No host boot, no env read** — machine-tested under a poisoned environment. **Static route by design** (the one non-dynamic route): it is the build-time-known URL the SW precaches at install; a successful online visit to `/offline` refreshes the precached copy. The page carries inline critical CSS + the inline retry script, so it renders styled and retries even with zero network AND zero warm caches. |
| Install affordance | `src/components/shell/InstallPrompt.tsx` (+ `pwa-logic.ts`) | Client island mounted by `AppShell` **in service mode only**. Chrome/Edge desktop + Android: a REAL `beforeinstallprompt` drives a subtle corner card (Install / Not now; 44px `.wfx-btn` targets, `aria-live="polite"` region, keyboard operable). "Not now" is remembered in `localStorage` (storage failures fail open); dismissing the NATIVE prompt hides the offer for the session only. `appinstalled` → brief confirmation, then hidden. **Safari iOS** (never fires the event): the honest "Share → Add to Home Screen" instruction sheet — only when not already standalone (display-mode media queries + `navigator.standalone` + UA hints incl. the iPadOS touch heuristic). **No fake prompts anywhere else** (desktop Safari/Firefox render nothing). |
| Update flow | `src/components/shell/UpdatePrompt.tsx` | Registers `/sw.js` **only in production builds booted in service mode** (`NODE_ENV` guard, inlined at build time — `next dev` never registers; the `enabled` prop is AppShell's service-mode signal, so fixtures never register). When a new worker is WAITING: a non-blocking "Update available — Reload" affordance (role=status, aria-live=polite). Only the user's click posts `WFX_SKIP_WAITING`; only the resulting `controllerchange` reloads — **never a silent reload**. Registration failure is logged and swallowed (the PWA surface is an enhancement). |

### How to verify install (per platform)

- **Chrome / Edge / Brave, desktop:** visit the production URL → the install card appears (bottom-right) after the SW registers → click **Install** → confirm the browser's install dialog → WebFlix opens in its own window with its own taskbar/dock icon. (The omnibox install icon is the browser's own equivalent affordance.)
- **Chrome, Android:** visit → the install card appears → **Install** → "Add to home screen?" confirm → launches standalone full-screen with the maskable icon.
- **Safari, iOS:** visit → the instruction sheet appears (Share → Add to Home Screen) → after adding, the icon (icon-main) appears on the home screen and the app launches standalone with a black status bar.
- **Offline honesty:** install, then go offline (devtools or airplane mode) and navigate → the honest `/offline` state renders with **Try again**; API-backed interactions fail visibly — no cached-feed lies. Back online → **Try again** reloads the original destination.
- **Update flow:** deploy a new build → on the next navigation the browser detects the new `sw.js` (no-store) → the new worker installs and waits → "Update available — Reload" appears → click → the new version activates and the page reloads once.

### Honest limits

- **iOS constraints:** no `beforeinstallprompt` (hence the instruction sheet), no install-eligibility signal, maskable icon support is partial (iOS uses `apple-touch-icon`), and iOS standalone apps get no browser UI — the SW update flow works but background update checks are tied to Safari's own scheduling.
- **NO push notifications** — deliberately out of scope. Push needs VAPID keys + a service-worker push subscription + a push service lane; do not bolt it onto this SW.
- **SW vs dynamic pages tradeoff:** the SW deliberately does NOT cache dynamic page responses — offline can only ever show the honest offline shell, never a stale personalized feed. The flip side: first-visit-then-offline shows the offline page (correct), and the app's hashed static assets (CSS/JS) are only in the cache after they have been fetched once under SW control — the `/offline` page is immune to this (inline critical CSS + inline script), while other pages offline correctly yield to the offline fallback.
- **Local verification gap:** SW registration is production-build-only by law, so the full install UX (beforeinstallprompt) cannot be exercised in `next dev`. It was verified against a production `next start` locally in a REAL browser (WFX-057 delivery): manifest 200 `application/manifest+json`, both icons 200 `image/png` at true 1024×1024, `sw.js` 200 with `Cache-Control: no-store`, the capture script in the built HTML, the SW registered → activated → controlling (`clients.claim`), Chrome fired a REAL `BeforeInstallPromptEvent` (proving the installability criteria were met) and the offer/dismissal-memory/install-click path ran, the offline fallback was exercised by stopping the server (connection refused → SW serves `/offline` at the original URL; **Try again** recovers when the server returns), and the update flow by bumping `CACHE_VERSION` (waiting worker → "Update available — Reload" → one reload, old cache deleted). NOT exercised headlessly: completing Chrome's native install dialog and `appinstalled` (need a real desktop session), and iOS Safari Add to Home Screen. The final production install check on https://webflix-steel.vercel.app belongs to the lead after WFX-055 activates the home page (until then every booted page is the honest typed-error state with no `AppShell`, so the SW does not register — the install surfaces activate the moment a page boots in service mode; no rebuild needed).
