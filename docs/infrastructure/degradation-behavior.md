# WFX-053 — Degradation Behavior at Free-tier Limits

**Status:** defined 2026-09-15 (WFX-053). This document is the contract for how WebFlix behaves when each free-tier resource hits a limit. Governing principle (inherited from the architecture track): **typed, honest degradation — never fake success, never invented data, never an unbounded assumption of free capacity.** Every limit below is the verified-current value from [free-tier-limits.md](./free-tier-limits.md) (all verified 2026-09-15).

Two failure families are distinguished:

- **SUSPENSION** — the resource stops serving until a time boundary (quota reset) or an upgrade: requests to it fail while suspended. Correct response: typed `unavailable` with retry-after semantics and user-visible maintenance state.
- **REJECTION** — the resource refuses an individual operation (quota/wrong-state): the operation fails, others may still work. Correct response: typed per-operation error surfaced to the caller; never retried in a tight loop, never silently swallowed.

---

## 1. Neon PostgreSQL (Free plan)

### What the provider does at each limit (verified from neon.com/docs/introduction/plans, 2026-09-15)

| Limit hit | Provider behavior |
|---|---|
| Compute CU-hours exhausted (100/project/month) | **Compute is suspended until the next billing period or until upgrade.** Connections fail while suspended. Data is NOT deleted. |
| Public network transfer exhausted (5 GB/project/month) | Same: compute suspended until reset/upgrade. |
| Storage cap exceeded (0.5 GB/project) | **Operations that increase storage (INSERT/UPDATE/DELETE) fail** until space is freed or the plan is upgraded. Reads continue. |
| Branch count (10/project) | Branch creation fails. |
| Scale-to-zero (always on, 5 min idle) | Not a limit failure but a constant: first connection after idle pays a cold start (typically hundreds of ms to a few seconds). |

### WebFlix's required behavior (contract for WFX-052/WFX-054)

- **Connection layer:** all DB access goes through the persistence package (WFX-052), which classifies connection failures into at minimum: `DataSourceUnavailable` (suspension / cold start), `WriteQuotaExceeded` (storage-cap write rejections), and `ConnectionTimeout`. These are typed errors in the domain taxonomy — not raw driver errors leaking to handlers.
- **Cold starts:** the pooled endpoint + a connect-with-timeout-and-single-retry policy is mandatory (one bounded retry to absorb scale-to-zero wake-up). Never retry storms; never assume a warm compute.
- **Write failures:** a write rejected by the storage cap is surfaced as `WriteQuotaExceeded` with the offending operation identified; the API returns a typed 5xx-family response with a stable error code — never a fake success, never silent data loss (the client may retry after the user frees space or the operator upgrades).
- **Reads during storage exhaustion keep working** — the app stays partially available; features that require writes (library mutations, history sync, telemetry ingest) degrade visibly and honestly.
- **No fixture fallback in production:** a failing `DATABASE_URL` is a startup error (typed, loud), never a switch to dev fixtures. Fixtures exist only behind `WFX_DEV_FIXTURES` in local dev (see [environment-inventory.md](./environment-inventory.md)).
- **Ops signal:** the persistence package logs quota-adjacent events (near-capacity write failures, suspension-shaped connection errors) with typed markers so the operator can act before the monthly reset (our current period ends 2026-10-01).

---

## 2. Cloudflare R2 (free allowance; account has no payment method)

### What the provider does at each limit

| Limit hit | Behavior |
|---|---|
| Storage beyond 10 GB-month, Class A beyond 1M/month, Class B beyond 10M/month | Usage beyond the free allowance is billed at Standard-class rates ($0.015/GB-month; $4.50/M Class A; $0.36/M Class B) — **but paid usage requires a payment method, which this account does not have.** Treat the allowance as a hard budget: continued beyond-free usage cannot be paid for and puts the account at Cloudflare's billing-policy mercy (suspension for unpaid balances). |
| Egress | Free and unmetered for all storage classes — no egress wall exists. |
| Billing rounding | Usage rounds UP to the next whole billing unit per metric — plan at unit granularity, not fractional. |

### WebFlix's required behavior (contract for media/storage lanes)

- **Typed storage errors:** R2 operations classify failures into `StorageUnavailable` (network/5xx), `StorageCredentialsInvalid` (SigV4 rejection), and `StorageQuotaExceeded` (app-side budget guard, below). Raw S3 error XML never leaks upward.
- **App-side budget guard:** because the provider will not hard-stop us at 10 GB (it would start accruing charges if a payment method existed), the storage adapter enforces the budget itself: a configured max-bytes ceiling (default: the free allowance, 10 GB) and operation counters. When the ceiling is reached, uploads fail fast with `StorageQuotaExceeded` rather than pushing the account toward paid usage. This is the "never assume unlimited free usage" rule made concrete.
- **Operation hygiene:** `ListObjects` and per-request HEAD probes are Class A/B billable — the adapter avoids listing where a deterministic key scheme suffices, and media reads use presigned GET URLs (public access is NOT enabled on the bucket).
- **No egress anxiety, no Vercel detour:** media bytes must route R2 → client directly (free egress). Serving media through the web host would burn Vercel's 100 GB/month — a config-drift lint for WFX-056.

---

## 3. Vercel (Hobby plan)

### What the provider does at each limit

| Limit hit | Behavior |
|---|---|
| Included monthly allotments exhausted (100 GB data transfer, 1M invocations, 10 GB origin transfer, 4 h Active CPU, 360 GB-hrs memory, image quotas) | Hobby has **no on-demand billing** — continued usage beyond included amounts requires upgrading to Pro; Vercel notifies about outlier usage per its fair-use guidelines. Treat allotments as hard monthly budgets. |
| Build concurrency (1) | Additional deployments **queue** until the running build finishes. |
| Deployments/day (100), build time (45 min), upload size (100 MB) | The triggering operation fails (deployment fails). |
| Runtime logs (1-hour retention) | Older logs are gone — debugging must capture errors when they happen (structured typed errors, not log archaeology). |

### WebFlix's required behavior (contract for WFX-056 deployment + app)

- **Bandwidth discipline:** the app shell + API responses must fit comfortably in 100 GB/month; every media byte serves from R2 (see above). Client bundles are statically analyzed for size in CI (existing repo hygiene), and any accidental media proxying through Next.js routes is a build-time violation.
- **Invocation discipline:** middleware and per-request server functions are budgeted features, not free loops — no polling endpoints on the Vercel side; anything periodic belongs to clients or external schedulers with typed backoff.
- **Deploy tooling:** WFX-056's deploy automation is strictly sequential (1 concurrent build) with typed failure states for queue-timeout, build-failure, and size-limit — no parallel redeploy storms, no silent queue deadlock.
- **Governance (honest limitation, operator-visible):** the Hobby plan's terms restrict use to **non-commercial personal projects**. WebFlix must not process payments or carry advertising on this tier. If the project turns commercial, the operator must upgrade to Pro before that feature ships. This is recorded here so the constraint is a first-class decision, not a surprise.

---

## 4. Upstash Redis — OPTIONAL resource contract (wave 2/3)

**Status:** not provisioned (credentials are a database password without its endpoint; management API inaccessible — see [infrastructure-stack.md](./infrastructure-stack.md)). Redis is an optional cache; the app must be fully correct without it.

### The env pair contract

- Redis is enabled **iff both** `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are present and non-empty at boot.
- If either is absent, the cache layer instantiates the **in-memory fallback**. This is a first-class runtime mode, not an error and not a warning storm: exactly one structured, typed startup log line records the mode (e.g. `cache.mode=memory` vs `cache.mode=redis`).
- A present-but-wrong pair (unreachable endpoint, 401) is NOT silently downgraded: the cache layer fails typed at startup (`CacheConfigInvalid` / `CacheUnavailable`) so a misconfigured production deploy is caught at boot, not discovered via phantom cache misses.

### Fallback semantics (the honest-cache laws)

1. **No fake cache hits.** The in-memory fallback returns hits only for keys it actually holds; a miss is a miss. It never fabricates values to "simulate" Redis.
2. **No silent Redis assumption.** No call site may require a distributed cache. Anything that would need cross-instance shared state (distributed locks, cross-instance sessions) must be designed against Postgres, not Redis.
3. **Typed degraded logging.** When running the fallback, cache-layer events carry the mode marker, so telemetry can quantify fallback operation without grepping for absence.
4. **Free-tier limits if later provisioned:** 256 MB data / 500K commands per month (verified 2026-09-15, upstash.com/pricing). The cache layer treats the command budget as real: bounded TTLs, no unbounded key growth, and typed `CacheQuotaExceeded` markers on observable throttling (Upstash rate-limits beyond budget caps) — the app sheds cache load and continues correctly against the source of truth.

### Sketch of the mode selection (illustrative; final types land with the implementing lane)

```ts
type CacheMode =
  | { kind: "redis"; url: string }
  | { kind: "memory"; reason: "env-pair-absent" };

// Boot: exactly one mode, decided once, logged typed.
// - both env vars present  -> redis mode; a failed health check aborts startup (typed)
// - either absent          -> memory mode (first-class, logged once)
// Callers see one interface: get/set/del with TTL; misses are always honest.
```

---

## Cross-cutting rule for every lane

When ANY provider limit is hit, the sequence is always: **classify (typed error) → surface (stable error code / visible degraded mode) → contain (no retry storms, no queue floods) → recover (quota reset or operator action)**. A degraded WebFlix tells the truth about being degraded. There is no configuration in which the system pretends a resource is unlimited, present, or healthy when it is not.
