/**
 * @wfx/platform-contracts — StoragePort (R01).
 *
 * The persistent storage seam of a platform adapter: the Web adapter maps
 * this onto browser storage (e.g. localStorage/IndexedDB behind one honest
 * facade), the Desktop adapter onto filesystem-backed storage, the Mobile
 * adapter onto OS-managed storage. The kind is declared truthfully on the
 * capability bundle (`PlatformCapabilities.storage`).
 *
 * Semantics (the frozen remediation spec):
 * - KEY-VALUE + BOUNDED BLOB storage, both ASYNC.
 * - QUOTA-AWARE: `quota()` reports usage and bound; writes that would exceed
 *   the bound REJECT with a typed `StorageError` (`"quota-exceeded"`) —
 *   NEVER a silent drop, NEVER a silent eviction of other keys.
 * - TYPED ERRORS: every failure rejects with a `StorageError` carrying a
 *   closed `StorageErrorCode`; a missing key is `null` (honest absence, not
 *   an error).
 *
 * Persistence honesty: the adapter decides the durability window (tab
 * lifetime, app lifetime, OS-managed), but whatever it PROMISES must be
 * real — a `set` that resolved successfully must be readable by a later
 * `get` within the same or a later session of the declared window. No
 * write-back caching theater.
 */

/** The closed storage failure vocabulary. */
export type StorageErrorCode =
  /** The storage backend is unavailable right now (retryable). */
  | "unavailable"
  /** The write would exceed the storage bound. Never silent. */
  | "quota-exceeded"
  /** The key is not addressable in this backend (empty/malformed). */
  | "invalid-key"
  /** A backend I/O failure occurred (detail names the operation). */
  | "io"
  /** The stored value failed the adapter's integrity check (corruption). */
  | "corrupt";

/** Every value of `StorageErrorCode`, in union order. */
export const STORAGE_ERROR_CODES: readonly StorageErrorCode[] = [
  "unavailable",
  "quota-exceeded",
  "invalid-key",
  "io",
  "corrupt",
];

/**
 * The typed storage failure every `StoragePort` method rejects with. A
 * plain `Error` from an adapter is a port-contract violation.
 */
export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly operation: string;
  /** Whether retrying the same operation can plausibly succeed. */
  readonly retryable: boolean;

  constructor(code: StorageErrorCode, operation: string, detail: string, retryable: boolean) {
    super(`storage failure (${code}) during ${operation}: ${detail}`);
    this.name = "StorageError";
    this.code = code;
    this.operation = operation;
    this.retryable = retryable;
  }
}

/** A `StorageError` type guard for untrusted rejection values. */
export function isStorageError(value: unknown): value is StorageError {
  return (
    value instanceof StorageError ||
    (typeof value === "object" &&
      value !== null &&
      (value as { name?: unknown }).name === "StorageError" &&
      typeof (value as { code?: unknown }).code === "string" &&
      (STORAGE_ERROR_CODES as readonly string[]).includes((value as { code: string }).code))
  );
}

/** Current storage accounting, as truthfully as the adapter can report it. */
export interface StorageQuota {
  /** Bytes currently occupied by the adapter's storage areas. */
  readonly usageBytes: number;
  /**
   * The storage bound in bytes, or `null` when the adapter genuinely cannot
   * know it (a fake number is worse than an honest null).
   */
  readonly quotaBytes: number | null;
}

/**
 * The persistent storage port: async key-value plus bounded blob storage
 * with typed, quota-aware failures.
 *
 * Key conventions:
 * - Keys are non-empty strings; adapters may namespace them per area.
 * - Key-value values are strings (JSON encoding is the caller's choice).
 * - Blob values are byte arrays; the ADAPTER enforces the bound and reports
 *   it through `quota()`.
 */
export interface StoragePort {
  /** Read one key; `null` when absent (honest absence, never an error). */
  get(key: string): Promise<string | null>;
  /** Write one key. Rejects with `StorageError` (never silently drops). */
  set(key: string, value: string): Promise<void>;
  /** Remove one key. Removing an absent key succeeds (idempotent). */
  remove(key: string): Promise<void>;
  /** List stored keys, optionally restricted to a prefix. */
  keys(prefix?: string): Promise<readonly string[]>;

  /** Write one blob. Rejects with `"quota-exceeded"` when over bound. */
  putBlob(key: string, bytes: Uint8Array): Promise<void>;
  /** Read one blob; `null` when absent. */
  getBlob(key: string): Promise<Uint8Array | null>;
  /** Remove one blob. Idempotent like `remove`. */
  removeBlob(key: string): Promise<void>;

  /** Current usage/quota accounting (honest; `quotaBytes` may be null). */
  quota(): Promise<StorageQuota>;
}
