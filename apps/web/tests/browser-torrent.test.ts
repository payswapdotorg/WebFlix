/**
 * R23-D browser torrent adapter tests (bun:test).
 *
 * The WebTorrent-backed BROWSER adapter behind the existing
 * TorrentLibrary boundary — deterministic, offline (no swarm, no
 * network):
 *
 * - THE CAPABILITY TRUTH: the Web adapter declares browser torrent
 *   playback through the adapter (`WEB_BROWSER_TORRENT_SUPPORTED`) —
 *   and the R23-C rung decision distinguishes WebTorrent-CAPABLE
 *   (browser rung) from ORDINARY torrent availability (the honest
 *   Desktop next step), never conflating them.
 * - THE ENVIRONMENT PROBE: the WebRTC truth is honest per context (a
 *   server render pass truthfully answers no-WebRTC; the sentence names
 *   the Desktop fallback, never a workaround).
 * - THE HONEST REFUSAL: creating a browser session without WebRTC
 *   answers the typed `LIBRARY_ERROR` browser-incompatible failure —
 *   never a fabricated session, never a silent hang.
 * - THE PARSE SEAM: magnet parsing stays offline + deterministic (the
 *   same pinned parser the production binding documents).
 * - THE AUTHORIZATION GATE: an UNAUTHORIZED peer copy never satisfies a
 *   rung (the R11/R13 law the adapter must not weaken).
 */

import { describe, expect, it } from "bun:test";

import { torrentRungSatisfaction } from "@wfx/client-runtime";

import {
  WEB_BROWSER_TORRENT_IMPLEMENTATION,
  WEB_BROWSER_TORRENT_SUPPORTED,
  browserTorrentEnvironmentSentence,
  createBrowserTorrentLibrary,
  detectBrowserTorrentEnvironment,
} from "../src/platform/browser-torrent";

/** A well-formed 40-hex v1 infohash (offline test vector, no swarm). */
const TEST_INFOHASH = "0123456789abcdef0123456789abcdef01234567";
const TEST_MAGNET = `magnet:?xt=urn:btih:${TEST_INFOHASH}&dn=test-copy`;

/** The web platform truth the R23-E surfaces derive (the adapter's own). */
const WEB_PLATFORM_TRUTH = {
  platform: "web" as const,
  browserTorrentSupported: WEB_BROWSER_TORRENT_SUPPORTED,
};

describe("R23-D — the capability truth (WebTorrent-capable vs ordinary)", () => {
  it("the Web adapter declares browser torrent playback through the adapter (a real adapter path)", () => {
    expect(WEB_BROWSER_TORRENT_SUPPORTED).toBe(true);
    expect(WEB_BROWSER_TORRENT_IMPLEMENTATION).toContain("webtorrent@3.0.21");
    expect(WEB_BROWSER_TORRENT_IMPLEMENTATION).toContain("WebRTC");
  });

  it("an authorized + browser-capable peer copy satisfies the BROWSER rung on Web", () => {
    const satisfaction = torrentRungSatisfaction(WEB_PLATFORM_TRUTH, {
      transport: "torrent",
      authorized: true,
      browserCapable: true,
      accessClass: "public",
    });
    expect(satisfaction.kind).toBe("satisfies-browser-rung");
    if (satisfaction.kind !== "satisfies-browser-rung") return;
    expect(satisfaction.mode).toBe("browser");
  });

  it("an authorized but ORDINARY (WebRTC-incapable) swarm answers the honest Desktop next step", () => {
    const satisfaction = torrentRungSatisfaction(WEB_PLATFORM_TRUTH, {
      transport: "torrent",
      authorized: true,
      browserCapable: false,
      accessClass: "public",
    });
    expect(satisfaction.kind).toBe("desktop-next-step");
    if (satisfaction.kind !== "desktop-next-step") return;
    expect(satisfaction.nextStep.label).toBe("Play this in the Desktop app");
    expect(satisfaction.detail).toContain("cannot reach this swarm's peers");
  });

  it("an UNAUTHORIZED peer copy is never offered (the R11/R13 gate is not weakened)", () => {
    const satisfaction = torrentRungSatisfaction(WEB_PLATFORM_TRUTH, {
      transport: "torrent",
      authorized: false,
      browserCapable: true,
      accessClass: "public",
    });
    expect(satisfaction.kind).toBe("requires-authorization");
    if (satisfaction.kind !== "requires-authorization") return;
    expect(satisfaction.detail).toContain("not authorized");
  });
});

describe("R23-D — the environment probe (honest per context)", () => {
  it("a context without WebRTC answers the honest no (the server render truth)", () => {
    const environment = detectBrowserTorrentEnvironment();
    // The bun test runtime has no RTCPeerConnection — the honest answer.
    expect(environment.webrtc).toBe(false);
    const sentence = browserTorrentEnvironmentSentence(environment);
    expect(sentence).toContain("cannot reach peer copies");
    expect(sentence).toContain("Desktop app");
  });

  it("a WebRTC context answers the wired truth (the browser-side capability)", () => {
    const globals = globalThis as { RTCPeerConnection?: unknown };
    const saved = globals.RTCPeerConnection;
    try {
      globals.RTCPeerConnection = class FakeRTCPeerConnection {};
      const environment = detectBrowserTorrentEnvironment();
      expect(environment.webrtc).toBe(true);
      expect(browserTorrentEnvironmentSentence(environment)).toContain("WebTorrent adapter");
    } finally {
      if (saved === undefined) delete globals.RTCPeerConnection;
      else globals.RTCPeerConnection = saved;
    }
  });
});

describe("R23-D — the honest browser-session refusal + the parse seam", () => {
  it("createSession without WebRTC answers the typed browser-incompatible failure (never a fabricated session)", async () => {
    const library = createBrowserTorrentLibrary();
    const result = await library.createSession({
      dataDir: "/dev/null",
      magnetUri: TEST_MAGNET,
      selectedFileIndexes: [0],
      verifyExistingData: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("LIBRARY_ERROR");
    expect(result.error.message).toContain("browser-incompatible");
    await library.destroy();
  });

  it("magnet parsing stays offline + deterministic (the pinned parser, same as production)", async () => {
    const library = createBrowserTorrentLibrary();
    const parsed = await library.parseMagnet(TEST_MAGNET);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.infoHash).toBe(TEST_INFOHASH);
    expect(parsed.value.displayName).toBe("test-copy");

    const refused = await library.parseMagnet("not-a-magnet");
    expect(refused.ok).toBe(false);
    await library.destroy();
  });

  it("the implementation identity surfaces the wired stack (inspectable, never a silent claim)", async () => {
    const library = createBrowserTorrentLibrary();
    expect(library.implementation).toBe(WEB_BROWSER_TORRENT_IMPLEMENTATION);
    await library.destroy();
  });
});
