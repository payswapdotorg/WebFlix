/**
 * R14 — the desktop acquisition surface tests (the seam, end to end).
 *
 * Proven over a SCRIPTED ENGINE-FACADE DOUBLE (the `SimEngineProcess`
 * precedent of R08's tests: the double implements the REAL
 * `TorrentEngine`/`TorrentEngineAdapter` interfaces — any drift from the
 * R11-R13 public shapes fails typecheck — with deterministic, test-driven
 * answers). The real-engine behaviors behind those shapes are R11/R12/R13's
 * own proven suites; these tests prove THE R14 SEAM: the facts derivation,
 * the runtime's mapper/store (state model + observation law), the surface
 * projection, the retry wiring, and the leak law.
 *
 * The journeys exercised (the J21-J26 flow through the seam):
 * - J21/J22 — an authorized acquisition surfaces Available → Preparing
 *   (locating → choosing files), honest null progress while unknown;
 * - J23 — playback before completion: Buffering (startup) → Playing (the
 *   healthy truth) with the truthful runway, and the honest rebuffer
 *   demotion when a deadline is at risk;
 * - J24 — playback stopped: Completing (background completion), then
 *   verifying, completed, and (only after the verified exposure — J26)
 *   Ready offline;
 * - J25 — an interrupted session surfaces as RESUMING (the recovery proof:
 *   retained fraction + piece-map reuse), never fresh; the paused
 *   modifier is honest; resume continues the SAME lifecycle;
 * - the failure laws — corruption is RECOVERABLE with the typed retry
 *   action wired to a real re-acquisition recipe; a revoked source is
 *   FATAL (dismiss only — never a fake retry); a failed re-acquisition
 *   with an intact offline copy names the copy and keeps it playable;
 * - J26 — verified exposures surface Ready offline in the runtime's views
 *   (the Library's read), one per canonical identity — session-scoped
 *   exposures never masquerade as items;
 * - the leak law — the DEFAULT views are protocol-free for EVERY state;
 *   the protocol vocabulary (peers/pieces/infohash/…) exists ONLY in the
 *   gated diagnostics projection;
 * - the app composition — `createDesktopApp` binds the acquisition block
 *   when provided and answers the honest UNBOUND capability truth when not.
 */

import { describe, expect, it } from "bun:test";

import {
  containsAcquisitionProtocolTerminology,
  createRuntime,
  FixedClock,
  InMemoryServerPort,
  makeDesktopCapabilities,
  SequentialIdGen,
  type ClientRuntime,
} from "@wfx/client-runtime";
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

import { createDesktopAcquisitionSource, type AcquisitionIdentity } from "../src/platform/acquisition-source";
import {
  createDesktopAcquisitionSurface,
  createUnboundAcquisitionSurface,
} from "../src/surface/acquisition-surface";

// ---------------------------------------------------------------------------
// The scripted engine-facade double (the SimEngineProcess precedent)
// ---------------------------------------------------------------------------

const T0 = Date.parse("2026-09-18T12:00:00.000Z");
const ITEM = "wfxitm_00000000000000000000000001";

/** A mutable, scripted status the double serves for one session. */
interface ScriptedSession {
  status: TorrentSessionStatus;
  schedulerState: PlaybackSchedulerState;
  truth: PlaybackBufferingTruth;
}

/** The deterministic double of the engine facade + adapter. */
class ScriptedEngine implements TorrentEngine {
  readonly libraryImplementation = "scripted-double";
  readonly dataRoot = "/tmp/scripted/data";
  readonly journalPath = "/tmp/scripted/journal.ndjson";
  readonly playback: TorrentEngine["playback"];

  private readonly scripted = new Map<string, ScriptedSession>();
  private exposures: readonly ExposedTorrentExposure[] = [];
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
        if (session === undefined) {
          return torrentError("NOT_FOUND", { sessionId, detail: "no such session" });
        }
        return { ok: true, value: session.truth };
      },
      readVerifiedRange: (): Promise<TorrentResult<Uint8Array>> =>
        Promise.resolve(torrentError("UNVERIFIED_RANGE", { detail: "the scripted double serves no bytes" })),
      tick: (): TorrentResult<{ replanned: number }> => ({ ok: true, value: { replanned: 0 } }),
      state: (sessionId: string): TorrentResult<PlaybackSchedulerState> => {
        const session = this.scripted.get(sessionId);
        if (session === undefined) {
          return torrentError("NOT_FOUND", { sessionId, detail: "no such session" });
        }
        return { ok: true, value: session.schedulerState };
      },
      windows: (): TorrentResult<never[]> => ({ ok: true, value: [] }),
    };
  }

  /** Script one session's status (the honest shapes of the R11 surface). */
  script(sessionId: string, status: TorrentSessionStatus, schedulerState: PlaybackSchedulerState, truth: PlaybackBufferingTruth): void {
    this.scripted.set(sessionId, { status, schedulerState, truth });
  }

  /** Drop a session (stopped — the engine no longer knows it). */
  drop(sessionId: string): void {
    this.scripted.delete(sessionId);
  }

  /** Script the adapter's offline-ready listing. */
  scriptOfflineReady(entries: readonly OfflineReadyEntry[]): void {
    this.offlineReady = entries;
  }

  // — the engine surface (scripted; only what the R14 seam consumes) —

  ingestMagnet(): Promise<TorrentResult<TorrentIngestion>> {
    return Promise.resolve(torrentError("INVALID_INPUT", { detail: "not used by the R14 seam tests" }));
  }
  ingestTorrentFile(): Promise<TorrentResult<TorrentIngestion>> {
    return Promise.resolve(torrentError("INVALID_INPUT", { detail: "not used by the R14 seam tests" }));
  }
  ingestions(): readonly TorrentIngestion[] {
    return [];
  }
  createSession(): Promise<TorrentResult<TorrentSessionHandle>> {
    return Promise.resolve(torrentError("INVALID_INPUT", { detail: "not used by the R14 seam tests" }));
  }
  sessions(): readonly string[] {
    return [...this.scripted.keys()];
  }
  status(sessionId: string): TorrentResult<TorrentSessionStatus> {
    const session = this.scripted.get(sessionId);
    if (session === undefined) {
      return torrentError("NOT_FOUND", {
        sessionId,
        detail: "no such session is live (stopped — its persisted state is recoverable on engine restart)",
      });
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
    return Promise.resolve({ ok: true, value: { recovered: [], terminal: [], failed: [], skipped: [], rearmed: [], rearmRefused: [] } });
  }
  exposedAssets(): readonly ExposedTorrentExposure[] {
    return this.exposures;
  }
  recordAssetExposure(): TorrentResult<ExposedTorrentExposure> {
    return torrentError("INVALID_INPUT", { detail: "not used by the R14 seam tests" });
  }
  destroy(): Promise<void> {
    return Promise.resolve();
  }

  /** The adapter half (the R13 narrow seam, scripted). */
  readonly adapter: TorrentEngineAdapter = {
    storeRoot: "/tmp/scripted/store",
    landCompletedSelection: (): Promise<TorrentResult<never[]>> =>
      Promise.resolve(torrentError("INVALID_STATE", { detail: "not used by the R14 seam tests" })),
    exposeCompletedSelection: (): Promise<TorrentResult<never[]>> =>
      Promise.resolve(torrentError("INVALID_STATE", { detail: "not used by the R14 seam tests" })),
    listOfflineReady: (): TorrentResult<readonly OfflineReadyEntry[]> => ({
      ok: true,
      value: this.offlineReady,
    }),
    verifyOfflineReadyEntry: (): Promise<TorrentResult<{ assetId: string; integrity: "verified" | "failed"; digest: string; recordedDigest: string }>> =>
      Promise.resolve(torrentError("NOT_FOUND", { detail: "not used by the R14 seam tests" })),
  };
}

/** Build one honest R11 status shape (the default honest fields). */
function statusOf(overrides: Partial<TorrentSessionStatus> & { sessionId: string; state: TorrentSessionStatus["state"] }): TorrentSessionStatus {
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
    files: overrides.files ?? [
      { path: "feature-presentation.mkv", sizeBytes: 88_912, selected: true },
      { path: "coverart.jpg", sizeBytes: 4000, selected: false },
    ] as unknown as TorrentSessionStatus["files"],
    provenance: overrides.provenance ?? { sourceId: "vault:family-media", basis: "user-owned" },
    dataDir: "/tmp/scripted/data/sessions/s-1/data",
    integrity: overrides.integrity ?? "unknown",
    ...(overrides.failure !== undefined ? { failure: overrides.failure } : {}),
    ...(overrides.digests !== undefined ? { digests: overrides.digests } : {}),
  };
}

/** Build one honest R12 truth shape. */
function truthOf(overrides?: Partial<PlaybackBufferingTruth>): PlaybackBufferingTruth {
  return {
    sessionId: "s-1",
    schedulerState: overrides?.schedulerState ?? "steady",
    // An explicitly-passed `runway: undefined` stays undefined (the honest
    // "not applicable" — never coerced back to a default by ??).
    runway: overrides && "runway" in overrides ? overrides.runway : { bytes: 1_048_576, seconds: 120 },
    availability: overrides?.availability ?? {
      verifiedPiecesInFile: 3,
      totalPiecesInFile: 6,
      contiguousVerifiedToByte: 49_152,
    },
    deadlinesAtRisk: overrides?.deadlinesAtRisk ?? [],
    stall: overrides?.stall ?? {
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
function offlineEntry(overrides: {
  key: string;
  sessionId: string;
  library?: { profileKey: string; canonicalItemId: string };
  integrity?: "verified" | "failed" | "unknown" | "vanished";
}): OfflineReadyEntry {
  const integrity = overrides.integrity ?? "verified";
  return {
    key: overrides.key,
    ...(overrides.library !== undefined ? { library: overrides.library } : {}),
    sessionId: overrides.sessionId,
    infoHash: "0123456789abcdef0123456789abcdef01234567",
    provenance: { sourceId: "vault:family-media", basis: "user-owned" },
    assets: [
      {
        assetId: "asset-1",
        sourcePath: "feature-presentation.mkv",
        contentPath: "/tmp/scripted/store/asset-1/content",
        sizeBytes: 88_912,
        sha256: "a".repeat(64),
        contentType: "video/x-matroska",
        integrity,
        sizeOnDisk: integrity === "vanished" ? null : 88_912,
      },
    ],
    exposedAt: T0,
  };
}

// ---------------------------------------------------------------------------
// The harness (runtime + source + surface over the double)
// ---------------------------------------------------------------------------

function bootHarness(): {
  engine: ScriptedEngine;
  runtime: ClientRuntime;
  source: ReturnType<typeof createDesktopAcquisitionSource>;
  identity: AcquisitionIdentity;
} {
  const engine = new ScriptedEngine();
  const runtime = createRuntime(makeDesktopCapabilities(), new InMemoryServerPort(), {
    context: { userId: "user-1", sessionId: "sess-1", locale: "en" },
    clock: new FixedClock(T0),
    ids: new SequentialIdGen(),
  });
  const source = createDesktopAcquisitionSource({ engine, adapter: engine.adapter, runtime });
  const identity: AcquisitionIdentity = {
    profileKey: "user:42",
    canonicalItemId: ITEM,
    title: "Authorized Archive Feature",
  };
  source.bindSession("s-1", identity);
  return { engine, runtime, source, identity };
}

// ---------------------------------------------------------------------------
// The lifecycle (J21 → J24 → J26)
// ---------------------------------------------------------------------------

describe("R14 desktop — the honest lifecycle through the seam (J21-J24, J26)", () => {
  it("J21/J22: a magnet acquisition surfaces Preparing (locating → choosing files), honest null progress", () => {
    const { engine, runtime, source } = bootHarness();
    const noSelection = {
      selectedPieces: 0,
      verifiedSelectedPieces: 0,
      selectedBytes: 0,
      verifiedSelectedBytes: 0,
      fraction: 0,
    } as const;
    engine.script("s-1", statusOf({ sessionId: "s-1", state: "discovering-metadata", files: [], progress: noSelection }), "idle", truthOf());
    source.refresh();
    const locating = runtime.acquisition.view(ITEM);
    expect(locating?.state).toBe("preparing");
    expect(locating?.label).toBe("Preparing");
    expect(locating?.progress).toBe(null); // honestly unknown — NEVER fabricated
    expect(locating?.actions.map((a) => a.kind)).toEqual(["pause"]);

    engine.script("s-1", statusOf({ sessionId: "s-1", state: "selecting", files: [] }), "idle", truthOf());
    source.refresh();
    expect(runtime.acquisition.view(ITEM)?.state).toBe("preparing");
    expect(runtime.acquisition.view(ITEM)?.detail).toContain("selected");
  });

  it("J21: a plain make-available-offline download surfaces Completing with truthful progress", () => {
    const { engine, runtime, source } = bootHarness();
    engine.script(
      "s-1",
      statusOf({ sessionId: "s-1", state: "downloading", progress: { selectedPieces: 6, verifiedSelectedPieces: 2, selectedBytes: 98_304, verifiedSelectedBytes: 32_768, fraction: 2 / 6 } }),
      "idle",
      truthOf(),
    );
    source.refresh();
    const view = runtime.acquisition.view(ITEM);
    expect(view?.state).toBe("completing");
    expect(view?.progress).toBeCloseTo(2 / 6, 10);
    expect(view?.detail).toContain("Finishing the offline copy");
  });

  it("J23: playback before completion — Buffering (startup), then Playing (healthy truth with runway)", () => {
    const { engine, runtime, source } = bootHarness();
    engine.script(
      "s-1",
      statusOf({ sessionId: "s-1", state: "downloading", progress: { selectedPieces: 6, verifiedSelectedPieces: 2, selectedBytes: 98_304, verifiedSelectedBytes: 32_768, fraction: 2 / 6 } }),
      "startup",
      truthOf({ schedulerState: "startup", runway: undefined, playableNow: false }),
    );
    source.refresh();
    const buffering = runtime.acquisition.view(ITEM);
    expect(buffering?.state).toBe("buffering");
    expect(buffering?.label).toBe("Buffering");
    expect(buffering?.runwaySeconds).toBe(null);

    engine.script(
      "s-1",
      statusOf({ sessionId: "s-1", state: "downloading", progress: { selectedPieces: 6, verifiedSelectedPieces: 3, selectedBytes: 98_304, verifiedSelectedBytes: 49_152, fraction: 0.5 } }),
      "steady",
      truthOf({ schedulerState: "steady", runway: { bytes: 1_048_576, seconds: 120 } }),
    );
    source.refresh();
    const playing = runtime.acquisition.view(ITEM);
    expect(playing?.state).toBe("playing");
    expect(playing?.runwaySeconds).toBe(120);
    expect(playing?.detail).toContain("Playing");

    // The truthful rebuffer demotion: a deadline at risk demotes honestly.
    engine.script(
      "s-1",
      statusOf({ sessionId: "s-1", state: "downloading", progress: { selectedPieces: 6, verifiedSelectedPieces: 3, selectedBytes: 98_304, verifiedSelectedBytes: 49_152, fraction: 0.5 } }),
      "steady",
      truthOf({
        schedulerState: "steady",
        runway: { bytes: 65_536, seconds: 2 },
        deadlinesAtRisk: [
          {
            kind: "runway",
            fromByte: 49_152,
            toByte: 114_688,
            remainingBytes: 49_152,
            consumptionBytesPerSec: 32_768,
            downloadBytesPerSec: 8_192,
            reason: "the runway will starve at the current rate",
          },
        ],
      }),
    );
    source.refresh();
    expect(runtime.acquisition.view(ITEM)?.state).toBe("buffering"); // never fake playing
  });

  it("J24: playback stopped → Completing (background), verifying, completed — Ready offline ONLY after the verified exposure (J26)", () => {
    const { engine, runtime, source } = bootHarness();
    engine.script(
      "s-1",
      statusOf({ sessionId: "s-1", state: "downloading", progress: { selectedPieces: 6, verifiedSelectedPieces: 5, selectedBytes: 98_304, verifiedSelectedBytes: 81_920, fraction: 5 / 6 } }),
      "background-completion",
      truthOf({ schedulerState: "background-completion", runway: undefined }),
    );
    source.refresh();
    expect(runtime.acquisition.view(ITEM)?.state).toBe("completing");

    engine.script("s-1", statusOf({ sessionId: "s-1", state: "verifying", progress: { selectedPieces: 6, verifiedSelectedPieces: 6, selectedBytes: 98_304, verifiedSelectedBytes: 98_304, fraction: 1 } }), "idle", truthOf());
    source.refresh();
    const verifying = runtime.acquisition.view(ITEM);
    expect(verifying?.state).toBe("completing");
    expect(verifying?.detail).toContain("Checking the finished files");

    // Completed WITHOUT the exposure: still completing — the earned
    // arrival is the exposure verdict, never the bare completion.
    engine.script("s-1", statusOf({ sessionId: "s-1", state: "completed", integrity: "verified", progress: { selectedPieces: 6, verifiedSelectedPieces: 6, selectedBytes: 98_304, verifiedSelectedBytes: 98_304, fraction: 1 }, digests: [{ path: "feature-presentation.mkv", sizeBytes: 88_912, sha256: "a".repeat(64) }] }), "idle", truthOf());
    source.refresh();
    expect(runtime.acquisition.view(ITEM)?.state).toBe("completing");

    // THE EARNED ARRIVAL (J26): the verified exposure lands.
    engine.scriptOfflineReady([
      offlineEntry({ key: `canonical:user:42::${ITEM}`, sessionId: "s-1", library: { profileKey: "user:42", canonicalItemId: ITEM } }),
    ]);
    source.refresh();
    const ready = runtime.acquisition.view(ITEM);
    expect(ready?.state).toBe("ready-offline");
    expect(ready?.label).toBe("Ready offline");
    expect(ready?.offline).toEqual({ assetCount: 1, sizeBytes: 88_912, exposedAtMs: T0 });
    expect(ready?.actions.map((a) => a.kind)).toEqual(["play-offline", "reverify-offline"]);
  });

  it("J26: session-scoped exposures never masquerade as items; one view per canonical identity", () => {
    const { engine, runtime, source } = bootHarness();
    engine.scriptOfflineReady([
      offlineEntry({ key: "session:s-9", sessionId: "s-9" }), // no library identity
      offlineEntry({ key: `canonical:user:42::${ITEM}`, sessionId: "s-1", library: { profileKey: "user:42", canonicalItemId: ITEM } }),
      offlineEntry({ key: `canonical:user:42::wfxitm_00000000000000000000000002`, sessionId: "s-2", library: { profileKey: "user:42", canonicalItemId: "wfxitm_00000000000000000000000002" } }),
    ]);
    source.refresh();
    const views = runtime.acquisition.views();
    expect(views.length).toBe(2); // the item-bound session + ONE exposure-only item
    expect(runtime.acquisition.view(ITEM)?.state).toBe("ready-offline"); // exposure verified (precedence 2)
    expect(runtime.acquisition.view("wfxitm_00000000000000000000000002")?.state).toBe("ready-offline");
    // The session-scoped exposure produced NO item view (diagnostics only).
    expect(views.every((view) => view.itemId.startsWith("wfxitm_"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// J25 — interruption / resume (resuming, never fresh)
// ---------------------------------------------------------------------------

describe("R14 desktop — J25 interruption surfaces RESUMING with real retained progress", () => {
  it("a recovered session reports the retained progress + the paused modifier, then resumes the SAME lifecycle", () => {
    const { engine, runtime, source } = bootHarness();
    // Before the interruption: transferring, 4 of 6 pieces verified.
    engine.script(
      "s-1",
      statusOf({ sessionId: "s-1", state: "downloading", progress: { selectedPieces: 6, verifiedSelectedPieces: 4, selectedBytes: 98_304, verifiedSelectedBytes: 65_536, fraction: 4 / 6 } }),
      "idle",
      truthOf(),
    );
    source.refresh();
    expect(runtime.acquisition.view(ITEM)?.state).toBe("completing");

    // THE RESTART (J25): the recovery report carries the piece-map proof;
    // the restored session answers paused at its journaled control point.
    engine.script(
      "s-1",
      statusOf({ sessionId: "s-1", state: "seeding-paused", progress: { selectedPieces: 6, verifiedSelectedPieces: 4, selectedBytes: 98_304, verifiedSelectedBytes: 65_536, fraction: 4 / 6 } }),
      "idle",
      truthOf({ schedulerState: "idle", runway: undefined }),
    );
    const recovery: TorrentRecoveryReport = {
      recovered: [
        {
          sessionId: "s-1",
          state: "seeding-paused",
          resumeTarget: "downloading",
          verifiedPieces: 4,
          diskVerifiedPieces: 4,
          pieceMapReused: true,
        },
      ],
      terminal: [],
      failed: [],
      skipped: [],
      rearmed: [],
      rearmRefused: [],
    };
    source.refresh(recovery);
    const resumed = runtime.acquisition.view(ITEM);
    expect(resumed?.state).toBe("completing"); // where it was — never fresh
    expect(resumed?.paused).toBe(true); // restored paused — the honest modifier
    expect(resumed?.resumed).toBe(true); // THE RESUME PROOF surfaced
    expect(resumed?.retainedFraction).toBeCloseTo(4 / 6, 10);
    expect(resumed?.detail).toContain("Resuming where it left off");
    expect(resumed?.detail).toContain("67% already saved");
    expect(resumed?.actions.map((a) => a.kind)).toEqual(["resume"]);

    // The user resumes: the SAME lifecycle continues with the retained
    // proof still named (never a fresh start).
    engine.script(
      "s-1",
      statusOf({ sessionId: "s-1", state: "downloading", progress: { selectedPieces: 6, verifiedSelectedPieces: 5, selectedBytes: 98_304, verifiedSelectedBytes: 81_920, fraction: 5 / 6 } }),
      "idle",
      truthOf(),
    );
    source.refresh();
    const continuing = runtime.acquisition.view(ITEM);
    expect(continuing?.state).toBe("completing");
    expect(continuing?.paused).toBe(false);
    expect(continuing?.resumed).toBe(true); // the retained progress stays named
  });

  it("a recovered playback intent re-arms mid-lifecycle (the first observation can be Playing — the async-facts law)", () => {
    const { engine, runtime, source } = bootHarness();
    // At boot the item had NO view; the recovered session re-armed steady.
    engine.script(
      "s-1",
      statusOf({ sessionId: "s-1", state: "seeding-paused", progress: { selectedPieces: 6, verifiedSelectedPieces: 4, selectedBytes: 98_304, verifiedSelectedBytes: 65_536, fraction: 4 / 6 } }),
      "steady",
      truthOf({ schedulerState: "steady", runway: { bytes: 524_288, seconds: 60 } }),
    );
    const recovery: TorrentRecoveryReport = {
      recovered: [
        { sessionId: "s-1", state: "seeding-paused", resumeTarget: "downloading", verifiedPieces: 4, diskVerifiedPieces: 4, pieceMapReused: true },
      ],
      terminal: [],
      failed: [],
      skipped: [],
      rearmed: [{ sessionId: "s-1", schedulerState: "steady", positionBytes: 0 }],
      rearmRefused: [],
    };
    source.refresh(recovery);
    const view = runtime.acquisition.view(ITEM);
    expect(view?.state).toBe("playing"); // the re-armed scheduler truth
    expect(view?.paused).toBe(true); // ...but the restored session is paused
    expect(view?.resumed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The failure laws (typed, recoverable vs fatal, the intact-copy honesty)
// ---------------------------------------------------------------------------

describe("R14 desktop — failures are typed, never silent, with wired retry", () => {
  it("corruption is RECOVERABLE with the typed retry action; the default detail is protocol-free", () => {
    const { engine, runtime, source } = bootHarness();
    engine.script(
      "s-1",
      statusOf({
        sessionId: "s-1",
        state: "failed",
        integrity: "failed",
        failure: {
          reason: "corruption-detected",
          detail: "a piece hash mismatched its metainfo hash for 'feature-presentation.mkv' (piece 3)",
        },
      }),
      "idle",
      truthOf(),
    );
    source.refresh();
    const view = runtime.acquisition.view(ITEM);
    expect(view?.state).toBe("failed");
    expect(view?.failure?.cause).toBe("download-corrupted");
    expect(view?.failure?.recoverable).toBe(true);
    expect(view?.actions.map((a) => a.kind)).toEqual(["retry", "dismiss"]);
    // THE LEAK LAW: the engine's verbose detail (piece hashes!) never
    // reaches the default surface — the typed sentence does.
    expect(containsAcquisitionProtocolTerminology(view?.detail ?? "")).toBe(false);
    expect(view?.detail).not.toContain("piece");
  });

  it("the typed retry runs the bound recipe and surfaces the fresh attempt", async () => {
    const engine = new ScriptedEngine();
    const runtime = createRuntime(makeDesktopCapabilities(), new InMemoryServerPort(), {
      context: { userId: "user-1", sessionId: "sess-1", locale: "en" },
      clock: new FixedClock(T0),
      ids: new SequentialIdGen(),
    });
    const source = createDesktopAcquisitionSource({ engine, adapter: engine.adapter, runtime });
    const identity: AcquisitionIdentity = { profileKey: "user:42", canonicalItemId: ITEM, title: "Authorized Archive Feature" };
    // The failed attempt + its recipe (the composition root's re-acquire).
    engine.script("s-1", statusOf({ sessionId: "s-1", state: "failed", failure: { reason: "corruption-detected", detail: "a piece hash mismatched" } }), "idle", truthOf());
    let recipeCalls = 0;
    source.bindSession("s-1", identity, async () => {
      recipeCalls += 1;
      engine.script("s-2", statusOf({ sessionId: "s-2", state: "downloading", progress: { selectedPieces: 6, verifiedSelectedPieces: 0, selectedBytes: 98_304, verifiedSelectedBytes: 0, fraction: 0 } }), "idle", truthOf());
      return { ok: true, value: { sessionId: "s-2" } };
    });
    source.refresh();
    expect(runtime.acquisition.view(ITEM)?.state).toBe("failed");

    const retried = await source.attemptRetry(ITEM);
    expect(retried.ok).toBe(true);
    if (retried.ok) expect(retried.value.sessionId).toBe("s-2");
    expect(recipeCalls).toBe(1);
    // The fresh attempt surfaces honestly (failed → preparing is the
    // lawful retry edge; the fresh session is downloading with 0 progress).
    const view = runtime.acquisition.view(ITEM);
    expect(view?.state).toBe("completing"); // fresh download, no playback intent
    expect(view?.progress).toBe(0);
    expect(view?.resumed).toBe(false); // a fresh attempt — no resume claim
  });

  it("a revoked source is FATAL: dismiss only, never a fake retry", () => {
    const { engine, runtime, source } = bootHarness();
    engine.script(
      "s-1",
      statusOf({
        sessionId: "s-1",
        state: "failed",
        failure: {
          reason: "provenance-revoked",
          detail: "recovery: the session's authorized source is no longer in the registry",
        },
      }),
      "idle",
      truthOf(),
    );
    source.refresh();
    const view = runtime.acquisition.view(ITEM);
    expect(view?.failure?.cause).toBe("authorization-revoked");
    expect(view?.failure?.recoverable).toBe(false);
    expect(view?.actions.map((a) => a.kind)).toEqual(["dismiss"]);
  });

  it("a failed re-acquisition with an INTACT offline copy names the copy and keeps it playable", () => {
    const { engine, runtime, source } = bootHarness();
    engine.scriptOfflineReady([
      offlineEntry({ key: `canonical:user:42::${ITEM}`, sessionId: "s-0", library: { profileKey: "user:42", canonicalItemId: ITEM } }),
    ]);
    engine.script(
      "s-1",
      statusOf({ sessionId: "s-1", state: "failed", failure: { reason: "library-error", detail: "the download source had a problem" } }),
      "idle",
      truthOf(),
    );
    source.refresh();
    const view = runtime.acquisition.view(ITEM);
    expect(view?.state).toBe("failed"); // the loudest fact wins
    expect(view?.detail).toContain("offline copy is still verified");
    expect(view?.actions.map((a) => a.kind)).toEqual(["retry", "play-offline", "dismiss"]);
  });

  it("a degraded exposure (vanished bytes) surfaces the typed recoverable failure", () => {
    const { engine, runtime, source } = bootHarness();
    engine.drop("s-1"); // the session is gone; only the degraded exposure remains
    engine.scriptOfflineReady([
      offlineEntry({ key: `canonical:user:42::${ITEM}`, sessionId: "s-1", library: { profileKey: "user:42", canonicalItemId: ITEM }, integrity: "vanished" }),
    ]);
    source.refresh();
    const view = runtime.acquisition.view(ITEM);
    expect(view?.state).toBe("failed");
    expect(view?.failure?.cause).toBe("offline-copy-missing");
    expect(view?.failure?.recoverable).toBe(true);
  });

  it("attemptRetry refuses typed when no recipe is bound / the item is unknown", async () => {
    const { source } = bootHarness();
    const noRecipe = await source.attemptRetry(ITEM);
    expect(noRecipe.ok).toBe(false);
    if (noRecipe.ok) return;
    expect(noRecipe.error.code).toBe("INVALID_STATE");
    const unknown = await source.attemptRetry("wfxitm_000000000000000000000000ZZ");
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.error.code).toBe("NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// The leak law + the gated diagnostics (J21-J25 "No native protocol")
// ---------------------------------------------------------------------------

describe("R14 desktop — protocol terminology lives ONLY in the gated diagnostics", () => {
  it("EVERY default view is protocol-free; the diagnostics carry the protocol detail", () => {
    const { engine, runtime, source } = bootHarness();
    // A mid-lifecycle state with rich protocol facts behind it.
    engine.script(
      "s-1",
      statusOf({ sessionId: "s-1", state: "downloading", stalled: true, stallDurationMs: 90_000, peers: { connected: 0 }, progress: { selectedPieces: 6, verifiedSelectedPieces: 2, selectedBytes: 98_304, verifiedSelectedBytes: 32_768, fraction: 2 / 6 } }),
      "steady",
      truthOf({
        schedulerState: "steady",
        runway: { bytes: 16_384, seconds: 1 },
        stall: { kind: "no-completion-path", connectedPeers: 0, downloadBytesPerSec: 0, sessionStalled: true, stallDurationMs: 90_000, detail: "zero connected peers past the stall threshold" },
        deadlinesAtRisk: [
          { kind: "runway", fromByte: 32_768, toByte: 98_304, remainingBytes: 65_536, consumptionBytesPerSec: 32_768, downloadBytesPerSec: 0, reason: "no completion path at a zero rate" },
        ],
      }),
    );
    source.refresh();
    const view = runtime.acquisition.view(ITEM);
    expect(view?.state).toBe("buffering"); // deadline at risk — the honest demotion
    // THE LEAK LAW (the default surface):
    expect(containsAcquisitionProtocolTerminology(view?.label ?? "")).toBe(false);
    expect(containsAcquisitionProtocolTerminology(view?.detail ?? "")).toBe(false);

    // THE GATED SURFACE (protocol vocabulary — explicitly gated):
    const diagnostics = source.diagnostics(ITEM);
    expect(diagnostics).not.toBeNull();
    if (diagnostics === null) return;
    expect(diagnostics.sessionState).toBe("downloading");
    expect(diagnostics.schedulerState).toBe("steady");
    expect(diagnostics.peersConnected).toBe(0);
    expect(diagnostics.piecesVerified).toBe(2);
    expect(diagnostics.piecesTotal).toBe(9);
    expect(diagnostics.stallKind).toBe("no-completion-path");
    expect(diagnostics.infoHash).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(diagnostics.provenance).toEqual({ sourceId: "vault:family-media", basis: "user-owned" });
  });

  it("the surface projection separates the default views from the gated diagnostics", () => {
    const { engine, runtime, source } = bootHarness();
    engine.script("s-1", statusOf({ sessionId: "s-1", state: "downloading" }), "idle", truthOf());
    source.refresh();
    const surface = createDesktopAcquisitionSurface(runtime, source);
    expect(surface.bound).toBe(true);
    expect(surface.acquisitionView(ITEM)?.state).toBe("completing");
    expect(surface.acquisitionDiagnostics(ITEM)?.sessionState).toBe("downloading");
    expect(surface.acquisitionViews().length).toBe(1);
    // The observation flows through the surface too.
    let observed = 0;
    const unsubscribe = surface.observeAcquisition(() => {
      observed += 1;
    });
    engine.script("s-1", statusOf({ sessionId: "s-1", state: "downloading", progress: { selectedPieces: 6, verifiedSelectedPieces: 3, selectedBytes: 98_304, verifiedSelectedBytes: 49_152, fraction: 0.5 } }), "idle", truthOf());
    surface.refreshAcquisition();
    expect(observed).toBe(1);
    unsubscribe();
  });

  it("the UNBOUND surface is the honest capability truth (never a fixture fallback)", async () => {
    const runtime = createRuntime(makeDesktopCapabilities(), new InMemoryServerPort(), {
      context: { userId: "user-1", sessionId: "sess-1", locale: "en" },
      clock: new FixedClock(T0),
      ids: new SequentialIdGen(),
    });
    const surface = createUnboundAcquisitionSurface(runtime);
    expect(surface.bound).toBe(false);
    expect(surface.acquisitionViews()).toEqual([]);
    expect(surface.acquisitionDiagnostics(ITEM)).toBe(null);
    expect(surface.refreshAcquisition().ok).toBe(true);
    const retry = await surface.attemptAcquisitionRetry(ITEM);
    expect(retry.ok).toBe(false);
    if (retry.ok) return;
    expect(retry.error.code).toBe("INVALID_STATE");
    expect(retry.error.detail).toContain("not bound");
  });

  it("the observation law propagates through refresh (an adapter-bug fact set throws typed)", () => {
    const { engine, runtime, source } = bootHarness();
    engine.scriptOfflineReady([
      offlineEntry({ key: `canonical:user:42::${ITEM}`, sessionId: "s-1", library: { profileKey: "user:42", canonicalItemId: ITEM } }),
    ]);
    engine.script("s-1", statusOf({ sessionId: "s-1", state: "downloading" }), "idle", truthOf());
    source.refresh();
    expect(runtime.acquisition.view(ITEM)?.state).toBe("ready-offline"); // the verified exposure wins the fold
    // An adapter bug: the exposure listing LOSES its entry while a live
    // transfer is served — the implied jump (ready-offline → completing,
    // as if the earned copy never existed) is impossible and throws typed.
    engine.scriptOfflineReady([]);
    expect(() => source.refresh()).toThrow(/InvalidAcquisitionTransitionError/);
    // The honest recovery: the degraded exposure must be OBSERVED first.
    engine.scriptOfflineReady([
      offlineEntry({ key: `canonical:user:42::${ITEM}`, sessionId: "s-1", library: { profileKey: "user:42", canonicalItemId: ITEM }, integrity: "vanished" }),
    ]);
    engine.drop("s-1");
    source.refresh();
    expect(runtime.acquisition.view(ITEM)?.state).toBe("failed");
    expect(runtime.acquisition.view(ITEM)?.failure?.cause).toBe("offline-copy-missing");
  });
});

// ---------------------------------------------------------------------------
// The app composition (the wiring through createDesktopApp)
// ---------------------------------------------------------------------------

describe("R14 desktop — the composition root binds the acquisition block", () => {
  it("createDesktopApp composes the acquisition surface when the block is provided", async () => {
    const { SimShell, SimEngineProcess } = await import("./shell-simulator");
    const { createDesktopApp } = await import("../src/main");
    const shell = new SimShell();
    const engineProcess = new SimEngineProcess();
    const runtime = createRuntime(makeDesktopCapabilities(), new InMemoryServerPort(), {
      context: { userId: "user-1", sessionId: "sess-1", locale: "en" },
      clock: new FixedClock(T0),
      ids: new SequentialIdGen(),
    });
    void runtime;
    const app = createDesktopApp({
      shell,
      server: new InMemoryServerPort(),
      session: {
        context: { userId: "wfx-desktop-user", sessionId: "wfx-desktop-session", locale: "en" },
        clock: new FixedClock(T0),
        ids: new SequentialIdGen(),
      },
      engine: {
        process: engineProcess,
        config: { cacheDir: "/tmp/wfx-r14-test/engine", maxCacheBytes: 1024 * 1024 },
      },
      acquisition: { engine: new ScriptedEngine(), adapter: new ScriptedEngine().adapter },
    });
    expect(app.acquisition.bound).toBe(true);
    expect(typeof app.acquisition.acquisitionView).toBe("function");
    app.dispose();
  });

  it("createDesktopApp answers the honest UNBOUND surface when the block is absent", async () => {
    const { SimShell, SimEngineProcess } = await import("./shell-simulator");
    const { createDesktopApp } = await import("../src/main");
    const app = createDesktopApp({
      shell: new SimShell(),
      server: new InMemoryServerPort(),
      session: {
        context: { userId: "wfx-desktop-user", sessionId: "wfx-desktop-session", locale: "en" },
        clock: new FixedClock(T0),
        ids: new SequentialIdGen(),
      },
      engine: {
        process: new SimEngineProcess(),
        config: { cacheDir: "/tmp/wfx-r14-test/engine2", maxCacheBytes: 1024 * 1024 },
      },
    });
    expect(app.acquisition.bound).toBe(false);
    expect(app.acquisition.acquisitionViews()).toEqual([]);
    app.dispose();
  });
});
