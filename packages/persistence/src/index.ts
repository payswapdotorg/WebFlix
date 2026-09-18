/**
 * @wfx/persistence — production PostgreSQL persistence (WFX-052).
 *
 * The production data layer: postgres.js (pure JS, no native modules,
 * Bun/Vercel-compatible) against Neon PostgreSQL, plus PGlite (real
 * Postgres compiled to WASM) as the DETERMINISTIC, NETWORK-FREE test
 * harness — the same SQL runs against a real Postgres server in both
 * paths, only the server differs (see src/sql.ts).
 *
 * Public surface:
 * - `sql.ts`            — the DbClient/SqlClient seam both servers speak
 * - `postgres-client.ts`— the production client (pooled Neon endpoint,
 *                         PgBouncer-safe, one bounded cold-start retry)
 * - `migrations.ts`     — the tiny typed migration runner (forward-only,
 *                         idempotent, checksummed)
 * - `errors.ts`         — the typed failure taxonomy (the degradation
 *                         contract: DataSourceUnavailable /
 *                         WriteQuotaExceeded / ConnectionTimeout)
 * - `classify.ts`       — driver-error → taxonomy classification
 * - `env.ts`            — the DATABASE_URL + APP_ENCRYPTION_KEY contract
 *                         (typed loud startup errors, no fixture fallback)
 * - `identity.ts`       — register / authenticate (scrypt, typed results)
 * - `passwords.ts`      — the scrypt envelope (constant-time verify)
 * - `sessions.ts`       — opaque bearer sessions (hashed at rest, expiry +
 *                         revocation, typed outcomes)
 * - `outbox.ts`         — the transactional event outbox (write side +
 *                         relay, AT-LEAST-ONCE — see README)
 * - `action-outbox.ts`  — R15: the durable action outbox (the
 *                         `@wfx/actions` store contract over migration
 *                         0011 — transactional enqueue with the local
 *                         audit row, crash-safe claims, honest states)
 * - `action-sync-log.ts` — R15: the persisted sync audit trail (the
 *                         `SyncAuditLog` contract's SQL implementation)
 * - `graph.ts`          — Entertainment Graph tables (items + realizations)
 * - `catalog-connector.ts` — the WebFlix catalog `ConnectorPort` (the
 *                         feed/candidate source seam)
 * - `library.ts`        — the user library store
 * - `watch.ts`          — watch-history projection + playback sessions
 * - `intents.ts`        — the durable intent store
 * - `recommendation-state.ts` — policy + opaque engine state per user
 * - `feedback.ts`      — R05: the recommendation feedback controls store
 *                         (per profile, timestamped, reversible)
 * - `connector-accounts.ts` — AES-256-GCM envelope-encrypted credentials
 * - `envelope-crypto.ts`— seal/open + key decode/fingerprint
 * - `model-input.ts`    — R03: the model-input privacy law (structurally
 *                         secret-free source summaries + the loud
 *                         credential-material guard)
 * - `ports.ts`          — the composition root: SystemClock, CryptoUlidIdGen,
 *                         makePostgresPorts (the full Ports bundle), and the
 *                         one-call bootPersistence production boot
 */

// The SQL seam + client.
export * from "./sql";
export * from "./postgres-client";

// Migrations.
export * from "./migrations";

// Typed failures + classification + the env contract.
export * from "./errors";
export * from "./classify";
export * from "./env";

// Auth: identity, passwords, sessions, profiles.
export * from "./passwords";
export * from "./identity";
export * from "./sessions";
export * from "./profiles";

// The transactional outbox (domain events).
export * from "./outbox";

// R15 — the durable action outbox + the persisted sync audit log (the
// @wfx/actions store contracts' SQL implementations).
export * from "./action-outbox";
export * from "./action-sync-log";

// Content: graph + catalog connector + library.
export * from "./graph";
export * from "./catalog-connector";
export * from "./library";

// Watch state + playback sessions.
export * from "./watch";

// R04 — history removals + exclusions (the event-sink law projections).
export * from "./history-exclusions";

// Intents + recommendation state.
export * from "./intents";
export * from "./recommendation-state";

// R05 — the recommendation feedback controls (per profile, reversible).
export * from "./feedback";

// Connector accounts + credential envelope encryption + the R03
// model-input privacy law (the structurally secret-free summary + guard).
export * from "./envelope-crypto";
export * from "./connector-accounts";
export * from "./model-input";

// R06 — model and AI controls: per-profile ModelPolicy, BYOM provider
// bindings (envelope-encrypted), and transform operation records with
// append-only state history (the explicit transformation state machine).
export * from "./model-policy";
export * from "./byom-bindings";
export * from "./transform-operations";

// The composition root (Ports bundle + production boot).
export * from "./ports";
