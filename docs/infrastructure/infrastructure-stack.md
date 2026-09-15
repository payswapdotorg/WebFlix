# WFX-053 — Free-tier Infrastructure Stack

**Status:** provisioned and verified 2026-09-15 by Worker C (WFX-053).
**Scope:** the minimum useful production stack for WebFlix on free-tier resources. This document records WHAT exists, WHERE, and WHAT each resource is for. Verified limits live in [free-tier-limits.md](./free-tier-limits.md); behavior at those limits lives in [degradation-behavior.md](./degradation-behavior.md); every environment-variable name lives in [environment-inventory.md](./environment-inventory.md).

**Secret discipline:** credential VALUES exist only in the operator secrets store (`/home/z/.secrets/env` and `/home/z/.secrets/wfx-infra.json`, both mode 600, outside this repository). This repository contains NAMES and documentation only. No connection string, password, or API key appears in this repo.

## Stack overview

| Layer | Provider | Resource | Region | Provisioned |
|---|---|---|---|---|
| Primary datastore | Neon (PostgreSQL) | org `webflix` → project `webflix` → database `webflix` | `aws-us-east-1` | 2026-09-15 |
| Object storage | Cloudflare R2 | bucket `webflix-media` | `auto` (account default) | 2026-09-15 |
| Cache (optional) | Upstash Redis | **not provisioned** — contract only | n/a | — |
| Web host | Vercel | team `team_4KOoA5CgtYaOF85yFXPeMXLt` → project **`webflix`** (WFX-056 — see §5) | default `iad1` (us-east) | 2026-09-15 |

Region coherence: Neon `aws-us-east-1` and Vercel's default `iad1` region are both US-East, minimizing app↔database latency when the WFX-056 deployment lands.

## 1. Neon PostgreSQL (primary datastore)

### Provisioned resources

| Field | Value |
|---|---|
| Organization | `org-proud-truth-25823860` — name `webflix`, plan `free` (subscription `free_v3`) |
| Pre-existing personal org (not used by WebFlix) | `org-shy-shadow-21570034` — name `Tetevi`, plan `free` |
| Project | `sparkling-forest-44052051` — name `webflix` |
| Region | `aws-us-east-1` (platform `aws`, proxy host `c-10.us-east-1.aws.neon.tech`) |
| PostgreSQL version | 18 (verified server: `PostgreSQL 18.6`) |
| Default branch | `br-misty-salad-auoc67q9` (`main`, protected root branch) |
| Compute endpoint | `ep-dry-heart-auf7zz14` — read-write, 0.25 CU fixed (autoscaling bounds 0.25–0.25 CU) |
| Database | `webflix` (id 677224), owner role `neondb_owner` |
| Direct host | `ep-dry-heart-auf7zz14.c-10.us-east-1.aws.neon.tech` |
| Pooled host (PgBouncer, transaction mode) | `ep-dry-heart-auf7zz14-pooler.c-10.us-east-1.aws.neon.tech` |

Connection strings (pooled and direct, `sslmode=require`, database `webflix`) are recorded in the operator secrets store and exported as `DATABASE_URL` (pooled — the recommended production default) plus `NEON_ORG_ID` / `NEON_PROJECT_ID` for operations.

### Live verification evidence (2026-09-15)

- Pooled connection: `select current_database(), current_user, version()` → `webflix` / `neondb_owner` / `PostgreSQL 18.6`, smoke query `select 1` → ok.
- Direct connection: same checks → identical results.
- Scale-to-zero is active on the Free plan (compute suspends after ~5 min idle; first connection after idle pays a cold-start). Both probes above succeeded across cold starts.

### How the org was discovered (audit trail)

The Neon v2 API now requires `org_id` for project operations, but `GET /api/v2/organizations` is method-disallowed (405) and the account's API key does not expose the org id directly. Resolution path, for the record:

1. `GET /api/v2/users/me` → 200: user id `df81bf35-7fd3-4add-afb9-739262f51f2f` — probing that id as `org_id` returns `not an organization member` (it is the USER id, not an org id).
2. `GET /api/v2/users/me/organizations` (endpoint name recovered from the Neon console's shipped JavaScript bundle) → 200: full org list, revealing the pre-existing personal org and confirming the user is `admin` of it.
3. A dedicated `webflix` organization was then created via `POST /api/v2/organizations` (requires console `Referer`/`Origin` headers for CSRF and the valid `subscription_type` value). The valid value is **`free_v3`** — discovered from the console bundle's plan-type tables (`free_v2`, `free_v3`, `launch`, `launch_v3`, `scale`); `free_v3` → HTTP 201. (Values `free`, `direct`, `free_v2` are rejected; `launch`/`scale` return Stripe checkout sessions, i.e. paid flows.)
4. `GET /api/v2/organizations/org-proud-truth-25823860/billing/account` → 200: `subscription_type: "free_v3"`, `plan_details: {name: "free", version 3.2}`, state `active`, no payment method. This is the account-of-record for WebFlix.

### What this resource is for

`DATABASE_URL` is the single Postgres endpoint for WFX-052 (persistence + auth): schema migrations, application tables, and credential storage. The pooled endpoint is the runtime default (serverless-friendly: one compute, many short-lived connections via PgBouncer transaction pooling). The direct endpoint is reserved for migrations/DDL sessions that need a dedicated connection.

## 2. Cloudflare R2 (object storage)

### Provisioned resources

| Field | Value |
|---|---|
| Account | `7e333607c4ceeef5d092be1bb94108bf` (standard account; shared with other projects — WebFlix is isolated by bucket name) |
| Bucket | `webflix-media` |
| S3 API endpoint | `https://7e333607c4ceeef5d092be1bb94108bf.r2.cloudflarestorage.com` (account-level; bucket path `/webflix-media`) |
| Region | `auto` |
| Auth | SigV4 with `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (token-scoped S3 keys) |
| Public access | NOT enabled (no `r2.dev` managed domain). Applications access objects via presigned URLs minted with the S3 keys — no public bucket exposure. |

### Verification evidence (2026-09-15)

- Create: `PUT /webflix-media` (SigV4, aws4fetch) → HTTP 200; then `HEAD /webflix-media` → 200.
- Cross-check from the management plane: `GET api.cloudflare.com/client/v4/accounts/{id}/r2/buckets` lists `webflix-media` with `creation_date 2026-09-15T08:05:21.391Z`.
- Round-trip: `PUT wfx-053/provisioning-test.txt` → 200, `etag "86c2d746207cb2970918bab29a1d3c99"`; `GET` → 200, byte-for-byte content match; `DELETE` → 204; `GET` after delete → 404. The bucket is empty again (test object removed).

### What this resource is for

Media and user-content object storage for the productionization track: anything that must not live in Postgres and must not be served through Vercel's billable bandwidth — cached media artifacts, exported files, large telemetry blobs. R2 egress to the internet is free (see limits doc), which is why media serving routes through R2 rather than the web host.

## 3. Upstash Redis (optional cache) — NOT provisioned

Status: **optional resource, intentionally unprovisioned**. The provided `UPSTASH_REDIS_REST_TOKEN` is a 36-character UUID — the per-database password format — not a management-API key; the management API (`api.upstash.com`) is inaccessible with it, and the per-database REST endpoint URL is unknown. Provisioning requires an operator with console access to either provide the REST endpoint URL + token pair for an existing database or create a management key.

The application-side contract (wave 2/3) is defined in [degradation-behavior.md](./degradation-behavior.md): Redis is optional; when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are absent the app runs an in-memory fallback with typed degraded logging. No fake cache hits, no silent Redis assumption.

## 4. Vercel (web host) — verified, project NOT created

| Field | Value |
|---|---|
| Team | `team_4KOoA5CgtYaOF85yFXPeMXLt` (`ekonplacidegmailcom's projects`) |
| Plan | **hobby** — verified via `GET /v2/teams/{team}` → `billing.plan: "hobby"`, status active; `GET /v2/user` → `limited: true` |
| WebFlix project | **Not created — deliberately.** Project creation is WFX-056 (next wave), after the production web host (WFX-050) lands. |
| Existing projects | 20 (unrelated repos: `adcos`, `mos-product`, `payswap3`, `replay2`, …). None named `webflix`. ⚠️ A project named `web` already exists on this team (different repo) — WFX-056 must avoid that name collision when importing WebFlix's `apps/web`. |

`VERCEL_TOKEN` is deployment-tooling-only and must never be an app runtime variable (see environment inventory).

## 5. Vercel project `webflix` (added by WFX-056, 2026-09-15)

The web host project was created and the production deployment is live. Full record — project ids, build settings, production/preview URLs, environment-variable decisions, rollback runbook, CI/CD wiring, and Git-integration status — lives in [deployment.md](./deployment.md). Summary:

| Field | Value |
|---|---|
| Project | `webflix` — `prj_Ylm0ROs2ZxwxxHWCMAroSPH8HWp5` (team `team_4KOoA5CgtYaOF85yFXPeMXLt`, hobby, region `iad1`) |
| Git link | `github.com/payswapdotorg/webflix` (repo id `1367978616`), production branch `main`; ref deployments work via API/CLI, auto-deploy on push awaits the Vercel GitHub App (see deployment.md §7) |
| Production deployment | `dpl_ErDZyEfQADkDUzdbHct4QbNtqrXa` from `main` @ `7bd3136` — READY; **https://webflix-steel.vercel.app** (`/api/health` → `200 {"ok":true,...}`; home page in its documented typed-error interim state until the Experience API service lane lands) |
| Env vars | none set (least privilege — see deployment.md §3 for every decision) |
| CI | `.github/workflows/ci.yml` — the six gates (lint, typecheck, test, contract-check, lane-check, apps/web build) on every push/PR to `main` |

## Operations notes

- The operator secrets file `/home/z/.secrets/wfx-infra.json` (mode 600) is the machine-readable source of truth for all ids above; `/home/z/.secrets/env` exports `DATABASE_URL`, `NEON_ORG_ID`, `NEON_PROJECT_ID`, and the R2 credentials.
- Neon usage baseline at provisioning: consumption period `2026-09-15 → 2026-10-01`, all counters zero.
- Deleting/recreating resources: the Neon project can be re-created via `POST /api/v2/projects` (org-scoped); the R2 bucket via SigV4 `PUT`. The org must not be deleted without lead approval — it is the billing boundary.
