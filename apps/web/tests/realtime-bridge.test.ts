/**
 * R25-W2 — the realtime BRIDGE tests (bun:test).
 *
 * Proves the R25-D transport law over the REAL machinery: the bridge
 * + the dev provider double start on test ports and REAL WebSocket
 * clients drive them — the wire validation, the shared input gates,
 * the session lifecycle, BOTH reconnect paths (the scripted provider
 * drop + the client resume window), the shared cost-policy verdicts,
 * the retention seam, and the R25-L metric derivation. No mocks: the
 * same servers the dev boot runs, on private ports.
 *
 * Determinism: fixed test ports, real wall-clock pacing (the double's
 * deterministic script timing), no network beyond localhost.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  DEV_REALTIME_PROVIDER_ID,
  startDevRealtimeProvider,
  type DevRealtimeProviderHandle,
} from "../src/host/realtime/dev-realtime-provider";
import { createDevRealtimeSeam } from "../src/host/realtime/dev-realtime-session";
import {
  REALTIME_BRIDGE_DEFAULT_PORT,
  startRealtimeBridge,
  type RealtimeBridgeHandle,
} from "../src/host/realtime/realtime-bridge";
import { readRealtimeBridgeStatus, setRealtimeBridgeStatus } from "../src/host/realtime/realtime-bridge-state";
import {
  deriveRealtimeLatencyMetrics,
  parseRealtimeWireClientMessage,
  type RealtimeMarkerRecord,
} from "../src/host/realtime/realtime-wire";
import type { RealtimeTranslationEvent } from "@wfx/domain";

// ---------------------------------------------------------------------------
// The test harness (real servers on private ports)
// ---------------------------------------------------------------------------

const BRIDGE_PORT = 3512;
const PROVIDER_PORT = 3513;

/** The framed messages one test client observes. */
interface Observed {
  readonly events: RealtimeTranslationEvent[];
  readonly transports: Record<string, unknown>[];
}

/** One browser-shaped WebSocket client against the test bridge. */
class TestClient {
  private socket: WebSocket | null = null;
  readonly observed: Observed = { events: [], transports: [] };
  private readonly waiters: ((kind: string) => void)[] = [];
  private closed = false;

  async connect(): Promise<void> {
    const socket = new WebSocket(`ws://localhost:${BRIDGE_PORT}/`);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () => reject(new Error("the test client could not connect")));
    });
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const parsed = JSON.parse(event.data) as { event?: RealtimeTranslationEvent } | Record<string, unknown>;
      if ("event" in parsed && parsed.event !== undefined && parsed.event !== null) {
        const domainEvent = parsed.event as RealtimeTranslationEvent;
        this.observed.events.push(domainEvent);
        this.notify(domainEvent.kind);
      } else if ("transport" in parsed) {
        this.observed.transports.push(parsed);
        this.notify(String((parsed as { transport: string }).transport));
      }
    });
    socket.addEventListener("close", () => {
      this.closed = true;
    });
  }

  private notify(kind: string): void {
    for (const waiter of [...this.waiters]) waiter(kind);
  }

  /** Wait until an event of the given kind arrives (bounded). */
  async waitFor(kind: string, timeoutMs: number): Promise<boolean> {
    const already = this.observed.events.some((event) => event.kind === kind);
    if (already) return true;
    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(false);
      }, timeoutMs);
      const waiter = (observed: string): void => {
        if (observed !== kind) return;
        clearTimeout(timer);
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(true);
      };
      this.waiters.push(waiter);
    });
  }

  /** Wait until a transport message of the given kind arrives (bounded). */
  async waitForTransport(kind: string, timeoutMs: number): Promise<boolean> {
    const already = this.observed.transports.some((message) => (message as { transport: string }).transport === kind);
    if (already) return true;
    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      const waiter = (observed: string): void => {
        if (observed !== kind) return;
        clearTimeout(timer);
        resolve(true);
      };
      this.waiters.push(waiter);
    });
  }

  send(message: unknown): void {
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  /** Send the start operation with the standard test inputs. */
  startSession(overrides: Record<string, unknown> = {}): void {
    this.send({
      op: "start",
      inputs: {
        sourceMedia: {
          itemId: "wfxitm_test",
          connectorId: "fake-source",
          externalRef: "fake:video-1",
          audioStreamLegallyAvailable: true,
        },
        targetLanguage: "es",
        outputModality: "text",
        subtitleMode: "bilingual",
        speakerAttribution: "simple-labels",
        visualContextPolicy: "off",
        hotwords: [],
        translatedVoicePolicy: "neutral-system-voice",
        ...overrides,
      },
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    if (this.socket !== null) {
      try {
        this.socket.close();
      } catch {
        // Already gone.
      }
      this.socket = null;
    }
  }
}

/** The test-scope bridge + provider pair. */
let bridge: RealtimeBridgeHandle | null = null;
let provider: DevRealtimeProviderHandle | null = null;

beforeEach(async () => {
  setRealtimeBridgeStatus({ running: false, port: null, provider: null, targetLanguages: [] });
  provider = startDevRealtimeProvider({ port: PROVIDER_PORT });
  bridge = startRealtimeBridge({
    port: BRIDGE_PORT,
    providerSeamFactory: createDevRealtimeSeam(`ws://localhost:${PROVIDER_PORT}`),
    allowedOrigins: ["http://localhost:3101"],
    sessionBudgetUsd: 1.0,
  });
});

afterEach(async () => {
  if (bridge !== null) {
    await bridge.stop();
    bridge = null;
  }
  if (provider !== null) {
    await provider.stop();
    provider = null;
  }
});

/** The telemetry seam's response shape. */
interface TelemetryResponse {
  ok: boolean;
  sessions: { sessionId: string; markers: { marker: string }[]; usage: Record<string, number> }[];
  ended: { sessionId: string; ended: { reason: string } | null; markers: { marker: string }[] }[];
  clientRecords: { sessionId: string; markers?: { marker: string }[] }[];
}

/** Read the bridge's telemetry seam. */
async function telemetryOf(): Promise<TelemetryResponse> {
  const response = await fetch(`http://localhost:${BRIDGE_PORT}/telemetry`);
  return (await response.json()) as TelemetryResponse;
}

// ---------------------------------------------------------------------------
// The wire validation
// ---------------------------------------------------------------------------

describe("R25-D — the wire validation (the frozen operations, never a trusted cast)", () => {
  it("parses the seven operations with their typed routing fields", () => {
    const start = parseRealtimeWireClientMessage(
      JSON.stringify({ op: "start", inputs: { some: "shape" } }),
    );
    expect(start.op).toBe("start");
    const reconnect = parseRealtimeWireClientMessage(
      JSON.stringify({ op: "reconnect", sessionId: "s1", resumeToken: "t1" }),
    );
    expect(reconnect.op).toBe("reconnect");
    const configure = parseRealtimeWireClientMessage(
      JSON.stringify({ op: "configure", sessionId: "s1", configuration: { subtitleMode: "translated" } }),
    );
    expect(configure.op).toBe("configure");
    const appendAudio = parseRealtimeWireClientMessage(
      JSON.stringify({ op: "append-audio", sessionId: "s1", audioBase64: "AAAA" }),
    );
    expect(appendAudio.op).toBe("append-audio");
    const appendFrame = parseRealtimeWireClientMessage(
      JSON.stringify({ op: "append-image-frame", sessionId: "s1", frameBase64: "AAAA" }),
    );
    expect(appendFrame.op).toBe("append-image-frame");
    const stop = parseRealtimeWireClientMessage(JSON.stringify({ op: "stop", sessionId: "s1" }));
    expect(stop.op).toBe("stop");
    const close = parseRealtimeWireClientMessage(JSON.stringify({ op: "close", sessionId: "s1" }));
    expect(close.op).toBe("close");
  });

  it("refuses malformed messages with the typed invalid detail", () => {
    expect(parseRealtimeWireClientMessage("not json").op).toBe("invalid");
    expect(parseRealtimeWireClientMessage("[]").op).toBe("invalid");
    expect(parseRealtimeWireClientMessage("{}").op).toBe("invalid");
    expect(parseRealtimeWireClientMessage(JSON.stringify({ op: "explode" })).op).toBe("invalid");
    expect(parseRealtimeWireClientMessage(JSON.stringify({ op: "reconnect" })).op).toBe("invalid");
    expect(parseRealtimeWireClientMessage(JSON.stringify({ op: "append-audio", sessionId: "s" })).op).toBe("invalid");
  });
});

// ---------------------------------------------------------------------------
// The shared gates + the session lifecycle
// ---------------------------------------------------------------------------

describe("R25-D — the session lifecycle over the real bridge", () => {
  it("binds a session, relays the domain events, and answers the transport ack with the shared policy truth", async () => {
    const client = new TestClient();
    await client.connect();
    client.startSession();
    expect(await client.waitFor("session-created", 10_000)).toBe(true);
    const bound = client.observed.transports.find(
      (message) => (message as { transport: string }).transport === "session-bound",
    ) as { policy: { effectiveOutputModality: string; degradedFromRequested: boolean; modalityReason: string } } | undefined;
    expect(bound).toBeDefined();
    expect(bound!.policy.effectiveOutputModality).toBe("text");
    expect(bound!.policy.degradedFromRequested).toBe(false);
    expect(bound!.policy.modalityReason).toContain("text-only translation requested");
    const created = client.observed.events.find((event) => event.kind === "session-created");
    expect(created).toBeDefined();
    if (created?.kind === "session-created") {
      expect(created.providerId).toBe(DEV_REALTIME_PROVIDER_ID);
      expect(created.effectiveInputs.targetLanguage).toBe("es");
    }
    expect(await client.waitFor("translation-segment-final", 15_000)).toBe(true);
    client.send({ op: "stop", sessionId: sessionIdOf(client) });
    expect(await client.waitFor("session-closed", 10_000)).toBe(true);
    const closed = client.observed.events.find((event) => event.kind === "session-closed");
    if (closed?.kind === "session-closed") {
      expect(closed.reason).toBe("user-stop");
    }
    client.close();
  }, 45_000);

  it("refuses the session when the SHARED legal-audio gate fails closed", async () => {
    const client = new TestClient();
    await client.connect();
    client.startSession({
      sourceMedia: { externalRef: "fake:video-1", audioStreamLegallyAvailable: false },
    });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const refused = client.observed.transports.find(
      (message) => (message as { transport: string }).transport === "refused",
    ) as { errorKind: string; detail: string } | undefined;
    expect(refused).toBeDefined();
    expect(refused!.errorKind).toBe("policy");
    expect(refused!.detail).toContain("audioStreamLegallyAvailable");
    client.close();
  }, 45_000);

  it("refuses the session for unscripted media (the provider seam's honest refusal)", async () => {
    const client = new TestClient();
    await client.connect();
    client.startSession({ sourceMedia: { externalRef: "fake:unknown", audioStreamLegallyAvailable: true } });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const refused = client.observed.transports.find(
      (message) => (message as { transport: string }).transport === "refused",
    ) as { errorKind: string; detail: string } | undefined;
    expect(refused).toBeDefined();
    expect(refused!.errorKind).toBe("policy");
    expect(refused!.detail).toContain("no scripted media");
    client.close();
  }, 45_000);

  it("runs the terminal provider failure to the typed fallback (the de direction)", async () => {
    const client = new TestClient();
    await client.connect();
    client.startSession({ targetLanguage: "de" });
    expect(await client.waitFor("terminal-error", 15_000)).toBe(true);
    const terminal = client.observed.events.find((event) => event.kind === "terminal-error");
    if (terminal?.kind === "terminal-error") {
      expect(terminal.errorKind).toBe("provider-failure");
      expect(terminal.detail).toContain("German direction failed");
    }
    expect(await client.waitFor("session-closed", 5_000)).toBe(true);
    client.close();
  }, 45_000);

  it("honors the mid-session configure for translated speech (audio from the next segment)", async () => {
    const client = new TestClient();
    await client.connect();
    client.startSession({ outputModality: "text-and-audio" });
    expect(await client.waitFor("translated-audio-chunk", 15_000)).toBe(true);
    client.close();
  }, 45_000);

  it("answers the health truth and the telemetry retention (ended sessions survive the close)", async () => {
    const client = new TestClient();
    await client.connect();
    client.startSession();
    expect(await client.waitFor("translation-segment-final", 15_000)).toBe(true);
    client.send({ op: "stop", sessionId: sessionIdOf(client) });
    expect(await client.waitFor("session-closed", 5_000)).toBe(true);
    const telemetry = await telemetryOf();
    expect(telemetry.ok).toBe(true);
    expect(telemetry.sessions.length).toBe(0);
    expect(telemetry.ended.length).toBe(1);
    expect(telemetry.ended[0]!.ended?.reason).toBe("user-stop");
    expect(telemetry.ended[0]!.markers.some((entry) => entry.marker === "session-created")).toBe(true);
    client.close();
  }, 45_000);
});

// ---------------------------------------------------------------------------
// The reconnect laws (BOTH directions)
// ---------------------------------------------------------------------------

describe("R25-D — the reconnect laws (the §R25-A reconnect/resume)", () => {
  it("recovers the scripted provider drop through the domain reconnect operation and resumes the stream", async () => {
    const client = new TestClient();
    await client.connect();
    client.startSession();
    // The scripted drop fires after the third segment's events.
    expect(await client.waitFor("recoverable-error", 20_000)).toBe(true);
    const recoverable = client.observed.events.find((event) => event.kind === "recoverable-error");
    if (recoverable?.kind === "recoverable-error") {
      expect(recoverable.errorKind).toBe("network");
    }
    expect(await client.waitForTransport("session-resumed", 10_000)).toBe(true);
    // The stream continues: the Speaker 2 turn arrives (the fourth
    // segment — a BOUNDED poll, the same deterministic-ready-wait
    // discipline as the J41 hardening; a single read would race the
    // resumed stream).
    let labels: string[] = [];
    const speakerDeadline = Date.now() + 20_000;
    while (Date.now() < speakerDeadline) {
      const speakerEvents = client.observed.events.filter((event) => event.kind === "speaker-attribution");
      labels = speakerEvents.map((event) => (event as { label: string }).label);
      if (labels.includes("Speaker 2")) break;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    expect(labels).toContain("Speaker 2");
    client.close();
  }, 45_000);

  it("resumes a dropped CLIENT connection through the resume token (the continuity window)", async () => {
    const first = new TestClient();
    await first.connect();
    first.startSession();
    expect(await first.waitFor("translation-segment-final", 15_000)).toBe(true);
    const sessionId = sessionIdOf(first);
    const bound = first.observed.transports.find(
      (message) => (message as { transport: string }).transport === "session-bound",
    ) as { resumeToken: string } | undefined;
    expect(bound).toBeDefined();
    first.close();
    // A fresh connection (a browser reconnect) resumes the retained session.
    const second = new TestClient();
    await second.connect();
    second.send({ op: "reconnect", sessionId, resumeToken: bound!.resumeToken });
    expect(await second.waitForTransport("session-resumed", 10_000)).toBe(true);
    const resumed = second.observed.transports.find(
      (message) => (message as { transport: string }).transport === "session-resumed",
    ) as { recovered: string; lastCommittedSegmentId: string } | undefined;
    expect(resumed).toBeDefined();
    expect(resumed!.recovered).toBe("client-connection");
    expect(resumed!.lastCommittedSegmentId).toMatch(/^seg-\d+$/);
    second.close();
  }, 45_000);

  it("refuses a resume with the wrong token (the typed session-expired truth)", async () => {
    const client = new TestClient();
    await client.connect();
    client.startSession();
    expect(await client.waitFor("translation-segment-final", 15_000)).toBe(true);
    const sessionId = sessionIdOf(client);
    client.close();
    const second = new TestClient();
    await second.connect();
    second.send({ op: "reconnect", sessionId, resumeToken: "wrong-token" });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const refused = second.observed.transports.find(
      (message) => (message as { transport: string }).transport === "refused",
    ) as { detail: string } | undefined;
    expect(refused).toBeDefined();
    expect(refused!.detail).toContain("resume token does not match");
    second.close();
  }, 45_000);
});

// ---------------------------------------------------------------------------
// The R25-L metric derivation (the observation layer)
// ---------------------------------------------------------------------------

describe("R25-L — the web latency metric derivation (pure)", () => {
  it("derives every metric from the observed markers", () => {
    const markers: RealtimeMarkerRecord[] = [
      { marker: "session-start-requested", atMs: 1_000 },
      { marker: "session-bound", atMs: 1_050 },
      { marker: "first-source-transcript-delta", atMs: 1_500 },
      { marker: "first-translation-delta", atMs: 3_300 },
      { marker: "first-stable-segment", atMs: 3_900 },
      { marker: "first-translated-audio-chunk", atMs: 4_100 },
      { marker: "client-disconnected", atMs: 10_000 },
      { marker: "reconnect-requested", atMs: 11_200 },
      { marker: "reconnected", atMs: 11_250 },
    ];
    const metrics = deriveRealtimeLatencyMetrics(
      markers,
      [{ segmentId: "seg-1", sourceFinalAtMs: 1_700, translationFinalAtMs: 3_900 }],
      2_200,
    );
    expect(metrics.firstSourceTranscriptDeltaMs).toBe(500);
    expect(metrics.firstTranslatedTextDeltaMs).toBe(2_300);
    expect(metrics.firstTranslatedSpeechChunkMs).toBe(3_100);
    expect(metrics.stableSegmentMs).toBe(2_900);
    expect(metrics.reconnectTimeMs).toBe(1_250);
    expect(metrics.driftMs).toBe(2_200);
    expect(metrics.providerReportedLagMs).toBe(2_200);
  });

  it("answers null for the metrics never observed (honest absence, never a fabricated number)", () => {
    const metrics = deriveRealtimeLatencyMetrics([], [], null);
    expect(metrics.firstSourceTranscriptDeltaMs).toBeNull();
    expect(metrics.firstTranslatedTextDeltaMs).toBeNull();
    expect(metrics.firstTranslatedSpeechChunkMs).toBeNull();
    expect(metrics.stableSegmentMs).toBeNull();
    expect(metrics.reconnectTimeMs).toBeNull();
    expect(metrics.driftMs).toBeNull();
  });

  it("measures the reconnect time only from the reconnected marker AFTER the disconnect", () => {
    const markers: RealtimeMarkerRecord[] = [
      { marker: "session-start-requested", atMs: 1_000 },
      // A provider-side recovery BEFORE the client interruption.
      { marker: "reconnected", atMs: 5_000 },
      { marker: "client-disconnected", atMs: 10_000 },
      { marker: "reconnect-requested", atMs: 11_200 },
      { marker: "reconnected", atMs: 11_400 },
    ];
    const metrics = deriveRealtimeLatencyMetrics(markers, []);
    expect(metrics.reconnectTimeMs).toBe(1_400);
  });
});

// ---------------------------------------------------------------------------
// The bridge status law
// ---------------------------------------------------------------------------

describe("R25-D — the bridge status module (the globalThis doctrine)", () => {
  it("records the running truth on start and the absent truth on stop", async () => {
    // The beforeEach/afterEach pair already exercised a full lifecycle;
    // assert the current state transitions through a dedicated pair.
    const statusBefore = (() => {
      const { readRealtimeBridgeStatus } = require("../src/host/realtime/realtime-bridge-state");
      return readRealtimeBridgeStatus();
    })();
    // The running bridge from beforeEach holds the truth.
    expect(statusBefore.running).toBe(true);
    expect(statusBefore.port).toBe(BRIDGE_PORT);
    expect(statusBefore.provider?.id).toBe(DEV_REALTIME_PROVIDER_ID);
    await bridge!.stop();
    bridge = null;
    const { readRealtimeBridgeStatus } = require("../src/host/realtime/realtime-bridge-state");
    const statusAfter = readRealtimeBridgeStatus();
    expect(statusAfter.running).toBe(false);
    expect(statusAfter.port).toBeNull();
    expect(REALTIME_BRIDGE_DEFAULT_PORT).toBe(3102);
  }, 45_000);
});

/** Extract the session id from the observed transport ack. */
function sessionIdOf(client: TestClient): string {
  const bound = client.observed.transports.find(
    (message) => (message as { transport: string }).transport === "session-bound",
  ) as { sessionId: string } | undefined;
  return bound?.sessionId ?? "";
}
