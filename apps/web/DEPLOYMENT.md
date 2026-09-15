# WebFlix Web Host — Deployment Guide (WFX-050; WFX-051 experience shell)

**Status:** canonical deployment contract for `apps/web` (the Next.js web host), written for WFX-056 (Vercel deployment lane). The app is a standard Next.js App Router application — no custom bundler plugins, no exotic output. Everything below is exact.

## What this app is (and is not)

- **Is:** the production Next.js host that boots the frozen shared client runtime (`@wfx/experience` + `@wfx/domain` through `src/shared/` → `bootWebClient`) and renders the WFX-051 experience shell: the persistent app chrome + home (hero/continue/rows), search, the long-form watch browse, the short-form vertical feed, content detail, and the player surface — plus the internal API routes below. All data flows through the 050 boot law (fixtures behind `WFX_DEV_FIXTURES=1` dev-only; the `WFX_API_BASE` remote ports in service mode).
- **Is not:** the Experience API service, the persistence layer, or the sources backend. This host **consumes** `WFX_API_BASE` (split-runtime service consumption); it contains **no SQL, no database driver, no provider SDK**. Those belong to the service lanes (WFX-052/054) and their packages — never to this dependency closure.

## Route inventory (what WFX-056 deploys)

Pages (all `force-dynamic` server components except where noted; every page renders inside the persistent `AppShell` chrome):

| Route | Surface | Notes |
|---|---|---|
| `/` | Home | Hero (resume-or-start) + continue-watching + For you / Trending rows + shorts rail. |
| `/watch` | Long-form browse (WFX-027 mode) | Continue row first, then composed browse rows. |
| `/shorts` | Short feed (WFX-028 mode) | Server-composed boot payload + the client vertical stack island. |
| `/search` | Search | `?q=<query>` → both surfaces browsed (watch first) → results grid. |
| `/item` | Content detail | `?connector=&ref=&title=` → connector metadata + capabilities + related. |
| `/player` | Player | Starts a REAL playback session; renders the resolved Media Surface mode (embed iframe / visible browser panel / visible external handoff — never fake playback). |
| `/_not-found` | Static | Next default. |

Internal API routes (same-origin; the client islands' bridges):

| Route | Method | Purpose | Failure law |
|---|---|---|---|
| `/api/health` | GET | Deployment verification (`{ok,service,version}`). | Deterministic, dependency-free. |
| `/api/actions` | POST | Like/save through the actions use-case; answers the frozen `ActionReceipt` verbatim. | Malformed body → 400; port violation → 502. |
| `/api/events` | POST | Watch-state/engagement reports (progress/complete/skip/share only — a CLOSED vocabulary; `start` and `like`/`save` are use-case-emitted and rejected here with the reason). | Sink rejection → 502 — a lost watch-state event is never a silent success. |
| `/api/shorts` | GET | Fresh projected OS short page for the short feed's re-rank loop. | Load failure → 502. |

Client JS is limited to three small islands (`ShortsFeed`, `ActionButtons`, `WatchStateReporter`) — everything else is server-rendered; the search box and avatar menu are plain HTML (form + `details`).

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
| `WFX_API_BASE` | The base URL of the Experience API (e.g. `https://<experience-api-host>`) | **Required.** The host boots its production ports against this base. If unset (and `WFX_DEV_FIXTURES` unset), every request fails LOUDLY: typed `HostConfigError` naming `WFX_API_BASE` → HTTP 500, detail in server logs (`vercel logs`). It is deliberately NOT defaulted — see "Boot law" below. |

### Required NEVER (production)

| Name | Rule |
|---|---|
| `WFX_DEV_FIXTURES` | **Must be unset in production.** The boot law treats it set + `NODE_ENV=production` as a typed configuration error (`HostConfigError`), and Vercel always serves the production build with `NODE_ENV=production`. It is the explicit opt-in for deterministic local fixture content (`1` or `true`) in `next dev` only. |

### NOT consumed by this app (do not add to the web project)

`DATABASE_URL`, `APP_ENCRYPTION_KEY`, `R2_*`, `UPSTASH_*`, `YOUTUBE_*` — these belong to the Experience API service / persistence / sources lanes (WFX-052/054/055). Adding them to the web project would widen the web host's secret surface for no benefit. (Vercel env vars are project-scoped; the web project needs only the two rows above.)

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
