/**
 * R23-W3 — the R23-C torrent realization binding tests (the native
 * integration laws + the nine-dimension first-class parity contract).
 *
 * Every law here is the frozen contract's own: the rung decision (Worker
 * 1's R23-C), the authorization gate (never offered when unlawful), the
 * J22 file-choice step, the canonical-identity bind, the NATIVE playback
 * engagement (there is no torrent playback mode), the ready-offline
 * verified replay (J27), and the J25 recovery continuity.
 */

import { describe, expect, it } from "bun:test";

import {
  AUTHORIZED_PEER_COPY_CONNECTOR_ID,
  desktopTorrentRungSatisfaction,
  isPlayableTorrentFilePath,
  peerCopyPlaybackRealization,
  resolvePeerCopySelection,
  torrentFileCandidates,
  torrentRealizationDeclarationOf,
} from "../src/platform/torrent-playback";
import type { DesktopTorrentRealization } from "../src/platform/torrent-playback";
import {
  R23_ITEM,
  R23_MAGNET,
  R23_PROVENANCE,
  R23_TORRENT_FILES,
  bootR23,
  lastNativeSessionId,
  nativeEvent,
} from "./r23-harness";

const authorizedRealization = (overrides?: Partial<DesktopTorrentRealization>): DesktopTorrentRealization => ({
  itemId: R23_ITEM,
  title: "Family Archive Feature Presentation",
  magnet: R23_MAGNET,
  provenance: R23_PROVENANCE,
  browserCapable: false,
  ...overrides,
});

describe("R23-W3 torrent-playback — the rung decision (the R23-C contract consumed)", () => {
  it("an authorized peer copy satisfies the NATIVE rung on Desktop", () => {
    const rung = desktopTorrentRungSatisfaction(authorizedRealization());
    expect(rung?.kind).toBe("satisfies-native-rung");
    if (rung?.kind === "satisfies-native-rung") {
      expect(rung.mode).toBe("native"); // the frozen mode — there is no torrent mode
      expect(rung.detail).toContain("native player");
    }
  });

  it("an unauthorized copy is NEVER offered as playback (the requires-authorization refusal)", () => {
    const rung = desktopTorrentRungSatisfaction(
      authorizedRealization({ provenance: { sourceId: "vault:family-media", basis: "not-a-lawful-basis" } }),
    );
    expect(rung?.kind).toBe("requires-authorization");
    if (rung?.kind === "requires-authorization") {
      expect(rung.detail).toContain("not authorized");
      expect(rung.detail).toContain("permitted");
    }
  });

  it("no realization offered answers null (the honest absence)", () => {
    expect(desktopTorrentRungSatisfaction(null)).toBeNull();
  });

  it("the declaration derives the R23-C truth (transport torrent + public access class)", () => {
    const declaration = torrentRealizationDeclarationOf(authorizedRealization());
    expect(declaration.transport).toBe("torrent");
    expect(declaration.authorized).toBe(true);
    expect(declaration.browserCapable).toBe(false);
    expect(declaration.accessClass).toBe("public"); // an authorized peer copy needs no provider sign-in
  });

  it("the composed realization carries the NATIVE mode with the peer-copy connector vocabulary", () => {
    const realization = peerCopyPlaybackRealization();
    expect(realization.mode).toBe("native");
    expect(realization.connectorId).toBe(AUTHORIZED_PEER_COPY_CONNECTOR_ID);
    expect(realization.capabilities).toContain("authorized-peer-copy");
    expect(realization.capabilities).toContain("playback-before-completion");
  });
});

describe("R23-W3 torrent-playback — the file-choice step (the J22 law, protocol-free)", () => {
  it("derives the candidates with the playable files first", () => {
    const candidates = torrentFileCandidates(R23_TORRENT_FILES);
    expect(candidates.map((candidate) => candidate.path)).toEqual([
      "feature-presentation.mkv",
      "bonus-interview.mp4",
      "coverart.jpg",
    ]);
    expect(candidates[0]?.playable).toBe(true);
    expect(candidates[2]?.playable).toBe(false);
  });

  it("the playable-path derivation knows the video containers", () => {
    expect(isPlayableTorrentFilePath("movie.mkv")).toBe(true);
    expect(isPlayableTorrentFilePath("clip.MP4")).toBe(true);
    expect(isPlayableTorrentFilePath("cover.jpg")).toBe(false);
    expect(isPlayableTorrentFilePath("notes.txt")).toBe(false);
  });

  it("a single playable file auto-selects; multiple playable files require the choice", () => {
    const single = resolvePeerCopySelection(
      [
        { path: "movie.mkv", lengthBytes: 1 },
        { path: "cover.jpg", lengthBytes: 2 },
      ],
      undefined,
    );
    expect(single.kind).toBe("selection");
    if (single.kind === "selection") expect(single.fileIndexes).toEqual([0]);

    const multi = resolvePeerCopySelection(R23_TORRENT_FILES, undefined);
    expect(multi.kind).toBe("file-choice-required");
    if (multi.kind === "file-choice-required") expect(multi.candidates.length).toBe(3);

    const explicit = resolvePeerCopySelection(R23_TORRENT_FILES, [2]);
    expect(explicit.kind).toBe("selection"); // the user's own choice is never second-guessed
    if (explicit.kind === "selection") expect(explicit.fileIndexes).toEqual([2]);
  });
});

describe("R23-W3 torrent-playback — the play flow (the native rung engaged)", () => {
  it("not-offered answers the honest absence for an item with no peer copy", async () => {
    const boot = bootR23({ realizationOf: () => null });
    const outcome = await boot.torrentPlayback.playPeerCopy(R23_ITEM);
    expect(outcome.kind).toBe("not-offered");
    if (outcome.kind === "not-offered") {
      expect(outcome.detail).toContain("No authorized peer copy");
    }
  });

  it("requires-authorization refuses an unlawful basis BEFORE any engine step", async () => {
    const boot = bootR23({
      realizationOf: (itemId) =>
        itemId === R23_ITEM
          ? authorizedRealization({ provenance: { sourceId: "vault:family-media", basis: "no-basis" } })
          : null,
    });
    const outcome = await boot.torrentPlayback.playPeerCopy(R23_ITEM);
    expect(outcome.kind).toBe("requires-authorization");
    expect(boot.engine.ingestions()).toHaveLength(0); // never even ingested
    expect(boot.nativeMedia.opens).toHaveLength(0); // never engaged playback
  });

  it("the registry mint refusal answers engine-refused (the provenance gate is real)", async () => {
    // The composition's registry does NOT carry this source: the mint
    // refuses vault:unregistered even though the basis is lawful — the
    // provenance gate is the registry's own truth, never bypassed.
    const boot = bootR23({
      realizationOf: (itemId) =>
        itemId === R23_ITEM
          ? authorizedRealization({
              provenance: { sourceId: "vault:unregistered", basis: "user-owned" },
            })
          : null,
    });
    const outcome = await boot.torrentPlayback.playPeerCopy(R23_ITEM);
    expect(outcome.kind).toBe("engine-refused");
    if (outcome.kind === "engine-refused") {
      expect(outcome.code).toBe("PROVENANCE_REJECTED");
      expect(outcome.detail).toContain("authorized-source registry");
    }
    expect(boot.nativeMedia.opens).toHaveLength(0);
  });

  it("a magnet realization with a single playable file starts the acquisition + NATIVE playback", async () => {
    const boot = bootR23({
      // torrent-file kind with ONE playable file → the auto-selection.
      realizationOf: (itemId) =>
        itemId === R23_ITEM
          ? authorizedRealization({
              magnet: undefined,
              torrentBytes: new Uint8Array([1, 2, 3, 4]),
            })
          : null,
    });
    boot.engine.torrentFiles = [
      { path: "feature-presentation.mkv", name: "feature-presentation.mkv", lengthBytes: 88_912, offsetBytes: 0 },
      { path: "coverart.jpg", name: "coverart.jpg", lengthBytes: 4_000, offsetBytes: 88_912 },
    ];
    const outcome = await boot.torrentPlayback.playPeerCopy(R23_ITEM);
    expect(outcome.kind).toBe("started");
    if (outcome.kind !== "started") return;
    expect(outcome.controller.state().mode).toBe("native"); // the rung — never a torrent mode
    expect(outcome.controller.state().realization.connectorId).toBe(AUTHORIZED_PEER_COPY_CONNECTOR_ID);
    expect(boot.nativeMedia.opens).toHaveLength(1);
    expect(boot.nativeMedia.opens[0]?.torrentBytes).toBeDefined(); // the authorized open input

    // The acquisition surfaced the preparing lifecycle (the canonical bind).
    boot.acquisition.refreshAcquisition();
    const view = boot.runtime.acquisition.view(R23_ITEM);
    expect(view?.state).toBe("preparing");

    // The playback phases follow the port's truthful events (the runtime's laws).
    await outcome.controller.play();
    nativeEvent(boot.nativeMedia, lastNativeSessionId(boot.nativeMedia), "playing", 1_000, 30_000);
    expect(outcome.controller.state().phase).toBe("playing");
    expect(outcome.controller.state().positionMs).toBe(1_000);
  });

  it("a multi-file torrent answers the FILE-CHOICE step (never a silent default)", async () => {
    const boot = bootR23({
      realizationOf: (itemId) =>
        itemId === R23_ITEM
          ? authorizedRealization({ magnet: undefined, torrentBytes: new Uint8Array([1, 2, 3, 4]) })
          : null,
    });
    // R23_TORRENT_FILES is the default: two playable files + cover art.
    const outcome = await boot.torrentPlayback.playPeerCopy(R23_ITEM);
    expect(outcome.kind).toBe("file-choice-required");
    if (outcome.kind !== "file-choice-required") return;
    expect(outcome.candidates.length).toBe(3);
    expect(outcome.candidates[0]?.path).toBe("feature-presentation.mkv");
    expect(outcome.detail).toContain("choose the one to watch");

    // The resolution: the chosen file starts the acquisition + playback.
    const started = await boot.torrentPlayback.playPeerCopy(R23_ITEM, { fileIndexes: [0] });
    expect(started.kind).toBe("started");
    if (started.kind === "started") {
      expect(started.controller.state().mode).toBe("native");
    }
  });

  it("the ready-offline exposure replays through the VERIFIED asset's local path (J27)", async () => {
    const boot = bootR23();
    boot.engine.scriptOfflineReady([
      {
        key: `canonical:${R23_PROVENANCE.sourceId}::${R23_ITEM}`,
        library: { profileKey: "wfxusr_r23_test:main", canonicalItemId: R23_ITEM },
        sessionId: "s-prior",
        infoHash: "0123456789abcdef0123456789abcdef01234567",
        provenance: R23_PROVENANCE,
        assets: [
          {
            assetId: "asset-r23-offline",
            sourcePath: "feature-presentation.mkv",
            contentPath: "/store/asset-r23-offline/content",
            sizeBytes: 88_912,
            sha256: "a".repeat(64),
            contentType: "video/x-matroska",
            integrity: "verified",
            sizeOnDisk: 88_912,
          },
        ],
        exposedAt: R23_T0_NOW(),
      },
    ]);
    const outcome = await boot.torrentPlayback.playPeerCopy(R23_ITEM);
    expect(outcome.kind).toBe("started");
    if (outcome.kind !== "started") return;
    expect(outcome.sessionId).toBe("offline:asset-r23-offline");
    expect(boot.nativeMedia.opens[0]?.localPath).toBe("/store/asset-r23-offline/content");
    expect(outcome.detail).toContain("verified copy");
    expect(boot.engine.ingestions()).toHaveLength(0); // the earned copy plays without the swarm
  });

  it("a vanished exposure falls back to the live acquisition (the honest disk truth)", async () => {
    const boot = bootR23();
    boot.engine.scriptOfflineReady([
      {
        key: `canonical:${R23_PROVENANCE.sourceId}::${R23_ITEM}`,
        library: { profileKey: "wfxusr_r23_test:main", canonicalItemId: R23_ITEM },
        sessionId: "s-prior",
        infoHash: "0123456789abcdef0123456789abcdef01234567",
        provenance: R23_PROVENANCE,
        assets: [
          {
            assetId: "asset-r23-gone",
            sourcePath: "feature-presentation.mkv",
            contentPath: "/store/asset-r23-gone/content",
            sizeBytes: 88_912,
            sha256: "a".repeat(64),
            contentType: "video/x-matroska",
            integrity: "vanished",
            sizeOnDisk: null,
          },
        ],
        exposedAt: R23_T0_NOW(),
      },
    ]);
    const outcome = await boot.torrentPlayback.playPeerCopy(R23_ITEM);
    expect(outcome.kind).toBe("started");
    if (outcome.kind !== "started") return;
    expect(boot.engine.ingestions()).toHaveLength(1); // the live path (the vanished copy is not played)
    expect(boot.nativeMedia.opens[0]?.magnet).toBe(R23_MAGNET);
  });
});

describe("R23-W3 torrent-playback — the parity contract (the nine dimensions, concrete)", () => {
  it("canonical-item-identity: the session binds to the CANONICAL item (the R04 composition)", async () => {
    const boot = bootR23({ profileKey: "wfxusr_r23_test:main" });
    const outcome = await boot.torrentPlayback.playPeerCopy(R23_ITEM);
    expect(outcome.kind).toBe("started");
    boot.acquisition.refreshAcquisition();
    // The acquisition view keys by the canonical item id — the same identity
    // any provider realization carries.
    expect(boot.runtime.acquisition.view(R23_ITEM)?.itemId).toBe(R23_ITEM);
  });

  it("resume-position: playback resumes at the watch state's own truth", async () => {
    const boot = bootR23();
    // Prior watch truth: the item was watched to 42s (the durable fold's
    // position — the same source any realization resumes from).
    await boot.runtime.updateWatchState({
      kind: "progress",
      itemId: R23_ITEM,
      positionMs: 42_000,
      playbackSessionId: "prior-session",
    });
    const outcome = await boot.torrentPlayback.playPeerCopy(R23_ITEM);
    expect(outcome.kind).toBe("started");
    if (outcome.kind !== "started") return;
    expect(outcome.controller.state().positionMs).toBe(42_000);
  });

  it("playback-telemetry: the surface evidence flows into the watch state (the same mirroring)", async () => {
    const boot = bootR23();
    const outcome = await boot.torrentPlayback.playPeerCopy(R23_ITEM);
    expect(outcome.kind).toBe("started");
    if (outcome.kind !== "started") return;
    await outcome.controller.play();
    outcome.controller.observe({ kind: "progress", positionMs: 61_800 });
    const watch = boot.runtime.watchState.get(R23_ITEM);
    expect(watch?.lastPositionMs).toBe(61_800); // the same fold any realization feeds
  });

  it("error-recovery-vocabulary: the failure path uses the SAME typed acquisition vocabulary", async () => {
    const boot = bootR23();
    const outcome = await boot.torrentPlayback.playPeerCopy(R23_ITEM);
    expect(outcome.kind).toBe("started");
    // The engine reports a RECOVERABLE failure (the R11 vocabulary).
    boot.engine.script(
      "s-r23-1",
      engineFailureStatus("s-r23-1", "io-error"),
      "idle",
      engineTruthIdle(),
    );
    boot.acquisition.refreshAcquisition();
    const view = boot.runtime.acquisition.view(R23_ITEM);
    expect(view?.state).toBe("failed");
    expect(view?.failure?.recoverable).toBe(true);
    expect(view?.actions.map((action) => action.kind)).toContain("retry");
    expect(view?.detail).not.toContain("piece"); // protocol-free on the default surface
  });
});

describe("R23-W3 torrent-playback — the recovery continuity (the J25 doctrine)", () => {
  it("recoverSession re-binds the journaled session + reports the resumed truth", async () => {
    const boot = bootR23();
    // A restarted app: the journaled session is seeding-paused at 4/6.
    boot.engine.script(
      "s-r23-1",
      {
        sessionId: "s-r23-1",
        infoHash: "0123456789abcdef0123456789abcdef01234567",
        state: "seeding-paused" as const,
        stalled: false,
        peers: { connected: 3 },
        pieces: { total: 9, verified: 4 },
        progress: {
          selectedPieces: 6,
          verifiedSelectedPieces: 4,
          selectedBytes: 98_304,
          verifiedSelectedBytes: 65_536,
          fraction: 4 / 6,
        },
        rates: { downloadBytesPerSec: 0, uploadBytesPerSec: 0 },
        files: [],
        provenance: R23_PROVENANCE,
        dataDir: "/tmp/r23/data",
        integrity: "unknown" as const,
      },
      "idle",
      engineTruthIdle(),
    );
    const recovery = await boot.torrentPlayback.recoverSession({
      sessionId: "s-r23-1",
      identity: { profileKey: "wfxusr_r23_test:main", canonicalItemId: R23_ITEM, title: "Family Archive" },
    });
    expect(recovery.ok).toBe(true);
    // The acquisition surface reports the resumed truth with retained progress.
    boot.acquisition.refreshAcquisition({
      recovered: [
        {
          sessionId: "s-r23-1",
          state: "seeding-paused" as const,
          resumeTarget: "downloading" as const,
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
    });
    const view = boot.runtime.acquisition.view(R23_ITEM);
    expect(view?.resumed).toBe(true);
    expect(view?.paused).toBe(true);
    expect(view?.retainedFraction).toBeCloseTo(4 / 6, 9);
    expect(view?.state).not.toBe("ready-offline"); // NO false completion
  });
});

// ---------------------------------------------------------------------------
// The local helpers (honest scripted statuses)
// ---------------------------------------------------------------------------

function R23_T0_NOW(): number {
  return Date.parse("2026-09-21T10:00:00.000Z");
}

function engineFailureStatus(sessionId: string, reason: string) {
  return {
    sessionId,
    infoHash: "0123456789abcdef0123456789abcdef01234567",
    state: "failed" as const,
    stalled: false,
    peers: { connected: 0 },
    pieces: { total: 9, verified: 2 },
    progress: {
      selectedPieces: 6,
      verifiedSelectedPieces: 2,
      selectedBytes: 98_304,
      verifiedSelectedBytes: 32_768,
      fraction: 2 / 6,
    },
    rates: { downloadBytesPerSec: 0, uploadBytesPerSec: 0 },
    files: [],
    provenance: R23_PROVENANCE,
    dataDir: "/tmp/r23/data",
    integrity: "unknown" as const,
    failure: { reason, detail: "a storage problem interrupted the transfer" },
  };
}

function engineTruthIdle() {
  return {
    sessionId: "s-r23-1",
    schedulerState: "idle" as const,
    runway: undefined,
    availability: { verifiedPiecesInFile: 2, totalPiecesInFile: 6, contiguousVerifiedToByte: 32_768 },
    deadlinesAtRisk: [],
    stall: {
      kind: "none" as const,
      connectedPeers: 3,
      downloadBytesPerSec: 65_536,
      sessionStalled: false,
      detail: "healthy",
    },
    playableNow: true,
  };
}
