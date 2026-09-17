# @wfx/persistence

Production PostgreSQL persistence for WebFlix (WFX-052, Task W1-B). Replaces
fixture-only persistence with real, typed, Neon/PostgreSQL-backed services.
**SQLite and local JSON are never the production database** — there is no
fallback path in this package, structurally: no fixture code is imported and
no code path invents data.

## Stack

- **Driver:** [`postgres`](https://github.com/porsager/postgresql) (postgres.js)
  — pure JS, zero native modules, runs on Bun and in Vercel's Node runtime.
  Configured for the Neon pooled endpoint (PgBouncer transaction mode:
  `prepare: false`, small pool, short idle timeout) and with the
  `JSON_COLUMN_TYPES` config so **jsonb columns parse to objects on the
  unsafe-query path too** (postgres.js returns them as strings there —
  verified against live Neon; PGlite parses natively, so the `DbClient`
  seam stays behaviorally identical on both servers).
- **Test harness:** [`@electric-sql/pglite`](https://github.com/electric-sql/pglite)
  — REAL PostgreSQL compiled to WASM, **tests only** (devDependency, never a
  production path). The same SQL and the same `DbClient` seam run against a
  real Postgres server in tests and production; only the server differs.
- **Crypto:** `node:crypto` only — scrypt for passwords, AES-256-GCM for
  credential envelopes, SHA-256 for session-token hashing.

## Environment contract (frozen names — `.env.example`)

| Variable | Meaning | Failure when missing |
|---|---|---|
| `DATABASE_URL` | Neon PostgreSQL, **pooled** endpoint (PgBouncer transaction mode; `sslmode=require` in the URL) | typed `PersistenceConfigError` naming the variable, at boot, loudly |
| `APP_ENCRYPTION_KEY` | 32-byte secret (base64 or 64-hex) sealing connector credentials at rest | same typed loud boot failure |

`readPersistenceEnv` validates both and names every offender in one error.
The production boot is `bootPersistence` (src/ports.ts): env → connect
(boot probe with **one** bounded cold-start retry) → migrations → `Ports`.
There is **no fixture fallback**: `WFX_DEV_FIXTURES` is a web-host concern
(apps/web) and never reaches this package.

## Schema (migrations/ — forward-only, idempotent, checksummed)

| Migration | Tables |
|---|---|
| `0001_users_and_sessions` | `users`, `sessions` |
| `0002_entertainment_graph` | `entertainment_items`, `source_realizations` |
| `0003_library_and_watch` | `library_entries`, `watch_history`, `playback_sessions` |
| `0004_intents_and_recommendation` | `user_intents`, `recommendation_state` |
| `0005_connector_accounts` | `connector_accounts` (envelope-encrypted credentials) |
| `0006_event_outbox` | `event_outbox` |
| `0007_profiles` (R02) | `profiles`; `sessions.active_profile_id`; `profile_id` scoping on `watch_history` / `library_entries` / `user_intents` / `recommendation_state` / `event_outbox` |

Runner laws (src/migrations.ts): files are applied in lexicographic order,
each inside ONE transaction together with its `persistence_migrations`
bookkeeping insert; re-runs verify checksums and apply nothing; an applied
file whose content changed is a `MigrationError` (forward-only contract —
fix drift with a NEW migration). No down path, by design.

## Identity + profiles (R02 — identity and profiles)

Server-side identity replacing the anonymous stopgap, with profile
selection, profile-scoped data, and cross-device continuity:

- **Accounts** (`src/identity.ts`): register/authenticate (scrypt, typed
  results, no user enumeration). User records NEVER contain the hash.
- **Sessions** (`src/sessions.ts`): opaque `wfxsess_` + ULID tokens —
  timestamp-first, crypto-random body, NOT derivable from user data —
  returned EXACTLY ONCE, stored ONLY as SHA-256 hashes (UNIQUE), expiry
  checked against the injected clock, revocation an idempotent
  `revoked_at` stamp, `revokeAllSessionsForUser` = sign-out-everywhere.
  The 052 raw-32-byte shape remains VALIDATABLE (stored hashes never
  expire early); only new mints use the R02 shape.
- **Profiles** (`src/profiles.ts`): `wfxprof_` records per user with ONE
  designated default (a partial unique index makes it structural).
  `sessions.active_profile_id` is the session's current selection
  (`setActiveProfile` — ownership-checked in the UPDATE itself: another
  account's profile is the same honest `unknown-profile` as an unknown id).
- **The effective profile key** (`resolveEffectiveProfileKey`): what every
  profile-scoped read/write resolves first — (1) the user's default
  profile id once one exists; (2) a freshly MATERIALIZED default for a
  registered user with none yet (the LAZY LEGACY MIGRATION: the profile
  insert and the attribution of the user's pre-R02 `profile_id IS NULL`
  rows across `watch_history` / `library_entries` / `user_intents` /
  `recommendation_state` commit together); (3) the deterministic pseudo
  key `'user:' + userId` for ids that are not registered accounts (the
  anonymous stopgap — NO row is created; migration 0007's COALESCE
  indexes keep legacy NULL rows readable AND upsertable under exactly
  this key, so pre-R02 behavior is preserved bit-for-bit).
- **Profile scoping**: `watch_history`, `library_entries`, `user_intents`,
  and `recommendation_state` key on
  `(COALESCE(profile_id, 'user:' || user_id), <old key columns>)` — the
  SAME expression in the unique indexes, the reads, and the upserts. Two
  profiles of one user watching/saving the SAME item produce two
  ISOLATED rows. The LEGACY store APIs (`record`/`list`/`get`/`save`/
  `load`/`upsertIntent`/`listForUser`, keyed by userId) resolve the
  effective key internally — pre-R02 callers keep their behavior — while
  the profile-explicit forms (`*ForProfile`) take the key directly.
- **Event attribution**: `enqueueEvent`/`PostgresEventSink.emitForProfile`
  stamp the ACTIVE profile on the outbox ROW at ingest (the frozen
  `EntertainmentEvent` shape is never edited); the relay's fold uses the
  row's attribution, falling back to the effective profile for legacy /
  anonymous (NULL) rows.
- **Cross-device continuity**: all of the above is server-side state keyed
  to real profile ids — any device holding a valid session token resolves
  the same profile and sees the same history/library/intents/policy
  (the continuity tests prove it: two sessions, one profile, shared watch
  state).

## The transactional outbox (and its AT-LEAST-ONCE contract)

Frozen architecture: *"Jobs: transactional outbox + durable workers
initially."* The `event_outbox` table is the durable half for domain events
(frozen `EntertainmentEvent` in a canonical `EventEnvelope`):

- **Write side:** `enqueueEvent(tx, envelope, nowMs)` inserts the event row
  INSIDE the caller's transaction. Adapters that change state and announce it
  (`writeLibrary(add)`, `executeAction(save)`, watch-history `record`) call
  it in the SAME `db.begin` block as the state change — **the event and the
  state commit together or not at all**. `PostgresEventSink.emit` (the
  `EventSink` port) is the standalone single-statement form.
- **Relay:** `drainEventOutbox(db, { deliver, now, … })` claims due pending
  rows with `FOR UPDATE SKIP LOCKED`, delivers each via `deliver`, and
  records the outcome (delivered / exponential-backoff retry / terminal
  `failed` after `maxAttempts`).
- **Delivery semantics: AT-LEAST-ONCE.** A relay crash between claim and
  mark-delivered leaves rows `in-flight`; `requeueStaleInFlight` returns them
  to `pending` after the staleness window and they are delivered AGAIN.
  **Consumers of drained envelopes MUST be idempotent** — the envelope's
  canonical `wfxevt_` id is the natural downstream dedupe key. Exactly-once
  is not claimed and not faked.

## Auth (service functions; the HTTP/bearer layer is apps/api — R02)

- **Passwords:** scrypt (N=16384, r=8, p=1, 64-byte key, 16-byte salt,
  `maxmem` raised) stored as `scrypt$N$r$p$salt$hash`; verification is
  constant-time (`timingSafeEqual`) and fails closed on foreign formats.
  Unknown-email and wrong-password both burn one scrypt derivation and both
  answer `{ ok: false, reason: "invalid-credentials" }` (no user
  enumeration, via `DUMMY_PASSWORD_HASH` timing equalization).
- **Sessions:** opaque `wfxsess_` + ULID tokens (R02; the 052 32-byte shape
  remains validatable), returned exactly once, stored ONLY as SHA-256
  hashes (unique). Expiry is checked against the injected clock; revocation
  is an idempotent `revoked_at` timestamp; `revokeAllSessionsForUser`
  gives sign-out-everywhere. Typed outcomes: `unknown-token` / `expired` /
  `revoked` (plus `unknown-profile` from `setActiveProfile`).
- **Profiles:** one designated default per user (structural), lazy
  materialization + legacy-row attribution for registered users, the
  `'user:' + userId` pseudo bucket for unregistered ids (the anonymous
  transition) — see "Identity + profiles (R02)" above.

## Credentials at rest

`connector_accounts` stores one account per (user, connector). The secret is
sealed with AES-256-GCM under `APP_ENCRYPTION_KEY`: `ciphertext` + fresh
12-byte `iv` + 16-byte `auth_tag` (+ `key_id` fingerprint for rotation
detection) — plaintext never lands in the table. AAD binds the envelope to
`wfx/persistence/credential/v1`. Tampering, truncation, and wrong-key opens
fail typed (`CredentialDecryptError` / `{ reason: "key-mismatch" }`) — never
garbage plaintext, never fake success.

## The account lifecycle (R03 — source management)

Migration `0008` extends the account row with the lifecycle truth the
source-management surface reports:

- `authorized_at` — when the CURRENT credential completed authorization;
  re-stamped on every reauthorize upsert (the account row and id are
  PRESERVED — the store's one-row-per-(user, connector) law).
- `last_state_change` — when `auth_state` last changed (stamped by
  `saveAccount` and `setAuthState`; never silently stale).
- `health` — per-account quota/health notes (typed
  `ConnectorAccountHealth`: `quota`, `lastDegradation`, `notes`); resets to
  NULL on credential rotation (the new credential's posture is unknown
  until observed — stale notes would be a lie); `saveAccountHealth` answers
  honest `null` for a disconnected source.

**Pending authorizations** (`connector_pending_authorizations`): the
durable in-flight handshake records the API's connect flow persists
SERVER-SIDE — never in URLs. The OAuth/CSRF `state` is the caller-minted
opaque token the provider echoes back (the callback route's lookup key);
the authorization itself (user, connector, flow kind, expiry) lives only in
the table. ONE live pending per (user, connector) — a new begin supersedes
the old (UNIQUE index + the store's evict-then-insert transaction; the SDK
`ConnectorAuthService`'s evict-on-begin law made durable). An expired
pending is consumed by its own read (`loadPendingAuthorization` answers
the typed `{ reason: "expired", expiredAt }` and deletes the row — never
resurrected). `livePendingFor` answers the in-flight handshake for the
honest `authorizing` projection.

## THE MODEL-INPUT PRIVACY LAW — enforced here (R03)

> "Provider credentials never enter model prompts. Model privacy policy is
> enforced at the runtime boundary." (the frozen architecture)

The enforcement point for persistence-backed lanes is this package, at
THREE layers:

1. **Compile time** — `ConnectorAccountSafeView` (minted ONLY by
   `toSafeAccountView`, consumed via `safeViewsForUser`) is a brand-
   protected projection with NO secret and NO raw metadata field; an
   `OpenedConnectorAccount` is NOT assignable to it. Model-input lanes
   (model-fabric prompt builders, recommendation feature assembly) consume
   the safe view — the opened-secret channel (`loadAccount`) exists for
   the connector runtime alone.
2. **Runtime** — `assertModelInputFreeOfCredentialMaterial`
   (`src/model-input-guard.ts`) deep-walks any model-input payload and
   throws the typed `CredentialMaterialError` naming the offending field
   and path (`secret`, `accessToken`, `refresh_token`, `clientSecret`,
   `ciphertext`, …) the moment credential material appears — bounded,
   cycle-safe, no guessing by value shape.
3. **Write boundary** — `saveAccount`'s `metadata`,
   `savePendingAuthorization`'s `metadata`, and `saveAccountHealth` REJECT
   secret-shaped fields typed (`PersistenceError invalid-input`) before
   they can land in a client-visible column — the metadata/health columns
   can never become a side door around the envelope.

The enforcement test (`tests/source-accounts.test.ts`) proves all three:
the type-level brand proof, a model-input builder over `safeViewsForUser`
whose serialized payload contains no credential material, and the at-rest
scan of every client-visible column.

## Degradation contract (docs/infrastructure/degradation-behavior.md §1)

Every driver failure is classified (src/classify.ts) into the typed taxonomy
before callers see it — raw driver errors never leak:

| Class | Mapped from |
|---|---|
| `DataSourceUnavailable` | SQLSTATE 08000-class/57P03/53300/53200, errno `ECONNREFUSED`/`ENOTFOUND`/…, suspension vocabulary |
| `WriteQuotaExceeded` | SQLSTATE 53100 (disk_full), quota vocabulary |
| `ConnectionTimeout` | SQLSTATE 57014, errno `ETIMEDOUT`, timeout vocabulary |

Cold starts (Neon scale-to-zero, 5 min idle): the boot probe performs **one**
bounded retry on a cold-start-shaped failure — never a retry storm.
Config-shaped failures (bad URL, auth) fail immediately.

## Ports / adapter inventory

`makePostgresPorts` (src/ports.ts) fills the frozen `@wfx/experience` `Ports`
bundle for production:

| Seam | Adapter |
|---|---|
| `connector` | `PostgresCatalogConnector` — the WebFlix durable catalog source (search/metadata/resolve over the graph tables; library read/write; like/save actions with outbox events) |
| `events` | `PostgresEventSink` — outbox write side |
| `clock` / `ids` | injected; production defaults `SystemClock` / `CryptoUlidIdGen` live in the composition root only |

Documented **port gaps** (honest, frozen-package boundary respected):

- `Ports` has no identity/session seam — identity is caller-supplied
  (`ExperienceContext`). Identity/session ship as service functions here;
  the web host wires them to HTTP/cookies in a later wave.
- The report use-cases bind a concrete in-memory `PlaybackSessionStore`;
  there is no playback-session port to implement. The durable
  `PostgresPlaybackSessionStore` is the seam a future service lane composes
  (hydrate/flush), NOT a frozen-use-case replacement.
- `ConnectorContext` carries no `sessionId`; catalog-connector events use a
  deterministic synthetic session id (documented in src/catalog-connector.ts).
- Creators/topics REGISTRIES and relationship edges are not table-scoped
  here; item reference lists round-trip as jsonb so no knowledge is lost.
  Registry tables land with the graph-persistence consumer that needs them.

## Scripts

```bash
# Live Neon verification (real DATABASE_URL; never part of `bun test`):
source /home/z/.secrets/env  # operator env (DATABASE_URL, APP_ENCRYPTION_KEY)
cd packages/persistence && bun scripts/verify-live.ts
```

## Scope note (drift rules)

This package owns its SQL, migrations, and adapters. It does not modify
frozen packages (`@wfx/domain`, `@wfx/experience`, …), contains no provider
logic in domain cores, and depends on `@wfx/experience` for TYPES only
(`import type` — the Ports seams). Fixture ports are untouched and remain
test/dev-only in `@wfx/experience`.
