/**
 * @wfx/persistence — BYOM provider bindings with envelope-encrypted keys
 * (R06; the 0005 connector-accounts discipline verbatim applied to BYOM).
 *
 * ONE binding per (effective profile, providerId) — UNIQUE, upserted. The
 * API key (or other provider credential) is sealed with AES-256-GCM
 * (`src/envelope-crypto.ts`, key = APP_ENCRYPTION_KEY): ciphertext + IV +
 * auth_tag + key_id stored, plaintext NEVER at rest. `saveBinding`
 * accepts the raw key and seals it; `loadBinding` opens the envelope and
 * hands the key to the CALLER ONLY — never logged, never persisted, never
 * in a URL, never in a model prompt. The save answers a HANDLE + metadata
 * only — the response NEVER contains key material (the R06 privacy law).
 *
 * - `key_id` mismatch is detected BEFORE decryption is attempted (rotation
 *   observability — the same law as connector-accounts).
 * - Tampered envelopes fail typed (`CredentialDecryptError`) — never garbage
 *   plaintext, never fake success.
 * - DELETE removes the row (the sealed material destroyed per the vault's
 *   delete discipline — the same law as connector-accounts.deleteAccount).
 *
 * THE PRIVACY LAW (R06, doubled): the model-input lane structurally cannot
 * read BYOM keys. The only method that produces a key is `loadBinding`, and
 * it exists for the FABRIC TRANSPORT lane (provider invocation) — NEVER for
 * model/recommendation inputs. The store's read-side list (`listForProfile`)
 * answers ONLY the secret-free projections — `ByomProviderBindingRecord`.
 * A test (packages/persistence/tests/model-controls.test.ts) pins the
 * structural isolation: the model-input lane consumes
 * `ModelSafeSourceSummary` (R03) and this module's secret-free records;
 * the secret surfaces ONLY through `loadBinding` for the transport lane.
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
import type { Clock, IdGen } from "@wfx/experience";

/** Prefix for byom-binding ids minted by this store. */
export const BYOM_BINDING_ID_PREFIX = "wfxbind_";

/** Maximum length of a stored provider id. */
export const PROVIDER_ID_MAX_LENGTH = 128;

/** Maximum length of a stored endpoint URL. */
export const ENDPOINT_URL_MAX_LENGTH = 2048;

/** A binding record WITHOUT the secret (safe to log/hand around). */
export interface ByomProviderBindingRecord {
  /** Canonical binding id (`wfxbind_` + 26-char ULID body). */
  readonly id: string;
  readonly userId: string;
  readonly profileId: string | null;
  readonly providerId: string;
  /** The provider's endpoint URL (the transport target; never a secret). */
  readonly endpointUrl: string;
  /** Rotation fingerprint of the key that sealed the stored key material. */
  readonly keyId: string;
  /** Optional provider metadata (model id, version, capabilities — never secrets). */
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A binding plus its OPENED key (caller-only visibility — the transport lane). */
export interface OpenedByomBinding extends ByomProviderBindingRecord {
  readonly key: string;
}

/** Typed load outcome. */
export type LoadByomBindingResult =
  | { ok: true; binding: OpenedByomBinding }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "key-mismatch"; storedKeyId: string; expectedKeyId: string }
  | { ok: false; reason: "decrypt-failed"; detail: string };

/** Constructor dependencies. */
export interface ByomBindingStoreOptions {
  readonly db: DbClient;
  readonly clock: Clock;
  readonly key: Uint8Array;
  readonly ids: IdGen;
}

interface BindingSqlRow {
  id: string;
  user_id: string;
  profile_id: string | null;
  provider_id: string;
  endpoint_url: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  key_id: string;
  metadata: unknown;
  created_at: unknown;
  updated_at: unknown;
}

function mapBinding(row: BindingSqlRow): ByomProviderBindingRecord {
  return {
    id: row.id,
    userId: row.user_id,
    profileId: row.profile_id,
    providerId: row.provider_id,
    endpointUrl: row.endpoint_url,
    keyId: row.key_id,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

/** The durable BYOM-provider-binding store. */
export class PostgresByomBindingStore {
  private readonly db: DbClient;
  private readonly clock: Clock;
  private readonly key: Uint8Array;
  private readonly ids: IdGen;

  constructor(options: ByomBindingStoreOptions) {
    if (options.key.byteLength !== 32) {
      throw new PersistenceError(
        "config-error",
        "ByomBindingStore requires the decoded 32-byte APP_ENCRYPTION_KEY " +
          "(see decodeEncryptionKey) — got a key of a different length.",
        { operation: "ByomBindingStore" },
      );
    }
    this.db = options.db;
    this.clock = options.clock;
    this.key = options.key;
    this.ids = options.ids;
  }

  /**
   * Insert or update one BYOM binding, sealing `key` under the configured
   * envelope key. One binding per (effective profile, providerId): a
   * re-save REPLACES the key (rotation) and keeps the original binding id
   * + created_at stable — the R06 rotation law (verbatim from
   * connector-accounts). Returns the record WITHOUT the key (the handle +
   * metadata — the response NEVER contains key material).
   */
  async saveBinding(input: {
    userId: string;
    profileId: string | null;
    providerId: string;
    endpointUrl: string;
    key: string;
    metadata?: Record<string, unknown>;
  }): Promise<ByomProviderBindingRecord> {
    const problems: string[] = [];
    if (typeof input.userId !== "string" || input.userId.length === 0) {
      problems.push("userId: expected a non-empty string");
    }
    if (
      typeof input.providerId !== "string" ||
      input.providerId.trim().length === 0 ||
      input.providerId.length > PROVIDER_ID_MAX_LENGTH
    ) {
      problems.push(
        `providerId: expected 1..${PROVIDER_ID_MAX_LENGTH} characters, got ${JSON.stringify(input.providerId)}`,
      );
    }
    if (
      typeof input.endpointUrl !== "string" ||
      !/^https?:\/\//i.test(input.endpointUrl) ||
      input.endpointUrl.length > ENDPOINT_URL_MAX_LENGTH
    ) {
      problems.push(
        `endpointUrl: expected an absolute http(s) URL of at most ${ENDPOINT_URL_MAX_LENGTH} characters, got ${JSON.stringify(input.endpointUrl)}`,
      );
    }
    if (typeof input.key !== "string" || input.key.length === 0) {
      problems.push("key: expected a non-empty string");
    }
    if (problems.length > 0) {
      throw new PersistenceError("invalid-input", problems.join("; "), {
        operation: "byomBindings.saveBinding",
      });
    }

    const nowIso = epochMsToIso(this.clock.now());
    const sealed: SealedSecret = sealSecret(this.key, input.key);

    // Preserve the canonical id + created_at across rotation.
    let existingId: string | null = null;
    let existingCreatedAt: string | null = null;
    try {
      const rows = await this.db.query<{ id: string; created_at: unknown }>(
        `SELECT id, created_at FROM byom_provider_bindings
          WHERE user_id = $1 AND COALESCE(profile_id, 'user:' || user_id) = COALESCE($2, 'user:' || user_id)
            AND provider_id = $3`,
        [input.userId, input.profileId, input.providerId],
      );
      if (rows.length > 0) {
        existingId = rows[0]!.id;
        existingCreatedAt = toIsoTimestamp(rows[0]!.created_at);
      }
    } catch (thrown) {
      throw classifyDriverError(thrown, "byomBindings.saveBinding.existing");
    }

    const id = existingId ?? `${BYOM_BINDING_ID_PREFIX}${this.ids.next()}`;
    const createdAt = existingCreatedAt ?? nowIso;

    try {
      const rows = await this.db.query<BindingSqlRow>(
        `INSERT INTO byom_provider_bindings
            (id, user_id, profile_id, provider_id, endpoint_url,
             ciphertext, iv, auth_tag, key_id, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
         ON CONFLICT (COALESCE(profile_id, 'user:' || user_id), provider_id) DO UPDATE SET
           endpoint_url = EXCLUDED.endpoint_url,
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
          input.profileId,
          input.providerId,
          input.endpointUrl,
          sealed.ciphertext,
          sealed.iv,
          sealed.authTag,
          sealed.keyId,
          input.metadata === undefined ? null : JSON.stringify(input.metadata),
          createdAt,
          nowIso,
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("saveBinding: no row returned");
      return mapBinding(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "byomBindings.saveBinding");
    }
  }

  /**
   * Load one binding and open its key. Typed outcomes: `not-found`,
   * `key-mismatch` (rotation detection), `decrypt-failed` (tampered
   * envelope). The opened key is handed to the caller ONLY — never logged,
   * never in a URL, never in a model prompt (the R06 privacy law).
   */
  async loadBinding(
    userId: string,
    profileId: string | null,
    providerId: string,
  ): Promise<LoadByomBindingResult> {
    let row: BindingSqlRow | undefined;
    try {
      const rows = await this.db.query<BindingSqlRow>(
        `SELECT * FROM byom_provider_bindings
          WHERE user_id = $1 AND COALESCE(profile_id, 'user:' || user_id) = COALESCE($2, 'user:' || user_id)
            AND provider_id = $3`,
        [userId, profileId, providerId],
      );
      row = rows[0];
    } catch (thrown) {
      throw classifyDriverError(thrown, "byomBindings.loadBinding");
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

    let key: string;
    try {
      key = openSecret(this.key, {
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.auth_tag,
      });
    } catch (thrown) {
      const detail =
        thrown instanceof CredentialDecryptError
          ? thrown.message
          : "byom key envelope failed to open";
      return { ok: false, reason: "decrypt-failed", detail };
    }
    return { ok: true, binding: { ...mapBinding(row), key } };
  }

  /**
   * List the effective profile's BYOM bindings (NO keys — metadata only).
   * The secret-free projections safe to hand to the API surface (the
   * `GET /experience/model-providers` view is built FROM these records).
   */
  async listForProfile(
    userId: string,
    profileId: string | null,
  ): Promise<readonly ByomProviderBindingRecord[]> {
    try {
      const rows = await this.db.query<BindingSqlRow>(
        `SELECT * FROM byom_provider_bindings
          WHERE user_id = $1 AND COALESCE(profile_id, 'user:' || user_id) = COALESCE($2, 'user:' || user_id)
          ORDER BY provider_id, created_at`,
        [userId, profileId],
      );
      return rows.map(mapBinding);
    } catch (thrown) {
      throw classifyDriverError(thrown, "byomBindings.listForProfile");
    }
  }

  /**
   * Delete one binding (un-bind a BYOM provider). True when a row was
   * removed — the sealed material is destroyed per the vault's delete
   * discipline (the connector-accounts.deleteAccount law).
   */
  async deleteBinding(
    userId: string,
    profileId: string | null,
    providerId: string,
  ): Promise<boolean> {
    try {
      const rows = await this.db.query<{ id: string }>(
        `DELETE FROM byom_provider_bindings
          WHERE user_id = $1 AND COALESCE(profile_id, 'user:' || user_id) = COALESCE($2, 'user:' || user_id)
            AND provider_id = $3 RETURNING id`,
        [userId, profileId, providerId],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "byomBindings.deleteBinding");
    }
  }
}
