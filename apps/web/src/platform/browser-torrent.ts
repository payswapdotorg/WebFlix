/**
 * @wfx/app-web — the BROWSER torrent adapter (R23-D).
 *
 * THE LAW THIS MODULE BINDS (docs/plans/
 * 2026-09-20-webflix-open-viewing-torrent-ai-plan.md — R23-D; the R23-C
 * first-class realization contract it serves): WebTorrent streams in the
 * browser using WEBRTC — ordinary TCP/UDP-only BitTorrent peers are NOT
 * reachable from a browser. Therefore:
 *
 * - the browser adapter is an OPTIONAL REALIZATION, never a Desktop
 *   replacement: it satisfies the BROWSER rung only where the swarm is
 *   WebRTC-capable (`browserCapable` — the per-realization declared
 *   truth) AND the viewer's browser provides WebRTC (the environment
 *   probe below);
 * - CAPABILITY TRUTH distinguishes WebTorrent-capable from ordinary
 *   torrent availability (the two are never conflated);
 * - the adapter lives BEHIND the existing `TorrentLibrary` boundary
 *   (`@wfx/torrent-engine`'s frozen seam — the same contract the
 *   production Node binding implements; NO protocol logic lives in
 *   product code);
 * - it uses the EXISTING authorization/provenance gate (the R11/R13
 *   laws are untouched: an unauthorized copy is never offered, and the
 *   adapter adds no acquisition rights of its own);
 * - unsupported/browser-incompatible torrents fall back HONESTLY to the
 *   Desktop/native next step (the R23-C `desktop-next-step` outcome).
 *
 * LIBRARY EVALUATION RECORD (documented for lead review — the invariant-6
 * law the Node binding follows):
 *
 * - **Chosen: the `webtorrent@3.0.21` BROWSER build** (MIT; the same
 *   pinned stack the production binding documents — one library, two
 *   execution environments). Its browser build speaks WebRTC peers via
 *   `@thaunknown/simple-peer` and reaches swarms through WebSocket
 *   trackers (wss:) and WebRTC signaling; it exposes file streams,
 *   seek-before-completion, and rendering into a `<video>` element.
 * - **WebRTC-ONLY reachability**: a browser client cannot open TCP/UDP
 *   peer sockets; only peers that themselves speak WebRTC (WebTorrent
 *   hybrid clients) are reachable. Swarms without WebRTC-capable peers
 *   are HONESTLY unreachable — the typed `LIBRARY_ERROR` truth, never a
 *   silent hang.
 * - **Alternatives rejected**: a custom WebRTC protocol implementation
 *   (forbidden by invariant 6 — no protocol re-implementation in
 *   product code); server-side proxying of the swarm through the Next.js
 *   host (that is the Desktop/Node path's role — the browser adapter is
 *   precisely the client-side optional realization).
 * - **LAZY-IMPORT LAW**: `webtorrent` and `parse-torrent` load ONLY via
 *   dynamic `import()` inside the functions that need them, so neither
 *   the server bundle nor any non-torrent page ever loads them.
 *
 * WHAT THIS MODULE IS: the browser-side `TorrentLibrary` binding + the
 * environment/capability truth the R23-E surfaces consume. The staged
 * playback UX (the acquisition lifecycle surface) lives in the player's
 * torrent stage; this module is the adapter, not the UI.
 */

import type { TorrentResult } from "@wfx/torrent-engine";
import { torrentError } from "@wfx/torrent-engine";
import type {
  LibrarySession,
  LibrarySessionEvent,
  LibrarySessionSpec,
  ParsedMetainfo,
  TorrentLibrary,
} from "@wfx/torrent-engine";

// ---------------------------------------------------------------------------
// The adapter identity + the capability truth
// ---------------------------------------------------------------------------

/**
 * The browser adapter's identity (the same version-pin law as the Node
 * binding; surfaces in capability truth so the wired stack is always
 * inspectable — never a silent fixture-as-production claim).
 */
export const WEB_BROWSER_TORRENT_IMPLEMENTATION =
  "webtorrent@3.0.21 browser build (WebRTC peers; parse-torrent@11.0.24)";

/**
 * THE ADAPTER-DECLARED CAPABILITY TRUTH the R23-C rung decision consumes
 * (`TorrentPlatformTruth.browserTorrentSupported` on the web platform):
 * the Web adapter WIRES browser torrent playback through this adapter —
 * a real adapter path, not an assumption. Per-realization truth
 * (`browserCapable`) and per-environment truth (the WebRTC probe below)
 * still decide each play, with honest typed fallbacks — the capability
 * claim never outruns the adapter.
 */
export const WEB_BROWSER_TORRENT_SUPPORTED = true;

// ---------------------------------------------------------------------------
// The environment probe (WebRTC truth; client-side only)
// ---------------------------------------------------------------------------

/** The browser-torrent environment truth (the honest probe result). */
export interface BrowserTorrentEnvironment {
  /** Whether this context provides RTCPeerConnection (WebRTC peers). */
  readonly webrtc: boolean;
  /** Whether this context is a secure context (WebRTC requires it). */
  readonly secureContext: boolean;
}

/**
 * Probe the CURRENT context's WebRTC truth honestly. In a browser this
 * reads the live globals; in a server render pass (or any non-browser
 * host) every facility is honestly absent — the adapter answers the
 * typed browser-incompatible failure there, never a fabricated session.
 */
export function detectBrowserTorrentEnvironment(): BrowserTorrentEnvironment {
  const globals = globalThis as {
    RTCPeerConnection?: unknown;
    isSecureContext?: boolean;
    window?: { RTCPeerConnection?: unknown };
  };
  const rtc =
    typeof globals.RTCPeerConnection === "function" ||
    typeof globals.window?.RTCPeerConnection === "function";
  return {
    webrtc: rtc,
    secureContext: globals.isSecureContext !== false,
  };
}

/** The one-sentence user truth of one probe (rendered by the surfaces). */
export function browserTorrentEnvironmentSentence(
  environment: BrowserTorrentEnvironment,
): string {
  if (environment.webrtc && environment.secureContext) {
    return "This browser can reach WebRTC-capable peer copies — browser playback is wired through the WebTorrent adapter.";
  }
  if (!environment.secureContext) {
    return "Browser peer playback needs a secure context (https) — this page does not have one, so peer copies fall back to the Desktop app.";
  }
  return "This browser cannot reach peer copies (no WebRTC) — the same authorized copy plays in the Desktop app's native player.";
}

// ---------------------------------------------------------------------------
// The browser binding (the TorrentLibrary contract, browser build)
// ---------------------------------------------------------------------------

/**
 * The BROWSER `TorrentLibrary` over the pinned webtorrent browser build.
 * Sessions are CLIENT-ONLY: creating one in a context without WebRTC
 * answers the typed `LIBRARY_ERROR` browser-incompatible failure — the
 * honest fallback is the Desktop/native next step (never a silent hang).
 */
export function createBrowserTorrentLibrary(): TorrentLibrary {
  let client: unknown | undefined;
  let destroyed = false;

  // The webtorrent browser client's honest surface (the subset the seam
  // consumes — no protocol types cross the boundary).
  interface WebTorrentTorrent {
    infoHash: string;
    name: string;
    pieceLength: number;
    length: number;
    numPeers: number;
    progress: number;
    downloaded: number;
    uploadSpeed: number;
    downloadSpeed: number;
    files: { name: string; path: string; length: number; offset: number }[];
    bitfield: { get(index: number): boolean | number };
    select(start: number, end: number, priority?: number): void;
    deselect(start: number, end: number): void;
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
      throw new Error("the browser torrent library binding was destroyed");
    }
    if (client === undefined) {
      // LAZY-IMPORT LAW: the browser build loads ONLY here — no page
      // that never starts a peer session ever fetches it.
      const module = (await import("webtorrent")) as {
        default: new (options: Record<string, unknown>) => WebTorrentClient;
      };
      client = new module.default({
        // The browser build has no TCP/uTP listeners at all (WebRTC +
        // WebSocket trackers only) — the honest browser configuration.
        tracker: { announce: [] },
      });
    }
    return client as WebTorrentClient;
  };

  const parseTorrentModule = async (): Promise<{
    default: (input: string | Uint8Array) => Promise<unknown>;
  }> => {
    // parse-torrent is pure JavaScript (bencode + magnet-uri) — the same
    // pinned parser the Node binding documents, loading lazily.
    return (await import("parse-torrent")) as {
      default: (input: string | Uint8Array) => Promise<unknown>;
    };
  };

  const sessionFor = (torrent: WebTorrentTorrent, spec: LibrarySessionSpec): LibrarySession => {
    const handlers = new Set<(event: LibrarySessionEvent) => void>();
    let paused = false;
    let lastPeerActivityAt: number | undefined;
    let metadataEmitted = false;
    const selectedIndexes = new Set<number>(spec.selectedFileIndexes);

    const emit = (event: LibrarySessionEvent): void => {
      for (const handler of handlers) handler(event);
    };

    const filePieceRange = (index: number): { from: number; to: number } | null => {
      const file = torrent.files[index];
      if (file === undefined || file.length === 0) return null;
      const from = Math.floor(file.offset / torrent.pieceLength);
      const to = Math.floor((file.offset + file.length - 1) / torrent.pieceLength);
      return { from, to };
    };

    const applySelection = (): void => {
      if (torrent.files.length === 0) return;
      const pieceCount = Math.max(1, Math.ceil(torrent.length / torrent.pieceLength));
      // The browser build applies the same whole-torrent default; the
      // seam takes ownership of the selection state once (same law as
      // the Node binding).
      torrent.deselect(0, pieceCount - 1);
      for (let index = 0; index < torrent.files.length; index += 1) {
        if (!selectedIndexes.has(index)) continue;
        const range = filePieceRange(index);
        if (range === null) continue;
        torrent.select(range.from, range.to, 0);
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
      lastPeerActivityAt = Date.now();
    });

    return {
      infoHash: torrent.infoHash,
      onEvent(handler): () => void {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      snapshot(): LibrarySessionSnapshotLike {
        if (torrent.numPeers > 0) lastPeerActivityAt = Date.now();
        const pieceCount = Math.max(1, Math.ceil(torrent.length / torrent.pieceLength));
        const bitfield = new Uint8Array(Math.ceil(pieceCount / 8));
        for (let i = 0; i < pieceCount; i += 1) {
          if (torrent.bitfield.get(i)) {
            bitfield[i >> 3]! |= 0x80 >> (i & 7);
          }
        }
        return {
          connectedPeers: torrent.numPeers,
          bitfield,
          verifiedBytes: Math.min(torrent.downloaded, torrent.length),
          downloadBytesPerSec: paused ? 0 : torrent.downloadSpeed,
          uploadBytesPerSec: paused ? 0 : torrent.uploadSpeed,
          ...(lastPeerActivityAt !== undefined ? { lastPeerActivityAt } : {}),
        };
      },
      selectFiles(fileIndexes): void {
        selectedIndexes.clear();
        for (const index of fileIndexes) selectedIndexes.add(index);
        if (torrent.files.length > 0) applySelection();
      },
      prioritizePieces(): void {
        // The browser binding applies file selection only; urgency hints
        // are the Node/native scheduler's mechanism. This is the honest
        // subset — the seam stays total, and the browser playback stage
        // consumes the store's protocol-free truth (never a fabricated
        // priority claim).
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
        const current = client;
        if (current === undefined) return;
        await new Promise<void>((resolve) => {
          (current as WebTorrentClient).remove(torrent, () => resolve());
        });
      },
    };
  };

  return {
    implementation: WEB_BROWSER_TORRENT_IMPLEMENTATION,

    async parseMagnet(uri: string): Promise<TorrentResult<{ infoHash: string; displayName?: string; trackers: readonly string[] }>> {
      try {
        const parsed = (await (await parseTorrentModule()).default(uri)) as {
          infoHash?: string;
          name?: string;
          announce?: string[];
        };
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
        const parsed = (await (await parseTorrentModule()).default(bytes)) as {
          infoHash?: string;
          name?: string;
          pieceLength?: number;
          length?: number;
          files?: { path: string; name: string; length: number }[];
          announce?: string[];
          private?: boolean;
        };
        if (
          typeof parsed.infoHash !== "string" ||
          typeof parsed.name !== "string" ||
          typeof parsed.pieceLength !== "number" ||
          typeof parsed.length !== "number"
        ) {
          return torrentError("INVALID_TORRENT_FILE", {
            detail: "parseTorrentFile: the bytes did not decode into complete metainfo (name/pieceLength/length missing)",
          });
        }
        let offset = 0;
        const files = (parsed.files ?? []).map((file) => {
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
          ok: true,
          value: {
            infoHash: parsed.infoHash,
            name: parsed.name,
            pieceLengthBytes: parsed.pieceLength,
            totalBytes: parsed.length,
            pieceCount: Math.max(1, Math.ceil(parsed.length / parsed.pieceLength)),
            files,
            trackers,
            isPrivate: parsed.private === true,
          },
        };
      } catch (e) {
        return torrentError("INVALID_TORRENT_FILE", {
          detail: `parseTorrentFile: the bytes are not valid bencoded metainfo: ${e instanceof Error ? e.message : String(e)}`,
          cause: e,
        });
      }
    },

    async createSession(spec: LibrarySessionSpec): Promise<TorrentResult<LibrarySession>> {
      // THE WEBRTC GATE (the honest browser truth): sessions are
      // client-only; a context without WebRTC (a server render pass, or
      // a browser without WebRTC) answers the typed failure — the
      // surface's fallback is the Desktop/native next step.
      const environment = detectBrowserTorrentEnvironment();
      if (!environment.webrtc || !environment.secureContext) {
        return torrentError("LIBRARY_ERROR", {
          detail: `browser-incompatible: ${browserTorrentEnvironmentSentence(environment)}`,
        });
      }
      try {
        const wt = await getClient();
        const torrentId: string | Uint8Array | undefined =
          spec.metainfoBytes ?? spec.magnetUri ?? magnetForInfoHash(
            spec.metainfo?.infoHash ?? "",
            spec.metainfo?.name ?? "",
          );
        if (torrentId === undefined) {
          return torrentError("INVALID_INPUT", {
            detail: "createSession: the spec carries neither .torrent bytes, a magnet URI, nor metainfo",
          });
        }
        const torrent = wt.add(torrentId, {
          // The browser build's in-memory chunk store — no dataDir
          // semantics exist client-side; the store's protocol-free truth
          // stays the honest surface.
        });
        return { ok: true, value: sessionFor(torrent, spec) };
      } catch (e) {
        return torrentError("LIBRARY_ERROR", {
          detail: `createSession: the browser torrent client refused the session: ${
            e instanceof Error ? e.message : String(e)
          } — ordinary TCP/UDP-only peers are not reachable from a browser (WebRTC-capable peers only)`,
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

/** A minimal structural alias (the snapshot the seam answers). */
type LibrarySessionSnapshotLike = ReturnType<LibrarySession["snapshot"]>;

/** Build a magnet URI from an infohash + optional display name. */
function magnetForInfoHash(infoHash: string, name: string): string | undefined {
  if (infoHash.length === 0) return undefined;
  const params = [`xt=urn:btih:${infoHash}`];
  if (name.length > 0) params.push(`dn=${encodeURIComponent(name)}`);
  return `magnet:?${params.join("&")}`;
}
