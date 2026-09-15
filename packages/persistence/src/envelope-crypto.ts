/**
 * @wfx/persistence — AES-256-GCM envelope encryption for credentials at
 * rest (WFX-052).
 *
 * Product boundary (docs/architecture/product-boundaries.md — Privacy):
 * "Credentials remain in secure provider storage." For connector account
 * credentials (YouTube OAuth tokens and the like, WFX-054) the at-rest
 * storage is the `connector_accounts` table — so the secret is sealed in an
 * authenticated envelope before it ever reaches SQL:
 *
 * - key: APP_ENCRYPTION_KEY, exactly 32 bytes, supplied as base64 or hex.
 * - per-secret 12-byte random IV (`crypto.getRandomValues`) — never reused.
 * - 16-byte GCM auth tag stored alongside — tampering is DETECTED, and a
 *   tampered/foreign-key envelope fails with the typed
 *   `CredentialDecryptError` (never garbage plaintext, never fake success).
 * - `keyId` (leading 16 hex of SHA-256(key)) travels with each envelope so
 *   key rotation is observable before decryption is attempted.
 * - AAD binds the envelope to its purpose ("wfx/persistence/credential/v1")
 *   — an envelope sealed for one purpose cannot be replayed as another.
 *
 * This is application-layer envelope encryption on top of the database, not
 * a substitute for provider-level encryption at rest; both are used.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { CredentialDecryptError, PersistenceConfigError } from "./errors";

/** The only algorithm this module ever uses. */
export const ENVELOPE_ALGORITHM = "aes-256-gcm" as const;

/** GCM standard IV length. */
const IV_BYTES = 12;

/** GCM standard auth-tag length. */
const AUTH_TAG_BYTES = 16;

/** Required key length for AES-256. */
const KEY_BYTES = 32;

/** Additional-authenticated-data label binding envelopes to their purpose. */
export const ENVELOPE_AAD = "wfx/persistence/credential/v1";

/** A sealed credential — exactly what lands in `connector_accounts`. */
export interface SealedSecret {
  /** AES-256-GCM ciphertext, base64. */
  readonly ciphertext: string;
  /** Fresh 12-byte IV for this envelope, base64. */
  readonly iv: string;
  /** 16-byte GCM auth tag, base64. */
  readonly authTag: string;
  /** Rotation fingerprint of the sealing key (see `keyIdFor`). */
  readonly keyId: string;
}

/**
 * Decode APP_ENCRYPTION_KEY: exactly 32 bytes, encoded as base64 (standard
 * or base64url, with or without padding) or as 64 hex chars. Throws the
 * typed `PersistenceConfigError` (naming APP_ENCRYPTION_KEY) on anything
 * else — a wrong-length key is a deployment misconfiguration, loudly
 * rejected at boot.
 */
export function decodeEncryptionKey(value: string): Uint8Array {
  const trimmed = value.trim();
  const fail = (why: string): PersistenceConfigError =>
    new PersistenceConfigError(
      `APP_ENCRYPTION_KEY ${why} — it must be a 32-byte secret encoded as base64 or 64 hex characters.`,
      ["APP_ENCRYPTION_KEY"],
    );

  // Hex: exactly 64 hex chars → 32 bytes.
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const bytes = new Uint8Array(KEY_BYTES);
    for (let index = 0; index < KEY_BYTES; index += 1) {
      bytes[index] = Number.parseInt(trimmed.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
  }

  // Base64 (tolerate base64url and stripped padding).
  const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  let decoded: Uint8Array;
  try {
    decoded = new Uint8Array(Buffer.from(padded, "base64"));
  } catch {
    throw fail("is not valid base64 or hex");
  }
  if (decoded.byteLength !== KEY_BYTES) {
    throw fail(`decodes to ${decoded.byteLength} bytes, not 32`);
  }
  return decoded;
}

/** Rotation fingerprint of a key: first 16 hex chars of SHA-256(key). */
export function keyIdFor(key: Uint8Array): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/** Seal `plaintext` under `key` with a fresh IV. Returns the storable envelope. */
export function sealSecret(key: Uint8Array, plaintext: string): SealedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ENVELOPE_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(Buffer.from(ENVELOPE_AAD, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyId: keyIdFor(key),
  };
}

/**
 * Open a sealed envelope. Throws the typed `CredentialDecryptError` when
 * the envelope was tampered with, truncated, sealed under a different key,
 * or sealed for a different purpose — never returns garbage plaintext.
 */
export function openSecret(key: Uint8Array, sealed: Omit<SealedSecret, "keyId">): string {
  const fail = (why: string): CredentialDecryptError =>
    new CredentialDecryptError(
      `credential envelope failed to open: ${why}. The stored ciphertext, IV, or auth tag ` +
        "may have been tampered with, or APP_ENCRYPTION_KEY is not the key that sealed it.",
    );

  let iv: Buffer;
  let ciphertext: Buffer;
  let authTag: Buffer;
  try {
    iv = Buffer.from(sealed.iv, "base64");
    ciphertext = Buffer.from(sealed.ciphertext, "base64");
    authTag = Buffer.from(sealed.authTag, "base64");
  } catch {
    throw fail("stored envelope fields are not valid base64");
  }

  if (iv.byteLength !== IV_BYTES) throw fail(`IV is ${iv.byteLength} bytes, expected ${IV_BYTES}`);
  if (authTag.byteLength !== AUTH_TAG_BYTES) {
    throw fail(`auth tag is ${authTag.byteLength} bytes, expected ${AUTH_TAG_BYTES}`);
  }

  try {
    const decipher = createDecipheriv(ENVELOPE_ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(ENVELOPE_AAD, "utf8"));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    throw fail("AES-256-GCM authentication failed");
  }
}
