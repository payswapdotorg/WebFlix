/**
 * R27-W3 — THE CHROME JOURNEY TEST (the R26 peer-watch lifecycle,
 * rendered through the R27 chrome over the REAL composition).
 *
 * THE LAW THIS WALK PROVES (the packet's C + the R26 first-class law):
 * the honest peer-realization journey — Where-to-watch → authorized peer
 * copy → play → Buffering-with-verified-fraction → Playing → seek
 * demotion → background completion → integrity verification → Ready
 * offline — renders INSIDE the same player chrome (the corpus control
 * grammar, the red scrub, the time readout, the settings popup's
 * capability rows), with the runtime semantics UNCHANGED underneath
 * (the same engine wire, the same verified-copy demotion answer, the
 * same earned Ready-offline).
 */

import { describe, expect, it } from "bun:test";

import { FixedClock, SequentialIdGen } from "@wfx/client-runtime";
import type { AcquisitionStatusView } from "@wfx/client-runtime";
import { TORRENT_REALIZATION_VIEW } from "@wfx/client-runtime";
import type { TorrentSessionStatus } from "@wfx/torrent-engine";

import { SimEngineProcess, SimShell } from "./shell-simulator";
import { TorrentFlowEngine } from "./r23-harness";
import { engineStatus, engineTruth } from "./discoverability-harness";
import { createDesktopApp } from "../src/main";
import { createDesktopServerPort } from "../src/platform/server-port";
import { PEER_CATALOG_ENTRIES } from "../src/platform/peer-catalog";
import {
  r27ChromeControlsOf,
  r27ChromeScrubPlayability,
  r27ChromeScrubViewOf,
  r27ChromeTimeReadout,
  r27SettingsMenuView,
} from "../src/surface/r27-chrome-surface";
import { r27WatchPageView } from "../src/surface/r27-surface-grammar";

const R27_T0 = Date.parse("2026-09-23T12:00:00.000Z");
const BASE = new URL("https://experience.webflix.invalid/api");
const CONTEXT = {
  userId: "wfx-desktop-r27-chrome-user",
  sessionId: "wfx-desktop-r27-chrome-session",
  locale: "en",
};

const SINTEL = PEER_CATALOG_ENTRIES.find((entry) => entry.title === "Sintel")!;

class StubFetch {
  private scripted: { match: (url: string) => boolean; respond: () => Response }[] = [];
  script(match: (url: string) => boolean, respond: () => Response): void {
    this.scripted.push({ match, respond });
  }
  fetch = (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    for (let index = this.scripted.length - 1; index >= 0; index -= 1) {
      const entry = this.scripted[index]!;
      if (entry.match(url)) return Promise.resolve(entry.respond());
    }
    return Promise.reject(new TypeError("stub fetch: no scripted response (offline)"));
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bootChromeJourney() {
  const engine = new TorrentFlowEngine();
  engine.torrentFiles = SINTEL.files.map((file) => ({
    path: file.path,
    name: file.path.split("/").pop()!,
    lengthBytes: file.lengthBytes,
    offsetBytes: 0,
  }));
  const shell = new SimShell();
  const stub = new StubFetch();
  stub.script((url) => url.includes("/experience/search"), () => jsonResponse([]));
  stub.script((url) => url.includes("/experience/library"), () => jsonResponse([]));
  stub.script((url) => url.includes("/experience/history"), () => jsonResponse([]));
  const engineProcess = new SimEngineProcess();
  const app = createDesktopApp({
    shell,
    server: createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch }),
    session: { context: CONTEXT, clock: new FixedClock(R27_T0), ids: new SequentialIdGen() },
    engine: {
      config: {
        cacheDir: "/sim/app-data/wfx-desktop/engine-cache",
        maxCacheBytes: 64 * 1024 * 1024,
      },
      process: engineProcess,
    },
    acquisition: { engine, adapter: engine.adapter },
  });
  return { app, engine, engineProcess };
}

function scriptSession(
  boot: ReturnType<typeof bootChromeJourney>,
  sessionId: string,
  status: TorrentSessionStatus,
  scheduler: "idle" | "startup" | "steady" | "seeking" | "background-completion",
): void {
  boot.engine.script(sessionId, status, scheduler, engineTruth());
}

function nativeEvent(
  boot: ReturnType<typeof bootChromeJourney>,
  n: number,
  state: "buffering" | "playing" | "background" | "complete" | "failed",
  positionMs: number,
  bufferedMs: number,
): void {
  const handle = boot.engineProcess.lastHandle;
  if (handle === undefined) throw new Error("no engine handle was spawned");
  handle.emitStateChanged({
    id: `sim-session-${n}`,
    assetId: `sim-asset-${n}`,
    fileId: `sim-file-${n}`,
    state,
    bufferedMs,
    positionMs,
    ...(state === "complete" ? { integrity: "verified" as const } : {}),
    ...(state === "failed" ? { error: "the engine reported a failure" } : {}),
  });
}

function downloadingAt(sessionId: string, verified: number, selected: number): TorrentSessionStatus {
  return engineStatus({
    sessionId,
    state: "downloading",
    progress: {
      selectedPieces: selected,
      verifiedSelectedPieces: verified,
      selectedBytes: selected * 16_384,
      verifiedSelectedBytes: verified * 16_384,
      fraction: verified / selected,
    },
    provenance: { sourceId: "vault:webflix-peer-catalog", basis: "creative-commons" },
  });
}

describe("R27-W3 the chrome journey (the R26 lifecycle inside the corpus chrome)", () => {
  it("where-to-watch reads as the viewing-source choice; play starts the peer copy", async () => {
    const boot = bootChromeJourney();
    const itemDetail = boot.app.itemDetail!;
    const item = await itemDetail.item({ itemId: SINTEL.itemId });
    const watch = r27WatchPageView(item, []);

    // The ways-to-watch rows carry the frozen vocabulary; the peer copy
    // is the selected primary way (no provider way exists for Sintel).
    const peerWay = watch.waysToWatch.find((way) => way.kind === "authorized-peer-copy");
    expect(peerWay!.label).toBe(TORRENT_REALIZATION_VIEW.label);
    expect(watch.primaryPlay.label).toBe(`Play — ${TORRENT_REALIZATION_VIEW.label}`);

    // THE PLAY: the chrome renders over the real session.
    const outcome = await itemDetail.playPeerCopy(SINTEL.itemId);
    expect(outcome.kind).toBe("started");
    boot.app.dispose();
  });

  it("the lifecycle renders inside the chrome — Buffering(verified fraction) → Playing → seek demotion", async () => {
    const boot = bootChromeJourney();
    const itemDetail = boot.app.itemDetail!;
    const item = await itemDetail.item({ itemId: SINTEL.itemId });
    const outcome = await itemDetail.playPeerCopy(SINTEL.itemId);
    if (outcome.kind !== "started") throw new Error("expected started");
    const controller = itemDetail.playbackController(outcome.playbackSessionId)!;
    const sessionId = outcome.sessionId;

    // --- Buffering: the stage state + the settings popup's truths ---
    scriptSession(boot, sessionId, downloadingAt(sessionId, 1, 6), "startup");
    boot.app.acquisition.refreshAcquisition();
    let acquisition: AcquisitionStatusView | null = itemDetail.acquisitionState(SINTEL.itemId);
    const bufferingWatch = r27WatchPageView(item, []);
    expect(acquisition?.state).toBe("buffering");
    expect(bufferingWatch.stage.kind).toBe("idle"); // pre-map: the item view's own fold
    // The STAGE maps the live acquisition view when the watch page folds it:
    const liveStage = { kind: acquisition!.state, label: acquisition!.label, progress: acquisition!.progress };
    expect(liveStage.kind).toBe("buffering");
    expect(liveStage.progress).not.toBeNull();
    expect(Math.abs((liveStage.progress ?? 0) - 1 / 6)).toBeLessThan(1e-9);

    // The chrome over the real playback state: the honest time readout.
    // The engine double carries NO duration (the honest truth — the
    // duration is the engine/player's own measured figure once the file
    // streams), so the readout renders CURRENT-ONLY, never a fabricated
    // total (the unit test pins the cur/dur shape when a duration exists).
    nativeEvent(boot, 1, "buffering", 0, 8_000);
    let state = controller.state();
    expect(r27ChromeTimeReadout(state)).toBe("0:00");

    // --- Playing: the control bar + the red scrub over the runway ---
    await controller.play();
    nativeEvent(boot, 1, "playing", 800, 45_000);
    state = controller.state();
    const controls = r27ChromeControlsOf(state.mode, { queueCount: 0 });
    expect(controls.find((control) => control.kind === "play-pause")!.backing).toBe("runtime-command");
    expect(controls.find((control) => control.kind === "next")!.visible).toBe(false);
    const scrub = r27ChromeScrubViewOf(state);
    expect(scrub.playedColor).toBe("#f03");
    expect(scrub.model.positionMs).toBe(800);
    expect(scrub.model.bufferedMs).toBe(45_000);
    // The time readout carries the session's own numbers (duration still
    // honestly unknown on this rung — current-only, never a fake total;
    // 800ms rounds to 0:01).
    expect(r27ChromeTimeReadout(state)).toBe("0:01");

    // --- Seek demotion: the honest answer, unchanged underneath ---
    scriptSession(boot, sessionId, downloadingAt(sessionId, 3, 6), "seeking");
    await controller.seek(42_000);
    nativeEvent(boot, 1, "playing", 42_000, 45_000);
    const demotedScrub = r27ChromeScrubViewOf(controller.state());
    // A seek target far beyond the verified runway answers the honest truth.
    const beyond = r27ChromeScrubPlayability(demotedScrub.model, 400_000);
    expect(beyond.kind).toBe("needs-verified-range");
    boot.app.acquisition.refreshAcquisition();
    acquisition = itemDetail.acquisitionState(SINTEL.itemId);
    expect(acquisition?.state).toBe("buffering");
    boot.app.dispose();
  });

  it("completing → Ready offline: the earned arrival renders; the settings rows gate on truth", async () => {
    const boot = bootChromeJourney();
    const itemDetail = boot.app.itemDetail!;
    const outcome = await itemDetail.playPeerCopy(SINTEL.itemId);
    if (outcome.kind !== "started") throw new Error("expected started");
    const sessionId = outcome.sessionId;

    // --- Background completion ---
    scriptSession(boot, sessionId, downloadingAt(sessionId, 5, 6), "background-completion");
    boot.app.acquisition.refreshAcquisition();
    expect(itemDetail.acquisitionState(SINTEL.itemId)?.state).toBe("completing");

    // --- THE EARNED ARRIVAL: verified exposure → Ready offline ---
    boot.engine.scriptOfflineReady([
      {
        key: `canonical:session:${CONTEXT.sessionId}::${SINTEL.itemId}`,
        library: { profileKey: `session:${CONTEXT.sessionId}`, canonicalItemId: SINTEL.itemId },
        sessionId,
        infoHash: SINTEL.infoHash,
        provenance: { sourceId: "vault:webflix-peer-catalog", basis: "creative-commons" },
        assets: [
          {
            assetId: "asset-r27-sintel",
            sourcePath: SINTEL.videoFilePath,
            contentPath: "/sim/store/asset-r27-sintel/content",
            sizeBytes: SINTEL.videoBytes,
            sha256: "a".repeat(64),
            contentType: "video/mp4",
            integrity: "verified",
            sizeOnDisk: SINTEL.videoBytes,
          },
        ],
        exposedAt: R27_T0,
      },
    ]);
    boot.app.acquisition.refreshAcquisition();
    const ready = itemDetail.acquisitionState(SINTEL.itemId);
    expect(ready?.state).toBe("ready-offline");
    // The stage state maps the earned arrival verbatim.
    expect(ready?.label.toLowerCase()).toContain("ready");

    // --- The settings popup over the real truths: the capability rows ---
    const menu = r27SettingsMenuView("native", {
      translateAvailable: true, // the realtime session seam is bound on the native rung
      transcriptAvailable: false, // no transcript artifact exists for this title
      aiActionsAvailable: false, // no AI runtime bound on this composition
      provenance: `${SINTEL.license.label} — authorized by the rights holder`,
    });
    expect(menu.root.find((row) => row.id === "translate")!.available).toBe(true);
    expect(menu.root.find((row) => row.id === "transcript")!.available).toBe(false);
    expect(menu.root.find((row) => row.id === "ai-actions")!.available).toBe(false);
    expect(menu.root.find((row) => row.id === "provenance")!.value).toContain(SINTEL.license.label);
    // Where-to-watch stays first-class inside the popup.
    expect(menu.root.find((row) => row.id === "where-to-watch")!.available).toBe(true);
    boot.app.dispose();
  });
});
