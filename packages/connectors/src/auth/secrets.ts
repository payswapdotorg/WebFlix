/**
 * @wfx/connectors — credential vault for connector secrets (WFX-012, Lane B).
 *
 * Product boundary (docs/architecture/product-boundaries.md — Privacy):
 * "Credentials remain in secure provider storage."
 *
 * This module defines the vault SEAM (`CredentialVault`) plus a typed,
 * honest default implementation: `createInMemoryVault()`.
 *
 * PRODUCTION WARNING — the in-memory vault is NOT secure provider storage:
 * - Secrets are XOR-obfuscated with a per-vault random key that lives in the
 *   same process. XOR is obfuscation, not encryption: a process memory dump
 *   contains both the obfuscated bytes and the key, so every secret is
 *   recoverable. It defends against casual string scraping (no plaintext
 *   copy is retained anywhere), nothing more.
 * - Secrets live only for the process lifetime. Nothing is persisted — by
 *   design: this work item forbids persisting secrets anywhere (no files,
 *   no env, no logs).
 * - Production deployments MUST back the `CredentialVault` interface with a
 *   real secret manager (OS keychain, KMS, vault service, ...). The
 *   INTERFACE is the deliverable; the in-memory vault is a typed, honest
 *   default for tests, local development, and single-session runtimes.
 *
 * Opacity law (implemented and tested): a secret NEVER appears in
 * `toString`, `JSON.stringify`, or `util.inspect` output of anything this
 * module hands out. Handles carry only non-secret metadata, and the vault
 * keeps its key and its entries in a closure that serialization cannot
 * reach — `JSON.stringify(vault)` is `"{}"` and `util.inspect(vault)` shows
 * only method names. Plaintext byte buffers are zeroed immediately after
 * use in `store` and `retrieve`; the stored obfuscated bytes are zeroed in
 * place on `delete`.
 *
 * JS-string caveat: `retrieve()` necessarily returns the secret as a JS
 * string. Strings are immutable and cannot be zeroed by any vault. Callers
 * must treat returned strings as sensitive and never log or persist them.
 */

// ---------------------------------------------------------------------------
// Credential kinds and handles
// ---------------------------------------------------------------------------

/**
 * Credential kinds the auth layer stores, derived from the auth flow that
 * produced them (see ./flows.ts and ./service.ts). The set is closed: a new
 * kind is a contract-level change, not a connector-side whim.
 */
export type SecretKind =
  | "oauth-token"
  | "device-token"
  | "local-token"
  | "local-userpass";

/** Runtime list of the credential kinds from this module. */
export const SECRET_KINDS: readonly SecretKind[] = [
  "oauth-token",
  "device-token",
  "local-token",
  "local-userpass",
] as const;

/** Runtime membership check against the `SecretKind` union. */
export function isSecretKind(x: unknown): x is SecretKind {
  return typeof x === "string" && SECRET_KINDS.includes(x as SecretKind);
}

/**
 * An opaque reference to a stored credential — NEVER the secret itself.
 *
 * `ref` is a random, vault-scoped id: it is not derived from the secret and
 * cannot be turned back into the secret without the vault (and the vault's
 * key). `connectorId` and `kind` are non-secret metadata carried for
 * usability. Handles are frozen and safe to serialize and log: JSON and
 * inspect output shows exactly these three non-secret fields.
 */
export interface SecretHandle {
  /** The connector this secret belongs to. */
  readonly connectorId: string;
  /** The kind of credential. */
  readonly kind: SecretKind;
  /** Opaque vault-scoped reference (random hex). */
  readonly ref: string;
}

/** Typed error for vault misuse (malformed inputs, malformed handles). */
export class VaultValidationError extends Error {
  constructor(message: string) {
    super(`invalid vault operation: ${message}`);
    this.name = "VaultValidationError";
  }
}

// ---------------------------------------------------------------------------
// The vault seam
// ---------------------------------------------------------------------------

/**
 * Credential storage for connector secrets.
 *
 * Implementations MUST honor the opacity law from the module docs: no
 * method, property, error, or stringification may expose the secret except
 * `retrieve`, which returns it only to the caller who holds the handle.
 */
export interface CredentialVault {
  /**
   * Store `secret` for `connectorId` under credential `kind` and return an
   * opaque handle. Storing is append-only at the vault level: storing the
   * same (connectorId, kind) twice yields TWO handles (credential rotation
   * is orchestrated above the vault, e.g. by ConnectorAuthService).
   *
   * @throws VaultValidationError on malformed input (empty strings, unknown
   *         kind).
   */
  store(connectorId: string, kind: SecretKind, secret: string): SecretHandle;

  /**
   * Return the secret for `handle`, or `null` when the handle is unknown to
   * this vault (deleted, never stored here, or its metadata does not match
   * the stored entry — including handles minted by a different vault).
   *
   * @throws VaultValidationError when the handle is malformed.
   */
  retrieve(handle: SecretHandle): string | null;

  /**
   * Delete the secret for `handle`, zeroing its stored bytes in place.
   * Returns `true` when an entry was deleted, `false` when the handle was
   * unknown (idempotent delete).
   *
   * @throws VaultValidationError when the handle is malformed.
   */
  delete(handle: SecretHandle): boolean;

  /** Handles of every stored secret for `connectorId`, in insertion order. */
  list(connectorId: string): readonly SecretHandle[];
}

/**
 * DIAGNOSTIC/TEST-ONLY surface of the in-memory vault.
 *
 * `obfuscatedBytesFor` returns the raw STORED bytes for a handle — the
 * XOR-obfuscated buffer, never plaintext — as a live reference, so that
 * zero-on-delete is observable (the buffer reads all zeros after `delete`).
 * It leaks nothing beyond what `retrieve` already hands out, but it exists
 * for verification, not for application code.
 */
export interface InMemoryVaultDiagnostics {
  /**
   * The live obfuscated buffer stored for `handle` (NOT the plaintext), or
   * `null` when the ref is unknown. TEST/DIAGNOSTIC ONLY.
   */
  obfuscatedBytesFor(handle: SecretHandle): Uint8Array | null;
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

const KEY_BYTES = 32;
const REF_BYTES = 16;

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

interface VaultEntry {
  readonly handle: SecretHandle;
  /** XOR-obfuscated bytes; zeroed in place on delete. */
  obfuscated: Uint8Array;
}

function requireNonEmptyString(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new VaultValidationError(`'${field}' must be a non-empty string`);
  }
  return value;
}

function requireHandleShape(handle: SecretHandle, operation: string): void {
  if (!isPlainObject(handle)) {
    throw new VaultValidationError(
      `'handle' passed to ${operation} must be a SecretHandle object`,
    );
  }
  if (typeof handle.ref !== "string" || handle.ref.length === 0) {
    throw new VaultValidationError(
      `'handle' passed to ${operation} must carry a non-empty 'ref'`,
    );
  }
  if (typeof handle.connectorId !== "string" || handle.connectorId.length === 0) {
    throw new VaultValidationError(
      `'handle' passed to ${operation} must carry a non-empty 'connectorId'`,
    );
  }
  if (!isSecretKind(handle.kind)) {
    throw new VaultValidationError(
      `'handle' passed to ${operation} must carry a known 'kind' (one of ${SECRET_KINDS.join(" | ")})`,
    );
  }
}

/**
 * Create the in-memory credential vault (see the module docs PRODUCTION
 * WARNING: XOR obfuscation, process lifetime only, replace with a real
 * secret manager in production).
 *
 * The vault's random key and its entries live in a closure unreachable
 * from the returned object — the opacity law holds by construction.
 */
export function createInMemoryVault(): CredentialVault & InMemoryVaultDiagnostics {
  // Closure privacy: neither the key nor the entries are reachable from the
  // returned object. JSON.stringify(vault) === "{}" and util.inspect shows
  // only method names.
  const key = randomBytes(KEY_BYTES);
  const entries = new Map<string, VaultEntry>();

  // XOR with the per-vault key. Symmetric: also de-obfuscates.
  // (Index guards only satisfy noUncheckedIndexedAccess — typed arrays are
  // always defined at in-bounds indices.)
  const obfuscate = (data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      out[i] = (data[i] ?? 0) ^ (key[i % key.length] ?? 0);
    }
    return out;
  };

  const findEntry = (handle: SecretHandle): VaultEntry | null => {
    const entry = entries.get(handle.ref);
    if (entry === undefined) return null;
    if (entry.handle.connectorId !== handle.connectorId) return null;
    if (entry.handle.kind !== handle.kind) return null;
    return entry;
  };

  const freshRef = (): string => {
    let ref = toHex(randomBytes(REF_BYTES));
    while (entries.has(ref)) ref = toHex(randomBytes(REF_BYTES));
    return ref;
  };

  const vault: CredentialVault & InMemoryVaultDiagnostics = {
    store(connectorId, kind, secret) {
      const id = requireNonEmptyString("connectorId", connectorId);
      if (!isSecretKind(kind)) {
        throw new VaultValidationError(
          `'kind' must be one of ${SECRET_KINDS.join(" | ")}, got '${String(kind)}'`,
        );
      }
      if (typeof secret !== "string" || secret.length === 0) {
        throw new VaultValidationError("'secret' must be a non-empty string");
      }

      const plain = new TextEncoder().encode(secret);
      const obfuscated = obfuscate(plain);
      plain.fill(0); // zero the plaintext buffer immediately

      const handle: SecretHandle = Object.freeze({
        connectorId: id,
        kind,
        ref: freshRef(),
      });
      entries.set(handle.ref, { handle, obfuscated });
      return handle;
    },

    retrieve(handle) {
      requireHandleShape(handle, "retrieve");
      const entry = findEntry(handle);
      if (entry === null) return null;
      const plain = obfuscate(entry.obfuscated); // symmetric XOR de-obfuscates
      const secret = new TextDecoder().decode(plain);
      plain.fill(0); // zero the plaintext buffer
      return secret;
    },

    delete(handle) {
      requireHandleShape(handle, "delete");
      const entry = findEntry(handle);
      if (entry === null) return false;
      entry.obfuscated.fill(0); // ZERO the stored (obfuscated) bytes in place
      entries.delete(entry.handle.ref);
      return true;
    },

    list(connectorId) {
      const id = requireNonEmptyString("connectorId", connectorId);
      const handles: SecretHandle[] = [];
      for (const entry of entries.values()) {
        if (entry.handle.connectorId === id) handles.push(entry.handle);
      }
      return Object.freeze(handles);
    },

    obfuscatedBytesFor(handle) {
      const entry = entries.get(handle.ref);
      return entry === undefined ? null : entry.obfuscated;
    },
  };

  return vault;
}
