/**
 * R09 desktop media-surface tests (bun:test).
 *
 * The precedence wired END-TO-END on the booted desktop app (the real
 * composition root over the SimShell + simulated engine, deterministic, no
 * network):
 *
 * - THE RESOLVER WIRING: the frozen resolver (through the injected seam)
 *   decides playback resolution on the Desktop's truthful device derivation
 *   — NATIVE included (the R10 engine binding backs the rung); native >
 *   embed > browser > external; the precedence trace surfaced on the
 *   playback state (the answer NAMES what was chosen and why).
 * - THE EMBED RUNG: the desktop embed runs in the BrowserHost's CONTAINED
 *   WEBVIEW — `prepare` on an embed session opens the shell surface at the
 *   embed URL under the isolation contract (per-session cookie jar).
 * - THE HOSTS: the desktop BrowserHost's productionized session lifecycle
 *   (open/navigate/close round-trips over the shell double; the session
 *   enumeration; the honest capability truth).
 * - J08/J09 parity notes: the desktop contained surface is the full-power
 *   reference (unconstrained); the external rung's return context seed is
 *   the adapter-side continuation identity.
 */

import { describe, expect, it } from "bun:test";

import type { PlaybackRealization } from "@wfx/domain";

import { SimEngineProcess, SimShell } from "./shell-simulator";
import { createDesktopApp } from "../src/main";
import { createDesktopServerPort } from "../src/platform/server-port";
import {
  createShellBrowserHostPort,
  desktopSurfaceCapabilityTruth,
} from "../src/platform/browser-host";
import { desktopDeviceCapabilities } from "../src/platform/media-surface";

const ITEM_ID = "wfxitm_0000000000000000000000ABCD";
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

const EMBED_REALIZATION: PlaybackRealization = {
  mode: "embed",
  connectorId: "wfx-experience-service",
  url: "https://provider.example/embed/1",
  capabilities: ["playEmbed"],
};

const BROWSER_REALIZATION: PlaybackRealization = {
  mode: "browser",
  connectorId: "wfx-experience-service",
  url: "https://provider.example/watch/1",
  capabilities: ["playBrowser"],
};

const EXTERNAL_REALIZATION: PlaybackRealization = {
  mode: "external",
  connectorId: "wfx-experience-service",
  url: "https://provider.example/open/1",
  capabilities: ["playExternal"],
};

/** The scriptable stub fetch (deterministic, offline). */
class StubFetch {
  readonly requests: { method: string; url: string }[] = [];
  private scripted: { readonly match: (url: string) => boolean; readonly respond: () => Response }[] = [];

  script(match: (url: string) => boolean, respond: () => Response): void {
    this.scripted.push({ match, respond });
  }

  fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    this.requests.push({ method: init?.method ?? "GET", url });
    for (const entry of this.scripted) {
      if (entry.match(url)) return Promise.resolve(entry.respond());
    }
    return Promise.reject(new TypeError("stub fetch: no scripted response (offline)"));
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

/** Boot the desktop app with the resolve endpoint scripted to one set. */
function bootApp(realizations: readonly PlaybackRealization[]) {
  const shell = new SimShell();
  const stub = new StubFetch();
  stub.script(
    (url) => url.includes("/experience/resolve"),
    () => jsonResponse([...realizations]),
  );
  stub.script(
    (url) => url.includes("/experience/events"),
    () => jsonResponse({ accepted: true }),
  );
  const clock = { now: () => 1_728_000_000_000 };
  const ids = { next: () => "000000000000000000000000" };
  const app = createDesktopApp({
    shell,
    server: createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch }),
    session: { context: CONTEXT, clock, ids },
    engine: {
      config: { cacheDir: "/sim/app-data/wfx-desktop/engine-cache", maxCacheBytes: 64 * 1024 * 1024 },
      process: new SimEngineProcess(),
    },
  });
  return { app, shell };
}

// ---------------------------------------------------------------------------
// The resolver wiring (the truthful desktop device derivation)
// ---------------------------------------------------------------------------

describe("R09 desktop — the resolver wiring's truthful device derivation", () => {
  it("derives the FULL reference set: native included (the R10 engine backs the rung)", () => {
    const device = desktopDeviceCapabilities({
      nativeMedia: "native-service",
      browserHost: "contained",
      backgroundWork: "full",
    });
    expect(device.playbackModes).toEqual(["native", "embed", "browser", "external"]);
    expect(device.browser).toBe(true);
    expect(device.backgroundPlayback).toBe(true);
    // The WFX-002 reference codec set (the native codec-demand gate's side).
    expect(device.codecs).toContain("hevc");
    expect(device.codecs).toContain("av1");
  });
});

// ---------------------------------------------------------------------------
// The precedence wired end-to-end (the booted desktop app)
// ---------------------------------------------------------------------------

describe("R09 desktop — the precedence wired end-to-end (the booted app)", () => {
  it("native wins when truthfully available (the R10 engine binding backs the rung)", async () => {
    const { app } = bootApp([BROWSER_REALIZATION, NATIVE_REALIZATION, EMBED_REALIZATION]);
    const session = await app.runtime.resolvePlayback({ itemId: ITEM_ID, externalRef: "ref-all" });
    expect(session.realization.mode).toBe("native");
    const state = app.runtime.playback.controller(session.id)?.state();
    expect(state?.precedenceTrace?.[0]).toContain("native: accepted");
    expect(state?.precedenceTrace?.[1]).toContain("embed: skipped — precedence satisfied by 'native'");
  });

  it("embed wins when native is honestly absent — and the rungs are NAMED", async () => {
    const { app } = bootApp([EMBED_REALIZATION, BROWSER_REALIZATION, EXTERNAL_REALIZATION]);
    const session = await app.runtime.resolvePlayback({ itemId: ITEM_ID, externalRef: "ref-no-native" });
    expect(session.realization.mode).toBe("embed");
    const state = app.runtime.playback.controller(session.id)?.state();
    expect(state?.precedenceTrace?.[0]).toContain("native: rejected — no native realization present");
    expect(state?.precedenceTrace?.[1]).toContain("embed: accepted");
  });

  it("browser wins when native+embed are honestly absent; external is the last resort (J09 parity)", async () => {
    const { app } = bootApp([BROWSER_REALIZATION, EXTERNAL_REALIZATION]);
    const session = await app.runtime.resolvePlayback({ itemId: ITEM_ID, externalRef: "ref-browser-external" });
    expect(session.realization.mode).toBe("browser");

    const second = bootApp([EXTERNAL_REALIZATION]);
    const externalSession = await second.app.runtime.resolvePlayback({
      itemId: ITEM_ID,
      externalRef: "ref-external-only",
    });
    expect(externalSession.realization.mode).toBe("external");
    const state = second.app.runtime.playback.controller(externalSession.id)?.state();
    expect(state?.precedenceTrace?.[3]).toContain("external: accepted");
  });

  it("an undecodable native demand is honestly rejected and NAMED (the codec gate)", async () => {
    const demanding: PlaybackRealization = {
      mode: "native",
      connectorId: "wfx-experience-service",
      capabilities: ["playNative", "vvc"], // no desktop reference codec decodes vvc
    };
    const { app } = bootApp([demanding, BROWSER_REALIZATION]);
    const session = await app.runtime.resolvePlayback({ itemId: ITEM_ID, externalRef: "ref-vvc" });
    // The codec gate rejects the native rung; the fallback chain answers.
    expect(session.realization.mode).toBe("browser");
    const state = app.runtime.playback.controller(session.id)?.state();
    expect(state?.precedenceTrace?.[0]).toContain("native: rejected — no decodable native realization");
    expect(state?.precedenceTrace?.[0]).toContain("vvc");
  });
});

// ---------------------------------------------------------------------------
// The EMBED rung — the contained native webview
// ---------------------------------------------------------------------------

describe("R09 desktop — the EMBED rung runs in the BrowserHost's contained webview", () => {
  it("prepare on an embed session opens the shell surface at the embed URL (isolate contract)", async () => {
    const { app, shell } = bootApp([EMBED_REALIZATION]);
    const session = await app.runtime.resolvePlayback({ itemId: ITEM_ID, externalRef: "ref-embed" });
    const controller = app.runtime.playback.controller(session.id);
    const prepared = await controller?.prepare();
    expect(prepared?.ok).toBe(true);
    // The contained webview opened at the provider's embed URL.
    expect(shell.surfaceCookieJar("sim-surface-1")).toBeDefined();
    const state = controller?.state();
    expect(state?.containedSurface).toBeDefined();
    expect(state?.containedSurface?.url).toBe("https://provider.example/embed/1");
    expect(state?.phase).toBe("buffering");
    // The embed session has its OWN cookie jar (per-session isolation).
    expect(shell.surfaceCookieJar("sim-surface-1") instanceof Map).toBe(true);
  });

  it("a subsequent browser session mints a SECOND isolated webview (multi-session isolation)", async () => {
    const { app, shell } = bootApp([EMBED_REALIZATION]);
    const first = await app.runtime.resolvePlayback({ itemId: ITEM_ID, externalRef: "ref-embed" });
    await app.runtime.playback.controller(first.id)?.prepare();

    const second = await app.runtime.resolvePlayback({ itemId: ITEM_ID, externalRef: "ref-embed" });
    await app.runtime.playback.controller(second.id)?.prepare();

    // Two distinct contained surfaces, each with its own cookie jar.
    expect(shell.surfaceCookieJar("sim-surface-1")).toBeDefined();
    expect(shell.surfaceCookieJar("sim-surface-2")).toBeDefined();
    expect(shell.surfaceCookieJar("sim-surface-1")).not.toBe(shell.surfaceCookieJar("sim-surface-2"));
  });
});

// ---------------------------------------------------------------------------
// The desktop BrowserHost's productionized session lifecycle (over SimShell)
// ---------------------------------------------------------------------------

describe("R09 desktop — the BrowserHost's productionized session lifecycle", () => {
  it("sessions() enumerates open surfaces; navigate updates; close removes (round-trip)", async () => {
    const shell = new SimShell();
    const host = createShellBrowserHostPort(shell);
    expect(host.sessions()).toEqual([]);

    const first = await host.open({
      url: "https://provider.example/a",
      restrictCookies: "isolate",
      purpose: "playback",
    });
    const second = await host.open({
      url: "https://provider.example/b",
      restrictCookies: "isolate",
      purpose: "authorization",
    });
    expect(host.sessions()).toHaveLength(2);
    expect(host.sessions().map((entry) => entry.id)).toEqual([first.id, second.id]);

    // The observed navigation updates the enumeration (never steered).
    await first.navigate("https://provider.example/a/deep");
    expect(host.sessions()[0]!.url).toBe("https://provider.example/a/deep");

    await second.close();
    expect(host.sessions()).toHaveLength(1);
    expect(host.sessions()[0]!.id).toBe(first.id);

    // A shell-side close (the user closed the webview) removes it too.
    await shell.surfaceClose(first.id);
    expect(host.sessions()).toEqual([]);
  });

  it("the honest capability truth: the full-power reference realization (J08 unconstrained)", () => {
    const host = createShellBrowserHostPort(new SimShell());
    const truth = host.surfaceCapabilityTruth();
    expect(truth).toEqual(desktopSurfaceCapabilityTruth());
    expect(truth.mount).toBe("native-webview");
    expect(truth.cookieIsolation).toBe("per-session-data-directory");
    expect(truth.navigationObservation).toBe("shell-reported");
    expect(truth.constrained).toBe(false);
    expect(truth.constraint).toContain("full-power reference");
  });

  it("the security boundary holds: non-isolate requests refused before the shell (the law of the file)", async () => {
    const shell = new SimShell();
    const host = createShellBrowserHostPort(shell);
    const smuggled = {
      url: "https://provider.example/",
      restrictCookies: "shared",
      purpose: "general",
    } as unknown as Parameters<typeof host.open>[0];
    await expect(host.open(smuggled)).rejects.toMatchObject({ code: "invalid-session" });
    expect(host.sessions()).toEqual([]);
  });
});
