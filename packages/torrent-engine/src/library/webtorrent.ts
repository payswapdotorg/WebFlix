/**
 * @wfx/torrent-engine — the PRODUCTION mature-library binding (invariant 6).
 *
 * LIBRARY EVALUATION RECORD (documented for lead review, as the freeze
 * demands — "use a mature protocol implementation ... document the choice
 * and the version pin"):
 *
 * - **Chosen: `webtorrent@3.0.21` (MIT, the WebTorrent project).** The
 *   primary candidate per the remediation architecture: mature (10+ years
 *   of production use, the reference Node/Web torrent client), MIT, wired
 *   for BOTH `.torrent` files and magnet URIs, DHT/tracker/PEX capable,
 *   and it runs under Bun/Node. Pin: EXACT `3.0.21` in package.json.
 * - **Parser: `parse-torrent@11.0.24` (MIT, same project).** webtorrent's
 *   OWN pinned parser (its dependency range is `^11.0.24`) — the exact
 *   package webtorrent itself uses to decode magnets and metainfo. It is
 *   pure JavaScript (bencode + magnet-uri; no native code), so the parse
 *   seam is deterministic and offline. Pin: EXACT `11.0.24`.
 * - **Alternatives rejected**: implementing the protocol in product-core
 *   TypeScript (forbidden by invariant 6); `webtorrent@2.x` (its
 *   `arr2hex(parsedTorrent.infoHash)` call is incompatible with
 *   parse-torrent >= 11.0.19 — verified: adding a torrent throws
 *   `ERR_INVALID_ARG_TYPE` under BOTH Bun and Node); other Node clients
 *   (e.g. `torrent-stream`-family) are less maintained and were not part of
 *   the architecture's primary-candidate list.
 * - **Bun compatibility (verified in this sandbox, offline, no swarm)**:
 *   - `import "webtorrent"` works under Bun 1.3.x ONCE the `node-datachannel`
 *     prebuilt binary is present (root `trustedDependencies` fetches it on
 *     `bun install`; it is webtorrent's WebRTC stack).
 *   - The uTP listener trips Bun's unsupported `uv_timer_init` NAPI call
 *     (Bun issue #18546): the binding therefore constructs every client
 *     with `utp: false`. uTP is an optional transport — BitTorrent over
 *     TCP/WebRTC is unaffected.
 *   - `new WebTorrent({ utp: false, ... })`, `client.add(bytes, { path,
 *     verify: true })`, per-piece `verified` events, file `select`/
 *     `deselect`, `pause`/`resume`, and `destroy` were all exercised
 *     offline against fixture data under Bun during evaluation.
 * - **LAZY-IMPORT LAW**: this module imports `webtorrent` ONLY via dynamic
 *     `import()` inside `createSession`, so importing
 *     `@wfx/torrent-engine` never transitively loads the native module —
 *     environments without the prebuilt stay functional (parsing + the
 *     loopback double path), and the desktop composition root opts into
 *     the full client when it wires sessions. `parse-torrent` (pure JS)
 *     is imported statically for the parse seam.
 */

import { torrentError, type TorrentResult } from "../errors";
import type {
  LibraryPiecePriority,
  LibrarySession,
  LibrarySessionEvent,
  LibrarySessionSnapshot,
  LibrarySessionSpec,
  ParsedMetainfo,
  TorrentLibrary,
} from "./contract";

// The pinned stack identities (mirrored in package.json — see module docs).
export const WEBTORRENT_LIBRARY_IMPLEMENTATION = "webtorrent@3.0.21 (parse-torrent@11.0.24)";

// ---------------------------------------------------------------------------
// parse-torrent mapping (static import: pure JS, deterministic, offline)
// ---------------------------------------------------------------------------

interface ParseTorrentFileEntry {
  path: string;
  name: string;
  length: number;
}

interface ParseTorrentResult {
  infoHash?: string;
  name?: string;
  pieceLength?: number;
  length?: number;
  pieces?: Uint8Array;
  files?: ParseTorrentFileEntry[];
  announce?: string[];
  urlList?: string[];
  private?: boolean;
}

/** Map a parse-torrent result onto the seam metainfo (total, no invention). */
function metainfoFromParseTorrent(parsed: ParseTorrentResult): ParsedMetainfo | undefined {
  if (
    typeof parsed.infoHash !== "string" ||
    typeof parsed.name !== "string" ||
    typeof parsed.pieceLength !== "number" ||
    typeof parsed.length !== "number"
  ) {
    return undefined;
  }
  const rawFiles = parsed.files ?? [];
  let offset = 0;
  const files = rawFiles.map((file) => {
    const entry = {
      path: file.path,
      name: file.name,
      lengthBytes: file.length,
      offsetBytes: offset,
    };
    offset += file.length;
    return entry;
  });
  const trackers: string[] = [];
  for (const url of parsed.announce ?? []) {
    if (!trackers.includes(url)) trackers.push(url);
  }
  return {
    infoHash: parsed.infoHash,
    name: parsed.name,
    pieceLengthBytes: parsed.pieceLength,
    totalBytes: parsed.length,
    pieceCount: Math.max(1, Math.ceil(parsed.length / parsed.pieceLength)),
    files,
    trackers,
    isPrivate: parsed.private === true,
  };
}

// ---------------------------------------------------------------------------
// The binding
// ---------------------------------------------------------------------------

/** Options for {@link createWebTorrentLibrary}. */
export interface WebTorrentLibraryOptions {
  /**
   * A wall clock used for honest peer-activity timestamps. Default:
   * Date.now.
   */
  readonly clock?: () => number;
  /**
   * Extra client options forwarded to the webtorrent client constructor
   * (the binding's own options — `utp: false`, no NAT/UPnP — are NOT
   * overridable: they are the verified-under-Bun configuration).
   */
  readonly clientOptions?: Readonly<Record<string, unknown>>;
}

/**
 * The PRODUCTION `TorrentLibrary` over the pinned webtorrent stack. The
 * client is constructed lazily on the first session; parsing is offline
 * and deterministic through parse-torrent (webtorrent's own parser).
 */
export function createWebTorrentLibrary(
  options: WebTorrentLibraryOptions = {},
): TorrentLibrary {
  const clock = options.clock ?? (() => Date.now());
  let client: unknown | undefined;
  let destroyed = false;

  interface WebTorrentTorrent {
    infoHash: string;
    name: string;
    pieceLength: number;
    length: number;
    pieces: unknown[];
    numPeers: number;
    progress: number;
    downloaded: number;
    downloadedBytes?: number;
    uploadSpeed: number;
    downloadSpeed: number;
    files: {
      name: string;
      path: string;
      length: number;
      offset: number;
      select(): void;
      deselect(): void;
    }[];
    bitfield: { get(index: number): boolean | number };
    /**
     * Select a piece range with a priority (webtorrent's own scheduling
     * mechanism — R12's seam maps urgency onto it). Higher priority
     * selections are requested first.
     */
    select(start: number, end: number, priority?: number): void;
    /** Deselect a piece range (removes/splits intersecting selections). */
    deselect(start: number, end: number): void;
    /** Mark a piece range critical (fetch ASAP; enables hotswap). */
    critical(start: number, end: number): void;
    pause(): void;
    resume(): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
  }

  interface WebTorrentClient {
    add(
      torrentId: string | Uint8Array,
      options: Record<string, unknown>,
    ): WebTorrentTorrent;
    remove(torrent: WebTorrentTorrent, callback: (err?: Error) => void): void;
    destroy(callback: (err?: Error) => void): void;
  }

  const getClient = async (): Promise<WebTorrentClient> => {
    if (destroyed) {
      throw new Error("the webtorrent library binding was destroyed");
    }
    if (client === undefined) {
      // LAZY-IMPORT LAW: node-datachannel (webtorrent's WebRTC stack) is a
      // native module — it only loads in environments that have the
      // prebuilt (root trustedDependencies). Importing here keeps every
      // other surface of @wfx/torrent-engine loadable without it.
      const module = (await import("webtorrent")) as {
        default: new (options: Record<string, unknown>) => WebTorrentClient;
      };
      client = new module.default({
        // The verified-under-Bun configuration: uTP's native listener calls
        // uv_timer_init, which Bun's NAPI does not yet support (issue
        // #18546) — uTP is optional to BitTorrent; TCP + WebRTC remain.
        utp: false,
        // Honest minimal surface: no NAT mapping, no UPnP port opening.
        upnp: false,
        nat: false,
        ...(options.clientOptions ?? {}),
      });
    }
    return client as WebTorrentClient;
  };

  const parseTorrentModule = async (): Promise<{
    default: (input: string | Uint8Array) => Promise<ParseTorrentResult>;
  }> => {
    const module = (await import("parse-torrent")) as {
      default: (input: string | Uint8Array) => Promise<unknown>;
    };
    return {
      default: (input: string | Uint8Array) =>
        module.default(input) as Promise<ParseTorrentResult>,
    };
  };

  const sessionFor = (torrent: WebTorrentTorrent, spec: LibrarySessionSpec): LibrarySession => {
    const handlers = new Set<(event: LibrarySessionEvent) => void>();
    let paused = false;
    let selectedIndexes = new Set<number>(spec.selectedFileIndexes);
    let lastPeerActivityAt: number | undefined;
    let metadataEmitted = false;
    // R12: the scheduler's piece-priority hints, plus everything this
    // binding currently holds applied on the torrent (base file ranges +
    // hint ranges). The full re-apply keeps the torrent's selection list
    // EXACTLY (selected files at priority 0 — the completion fallback —
    // plus the hint ranges at their urgencies): deterministic, no
    // accumulation across replans.
    let schedulerHints: readonly LibraryPiecePriority[] = [];
    let appliedSelections: { from: number; to: number }[] = [];
    // webtorrent inserts a DEFAULT whole-torrent selection while parsing
    // metadata (its own "start off selecting the entire torrent" law).
    // The first applySelection clears it once and takes ownership of the
    // selection state; from then on the bookkeeping above is exact.
    let selectionOwned = false;

    const emit = (event: LibrarySessionEvent): void => {
      for (const handler of handlers) handler(event);
    };

    /** The piece range covering one file (webtorrent's own geometry). */
    const filePieceRange = (index: number): { from: number; to: number } | null => {
      const file = torrent.files[index];
      if (file === undefined || file.length === 0) return null;
      const from = Math.floor(file.offset / torrent.pieceLength);
      const to = Math.floor((file.offset + file.length - 1) / torrent.pieceLength);
      return { from, to };
    };

    const applySelection = (): void => {
      if (torrent.files.length === 0) return; // nothing to select yet
      if (!selectionOwned) {
        const pieceCount = Math.max(1, Math.ceil(torrent.length / torrent.pieceLength));
        torrent.deselect(0, pieceCount - 1);
        selectionOwned = true;
        appliedSelections = [];
      }
      // The full re-apply. Deselecting a superset range also removes
      // contained selections (webtorrent's own remove semantics), so
      // deselecting everything previously applied converges to a clean
      // slate — no residue, no duplication.
      for (const range of appliedSelections) {
        torrent.deselect(range.from, range.to);
      }
      appliedSelections = [];
      // Base: the selected files at priority 0 — the library's own
      // completion order (R11's selection law, unchanged).
      for (let index = 0; index < torrent.files.length; index += 1) {
        if (!selectedIndexes.has(index)) continue;
        const range = filePieceRange(index);
        if (range === null) continue;
        torrent.select(range.from, range.to, 0);
        appliedSelections.push(range);
      }
      // Hints: the scheduler's windows at their urgencies. The top
      // urgency additionally rides webtorrent's own `critical` flag
      // (jump-the-queue + hotswap — the library's real mechanism for
      // "the player is waiting on these bytes").
      for (const hint of schedulerHints) {
        torrent.select(hint.fromPiece, hint.toPiece, hint.urgency);
        if (hint.urgency >= 5) torrent.critical(hint.fromPiece, hint.toPiece);
        appliedSelections.push({ from: hint.fromPiece, to: hint.toPiece });
      }
    };

    const emitMetadataOnce = (): void => {
      if (metadataEmitted || torrent.files.length === 0) return;
      metadataEmitted = true;
      const pieceCount = Math.max(1, Math.ceil(torrent.length / torrent.pieceLength));
      let offset = 0;
      const files = torrent.files.map((file) => {
        const entry = {
          path: file.path,
          name: file.name,
          lengthBytes: file.length,
          offsetBytes: offset,
        };
        offset += file.length;
        return entry;
      });
      emit({
        kind: "metadata",
        metainfo: {
          infoHash: torrent.infoHash,
          name: torrent.name,
          pieceLengthBytes: torrent.pieceLength,
          totalBytes: torrent.length,
          pieceCount,
          files,
          trackers: [],
          isPrivate: false,
        },
      });
      if (selectedIndexes.size > 0) applySelection();
    };

    // webtorrent may deliver the file list at 'metadata' or 'ready'
    // (depending on the add path); the seam event fires exactly once.
    torrent.on("metadata", emitMetadataOnce);
    torrent.on("ready", emitMetadataOnce);
    torrent.on("verified", (index: unknown) => {
      emit({ kind: "piece-verified", piece: Number(index) });
    });
    torrent.on("done", () => {
      emit({ kind: "done" });
    });
    torrent.on("error", (err: unknown) => {
      emit({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
        fatal: true,
      });
    });
    torrent.on("warning", (err: unknown) => {
      emit({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
        fatal: false,
      });
    });
    torrent.on("wire", () => {
      lastPeerActivityAt = clock();
    });

    return {
      infoHash: torrent.infoHash,
      onEvent(handler): () => void {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      snapshot(): LibrarySessionSnapshot {
        const now = clock();
        if (torrent.numPeers > 0) lastPeerActivityAt = now;
        const pieceCount = Math.max(1, Math.ceil(torrent.length / torrent.pieceLength));
        const bitfield = new Uint8Array(Math.ceil(pieceCount / 8));
        for (let i = 0; i < pieceCount; i += 1) {
          if (torrent.bitfield.get(i)) {
            bitfield[i >> 3]! |= 0x80 >> (i & 7);
          }
        }
        const downloaded = torrent.downloaded ?? 0;
        return {
          connectedPeers: torrent.numPeers,
          bitfield,
          verifiedBytes: Math.min(downloaded, torrent.length),
          downloadBytesPerSec: paused ? 0 : torrent.downloadSpeed,
          uploadBytesPerSec: paused ? 0 : torrent.uploadSpeed,
          ...(lastPeerActivityAt !== undefined
            ? { lastPeerActivityAt }
            : {}),
        };
      },
      selectFiles(fileIndexes): void {
        selectedIndexes = new Set(fileIndexes);
        if (torrent.files.length > 0) applySelection();
      },
      prioritizePieces(priorities): void {
        // Store the hints; the full re-apply (below) keeps the torrent's
        // selection list exactly (file selection + hints). Malformed hints
        // are the ENGINE's validation business (session.applyPiecePriorities);
        // the binding trusts its caller and stays total.
        schedulerHints = priorities.slice();
        if (torrent.files.length > 0) applySelection();
      },
      pause(): void {
        paused = true;
        torrent.pause();
      },
      resume(): void {
        paused = false;
        torrent.resume();
      },
      async destroy(): Promise<void> {
        // Remove THIS torrent from the shared client; the client itself
        // stays (other sessions may still use it) until library destroy.
        const current = client;
        if (current === undefined) return;
        const owning = current as WebTorrentClient;
        await new Promise<void>((resolve) => {
          owning.remove(torrent, () => resolve());
        });
      },
    };
  };

  return {
    implementation: WEBTORRENT_LIBRARY_IMPLEMENTATION,

    async parseMagnet(uri: string): Promise<TorrentResult<{ infoHash: string; displayName?: string; trackers: readonly string[] }>> {
      try {
        const parsed = await (await parseTorrentModule()).default(uri);
        if (typeof parsed.infoHash !== "string") {
          return torrentError("INVALID_MAGNET", {
            detail: `parseMagnet: '${uri}' did not carry a usable btih infohash`,
          });
        }
        return {
          ok: true,
          value: {
            infoHash: parsed.infoHash,
            ...(typeof parsed.name === "string" ? { displayName: parsed.name } : {}),
            trackers: [...new Set(parsed.announce ?? [])],
          },
        };
      } catch (e) {
        return torrentError("INVALID_MAGNET", {
          detail: `parseMagnet: '${uri}' is not a parseable magnet URI: ${e instanceof Error ? e.message : String(e)}`,
          cause: e,
        });
      }
    },

    async parseTorrentFile(bytes: Uint8Array): Promise<TorrentResult<ParsedMetainfo>> {
      try {
        const parsed = await (await parseTorrentModule()).default(bytes);
        const mapped = metainfoFromParseTorrent(parsed);
        if (mapped === undefined) {
          return torrentError("INVALID_TORRENT_FILE", {
            detail: "parseTorrentFile: the bytes did not decode into complete metainfo (name/pieceLength/length missing)",
          });
        }
        return { ok: true, value: mapped };
      } catch (e) {
        return torrentError("INVALID_TORRENT_FILE", {
          detail: `parseTorrentFile: the bytes are not valid bencoded metainfo: ${e instanceof Error ? e.message : String(e)}`,
          cause: e,
        });
      }
    },

    async createSession(spec: LibrarySessionSpec): Promise<TorrentResult<LibrarySession>> {
      try {
        const wt = await getClient();
        // The ORIGINAL .torrent bytes when the engine has them (webtorrent
        // decodes them itself — no metadata fetch needed); otherwise the
        // magnet URI (webtorrent resolves its metadata through the swarm).
        const torrentId: string | Uint8Array | undefined =
          spec.metainfoBytes ??
          spec.magnetUri ??
          (spec.metainfo !== undefined
            ? magnetForInfoHash(spec.metainfo.infoHash, spec.metainfo.name)
            : undefined);
        if (torrentId === undefined) {
          return torrentError("INVALID_INPUT", {
            detail: "createSession: the spec carries neither .torrent bytes, a magnet URI, nor metainfo",
          });
        }
        const torrent = wt.add(torrentId, {
          path: spec.dataDir,
          // The resume path: webtorrent re-hashes existing disk bytes
          // against the metainfo piece hashes before transferring.
          ...(spec.verifyExistingData ? { verify: true } : {}),
        });
        return { ok: true, value: sessionFor(torrent, spec) };
      } catch (e) {
        return torrentError("LIBRARY_ERROR", {
          detail: `createSession: the webtorrent client refused the session: ${e instanceof Error ? e.message : String(e)}`,
          cause: e,
        });
      }
    },

    async destroy(): Promise<void> {
      destroyed = true;
      const owningClient = client;
      client = undefined;
      if (owningClient === undefined) return;
      await new Promise<void>((resolve) => {
        (owningClient as WebTorrentClient).destroy(() => resolve());
      });
    },
  };
}

/** Build a magnet URI from an infohash + optional display name. */
function magnetForInfoHash(infoHash: string, name: string): string {
  const params = [`xt=urn:btih:${infoHash}`];
  if (name.length > 0) params.push(`dn=${encodeURIComponent(name)}`);
  return `magnet:?${params.join("&")}`;
}
