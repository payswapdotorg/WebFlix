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
| `0008_source_management` (R03) | `connector_accounts` lifecycle columns (`authorized_at`, `last_state_change`, `availability_notes`); `connector_pending_authorizations` |
| `0009_canonical_library_history_exclusions` (R04) | `library_entries.item_id` (canonical-key discipline); `history_removals`; `history_exclusions` |
| `0010_recommendation_feedback` (R05) | `recommendation_feedback` (the J15 control set — reversible, per-profile) |

Runner laws (src/migrations.ts): files are applied in lexicographic order,
each inside ONE transaction together with its `persistence_migrations`
bookkeeping insert; re-runs verify checksums and apply nothing; an applied
file whose content changed is a `MigrationError` (forward-only contract —
fix drift with a NEW migration). No down path, by design.

## R05 — the recommendation-controls stores

Three stores back the `/experience/{policy,intents,feedback}` endpoints
(the `RecommendationControlsHost` in apps/api composes them):

- **Policy** — `recommendation_state` (migration 0004/0007): ONE row per
  effective profile holding the frozen `RecommendationPolicy` (jsonb,
  `validatePolicy`-checked on write AND read — a drifted row is a typed
  failure, never a silently accepted fake policy) plus the opaque
  engine-state blob. `PostgresRecommendationStateStore.saveForProfile` /
  `loadForProfile`.
- **Intents** — `user_intents` (migration 0004/0007): the frozen
  `IntentRecord` wire shape per (effective profile, scope, objective) —
  the one-objective-per-scope discipline is the table's UNIQUE key; the
  canonical `wfxint_` id stays stable across merges. R05 adds
  `listActiveForProfile(profileId, nowIso)` — the R01 LIVE-EXPIRY law,
  server side: expired temporary intents are filtered at READ (stored as
  audit truth, never surfaced) — and the profile-scoped
  `getIntentForProfile` / `deleteIntentForProfile` (the undo law's
  isolation half: one profile may never read or remove another's).
- **Feedback** — `recommendation_feedback` (migration 0010): the J15
  control set as typed rows — kind (`more-like-this` | `not-interested` |
  `dont-recommend-source` | `dont-recommend-creator` | `already-watched`),
  target type (derived from the kind — the table CHECK enforces the
  pairing), target id, optional note (<= 500 chars), `created_at`.
  ONE row per (effective profile, kind, target): re-submission
  update-in-place (stable `wfxfeed_` id, refreshed timestamp). DELETE IS
  GONE — `deleteForProfile` removes the row outright; no soft-delete
  theater. THE EVENT-SINK LAW: nothing here touches `event_outbox` or
  `watch_history` (R04's law — `already-watched` is a recommendation
  control, not a history edit).

## R04 — canonical-keyed library + history removals/exclusions

**The canonical-key discipline (migration 0009).** The library becomes
CANONICAL-KEYED: ONE row per `(COALESCE(profile_id, 'user:' || user_id),
item_id)` — NOT per realization. A second save of the same canonical item
from a DIFFERENT source is a no-op on the list count (one row); the
realization set in `metadata.realizations` GROWS (jsonb concatenation on
conflict — dedup happens at read time / in the runtime's library.read()
via the registry). The primary realization reference (`connector_id` +
`external_ref`) updates to the LATEST save (the cross-source replacement
law: a saved item never breaks when a source disappears IF another
realization exists; when the LAST realization vanishes, the row stays
listed honestly — the save is the user's intent, not a lease on a source's
lifetime).

The realization-keyed unique index from migration 0007
(`library_entries_profile_key`) is KEPT alongside the new canonical-keyed
index (`library_entries_profile_canonical_key`): the realization-keyed
index catches re-saves of the SAME realization when `item_id` is NULL
(the realization has no catalog row — the legacy "listed honestly even
when the realization vanished" path). The `addWithin` store method picks
the ON CONFLICT target based on whether `item_id` is resolved.

The frozen `LibraryEntry` wire shape is unchanged (`connectorId` +
`externalRef` + `title` + `addedAt` + `metadata?`); the canonical item id
travels in `metadata.canonicalItemId` for the runtime to ADOPT (R04 §4 —
durable canonical identity). The catalog connector's
`readLibraryForProfile` lists ALL profile rows via `listAllForProfile`
(the WebFlix-owned service library owns ALL rows saved via the service,
regardless of which realization source the user saved from).

**The event-sink law (R04 §2).** The recorded events in `event_outbox`
are the IMMUTABLE TRUTH; the history read model (`watch_history` projection)
is their PROJECTION. Removal (`DELETE /experience/history/:itemId`) and
exclusion (`POST /experience/history/exclusions`) NEVER falsify recorded
events — they are projection-side filters in two new tables:

- `history_removals` — one row per `(effective_profile, item_id)` the
  user removed from history. The history read model and Continue Watching
  filter these out. A re-watch (a new watch-state event arriving through
  the relay's fold) DELETES the removal row — the item re-materializes
  in history (`PostgresHistoryRemovalStore.clearRemoval`, called by the
  relay's `makeWatchHistoryDeliverer`).
- `history_exclusions` — one row per `(effective_profile, item_id)` the
  user excluded from history-derived surfaces. These stay excluded until
  the user explicitly removes the exclusion
  (`DELETE /experience/history/exclusions/:itemId`). A re-watch does NOT
  clear an exclusion (the user's explicit choice persists).

The `HistoryHost` (apps/api/src/host/history.ts) composes the read model:
`readHistory(profileId)` returns `ProfileHistoryEntry[]` (newest-first,
removal/exclusion-aware); `readContinueWatching(profileId)` returns the
Continue Watching shelf (in-progress items with a resumable position,
ordered by most-recent progress, capped, removal/exclusion-aware). The
relay's `scheduleOpportunisticDrain` and `runRelayDrain` carry the
removal store so the fold clears removals on re-watch.

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

## Source management (R03 — the account lifecycle)

Migration `0008_source_management.sql` extends the account store into the
source-management lifecycle (the consumer surface lives in `apps/api`'s
`/sources` routes):

- **Lifecycle stamps** — `authorized_at` (every save/transition INTO
  `signedIn`; a re-authorization upsert refreshes it while the account id +
  `created_at` stay stable — the "reauthorize preserves the account row"
  law) and `last_state_change` (every save + `setAuthState`).
- **Per-account availability notes** — `availability_notes` (jsonb array of
  strings): the quota/health truth a connected source carries (e.g. the
  YouTube connector's quota costs). Written via `saveAccount` or
  `setAvailabilityNotes`; NEVER credential material.
- **Pending authorizations** — `connector_pending_authorizations`: the
  in-flight oauth/device handshakes, stored SERVER-SIDE keyed by the
  host-minted CSRF `state` token (the state token appears in the OAuth
  redirect URL by the provider's own contract; the pending RECORD never
  appears in any URL). `savePendingAuthorization` (plain insert — a reused
  live state is a loud constraint violation, never a silent takeover),
  `loadPendingAuthorization` (typed `not-found` / `expired`, clock-checked;
  an expired pending is deleted — dead is dead), `completePendingAuthorization`
  (consume-once), `evictPendingAuthorizations` (supersession before a fresh
  connect), `listPendingAuthorizationsForUser`. `deleteAccount` evicts the
  account's pendings with it — a disconnect cancels the in-flight handshake.

### The model-input privacy law (ENFORCED here)

> "Provider credentials never enter model prompts. Model privacy policy is
> enforced at the runtime boundary." — the frozen architecture.

`src/model-input.ts` is the enforcement point for every lane that feeds
model providers (model-fabric / recommendation):

1. **Structural** — `ModelSafeSourceSummary` is the ONLY account projection
   those lanes may consume, and its field set is closed and secret-free by
   construction (`toModelSafeSourceSummaries` builds it from
   `ConnectorAccountRecord`, which never contains the secret).
2. **Type-level** — `AssertNoCredentialMaterial<T>` fails to compile against
   any type whose keys include a credential field (`secret`, `ciphertext`,
   `iv`, `authTag`, `accessToken`, `refreshToken`, `password`,
   `clientSecret`, `apiKey`, …).
3. **Runtime** — `assertNoCredentialMaterial(value)` deep-scans values at
   the boundary (nested objects, arrays, Maps, Sets — cycles safe) and
   throws the LOUD `CredentialMaterialLeakError` (`credential-leak` kind —
   never in the degradation family, always a 500-class programmer error)
   the moment a banned field name appears. The API's `/sources` payloads
   pass through this guard before leaving the service.

The ONLY method that can produce a secret is `loadAccount` — it exists for
the CONNECTOR runtime lane (token refresh, provider calls) exclusively.

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
