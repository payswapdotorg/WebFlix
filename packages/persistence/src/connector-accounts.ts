/**
 * @wfx/persistence — connector accounts with envelope-encrypted credentials
 * (WFX-052).
 *
 * The durable account state a connector's auth session projects onto
 * (migration 0005), for WFX-054 (YouTube connector) and beyond:
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
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** An account plus its OPENED credential secret (caller-only visibility). */
export interface OpenedConnectorAccount extends ConnectorAccountRecord {
  readonly secret: string;
}

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
  created_at: unknown;
  updated_at: unknown;
}

/** The persistence-owned account-id prefix (canonical ULID scheme). */
export const CONNECTOR_ACCOUNT_ID_PREFIX = "wfxacct_";

function mapAccount(row: AccountSqlRow): ConnectorAccountRecord {
  return {
    id: row.id,
    userId: row.user_id,
    connectorId: row.connector_id,
    kind: row.kind as ConnectorCredentialKind,
    authState: row.auth_state as ConnectorAuthState,
    keyId: row.key_id,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
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
   * credential (rotation) and keeps the original account id stable.
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

    try {
      const rows = await this.db.query<AccountSqlRow>(
        `INSERT INTO connector_accounts (id, user_id, connector_id, kind, auth_state, ciphertext,
                                         iv, auth_tag, key_id, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $11)
         ON CONFLICT (user_id, connector_id) DO UPDATE SET
           kind = EXCLUDED.kind,
           auth_state = EXCLUDED.auth_state,
           ciphertext = EXCLUDED.ciphertext,
           iv = EXCLUDED.iv,
           auth_tag = EXCLUDED.auth_tag,
           key_id = EXCLUDED.key_id,
           metadata = EXCLUDED.metadata,
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
          input.metadata === undefined ? null : JSON.stringify(input.metadata),
          nowIso,
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("saveAccount: no row returned");
      return mapAccount(row);
    } catch (thrown) {
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

  /** Update only the auth-state projection (no credential rewrite). */
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
        `UPDATE connector_accounts SET auth_state = $3, updated_at = $4
         WHERE user_id = $1 AND connector_id = $2 RETURNING *`,
        [userId, connectorId, authState, nowIso],
      );
      const row = rows[0];
      return row === undefined ? null : mapAccount(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "connectorAccounts.setAuthState");
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
}
