/**
 * @wfx/app-desktop — StoragePort over the filesystem (R08).
 *
 * The Desktop storage seam: async key-value + blob storage over the OS
 * app-data directory, served by the native shell's filesystem commands
 * (the `ShellIpc` storage area).
 *
 * LAYOUT (documented, stable — the shell owns the bytes):
 *
 * ```text
 * {appDataDir}/wfx-desktop/
 *   storage/
 *     kv/     <sanitized-key>.json      one JSON document per kv entry
 *     blobs/  <sanitized-key>.bin       one binary file per blob entry
 * ```
 *
 * - The KV area and the BLOB area are SEPARATE namespaces: `set("x")` and
 *   `putBlob("x")` address different files and never collide. Keys are
 *   sanitized by the shell (path-safe); an unusable key rejects with the
 *   typed `invalid-key` StorageError.
 * - QUOTA IS DISK-TRUTH: `quota()` answers the shell's real accounting —
 *   `usageBytes` = the summed size of the adapter's storage files,
 *   `quotaBytes` = the real free space on the app-data volume (or `null`
 *   when the shell genuinely cannot know — never a fabricated bound).
 *   A write that would not fit rejects with `quota-exceeded` (the shell
 *   maps the OS write failure `ENOSPC` to the same code) — NEVER a silent
 *   drop and NEVER a silent eviction of other keys.
 * - EVICTION: the adapter NEVER evicts. The frozen StoragePort law forbids
 *   silent eviction, and media cache eviction policy is owned by
 *   `@wfx/native-media`'s `CacheTracker`/`StoragePolicy` over ITS own
 *   cache directory (R10/R13) — outside this port. Callers shrink usage
 *   by removing keys they own.
 * - TYPED ERRORS: every failure rejects with a `StorageError` carrying
 *   the closed code vocabulary; the shell's typed `ShellIpcError` maps
 *   1:1 (same vocabulary). A missing key answers `null` — honest absence,
 *   never an error.
 */

import {
  isStorageError,
  StorageError,
  type StoragePort,
  type StorageQuota,
} from "@wfx/platform-contracts";

import { isShellIpcError, type ShellIpc } from "./shell-ipc";

/** Map a shell storage failure onto the typed `StorageError` (1:1 vocabulary). */
function storageFailure(operation: string, thrown: unknown): StorageError {
  if (isShellIpcError(thrown)) {
    switch (thrown.code) {
      case "unavailable":
        return new StorageError("unavailable", operation, thrown.detail, true);
      case "quota-exceeded":
        return new StorageError("quota-exceeded", operation, thrown.detail, true);
      case "invalid-key":
        return new StorageError("invalid-key", operation, thrown.detail, false);
      case "io":
        return new StorageError("io", operation, thrown.detail, true);
      case "corrupt":
        return new StorageError("corrupt", operation, thrown.detail, false);
      default:
        // Engine/browser-area codes cannot originate from storage commands;
        // if one does, the shell lied — surface it honestly as an I/O fault.
        return new StorageError("io", operation, `unexpected shell code '${thrown.code}': ${thrown.detail}`, false);
    }
  }
  const detail = thrown instanceof Error ? thrown.message : String(thrown);
  return new StorageError("unavailable", operation, `shell storage backend failed: ${detail}`, true);
}

/**
 * Build the Desktop `StoragePort` over the shell's filesystem commands.
 * Every method maps shell rejections onto the typed `StorageError`.
 */
export function createShellStoragePort(shell: ShellIpc): StoragePort {
  return {
    async get(key: string): Promise<string | null> {
      try {
        return await shell.kvGet(key);
      } catch (thrown) {
        throw storageFailure("get", thrown);
      }
    },

    async set(key: string, value: string): Promise<void> {
      try {
        await shell.kvSet(key, value);
      } catch (thrown) {
        throw storageFailure("set", thrown);
      }
    },

    async remove(key: string): Promise<void> {
      try {
        await shell.kvRemove(key);
      } catch (thrown) {
        throw storageFailure("remove", thrown);
      }
    },

    async keys(prefix?: string): Promise<readonly string[]> {
      try {
        return await shell.kvKeys(prefix);
      } catch (thrown) {
        throw storageFailure("keys", thrown);
      }
    },

    async putBlob(key: string, bytes: Uint8Array): Promise<void> {
      try {
        await shell.blobPut(key, bytes);
      } catch (thrown) {
        throw storageFailure("putBlob", thrown);
      }
    },

    async getBlob(key: string): Promise<Uint8Array | null> {
      try {
        return await shell.blobGet(key);
      } catch (thrown) {
        throw storageFailure("getBlob", thrown);
      }
    },

    async removeBlob(key: string): Promise<void> {
      try {
        await shell.blobRemove(key);
      } catch (thrown) {
        throw storageFailure("removeBlob", thrown);
      }
    },

    async quota(): Promise<StorageQuota> {
      try {
        const accounting = await shell.storageQuota();
        return {
          usageBytes: accounting.usageBytes,
          quotaBytes: accounting.quotaBytes,
        };
      } catch (thrown) {
        // Quota reporting itself failed: an honest unavailable error is
        // better than fabricated accounting numbers.
        throw storageFailure("quota", thrown);
      }
    },
  };
}

export { isStorageError };
