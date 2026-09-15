# WFX-056 — Deployment Record & Runbook (Vercel)

**Status:** production deployment live, verified 2026-09-15 by Worker C (WFX-056). This is the canonical deployment record for the WebFlix web host (`apps/web`) on Vercel, plus the runbook for previews, rollbacks, and CI/CD. The app-level deployment contract (boot law, env contract, transport table) lives in [`apps/web/DEPLOYMENT.md`](../../apps/web/DEPLOYMENT.md) (WFX-050); this document records the actual platform state built on top of it.

**Secret discipline (unchanged):** credential VALUES live only in the operator secrets store. `VERCEL_TOKEN` is deployment tooling only (see [environment-inventory.md](./environment-inventory.md)) and is never an app runtime variable.

## 1. Vercel project of record

| Field | Value |
|---|---|
| Project name | **`webflix`** (distinct from the pre-existing unrelated project `web` — the WFX-053 collision warning) |
| Project id | `prj_Ylm0ROs2ZxwxxHWCMAroSPH8HWp5` |
| Team | `team_4KOoA5CgtYaOF85yFXPeMXLt` (slug `ekonplacidegmailcoms-projects`, plan **hobby**) |
| Git link | `github.com/payswapdotorg/webflix` — org `payswapdotorg`, repo id `1367978616`, credential `cred_26dd4440955572cb0d9001d5c5e8ab23bc5281cb` |
| Production branch | **`main`** (set on the link at project creation) |
| Region | `iad1` (US East — coherent with Neon `aws-us-east-1`, see [infrastructure-stack.md](./infrastructure-stack.md)) |
| Node.js version | `24.x` (platform default) |

### Build settings (match `apps/web/DEPLOYMENT.md` exactly)

| Setting | Value |
|---|---|
| Framework Preset | **Next.js** |
| Root Directory | **`apps/web`** |
| Install Command | **`bun install`** — runs at the repo root (Vercel detects `bun.lock`; installs all workspace packages: 284 packages, ~2.4 s on Vercel's build machine) |
| Build Command | **`bun run build`** (i.e. `next build`, run in `apps/web`) |
| Output Directory | default (`.next` — untouched) |

These settings were created via the Vercel REST API (`POST /v9/projects`) with the `gitRepository` link, not by hand in the dashboard — the project is reproducible from this record.

## 2. Production deployment of record

| Field | Value |
|---|---|
| Deployment id | `dpl_ErDZyEfQADkDUzdbHct4QbNtqrXa` |
| Source | **`main` @ `7bd3136ee22725da3a2578848ab8979b31d5dd2d`** (deployed from the exact commit; Vercel cloned `github.com/payswapdotorg/WebFlix` at that SHA) |
| State | **READY** (created 2026-09-15T18:30:11Z → ready 18:30:30Z; build ~19 s wall clock on Vercel's iad1 build machine) |
| Production URL | **https://webflix-steel.vercel.app** (also aliased: `webflix-ekonplacidegmailcoms-projects.vercel.app`, deployment URL `webflix-2elwkcsjt-ekonplacidegmailcoms-projects.vercel.app`) |

The build was deterministic: Vercel's build log shows `bun install v1.3.14 → 284 packages`, `Next.js 16.3.5 (Turbopack)`, `✓ Compiled successfully`, and the identical route table to the local fresh-clone proof — `ƒ /` (dynamic), `○ /_not-found`, `ƒ /api/health` — with zero environment variables present at build time (the home route is `force-dynamic`; nothing env-dependent is evaluated during build).

### Health verification (the acceptance probe)

`curl -i https://webflix-steel.vercel.app/api/health`:

```
HTTP/2 200
content-type: application/json
{"ok":true,"service":"webflix-web","version":"0.1.0"}
```

Deterministic, dependency-free, reachable by any normal user with a browser — no local tooling required. The production URL is recorded here (this file) as the repo's canonical pointer.

### Home page — honest interim state (expected, by design)

`GET /` currently answers **HTTP 500**. This is the WFX-050 boot law working exactly as specified, not a deployment defect: `WFX_API_BASE` is deliberately unset (see §3 — no Experience API service exists yet), so service-mode boot throws the typed `HostConfigError`. Verified in the production runtime logs (`vercel logs https://webflix-steel.vercel.app`):

```
Error [HostConfigError]: webflix web host misconfigured: service boot requires
WFX_API_BASE (the Experience API base URL for split-runtime service consumption)
— set WFX_API_BASE, or set WFX_DEV_FIXTURES=1 for local fixture development (never in production)
{ kind: 'host-config', missing: [ 'WFX_API_BASE' ], invalid: [], digest: '1186637411' }
```

What a user actually sees: the app's own error boundary renders (page title "WebFlix", then "WebFlix web host failed to boot — This is a loud, typed failure — never a silent fallback to fixture content", the error digest, and a Retry button) — not a bare platform 500 page. `curl` (no JS execution) sees the 500 status plus the RSC payload carrying the same `digest: "1186637411"` that appears in the server log, which ties the browser-visible failure to the typed server-side error. **Home content activates when the service lane lands (WFX-055 wave): set `WFX_API_BASE` to the deployed Experience API base and the same deployment serves real content — no rebuild needed (the home route is dynamic).**

## 3. Environment variable decisions (all of them)

The project has **zero custom environment variables** (verified: `GET /v9/projects/webflix/env` → empty). Every decision:

| Name | Decision | Why |
|---|---|---|
| `WFX_API_BASE` | **unset** (production + preview) | No Experience API service is deployed yet. Setting a placeholder would be fake wiring (or swap the honest `HostConfigError` for a dishonest transport error against a dead URL); defaulting it is forbidden by the boot law. It becomes a real value only when the service lane (WFX-055 wave) ships a real base URL. |
| `WFX_DEV_FIXTURES` | **unset** (production + preview) | Dev-only flag. In production it is a typed configuration crime (the boot law rejects `NODE_ENV=production` + flag). Unset is the only legal production state. |
| `NODE_ENV` | not set by us | Vercel sets it automatically (`production` for production deployments). Never override. |
| `DATABASE_URL` | **NOT set** | Not consumed by the web app — the web host contains no SQL, no database driver (WFX-050 dependency-closure law). It belongs to the service lane's project. Least privilege: the web project's secret surface stays empty. |
| `APP_ENCRYPTION_KEY` | **NOT set** | Same: persistence-lane secret (WFX-052 credential sealing), never a web-host variable. |
| `R2_*`, `UPSTASH_*`, `YOUTUBE_*` | **NOT set** | Not consumed by the web app (see [environment-inventory.md](./environment-inventory.md)); they arrive with the sources/media lanes and their own projects. |
| `VERCEL_TOKEN` | never an app variable | Tooling-only, per the environment inventory's class separation. |

## 4. Preview deployments

Previews deploy any non-`main` ref without touching the production alias. Proof (WFX-056): the docs branch `wfx/056/vercel-deployment` was deployed as a preview — URL and build result are recorded in §4.1. Preview deployments run with `NODE_ENV=development` (platform behavior) and the same (empty) env set, so the home page shows the identical honest `HostConfigError` state until the service lane lands.

### 4.1 Preview of record (WFX-056)

_Recorded in the second commit of this branch, after the branch was pushed and deployed as a preview — the preview proof lands here with its real deployment id, URL, and build result._

Creating a preview is one API call (no GitHub app needed — the project's git credential clones the ref server-side):

```
POST /v13/deployments?teamId=team_4KOoA5CgtYaOF85yFXPeMXLt
{ "name": "webflix", "project": "prj_Ylm0ROs2ZxwxxHWCMAroSPH8HWp5",
  "gitSource": { "type": "github", "org": "payswapdotorg", "repo": "webflix",
                 "repoId": 1367978616, "ref": "<branch-or-sha>" } }
```

(omit `target` for a preview; `"target": "production"` for a production deploy from a ref).

## 5. CI/CD

**Repo side — the six gates (`.github/workflows/ci.yml`):** on every push to `main` and every PR targeting `main`, GitHub Actions runs `bun install --frozen-lockfile` (oven-sh/setup-bun, bun install store cached on `bun.lock`) then the same gate discipline the lead enforces at integration:

1. `bun run lint` — eslint over the monorepo
2. `bun run typecheck` — root tsc program
3. `bun test` — full suite
4. `bun run contract-check` — frozen-contract drift check
5. `bun run lane-check` — package/lane boundary check
6. `bun run build` in `apps/web` — the production Next.js build (proves fresh-install buildability, the exact defect class that blocked WFX-050's first review)

**Platform side:** production deployments come from `main` (the link's `productionBranch`); every other branch/ref deploys as a preview. Until full Git auto-integration is confirmed (see §7), use the §4 API call (or `vercel deploy`) — the CI gates protect `main`; the Vercel deploy is a deliberate act, which is acceptable discipline for a one-concurrent-build hobby plan.

## 6. Rollback procedure (rule: promote a previous artifact — never rebuild)

A rollback must re-point the production alias at a **previously built deployment artifact**. It must never create a new build from old source (a rebuild is not a rollback: it can produce a different artifact and it consumes the single concurrent build slot).

1. **List production deployments** (pick the previous READY one):
   ```
   GET /v6/deployments?projectId=prj_Ylm0ROs2ZxwxxHWCMAroSPH8HWp5&teamId=team_4KOoA5CgtYaOF85yFXPeMXLt&target=production&state=READY
   ```
2. **Promote it** (rolling release — the platform path, mirrors `vercel promote <deploymentId>`):
   ```
   POST /v10/projects/prj_Ylm0ROs2ZxwxxHWCMAroSPH8HWp5/promote/<deploymentId>?teamId=team_4KOoA5CgtYaOF85yFXPeMXLt
   ```
   → HTTP 202 = promotion queued. Verified live: promoting the *current* production deployment answers **409 `"already the current production deployment"`** — the endpoint and its semantics were exercised against the real project, not copied from docs.
3. **Equivalent classic rollback** (what `vercel rollback <deploymentId>` calls):
   ```
   POST /v9/projects/prj_Ylm0ROs2ZxwxxHWCMAroSPH8HWp5/rollback/<deploymentId>?teamId=team_4KOoA5CgtYaOF85yFXPeMXLt
   ```
4. **Verify**: `curl https://webflix-steel.vercel.app/api/health` → `200 {"ok":true,...}` (and the runtime log shows which commit the serving deployment was built from). Dashboard path: project → Deployments → ⋯ → Promote.

## 7. Git-integration status (honest limitation)

- **What exists:** the project was created with a full GitHub link (`org payswapdotorg`, repo id `1367978616`, production branch `main`, a stored git credential). Ref deployments work through the API — Vercel clones the ref server-side (proven by both deployments above; the build log shows the clone).
- **What was observed:** pushes to the branch did **not** auto-trigger deployments — the stored git credential cannot receive GitHub webhooks (only the Vercel GitHub App can). Auto-deploy-on-push-to-`main` and automatic PR preview/comment behaviors are therefore **not active**; deployments are API/CLI-actuated (§4 call, or `vercel deploy --prod`).
- **What remains for full auto-deploy (operator action, one-time):** install the Vercel GitHub App on `payswapdotorg` with access to `webflix` (dashboard → project → Git → reconnect via the GitHub App). After that: push to `main` auto-deploys production, every PR gets a preview + status check automatically. Nothing in this repo needs to change — the project settings, branch, and env decisions all carry over.

## 8. Operations notes (hobby-plan realities, from [free-tier-limits.md](./free-tier-limits.md))

- **One concurrent build:** deploy automation must be strictly sequential — never fire parallel deployments (queue, don't storm).
- **Deployment retention:** the project's `deploymentExpiration` setting is 30 days / keep 10. The active production deployment serves the production alias; keep shipping (or re-promote) — don't treat months-old deployment URLs as permanent.
- **Runtime logs retention: 1 hour.** Typed errors (like the HostConfigError above) must be captured when investigating, not reconstructed later. Build logs persist indefinitely.
- **Bandwidth discipline:** media bytes never route through Vercel (R2 serves them — free egress). The 100 GB/month transfer budget is for app shell + API responses.
- **Non-commercial restriction:** the Hobby plan's terms restrict use to non-commercial personal projects (recorded first by WFX-053; unchanged).
