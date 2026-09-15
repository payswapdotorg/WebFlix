/**
 * @wfx/persistence — typed failure taxonomy (WFX-052).
 *
 * The degradation contract (docs/infrastructure/degradation-behavior.md,
 * "Neon PostgreSQL — WebFlix's required behavior") mandates that connection
 * failures are classified into typed errors — `DataSourceUnavailable`,
 * `WriteQuotaExceeded`, `ConnectionTimeout` — and that raw driver errors
 * never leak to handlers. This module is that taxonomy. Every
 * `PersistenceError` carries a machine-readable `kind`; the three
 * degradation classes below are the exact names the contract specifies.
 *
 * Channel law (mirrors the repo-wide convention):
 * - Operational/runtime conditions (provider down, quota, timeout) → typed
 *   errors of this family, thrown to the caller.
 * - Configuration misuse (missing env vars, bad URL, bad key) → typed
 *   `PersistenceConfigError` thrown LOUDLY at boot. There is NO fixture
 *   fallback path anywhere in this package — structurally: no fixture code
 *   is imported, and no code path invents data.
 */

/** Machine-readable failure kinds of the persistence layer. */
export type PersistenceFailureKind =
  | "data-source-unavailable"
  | "write-quota-exceeded"
  | "connection-timeout"
  | "constraint-violation"
  | "invalid-input"
  | "migration-error"
  | "config-error"
  | "credential-decrypt-failed"
  | "unknown";

/** Options accepted by every `PersistenceError` constructor. */
export interface PersistenceErrorOptions {
  /** The persistence operation that failed (e.g. "drainEventOutbox"). */
  readonly operation?: string | undefined;
  /** The SQLSTATE (SQLSTATE class code) when the driver exposed one. */
  readonly sqlState?: string | undefined;
  readonly cause?: unknown;
}

/** Base class of every typed persistence failure. */
export class PersistenceError extends Error {
  readonly kind: PersistenceFailureKind;
  readonly operation: string | undefined;
  readonly sqlState: string | undefined;

  constructor(kind: PersistenceFailureKind, message: string, options: PersistenceErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PersistenceError";
    this.kind = kind;
    this.operation = options.operation;
    this.sqlState = options.sqlState;
  }
}

/**
 * The data source is not serving: connection refused/reset, DNS failure,
 * Neon compute suspension (quota-period or scale-to-zero wake-up), or the
 * server rejecting new connections. Retryable after provider recovery —
 * at most ONE bounded retry for cold-start wake-ups (degradation contract).
 */
export class DataSourceUnavailable extends PersistenceError {
  constructor(message: string, options: PersistenceErrorOptions = {}) {
    super("data-source-unavailable", message, options);
    this.name = "DataSourceUnavailable";
  }
}

/**
 * A write was rejected by a storage/quota ceiling (Neon free-plan 0.5 GB
 * storage cap → SQLSTATE 53100 disk_full, and quota-shaped rejections).
 * Reads may still work; the app degrades visibly and honestly — never a
 * fake success, never silent data loss.
 */
export class WriteQuotaExceeded extends PersistenceError {
  constructor(message: string, options: PersistenceErrorOptions = {}) {
    super("write-quota-exceeded", message, options);
    this.name = "WriteQuotaExceeded";
  }
}

/**
 * A connection or statement exceeded its configured timeout (connect
 * timeout, statement timeout, aborted request). Distinct from
 * `DataSourceUnavailable`: the source may be perfectly healthy — the
 * operation was too slow.
 */
export class ConnectionTimeout extends PersistenceError {
  constructor(message: string, options: PersistenceErrorOptions = {}) {
    super("connection-timeout", message, options);
    this.name = "ConnectionTimeout";
  }
}

/**
 * Invalid configuration: missing/empty DATABASE_URL or APP_ENCRYPTION_KEY,
 * a non-PostgreSQL URL scheme, or an encryption key that does not decode to
 * 32 bytes. The error NAMES the offending variables — this is the "typed
 * loud startup error" of the degradation contract. Never caught and
 * downgraded inside this package.
 */
export class PersistenceConfigError extends PersistenceError {
  /** The env var names the operator must fix (at least one). */
  readonly missing: readonly string[];

  constructor(message: string, missing: readonly string[] = [], options: PersistenceErrorOptions = {}) {
    super("config-error", message, options);
    this.name = "PersistenceConfigError";
    this.missing = missing;
  }
}

/**
 * A migration failed: undecodable SQL, a checksum drift against an already
 * applied migration (file edited after the fact), or a statement the server
 * rejected. Migrations are forward-only; a failed migration is never
 * partially silently applied (each runs inside one transaction).
 */
export class MigrationError extends PersistenceError {
  constructor(message: string, options: PersistenceErrorOptions = {}) {
    super("migration-error", message, options);
    this.name = "MigrationError";
  }
}

/**
 * An AES-256-GCM envelope failed to open: ciphertext, IV, or auth tag was
 * tampered with or truncated, or the key is not the one that sealed the
 * envelope. Typed and loud — a tampered credential is never returned as
 * garbage plaintext or as a fake success.
 */
export class CredentialDecryptError extends PersistenceError {
  constructor(message: string, options: PersistenceErrorOptions = {}) {
    super("credential-decrypt-failed", message, options);
    this.name = "CredentialDecryptError";
  }
}
