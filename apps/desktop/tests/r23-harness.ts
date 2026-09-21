/**
 * R23-W3 — the Desktop torrent/open-viewing/local-AI test harness (the
 * J36 composition doctrine).
 * ⚠️ TESTS ONLY ⚠️
 *
 * Boots the REAL Desktop composition surfaces over deterministic doubles —
 * the `ScriptedEngine`/`SimShell` precedent EXTENDED with the authorized
 * ingest → file-selection → session flow the R23-C binding drives (the
 * R11-R13 public shapes; the real engine's own gate is proven by the
 * torrent-engine package's tests — this double proves the BINDING).
 *
 * The composition mirrors `createDesktopApp`'s wiring exactly (the
 * acquisition source exposed, the native media port published-to) so the
 * J37/J38/J39 journeys drive the same surfaces the production app boots.
 */

import {
  FixedClock,
  InMemoryNativeMediaPort,
  InMemoryServerPort,
  SequentialIdGen,
  createRuntime,
  makeDesktopCapabilities,
} from "@wfx/client-runtime";
import type { ClientRuntime } from "@wfx/client-runtime";
import type { PlatformCapabilities } from "@wfx/platform-contracts";
import type { MediaIntelligenceArtifacts } from "@wfx/model-fabric";
import {
  authorizeProvenance,
  createAuthorizedSourceRegistry,
  torrentError,
  type AuthorizedProvenance,
  type TorrentIngestion,
  type TorrentResult,
  type TorrentSessionHandle,
} from "@wfx/torrent-engine";

import { ScriptedEngine, engineStatus, engineTruth } from "./discoverability-harness";
import { createDesktopAcquisitionSource } from "../src/platform/acquisition-source";
import type { DesktopAcquisitionSource } from "../src/platform/acquisition-source";
import { createDesktopAcquisitionSurface } from "../src/surface/acquisition-surface";
import type { DesktopAcquisitionSurface } from "../src/surface/acquisition-surface";
import { createUnboundFeedSurface } from "../src/surface/feed-surface";
import { createOfflineDiscoverySurface } from "../src/surface/offline-discovery-surface";
import { createDesktopTorrentPlaybackBinding } from "../src/platform/torrent-playback";
import type {
  DesktopTorrentPlaybackBinding,
  DesktopTorrentRealization,
} from "../src/platform/torrent-playback";
import { createDesktopWhereToWatchSurface } from "../src/surface/where-to-watch-surface";
import type { DesktopWhereToWatchSurface } from "../src/surface/where-to-watch-surface";
import { createDesktopOpenViewingSurface } from "../src/surface/open-viewing-surface";
import type { DesktopOpenViewingSurface } from "../src/surface/open-viewing-surface";
import { createDesktopLocalAiSurface } from "../src/surface/local-ai-surface";
import type { DesktopLocalAiSurface } from "../src/surface/local-ai-surface";
import type {
  DesktopModelRuntimeProbe,
  DesktopModelRuntimeStatus,
} from "../src/platform/model-runtime";

// ---------------------------------------------------------------------------
// The deterministic world constants
// ---------------------------------------------------------------------------

export const R23_T0 = Date.parse("2026-09-21T10:00:00.000Z");
export const R23_ITEM = "wfxitm_0000000000000000000000R23W";
export const R23_ITEM_2 = "wfxitm_0000000000000000000000R23X";
export const R23_PROFILE = "wfxusr_r23_test:main";
export const R23_ANON_PROFILE = "session:wfx-desktop-r23-session";
export const R23_INFO_HASH = "0123456789abcdef0123456789abcdef01234567";
export const R23_MAGNET = `magnet:?xt=urn:btih:${R23_INFO_HASH}&dn=Family+Archive`;
export const R23_PROVENANCE = { sourceId: "vault:family-media", basis: "user-owned" as const };
export const R23_TITLE = "Family Archive Feature Presentation";
export const NOW = (): string => new Date(R23_T0).toISOString();

/** The multi-file torrent the file-choice step reveals (2 playable + 1 not). */
export const R23_TORRENT_FILES = [
  { path: "feature-presentation.mkv", name: "feature-presentation.mkv", lengthBytes: 88_912, offsetBytes: 0 },
  { path: "bonus-interview.mp4", name: "bonus-interview.mp4", lengthBytes: 44_000, offsetBytes: 88_912 },
  { path: "coverart.jpg", name: "coverart.jpg", lengthBytes: 4_000, offsetBytes: 132_912 },
];

// ---------------------------------------------------------------------------
// The torrent-flow engine double (ScriptedEngine + the ingest/session flow)
// ---------------------------------------------------------------------------

/**
 * The scripted engine EXTENDED with the authorized ingest → file-selection
 * → session flow the R23-C binding drives: `ingestMagnet`/`ingestTorrentFile`
 * answer honest ingestions (the magnet shape law + the provenance carried),
 * `createSession` answers session handles whose statuses the test scripts
 * through the inherited `script()` — the R11-R13 public shapes only.
 */
export class TorrentFlowEngine extends ScriptedEngine {
  private readonly flowIngestions: TorrentIngestion[] = [];
  private sessionCounter = 0;
  /** The files a torrent-file ingestion carries (the metadata truth). */
  torrentFiles: readonly TorrentIngestion["files"][number][] = R23_TORRENT_FILES;
  /** Whether ingest refuses everything (the PROVENANCE_REJECTED simulation). */
  refuseIngest = false;

  override async ingestMagnet(
    uri?: string,
    provenance?: AuthorizedProvenance,
  ): Promise<TorrentResult<TorrentIngestion>> {
    if (this.refuseIngest) {
      return torrentError("PROVENANCE_REJECTED", {
        detail: `ingestMagnet: source '${provenance?.sourceId ?? "unknown"}' is not in the authorized-source registry — ingestion is refused (invariant 5: authorized media only; register the source first)`,
      });
    }
    if (typeof uri !== "string" || !uri.startsWith("magnet:")) {
      return torrentError("INVALID_INPUT", {
        detail: `ingestMagnet: uri must be a magnet URI ('magnet:?xt=...'), got '${String(uri).slice(0, 32)}'`,
      });
    }
    const ingestion: TorrentIngestion = {
      id: `ing-r23-${this.flowIngestions.length + 1}`,
      kind: "magnet",
      infoHash: R23_INFO_HASH,
      provenance: provenance!,
      displayName: R23_TITLE,
      files: [], // the magnet-kind law: files stay empty until a session resolves metadata
      magnetUri: uri,
    };
    this.flowIngestions.push(ingestion);
    return { ok: true, value: ingestion };
  }

  override async ingestTorrentFile(
    bytes?: Uint8Array,
    provenance?: AuthorizedProvenance,
  ): Promise<TorrentResult<TorrentIngestion>> {
    if (this.refuseIngest) {
      return torrentError("PROVENANCE_REJECTED", {
        detail: `ingestTorrentFile: source '${provenance?.sourceId ?? "unknown"}' is not in the authorized-source registry — ingestion is refused (invariant 5: authorized media only; register the source first)`,
      });
    }
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      return torrentError("INVALID_INPUT", { detail: "ingestTorrentFile: bytes must be non-empty" });
    }
    const ingestion: TorrentIngestion = {
      id: `ing-r23-${this.flowIngestions.length + 1}`,
      kind: "torrent-file",
      infoHash: R23_INFO_HASH,
      provenance: provenance!,
      displayName: R23_TITLE,
      files: [...this.torrentFiles],
    };
    this.flowIngestions.push(ingestion);
    return { ok: true, value: ingestion };
  }

  override ingestions(): readonly TorrentIngestion[] {
    return [...this.flowIngestions];
  }

  override async createSession(
    ingestionId?: string,
    options?: { selection?: { fileIndexes?: readonly number[]; filePaths?: readonly string[] } },
  ): Promise<TorrentResult<TorrentSessionHandle>> {
    if (typeof ingestionId !== "string") {
      return torrentError("INVALID_INPUT", { detail: "createSession: ingestionId is required" });
    }
    const ingestion = this.flowIngestions.find((candidate) => candidate.id === ingestionId);
    if (ingestion === undefined) {
      return torrentError("NOT_FOUND", { sessionId: ingestionId, detail: `no ingestion '${ingestionId}'` });
    }
    this.sessionCounter += 1;
    const sessionId = `s-r23-${this.sessionCounter}`;
    const selectedFiles = (options?.selection?.fileIndexes ?? [])
      .map((index) => this.torrentFiles[index])
      .filter((file): file is NonNullable<typeof file> => file !== undefined);
    const selectedBytes = selectedFiles.reduce((sum, file) => sum + file.lengthBytes, 0);
    const selectedCount = selectedFiles.length > 0 ? selectedFiles.length : this.torrentFiles.length;
    // The initial honest status: metadata resolving (the magnet law) or the
    // selected transfer starting (torrent-file kind with a selection).
    this.script(
      sessionId,
      engineStatus({
        sessionId,
        state: "discovering-metadata",
        files: this.torrentFiles.map((file, index) => ({
          path: file.path,
          sizeBytes: file.lengthBytes,
          selected:
            options?.selection?.fileIndexes !== undefined
              ? options.selection.fileIndexes.includes(index)
              : true,
        })) as unknown as Parameters<typeof this.script>[1]["files"],
        progress: {
          selectedPieces: selectedCount * 3,
          verifiedSelectedPieces: 0,
          selectedBytes,
          verifiedSelectedBytes: 0,
          fraction: 0,
        },
        provenance: R23_PROVENANCE,
      }),
      "idle",
      engineTruth(),
    );
    const handle: TorrentSessionHandle = {
      sessionId,
      infoHash: R23_INFO_HASH,
      status: () => {
        const status = this.status(sessionId);
        return status.ok ? status.value : engineStatus({ sessionId, state: "failed" });
      },
    };
    return { ok: true, value: handle };
  }

  /** The last session the flow created (assertion surface). */
  get lastSessionId(): string {
    return `s-r23-${this.sessionCounter}`;
  }
}

// ---------------------------------------------------------------------------
// The authorized-source registry (the composition's provenance mint)
// ---------------------------------------------------------------------------

/** The authorized-source registry with the vault registered (the mint's truth). */
export function r23Registry(): ReturnType<typeof createAuthorizedSourceRegistry> {
  return createAuthorizedSourceRegistry({
    sources: [{ sourceId: R23_PROVENANCE.sourceId, basis: R23_PROVENANCE.basis }],
  });
}

// ---------------------------------------------------------------------------
// The boot (the composition mirroring createDesktopApp's R23 wiring)
// ---------------------------------------------------------------------------

export interface R23BootOptions {
  /** The authorized-realization truth (default: the item's peer copy). */
  readonly realizationOf?: (itemId: string) => DesktopTorrentRealization | null;
  /** The acquiring profile key (default: the authenticated profile). */
  readonly profileKey?: string;
  /** The viewer session (default: anonymous — the open-viewing default). */
  readonly viewer?: "anonymous" | "authenticated";
  /** The local model runtime probe (default: honestly unavailable). */
  readonly runtimeProbe?: DesktopModelRuntimeProbe;
  /** The media-intelligence truth (default: nothing derived). */
  readonly mediaIntelligenceOf?: (itemId: string) => MediaIntelligenceArtifacts | null;
}

/** The booted R23 composition (every surface the journeys drive). */
export interface R23Boot {
  readonly engine: TorrentFlowEngine;
  readonly runtime: ClientRuntime;
  readonly capabilities: PlatformCapabilities & {
    readonly ports: PlatformCapabilities["ports"] & { readonly nativeMedia: InMemoryNativeMediaPort };
  };
  readonly nativeMedia: InMemoryNativeMediaPort;
  readonly source: DesktopAcquisitionSource;
  readonly acquisition: DesktopAcquisitionSurface;
  readonly torrentPlayback: DesktopTorrentPlaybackBinding;
  readonly whereToWatch: DesktopWhereToWatchSurface;
  readonly openViewing: DesktopOpenViewingSurface;
  readonly localAi: DesktopLocalAiSurface;
  readonly offlineDiscovery: ReturnType<typeof createOfflineDiscoverySurface>;
}

/**
 * Boot the R23 composition: the shared runtime over the truthful Desktop
 * bundle (the InMemoryNativeMediaPort drives the native playback states
 * through its `publish` pump), the torrent-flow engine (the acquisition),
 * and every R23-W3 surface bound exactly as `createDesktopApp` binds them.
 */
export function bootR23(options: R23BootOptions = {}): R23Boot {
  const engine = new TorrentFlowEngine();
  const capabilities = makeDesktopCapabilities();
  const runtime: ClientRuntime = createRuntime(capabilities, new InMemoryServerPort(), {
    context: { userId: "wfx-desktop-r23-user", sessionId: "wfx-desktop-r23-session", locale: "en" },
    clock: new FixedClock(R23_T0),
    ids: new SequentialIdGen(),
  });
  const source = createDesktopAcquisitionSource({ engine, adapter: engine.adapter, runtime });
  const acquisition = createDesktopAcquisitionSurface(runtime, source);
  const registry = r23Registry();
  const defaultRealization: DesktopTorrentRealization = {
    itemId: R23_ITEM,
    title: R23_TITLE,
    magnet: R23_MAGNET,
    provenance: R23_PROVENANCE,
    browserCapable: false,
  };
  const realizationOf =
    options.realizationOf ??
    ((itemId: string): DesktopTorrentRealization | null =>
      itemId === R23_ITEM ? defaultRealization : null);
  const torrentPlayback = createDesktopTorrentPlaybackBinding({
    runtime,
    capabilities,
    engine,
    adapter: engine.adapter,
    source,
    realizationOf,
    mintProvenance: (sourceId) => authorizeProvenance(registry, sourceId),
    profileKeyOf: () => options.profileKey ?? R23_PROFILE,
  });
  const whereToWatch = createDesktopWhereToWatchSurface({
    capabilities,
    acquisition,
    torrentPlayback,
  });
  const openViewing = createDesktopOpenViewingSurface({
    runtime,
    viewerSessionOf: () => ({ viewer: options.viewer ?? "anonymous" }),
    sessionIdOf: () => "wfx-desktop-r23-session",
    nowOf: NOW,
  });
  const localAi = createDesktopLocalAiSurface({
    runtime,
    runtimeProbe:
      options.runtimeProbe ??
      (async (): Promise<DesktopModelRuntimeStatus> => ({
        kind: "unavailable",
        reason: "the local model runtime is not packaged in this build",
        recoveryHint:
          "Install the WebFlix build that packages the local model runtime (Settings, under Model & AI, shows this same truth), or run these models through a self-hosted endpoint instead",
      })),
    mediaIntelligenceOf: options.mediaIntelligenceOf ?? (() => null),
  });
  const offlineDiscovery = createOfflineDiscoverySurface({
    runtime,
    capabilities,
    acquisition,
    feed: createUnboundFeedSurface(),
  });
  return {
    engine,
    runtime,
    capabilities,
    nativeMedia: capabilities.ports.nativeMedia,
    source,
    acquisition,
    torrentPlayback,
    whereToWatch,
    openViewing,
    localAi,
    offlineDiscovery,
  };
}

/**
 * The port's last-opened native session id (the test double's deterministic
 * id law: `test-native-<open count>` — the id `prepare` received back).
 */
export function lastNativeSessionId(port: InMemoryNativeMediaPort): string {
  if (port.opens.length === 0) {
    throw new Error("r23-harness: no native session was opened yet");
  }
  return `test-native-${port.opens.length}`;
}

/** One honest native playback event pump (the port's truthful session shape). */
export function nativeEvent(
  port: InMemoryNativeMediaPort,
  sessionId: string,
  state: "resolving" | "buffering" | "playing" | "background" | "complete" | "failed",
  positionMs: number,
  bufferedMs: number,
): void {
  port.publish(
    {
      id: sessionId,
      assetId: `asset-${sessionId}`,
      fileId: `file-${sessionId}`,
      state,
      bufferedMs,
      positionMs,
      integrity: state === "complete" ? "verified" : "unknown",
    },
    state === "failed" ? "the engine reported a failure" : undefined,
  );
}
