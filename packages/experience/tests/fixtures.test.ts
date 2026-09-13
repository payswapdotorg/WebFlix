import { describe, expect, it } from "bun:test";

import {
  FIXTURE_CLOCK_START_MS,
  FIXTURE_OCCURRED_AT,
  FixedClock,
  RecordingEventSink,
  SequentialIdGen,
  makeFixturePorts,
  type FakeCatalogItem,
} from "../src/index";
import { isEntertainmentItemId, isSourceRealizationId } from "@wfx/domain";

describe("deterministic fixtures (WFX-005)", () => {
  it("SequentialIdGen produces valid canonical ULID bodies in sequence", () => {
    const gen = new SequentialIdGen();
    const first = gen.next();
    expect(first).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(isEntertainmentItemId(`wfxitm_${first}`)).toBe(true);
    expect(isSourceRealizationId(`wfxsrc_${gen.next()}`)).toBe(true);
    const gen2 = new SequentialIdGen();
    expect(gen2.next()).toBe(first); // fresh generators restart the sequence
  });

  it("FixedClock returns the start instant and advances deterministically", () => {
    const clock = new FixedClock(1_000);
    expect(clock.now()).toBe(1_000);
    clock.advance(1_500);
    expect(clock.now()).toBe(2_500);
    expect(new Date(clock.now()).toISOString()).toBe("1970-01-01T00:00:02.500Z");
  });

  it("the default fixture clock starts at the frozen-architecture instant", () => {
    const ports = makeFixturePorts();
    expect(ports.clock.now()).toBe(FIXTURE_CLOCK_START_MS);
    expect(new Date(ports.clock.now()).toISOString()).toBe(FIXTURE_OCCURRED_AT);
  });

  it("RecordingEventSink records in order, clears, and can fail on demand", () => {
    const sink = new RecordingEventSink();
    const event = {
      userId: "user-1",
      itemId: "wfxitm_00000000000000000000000000",
      type: "impression" as const,
      occurredAt: FIXTURE_OCCURRED_AT,
      sessionId: "sess-1",
    };
    sink.emit(event);
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toBe(event);
    sink.clear();
    expect(sink.events).toHaveLength(0);

    const failing = new RecordingEventSink(new Error("sink down"));
    expect(() => failing.emit(event)).toThrow("sink down");
    expect(failing.events).toHaveLength(0);
  });

  it("the fake connector filters search by case-insensitive title substring", async () => {
    const ports = makeFixturePorts();
    const lower = await ports.connector.search({ userId: "u", locale: "en" }, "rain");
    const upper = await ports.connector.search({ userId: "u", locale: "en" }, "RAIN");
    expect(lower.map((hit) => hit.externalRef)).toEqual(["fake:short-1", "fake:short-3", "fake:video-3"]);
    expect(upper.map((hit) => hit.externalRef)).toEqual(["fake:short-1", "fake:short-3", "fake:video-3"]);
    expect(await ports.connector.search({ userId: "u", locale: "en" }, "")).toEqual([]);
    expect(await ports.connector.search({ userId: "u", locale: "en" }, "zzz-not-a-title")).toEqual([]);
  });

  it("the fake connector degrades undeclared capabilities like the SDK plain surface", async () => {
    const ctx = { userId: "u", locale: "en" };
    const ports = makeFixturePorts({ capabilities: ["metadata"] });
    expect(await ports.connector.search(ctx, "rain")).toEqual([]); // no catalogSearch
    expect(await ports.connector.resolve(ctx, "fake:movie-1")).toEqual([]); // no play capabilities
    const receipt = await ports.connector.executeAction(ctx, {
      type: "like",
      connectorId: "fake-source",
      externalRef: "fake:movie-1",
    });
    expect(receipt.status).toBe("unsupported");
    expect(receipt.detail).toContain("'like'");
  });

  it("resolve() only returns realizations whose mode matches a declared play capability", async () => {
    const ctx = { userId: "u", locale: "en" };
    const full = await makeFixturePorts().connector.resolve(ctx, "fake:movie-1");
    expect(full.map((realization) => realization.mode).sort()).toEqual([
      "browser",
      "embed",
      "external",
      "native",
    ]);

    const noNative = await makeFixturePorts({
      capabilities: [
        "catalogSearch",
        "metadata",
        "playEmbed",
        "playBrowser",
        "playExternal",
      ],
    }).connector.resolve(ctx, "fake:movie-1");
    expect(noNative.map((realization) => realization.mode).sort()).toEqual([
      "browser",
      "embed",
      "external",
    ]);
  });

  it("writeLibrary/readLibrary round-trip through the fake connector", async () => {
    const ctx = { userId: "u", locale: "en" };
    const ports = makeFixturePorts();
    const added = await ports.connector.writeLibrary(ctx, {
      op: "add",
      externalRef: "fake:video-1",
      title: "Deep Field Diary",
    });
    expect(added.status).toBe("confirmed");
    const entries = await ports.connector.readLibrary(ctx);
    expect(entries.map((entry) => entry.externalRef)).toContain("fake:video-1");
    const removed = await ports.connector.writeLibrary(ctx, { op: "remove", externalRef: "fake:video-1" });
    expect(removed.status).toBe("confirmed");
    expect((await ports.connector.readLibrary(ctx)).map((entry) => entry.externalRef)).not.toContain(
      "fake:video-1",
    );
  });

  it("two freshly-built bundles driven identically produce identical output (no randomness)", async () => {
    const a = makeFixturePorts();
    const b = makeFixturePorts();
    const query = { surface: "short" as const, query: "rain" };

    const feedA = await import("../src/index").then((mod) => mod.getFeed(a, {
      userId: "user-1",
      sessionId: "sess-1",
      locale: "en",
    }, query));
    const feedB = await import("../src/index").then((mod) => mod.getFeed(b, {
      userId: "user-1",
      sessionId: "sess-1",
      locale: "en",
    }, query));
    expect(feedA).toEqual(feedB);

    const intent = {
      itemId: "wfxitm_00000000000000000000000000",
      externalRef: "fake:short-1",
    };
    const { startPlayback } = await import("../src/index");
    const startedA = await startPlayback(a, { userId: "user-1", sessionId: "sess-1", locale: "en" }, intent);
    const startedB = await startPlayback(b, { userId: "user-1", sessionId: "sess-1", locale: "en" }, intent);
    expect(startedA).toEqual(startedB);
    expect(a.events.events).toEqual(b.events.events);
  });

  it("a catalog override can model hits without metadata or without a canonical type", async () => {
    const items: readonly FakeCatalogItem[] = [
      {
        externalRef: "fake:bare-1",
        title: "Bare Hit",
        availability: "available",
        itemCapabilities: [],
        realizations: [],
        includeMetadata: false,
      },
    ];
    const ports = makeFixturePorts({ items });
    const ctx = { userId: "u", locale: "en" };
    const hits = await ports.connector.search(ctx, "bare");
    expect(hits).toHaveLength(1);
    expect(await ports.connector.metadata(ctx, "fake:bare-1")).toBeNull();
  });

  it("the fixture clock instant is fixed, never \"now\"", () => {
    expect(FIXTURE_CLOCK_START_MS).toBe(Date.UTC(2026, 8, 13));
    expect(new Date(FIXTURE_CLOCK_START_MS).toISOString()).toBe(FIXTURE_OCCURRED_AT);
  });
});
