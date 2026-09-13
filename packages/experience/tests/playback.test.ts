import { describe, expect, it } from "bun:test";
import { validateEntertainmentEvent } from "@wfx/domain";

import {
  ExperienceError,
  FIXTURE_OCCURRED_AT,
  PlaybackSessionStore,
  PLAYBACK_MODE_PRECEDENCE,
  createExperienceApi,
  getFeed,
  makeFixturePorts,
  pickRealizationByPrecedence,
  reportComplete,
  reportProgress,
  reportSkip,
  startPlayback,
  type ExperienceContext,
  type Ports,
} from "../src/index";

const CTX: ExperienceContext = { userId: "user-1", sessionId: "sess-1", locale: "en", region: "EU" };
const ITEM_A = "wfxitm_00000000000000000000000000";

describe("realization precedence (frozen Native→Embed→Browser→External)", () => {
  it("picks by precedence regardless of list order", () => {
    const realization = (mode: "native" | "embed" | "browser" | "external") => ({
      mode,
      connectorId: "fake-source",
      capabilities: [],
    });
    expect(
      pickRealizationByPrecedence([realization("browser"), realization("native"), realization("external")])?.mode,
    ).toBe("native");
    expect(pickRealizationByPrecedence([realization("browser"), realization("external")])?.mode).toBe("browser");
    expect(pickRealizationByPrecedence([realization("external")])?.mode).toBe("external");
    expect(pickRealizationByPrecedence([])).toBeNull();
    expect(PLAYBACK_MODE_PRECEDENCE).toEqual(["native", "embed", "browser", "external"]);
  });

  it("ignores realizations that fail the WFX-002 validator", () => {
    const good = { mode: "embed" as const, connectorId: "fake-source", capabilities: ["playEmbed"] };
    const bad = { mode: "external" as const, connectorId: "", capabilities: [] }; // invalid connectorId
    expect(pickRealizationByPrecedence([bad])?.mode ?? null).toBeNull();
    expect(pickRealizationByPrecedence([bad, good])?.mode).toBe("embed");
  });
});

describe("PlaybackSessionStore (pure session map)", () => {
  const session = {
    id: "wfxpses_00000000000000000000000001",
    userId: "user-1",
    itemId: ITEM_A,
    realization: { mode: "embed" as const, connectorId: "fake-source", capabilities: [] },
    resumePositionMs: 0,
    createdAt: FIXTURE_OCCURRED_AT,
  };

  it("puts, gets, has, lists, removes", () => {
    const store = new PlaybackSessionStore([session]);
    expect(store.size).toBe(1);
    expect(store.has(session.id)).toBe(true);
    expect(store.get(session.id)?.itemId).toBe(ITEM_A);
    expect(store.list()).toEqual([session]);
    expect(store.remove(session.id)).toBe(true);
    expect(store.size).toBe(0);
  });

  it("updateResume returns a NEW session object and leaves the old untouched", () => {
    const store = new PlaybackSessionStore([session]);
    const updated = store.updateResume(session.id, 42_000);
    expect(updated).not.toBe(session);
    expect(updated?.resumePositionMs).toBe(42_000);
    expect(session.resumePositionMs).toBe(0);
    expect(store.get(session.id)?.resumePositionMs).toBe(42_000);
    expect(store.updateResume("wfxpses_00000000000000000000000099", 1)).toBeNull();
  });
});

describe("startPlayback (WFX-005)", () => {
  it("resolves through the port and picks by frozen precedence", async () => {
    const ports = makeFixturePorts();
    const result = await startPlayback(ports, CTX, { itemId: ITEM_A, externalRef: "fake:movie-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // fake:movie-1 realizations are [browser, native, external, embed] — native wins.
    expect(result.value.realization.mode).toBe("native");
    expect(result.value.resumePositionMs).toBe(0);
    expect(result.value.userId).toBe("user-1");
    expect(result.value.itemId).toBe(ITEM_A);
    expect(result.value.createdAt).toBe(FIXTURE_OCCURRED_AT);
    expect(result.value.id).toMatch(/^wfxpses_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  });

  it("accepts a caller-chosen realization without port resolution", async () => {
    const ports = makeFixturePorts();
    const realization = {
      mode: "embed" as const,
      connectorId: "fake-source",
      externalRef: "fake:movie-1",
      url: "https://fixture.invalid/embed/fake:movie-1",
      capabilities: ["playEmbed"],
    };
    const result = await startPlayback(ports, CTX, { itemId: ITEM_A, realization });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.realization).toEqual(realization);
    expect(ports.events.events).toHaveLength(1); // start event still emitted
  });

  it("carries a supplied resumePositionMs", async () => {
    const ports = makeFixturePorts();
    const result = await startPlayback(ports, CTX, {
      itemId: ITEM_A,
      externalRef: "fake:series-1",
      resumePositionMs: 123_456,
    });
    expect(result.ok && result.value.resumePositionMs).toBe(123_456);
  });

  it("emits a valid frozen \"start\" event through the sink", async () => {
    const ports = makeFixturePorts();
    const sourceRealizationId = "wfxsrc_00000000000000000000000005";
    const result = await startPlayback(ports, CTX, {
      itemId: ITEM_A,
      externalRef: "fake:movie-1",
      sourceRealizationId,
    });
    expect(result.ok).toBe(true);

    expect(ports.events.events).toHaveLength(1);
    const event = ports.events.events[0];
    if (event === undefined) throw new Error("expected a start event");
    expect(event.type).toBe("start");
    expect(event.userId).toBe("user-1");
    expect(event.itemId).toBe(ITEM_A);
    expect(event.sessionId).toBe("sess-1"); // the caller-supplied experience session
    expect(event.occurredAt).toBe(FIXTURE_OCCURRED_AT); // from the injected clock
    expect(event.sourceRealizationId).toBe(sourceRealizationId);
    expect(event.payload).toEqual({ playbackSessionId: result.ok ? result.value.id : "" });

    // WFX-002 validator accepts the emitted event.
    expect(validateEntertainmentEvent(event).ok).toBe(true);
  });

  it("stores the session in the supplied store (and a default store one-shot)", async () => {
    const sessions = new PlaybackSessionStore();
    const ports = makeFixturePorts();
    const result = await startPlayback(ports, CTX, { itemId: ITEM_A, externalRef: "fake:movie-1" }, sessions);
    expect(result.ok).toBe(true);
    expect(sessions.size).toBe(1);
    if (result.ok) expect(sessions.get(result.value.id)?.itemId).toBe(ITEM_A);
  });

  it("answers typed unresolvable when nothing can be resolved", async () => {
    const ports = makeFixturePorts();
    const result = await startPlayback(ports, CTX, { itemId: ITEM_A, externalRef: "fake:unknown-ref" });
    expect(result).toEqual({
      ok: false,
      reason: "unresolvable",
      detail: expect.stringContaining("fake:unknown-ref"),
    });
  });

  it("answers typed unsupported when the connector declares no play capability", async () => {
    const ports = makeFixturePorts({ capabilities: ["catalogSearch", "metadata"] });
    const result = await startPlayback(ports, CTX, { itemId: ITEM_A, externalRef: "fake:movie-1" });
    expect(result).toEqual({
      ok: false,
      reason: "unsupported",
      capability: "playNative",
      detail: expect.stringContaining("playNative"),
    });
  });

  it("answers typed port-failed when resolve rejects", async () => {
    const base = makeFixturePorts();
    const ports: Ports = {
      connector: {
        descriptor: () => base.connector.descriptor(),
        search: () => Promise.resolve([]),
        metadata: () => Promise.resolve(null),
        resolve: () => Promise.reject(new Error("resolve exploded")),
        executeAction: () => Promise.resolve({ status: "failed", occurredAt: FIXTURE_OCCURRED_AT }),
      },
      events: base.events,
      clock: base.clock,
      ids: base.ids,
    };
    const result = await startPlayback(ports, CTX, { itemId: ITEM_A, externalRef: "fake:movie-1" });
    expect(result).toEqual({
      ok: false,
      reason: "port-failed",
      operation: "resolve",
      detail: expect.stringContaining("resolve exploded"),
    });
  });

  it("throws the typed ExperienceError for malformed intents", async () => {
    const ports = makeFixturePorts();
    await expect(
      startPlayback(ports, CTX, { itemId: "movie-1", externalRef: "fake:movie-1" }),
    ).rejects.toBeInstanceOf(ExperienceError); // not a canonical wfxitm_ id
    await expect(startPlayback(ports, CTX, { itemId: ITEM_A })).rejects.toBeInstanceOf(
      ExperienceError,
    ); // no externalRef, no realization
    await expect(
      startPlayback(ports, CTX, { itemId: ITEM_A, externalRef: "fake:movie-1", resumePositionMs: -1 }),
    ).rejects.toBeInstanceOf(ExperienceError);
    await expect(
      startPlayback(ports, CTX, {
        itemId: ITEM_A,
        externalRef: "fake:movie-1",
        sourceRealizationId: "src-1",
      }),
    ).rejects.toBeInstanceOf(ExperienceError);
    await expect(
      startPlayback(ports, CTX, {
        itemId: ITEM_A,
        realization: { mode: "embed", connectorId: "", capabilities: [] },
      }),
    ).rejects.toBeInstanceOf(ExperienceError);
  });

  it("propagates sink failures (a lost start event is never a silent success)", async () => {
    const base = makeFixturePorts();
    const ports: Ports = {
      connector: base.connector,
      events: { emit: () => { throw new Error("sink down"); } },
      clock: base.clock,
      ids: base.ids,
    };
    await expect(startPlayback(ports, CTX, { itemId: ITEM_A, externalRef: "fake:movie-1" })).rejects.toThrow(
      "sink down",
    );
  });
});

describe("progress mirroring (reportProgress / reportComplete / reportSkip)", () => {
  async function startedSession(ports: Ports, sessions: PlaybackSessionStore) {
    const result = await startPlayback(ports, CTX, { itemId: ITEM_A, externalRef: "fake:movie-1" }, sessions);
    if (!result.ok) throw new Error("expected startPlayback to succeed");
    return result.value;
  }

  it("reportProgress updates resume position and emits a valid progress event", async () => {
    const ports = makeFixturePorts();
    const sessions = new PlaybackSessionStore();
    const session = await startedSession(ports, sessions);

    const reported = await reportProgress(ports, CTX, { sessionId: session.id, positionMs: 65_000 }, sessions);
    expect(reported.ok).toBe(true);
    if (!reported.ok) return;
    expect(reported.value.resumePositionMs).toBe(65_000);
    expect(sessions.get(session.id)?.resumePositionMs).toBe(65_000);

    expect(ports.events.events).toHaveLength(2);
    const event = ports.events.events[1];
    if (event === undefined) throw new Error("expected a progress event");
    expect(event.type).toBe("progress");
    expect(event.itemId).toBe(ITEM_A);
    expect(event.payload).toEqual({ playbackSessionId: session.id, positionMs: 65_000 });
    expect(validateEntertainmentEvent(event).ok).toBe(true);
  });

  it("reportComplete optionally updates the position and emits the complete event", async () => {
    const ports = makeFixturePorts();
    const sessions = new PlaybackSessionStore();
    const session = await startedSession(ports, sessions);

    const reported = await reportComplete(ports, CTX, { sessionId: session.id, positionMs: 7_200_000 }, sessions);
    expect(reported.ok && reported.value.resumePositionMs).toBe(7_200_000);
    expect(ports.events.events[ports.events.events.length - 1]?.type).toBe("complete");

    const second = new PlaybackSessionStore();
    const ports2 = makeFixturePorts();
    const session2 = await startedSession(ports2, second);
    const kept = await reportComplete(ports2, CTX, { sessionId: session2.id }, second); // no position
    expect(kept.ok && kept.value.resumePositionMs).toBe(0); // last reported position stands
    expect(ports2.events.events[ports2.events.events.length - 1]?.type).toBe("complete");
  });

  it("reportSkip mirrors the skip event", async () => {
    const ports = makeFixturePorts();
    const sessions = new PlaybackSessionStore();
    const session = await startedSession(ports, sessions);

    const reported = await reportSkip(ports, CTX, { sessionId: session.id, positionMs: 5_000 }, sessions);
    expect(reported.ok && reported.value.resumePositionMs).toBe(5_000);
    expect(ports.events.events[ports.events.events.length - 1]?.type).toBe("skip");
    expect(ports.events.events[ports.events.events.length - 1]?.payload).toEqual({
      playbackSessionId: session.id,
      positionMs: 5_000,
    });
  });

  it("answers typed not-found for unknown session ids", async () => {
    const ports = makeFixturePorts();
    const result = await reportProgress(
      ports,
      CTX,
      { sessionId: "wfxpses_00000000000000000000000099", positionMs: 1 },
      new PlaybackSessionStore(),
    );
    expect(result).toEqual({
      ok: false,
      reason: "not-found",
      detail: expect.stringContaining("wfxpses_00000000000000000000000099"),
    });
  });

  it("throws the typed ExperienceError for malformed reports", async () => {
    const ports = makeFixturePorts();
    const sessions = new PlaybackSessionStore();
    await expect(reportProgress(ports, CTX, { sessionId: "s" }, sessions)).rejects.toBeInstanceOf(
      ExperienceError,
    ); // positionMs required for progress
    await expect(
      reportProgress(ports, CTX, { sessionId: "s", positionMs: -5 }, sessions),
    ).rejects.toBeInstanceOf(ExperienceError);
    await expect(
      reportComplete(ports, CTX, { sessionId: "s", positionMs: "half" as unknown as number }, sessions),
    ).rejects.toBeInstanceOf(ExperienceError);
    await expect(reportSkip(ports, CTX, null as never, sessions)).rejects.toBeInstanceOf(ExperienceError);
  });
});

describe("createExperienceApi facade (bundled use-cases + shared store)", () => {
  it("start → progress → complete share one session store", async () => {
    const ports = makeFixturePorts();
    const api = createExperienceApi(ports);

    const feed = await getFeed(ports, CTX, { surface: "watch", query: "drift" });
    const card = feed.cards[0];
    if (card === undefined) throw new Error("expected a card");

    const started = await api.startPlayback(CTX, {
      itemId: card.item.id,
      externalRef: card.realization.externalRef,
      sourceRealizationId: card.realization.id,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    expect(api.getPlaybackSession(started.value.id)?.itemId).toBe(card.item.id);

    const progressed = await api.reportProgress(CTX, { sessionId: started.value.id, positionMs: 10_000 });
    expect(progressed.ok && progressed.value.resumePositionMs).toBe(10_000);

    const completed = await api.reportComplete(CTX, { sessionId: started.value.id });
    expect(completed.ok).toBe(true);
    expect(api.getPlaybackSession(started.value.id)?.resumePositionMs).toBe(10_000);

    expect(ports.events.events.map((event) => event.type)).toEqual(["start", "progress", "complete"]);
  });

  it("events use the clock deterministically across the session", async () => {
    const ports = makeFixturePorts();
    const api = createExperienceApi(ports);
    const started = await api.startPlayback(CTX, { itemId: ITEM_A, externalRef: "fake:movie-1" });
    if (!started.ok) throw new Error("expected success");
    ports.clock.advance(60_000);
    await api.reportProgress(CTX, { sessionId: started.value.id, positionMs: 1_000 });
    const [startEvent, progressEvent] = ports.events.events;
    expect(startEvent?.occurredAt).toBe("2026-09-13T00:00:00.000Z");
    expect(progressEvent?.occurredAt).toBe("2026-09-13T00:01:00.000Z");
  });
});
