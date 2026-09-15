# WFX-053 — Verified Free-tier Limits

**Verification date: 2026-09-15.** Every number below was checked against the provider's live documentation or a live API response on that date — not from memory or assumptions. Provider docs change; re-verify before any capacity planning decision. Each table lists its exact source.

Account-level facts verified against OUR accounts via provider APIs on the same date:

- Neon: organization `org-proud-truth-25823860`, subscription `free_v3` (billing/account API → `plan_details: free, v3.2`, no payment method). Consumption period currently `2026-09-15 → 2026-10-01`, usage zero.
- Cloudflare: standard account `7e333607c4ceeef5d092be1bb94108bf`; R2 active; bucket `webflix-media` verified from both the S3 API and the management API.
- Vercel: team `team_4KOoA5CgtYaOF85yFXPeMXLt`, `billing.plan: "hobby"` (`GET /v2/teams/{team}`, 200), user `limited: true` (`GET /v2/user`).
- Upstash: not provisioned; free-plan limits below are the published plan limits, verified from the pricing page.

## Neon — Free plan

Source: `https://neon.com/docs/introduction/plans` (fetched 2026-09-15), cross-checked against the account's `billing/account` and `consumption` API responses. The docs' own Free-plan summary: *"100 projects, 10 branches per project, 100 CU-hours of compute per project per month, autoscaling up to 2 CU (≈8 GB RAM), 0.5 GB of storage per project, and 5 GB of public network transfer per project per month … a 6-hour instant restore … capped at 1 GB-month of changes, 1 manual snapshot, up to 60,000 Managed Better Auth MAU, 1 day of monitoring history, and community support."*

| Dimension | Free plan limit | Notes |
|---|---|---|
| Projects per organization | 100 | |
| Branches per project | 10 | Branch creation fails beyond this. |
| Compute | **100 CU-hours / project / month** | ≈ 400 hours of 0.25 CU runtime. Resets each monthly billing period (ours: 15th → month end; current period ends 2026-10-01). |
| Autoscaling ceiling | Up to 2 CU (8 GB RAM) | Our endpoint is fixed 0.25 CU. |
| Storage | **0.5 GB / project** | Continuous limit (does not reset). |
| Public network transfer | **5 GB / project / month** | Resets monthly. |
| Scale to zero | After 5 min idle — **cannot be disabled** on Free | Mandatory cold starts. |
| Monitoring history | 1 day | |
| History window (instant restore) | 6 hours, capped 1 GB-month of changes | |
| Manual snapshots | 1 | |
| Neon Auth (if used) | 60,000 MAU | |

## Cloudflare R2 — free allowance

Source: `https://developers.cloudflare.com/r2/pricing/` ("Last updated Aug 7, 2026", fetched 2026-09-15). *"You can use the following amount of storage and operations each month for free."*

| Dimension | Free allowance / month | Beyond free (Standard storage class) |
|---|---|---|
| Storage | **10 GB-month** | $0.015 / GB-month |
| Class A operations (mutating: `PutObject`, `ListObjects`, `CreateMultipartUpload`, bucket config writes, …) | **1,000,000 requests** | $4.50 / million |
| Class B operations (reading: `GetObject`, `HeadObject`, …) | **10,000,000 requests** | $0.36 / million |
| Egress (data transfer to internet) | **Free — always, all storage classes** | Free |
| Billing unit rounding | — | Usage is rounded UP to the next whole unit (1 GB-month, 1M requests) per metric. |

Operational note: this Cloudflare account has no payment method on file, so paid beyond-free usage is not available — the free allowance is effectively a **hard cap** for WebFlix planning. (Also note the account hosts other projects' buckets; the free allowance is account-wide, not per-bucket.)

## Upstash Redis — free tier (resource not provisioned)

Source: `https://upstash.com/pricing` FAQ (fetched 2026-09-15): *"Free tier includes 256MB data size and 500K commands per month."*

| Dimension | Free tier |
|---|---|
| Data size | **256 MB** |
| Commands | **500,000 / month** (operational commands like `AUTH`, `PING`, `SELECT`, `COMMAND`, `CONFIG`, `INFO`, `RESET`, `QUIT` are not charged) |
| Pay-as-you-go beyond free | $0.20 per 100K commands; storage $0.25/GB beyond included; budgets optional (exceeding a set budget → database is rate-limited, cost capped) |

## Vercel — Hobby plan

Sources: `https://vercel.com/docs/limits` (general limits; fetched 2026-09-15), `https://vercel.com/docs/limits/fair-use-guidelines` ("Last updated July 29, 2026") and `https://vercel.com/docs/pricing` (allotments; fetched 2026-09-15); plan verified live via API (`billing.plan: "hobby"`).

### Monthly included allotments (Hobby)

| Resource | Hobby included |
|---|---|
| Fast Data Transfer (bandwidth) | **First 100 GB** |
| CDN Function Invocations | **First 1,000,000** |
| Fast Origin Transfer | **First 10 GB** |
| Active CPU (Fluid compute) | **4 hours** |
| Provisioned Memory | **360 GB-hrs** |
| Image Optimization transformations | **5,000 / month** |
| Image Optimization cache reads / writes | **300K / 100K per month** |

Hobby has no on-demand billing: included amounts are the ceiling for the cycle unless the team upgrades to Pro. **Hobby is restricted to non-commercial personal use** (see degradation doc — governance note for WebFlix).

### General limits that apply to Hobby (from `/docs/limits`)

| Limit | Hobby value |
|---|---|
| Projects per team | 200 |
| Deployments created per day | 100 |
| **Concurrent deployments (builds)** | **1** |
| Custom build time per deployment | 45 minutes |
| Static file upload size (CLI deploy source) | 100 MB |
| Proxied request timeout | 120 seconds |
| Routes (rewrites/redirects/headers) per deployment | 2048 |
| Environment variables per project per environment | 1000 |
| Runtime logs retention | **1 hour** (build logs: indefinite) |
| Vercel projects connected per Git repository | 25 |

## Capacity implications for WebFlix (honest read, as of 2026-09-15)

- **Database is the tightest long-lived budget:** 0.5 GB storage and 100 CU-hours/project/month (with our fixed 0.25 CU endpoint, ~400 compute-hours) and 5 GB egress/month. Fine for launch-scale; the storage cap is the first wall a growing catalog hits.
- **Media never flows through Vercel:** R2 egress is free and its 10 GB storage / 10M Class B ops cover early serving; Vercel's 100 GB bandwidth stays for app shell + API responses only.
- **The single concurrent build** serializes CI-style redeploy storms — deployment automation (WFX-056+) must queue, not parallel-fire.
- **Nothing here is elastic for free:** every provider either suspends, fails writes, or requires a payment method beyond the allowances above. The degradation doc defines exactly how WebFlix behaves at each wall.
