/**
 * @wfx/client-runtime — playback command semantics tests (R01).
 *
 * The honesty laws: capability-filtered resolution (frozen precedence),
 * no fake progress, truthful buffering/degradation, terminal honesty.
 */

import { describe, expect, it } from "bun:test";
import type { PlaybackRealization } from "@wfx/domain";

import {
  PLAYBACK_MODE_PRECEDENCE,
  RuntimeError,
  SequentialIdGen,
  canUsePlaybackMode,
  createRuntime,
  FixedClock,
  InMemoryBrowserHostPort,
  InMemoryNativeMediaPort,
  InMemoryServerPort,
  makeDesktopCapabilities,
  makeWebCapabilities,
  resolveRealizations,
  type RuntimeSession,
} from "../src/index";

const ITEM_A = "wfxitm_00000000000000000000000001";
const T0 = Date.parse("2026-09-16T12:00:00.000Z");

function realization(mode: PlaybackRealization["mode"], url?: string): PlaybackRealization {
  return { mode, connectorId: "test-source", capabilities: [], ...(url !== undefined ? { url } : {}) };
}

function session(overrides?: Partial<RuntimeSession["context"]>): RuntimeSession {
  return {
    context: { userId: "user-1", sessionId: "sess-1", locale: "en", ...overrides },
    clock: new FixedClock(T0),
    ids: new SequentialIdGen(), // UNIQUE per event — the idempotency key
  };
}

describe("capability-filtered resolution (frozen precedence)", () => {
  it("precedence order is the frozen Native > Embed > Browser > External", () => {
    expect(PLAYBACK_MODE_PRECEDENCE).toEqual(["native", "embed", "browser", "external"]);
  });

  it("web truthfully cannot native; browser needs the contained host; embed/external are universal", () => {
    const web = makeWebCapabilities();
    expect(canUsePlaybackMode(web, "native")).toBe(false);
    expect(canUsePlaybackMode(web, "embed")).toBe(true);
    expect(canUsePlaybackMode(web, "browser")).toBe(true);
    expect(canUsePlaybackMode(web, "external")).toBe(true);
    const desktop = makeDesktopCapabilities();
    expect(canUsePlaybackMode(desktop, "native")).toBe(true);
  });

  it("skips native realizations on web and picks the next legal mode by precedence", () => {
    const web = makeWebCapabilities();
    const outcome = resolveRealizations(web, [
      realization("browser", "https://provider.example/watch"),
      realization("native"),
      realization("external"),
    ]);
    expect(outcome.chosen?.mode).toBe("browser");
    expect(outcome.skipped.map((entry) => entry.realization.mode)).toContain("native");
    expect(outcome.skipped[0]?.reason).toContain("truthfully cannot realize 'native'");
  });

  it("invalid realizations are ignored (never adopted, never repaired)", () => {
    const web = makeWebCapabilities();
    const broken = { mode: "embed", connectorId: "", capabilities: [] } as PlaybackRealization;
    const outcome = resolveRealizations(web, [broken, realization("embed")]);
    expect(outcome.valid).toHaveLength(1);
    expect(outcome.chosen?.mode).toBe("embed");
  });

  it("picks native on desktop when offered (the reference capability)", () => {
    const desktop = makeDesktopCapabilities();
    const outcome = resolveRealizations(desktop, [
      realization("embed"),
      realization("native"),
      realization("browser", "https://provider.example/watch"),
    ]);
    expect(outcome.chosen?.mode).toBe("native");
    expect(outcome.skipped).toEqual([]);
  });
});

describe("resolvePlayback (the honest failure channels)", () => {
  it("throws unsupported-capability when realizations exist but the platform cannot play any", async () => {
    const web = makeWebCapabilities();
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-native-only", { ok: true, value: [realization("native")] });
    const runtime = createRuntime(web, server, session());
    // Register the item so the intent validates (item ids are canonical).
    server.scriptSearch("anything", {
      ok: true,
      value: [{ connectorId: "test-source", externalRef: "ref-native-only", title: "Native-only item" }],
    });
    const search = await runtime.search({ query: "anything" });
    const itemId = search.hits[0]?.canonicalItemId ?? ITEM_A;

    let thrown: unknown;
    try {
      await runtime.resolvePlayback({ itemId, externalRef: "ref-native-only" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RuntimeError);
    expect((thrown as RuntimeError).kind).toBe("unsupported-capability");
    expect((thrown as RuntimeError).recovery.action).toBe("inspect-capability");
    expect((thrown as RuntimeError).message).toContain("nativeMedia: 'none'");
  });

  it("throws unavailable when nothing valid resolves at all", async () => {
    const web = makeWebCapabilities();
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-empty", { ok: true, value: [] });
    const runtime = createRuntime(web, server, session());
    server.scriptSearch("q", {
      ok: true,
      value: [{ connectorId: "test-source", externalRef: "ref-empty", title: "Empty item" }],
    });
    const itemId = (await runtime.search({ query: "q" })).hits[0]?.canonicalItemId ?? ITEM_A;
    let thrown: unknown;
    try {
      await runtime.resolvePlayback({ itemId, externalRef: "ref-empty" });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as RuntimeError).kind).toBe("unavailable");
  });

  it("maps transport failures to the typed taxonomy (network/unauthorized)", async () => {
    const web = makeWebCapabilities();
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-down", { ok: false, failure: { kind: "network", detail: "offline" } });
    const runtime = createRuntime(web, server, session());
    await expect(
      runtime.resolvePlayback({ itemId: ITEM_A, externalRef: "ref-down" }),
    ).rejects.toMatchObject({ kind: "network", retryable: true });

    const server2 = new InMemoryServerPort();
    server2.scriptResolve("ref-auth", { ok: false, failure: { kind: "unauthorized", detail: "401" } });
    const runtime2 = createRuntime(web, server2, session());
    await expect(
      runtime2.resolvePlayback({ itemId: ITEM_A, externalRef: "ref-auth" }),
    ).rejects.toMatchObject({ kind: "unauthorized", recovery: { action: "re-authenticate" } });
  });

  it("rejects malformed intents with the typed invalid-input error", async () => {
    const runtime = createRuntime(makeWebCapabilities(), new InMemoryServerPort(), session());
    await expect(
      runtime.resolvePlayback({ itemId: "garbage", externalRef: "ref" }),
    ).rejects.toMatchObject({ kind: "invalid-input" });
    await expect(runtime.resolvePlayback({ itemId: ITEM_A })).rejects.toMatchObject({
      kind: "invalid-input",
    });
  });
});

async function makeEmbedSession() {
  const web = makeWebCapabilities();
  const server = new InMemoryServerPort();
  server.scriptResolve("ref-embed", { ok: true, value: [realization("embed")] });
  const runtime = createRuntime(web, server, session());
  const playbackSession = await runtime.resolvePlayback({
    itemId: ITEM_A,
    externalRef: "ref-embed",
    resumePositionMs: 42_000,
  });
  const controller = runtime.playback.controller(playbackSession.id);
  return { runtime, server, playbackSession, controller: controller! };
}

describe("playback controller — the command state machine", () => {
  it("creates the controller in 'prepared' with the honest resume position", async () => {
    const { playbackSession, controller } = await makeEmbedSession();
    expect(playbackSession.resumePositionMs).toBe(42_000);
    expect(controller.state().phase).toBe("prepared");
    expect(controller.state().positionMs).toBe(42_000);
    expect(controller.state().mode).toBe("embed");
  });

  it("NO FAKE PROGRESS: play() does not move the position; only evidence does", async () => {
    const { controller } = await makeEmbedSession();
    await controller.prepare();
    await controller.play();
    // After play, no evidence has arrived: still buffering at the resume point.
    expect(controller.state().phase).toBe("buffering");
    expect(controller.state().positionMs).toBe(42_000);
    controller.observe({ kind: "progress", positionMs: 43_000 });
    expect(controller.state().phase).toBe("playing");
    expect(controller.state().positionMs).toBe(43_000);
  });

  it("stalled evidence produces truthful buffering — never fake playing", async () => {
    const { controller } = await makeEmbedSession();
    await controller.prepare();
    await controller.play();
    controller.observe({ kind: "progress", positionMs: 50_000 });
    expect(controller.state().phase).toBe("playing");
    controller.observe({ kind: "stalled" });
    expect(controller.state().phase).toBe("buffering");
    controller.observe({ kind: "started", positionMs: 51_000 });
    expect(controller.state().phase).toBe("playing");
  });

  it("degradation is an EXPLICIT state with detail; recovery lifts it", async () => {
    const { controller } = await makeEmbedSession();
    await controller.prepare();
    await controller.play();
    controller.observe({ kind: "progress", positionMs: 10_000 });
    controller.observe({ kind: "degraded", detail: "quality dropped to 480p" });
    const degraded = controller.state();
    expect(degraded.phase).toBe("degraded");
    expect(degraded.degradedDetail).toBe("quality dropped to 480p");
    controller.observe({ kind: "recovered" });
    expect(controller.state().phase).toBe("playing");
    expect(controller.state().degradedDetail).toBeUndefined();
  });

  it("command legality: pause/seek before prepare are typed failures", async () => {
    const { controller } = await makeEmbedSession();
    const pause = await controller.pause();
    expect(pause.ok).toBe(false);
    if (!pause.ok) expect(pause.detail).toContain("prepared");
    const seek = await controller.seek(1_000);
    expect(seek.ok).toBe(false);
    if (!seek.ok) expect(seek.detail).toContain("prepare");
  });

  it("pause → play re-enters buffering until evidence; seek acceptance is position evidence", async () => {
    const { controller } = await makeEmbedSession();
    await controller.prepare();
    await controller.play();
    controller.observe({ kind: "progress", positionMs: 10_000 });
    await controller.pause();
    expect(controller.state().phase).toBe("paused");
    const seek = await controller.seek(30_000);
    expect(seek.ok).toBe(true);
    expect(controller.state().positionMs).toBe(30_000); // acceptance = evidence (documented)
    await controller.play();
    expect(controller.state().phase).toBe("buffering"); // honest: awaiting evidence
    controller.observe({ kind: "started" });
    expect(controller.state().phase).toBe("playing");
  });

  it("stop settles 'stopped' (terminal); commands against it are typed failures", async () => {
    const { controller } = await makeEmbedSession();
    await controller.prepare();
    await controller.play();
    controller.observe({ kind: "progress", positionMs: 12_000 });
    const stop = await controller.stop();
    expect(stop.ok).toBe(true);
    expect(controller.state().phase).toBe("stopped");
    const play = await controller.play();
    expect(play.ok).toBe(false);
    if (!play.ok) expect(play.detail).toContain("terminal");
  });

  it("external handoff cannot be seeked (the OS player owns it)", async () => {
    const web = makeWebCapabilities();
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-ext", { ok: true, value: [realization("external")] });
    const runtime = createRuntime(web, server, session());
    const playbackSession = await runtime.resolvePlayback({ itemId: ITEM_A, externalRef: "ref-ext" });
    const controller = runtime.playback.controller(playbackSession.id)!;
    await controller.prepare();
    await controller.play();
    const seek = await controller.seek(5_000);
    expect(seek.ok).toBe(false);
    if (!seek.ok) {
      expect(seek.kind).toBe("unsupported-capability");
      expect(seek.detail).toContain("external handoff");
    }
  });
});

describe("platform engagement at prepare", () => {
  it("browser mode OPENS the contained surface (cookie-isolated, purpose playback)", async () => {
    const web = makeWebCapabilities();
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-browser", {
      ok: true,
      value: [realization("browser", "https://provider.example/watch/1")],
    });
    const runtime = createRuntime(web, server, session());
    const playbackSession = await runtime.resolvePlayback({
      itemId: ITEM_A,
      externalRef: "ref-browser",
    });
    const controller = runtime.playback.controller(playbackSession.id)!;
    const result = await controller.prepare();
    expect(result.ok).toBe(true);
    const host = web.ports.browserHost as InMemoryBrowserHostPort;
    expect(host.opens).toHaveLength(1);
    expect(host.opens[0]?.restrictCookies).toBe("isolate");
    expect(host.opens[0]?.purpose).toBe("playback");
    expect(host.opens[0]?.url).toBe("https://provider.example/watch/1");
    expect(controller.state().phase).toBe("buffering");
  });

  it("browser mode without a realization URL fails honestly", async () => {
    const web = makeWebCapabilities();
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-browser-nourl", { ok: true, value: [realization("browser")] });
    const runtime = createRuntime(web, server, session());
    const playbackSession = await runtime.resolvePlayback({
      itemId: ITEM_A,
      externalRef: "ref-browser-nourl",
    });
    const controller = runtime.playback.controller(playbackSession.id)!;
    const result = await controller.prepare();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("unsupported-capability");
    expect(controller.state().phase).toBe("failed");
  });

  it("native mode requires the authorized open input (the R10 seam — never invented)", async () => {
    const desktop = makeDesktopCapabilities();
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-native", { ok: true, value: [realization("native")] });
    const runtime = createRuntime(desktop, server, session());
    const playbackSession = await runtime.resolvePlayback({
      itemId: ITEM_A,
      externalRef: "ref-native",
    });
    const controller = runtime.playback.controller(playbackSession.id)!;
    const refused = await controller.prepare();
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.kind).toBe("invalid-input");
      expect(refused.detail).toContain("nativeOpen");
    }
    expect(controller.state().phase).toBe("failed"); // terminal: the honest refusal

    // A fresh session with the authorized open input engages for real.
    const second = await runtime.resolvePlayback({ itemId: ITEM_A, externalRef: "ref-native" });
    const secondController = runtime.playback.controller(second.id)!;
    const accepted = await secondController.prepare({
      nativeOpen: { magnet: "magnet:?xt=urn:btih:authorized" },
    });
    expect(accepted.ok).toBe(true);
    const nativePort = desktop.ports.nativeMedia as InMemoryNativeMediaPort;
    expect(nativePort.opens).toHaveLength(1);
    expect(nativePort.opens[0]?.magnet).toBe("magnet:?xt=urn:btih:authorized");
  });

  it("native sessions derive truthful state from the service event stream", async () => {
    const desktop = makeDesktopCapabilities();
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-native", { ok: true, value: [realization("native")] });
    const runtime = createRuntime(desktop, server, session());
    const playbackSession = await runtime.resolvePlayback({
      itemId: ITEM_A,
      externalRef: "ref-native",
    });
    const controller = runtime.playback.controller(playbackSession.id)!;
    await controller.prepare({ nativeOpen: { localPath: "/media/authorized.mkv" } });
    const nativePort = desktop.ports.nativeMedia as InMemoryNativeMediaPort;
    // The service reports truthful progress…
    nativePort.publish({
      id: "test-native-1",
      assetId: "test-asset-1",
      fileId: "test-file-1",
      state: "playing",
      bufferedMs: 30_000,
      positionMs: 5_000,
      integrity: "unknown",
    });
    expect(controller.state().phase).toBe("playing");
    expect(controller.state().positionMs).toBe(5_000);
    expect(controller.state().bufferedMs).toBe(30_000);
    // …and truthful failure (never fake playing).
    nativePort.publish(
      {
        id: "test-native-1",
        assetId: "test-asset-1",
        fileId: "test-file-1",
        state: "failed",
        bufferedMs: 0,
        positionMs: 5_000,
        integrity: "failed",
      },
      "integrity verification failed",
    );
    expect(controller.state().phase).toBe("failed");
    expect(controller.state().failure?.detail).toContain("integrity verification failed");
  });

  it("ended evidence completes the watch state and stops the session", async () => {
    const { runtime, controller } = await makeEmbedSession();
    await controller.prepare();
    await controller.play();
    controller.observe({ kind: "progress", positionMs: 1_000 });
    controller.observe({ kind: "ended" });
    expect(controller.state().phase).toBe("stopped");
    const watch = runtime.watchState.get(ITEM_A);
    expect(watch?.status).toBe("completed");
    expect(watch?.completionRatio).toBe(1);
  });
});
