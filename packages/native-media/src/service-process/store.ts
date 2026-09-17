/**
 * @wfx/native-media — the asset store (R10, the real local storage).
 *
 * THE PRODUCTION LOCAL STORAGE for native media: an app-data layout under
 * an INJECTED root (the `EngineConfig.cacheDir` the engine service was
 * spawned with; tests use temp dirs) holding one directory per asset:
 *
 * ```text
 * <root>/
 *   assets/<assetId>/content.bin   — the asset's real bytes (one file per
 *                                    asset in R10; multi-file assets are
 *                                    R11's torrent lane)
 *   assets/<assetId>/meta.json     — the metadata sidecar (size, sha256
 *                                    digest, recorded integrity verdict,
 *                                    content type, timestamps, origin)
 *   journal.ndjson                 — the session journal (see journal.ts)
 *   engine-info.json               — written by the service host (port,
 *                                    protocol version, pid)
 * ```
 *
 * HONESTY LAWS (never fake success, never silent state):
 * - DIGESTS ARE REAL: `importAsset` stream-copies the source bytes and
 *   hashes them with SHA-256 (`Bun.CryptoHasher` — a Bun builtin, no new
 *   dependency) as they land; the hex digest is PERSISTED in the sidecar.
 * - `verified` ONLY when the FULL asset hash matches its RECORDED digest
 *   (`verifyAsset` re-reads every stored byte and re-hashes); `failed` on
 *   mismatch; `unknown` until proven. A verification mismatch is recorded
 *   DATA (the verdict flips to `failed`) — it never throws.
 * - QUOTA IS POLICY PLUS DISK TRUTH: the store enforces its configured
 *   byte budget (`maxBytes`) as a typed refusal BEFORE writing (the
 *   detail carries the numbers), and ANY real write failure (disk full,
 *   EACCES, ENOSPC …) surfaces as a typed `IO_ERROR` whose detail carries
 *   the cause — the R08 port maps `IO_ERROR` to `unavailable`, exactly
 *   the "report unavailable with detail" law. A failed import NEVER
 *   leaves a partial silent state: staging bytes are discarded and, when
 *   nothing valid remains, the asset directory is removed before the
 *   typed failure is returned.
 * - NO SILENT EVICTION: the store never deletes assets on its own;
 *   `removeAsset` is the only deletion path and it is explicit.
 * - DISK IS TRUTH FOR STATS: `statAsset` re-stats the content file on
 *   every call; the sidecar records what landed at import time and the
 *   live stat reports what is on disk NOW (callers compare and refuse
 *   honestly when they disagree — the engine does).
 */

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { NativeMediaError } from "../errors";

// ---------------------------------------------------------------------------
// Metadata shapes
// ---------------------------------------------------------------------------

/** The recorded integrity verdict of a stored asset. */
export type AssetIntegrity = "unknown" | "verified" | "failed";

/**
 * The metadata sidecar of one stored asset (`meta.json`). Written by the
 * store, read by the store; never hand-edited by production code.
 */
export interface AssetMetadata {
  /** The asset identity (also the directory name under `assets/`). */
  readonly assetId: string;
  /** Content type served for this asset (config-injected; the store never sniffs containers). */
  readonly contentType: string;
  /** Size in bytes as recorded at import time. */
  readonly sizeBytes: number;
  /** SHA-256 hex digest of the content at record time; absent until recorded. */
  readonly sha256?: string;
  /** The recorded verdict — `verified` only after a full re-hash matched {@link sha256}. */
  readonly integrity: AssetIntegrity;
  /** The origin path the bytes were imported from, when known. */
  readonly sourcePath?: string;
  /** Wall-clock epoch ms of the first import. */
  readonly createdAt: number;
  /** Wall-clock epoch ms of the last metadata update. */
  readonly updatedAt: number;
}

/** A stored asset: its metadata plus the real content path on disk. */
export interface StoredAsset {
  readonly meta: AssetMetadata;
  /** Absolute path of the content file (real bytes live here). */
  readonly contentPath: string;
}

// ---------------------------------------------------------------------------
// Typed results
// ---------------------------------------------------------------------------

/** The typed result of an import: the stored asset, or a typed failure. */
export type ImportAssetResult =
  | { ok: true; asset: StoredAsset }
  | { ok: false; error: NativeMediaError };

/** The typed result of a verification pass. */
export type VerifyAssetResult =
  | {
      ok: true;
      assetId: string;
      integrity: AssetIntegrity;
      /** The digest computed over the CURRENT stored bytes. */
      digest: string;
      /** The digest recorded in the sidecar (the expectation). */
      recordedDigest: string;
    }
  | { ok: false; error: NativeMediaError };

// ---------------------------------------------------------------------------
// Store configuration
// ---------------------------------------------------------------------------

/** Options for {@link createAssetStore}. */
export interface AssetStoreOptions {
  /** The store root (created when absent; `assets/` lives under it). */
  readonly root: string;
  /**
   * The policy byte budget for stored content. `undefined` = unlimited
   * (disk truth only). Enforced as a typed refusal BEFORE any write.
   */
  readonly maxBytes?: number;
  /** Wall-clock for sidecar timestamps; injectable for tests. Default: Date.now. */
  readonly clock?: () => number;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests + the engine)
// ---------------------------------------------------------------------------

/**
 * SHA-256 hex digest of a byte buffer — the SAME primitive the store
 * streams over content (used by tests to independently verify digests).
 */
export function sha256Hex(data: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  return hasher.digest("hex");
}

/**
 * Derive the deterministic store asset id for a source path: the SHA-256
 * of the ABSOLUTE path, hex, prefixed `asset-` and truncated to 32 hex
 * chars. Re-opening the same path maps to the same asset identity (the
 * gateway URL and journal recovery rely on that stability).
 */
export function assetIdForPath(absolutePath: string): string {
  return `asset-${sha256Hex(new TextEncoder().encode(absolutePath)).slice(0, 32)}`;
}

// ---------------------------------------------------------------------------
// The store surface
// ---------------------------------------------------------------------------

/** The production asset store. */
export interface AssetStore {
  /** The store root (absolute). */
  readonly root: string;
  /** `<root>/assets` (absolute). */
  readonly assetsDir: string;
  /** The configured policy budget, when set. */
  readonly maxBytes: number | undefined;

  /** Every stored asset's metadata (disk truth: read from the sidecars). */
  listAssets(): AssetMetadata[];
  /** One asset's metadata, or `undefined` when not stored. */
  getAsset(assetId: string): AssetMetadata | undefined;
  /** The content path of an asset (existence is checked separately — disk truth). */
  contentPath(assetId: string): string;
  /** The LIVE size of the content file on disk (real stat; null when absent). */
  statAsset(assetId: string): { sizeBytes: number } | null;

  /**
   * Import (or re-import) a source file: stream-copy the real bytes into
   * `assets/<assetId>/content.bin`, hashing as they land; record the
   * sidecar with the digest; then VERIFY (full re-hash vs the recorded
   * digest) so a fresh import is `verified` iff the copy landed intact.
   * Re-importing an existing assetId REPLACES its content and sidecar
   * (the digest changes; the verdict is re-proven).
   */
  importAsset(input: {
    sourcePath: string;
    assetId?: string;
    contentType?: string;
  }): Promise<ImportAssetResult>;

  /**
   * Re-read every stored byte of the asset and compare its SHA-256 to the
   * RECORDED digest. Updates the sidecar verdict (`verified`/`failed`).
   * Typed refusals: unknown asset (`NOT_FOUND`), no recorded digest
   * (`INVALID_INPUT` — nothing to verify against), unreadable content
   * (`IO_ERROR`).
   */
  verifyAsset(assetId: string): Promise<VerifyAssetResult>;

  /**
   * Read the inclusive byte interval `[startByte, endByte]` of the stored
   * content — REAL bytes from disk. Typed failures: unknown asset
   * (`NOT_FOUND`), malformed/unsatisfiable interval (`INVALID_INPUT` /
   * `RANGE_NOT_SATISFIABLE`), read failure (`IO_ERROR`).
   */
  readAssetRange(
    assetId: string,
    startByte: number,
    endByte: number,
  ): Promise<Uint8Array>;

  /** Explicit, typed removal of one asset (content + sidecar). Never silent. */
  removeAsset(assetId: string): { ok: true } | { ok: false; error: NativeMediaError };

  /** Sum of RECORDED asset sizes (the policy view; disk truth is statAsset). */
  usedBytes(): number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const CONTENT_FILE = "content.bin";
const META_FILE = "meta.json";

/** Best-effort removal for failure-path cleanup (never masks the real error). */
function safeRm(path: string, recursive = false): void {
  try {
    rmSync(path, { force: true, ...(recursive ? { recursive: true } : {}) });
  } catch {
    // Cleanup is best-effort: the typed failure being built is the truth.
  }
}

function invalidInput(detail: string): NativeMediaError {
  return new NativeMediaError("INVALID_INPUT", { detail });
}

class AssetStoreImpl implements AssetStore {
  readonly root: string;
  readonly assetsDir: string;
  readonly maxBytes: number | undefined;
  private readonly clock: () => number;

  constructor(options: AssetStoreOptions) {
    if (typeof options !== "object" || options === null) {
      throw invalidInput("createAssetStore: options must be an object");
    }
    if (typeof options.root !== "string" || options.root.trim().length === 0) {
      throw invalidInput("createAssetStore: root must be a non-empty string");
    }
    if (
      options.maxBytes !== undefined &&
      (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0)
    ) {
      throw invalidInput(
        "createAssetStore: maxBytes must be a non-negative safe integer when present",
      );
    }
    this.root = resolve(options.root);
    this.assetsDir = join(this.root, "assets");
    this.maxBytes = options.maxBytes;
    this.clock = options.clock ?? (() => Date.now());
    mkdirSync(this.assetsDir, { recursive: true });
  }

  // --- metadata reads (disk truth) ------------------------------------------

  listAssets(): AssetMetadata[] {
    const out: AssetMetadata[] = [];
    let entries;
    try {
      entries = readdirSync(this.assetsDir, { withFileTypes: true });
    } catch {
      return out; // unreadable/absent assets dir — the store is empty, honestly
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = this.readMeta(entry.name);
      if (meta !== undefined) out.push(meta);
    }
    return out.sort((a, b) => (a.assetId < b.assetId ? -1 : 1));
  }

  getAsset(assetId: string): AssetMetadata | undefined {
    this.requireAssetId(assetId);
    return this.readMeta(assetId);
  }

  contentPath(assetId: string): string {
    this.requireAssetId(assetId);
    return join(this.assetsDir, assetId, CONTENT_FILE);
  }

  statAsset(assetId: string): { sizeBytes: number } | null {
    this.requireAssetId(assetId);
    try {
      const st = statSync(this.contentPath(assetId));
      if (!st.isFile()) return null;
      return { sizeBytes: st.size };
    } catch {
      return null;
    }
  }

  // --- import + verify -------------------------------------------------------

  async importAsset(input: {
    sourcePath: string;
    assetId?: string;
    contentType?: string;
  }): Promise<ImportAssetResult> {
    if (typeof input !== "object" || input === null) {
      return { ok: false, error: invalidInput("importAsset: input must be an object") };
    }
    const sourcePath = input.sourcePath;
    if (typeof sourcePath !== "string" || sourcePath.trim().length === 0) {
      return {
        ok: false,
        error: invalidInput("importAsset: sourcePath must be a non-empty string"),
      };
    }
    const assetId =
      input.assetId === undefined
        ? assetIdForPath(resolve(sourcePath))
        : input.assetId;
    this.requireAssetId(assetId);
    const contentType =
      input.contentType === undefined ? "application/octet-stream" : input.contentType;
    if (typeof contentType !== "string" || contentType.trim().length === 0) {
      return {
        ok: false,
        error: invalidInput(
          "importAsset: contentType must be a non-empty string when present",
        ),
      };
    }

    // Real stat of the source FIRST: the bytes must exist before anything
    // is written (no partial state can even begin otherwise).
    let sourceSize: number;
    try {
      const st = statSync(sourcePath);
      if (!st.isFile()) {
        return {
          ok: false,
          error: new NativeMediaError("NOT_FOUND", {
            detail: `importAsset: source path '${sourcePath}' is not a regular file`,
          }),
        };
      }
      sourceSize = st.size;
    } catch (e) {
      return {
        ok: false,
        error: new NativeMediaError("NOT_FOUND", {
          detail: `importAsset: source file '${sourcePath}' does not exist or cannot be stat'd`,
          cause: e,
        }),
      };
    }

    // Policy quota FIRST (typed refusal before any write; real disk-truth
    // failures surface below as IO_ERROR with the cause in the detail).
    if (this.maxBytes !== undefined) {
      const used = this.usedBytes();
      const replacing = this.getAsset(assetId);
      const replaceBytes = replacing === undefined ? 0 : replacing.sizeBytes;
      if (used - replaceBytes + sourceSize > this.maxBytes) {
        return {
          ok: false,
          error: new NativeMediaError("IO_ERROR", {
            detail:
              `importAsset: refusing to import ${sourceSize} byte(s) for '${assetId}': ` +
              `the store budget would reach ${used - replaceBytes + sourceSize} of ${this.maxBytes} byte(s) ` +
              "(quota is policy + disk truth; free or raise the budget, or remove assets explicitly)",
          }),
        };
      }
    }

    const assetDir = join(this.assetsDir, assetId);
    const targetPath = join(assetDir, CONTENT_FILE);
    // Stage into a temp sibling so a failed import NEVER leaves a partial
    // asset directory (no silent state): only a fully written content file
    // is renamed into place, sidecar written last.
    const stagingPath = join(assetDir, `${CONTENT_FILE}.staging`);
    try {
      mkdirSync(assetDir, { recursive: true });
      const hasher = new Bun.CryptoHasher("sha256");
      const source = Bun.file(sourcePath);
      const sink = Bun.file(stagingPath).writer();
      let written = 0;
      // Stream copy + hash: the digest is computed over the bytes that
      // actually LAND, chunk by chunk (real I/O, real accounting).
      const reader = source.stream().getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done || value === undefined) break;
        hasher.update(value);
        await sink.write(value);
        written += value.byteLength;
      }
      await sink.end();
      if (written !== sourceSize) {
        // The source changed size mid-copy: the copy is not faithful —
        // discard it and refuse honestly (nothing was stored).
        safeRm(stagingPath);
        return {
          ok: false,
          error: new NativeMediaError("IO_ERROR", {
            detail:
              `importAsset: the source '${sourcePath}' changed size while being read ` +
              `(stat said ${sourceSize}, copied ${written} byte(s)) — the copy was discarded, nothing was stored`,
          }),
        };
      }
      renameSync(stagingPath, targetPath);
      const now = this.clock();
      const previous = this.getAsset(assetId);
      const absoluteSource = resolve(sourcePath);
      const meta: AssetMetadata = {
        assetId,
        contentType,
        sizeBytes: written,
        sha256: hasher.digest("hex"),
        integrity: "unknown",
        sourcePath: absoluteSource,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      writeFileSync(join(assetDir, META_FILE), JSON.stringify(meta, null, 2));
      // A fresh import is verified only by PROOF: re-hash the stored
      // bytes against the digest just recorded.
      const verify = await this.verifyAsset(assetId);
      if (!verify.ok) {
        return { ok: false, error: verify.error };
      }
      const stored = this.getAsset(assetId);
      if (stored === undefined) {
        return {
          ok: false,
          error: new NativeMediaError("INTERNAL", {
            detail: `importAsset: the sidecar of '${assetId}' vanished immediately after being written`,
          }),
        };
      }
      return { ok: true, asset: { meta: stored, contentPath: targetPath } };
    } catch (e) {
      // Any real failure (disk full, permissions, ...): clean the partial
      // state (best-effort — the typed failure is the truth) and surface
      // the typed IO_ERROR with the cause in the detail.
      safeRm(stagingPath);
      try {
        const remaining = readdirSync(assetDir);
        if (remaining.length === 0) safeRm(assetDir, true);
      } catch {
        // The dir may not exist (or is not a dir) — nothing to clean.
      }
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      return {
        ok: false,
        error: new NativeMediaError("IO_ERROR", {
          detail: `importAsset: writing '${assetId}' failed (quota is disk truth; no partial state was kept): ${detail}`,
          cause: e,
        }),
      };
    }
  }

  async verifyAsset(assetId: string): Promise<VerifyAssetResult> {
    this.requireAssetId(assetId);
    const meta = this.getAsset(assetId);
    if (meta === undefined) {
      return {
        ok: false,
        error: new NativeMediaError("NOT_FOUND", {
          detail: `verifyAsset: no asset '${assetId}' is stored`,
        }),
      };
    }
    if (meta.sha256 === undefined) {
      return {
        ok: false,
        error: invalidInput(
          `verifyAsset: asset '${assetId}' has no recorded digest to verify against`,
        ),
      };
    }
    const contentPath = this.contentPath(assetId);
    let hasher: Bun.CryptoHasher;
    try {
      hasher = new Bun.CryptoHasher("sha256");
      const reader = Bun.file(contentPath).stream().getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done || value === undefined) break;
        hasher.update(value);
      }
    } catch (e) {
      return {
        ok: false,
        error: new NativeMediaError("IO_ERROR", {
          detail: `verifyAsset: reading the stored bytes of '${assetId}' failed: ${e instanceof Error ? e.message : String(e)}`,
          cause: e,
        }),
      };
    }
    const digest = hasher.digest("hex");
    const integrity: AssetIntegrity = digest === meta.sha256 ? "verified" : "failed";
    // Record the verdict in the sidecar (data, not an exception).
    this.writeMeta({
      ...meta,
      integrity,
      updatedAt: this.clock(),
    });
    return { ok: true, assetId, integrity, digest, recordedDigest: meta.sha256 };
  }

  // --- range reads over the real bytes ---------------------------------------

  async readAssetRange(
    assetId: string,
    startByte: number,
    endByte: number,
  ): Promise<Uint8Array> {
    this.requireAssetId(assetId);
    const meta = this.getAsset(assetId);
    if (meta === undefined) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `readAssetRange: no asset '${assetId}' is stored`,
      });
    }
    if (
      typeof startByte !== "number" ||
      !Number.isSafeInteger(startByte) ||
      typeof endByte !== "number" ||
      !Number.isSafeInteger(endByte) ||
      startByte < 0 ||
      endByte < startByte
    ) {
      throw invalidInput(
        `readAssetRange: [${String(startByte)}, ${String(endByte)}] is not a well-formed inclusive byte interval`,
      );
    }
    if (startByte >= meta.sizeBytes || endByte >= meta.sizeBytes) {
      throw new NativeMediaError("RANGE_NOT_SATISFIABLE", {
        detail: `readAssetRange: [${startByte}, ${endByte}] is not satisfiable against ${meta.sizeBytes} recorded bytes of '${assetId}'`,
      });
    }
    try {
      const slice = Bun.file(this.contentPath(assetId)).slice(startByte, endByte + 1);
      const buffer = await slice.arrayBuffer();
      return new Uint8Array(buffer);
    } catch (e) {
      throw new NativeMediaError("IO_ERROR", {
        detail: `readAssetRange: reading bytes ${startByte}-${endByte} of '${assetId}' failed: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      });
    }
  }

  removeAsset(assetId: string): { ok: true } | { ok: false; error: NativeMediaError } {
    this.requireAssetId(assetId);
    const assetDir = join(this.assetsDir, assetId);
    if (this.getAsset(assetId) === undefined) {
      return {
        ok: false,
        error: new NativeMediaError("NOT_FOUND", {
          detail: `removeAsset: no asset '${assetId}' is stored`,
        }),
      };
    }
    try {
      rmSync(assetDir, { recursive: true, force: true });
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: new NativeMediaError("IO_ERROR", {
          detail: `removeAsset: removing '${assetId}' failed: ${e instanceof Error ? e.message : String(e)}`,
          cause: e,
        }),
      };
    }
  }

  usedBytes(): number {
    let total = 0;
    for (const meta of this.listAssets()) {
      total += meta.sizeBytes;
    }
    return total;
  }

  // --- internals ---------------------------------------------------------------

  private requireAssetId(assetId: string): void {
    if (typeof assetId !== "string" || assetId.trim().length === 0) {
      throw invalidInput("assetId must be a non-empty string");
    }
    if (assetId.includes("/") || assetId.includes("\\") || assetId === "." || assetId === "..") {
      throw invalidInput(
        `assetId must be a plain directory name (got '${assetId}')`,
      );
    }
  }

  /** Read + validate one sidecar; undefined when absent or unreadable. */
  private readMeta(assetId: string): AssetMetadata | undefined {
    const metaPath = join(this.assetsDir, assetId, META_FILE);
    try {
      const raw = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
      const {
        assetId: rawAssetId,
        contentType,
        sizeBytes,
        integrity,
        createdAt,
        updatedAt,
        sha256,
        sourcePath,
      } = raw;
      if (
        typeof rawAssetId !== "string" ||
        rawAssetId !== assetId ||
        typeof contentType !== "string" ||
        typeof sizeBytes !== "number" ||
        !Number.isSafeInteger(sizeBytes) ||
        sizeBytes < 0 ||
        (integrity !== "unknown" && integrity !== "verified" && integrity !== "failed") ||
        typeof createdAt !== "number" ||
        !Number.isFinite(createdAt) ||
        typeof updatedAt !== "number" ||
        !Number.isFinite(updatedAt)
      ) {
        return undefined; // a corrupt sidecar is not an asset (disk truth wins)
      }
      const meta: AssetMetadata = {
        assetId: rawAssetId,
        contentType,
        sizeBytes,
        integrity,
        createdAt,
        updatedAt,
        ...(typeof sha256 === "string" ? { sha256 } : {}),
        ...(typeof sourcePath === "string" ? { sourcePath } : {}),
      };
      return meta;
    } catch {
      return undefined;
    }
  }

  private writeMeta(meta: AssetMetadata): void {
    const assetDir = join(this.assetsDir, meta.assetId);
    mkdirSync(assetDir, { recursive: true });
    writeFileSync(join(assetDir, META_FILE), JSON.stringify(meta, null, 2));
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the production asset store under `options.root`. The `assets/`
 * directory is created eagerly (a store with no assets is a valid,
 * honestly-empty store). Throws a typed `INVALID_INPUT` error on a
 * malformed options object.
 */
export function createAssetStore(options: AssetStoreOptions): AssetStore {
  return new AssetStoreImpl(options);
}
