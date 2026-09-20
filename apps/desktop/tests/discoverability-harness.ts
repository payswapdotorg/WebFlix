/**
 * R21-G/R21-H — the discoverability test harness (the shared boot shapes).
 * ⚠️ TESTS ONLY ⚠️
 *
 * Boots the REAL composition root (`createDesktopApp`) over deterministic
 * doubles — the `SimShell`/`SimEngineProcess` precedent plus a scripted
 * torrent-engine facade (the `acquisition-surface.test.ts` double's shape,
 * trimmed to the acquisition-seam surface the R14 source consumes) and the
 * R20 `createFeedPortDouble` — so the discoverability surfaces are proven
 * against the REAL wiring with the honest bound/unbound composition
 * variants this lane's laws require.
 */

import { FixedClock, SequentialIdGen } from "@wfx/client-runtime";
import type {
  ExposedTorrentExposure,
  PlaybackBufferingTruth,
  PlaybackSchedulerConfig,
  PlaybackSchedulerState,
  PlaybackSchedulerStatus,
  TorrentEngine,
  TorrentEngineAdapter,
  TorrentIngestion,
  TorrentRecoveryReport,
  TorrentResult,
  TorrentSessionHandle,
  TorrentSessionStatus,
  OfflineReadyEntry,
} from "@wfx/torrent-engine";
import { DEFAULT_PLAYBACK_SCHEDULER_CONFIG, torrentError } from "@wfx/torrent-engine";

import { SimEngineProcess, SimShell } from "./shell-simulator";
import { createDesktopApp } from "../src/main";
import { createDesktopServerPort } from "../src/platform/server-port";
import { createFeedPortDouble } from "./feed-port-double";

/** The feed-port double's handle type (the double's own return shape). */
export type FeedPortDoubleHandle = ReturnType<typeof createFeedPortDouble>;

export const HARNESS_T0 = Date.parse("2026-09-20T09:00:00.000Z");
export const HARNESS_ITEM = "wfxitm_0000000000000000000000R21G";
export const HARNESS_ITEM_2 = "wfxitm_0000000000000000000000R21H";
export const HARNESS_PROFILE = "wfxusr_r21_test:main";
const BASE = new URL("https://experience.webflix.invalid/api");
const CONTEXT = { userId: "wfx-desktop-user", sessionId: "wfx-desktop-session", locale: "en" };

/** The scriptable stub fetch (deterministic, offline; the R08 pattern). */
export class StubFetch {
  readonly requests: { method: string; url: string; body: string | undefined }[] = [];
  private scripted: { readonly match: (url: string) => boolean; readonly respond: () => Response }[] = [];

  script(match: (url: string) => boolean, respond: () => Response): void {
    this.scripted.push({ match, respond });
  }

  fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    this.requests.push({ method: init?.method ?? "GET", url, body: init?.body as string | undefined });
    for (let index = this.scripted.length - 1; index >= 0; index -= 1) {
      const entry = this.scripted[index]!;
      if (entry.match(url)) return Promise.resolve(entry.respond());
    }
    return Promise.reject(new TypeError("stub fetch: no scripted response (offline)"));
  };
}

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// The scripted torrent-engine facade (the acquisition-surface double's shape)
// ---------------------------------------------------------------------------

interface ScriptedSession {
  status: TorrentSessionStatus;
  schedulerState: PlaybackSchedulerState;
  truth: PlaybackBufferingTruth;
}

/** The deterministic engine facade + adapter double (R11-R13 public shapes). */
export class ScriptedEngine implements TorrentEngine {
  readonly libraryImplementation = "scripted-double";
  readonly dataRoot = "/tmp/scripted-r21/data";
  readonly journalPath = "/tmp/scripted-r21/journal.ndjson";
  readonly playback: TorrentEngine["playback"];

  private readonly scripted = new Map<string, ScriptedSession>();
  private offlineReady: readonly OfflineReadyEntry[] = [];

  constructor() {
    this.playback = {
      config: DEFAULT_PLAYBACK_SCHEDULER_CONFIG as PlaybackSchedulerConfig,
      command: (): TorrentResult<PlaybackSchedulerStatus> =>
        torrentError("INVALID_STATE", { detail: "the scripted double does not drive commands" }),
      noteRangeRequests: (): TorrentResult<PlaybackSchedulerStatus> =>
        torrentError("INVALID_STATE", { detail: "the scripted double does not drive ranges" }),
      truth: (sessionId: string) => {
        const session = this.scripted.get(sessionId);
        if (session === undefined) return torrentError("NOT_FOUND", { sessionId, detail: "no such session" });
        return { ok: true, value: session.truth };
      },
      readVerifiedRange: (): Promise<TorrentResult<Uint8Array>> =>
        Promise.resolve(torrentError("UNVERIFIED_RANGE", { detail: "the scripted double serves no bytes" })),
      tick: (): TorrentResult<{ replanned: number }> => ({ ok: true, value: { replanned: 0 } }),
      state: (sessionId: string): TorrentResult<PlaybackSchedulerState> => {
        const session = this.scripted.get(sessionId);
        if (session === undefined) return torrentError("NOT_FOUND", { sessionId, detail: "no such session" });
        return { ok: true, value: session.schedulerState };
      },
      windows: (): TorrentResult<never[]> => ({ ok: true, value: [] }),
    };
  }

  script(
    sessionId: string,
    status: TorrentSessionStatus,
    schedulerState: PlaybackSchedulerState,
    truth: PlaybackBufferingTruth,
  ): void {
    this.scripted.set(sessionId, { status, schedulerState, truth });
  }

  drop(sessionId: string): void {
    this.scripted.delete(sessionId);
  }

  scriptOfflineReady(entries: readonly OfflineReadyEntry[]): void {
    this.offlineReady = entries;
  }

  ingestMagnet(): Promise<TorrentResult<TorrentIngestion>> {
    return Promise.resolve(torrentError("INVALID_INPUT", { detail: "not used by the R21 seam tests" }));
  }
  ingestTorrentFile(): Promise<TorrentResult<TorrentIngestion>> {
    return Promise.resolve(torrentError("INVALID_INPUT", { detail: "not used by the R21 seam tests" }));
  }
  ingestions(): readonly TorrentIngestion[] {
    return [];
  }
  createSession(): Promise<TorrentResult<TorrentSessionHandle>> {
    return Promise.resolve(torrentError("INVALID_INPUT", { detail: "not used by the R21 seam tests" }));
  }
  sessions(): readonly string[] {
    return [...this.scripted.keys()];
  }
  status(sessionId: string): TorrentResult<TorrentSessionStatus> {
    const session = this.scripted.get(sessionId);
    if (session === undefined) {
      return torrentError("NOT_FOUND", { sessionId, detail: "no such session is live" });
    }
    return { ok: true, value: session.status };
  }
  pause(): TorrentResult<void> {
    return { ok: true, value: undefined };
  }
  resume(): TorrentResult<void> {
    return { ok: true, value: undefined };
  }
  stop(): Promise<TorrentResult<void>> {
    return Promise.resolve({ ok: true, value: undefined });
  }
  recover(): Promise<TorrentResult<TorrentRecoveryReport>> {
    return Promise.resolve({
      ok: true,
      value: { recovered: [], terminal: [], failed: [], skipped: [], rearmed: [], rearmRefused: [] },
    });
  }
  exposedAssets(): readonly ExposedTorrentExposure[] {
    return [];
  }
  recordAssetExposure(): TorrentResult<ExposedTorrentExposure> {
    return torrentError("INVALID_INPUT", { detail: "not used by the R21 seam tests" });
  }
  destroy(): Promise<void> {
    return Promise.resolve();
  }

  readonly adapter: TorrentEngineAdapter = {
    storeRoot: "/tmp/scripted-r21/store",
    landCompletedSelection: (): Promise<TorrentResult<never[]>> =>
      Promise.resolve(torrentError("INVALID_STATE", { detail: "not used by the R21 seam tests" })),
    exposeCompletedSelection: (): Promise<TorrentResult<never[]>> =>
      Promise.resolve(torrentError("INVALID_STATE", { detail: "not used by the R21 seam tests" })),
    listOfflineReady: (): TorrentResult<readonly OfflineReadyEntry[]> => ({
      ok: true,
      value: this.offlineReady,
    }),
    verifyOfflineReadyEntry: (): Promise<
      TorrentResult<{ assetId: string; integrity: "verified" | "failed"; digest: string; recordedDigest: string }>
    > => Promise.resolve(torrentError("NOT_FOUND", { detail: "not used by the R21 seam tests" })),
  };
}

/** Build one honest R11 status shape (the acquisition-surface helper's shape). */
export function engineStatus(
  overrides: Partial<TorrentSessionStatus> & { sessionId: string; state: TorrentSessionStatus["state"] },
): TorrentSessionStatus {
  const selectedPieces = overrides.progress?.selectedPieces ?? 6;
  const verifiedSelectedPieces = overrides.progress?.verifiedSelectedPieces ?? 0;
  return {
    sessionId: overrides.sessionId,
    infoHash: "0123456789abcdef0123456789abcdef01234567",
    state: overrides.state,
    stalled: overrides.stalled ?? false,
    ...(overrides.stallDurationMs !== undefined ? { stallDurationMs: overrides.stallDurationMs } : {}),
    peers: overrides.peers ?? { connected: 3 },
    pieces: overrides.pieces ?? { total: 9, verified: verifiedSelectedPieces },
    progress:
      overrides.progress ?? {
        selectedPieces,
        verifiedSelectedPieces,
        selectedBytes: selectedPieces * 16384,
        verifiedSelectedBytes: verifiedSelectedPieces * 16384,
        fraction: selectedPieces > 0 ? verifiedSelectedPieces / selectedPieces : 0,
      },
    rates: overrides.rates ?? { downloadBytesPerSec: 65536, uploadBytesPerSec: 8192 },
    files:
      overrides.files ??
      ([
        { path: "feature-presentation.mkv", sizeBytes: 88_912, selected: true },
        { path: "coverart.jpg", sizeBytes: 4000, selected: false },
      ] as unknown as TorrentSessionStatus["files"]),
    provenance: overrides.provenance ?? { sourceId: "vault:family-media", basis: "user-owned" },
    dataDir: "/tmp/scripted-r21/data/sessions/s-1/data",
    integrity: overrides.integrity ?? "unknown",
    ...(overrides.failure !== undefined ? { failure: overrides.failure } : {}),
    ...(overrides.digests !== undefined ? { digests: overrides.digests } : {}),
  };
}

/** Build one honest R12 truth shape. */
export function engineTruth(overrides?: Partial<PlaybackBufferingTruth>): PlaybackBufferingTruth {
  return {
    sessionId: "s-r21-1",
    schedulerState: overrides?.schedulerState ?? "steady",
    runway: overrides && "runway" in overrides ? overrides.runway : { bytes: 1_048_576, seconds: 120 },
    availability:
      overrides?.availability ??
      { verifiedPiecesInFile: 3, totalPiecesInFile: 6, contiguousVerifiedToByte: 49_152 },
    deadlinesAtRisk: overrides?.deadlinesAtRisk ?? [],
    stall:
      overrides?.stall ?? {
        kind: "none",
        connectedPeers: 3,
        downloadBytesPerSec: 65536,
        sessionStalled: false,
        detail: "healthy",
      },
    playableNow: overrides?.playableNow ?? true,
  };
}

/** One offline-ready entry shape (the R13 adapter read). */
export function offlineEntry(overrides: {
  key: string;
  sessionId: string;
  canonicalItemId?: string;
  integrity?: "verified" | "failed" | "unknown" | "vanished";
}): OfflineReadyEntry {
  const integrity = overrides.integrity ?? "verified";
  return {
    key: overrides.key,
    ...(overrides.canonicalItemId !== undefined
      ? { library: { profileKey: HARNESS_PROFILE, canonicalItemId: overrides.canonicalItemId } }
      : {}),
    sessionId: overrides.sessionId,
    infoHash: "0123456789abcdef0123456789abcdef01234567",
    provenance: { sourceId: "vault:family-media", basis: "user-owned" },
    assets: [
      {
        assetId: "asset-r21-1",
        sourcePath: "feature-presentation.mkv",
        contentPath: "/tmp/scripted-r21/store/asset-r21-1/content",
        sizeBytes: 88_912,
        sha256: "a".repeat(64),
        contentType: "video/x-matroska",
        integrity,
        sizeOnDisk: integrity === "vanished" ? null : 88_912,
      },
    ],
    exposedAt: HARNESS_T0,
  };
}

// ---------------------------------------------------------------------------
// The composition-root boots (bound/unbound × bound/unbound)
// ---------------------------------------------------------------------------

export interface HarnessBoot {
  readonly withAcquisition: boolean;
  readonly withFeed: boolean;
}

export interface Harness {
  readonly engine: ScriptedEngine | null;
  readonly feedDouble: FeedPortDoubleHandle | null;
  readonly shell: SimShell;
  readonly stub: StubFetch;
}

/**
 * Boot the REAL composition root with the requested block bindings. The
 * acquisition block (when bound) uses the scripted engine facade; the feed
 * block (when bound) uses the R20 FeedPort double. Returns the harness
 * handles for scripting + the booted app.
 */
export function bootDesktopApp(
  options: HarnessBoot = { withAcquisition: true, withFeed: true },
) {
  const engine = options.withAcquisition ? new ScriptedEngine() : null;
  const feedDouble = options.withFeed
    ? createFeedPortDouble({
        profileId: HARNESS_PROFILE,
        userId: CONTEXT.userId,
        now: () => new Date(HARNESS_T0).toISOString(),
        nextId: (() => {
          let counter = 0;
          return () => `r21-${(counter += 1).toString().padStart(4, "0")}`;
        })(),
      })
    : null;
  const shell = new SimShell();
  const stub = new StubFetch();
  const app = createDesktopApp({
    shell,
    server: createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch }),
    session: {
      context: CONTEXT,
      clock: new FixedClock(HARNESS_T0),
      ids: new SequentialIdGen(),
    },
    engine: {
      config: { cacheDir: "/sim/app-data/wfx-desktop/engine-cache", maxCacheBytes: 64 * 1024 * 1024 },
      process: new SimEngineProcess(),
    },
    ...(engine !== null ? { acquisition: { engine, adapter: engine.adapter } } : {}),
    ...(feedDouble !== null ? { feed: { port: feedDouble.port } } : {}),
  });
  return { app, engine, feedDouble, shell, stub } satisfies Harness & { app: ReturnType<typeof createDesktopApp> };
}
