/**
 * @wfx/app-web — the Web StoragePort (R07).
 *
 * The persistent-storage seam of the Web adapter over the browser's REAL
 * storage facilities:
 *
 * - KEY-VALUE area over `localStorage` (namespaced `wfx:kv:<key>`), which
 *   the browser persists across sessions — the durable window this port
 *   promises for kv writes.
 * - BLOB area over `IndexedDB` (store `wfx-blobs`, one record per key),
 *   which the browser persists across sessions, with byte-accurate
 *   accounting.
 * - HONEST FALLBACKS: a boot context without `localStorage` (a server
 *   render pass) gets a process-lifetime IN-MEMORY kv area — a smaller,
 *   DOCUMENTED durability window (process lifetime), never presented as
 *   browser-durable; a context without `IndexedDB` gets a bounded in-memory
 *   blob area (page/process lifetime). The port's `describe()` names the
 *   active backend so no consumer mistakes the window.
 *
 * QUOTA HONESTY (the frozen StoragePort law):
 *
 * - `quota()` reports real accounting: usage is measured in bytes (kv:
 *   UTF-16 code units × 2 — the localStorage storage model; blobs: byte
 *   length), and `quotaBytes` is the bound THIS ADAPTER enforces. The
 *   browser's own quota (when it throws `QuotaExceededError` on
 *   localStorage) is surfaced as the TYPED `quota-exceeded` failure — never
 *   a silent drop, never a silent eviction of other keys.
 * - A write that would exceed the adapter-enforced bound REJECTS with the
 *   typed `StorageError("quota-exceeded")` BEFORE any mutation.
 *
 * EVICTION POLICY (documented, deliberate): this port NEVER evicts. The
 * frozen contract says a quota-exceeded write rejects — silently evicting
 * other keys to make room would violate it. Bounded-lifetime consumers
 * (the blob area) manage their own lifetimes by calling `removeBlob`; the
 * adapter surfaces usage through `quota()` so the caller can decide what
 * to remove. This is the honest policy: rejection + accounting, never
 * surprise data loss.
 *
 * ERROR MAPPING (closed vocabulary): a localStorage backend failure
 * (including the browser's SecurityError under blocked storage) maps to
 * `unavailable`; `QuotaExceededError` maps to `quota-exceeded`; malformed
 * (empty) keys map to `invalid-key`; IndexedDB errors map to `io` (with
 * the failed operation named); a corrupt kv envelope fails `corrupt`.
 */

import {
  StorageError,
  type StoragePort,
  type StorageQuota,
} from "@wfx/platform-contracts";

import type { IDBDatabaseLike, IDBObjectStoreLike, WebEnvironment } from "./environment";

/** The kv namespace prefix (adapter-owned keys never collide with hosts'). */
const KV_PREFIX = "wfx:kv:";

/** The envelope prefix marking adapter-written kv values. */
const KV_ENVELOPE_PREFIX = "wfx1:";

/** The default kv byte bound the adapter enforces (4 MiB). */
export const DEFAULT_KV_BYTES_BOUND = 4 * 1024 * 1024;

/** The default blob byte bound the adapter enforces (8 MiB). */
export const DEFAULT_BLOB_BYTES_BOUND = 8 * 1024 * 1024;

/** Options for {@link createWebStoragePort}. */
export interface WebStoragePortOptions {
  /** The environment (default: no browser facilities — memory fallbacks). */
  readonly environment?: WebEnvironment;
  /** The kv byte bound (default {@link DEFAULT_KV_BYTES_BOUND}). */
  readonly kvBytesBound?: number;
  /** The blob byte bound (default {@link DEFAULT_BLOB_BYTES_BOUND}). */
  readonly blobBytesBound?: number;
}

/** The honest backend description of one storage area. */
export interface StorageAreaDescription {
  /** Which facility backs the area. */
  readonly backend: "localStorage" | "memory" | "indexeddb";
  /** The durability window this backend truthfully provides. */
  readonly durability: "browser-sessions" | "process-lifetime";
}

/** The web storage port: the frozen port plus the honest backend truth. */
export interface WebStoragePort extends StoragePort {
  /** The active backends + their durability windows (inspectable honesty). */
  describe(): { readonly kv: StorageAreaDescription; readonly blobs: StorageAreaDescription };
}

/** One async kv backend (localStorage or memory). */
interface KvBackend {
  readonly backend: "localStorage" | "memory";
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
  keys(): readonly string[];
  /** Bytes currently occupied by the ADAPTER's namespaced keys. */
  usageBytes(): number;
}

/** One async blob backend (IndexedDB or memory). */
interface BlobBackend {
  readonly backend: "indexeddb" | "memory";
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
  usageBytes(): Promise<number>;
}

// ---------------------------------------------------------------------------
// Key validation (the closed invalid-key law)
// ---------------------------------------------------------------------------

function assertAddressableKey(key: string, operation: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new StorageError("invalid-key", operation, "the key is empty (keys must be non-empty)", false);
  }
  if (key.length > 512) {
    throw new StorageError(
      "invalid-key",
      operation,
      `the key is ${key.length} characters (bound: 512)`,
      false,
    );
  }
}

// ---------------------------------------------------------------------------
// The kv backends
// ---------------------------------------------------------------------------

/** The localStorage kv backend (durable across browser sessions). */
class LocalStorageKvBackend implements KvBackend {
  readonly backend = "localStorage" as const;

  constructor(
    private readonly storage: NonNullable<WebEnvironment["localStorage"]>,
    private readonly prefix: string,
  ) {}

  private full(key: string): string {
    return `${this.prefix}${key}`;
  }

  read(key: string): string | null {
    try {
      const raw = this.storage.getItem(this.full(key));
      if (raw === null) return null;
      if (!raw.startsWith(KV_ENVELOPE_PREFIX)) {
        // Not written by this adapter (or tampered): corrupt envelope.
        throw new StorageError("corrupt", "get", `the stored envelope for '${key}' is not adapter-written`, false);
      }
      return raw.slice(KV_ENVELOPE_PREFIX.length);
    } catch (thrown) {
      if (thrown instanceof StorageError) throw thrown;
      throw new StorageError(
        "unavailable",
        "get",
        `localStorage failed to read '${key}': ${describeThrown(thrown)}`,
        true,
      );
    }
  }

  write(key: string, value: string): void {
    try {
      this.storage.setItem(this.full(key), `${KV_ENVELOPE_PREFIX}${value}`);
    } catch (thrown) {
      if (thrown instanceof StorageError) throw thrown;
      if (isQuotaExceeded(thrown)) {
        throw new StorageError(
          "quota-exceeded",
          "set",
          `localStorage rejected the write for '${key}' (the browser quota is full): ${describeThrown(thrown)}`,
          false,
        );
      }
      throw new StorageError(
        "unavailable",
        "set",
        `localStorage failed to write '${key}': ${describeThrown(thrown)}`,
        true,
      );
    }
  }

  remove(key: string): void {
    try {
      this.storage.removeItem(this.full(key));
    } catch (thrown) {
      throw new StorageError(
        "unavailable",
        "remove",
        `localStorage failed to remove '${key}': ${describeThrown(thrown)}`,
        true,
      );
    }
  }

  keys(): readonly string[] {
    const keys: string[] = [];
    for (let index = 0; index < this.storage.length; index += 1) {
      const raw = this.storage.key(index);
      if (raw !== null && raw.startsWith(this.prefix)) {
        keys.push(raw.slice(this.prefix.length));
      }
    }
    return keys;
  }

  usageBytes(): number {
    let total = 0;
    for (const key of this.keys()) {
      // localStorage stores UTF-16: 2 bytes per code unit (the browser
      // storage model); the envelope prefix counts too — honest accounting.
      const raw = this.storage.getItem(`${this.prefix}${key}`);
      total += 2 * ((raw?.length ?? 0) + this.prefix.length + key.length);
    }
    return total;
  }
}

/** The process-lifetime memory kv backend (SSR / no-localStorage contexts). */
class MemoryKvBackend implements KvBackend {
  readonly backend = "memory" as const;
  private readonly map = new Map<string, string>();

  read(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  write(key: string, value: string): void {
    this.map.set(key, value);
  }

  remove(key: string): void {
    this.map.delete(key);
  }

  keys(): readonly string[] {
    return [...this.map.keys()];
  }

  usageBytes(): number {
    let total = 0;
    for (const [key, value] of this.map) total += 2 * (key.length + value.length);
    return total;
  }
}

// ---------------------------------------------------------------------------
// The blob backends
// ---------------------------------------------------------------------------

/** The bounded in-memory blob backend (page/process lifetime, honest). */
class MemoryBlobBackend implements BlobBackend {
  readonly backend = "memory" as const;
  private readonly blobs = new Map<string, Uint8Array>();
  private usage = 0;

  async get(key: string): Promise<Uint8Array | null> {
    return this.blobs.get(key) ?? null;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const existing = this.blobs.get(key);
    const next = this.usage - (existing?.length ?? 0) + bytes.length;
    if (next > this.boundBytes) {
      throw new StorageError(
        "quota-exceeded",
        "putBlob",
        `the write of ${bytes.length} bytes for '${key}' would exceed the ${this.boundBytes}-byte blob bound (usage: ${this.usage}) — remove blobs you no longer need (this port never evicts silently)`,
        false,
      );
    }
    this.usage = next;
    this.blobs.set(key, bytes);
  }

  async remove(key: string): Promise<void> {
    const existing = this.blobs.get(key);
    if (existing !== undefined) {
      this.usage -= existing.length;
      this.blobs.delete(key);
    }
  }

  async usageBytes(): Promise<number> {
    return this.usage;
  }

  constructor(private readonly boundBytes: number) {}
}

/** The IndexedDB blob backend (durable across browser sessions). */
class IndexedDbBlobBackend implements BlobBackend {
  readonly backend = "indexeddb" as const;
  private database: Promise<IDBDatabaseLike> | null = null;
  /**
   * Session accounting: the byte sizes of every blob THIS instance has
   * read, written, or removed. Pre-existing records the session has not
   * touched are not counted until read — the usage answer is therefore an
   * honest LOWER BOUND across cold boots; the browser's own quota rejection
   * (surfaced typed below) is the ultimate net. Documented law, never a
   * fabricated exact number.
   */
  private readonly sizes = new Map<string, number>();

  constructor(
    private readonly factory: NonNullable<WebEnvironment["indexedDB"]>,
    private readonly boundBytes: number,
  ) {}

  private open(): Promise<IDBDatabaseLike> {
    if (this.database !== null) return this.database;
    this.database = new Promise<IDBDatabaseLike>((resolve, reject) => {
      const request = this.factory("wfx-web-storage", 1);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("wfx-blobs")) {
          db.createObjectStore("wfx-blobs");
        }
        resolve(db);
      };
      request.onerror = () => {
        reject(new StorageError("unavailable", "open", "IndexedDB failed to open the blob store", true));
      };
    });
    return this.database;
  }

  private async store(mode: "readonly" | "readwrite"): Promise<IDBObjectStoreLike> {
    const db = await this.open();
    return db.transaction("wfx-blobs", mode).objectStore("wfx-blobs");
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const store = await this.store("readonly");
      const blob = await new Promise<Uint8Array | null>((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => {
          const record = request.result as { bytes?: Uint8Array } | undefined | null;
          resolve(
            record !== null && record !== undefined && record.bytes instanceof Uint8Array
              ? record.bytes
              : null,
          );
        };
        request.onerror = () => {
          reject(new StorageError("io", "getBlob", `IndexedDB failed to read '${key}'`, true));
        };
      });
      if (blob !== null) this.sizes.set(key, blob.length);
      else this.sizes.delete(key);
      return blob;
    } catch (thrown) {
      if (thrown instanceof StorageError) throw thrown;
      throw new StorageError("io", "getBlob", describeThrown(thrown), true);
    }
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    // The adapter-enforced bound applies BEFORE the write (never silent).
    // The delta is computed against the known size (session accounting —
    // see the `sizes` doc for the cold-boot lower-bound honesty law).
    const existingSize = this.sizes.has(key) ? (this.sizes.get(key) as number) : (await this.get(key))?.length ?? 0;
    const currentUsage = await this.usageBytes();
    if (currentUsage - existingSize + bytes.length > this.boundBytes) {
      throw new StorageError(
        "quota-exceeded",
        "putBlob",
        `the write of ${bytes.length} bytes for '${key}' would exceed the ${this.boundBytes}-byte blob bound (accounted usage: ${currentUsage}) — remove blobs you no longer need (this port never evicts silently)`,
        false,
      );
    }
    try {
      const store = await this.store("readwrite");
      await new Promise<void>((resolve, reject) => {
        const request = store.put({ key, bytes });
        request.onsuccess = () => resolve();
        request.onerror = () => {
          const error = (request as { error?: unknown }).error;
          if (isQuotaExceeded(error)) {
            reject(new StorageError("quota-exceeded", "putBlob", `IndexedDB quota rejected '${key}'`, false));
            return;
          }
          reject(new StorageError("io", "putBlob", `IndexedDB failed to write '${key}'`, true));
        };
      });
      this.sizes.set(key, bytes.length);
    } catch (thrown) {
      if (thrown instanceof StorageError) throw thrown;
      throw new StorageError("io", "putBlob", describeThrown(thrown), true);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      const store = await this.store("readwrite");
      await new Promise<void>((resolve, reject) => {
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => {
          reject(new StorageError("io", "removeBlob", `IndexedDB failed to remove '${key}'`, true));
        };
      });
      this.sizes.delete(key);
    } catch (thrown) {
      if (thrown instanceof StorageError) throw thrown;
      throw new StorageError("io", "removeBlob", describeThrown(thrown), true);
    }
  }

  async usageBytes(): Promise<number> {
    let total = 0;
    for (const size of this.sizes.values()) total += size;
    return total;
  }
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/**
 * Create the Web StoragePort. The backends are selected from the
 * environment ONCE (localStorage/IndexedDB when present; the documented
 * memory fallbacks otherwise) and the bound is enforced by the port, never
 * delegated to the browser's throw.
 */
export function createWebStoragePort(options: WebStoragePortOptions = {}): WebStoragePort {
  const kvBytesBound = options.kvBytesBound ?? DEFAULT_KV_BYTES_BOUND;
  const blobBytesBound = options.blobBytesBound ?? DEFAULT_BLOB_BYTES_BOUND;
  const localStorage = options.environment?.localStorage ?? null;
  const indexedDB = options.environment?.indexedDB ?? null;

  const kv: KvBackend =
    localStorage !== null
      ? new LocalStorageKvBackend(localStorage, KV_PREFIX)
      : new MemoryKvBackend();
  const blobs: BlobBackend =
    indexedDB !== null
      ? new IndexedDbBlobBackend(indexedDB, blobBytesBound)
      : new MemoryBlobBackend(blobBytesBound);

  async function kvUsage(): Promise<number> {
    try {
      return kv.usageBytes();
    } catch (thrown) {
      if (thrown instanceof StorageError) throw thrown;
      throw new StorageError("io", "quota", describeThrown(thrown), true);
    }
  }

  const kvDescription: StorageAreaDescription =
    kv.backend === "localStorage"
      ? { backend: "localStorage", durability: "browser-sessions" }
      : { backend: "memory", durability: "process-lifetime" };
  const blobsDescription: StorageAreaDescription =
    blobs.backend === "indexeddb"
      ? { backend: "indexeddb", durability: "browser-sessions" }
      : { backend: "memory", durability: "process-lifetime" };

  return {
    describe: () => ({ kv: kvDescription, blobs: blobsDescription }),

    async get(key: string): Promise<string | null> {
      assertAddressableKey(key, "get");
      return kv.read(key);
    },

    async set(key: string, value: string): Promise<void> {
      assertAddressableKey(key, "set");
      if (typeof value !== "string") {
        throw new StorageError("invalid-key", "set", "value: expected a string", false);
      }
      const existing = kv.read(key) ?? "";
      const existingUsage = await kvUsage();
      const delta = 2 * (value.length - existing.length);
      if (existingUsage + delta > kvBytesBound) {
        throw new StorageError(
          "quota-exceeded",
          "set",
          `the write of ${value.length} characters for '${key}' would exceed the ${kvBytesBound}-byte kv bound (usage: ${existingUsage}) — remove keys you no longer need (this port never evicts silently)`,
          false,
        );
      }
      kv.write(key, value);
    },

    async remove(key: string): Promise<void> {
      assertAddressableKey(key, "remove");
      kv.remove(key);
    },

    async keys(prefix?: string): Promise<readonly string[]> {
      const all = kv.keys();
      if (prefix === undefined) return [...all];
      return all.filter((key) => key.startsWith(prefix));
    },

    async putBlob(key: string, bytes: Uint8Array): Promise<void> {
      assertAddressableKey(key, "putBlob");
      if (!(bytes instanceof Uint8Array)) {
        throw new StorageError("invalid-key", "putBlob", "bytes: expected a Uint8Array", false);
      }
      await blobs.put(key, bytes);
    },

    async getBlob(key: string): Promise<Uint8Array | null> {
      assertAddressableKey(key, "getBlob");
      return blobs.get(key);
    },

    async removeBlob(key: string): Promise<void> {
      assertAddressableKey(key, "removeBlob");
      await blobs.remove(key);
    },

    async quota(): Promise<StorageQuota> {
      // Usage is the SUM of both areas; the bound reported is the kv bound
      // (the primary adapter-enforced budget). Per-area accounting is
      // available through describe() + each area's own operations.
      const kvBytes = await kvUsage();
      const blobBytes = await blobs.usageBytes();
      return {
        usageBytes: kvBytes + blobBytes,
        quotaBytes: kvBytesBound + blobBytesBound,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Shared error helpers
// ---------------------------------------------------------------------------

/** Describe an unknown thrown value honestly (no stack, no guess). */
function describeThrown(thrown: unknown): string {
  if (thrown instanceof Error) return `${thrown.name}: ${thrown.message}`;
  return String(thrown);
}

/** Is this the browser's quota rejection (DOMException name heuristics)? */
function isQuotaExceeded(thrown: unknown): boolean {
  if (thrown === null || typeof thrown !== "object") return false;
  const name = (thrown as { name?: unknown }).name;
  const message = typeof (thrown as { message?: unknown }).message === "string"
    ? ((thrown as { message: string }).message)
    : "";
  return (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    message.includes("quota")
  );
}
