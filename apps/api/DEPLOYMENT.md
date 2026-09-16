# @wfx/app-api — DEPLOYMENT (written by WFX-055A for WFX-055B to execute mechanically)

The Experience API service: a Next.js App Router application with ONLY
route handlers (no pages), all `force-dynamic`, Node.js runtime. It boots
the shared WebFlix runtime over REAL ports (Neon persistence via the 052
`bootPersistence`, the app-level fan-out connector, the transactional
outbox event sink) and answers the frozen transport contract
(`apps/web/src/host/remote-ports.ts`) over HTTP.

## 1. Vercel project settings (create — none of this exists yet)

| Setting | Value |
| --- | --- |
| Name | `webflix-api` |
| Link | git — org `payswapdotorg`, repo `webflix` (repoId `1367978616`) |
| Root directory | `apps/api` |
| Framework preset | Next.js |
| Install command | `bun install` (default detection is fine) |
| Build command | `next build` (standard) |
| Production branch | `main` |

The proven REST patterns (project create `POST /v9/projects` with
`gitRepository`, deployments `POST /v13/deployments` with `gitSource`,
env endpoints) are in `docs/infrastructure/deployment.md` — READ IT FIRST.
Hobby plan: 1 concurrent build — deploy sequentially, never parallel.

## 2. Environment variables (production + preview)

| Variable | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | YES | The Neon POOLED endpoint (the 052-verified database — same value the lead verified against; from the operator secrets env). PgBouncer transaction mode is handled by the 052 client. |
| `APP_ENCRYPTION_KEY` | YES | **Generate FRESH for this service**: `openssl rand -base64 32`. Set it via the Vercel env API. NEVER print beyond the setting call, NEVER commit — the value lives only in the Vercel env store. (It decrypts connector-account envelopes; a fresh key is correct because the service owns no provisioned accounts yet.) |
| `YOUTUBE_API_KEY` / `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | no | **Leave unset** (documented absence): without credentials the youtube secondary source is simply not wired — the fan-out serves the seeded webflix-catalog alone, honestly. The OAuth pair must be provisioned together when it ever is (the boot law enforces this). |
| `CRON_SECRET` | YES (production) | **Generate**: any strong random string (`openssl rand -base64 32`). Required because `/api/relay` refuses to run UNPROTECTED in production (typed 500 when unset — the relay must not drift open). Vercel's cron sends `Authorization: Bearer <CRON_SECRET>` automatically when the env var is set on the project. |
| `WFX_DEV_FIXTURES` | must NOT exist | The service has NO fixture mode — setting it is a typed configuration crime (the boot law). Never set it on this project. |

Missing `DATABASE_URL`/`APP_ENCRYPTION_KEY` = typed `ApiConfigError` on
every request (HTTP 500 with the variable NAMES in the detail) — that is
the intended loud failure, not a bug.

## 3. Deploy + verify (execute in order, capture REAL outputs)

1. Production deployment from main: `POST /v13/deployments` with
   `gitSource {type:github, org:payswapdotorg, repo:webflix,
   repoId:1367978616, ref:"main"}`, `target:"production"`. Wait READY.
2. `GET <service-url>/api/health` → expect `200
   {"ok":true,"service":"webflix-api","version":"0.1.0"}` (approx — the
   056 health-verification convention).
3. `GET <service-url>/experience/search?query=rain` with header
   `x-wfx-user-id: wfx-anonymous` → `200` JSON array with seeded
   rain-ambience hits (the catalog seed converges on first boot — see §5).
4. `GET <service-url>/experience/metadata?ref=5SRgdyUsuAg` (a seeded id)
   → `200` `SourceItem` (title: "1,000 Years Of English Monarchy In 4
   Hours").
5. `GET <service-url>/experience/resolve?ref=5SRgdyUsuAg` → `200`
   realization array containing
   `https://www.youtube.com/embed/5SRgdyUsuAg`.
6. `POST <service-url>/experience/events` with header
   `x-wfx-user-id: wfx-anonymous`, body a valid `EntertainmentEvent`
   (e.g. `{"userId":"wfx-anonymous","itemId":"wfxitm_01M2KR6R00FWTHERRN5SC1FKGH","type":"start","occurredAt":"2026-09-16T12:00:00.000Z","sessionId":"wfxpses_00000000000000000000000009"}`)
   → `200 {"ok":true}` — durable the moment it answers (transactional
   outbox).
7. `GET <service-url>/experience/library` with the same user header →
   `200` array (empty for a fresh anonymous user — honest).
8. Cold starts: Neon's 5-minute idle sleep means the FIRST request after
   idle may take 1-3s (the 052 classify layer retries once, bounded).
   Note honestly if observed.
9. `GET <service-url>/api/relay` with `Authorization: Bearer <CRON_SECRET>`
   → `200 {"ok":true,"requeued":N,"claimed":N,"delivered":N,...}` — the
   outbox drain + watch-history fold works (the event from step 6 lands
   in `watch_history`). WITHOUT the header → `401`. (_unset in production
   → 500 — see §2.)

## 4. ACTIVATION of the web host (the payoff — after the service is verified)

1. Set `WFX_API_BASE=<service production url>` on the WEB project
   (`webflix`, `prj_Ylm0ROs2ZxwxxHWCMAroSPH8HWp5`) — production + preview
   env. The web host's boot law requires exactly this variable to leave
   its honest interim state (home currently answers a typed 500 without
   it — by design).
2. Env changes need a fresh deployment (push-to-main auto-deploy only
   fires on push): create a new production deployment of the web app
   from main via `POST /v13/deployments` `gitSource ref:"main"`,
   `target:"production"`. Wait READY.
3. END-TO-END PROOF (capture real outputs):
   - `GET https://webflix-steel.vercel.app/` → **200 with rendered
     content rows** (the home boots in service mode and the fan-out
     serves the seeded catalog);
   - `/search?q=rain` → seeded results;
   - a watch/player surface → the real YouTube embed realization;
   - `GET https://webflix-steel.vercel.app/api/health` → still 200;
   - the shorts surface answers (24 seeded verticals);
   - with `WFX_API_BASE` set, the PWA install surfaces activate too (the
     service worker registers on any service-mode boot — see
     apps/web/DEPLOYMENT.md's installable-surfaces section).

## 5. The catalog seed (provenance + the convergence mechanism)

The `webflix-catalog` source's content is a CURATED SEED of 57 REAL,
PUBLICLY EMBEDDABLE YouTube videos (24 short-form verticals + 33
long-form horizontals across 5 topics), owned by this app
(`src/host/seed.ts`) — NOT a shared migration and NOT YouTube-API-sourced.
Every id was verified via YouTube's public oEmbed endpoint (HTTP 200 +
embed HTML + verbatim title/channel match; embed URL 200) — re-verified
2026-09-16 09:37 UTC, 57/57 pass; per-row evidence lives in the lead's
station (`seed-verify/reverify_0007_results.json`).

**Convergence mechanism**: `seedCatalogIfEmpty` runs at every service
boot — a fresh database (production Neon on first deploy, any future
environment) receives the 57 rows exactly once; an environment with any
existing items is NEVER overwritten (seed, not sync); concurrent cold
starts racing the emptiness check both succeed (`ON CONFLICT DO
NOTHING`). The persistence package's migration baseline (0001..0006) is
untouched — the seed is app-owned data by design (the decision record is
in `src/host/seed.ts`'s module doc).

## 6. Relay / cron reality (hobby plan)

- `apps/api/vercel.json` schedules `GET /api/relay` once per day at
  03:00 UTC — the Vercel Hobby plan allows DAILY crons only. That cron
  is the guaranteed delivery floor for the transactional outbox.
- Everything finer is the opportunistic lane: the events endpoint nudges
  a bounded best-effort drain (after 10 enqueued events, at most once
  per 60s per instance, ≤20 rows per claim, in-flight guarded) — honest
  best-effort on serverless; never a tight loop; at-least-once, never
  lost, never fabricated.
- The relay's downstream today: watch-state events fold into the
  `watch_history` projection (delivery-order-safe: position is a
  high-water mark, completed is monotone); non-watch event types are an
  honest documented no-op (the outbox remains their system of record).

## 7. Rollback

- Service bad → the web host degrades HONESTLY: unset `WFX_API_BASE` (or
  point it at the previous good deployment's URL) + redeploy web — the
  home returns to its typed interim state (never fabricated content).
- The service itself: redeploy from a previous main commit via
  `POST /v13` gitSource with the older ref (the 056 runbook's verified
  pattern).
- The seed is idempotent and never overwrites — rolling back the service
  never touches catalog data.

## 8. Honest limitations (what this deployment does NOT do)

- Identity is still the 050 anonymous constant (`wfx-anonymous`) —
  headers are trusted as-sent; real auth is future work.
- The youtube secondary source is dormant until the operator provisions
  `YOUTUBE_*` (documented absence, honest degradation).
- The OAuth host wiring (token rotation) is future work; the in-memory
  per-instance credential source is the documented stopgap.
- Non-watch events have no projection consumer yet (honest no-op
  delivery; the outbox is the record).
