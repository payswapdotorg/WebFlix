/**
 * @wfx/persistence — connector accounts with envelope-encrypted credentials
 * (WFX-052; R03 source-management lifecycle).
 *
 * The durable account state a connector's auth session projects onto
 * (migration 0005 + migration 0008's lifecycle columns), for WFX-054
 * (YouTube connector) and beyond:
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
 * R03 LIFECYCLE (migration 0008):
 * - `authorized_at` — stamped on every save/transition INTO `signedIn`
 *   (re-authorization upserts refresh it; the account id + created_at stay
 *   stable — the "reauthorize preserves the account row" law).
 * - `last_state_change` — stamped on every save and every `setAuthState`.
 * - `availability_notes` — per-account quota/health notes (never credential
 *   material; `setAvailabilityNotes` writes them, the /sources read serves
 *   them).
 * - PENDING AUTHORIZATIONS — the in-flight oauth/device handshake records
 *   (state + expiry), stored server-side keyed by the host-minted CSRF
 *   state token. `savePendingAuthorization` / `loadPendingAuthorization`
 *   (typed `not-found` / `expired`) / `completePendingAuthorization` /
 *   `evictPendingAuthorizations` (supersession) / `listPendingAuthorizationsForUser`.
 *
 * THE MODEL-INPUT PRIVACY LAW, ENFORCED HERE (R03): any lane that feeds
 * model providers consumes ONLY the secret-free projections —
 * `ConnectorAccountRecord` (this module) and `ModelSafeSourceSummary`
 * (`src/model-input.ts`, the structurally secret-free view + the runtime
 * `assertNoCredentialMaterial` guard). The ONLY method that can produce a
 * secret is `loadAccount`, which exists for the CONNECTOR runtime lane
 * (token refresh, provider calls) — never for model/recommendation inputs.
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

/** Auth-flow kind (mirrors @wfx/connectors `AuthFlow["kind"]`). */
export type ConnectorFlowKind = "none" | "oauth" | "device" | "local";

/** Runtime list of the auth-flow kinds. */
export const CONNECTOR_FLOW_KINDS: readonly ConnectorFlowKind[] = [
  "none",
  "oauth",
  "device",
  "local",
] as const;

/** Runtime membership check against the flow-kind union. */
export function isConnectorFlowKind(x: unknown): x is ConnectorFlowKind {
  return typeof x === "string" && CONNECTOR_FLOW_KINDS.includes(x as ConnectorFlowKind);
}

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
  /** R03: when the CURRENT authorization was granted (null before the first sign-in). */
  readonly authorizedAt: string | null;
  /** R03: when `authState` last changed (the recency of the authorization truth). */
  readonly lastStateChange: string | null;
  /** R03: per-account quota/health notes (never credential material). */
  readonly availabilityNotes: readonly string[] | null;
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
  authorized_at: unknown | null;
  last_state_change: unknown | null;
  availability_notes: unknown | null;
  created_at: unknown;
  updated_at: unknown;
}

/** A pending-authorization row (migration 0008). */
interface PendingSqlRow {
  state: string;
  user_id: string;
  connector_id: string;
  flow_kind: string;
  redirect_uri: string | null;
  created_at: unknown;
  expires_at: unknown;
}

/** A durable pending-authorization record (safe to hand around — no secrets by construction). */
export interface PendingAuthorizationRecord {
  /** The host-minted CSRF state token (the OAuth `state` / device binding). */
  readonly state: string;
  readonly userId: string;
  readonly connectorId: string;
  readonly flowKind: ConnectorFlowKind;
  /** The redirect URI the handshake started with, when the flow carries one. */
  readonly redirectUri: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/** Typed pending-load outcome. */
export type LoadPendingResult =
  | { ok: true; pending: PendingAuthorizationRecord }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "expired"; expiredAt: string };

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
    authorizedAt: row.authorized_at === null || row.authorized_at === undefined ? null : toIsoTimestamp(row.authorized_at),
    lastStateChange:
      row.last_state_change === null || row.last_state_change === undefined
        ? null
        : toIsoTimestamp(row.last_state_change),
    availabilityNotes: mapNotes(row.availability_notes),
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

/** Normalize a jsonb notes column to a readonly string array (or null). */
function mapNotes(value: unknown): readonly string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  return value.filter((note): note is string => typeof note === "string");
}

function mapPending(row: PendingSqlRow): PendingAuthorizationRecord {
  return {
    state: row.state,
    userId: row.user_id,
    connectorId: row.connector_id,
    flowKind: row.flow_kind as ConnectorFlowKind,
    redirectUri: row.redirect_uri ?? null,
    createdAt: toIsoTimestamp(row.created_at),
    expiresAt: toIsoTimestamp(row.expires_at),
  };
}

/** Validate a notes list (strings, bounded, no control characters). */
function validateNotes(notes: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const note of notes) {
    if (typeof note !== "string" || note.trim().length === 0) {
      throw new PersistenceError("invalid-input", "notes: expected non-empty strings", {
        operation: "connectorAccounts.validateNotes",
      });
    }
    if (note.length > 500) {
      throw new PersistenceError(
        "invalid-input",
        "notes: entries must be at most 500 characters",
        { operation: "connectorAccounts.validateNotes" },
      );
    }
    if (/[\u0000-\u001F\u007F]/.test(note)) {
      throw new PersistenceError("invalid-input", "notes: control characters are not allowed", {
        operation: "connectorAccounts.validateNotes",
      });
    }
    out.push(note);
  }
  if (out.length > 32) {
    throw new PersistenceError("invalid-input", "notes: at most 32 entries", {
      operation: "connectorAccounts.validateNotes",
    });
  }
  return out;
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
   * credential (rotation / re-authorization) and keeps the original account
   * id + created_at stable — the R03 "reauthorize preserves the account
   * row" law. Lifecycle stamps (R03, migration 0008): `last_state_change`
   * is always `now`; `authorized_at` is `now` when saving INTO `signedIn`
   * (and cleared otherwise). `availabilityNotes` may be supplied to set the
   * per-account quota/health notes atomically with the save.
   * Returns the record WITHOUT the secret.
   */
  async saveAccount(input: {
    userId: string;
    connectorId: string;
    kind: ConnectorCredentialKind;
    authState: ConnectorAuthState;
    secret: string;
    metadata?: Record<string, unknown>;
    availabilityNotes?: readonly string[];
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
    let notes: string[] | undefined;
    if (input.availabilityNotes !== undefined) {
      if (!Array.isArray(input.availabilityNotes)) {
        problems.push("availabilityNotes: expected an array of strings");
      } else {
        try {
          notes = validateNotes(input.availabilityNotes);
        } catch (thrown) {
          problems.push(thrown instanceof PersistenceError ? thrown.message : "availabilityNotes: invalid");
        }
      }
    }
    if (problems.length > 0) {
      throw new PersistenceError("invalid-input", problems.join("; "), {
        operation: "connectorAccounts.saveAccount",
      });
    }

    const nowIso = epochMsToIso(this.clock.now());
    const sealed: SealedSecret = sealSecret(this.key, input.secret);
    const id = `${CONNECTOR_ACCOUNT_ID_PREFIX}${this.ids.next()}`;
    const authorizedAtIso = input.authState === "signedIn" ? nowIso : null;

    try {
      const rows = await this.db.query<AccountSqlRow>(
        `INSERT INTO connector_accounts (id, user_id, connector_id, kind, auth_state, ciphertext,
                                         iv, auth_tag, key_id, metadata, authorized_at,
                                         last_state_change, availability_notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13::jsonb, $14, $14)
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
           availability_notes = EXCLUDED.availability_notes,
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
          authorizedAtIso,
          nowIso,
          notes === undefined ? null : JSON.stringify(notes),
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

  /**
   * Update only the auth-state projection (no credential rewrite). R03:
   * stamps `last_state_change`, and refreshes `authorized_at` when the
   * target state is `signedIn` (a re-authorization is a new authorization).
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
            SET auth_state = $3,
                last_state_change = $4,
                authorized_at = CASE WHEN $3 = 'signedIn' THEN $4 ELSE authorized_at END,
                updated_at = $4
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
   * R03: overwrite a connected account's per-account quota/health notes
   * (never credential material). Returns the updated record, or null when
   * no account row exists (an honest miss — notes belong to a connection).
   */
  async setAvailabilityNotes(
    userId: string,
    connectorId: string,
    notes: readonly string[],
  ): Promise<ConnectorAccountRecord | null> {
    const validated = validateNotes(notes);
    const nowIso = epochMsToIso(this.clock.now());
    try {
      const rows = await this.db.query<AccountSqlRow>(
        `UPDATE connector_accounts
            SET availability_notes = $3::jsonb, updated_at = $4
         WHERE user_id = $1 AND connector_id = $2 RETURNING *`,
        [userId, connectorId, JSON.stringify(validated), nowIso],
      );
      const row = rows[0];
      return row === undefined ? null : mapAccount(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "connectorAccounts.setAvailabilityNotes");
    }
  }

  /**
   * Delete one account (sign-out / disconnect). True when a row was removed.
   * R03: any pending authorization for the same (user, connector) is evicted
   * with the account — a disconnect cancels the in-flight handshake too (the
   * delete discipline: the sealed envelope row AND its handshake state go).
   */
  async deleteAccount(userId: string, connectorId: string): Promise<boolean> {
    try {
      const rows = await this.db.query<{ id: string }>(
        `DELETE FROM connector_accounts WHERE user_id = $1 AND connector_id = $2 RETURNING id`,
        [userId, connectorId],
      );
      await this.evictPendingAuthorizations(userId, connectorId);
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

  // -------------------------------------------------------------------------
  // R03 — pending authorizations (the in-flight oauth/device handshakes)
  // -------------------------------------------------------------------------

  /**
   * Store one pending authorization. The caller mints the `state` token
   * (the OAuth CSRF / device binding) and owns supersession — call
   * {@link evictPendingAuthorizations} first (the usual wiring) so at most
   * ONE live pending per (user, connector) exists. A state token is a
   * PRIMARY KEY and this insert NEVER overwrites: reusing a live state
   * throws the typed constraint-violation failure (loud, never a silent
   * takeover of an in-flight handshake).
   */
  async savePendingAuthorization(input: {
    state: string;
    userId: string;
    connectorId: string;
    flowKind: ConnectorFlowKind;
    redirectUri?: string;
    /** Expiry as epoch milliseconds (the injected clock's domain). */
    expiresAtMs: number;
  }): Promise<PendingAuthorizationRecord> {
    const problems: string[] = [];
    if (typeof input.state !== "string" || input.state.trim().length === 0) {
      problems.push("state: expected a non-empty string");
    } else if (input.state.length > 128 || /[\u0000-\u001F\u007F]/.test(input.state)) {
      problems.push("state: expected at most 128 characters without control characters");
    }
    if (typeof input.userId !== "string" || input.userId.length === 0) {
      problems.push("userId: expected a non-empty string");
    }
    if (typeof input.connectorId !== "string" || input.connectorId.length === 0) {
      problems.push("connectorId: expected a non-empty string");
    }
    if (!isConnectorFlowKind(input.flowKind)) {
      problems.push("flowKind: expected one of none | oauth | device | local");
    }
    if (typeof input.expiresAtMs !== "number" || !Number.isFinite(input.expiresAtMs) || input.expiresAtMs < 0) {
      problems.push("expiresAtMs: expected a finite non-negative epoch-milliseconds number");
    }
    if (
      input.redirectUri !== undefined &&
      (typeof input.redirectUri !== "string" || !/^https?:\/\//.test(input.redirectUri))
    ) {
      problems.push("redirectUri: when present, expected an absolute http(s) URL");
    }
    if (problems.length > 0) {
      throw new PersistenceError("invalid-input", problems.join("; "), {
        operation: "connectorAccounts.savePendingAuthorization",
      });
    }

    const nowIso = epochMsToIso(this.clock.now());
    try {
      const rows = await this.db.query<PendingSqlRow>(
        `INSERT INTO connector_pending_authorizations
           (state, user_id, connector_id, flow_kind, redirect_uri, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          input.state,
          input.userId,
          input.connectorId,
          input.flowKind,
          input.redirectUri ?? null,
          nowIso,
          epochMsToIso(input.expiresAtMs),
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("savePendingAuthorization: no row returned");
      return mapPending(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "connectorAccounts.savePendingAuthorization");
    }
  }

  /**
   * Load one pending authorization by its state token, checked against the
   * clock: an expired pending answers the typed `expired` outcome (the row
   * is deleted — an expired handshake is dead, never resurrectable).
   */
  async loadPendingAuthorization(state: string): Promise<LoadPendingResult> {
    if (typeof state !== "string" || state.trim().length === 0) {
      throw new PersistenceError("invalid-input", "state: expected a non-empty string", {
        operation: "connectorAccounts.loadPendingAuthorization",
      });
    }
    let row: PendingSqlRow | undefined;
    try {
      const rows = await this.db.query<PendingSqlRow>(
        `SELECT * FROM connector_pending_authorizations WHERE state = $1`,
        [state],
      );
      row = rows[0];
    } catch (thrown) {
      throw classifyDriverError(thrown, "connectorAccounts.loadPendingAuthorization");
    }
    if (row === undefined) return { ok: false, reason: "not-found" };

    const expiresAtIso = toIsoTimestamp(row.expires_at);
    if (this.clock.now() >= Date.parse(expiresAtIso)) {
      await this.completePendingAuthorization(state);
      return { ok: false, reason: "expired", expiredAt: expiresAtIso };
    }
    return { ok: true, pending: mapPending(row) };
  }

  /** Complete (consume) one pending authorization. True when a row existed. */
  async completePendingAuthorization(state: string): Promise<boolean> {
    if (typeof state !== "string" || state.trim().length === 0) {
      throw new PersistenceError("invalid-input", "state: expected a non-empty string", {
        operation: "connectorAccounts.completePendingAuthorization",
      });
    }
    try {
      const rows = await this.db.query<{ state: string }>(
        `DELETE FROM connector_pending_authorizations WHERE state = $1 RETURNING state`,
        [state],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "connectorAccounts.completePendingAuthorization");
    }
  }

  /**
   * Evict every pending authorization for one (user, connector) — the
   * supersession step before a fresh connect/reauthorize begins. Returns
   * how many rows were removed.
   */
  async evictPendingAuthorizations(userId: string, connectorId: string): Promise<number> {
    if (typeof userId !== "string" || userId.length === 0) {
      throw new PersistenceError("invalid-input", "userId: expected a non-empty string", {
        operation: "connectorAccounts.evictPendingAuthorizations",
      });
    }
    if (typeof connectorId !== "string" || connectorId.length === 0) {
      throw new PersistenceError("invalid-input", "connectorId: expected a non-empty string", {
        operation: "connectorAccounts.evictPendingAuthorizations",
      });
    }
    try {
      const rows = await this.db.query<{ state: string }>(
        `DELETE FROM connector_pending_authorizations
          WHERE user_id = $1 AND connector_id = $2 RETURNING state`,
        [userId, connectorId],
      );
      return rows.length;
    } catch (thrown) {
      throw classifyDriverError(thrown, "connectorAccounts.evictPendingAuthorizations");
    }
  }

  /** List a user's pending-authorization records (live and expired rows as stored). */
  async listPendingAuthorizationsForUser(
    userId: string,
  ): Promise<readonly PendingAuthorizationRecord[]> {
    try {
      const rows = await this.db.query<PendingSqlRow>(
        `SELECT * FROM connector_pending_authorizations
          WHERE user_id = $1 ORDER BY connector_id, created_at`,
        [userId],
      );
      return rows.map(mapPending);
    } catch (thrown) {
      throw classifyDriverError(thrown, "connectorAccounts.listPendingAuthorizationsForUser");
    }
  }
}
