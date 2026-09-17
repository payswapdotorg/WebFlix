/**
 * @wfx/persistence — connector accounts with envelope-encrypted credentials
 * (WFX-052; R03 source-management lifecycle extension).
 *
 * The durable account state a connector's auth session projects onto
 * (migration 0005 + the R03 migration 0008), for WFX-054 (YouTube
 * connector) and beyond:
 *
 * - ONE account per (userId, connectorId) — UNIQUE, upserted.
 * - The credential secret is sealed with AES-256-GCM
 *   (`src/envelope-crypto.ts`, key = APP_ENCRYPTION_KEY): ciphertext + IV +
 *   authTag + keyId stored, plaintext NEVER at rest. `saveAccount` accepts
 *   the raw secret and seals it; `loadAccount` opens the envelope and hands
 *   the secret to the CALLER ONLY — never logged, never persisted.
 * - `key_id` mismatch is detected BEFORE decryption is attempted (rotation
 *   observability): loading under a different key answers the typed
 *   `{ ok: false, reason: "key-mismatch" }` result instead of a cryptic GCM
 *   failure.
 * - Tampered envelopes fail typed (`CredentialDecryptError`) — never garbage
 *   plaintext, never fake success.
 *
 * THE R03 LIFECYCLE EXTENSION (migration 0008):
 * - `authorized_at` — when the CURRENT credential completed authorization
 *   (re-stamped on every reauthorize upsert).
 * - `last_state_change` — when `auth_state` last changed; stamped by
 *   `saveAccount` and `setAuthState`, so the state projection is never
 *   silently stale.
 * - `health` — per-account quota/health notes (typed
 *   `ConnectorAccountHealth`, jsonb at rest). NEVER credential material:
 *   every metadata/health write is pushed through the model-input guard
 *   (see below) and rejected typed at the FIRST secret-shaped field.
 * - PENDING AUTHORIZATIONS — the durable in-flight handshake records
 *   (`savePendingAuthorization` / `loadPendingAuthorization` / delete
 *   discipline). The OAuth/CSRF `state` is the caller-minted opaque token
 *   the provider echoes back; the authorization itself (user, connector,
 *   flow kind, expiry) lives ONLY in this table — never in URLs, never in
 *   logs. ONE live pending per (userId, connectorId): a new begin
 *   supersedes the old one (the connector SDK's evict-on-begin law,
 *   enforced by a UNIQUE index + the store's evict-then-insert transaction).
 *
 * THE MODEL-INPUT PRIVACY LAW, ENFORCED HERE (R03):
 * "Provider credentials never enter model prompts" — any lane that feeds
 * model providers consumes the SAFE ACCOUNT VIEW only
 * (`ConnectorAccountSafeView` / `safeViewsForUser`): a projection that
 * structurally carries NO secret field, is BRAND-protected so an
 * `OpenedConnectorAccount` cannot be assigned where a safe view is
 * expected (compile-time law), and is clean by construction under
 * `assertModelInputFreeOfCredentialMaterial` (the runtime guard,
 * `src/model-input-guard.ts`). The opened-secret channel (`loadAccount`)
 * exists for the CONNECTOR RUNTIME alone — the thing that must present the
 * credential to the provider — and its result is never accepted where a
 * safe view is expected. Defense in depth: `saveAccount`'s metadata and the
 * pending store's metadata REJECT secret-shaped fields at write time, so
 * the client-visible columns can never become a side door.
 *
 * Vocabulary note: `kind` and `authState` mirror the @wfx/connectors
 * `SecretKind` / `AuthSessionState` unions (the source of truth — see
 * packages/connectors/src/auth/{secrets,session}.ts). They are mirrored
 * LOCALLY, not imported, deliberately: WFX-054's connector layer will depend
 * ON this package for durable accounts, and a reverse import would close a
 * dependency cycle. The migration's CHECK constraints are the second line of
 * defense against vocabulary drift.
 */

import { classifyDriverError } from "./classify";
import { CredentialDecryptError, PersistenceError } from "./errors";
import {
  keyIdFor,
  openSecret,
  sealSecret,
  type SealedSecret,
} from "./envelope-crypto";
import {
  assertModelInputFreeOfCredentialMaterial,
  CredentialMaterialError,
} from "./model-input-guard";
import { epochMsToIso, toIsoTimestamp, type DbClient } from "./sql";
import type { Clock } from "@wfx/experience";

/** Credential kind (mirrors @wfx/connectors `SecretKind` — see module docs). */
export type ConnectorCredentialKind =
  | "oauth-token"
  | "device-token"
  | "local-token"
  | "local-userpass";

/** Runtime list of the credential kinds. */
export const CONNECTOR_CREDENTIAL_KINDS: readonly ConnectorCredentialKind[] = [
  "oauth-token",
  "device-token",
  "local-token",
  "local-userpass",
] as const;

/** Auth-session state (mirrors @wfx/connectors `AuthSessionState`). */
export type ConnectorAuthState =
  | "signedOut"
  | "authorizing"
  | "signedIn"
  | "expired"
  | "failed";

/** Runtime list of the auth-session states. */
export const CONNECTOR_AUTH_STATES: readonly ConnectorAuthState[] = [
  "signedOut",
  "authorizing",
  "signedIn",
  "expired",
  "failed",
] as const;

/** The completable auth-flow kinds (a `none` flow never creates a pending). */
export type PendingFlowKind = "oauth" | "device" | "local";

/** Runtime list of the pending flow kinds. */
export const PENDING_FLOW_KINDS: readonly PendingFlowKind[] = [
  "oauth",
  "device",
  "local",
] as const;

/**
 * Per-account quota/health notes (the `health` jsonb column). Source-
 * specific availability truth (e.g. the YouTube daily-quota posture) and
 * the last degradation the source contributed — diagnostic, non-secret,
 * client-visible by design. NEVER credential material: writes are guarded.
 */
export interface ConnectorAccountHealth {
  /** Quota truth note (the provider's documented quota posture). */
  readonly quota?: { readonly note: string; readonly recordedAt: string };
  /** The last degradation this source contributed (never silent). */
  readonly lastDegradation?: { readonly detail: string; readonly recordedAt: string };
  /** Free-form source-specific availability notes. */
  readonly notes?: readonly string[];
}

/** An account record WITHOUT the secret (safe to log/hand around). */
export interface ConnectorAccountRecord {
  /** Canonical account id (`wfxacct_` + 26-char ULID body). */
  readonly id: string;
  readonly userId: string;
  readonly connectorId: string;
  readonly kind: ConnectorCredentialKind;
  readonly authState: ConnectorAuthState;
  /** Rotation fingerprint of the key that sealed the stored credential. */
  readonly keyId: string;
  readonly metadata: Record<string, unknown> | null;
  /** When the CURRENT credential completed authorization (R03; null pre-R03 rows). */
  readonly authorizedAt: string | null;
  /** When `authState` last changed (R03; null pre-R03 rows). */
  readonly lastStateChange: string | null;
  /** Per-account quota/health notes (R03; null when none recorded). */
  readonly health: ConnectorAccountHealth | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** An account plus its OPENED credential secret (caller-only visibility). */
export interface OpenedConnectorAccount extends ConnectorAccountRecord {
  readonly secret: string;
}

// ---------------------------------------------------------------------------
// The safe account view (the model-input privacy law's projection)
// ---------------------------------------------------------------------------

/**
 * Compile-time brand: only {@link toSafeAccountView} mints safe views, so
 * an `OpenedConnectorAccount` (or any hand-built lookalike carrying a
 * secret) is NOT assignable to `ConnectorAccountSafeView`. A real module-
 * scoped symbol (unexported): external code cannot set the property, and
 * `JSON.stringify` ignores symbol keys, so the brand never rides into a
 * serialized payload.
 */
const safeAccountViewBrand = Symbol("wfx-safe-account-view");

/**
 * The account projection NON-CONNECTOR lanes may consume — model inputs,
 * recommendation features, any client-visible surface. Structurally carries
 * NO secret, NO raw metadata (metadata is caller-written; the safe view
 * exposes only the typed, store-owned fields). Pair with
 * `assertModelInputFreeOfCredentialMaterial` for the runtime proof.
 */
export interface ConnectorAccountSafeView {
  readonly [safeAccountViewBrand]: true;
  readonly id: string;
  readonly userId: string;
  readonly connectorId: string;
  readonly kind: ConnectorCredentialKind;
  readonly authState: ConnectorAuthState;
  readonly keyId: string;
  readonly authorizedAt: string | null;
  readonly lastStateChange: string | null;
  readonly health: ConnectorAccountHealth | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Project one account record into the SAFE view (drops the caller-written
 * `metadata` wholesale — it is not store-owned truth and must not ride into
 * model inputs). Pure; the only constructor of `ConnectorAccountSafeView`.
 */
export function toSafeAccountView(record: ConnectorAccountRecord): ConnectorAccountSafeView {
  return {
    [safeAccountViewBrand]: true,
    id: record.id,
    userId: record.userId,
    connectorId: record.connectorId,
    kind: record.kind,
    authState: record.authState,
    keyId: record.keyId,
    authorizedAt: record.authorizedAt,
    lastStateChange: record.lastStateChange,
    health: record.health,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  } as ConnectorAccountSafeView;
}

// ---------------------------------------------------------------------------
// Pending authorizations (the durable in-flight handshake records)
// ---------------------------------------------------------------------------

/** One durable pending-authorization record (R03). */
export interface PendingAuthorizationRecord {
  /** Canonical pending id (`wfxauth_` + 26-char ULID body). */
  readonly id: string;
  readonly userId: string;
  readonly connectorId: string;
  /** The opaque callback token the provider echoes back (CSRF state). */
  readonly state: string;
  readonly flowKind: PendingFlowKind;
  /** When this pending expires (ISO 8601). */
  readonly expiresAt: string;
  readonly createdAt: string;
  /** Non-secret flow context (client-visible; guarded at write). */
  readonly metadata: Record<string, unknown> | null;
}

/** Typed pending load outcome (expired rows are lazily deleted on read). */
export type LoadPendingResult =
  | { ok: true; pending: PendingAuthorizationRecord }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "expired"; expiredAt: string };

/** Typed load outcome. */
export type LoadAccountResult =
  | { ok: true; account: OpenedConnectorAccount }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "key-mismatch"; storedKeyId: string; expectedKeyId: string }
  | { ok: false; reason: "decrypt-failed"; detail: string };

/** Constructor dependencies. */
export interface ConnectorAccountStoreOptions {
  readonly db: DbClient;
  readonly clock: Clock;
  /** The decoded APP_ENCRYPTION_KEY (see `decodeEncryptionKey`). */
  readonly key: Uint8Array;
  /** Id seam for canonical account ids (tests inject a sequential gen). */
  readonly ids: { next(): string };
}

interface AccountSqlRow {
  id: string;
  user_id: string;
  connector_id: string;
  kind: string;
  auth_state: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  key_id: string;
  metadata: unknown;
  authorized_at: unknown;
  last_state_change: unknown;
  health: unknown;
  created_at: unknown;
  updated_at: unknown;
}

interface PendingSqlRow {
  id: string;
  user_id: string;
  connector_id: string;
  state: string;
  flow_kind: string;
  expires_at: unknown;
  created_at: unknown;
  metadata: unknown;
}

/** The persistence-owned account-id prefix (canonical ULID scheme). */
export const CONNECTOR_ACCOUNT_ID_PREFIX = "wfxacct_";

/** The persistence-owned pending-authorization id prefix (R03). */
export const PENDING_AUTHORIZATION_ID_PREFIX = "wfxauth_";

/** Max accepted length of the caller-minted opaque state token. */
const MAX_STATE_TOKEN_LENGTH = 256;

/** Control characters (C0 + DEL) — never legitimate in a state token. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

function nullableIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return toIsoTimestamp(value);
}

function mapAccount(row: AccountSqlRow): ConnectorAccountRecord {
  return {
    id: row.id,
    userId: row.user_id,
    connectorId: row.connector_id,
    kind: row.kind as ConnectorCredentialKind,
    authState: row.auth_state as ConnectorAuthState,
    keyId: row.key_id,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
    authorizedAt: nullableIso(row.authorized_at),
    lastStateChange: nullableIso(row.last_state_change),
    health: (row.health ?? null) as ConnectorAccountHealth | null,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

function mapPending(row: PendingSqlRow): PendingAuthorizationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    connectorId: row.connector_id,
    state: row.state,
    flowKind: row.flow_kind as PendingFlowKind,
    expiresAt: toIsoTimestamp(row.expires_at),
    createdAt: toIsoTimestamp(row.created_at),
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
  };
}

/** Validate a caller-minted opaque state token (shape only). */
function validateStateToken(state: unknown): string {
  if (typeof state !== "string" || state.length === 0) {
    throw new PersistenceError("invalid-input", "state: expected a non-empty opaque token", {
      operation: "connectorAccounts.pendingState",
    });
  }
  if (state.length > MAX_STATE_TOKEN_LENGTH) {
    throw new PersistenceError(
      "invalid-input",
      `state: expected at most ${MAX_STATE_TOKEN_LENGTH} characters`,
      { operation: "connectorAccounts.pendingState" },
    );
  }
  if (CONTROL_CHARS.test(state)) {
    throw new PersistenceError("invalid-input", "state: control characters are not allowed", {
      operation: "connectorAccounts.pendingState",
    });
  }
  return state;
}

/**
 * Guard + stringify a metadata bag for a client-visible column. The
 * privacy law's write-side half: secret-shaped fields are rejected typed
 * (PersistenceError invalid-input naming the offender) BEFORE they can
 * land in a client-visible column.
 */
function guardedMetadata(
  metadata: Record<string, unknown> | undefined,
  operation: string,
): string | null {
  if (metadata === undefined) return null;
  try {
    assertModelInputFreeOfCredentialMaterial(metadata, `${operation}.metadata`);
  } catch (thrown) {
    if (thrown instanceof CredentialMaterialError) {
      throw new PersistenceError(
        "invalid-input",
        `metadata: ${thrown.message}`,
        { operation },
      );
    }
    throw thrown;
  }
  return JSON.stringify(metadata);
}

/** The durable connector-account store. */
export class PostgresConnectorAccountStore {
  private readonly db: DbClient;
  private readonly clock: Clock;
  private readonly key: Uint8Array;
  private readonly ids: { next(): string };

  constructor(options: ConnectorAccountStoreOptions) {
    if (options.key.byteLength !== 32) {
      throw new PersistenceError(
        "config-error",
        "ConnectorAccountStore requires the decoded 32-byte APP_ENCRYPTION_KEY " +
          "(see decodeEncryptionKey) — got a key of a different length.",
        { operation: "ConnectorAccountStore" },
      );
    }
    this.db = options.db;
    this.clock = options.clock;
    this.key = options.key;
    this.ids = options.ids;
  }

  /**
   * Insert or update one account, sealing `secret` under the configured
   * key. One account per (userId, connectorId): a re-save REPLACES the
   * credential (rotation) and keeps the original account id stable. The
   * R03 lifecycle columns are stamped: `authorized_at` = now (the CURRENT
   * credential's completion — re-stamped on reauthorize upsert),
   * `last_state_change` = now.
   *
   * `metadata` is REJECTED typed when it carries credential-shaped fields
   * (the model-input privacy law enforced at the write boundary).
   *
   * Returns the record WITHOUT the secret.
   */
  async saveAccount(input: {
    userId: string;
    connectorId: string;
    kind: ConnectorCredentialKind;
    authState: ConnectorAuthState;
    secret: string;
    metadata?: Record<string, unknown>;
  }): Promise<ConnectorAccountRecord> {
    const problems: string[] = [];
    if (typeof input.userId !== "string" || input.userId.length === 0) {
      problems.push("userId: expected a non-empty string");
    }
    if (typeof input.connectorId !== "string" || input.connectorId.length === 0) {
      problems.push("connectorId: expected a non-empty string");
    }
    if (!CONNECTOR_CREDENTIAL_KINDS.includes(input.kind)) {
      problems.push("kind: expected one of the connector credential kinds");
    }
    if (!CONNECTOR_AUTH_STATES.includes(input.authState)) {
      problems.push("authState: expected one of the connector auth states");
    }
    if (typeof input.secret !== "string" || input.secret.length === 0) {
      problems.push("secret: expected a non-empty string");
    }
    if (problems.length > 0) {
      throw new PersistenceError("invalid-input", problems.join("; "), {
        operation: "connectorAccounts.saveAccount",
      });
    }

    const nowIso = epochMsToIso(this.clock.now());
    const sealed: SealedSecret = sealSecret(this.key, input.secret);
    const id = `${CONNECTOR_ACCOUNT_ID_PREFIX}${this.ids.next()}`;
    const metadataJson = guardedMetadata(input.metadata, "connectorAccounts.saveAccount");

    try {
      // `health` resets to NULL on every credential (re)save: the new
      // credential's quota/health posture is unknown until observed — the
      // stale previous notes would be a lie.
      const rows = await this.db.query<AccountSqlRow>(
        `INSERT INTO connector_accounts (id, user_id, connector_id, kind, auth_state, ciphertext,
                                         iv, auth_tag, key_id, metadata, authorized_at,
                                         last_state_change, health, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $11, NULL, $11, $11)
         ON CONFLICT (user_id, connector_id) DO UPDATE SET
           kind = EXCLUDED.kind,
           auth_state = EXCLUDED.auth_state,
           ciphertext = EXCLUDED.ciphertext,
           iv = EXCLUDED.iv,
           auth_tag = EXCLUDED.auth_tag,
           key_id = EXCLUDED.key_id,
           metadata = EXCLUDED.metadata,
           authorized_at = EXCLUDED.authorized_at,
           last_state_change = EXCLUDED.last_state_change,
           health = EXCLUDED.health,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          id,
          input.userId,
          input.connectorId,
          input.kind,
          input.authState,
          sealed.ciphertext,
          sealed.iv,
          sealed.authTag,
          sealed.keyId,
          metadataJson,
          nowIso,
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("saveAccount: no row returned");
      return mapAccount(row);
    } catch (thrown) {
      if (thrown instanceof PersistenceError) throw thrown;
      throw classifyDriverError(thrown, "connectorAccounts.saveAccount");
    }
  }

  /**
   * Load one account and open its credential. Typed outcomes: `not-found`,
   * `key-mismatch` (rotation detection — different key sealed the row),
   * `decrypt-failed` (tampered envelope). The opened secret is handed to
   * the caller only.
   */
  async loadAccount(userId: string, connectorId: string): Promise<LoadAccountResult> {
    let row: AccountSqlRow | undefined;
    try {
      const rows = await this.db.query<AccountSqlRow>(
        `SELECT * FROM connector_accounts WHERE user_id = $1 AND connector_id = $2`,
        [userId, connectorId],
      );
      row = rows[0];
    } catch (thrown) {
      throw classifyDriverError(thrown, "connectorAccounts.loadAccount");
    }
    if (row === undefined) return { ok: false, reason: "not-found" };

    const expectedKeyId = keyIdFor(this.key);
    if (row.key_id !== expectedKeyId) {
      return {
        ok: false,
        reason: "key-mismatch",
        storedKeyId: row.key_id,
        expectedKeyId,
      };
    }

    let secret: string;
    try {
      secret = openSecret(this.key, {
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.auth_tag,
      });
    } catch (thrown) {
      const detail =
        thrown instanceof CredentialDecryptError
          ? thrown.message
          : "credential envelope failed to open";
      return { ok: false, reason: "decrypt-failed", detail };
    }
    return { ok: true, account: { ...mapAccount(row), secret } };
  }

  /**
   * Update only the auth-state projection (no credential rewrite). Stamps
   * `last_state_change` (R03) so the projection's clock truth is durable.
   */
  async setAuthState(
    userId: string,
    connectorId: string,
    authState: ConnectorAuthState,
  ): Promise<ConnectorAccountRecord | null> {
    if (!CONNECTOR_AUTH_STATES.includes(authState)) {
      throw new PersistenceError("invalid-input", "authState: expected a connector auth state", {
        operation: "connectorAccounts.setAuthState",
      });
    }
    const nowIso = epochMsToIso(this.clock.now());
    try {
      const rows = await this.db.query<AccountSqlRow>(
        `UPDATE connector_accounts
            SET auth_state = $3, last_state_change = $4, updated_at = $4
          WHERE user_id = $1 AND connector_id = $2 RETURNING *`,
        [userId, connectorId, authState, nowIso],
      );
      const row = rows[0];
      return row === undefined ? null : mapAccount(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "connectorAccounts.setAuthState");
    }
  }

  /**
   * Record per-account quota/health notes (the `health` column). Typed
   * shape, guarded against credential material (the write-boundary law).
   * Returns the updated record, or `null` when no account exists (honest
   * absence — a health note for a disconnected source is not fabricated).
   */
  async saveAccountHealth(
    userId: string,
    connectorId: string,
    health: ConnectorAccountHealth,
  ): Promise<ConnectorAccountRecord | null> {
    const problems = validateHealth(health);
    if (problems.length > 0) {
      throw new PersistenceError("invalid-input", problems.join("; "), {
        operation: "connectorAccounts.saveAccountHealth",
      });
    }
    try {
      assertModelInputFreeOfCredentialMaterial(health, "connectorAccounts.saveAccountHealth");
    } catch (thrown) {
      if (thrown instanceof CredentialMaterialError) {
        throw new PersistenceError("invalid-input", `health: ${thrown.message}`, {
          operation: "connectorAccounts.saveAccountHealth",
        });
      }
      throw thrown;
    }
    const nowIso = epochMsToIso(this.clock.now());
    try {
      const rows = await this.db.query<AccountSqlRow>(
        `UPDATE connector_accounts
            SET health = $3::jsonb, updated_at = $4
          WHERE user_id = $1 AND connector_id = $2 RETURNING *`,
        [userId, connectorId, JSON.stringify(health), nowIso],
      );
      const row = rows[0];
      return row === undefined ? null : mapAccount(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "connectorAccounts.saveAccountHealth");
    }
  }

  /** Delete one account (sign-out / disconnect). True when a row was removed. */
  async deleteAccount(userId: string, connectorId: string): Promise<boolean> {
    try {
      const rows = await this.db.query<{ id: string }>(
        `DELETE FROM connector_accounts WHERE user_id = $1 AND connector_id = $2 RETURNING id`,
        [userId, connectorId],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "connectorAccounts.deleteAccount");
    }
  }

  /** List a user's account records (NO secrets — metadata only). */
  async listForUser(userId: string): Promise<readonly ConnectorAccountRecord[]> {
    try {
      const rows = await this.db.query<AccountSqlRow>(
        `SELECT * FROM connector_accounts WHERE user_id = $1 ORDER BY connector_id`,
        [userId],
      );
      return rows.map(mapAccount);
    } catch (thrown) {
      throw classifyDriverError(thrown, "connectorAccounts.listForUser");
    }
  }

  /**
   * The MODEL-INPUT-SAFE account views for a user (R03 privacy law): the
   * projection non-connector lanes consume — no secret, no raw metadata,
   * brand-protected. Built from `listForUser` without ever opening an
   * envelope; pass the result through
   * `assertModelInputFreeOfCredentialMaterial` for the runtime proof that
   * no credential material rides along (the tests do exactly that).
   */
  async safeViewsForUser(userId: string): Promise<readonly ConnectorAccountSafeView[]> {
    const records = await this.listForUser(userId);
    return records.map(toSafeAccountView);
  }

  // — pending authorizations (R03) ———————————————————————————————————

  /**
   * Persist one pending authorization (an in-flight handshake). ONE live
   * pending per (userId, connectorId): prior pendings for the pair are
   * evicted in the same transaction (a new begin supersedes the old — the
   * connector SDK's law, made durable).
   *
   * `state` is the caller-minted opaque token the provider echoes back;
   * the authorization itself (user, connector, flow, expiry) lives ONLY
   * here. `metadata` is client-visible non-secret flow context and is
   * REJECTED typed when it carries credential-shaped fields.
   */
  async savePendingAuthorization(input: {
    userId: string;
    connectorId: string;
    state: string;
    flowKind: PendingFlowKind;
    /** Expiry as epoch milliseconds (the injected clock's domain). */
    expiresAtMs: number;
    metadata?: Record<string, unknown>;
  }): Promise<PendingAuthorizationRecord> {
    const problems: string[] = [];
    if (typeof input.userId !== "string" || input.userId.length === 0) {
      problems.push("userId: expected a non-empty string");
    }
    if (typeof input.connectorId !== "string" || input.connectorId.length === 0) {
      problems.push("connectorId: expected a non-empty string");
    }
    if (!PENDING_FLOW_KINDS.includes(input.flowKind)) {
      problems.push("flowKind: expected one of oauth | device | local");
    }
    if (
      typeof input.expiresAtMs !== "number" ||
      !Number.isFinite(input.expiresAtMs) ||
      input.expiresAtMs <= 0
    ) {
      problems.push("expiresAtMs: expected a finite positive epoch-milliseconds number");
    }
    if (problems.length > 0) {
      throw new PersistenceError("invalid-input", problems.join("; "), {
        operation: "connectorAccounts.savePendingAuthorization",
      });
    }
    const state = validateStateToken(input.state);
    const metadataJson = guardedMetadata(
      input.metadata,
      "connectorAccounts.savePendingAuthorization",
    );

    const nowIso = epochMsToIso(this.clock.now());
    const expiresIso = epochMsToIso(input.expiresAtMs);
    const id = `${PENDING_AUTHORIZATION_ID_PREFIX}${this.ids.next()}`;

    try {
      return await this.db.begin(async (tx) => {
        // Evict the prior live pending for this (user, connector) — the
        // supersession law, atomic with the insert.
        await tx.query(
          `DELETE FROM connector_pending_authorizations
            WHERE user_id = $1 AND connector_id = $2`,
          [input.userId, input.connectorId],
        );
        const rows = await tx.query<PendingSqlRow>(
          `INSERT INTO connector_pending_authorizations
               (id, user_id, connector_id, state, flow_kind, expires_at, created_at, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
           RETURNING *`,
          [id, input.userId, input.connectorId, state, input.flowKind, expiresIso, nowIso, metadataJson],
        );
        const row = rows[0];
        if (row === undefined) throw new Error("savePendingAuthorization: no row returned");
        return mapPending(row);
      });
    } catch (thrown) {
      if (thrown instanceof PersistenceError) throw thrown;
      throw classifyDriverError(thrown, "connectorAccounts.savePendingAuthorization");
    }
  }

  /**
   * Load one pending authorization by its opaque state token. Typed
   * outcomes: `not-found` (unknown/consumed/superseded state) and
   * `expired` (the TTL elapsed — the row is lazily deleted on read, so an
   * expired pending is consumed exactly once).
   */
  async loadPendingAuthorization(state: string): Promise<LoadPendingResult> {
    const token = validateStateToken(state);
    let row: PendingSqlRow | undefined;
    try {
      const rows = await this.db.query<PendingSqlRow>(
        `SELECT * FROM connector_pending_authorizations WHERE state = $1`,
        [token],
      );
      row = rows[0];
    } catch (thrown) {
      throw classifyDriverError(thrown, "connectorAccounts.loadPendingAuthorization");
    }
    if (row === undefined) return { ok: false, reason: "not-found" };

    if (this.clock.now() >= new Date(toIsoTimestamp(row.expires_at)).getTime()) {
      // Lazy GC: the expired pending is consumed by this very read.
      await this.deletePendingAuthorization(token);
      return { ok: false, reason: "expired", expiredAt: toIsoTimestamp(row.expires_at) };
    }
    return { ok: true, pending: mapPending(row) };
  }

  /**
   * The LIVE pending authorization for one (userId, connectorId), or null
   * when none exists (never begun, superseded, or consumed). An expired
   * pending is consumed by this very read (the lazy-GC law) and answers
   * null — the state is honestly "not authorizing anymore".
   */
  async livePendingFor(
    userId: string,
    connectorId: string,
  ): Promise<PendingAuthorizationRecord | null> {
    let row: PendingSqlRow | undefined;
    try {
      const rows = await this.db.query<PendingSqlRow>(
        `SELECT * FROM connector_pending_authorizations
          WHERE user_id = $1 AND connector_id = $2`,
        [userId, connectorId],
      );
      row = rows[0];
    } catch (thrown) {
      throw classifyDriverError(thrown, "connectorAccounts.livePendingFor");
    }
    if (row === undefined) return null;
    if (this.clock.now() >= new Date(toIsoTimestamp(row.expires_at)).getTime()) {
      await this.deletePendingAuthorization(row.state);
      return null;
    }
    return mapPending(row);
  }

  /**
   * Delete one pending authorization (callback completion / abandonment).
   * Idempotent: `false` when the state was unknown (already consumed,
   * superseded, or never issued).
   */
  async deletePendingAuthorization(state: string): Promise<boolean> {
    const token = validateStateToken(state);
    try {
      const rows = await this.db.query<{ id: string }>(
        `DELETE FROM connector_pending_authorizations WHERE state = $1 RETURNING id`,
        [token],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "connectorAccounts.deletePendingAuthorization");
    }
  }

  /**
   * Evict every live pending for one (userId, connectorId) — the
   * disconnect/reauthorize discipline. Returns how many were evicted.
   */
  async deletePendingAuthorizationsFor(userId: string, connectorId: string): Promise<number> {
    try {
      const rows = await this.db.query<{ id: string }>(
        `DELETE FROM connector_pending_authorizations
          WHERE user_id = $1 AND connector_id = $2 RETURNING id`,
        [userId, connectorId],
      );
      return rows.length;
    } catch (thrown) {
      throw classifyDriverError(thrown, "connectorAccounts.deletePendingAuthorizationsFor");
    }
  }
}

/** Structural validation for the health-notes bag (typed problems list). */
function validateHealth(health: unknown): string[] {
  const problems: string[] = [];
  if (!isPlainObjectBag(health)) {
    return ["health: expected a ConnectorAccountHealth object"];
  }
  if (health["quota"] !== undefined) {
    const quota = health["quota"];
    if (!isPlainObjectBag(quota) || typeof quota["note"] !== "string" || typeof quota["recordedAt"] !== "string") {
      problems.push("health.quota: expected { note: string, recordedAt: string }");
    }
  }
  if (health["lastDegradation"] !== undefined) {
    const last = health["lastDegradation"];
    if (!isPlainObjectBag(last) || typeof last["detail"] !== "string" || typeof last["recordedAt"] !== "string") {
      problems.push("health.lastDegradation: expected { detail: string, recordedAt: string }");
    }
  }
  if (health["notes"] !== undefined) {
    const notes = health["notes"];
    if (!Array.isArray(notes) || notes.some((note) => typeof note !== "string")) {
      problems.push("health.notes: expected an array of strings");
    }
  }
  return problems;
}

function isPlainObjectBag(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
