/**
 * @wfx/client-runtime — R09 Media Surface resolution seam tests.
 *
 * The precedence, wired end-to-end INSIDE the runtime: an injected
 * `SurfaceResolverSeam` (the adapter's wiring of the frozen resolver)
 * decides playback resolution; the runtime adopts its answer, re-checks it
 * against its own capability truth (incoherent wiring fails LOUDLY), and
 * surfaces the precedence trace on the playback state. The unresolvable
 * channel keeps the runtime's own error law verbatim with the seam's
 * reasons riding along.
 *
 * The EMBED rung's contained engagement: `prepare` on an embed session
 * opens the contained BrowserHostPort surface at the embed URL (contained
 * EXACTLY LIKE THE BROWSER RUNG — the desktop contained webview / the web
 * sandboxed opaque-origin iframe), and the engaged surface rides on the
 * playback state (`containedSurface`).
 *
 * Deterministic: the in-memory doubles, a fixed clock, no network.
 */

import { describe, expect, it } from "bun:test";
import type { PlaybackRealization } from "@wfx/domain";

import {
  FixedClock,
  InMemoryNativeMediaPort,
  InMemoryServerPort,
  RuntimeError,
  SequentialIdGen,
  createRuntime,
  makeWebCapabilities,
  makeDesktopCapabilities,
  type RuntimeSession,
  type SurfaceResolutionOutcome,
  type SurfaceResolverSeam,
} from "../src/index";

const ITEM_A = "wfxitm_00000000000000000000000001";
const T0 = Date.parse("2026-09-16T12:00:00.000Z");

function realization(mode: PlaybackRealization["mode"], url?: string): PlaybackRealization {
  return {
    mode,
    connectorId: "test-source",
    capabilities: [],
    ...(url !== undefined ? { url } : {}),
  };
}

function session(): RuntimeSession {
  return {
    context: { userId: "user-1", sessionId: "sess-1", locale: "en" },
    clock: new FixedClock(T0),
    ids: new SequentialIdGen(),
  };
}

/**
 * The frozen resolver's behavior, reconstructed as an in-test seam double:
 * precedence by PLAYBACK_MODE_PRECEDENCE over the platform's playable modes.
 * This mirrors what the adapter wirings (web/desktop `media-surface.ts`)
 * do over the real frozen `resolveSurface` — the seam contract proven here
 * without an experience dependency (the layering law keeps the runtime
 * dependency-free; the adapters own the real wiring, tested in their lanes).
 */
function seamOver(playable: readonly PlaybackRealization["mode"][]): SurfaceResolverSeam {
  const precedence: readonly PlaybackRealization["mode"][] = [
    "native",
    "embed",
    "browser",
    "external",
  ];
  return {
    resolve(input: {
      readonly itemId: string;
      readonly realizations: readonly PlaybackRealization[];
    }): SurfaceResolutionOutcome {
      const lines: string[] = [];
      let winner: PlaybackRealization | undefined;
      let winnerMode: PlaybackRealization["mode"] | undefined;
      for (const mode of precedence) {
        if (winner !== undefined) {
          lines.push(`${mode}: skipped — precedence satisfied by '${winnerMode}'`);
          continue;
        }
        const found = input.realizations.find((candidate) => candidate.mode === mode);
        if (found === undefined) {
          lines.push(`${mode}: rejected — no ${mode} realization present`);
          continue;
        }
        if (!playable.includes(mode)) {
          lines.push(
            `${mode}: rejected — device cannot realize ${mode} playback (canPlay=false)`,
          );
          continue;
        }
        winner = found;
        winnerMode = mode;
        lines.push(`${mode}: accepted — the seam chose this rung`);
      }
      if (winner !== undefined && winnerMode !== undefined) {
        return {
          ok: true,
          itemId: input.itemId,
          chosen: winner,
          mode: winnerMode,
          precedenceTrace: lines,
        };
      }
      return { ok: false, reasons: ["unresolvable: no playback mode could be realized", ...lines] };
    },
  };
}

describe("R09 — the injected seam decides the precedence", () => {
  it("embed beats browser beats external on a web-truth seam; native named-rejected", async () => {
    const web = makeWebCapabilities();
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-all", {
      ok: true,
      value: [
        realization("browser", "https://provider.example/watch"),
        realization("native"),
        realization("external"),
        realization("embed", "https://provider.example/embed"),
      ],
    });
    const runtime = createRuntime(web, server, session(), {
      surfaceResolver: seamOver(["embed", "browser", "external"]),
    });
    const playbackSession = await runtime.resolvePlayback({
      itemId: ITEM_A,
      externalRef: "ref-all",
    });
    expect(playbackSession.realization.mode).toBe("embed");
    expect(playbackSession.realization.url).toBe("https://provider.example/embed");
    // The answer NAMES what was chosen and why — the trace rides on state.
    const controller = runtime.playback.controller(playbackSession.id);
    const state = controller?.state();
    expect(state?.precedenceTrace).toBeDefined();
    expect(state?.precedenceTrace?.[0]).toContain("native: rejected — device cannot realize");
    expect(state?.precedenceTrace?.[1]).toContain("embed: accepted");
    expect(state?.precedenceTrace?.[2]).toContain("browser: skipped — precedence satisfied by 'embed'");
    expect(state?.precedenceTrace?.[3]).toContain("external: skipped");
  });

  it("native wins on a desktop-truth seam (the R10 engine backing the rung)", async () => {
    const desktop = makeDesktopCapabilities();
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-all", {
      ok: true,
      value: [
        realization("embed", "https://provider.example/embed"),
        realization("native"),
        realization("browser", "https://provider.example/watch"),
      ],
    });
    const runtime = createRuntime(desktop, server, session(), {
      surfaceResolver: seamOver(["native", "embed", "browser", "external"]),
    });
    const playbackSession = await runtime.resolvePlayback({
      itemId: ITEM_A,
      externalRef: "ref-all",
    });
    expect(playbackSession.realization.mode).toBe("native");
    const state = runtime.playback.controller(playbackSession.id)?.state();
    expect(state?.precedenceTrace?.[0]).toContain("native: accepted");
  });

  it("an incoherent seam (chooses a mode the platform cannot realize) fails LOUDLY, typed", async () => {
    const web = makeWebCapabilities();
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-native", {
      ok: true,
      value: [realization("native")],
    });
    const runtime = createRuntime(web, server, session(), {
      // A mis-wired seam whose derived device truth claims native on web:
      surfaceResolver: seamOver(["native", "embed", "browser", "external"]),
    });
    let thrown: unknown;
    try {
      await runtime.resolvePlayback({ itemId: ITEM_A, externalRef: "ref-native" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RuntimeError);
    expect((thrown as RuntimeError).kind).toBe("unsupported-capability");
    expect((thrown as RuntimeError).message).toContain("truthfully cannot realize it");
    expect((thrown as RuntimeError).message).toContain("fix the adapter wiring");
  });

  it("the seam's unresolvable dead end keeps the runtime's error law (capability skips named + reasons ride along)", async () => {
    const web = makeWebCapabilities();
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-native-only", {
      ok: true,
      value: [realization("native")],
    });
    const runtime = createRuntime(web, server, session(), {
      surfaceResolver: seamOver(["embed", "browser", "external"]),
    });
    let thrown: unknown;
    try {
      await runtime.resolvePlayback({ itemId: ITEM_A, externalRef: "ref-native-only" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RuntimeError);
    expect((thrown as RuntimeError).kind).toBe("unsupported-capability");
    // The runtime's own capability-skip law stays verbatim…
    expect((thrown as RuntimeError).message).toContain("nativeMedia: 'none'");
    // …and the seam's reasons ride along (never swallowed).
    expect((thrown as RuntimeError).message).toContain("native: rejected — device cannot realize");
  });

  it("the seam's empty-candidate dead end answers unavailable with the reasons", async () => {
    const web = makeWebCapabilities();
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-empty", { ok: true, value: [] });
    const runtime = createRuntime(web, server, session(), {
      surfaceResolver: seamOver(["embed", "browser", "external"]),
    });
    let thrown: unknown;
    try {
      await runtime.resolvePlayback({ itemId: ITEM_A, externalRef: "ref-empty" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RuntimeError);
    expect((thrown as RuntimeError).kind).toBe("unavailable");
    expect((thrown as RuntimeError).message).toContain("no valid playback realization");
  });

  it("no seam ⇒ the built-in capability-filtered walk (the R01 default, unchanged)", async () => {
    const web = makeWebCapabilities();
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-all", {
      ok: true,
      value: [
        realization("browser", "https://provider.example/watch"),
        realization("native"),
        realization("external"),
        realization("embed", "https://provider.example/embed"),
      ],
    });
    const runtime = createRuntime(web, server, session());
    const playbackSession = await runtime.resolvePlayback({
      itemId: ITEM_A,
      externalRef: "ref-all",
    });
    expect(playbackSession.realization.mode).toBe("embed");
    const state = runtime.playback.controller(playbackSession.id)?.state();
    expect(state?.precedenceTrace).toBeUndefined(); // no seam ⇒ no trace
  });

  it("a malformed seam is refused at runtime construction (typed invalid-input)", () => {
    const web = makeWebCapabilities();
    const server = new InMemoryServerPort();
    expect(() =>
      createRuntime(web, server, session(), {
        surfaceResolver: { resolve: null } as unknown as SurfaceResolverSeam,
      }),
    ).toThrow(RuntimeError);
  });
});

describe("R09 — the EMBED rung's contained engagement (prepare)", () => {
  it("prepare on an embed session opens the CONTAINED surface (isolate + playback) and surfaces it on state", async () => {
    const web = makeWebCapabilities();
    const browserHost = web.ports.browserHost;
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-embed", {
      ok: true,
      value: [realization("embed", "https://provider.example/embed/1")],
    });
    const runtime = createRuntime(web, server, session(), {
      surfaceResolver: seamOver(["embed", "browser", "external"]),
    });
    const playbackSession = await runtime.resolvePlayback({
      itemId: ITEM_A,
      externalRef: "ref-embed",
    });
    const controller = runtime.playback.controller(playbackSession.id);
    const prepared = await controller?.prepare();
    expect(prepared?.ok).toBe(true);
    // The contained surface was opened EXACTLY like the browser rung:
    // cookie-isolated, playback purpose, at the embed URL.
    expect(browserHost.opens).toHaveLength(1);
    expect(browserHost.opens[0]?.restrictCookies).toBe("isolate");
    expect(browserHost.opens[0]?.purpose).toBe("playback");
    expect(browserHost.opens[0]?.url).toBe("https://provider.example/embed/1");
    // The engaged surface rides on the state (session-scoped).
    const state = controller?.state();
    expect(state?.containedSurface).toBeDefined();
    expect(state?.containedSurface?.url).toBe("https://provider.example/embed/1");
    expect(state?.phase).toBe("buffering");
  });

  it("prepare on an embed session WITHOUT a URL stays adapter-owned (honest readiness, no contained open)", async () => {
    const web = makeWebCapabilities();
    const browserHost = web.ports.browserHost;
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-embed-nourl", {
      ok: true,
      value: [realization("embed")],
    });
    const runtime = createRuntime(web, server, session(), {
      surfaceResolver: seamOver(["embed", "browser", "external"]),
    });
    const playbackSession = await runtime.resolvePlayback({
      itemId: ITEM_A,
      externalRef: "ref-embed-nourl",
    });
    const controller = runtime.playback.controller(playbackSession.id);
    const prepared = await controller?.prepare();
    expect(prepared?.ok).toBe(true);
    expect(browserHost.opens).toHaveLength(0); // nothing contained — adapter renders
    expect(controller?.state().containedSurface).toBeUndefined();
  });

  it("a platform WITHOUT a contained host keeps embed adapter-owned (the honest readiness signal)", async () => {
    // A TV-style platform truth: no contained browser host (capability
    // truth holds — declared "none", port absent), native engine present.
    const desktop = makeDesktopCapabilities();
    const tv = {
      platform: "desktop" as const,
      storage: "filesystem" as const,
      browserHost: "none" as const,
      nativeMedia: "native-service" as const,
      backgroundWork: "none" as const,
      sharing: false,
      notifications: false,
      descriptor: desktop.descriptor,
      ports: {
        lifecycle: desktop.ports.lifecycle,
        storage: desktop.ports.storage,
        browserHost: null,
        nativeMedia: desktop.ports.nativeMedia,
        notifications: null,
        backgroundWork: null,
        sharing: null,
      },
    };
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-embed", {
      ok: true,
      value: [realization("embed", "https://provider.example/embed/2")],
    });
    const runtime = createRuntime(tv, server, session(), {
      surfaceResolver: seamOver(["native", "embed", "external"]),
    });
    const playbackSession = await runtime.resolvePlayback({
      itemId: ITEM_A,
      externalRef: "ref-embed",
    });
    const controller = runtime.playback.controller(playbackSession.id);
    const prepared = await controller?.prepare();
    expect(prepared?.ok).toBe(true);
    expect(controller?.state().containedSurface).toBeUndefined();
  });

  it("browser rung engagement surfaces its contained session too (the shared discipline)", async () => {
    const web = makeWebCapabilities();
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-browser", {
      ok: true,
      value: [realization("browser", "https://provider.example/watch/1")],
    });
    const runtime = createRuntime(web, server, session(), {
      surfaceResolver: seamOver(["embed", "browser", "external"]),
    });
    const playbackSession = await runtime.resolvePlayback({
      itemId: ITEM_A,
      externalRef: "ref-browser",
    });
    const controller = runtime.playback.controller(playbackSession.id);
    await controller?.prepare();
    const state = controller?.state();
    expect(state?.containedSurface?.url).toBe("https://provider.example/watch/1");
  });

  it("stopping a contained embed session clears the engaged surface (honest teardown)", async () => {
    const web = makeWebCapabilities();
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-embed", {
      ok: true,
      value: [realization("embed", "https://provider.example/embed/3")],
    });
    const runtime = createRuntime(web, server, session(), {
      surfaceResolver: seamOver(["embed", "browser", "external"]),
    });
    const playbackSession = await runtime.resolvePlayback({
      itemId: ITEM_A,
      externalRef: "ref-embed",
    });
    const controller = runtime.playback.controller(playbackSession.id);
    await controller?.prepare();
    await controller?.stop();
    const state = controller?.state();
    expect(state?.phase).toBe("stopped");
    expect(state?.containedSurface).toBeUndefined();
  });
});

describe("R09 — the seam across native/external rungs", () => {
  it("native sessions prepare through the NativeMediaPort and carry the trace (R10 binding engaged)", async () => {
    const desktop = makeDesktopCapabilities();
    const nativePort = desktop.ports.nativeMedia as InMemoryNativeMediaPort;
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-native", {
      ok: true,
      value: [realization("native")],
    });
    const runtime = createRuntime(desktop, server, session(), {
      surfaceResolver: seamOver(["native", "embed", "browser", "external"]),
    });
    const playbackSession = await runtime.resolvePlayback({
      itemId: ITEM_A,
      externalRef: "ref-native",
    });
    const controller = runtime.playback.controller(playbackSession.id);
    const prepared = await controller?.prepare({ nativeOpen: { magnet: "magnet:?xt=urn:btih:x" } });
    expect(prepared?.ok).toBe(true);
    expect(nativePort.opens).toHaveLength(1);
    const state = controller?.state();
    expect(state?.precedenceTrace?.[0]).toContain("native: accepted");
    expect(state?.containedSurface).toBeUndefined(); // native has no contained surface
  });

  it("external sessions resolve + prepare as the honest handoff (no contained surface, no fake stage)", async () => {
    const web = makeWebCapabilities();
    const browserHost = web.ports.browserHost;
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-external", {
      ok: true,
      value: [realization("external", "https://provider.example/open")],
    });
    const runtime = createRuntime(web, server, session(), {
      surfaceResolver: seamOver(["embed", "browser", "external"]),
    });
    const playbackSession = await runtime.resolvePlayback({
      itemId: ITEM_A,
      externalRef: "ref-external",
    });
    expect(playbackSession.realization.mode).toBe("external");
    const controller = runtime.playback.controller(playbackSession.id);
    const prepared = await controller?.prepare();
    expect(prepared?.ok).toBe(true);
    expect(browserHost.opens).toHaveLength(0); // the handoff opens nothing here
    const state = controller?.state();
    expect(state?.containedSurface).toBeUndefined();
    expect(state?.precedenceTrace?.[3]).toContain("external: accepted");
    // External handoff cannot be seeked (the OS player owns it).
    if (controller === undefined) throw new Error("the controller vanished");
    const seek = await controller.seek(1_000);
    expect(seek.ok).toBe(false);
    if (!seek.ok) expect(seek.kind).toBe("unsupported-capability");
  });
});
