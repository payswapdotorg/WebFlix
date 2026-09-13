import { describe, expect, it } from "bun:test";
import { validateEntertainmentEvent } from "@wfx/domain";

import {
  ACTION_EVENT_MIRRORS,
  ExperienceError,
  FIXTURE_CONNECTOR_ID,
  FIXTURE_OCCURRED_AT,
  USER_ACTION_TYPES,
  makeFixturePorts,
  runUserAction,
  type ConnectorPort,
  type ExperienceContext,
  type Ports,
} from "../src/index";

const CTX: ExperienceContext = { userId: "user-1", sessionId: "sess-1", locale: "en", region: "EU" };
const ITEM_A = "wfxitm_00000000000000000000000000";

/** Wrap a custom connector in a Ports bundle with fixture clock/ids/sink. */
function portsWith(connector: ConnectorPort): Ports & { events: import("../src/index").RecordingEventSink } {
  const base = makeFixturePorts();
  return { connector, events: base.events, clock: base.clock, ids: base.ids };
}

describe("action vocabulary (WFX-005)", () => {
  it("USER_ACTION_TYPES mirrors the frozen UserAction union", () => {
    expect(USER_ACTION_TYPES).toEqual(["like", "save", "follow", "comment", "download", "transform"]);
  });

  it("ACTION_EVENT_MIRRORS is closed by the frozen event vocabulary", () => {
    expect(ACTION_EVENT_MIRRORS).toEqual({ like: "like", save: "save" });
    // follow/comment/download/transform have NO frozen event types — absent by design.
    expect(ACTION_EVENT_MIRRORS.follow).toBeUndefined();
    expect(ACTION_EVENT_MIRRORS.comment).toBeUndefined();
    expect(ACTION_EVENT_MIRRORS.download).toBeUndefined();
    expect(ACTION_EVENT_MIRRORS.transform).toBeUndefined();
  });
});

describe("runUserAction (WFX-005)", () => {
  it("executes a like through the port and mirrors the confirmed action as a like event", async () => {
    const ports = makeFixturePorts();
    const result = await runUserAction(ports, CTX, {
      type: "like",
      connectorId: FIXTURE_CONNECTOR_ID,
      externalRef: "fake:movie-1",
      itemId: ITEM_A,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("confirmed");
    expect(result.value.externalId).toBe("fake-act-000001");
    expect(result.value.occurredAt).toBe(FIXTURE_OCCURRED_AT);
    expect(ports.connector.recordedLikes()).toEqual(["fake:movie-1"]);

    expect(ports.events.events).toHaveLength(1);
    const event = ports.events.events[0];
    if (event === undefined) throw new Error("expected a like event");
    expect(event.type).toBe("like");
    expect(event.userId).toBe("user-1");
    expect(event.itemId).toBe(ITEM_A);
    expect(event.sessionId).toBe("sess-1");
    expect(event.occurredAt).toBe(FIXTURE_OCCURRED_AT);
    expect(validateEntertainmentEvent(event).ok).toBe(true);
  });

  it("executes a save and mirrors it as a save event", async () => {
    const ports = makeFixturePorts();
    const result = await runUserAction(ports, CTX, {
      type: "save",
      connectorId: FIXTURE_CONNECTOR_ID,
      externalRef: "fake:video-1",
      itemId: ITEM_A,
    });
    expect(result.ok && result.value.status).toBe("confirmed");
    expect(ports.connector.recordedSaves()).toEqual(["fake:video-1"]);
    expect(ports.events.events[0]?.type).toBe("save");
  });

  it("executes a follow but emits NO event (no frozen follow event type exists)", async () => {
    const ports = makeFixturePorts();
    const result = await runUserAction(ports, CTX, {
      type: "follow",
      connectorId: FIXTURE_CONNECTOR_ID,
      externalRef: "fake:series-1",
    });
    expect(result.ok && result.value.status).toBe("confirmed");
    expect(ports.connector.recordedFollows()).toEqual(["fake:series-1"]);
    expect(ports.events.events).toHaveLength(0); // documented frozen-vocabulary limit
  });

  it("does not mirror a local-only receipt (only connector confirmation mirrors)", async () => {
    const connector: ConnectorPort = {
      descriptor: () => ({
        id: "local-only-source",
        version: "0.1.0",
        displayName: "Local Only Source",
        capabilities: ["like"],
        auth: "none",
      }),
      search: () => Promise.resolve([]),
      metadata: () => Promise.resolve(null),
      resolve: () => Promise.resolve([]),
      executeAction: () =>
        Promise.resolve({ status: "local-only", detail: "recorded locally", occurredAt: FIXTURE_OCCURRED_AT }),
    };
    const ports = portsWith(connector);
    const result = await runUserAction(ports, CTX, {
      type: "like",
      connectorId: "local-only-source",
      externalRef: "lo:1",
      itemId: ITEM_A,
    });
    expect(result.ok && result.value.status).toBe("local-only");
    expect(ports.events.events).toHaveLength(0);
  });

  it("pre-checks capability: a connector without 'like' answers typed unsupported (port never called)", async () => {
    const ports = makeFixturePorts({
      capabilities: ["catalogSearch", "metadata", "save", "follow"],
    });
    const result = await runUserAction(ports, CTX, {
      type: "like",
      connectorId: FIXTURE_CONNECTOR_ID,
      externalRef: "fake:movie-1",
      itemId: ITEM_A,
    });
    expect(result).toEqual({
      ok: false,
      reason: "unsupported",
      capability: "like",
      detail: expect.stringContaining("does not declare 'like'"),
    });
    expect(ports.connector.recordedLikes()).toEqual([]);
    expect(ports.events.events).toHaveLength(0);
  });

  it("throws the typed ExperienceError when a like/save action lacks the canonical itemId", async () => {
    const ports = makeFixturePorts();
    await expect(
      runUserAction(ports, CTX, { type: "like", connectorId: FIXTURE_CONNECTOR_ID, externalRef: "fake:movie-1" }),
    ).rejects.toBeInstanceOf(ExperienceError);
    await expect(
      runUserAction(ports, CTX, {
        type: "save",
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:movie-1",
        itemId: "movie-1", // not a canonical wfxitm_ id
      }),
    ).rejects.toBeInstanceOf(ExperienceError);
  });

  it("throws the typed ExperienceError for malformed actions", async () => {
    const ports = makeFixturePorts();
    await expect(
      runUserAction(ports, CTX, {
        type: "share" as unknown as "like", // not a UserAction type
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:movie-1",
      }),
    ).rejects.toBeInstanceOf(ExperienceError);
    await expect(
      runUserAction(ports, CTX, {
        type: "like",
        connectorId: "other-source", // mismatched connector
        externalRef: "fake:movie-1",
        itemId: ITEM_A,
      }),
    ).rejects.toBeInstanceOf(ExperienceError);
    await expect(
      runUserAction(ports, CTX, {
        type: "like",
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "  ",
        itemId: ITEM_A,
      }),
    ).rejects.toBeInstanceOf(ExperienceError);
    await expect(
      runUserAction(ports, CTX, {
        type: "like",
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:movie-1",
        itemId: ITEM_A,
        payload: "nope" as unknown as Record<string, unknown>,
      }),
    ).rejects.toBeInstanceOf(ExperienceError);
  });

  it("answers typed port-failed when executeAction rejects or returns garbage", async () => {
    const descriptor = (): import("@wfx/domain").ConnectorDescriptor => ({
      id: "broken-source",
      version: "0.1.0",
      displayName: "Broken Source",
      capabilities: ["like"],
      auth: "none",
    });

    const rejecting = portsWith({
      descriptor,
      search: () => Promise.resolve([]),
      metadata: () => Promise.resolve(null),
      resolve: () => Promise.resolve([]),
      executeAction: () => Promise.reject(new Error("action exploded")),
    });
    const rejected = await runUserAction(rejecting, CTX, {
      type: "like",
      connectorId: "broken-source",
      externalRef: "b:1",
      itemId: ITEM_A,
    });
    expect(rejected).toEqual({
      ok: false,
      reason: "port-failed",
      operation: "executeAction",
      detail: expect.stringContaining("action exploded"),
    });

    const garbage = portsWith({
      descriptor,
      search: () => Promise.resolve([]),
      metadata: () => Promise.resolve(null),
      resolve: () => Promise.resolve([]),
      executeAction: () => Promise.resolve("done" as unknown as never),
    });
    const malformed = await runUserAction(garbage, CTX, {
      type: "like",
      connectorId: "broken-source",
      externalRef: "b:1",
      itemId: ITEM_A,
    });
    expect(malformed).toEqual({
      ok: false,
      reason: "port-failed",
      operation: "executeAction",
      detail: expect.stringContaining("expected an ActionReceipt"),
    });
  });

  it("passes the action through the port and returns the source's own receipt", async () => {
    const ports = makeFixturePorts();
    const result = await runUserAction(ports, CTX, {
      type: "like",
      connectorId: FIXTURE_CONNECTOR_ID,
      externalRef: "fake:short-1",
      itemId: ITEM_A,
      payload: { surface: "short" },
    });
    expect(result.ok && result.value.status).toBe("confirmed");
    expect(ports.connector.recordedLikes()).toEqual(["fake:short-1"]);
  });
});
