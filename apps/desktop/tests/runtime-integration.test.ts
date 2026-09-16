/**
 * R08 — runtime integration tests (the booted desktop app over doubles).
 *
 * The composition root proven end-to-end, deterministically: the boot
 * truth-check, navigation over the shared runtime, NATIVE playback over
 * the simulated engine process (the R10 seam engaged through
 * `prepare({ nativeOpen })`), BROWSER playback over the contained surface,
 * the cross-adapter capability gate (Desktop CAN native; Web honestly
 * cannot), and the SHUTDOWN FLUSH (the at-least-once outbox drained by
 * the lifecycle hook before the shell exits).
 */

import { describe, expect, it } from "bun:test";

import {
  createRuntime,
  makeWebCapabilities,
  RuntimeError,
  SequentialIdGen,
  FixedClock,
} from "@wfx/client-runtime";
import type { PlaybackRealization } from "@wfx/domain";
import type { PlaybackState } from "@wfx/client-runtime";

import { SimEngineProcess, SimShell } from "./shell-simulator";
import { createDesktopApp } from "../src/main";
import { createDesktopServerPort } from "../src/platform/server-port";

const ITEM_ID = "wfxitm_0000000000000000000000ABCD";
const MAGNET = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=authorized";
const BASE = new URL("https://experience.webflix.invalid/api");
const CONTEXT = {
  userId: "wfx-desktop-user",
  sessionId: "wfx-desktop-session",
  locale: "en",
};

const NATIVE_REALIZATION: PlaybackRealization = {
  mode: "native",
  connectorId: "wfx-experience-service",
  capabilities: ["playNative"],
};

const BROWSER_REALIZATION: PlaybackRealization = {
  mode: "browser",
  connectorId: "wfx-experience-service",
  url: "https://provider.example/watch/1",
  capabilities: ["playBrowser"],
};

/** The scriptable stub fetch (deterministic, offline). */
class StubFetch {
  readonly requests: { method: string; url: string; body: string | undefined }[] = [];
  private scripted: { readonly match: (url: string) => boolean; readonly respond: () => Response }[] = [];

  script(match: (url: string) => boolean, respond: () => Response): void {
    this.scripted.push({ match, respond });
  }

  fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    this.requests.push({ method: init?.method ?? "GET", url, body: init?.body as string | undefined });
    for (const entry of this.scripted) {
      if (entry.match(url)) return Promise.resolve(entry.respond());
    }
    return Promise.reject(new TypeError("stub fetch: no scripted response (offline)"));
  };

  eventsRequests(): { method: string; url: string; body: string | undefined }[] {
    return this.requests.filter((request) => request.url.includes("/experience/events"));
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function bootApp(overrides: { eventsStatus?: number[] } = {}) {
  const shell = new SimShell();
  const engineProcess = new SimEngineProcess();
  const stub = new StubFetch();
  const eventsStatusQueue = [...(overrides.eventsStatus ?? [])];
  stub.script(
    (url) => url.includes("/experience/events"),
    () => {
      const status = eventsStatusQueue.length > 0 ? eventsStatusQueue.shift() : 200;
      return jsonResponse({ accepted: true }, status);
    },
  );
  const clock = new FixedClock(1_728_000_000_000);
  const ids = new SequentialIdGen();
  const app = createDesktopApp({
    shell,
    server: createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch }),
    session: { context: CONTEXT, clock, ids },
    engine: {
      config: { cacheDir: "/sim/app-data/wfx-desktop/engine-cache", maxCacheBytes: 64 * 1024 * 1024 },
      process: engineProcess,
    },
  });
  return { app, shell, stub, engineProcess, clock, ids };
}

describe("R08 — the booted desktop app (boot truth + navigation)", () => {
  it("boots the shared runtime on the truthful desktop bundle", () => {
    const { app } = bootApp();
    expect(app.platform).toBe("desktop");
    expect(app.runtime.platform).toBe("desktop");
    expect(app.capabilities.nativeMedia).toBe("native-service");
    // The surface projection tells the descriptor's truth:
    const summary = app.surface.capabilitySummary();
    expect(summary.torrentAcquisition).toBe(true);
    expect(summary.nativePlayback).toBe(true);
    expect(summary.containedBrowser).toBe(true);
    expect(summary.backgroundWork).toBe("full");
    expect(summary.storage).toBe("filesystem");
    expect(summary.adapterId).toBe("wfx-desktop-adapter");
    app.dispose();
  });

  it("the shell's ready event moves the lifecycle to active", () => {
    const { app, shell } = bootApp();
    expect(app.lifecycle.phase()).toBe("initializing");
    shell.emitLifecycle("ready");
    expect(app.lifecycle.phase()).toBe("active");
    app.dispose();
  });

  it("navigation runs on the shared runtime (no adapter product logic)", () => {
    const { app } = bootApp();
    const navigation = app.runtime.navigation;
    expect(navigation.current()).toEqual({ surface: "home" });
    const toWatch = navigation.navigate({ surface: "watch" });
    expect(toWatch.ok).toBe(true);
    const toSearch = navigation.navigate({ surface: "search", query: "signal" });
    expect(toSearch.ok).toBe(true);
    expect(navigation.current()).toEqual({ surface: "search", query: "signal" });
    const back = navigation.back();
    expect(back.ok).toBe(true);
    expect(navigation.current()).toEqual({ surface: "watch" });
    app.dispose();
  });

  it("a malformed session bundle is rejected by the runtime (typed, named)", () => {
    let thrown: unknown;
    try {
      createDesktopApp({
        shell: new SimShell(),
        server: createDesktopServerPort({
          apiBase: BASE,
          context: CONTEXT,
          fetchImpl: new StubFetch().fetch,
        }),
        session: {
          context: { userId: "", sessionId: "s", locale: "en" },
          clock: new FixedClock(0),
          ids: new SequentialIdGen(),
        },
        engine: {
          config: { cacheDir: "/sim/app-data/cache", maxCacheBytes: 1024 },
          process: new SimEngineProcess(),
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown instanceof RuntimeError).toBe(true);
    expect((thrown as RuntimeError).kind).toBe("invalid-input");
    expect((thrown as RuntimeError).message).toContain("session.context.userId");
  });
});

describe("R08 — NATIVE playback over the simulated engine (the R10 seam engaged)", () => {
  it("resolve → prepare(nativeOpen) → play → engine evidence → pause → seek → stop", async () => {
    const { app, engineProcess, stub } = bootApp();
    const session = await app.runtime.resolvePlayback({
      itemId: ITEM_ID,
      realization: NATIVE_REALIZATION,
    });
    expect(session.realization.mode).toBe("native");
    const controller = app.runtime.playback.controller(session.id);
    if (controller === undefined) throw new Error("the controller was not registered");

    // Engage the R10 seam: the caller's authorized nativeOpen.
    const prepared = await controller.prepare({ nativeOpen: { magnet: MAGNET } });
    expect(prepared.ok).toBe(true);
    const engineCommands = engineProcess.lastSide?.commands ?? [];
    expect(engineCommands[0]?.kind).toBe("open");
    const opened = await app.engine.inspect("sim-session-1");
    expect(opened.state).toBe("buffering");

    // Play: the resume command crosses the seam; the runtime awaits evidence.
    const played = await controller.play();
    expect(played.ok).toBe(true);
    expect(controller.state().phase).toBe("buffering"); // truthful: no evidence yet

    // The engine reports playing — the controller adopts the ENGINE's numbers.
    engineProcess.lastHandle?.emitStateChanged({
      ...opened,
      state: "playing",
      bufferedMs: 120_000,
      positionMs: 30_000,
    });
    const playingState = controller.state();
    expect(playingState.phase).toBe("playing");
    expect(playingState.positionMs).toBe(30_000); // engine-sourced, never a ticker
    expect(playingState.bufferedMs).toBe(120_000);

    // Pause crosses to the engine.
    const paused = await controller.pause();
    expect(paused.ok).toBe(true);
    expect(controller.state().phase).toBe("paused");

    // Seek: acceptance is position evidence; the engine got the command.
    const sought = await controller.seek(60_000);
    expect(sought.ok).toBe(true);
    expect(controller.state().positionMs).toBe(60_000);
    expect(engineProcess.lastSide?.commands.some((command) => command.kind === "seek")).toBe(true);

    // Stop: the engine session closes; the start watch event was delivered.
    const stopped = await controller.stop();
    expect(stopped.ok).toBe(true);
    expect(controller.state().phase).toBe("stopped");
    expect(engineProcess.lastSide?.commands.some((command) => command.kind === "close")).toBe(true);
    expect(app.runtime.watchState.pendingEventCount()).toBe(0); // at-least-once: delivered
    const eventPosts = stub.eventsRequests();
    expect(eventPosts.length).toBeGreaterThanOrEqual(1);
    expect(eventPosts[0]?.body).toContain("\"start\"");
    app.dispose();
  });

  it("prepare without nativeOpen is the typed invalid-input failure (the seam is never invented)", async () => {
    const { app } = bootApp();
    const session = await app.runtime.resolvePlayback({
      itemId: ITEM_ID,
      realization: NATIVE_REALIZATION,
    });
    const controller = app.runtime.playback.controller(session.id);
    if (controller === undefined) throw new Error("no controller");
    const prepared = await controller.prepare();
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.kind).toBe("invalid-input");
      expect(prepared.detail).toContain("nativeOpen");
    }
    expect(controller.state().phase).toBe("failed");
    app.dispose();
  });

  it("a failed engine session surfaces as the controller's failed phase (honest, with detail)", async () => {
    const { app, engineProcess } = bootApp();
    const session = await app.runtime.resolvePlayback({
      itemId: ITEM_ID,
      realization: NATIVE_REALIZATION,
    });
    const controller = app.runtime.playback.controller(session.id);
    if (controller === undefined) throw new Error("no controller");
    await controller.prepare({ nativeOpen: { magnet: MAGNET } });
    engineProcess.lastHandle?.emitStateChanged({
      id: "sim-session-1",
      assetId: "sim-asset-1",
      fileId: "sim-file-1",
      state: "failed",
      bufferedMs: 0,
      positionMs: 0,
    });
    const state = controller.state();
    expect(state.phase).toBe("failed");
    expect(state.failure?.detail).toContain("native media session failed");
    app.dispose();
  });
});

describe("R08 — BROWSER playback over the contained surface", () => {
  it("prepare opens the isolated provider surface; closing it stops the session honestly", async () => {
    const { app, shell } = bootApp();
    const session = await app.runtime.resolvePlayback({
      itemId: ITEM_ID,
      realization: BROWSER_REALIZATION,
    });
    const controller = app.runtime.playback.controller(session.id);
    if (controller === undefined) throw new Error("no controller");
    const prepared = await controller.prepare();
    expect(prepared.ok).toBe(true);
    expect(controller.state().phase).toBe("buffering");

    // The shell opened ONE isolated surface at the provider URL:
    const surfaceId = "sim-surface-1";
    expect(shell.surfaceCookieJar(surfaceId)).toBeDefined();

    // The user closes the provider surface: the runtime records an honest stop.
    await shell.surfaceClose(surfaceId);
    expect(controller.state().phase).toBe("stopped");
    app.dispose();
  });

  it("a browser realization without a URL resolves, then prepare fails honestly (unsupported-capability)", async () => {
    const { app } = bootApp();
    const urlless: PlaybackRealization = {
      mode: "browser",
      connectorId: BROWSER_REALIZATION.connectorId,
      capabilities: BROWSER_REALIZATION.capabilities,
    };
    const session = await app.runtime.resolvePlayback({
      itemId: ITEM_ID,
      realization: urlless,
    });
    const controller = app.runtime.playback.controller(session.id);
    if (controller === undefined) throw new Error("no controller");
    const prepared = await controller.prepare();
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.kind).toBe("unsupported-capability");
      expect(prepared.detail).toContain("requires a contained BrowserHostPort and a realization URL");
    }
    app.dispose();
  });
});

describe("R08 — the cross-adapter capability gate", () => {
  it("Desktop resolves the native realization; Web honestly cannot (unsupported-capability, named)", async () => {
    const { app } = bootApp();
    const desktopSession = await app.runtime.resolvePlayback({
      itemId: ITEM_ID,
      realization: NATIVE_REALIZATION,
    });
    expect(desktopSession.realization.mode).toBe("native");
    app.dispose();

    // The WEB bundle over the same transport: native is truthfully absent.
    const stub = new StubFetch();
    const web = createRuntime(
      makeWebCapabilities(),
      createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch }),
      {
        context: CONTEXT,
        clock: new FixedClock(0),
        ids: new SequentialIdGen(),
      },
    );
    const thrown = await web
      .resolvePlayback({ itemId: ITEM_ID, realization: NATIVE_REALIZATION })
      .catch((error: unknown) => error);
    expect(thrown instanceof RuntimeError).toBe(true);
    const error = thrown as RuntimeError;
    expect(error.kind).toBe("unsupported-capability");
    expect(error.message).toContain("platform 'web' truthfully cannot realize 'native' playback");
    expect(error.message).toContain("nativeMedia: 'none'");
  });

  it("the web bundle still resolves browser realizations (parity where truthful)", async () => {
    const stub = new StubFetch();
    const web = createRuntime(
      makeWebCapabilities(),
      createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch }),
      {
        context: CONTEXT,
        clock: new FixedClock(0),
        ids: new SequentialIdGen(),
      },
    );
    const session = await web.resolvePlayback({
      itemId: ITEM_ID,
      realization: BROWSER_REALIZATION,
    });
    expect(session.realization.mode).toBe("browser");
  });
});

describe("R08 — the shutdown flush (the at-least-once outbox before exit)", () => {
  it("a failed watch-event delivery stays pending; the lifecycle shutdown drain flushes it", async () => {
    // The events endpoint fails ONCE (HTTP 503), then accepts.
    const { app, shell, stub } = bootApp({ eventsStatus: [503] });
    shell.emitLifecycle("ready");

    // The delivery failure THROWS (the EventSink law) and stays pending:
    const thrown = await app.runtime
      .updateWatchState({ kind: "start", itemId: ITEM_ID, positionMs: 0 })
      .catch((error: unknown) => error);
    expect(thrown instanceof RuntimeError).toBe(true);
    expect(app.runtime.watchState.pendingEventCount()).toBe(1);

    // The window closes: the shell emits shutdown, the lifecycle port
    // drains the runtime's flush hook (at-least-once retry), then releases.
    const shutdownWait = shell.requestShutdown();
    await app.lifecycle.shutdownSettled();
    await shutdownWait;

    // The outbox drained — the event was redelivered and accepted:
    expect(app.runtime.watchState.pendingEventCount()).toBe(0);
    const eventPosts = stub.eventsRequests();
    expect(eventPosts.length).toBe(2); // failed attempt + flushed retry
    expect(shell.shutdownCompleted).toBe(true);
    expect(app.lifecycle.phase()).toBe("shutdown");
    app.dispose();
  });
});

describe("R08 — the desktop surface projection", () => {
  it("activePlayback mirrors the runtime's truthful playback states", async () => {
    const { app, engineProcess } = bootApp();
    const session = await app.runtime.resolvePlayback({
      itemId: ITEM_ID,
      realization: NATIVE_REALIZATION,
    });
    const controller = app.runtime.playback.controller(session.id);
    if (controller === undefined) throw new Error("no controller");
    await controller.prepare({ nativeOpen: { magnet: MAGNET } });
    engineProcess.lastHandle?.emitStateChanged({
      id: "sim-session-1",
      assetId: "sim-asset-1",
      fileId: "sim-file-1",
      state: "playing",
      bufferedMs: 90_000,
      positionMs: 10_000,
    });
    const active: readonly PlaybackState[] = app.surface.activePlayback();
    expect(active).toHaveLength(1);
    expect(active[0]?.phase).toBe("playing");
    expect(active[0]?.positionMs).toBe(10_000);
    const observed: PlaybackState[] = [];
    app.surface.observePlayback(session.id, (state) => observed.push(state));
    await controller.pause();
    expect(observed.length).toBeGreaterThanOrEqual(1);
    expect(observed[observed.length - 1]?.phase).toBe("paused");
    expect(app.surface.playbackState(session.id)?.phase).toBe("paused");
    app.dispose();
  });
});
