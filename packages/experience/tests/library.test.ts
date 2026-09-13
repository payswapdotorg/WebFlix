import { describe, expect, it } from "bun:test";

import {
  ExperienceError,
  FIXTURE_OCCURRED_AT,
  FIXTURE_CONNECTOR_ID,
  getLibrary,
  makeFixturePorts,
  removeFromLibrary,
  saveToLibrary,
  type ConnectorPort,
  type ExperienceContext,
  type Ports,
} from "../src/index";

const CTX: ExperienceContext = { userId: "user-1", sessionId: "sess-1", locale: "en", region: "EU" };

/** A port that declares libraryRead but does NOT expose readLibrary(). */
function portWithoutReadMethod(): Ports {
  const base = makeFixturePorts();
  const connector: ConnectorPort = {
    descriptor: () => base.connector.descriptor(), // declares libraryRead
    search: () => Promise.resolve([]),
    metadata: () => Promise.resolve(null),
    resolve: () => Promise.resolve([]),
    executeAction: () => Promise.resolve({ status: "failed", occurredAt: FIXTURE_OCCURRED_AT }),
    // readLibrary deliberately omitted
  };
  return { connector, events: base.events, clock: base.clock, ids: base.ids };
}

/** A port that declares libraryWrite but does NOT expose writeLibrary(). */
function portWithoutWriteMethod(): Ports {
  const base = makeFixturePorts();
  const connector: ConnectorPort = {
    descriptor: () => base.connector.descriptor(), // declares libraryWrite
    search: () => Promise.resolve([]),
    metadata: () => Promise.resolve(null),
    resolve: () => Promise.resolve([]),
    executeAction: () => Promise.resolve({ status: "failed", occurredAt: FIXTURE_OCCURRED_AT }),
    // writeLibrary deliberately omitted
  };
  return { connector, events: base.events, clock: base.clock, ids: base.ids };
}

describe("getLibrary (WFX-005)", () => {
  it("reads the seeded connector-side library through the port", async () => {
    const ports = makeFixturePorts();
    const result = await getLibrary(ports, CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((entry) => entry.externalRef)).toEqual(["fake:movie-1", "fake:short-1"]);
    expect(result.value[0]?.connectorId).toBe(FIXTURE_CONNECTOR_ID);
    expect(result.value[0]?.addedAt).toBe(FIXTURE_OCCURRED_AT);
  });

  it("answers typed unsupported when the connector does not declare libraryRead", async () => {
    const ports = makeFixturePorts({
      capabilities: ["catalogSearch", "metadata", "playEmbed", "libraryWrite", "like"],
    });
    const result = await getLibrary(ports, CTX);
    expect(result).toEqual({
      ok: false,
      reason: "unsupported",
      capability: "libraryRead",
      detail: expect.stringContaining("does not declare 'libraryRead'"),
    });
  });

  it("answers typed unsupported when the capability is declared but the method is missing", async () => {
    const result = await getLibrary(portWithoutReadMethod(), CTX);
    expect(result).toEqual({
      ok: false,
      reason: "unsupported",
      capability: "libraryRead",
      detail: expect.stringContaining("does not expose readLibrary()"),
    });
  });

  it("answers typed port-failed when readLibrary rejects", async () => {
    const base = makeFixturePorts();
    const ports: Ports = {
      connector: {
        descriptor: () => base.connector.descriptor(),
        search: () => Promise.resolve([]),
        metadata: () => Promise.resolve(null),
        resolve: () => Promise.resolve([]),
        executeAction: () => Promise.resolve({ status: "failed", occurredAt: FIXTURE_OCCURRED_AT }),
        readLibrary: () => Promise.reject(new Error("library exploded")),
      },
      events: base.events,
      clock: base.clock,
      ids: base.ids,
    };
    const result = await getLibrary(ports, CTX);
    expect(result).toEqual({
      ok: false,
      reason: "port-failed",
      operation: "readLibrary",
      detail: expect.stringContaining("library exploded"),
    });
  });

  it("drops malformed entries instead of fabricating or crashing", async () => {
    const base = makeFixturePorts();
    const ports: Ports = {
      connector: {
        descriptor: () => base.connector.descriptor(),
        search: () => Promise.resolve([]),
        metadata: () => Promise.resolve(null),
        resolve: () => Promise.resolve([]),
        executeAction: () => Promise.resolve({ status: "failed", occurredAt: FIXTURE_OCCURRED_AT }),
        readLibrary: () =>
          Promise.resolve([
            { connectorId: FIXTURE_CONNECTOR_ID, externalRef: "fake:good-1", title: "Good" },
            { connectorId: "", externalRef: "fake:bad-1", title: "Bad" }, // malformed
            "not-an-entry" as unknown as never,
          ]),
      },
      events: base.events,
      clock: base.clock,
      ids: base.ids,
    };
    const result = await getLibrary(ports, CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.externalRef).toBe("fake:good-1");
  });
});

describe("saveToLibrary / removeFromLibrary (WFX-005)", () => {
  it("saves through writeLibrary with an op:add LibraryCommand", async () => {
    const ports = makeFixturePorts();
    const receipt = await saveToLibrary(ports, CTX, {
      externalRef: "fake:video-1",
      title: "Deep Field Diary",
    });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    expect(receipt.value.status).toBe("confirmed");

    const library = await getLibrary(ports, CTX);
    expect(library.ok && library.value.map((entry) => entry.externalRef)).toContain("fake:video-1");
    const saved = ports.connector.libraryEntries().find((entry) => entry.externalRef === "fake:video-1");
    expect(saved?.title).toBe("Deep Field Diary");
    expect(saved?.addedAt).toBe(FIXTURE_OCCURRED_AT);
  });

  it("carries optional title and metadata through the command", async () => {
    const ports = makeFixturePorts();
    await saveToLibrary(ports, CTX, {
      externalRef: "fake:video-3",
      title: "Desert Rain Doc",
      metadata: { addedFrom: "feed-card" },
    });
    const saved = ports.connector.libraryEntries().find((entry) => entry.externalRef === "fake:video-3");
    expect(saved?.metadata).toEqual({ addedFrom: "feed-card" });
  });

  it("removes through writeLibrary with an op:remove LibraryCommand", async () => {
    const ports = makeFixturePorts();
    const receipt = await removeFromLibrary(ports, CTX, { externalRef: "fake:short-1" });
    expect(receipt.ok && receipt.value.status).toBe("confirmed");
    const library = await getLibrary(ports, CTX);
    expect(library.ok && library.value.map((entry) => entry.externalRef)).toEqual(["fake:movie-1"]);
  });

  it("answers typed unsupported without libraryWrite (capability or method)", async () => {
    const noCap = makeFixturePorts({ capabilities: ["catalogSearch", "metadata", "libraryRead"] });
    const byCap = await saveToLibrary(noCap, CTX, { externalRef: "fake:movie-1" });
    expect(byCap).toEqual({
      ok: false,
      reason: "unsupported",
      capability: "libraryWrite",
      detail: expect.stringContaining("does not declare 'libraryWrite'"),
    });
    const byMethod = await removeFromLibrary(portWithoutWriteMethod(), CTX, { externalRef: "fake:movie-1" });
    expect(byMethod).toEqual({
      ok: false,
      reason: "unsupported",
      capability: "libraryWrite",
      detail: expect.stringContaining("does not expose writeLibrary()"),
    });
  });

  it("answers typed port-failed when writeLibrary rejects or returns garbage", async () => {
    const base = makeFixturePorts();
    const rejecting: Ports = {
      connector: {
        descriptor: () => base.connector.descriptor(),
        search: () => Promise.resolve([]),
        metadata: () => Promise.resolve(null),
        resolve: () => Promise.resolve([]),
        executeAction: () => Promise.resolve({ status: "failed", occurredAt: FIXTURE_OCCURRED_AT }),
        writeLibrary: () => Promise.reject(new Error("write exploded")),
      },
      events: base.events,
      clock: base.clock,
      ids: base.ids,
    };
    const rejected = await saveToLibrary(rejecting, CTX, { externalRef: "fake:movie-1" });
    expect(rejected).toEqual({
      ok: false,
      reason: "port-failed",
      operation: "writeLibrary",
      detail: expect.stringContaining("write exploded"),
    });

    const garbage: Ports = {
      connector: {
        descriptor: () => base.connector.descriptor(),
        search: () => Promise.resolve([]),
        metadata: () => Promise.resolve(null),
        resolve: () => Promise.resolve([]),
        executeAction: () => Promise.resolve({ status: "failed", occurredAt: FIXTURE_OCCURRED_AT }),
        writeLibrary: () => Promise.resolve("ok?" as unknown as never),
      },
      events: base.events,
      clock: base.clock,
      ids: base.ids,
    };
    const malformed = await removeFromLibrary(garbage, CTX, { externalRef: "fake:movie-1" });
    expect(malformed).toEqual({
      ok: false,
      reason: "port-failed",
      operation: "writeLibrary",
      detail: expect.stringContaining("expected an ActionReceipt"),
    });
  });

  it("throws the typed ExperienceError for malformed inputs", async () => {
    const ports = makeFixturePorts();
    await expect(saveToLibrary(ports, CTX, { externalRef: "  " })).rejects.toBeInstanceOf(ExperienceError);
    await expect(
      saveToLibrary(ports, CTX, { externalRef: "fake:movie-1", title: 7 as unknown as string }),
    ).rejects.toBeInstanceOf(ExperienceError);
    await expect(
      saveToLibrary(ports, CTX, { externalRef: "fake:movie-1", metadata: "nope" as unknown as Record<string, unknown> }),
    ).rejects.toBeInstanceOf(ExperienceError);
    await expect(removeFromLibrary(ports, CTX, { externalRef: "" })).rejects.toBeInstanceOf(ExperienceError);
  });

  it("returns the source's own receipt when the connector declines at runtime", async () => {
    // The fixture declares libraryWrite; a port whose writeLibrary answers a
    // "local-only" receipt is still ok:true — the receipt is the source's answer.
    const base = makeFixturePorts();
    const ports: Ports = {
      connector: {
        descriptor: () => base.connector.descriptor(),
        search: () => Promise.resolve([]),
        metadata: () => Promise.resolve(null),
        resolve: () => Promise.resolve([]),
        executeAction: () => Promise.resolve({ status: "failed", occurredAt: FIXTURE_OCCURRED_AT }),
        writeLibrary: () =>
          Promise.resolve({ status: "local-only", detail: "queued locally", occurredAt: FIXTURE_OCCURRED_AT }),
      },
      events: base.events,
      clock: base.clock,
      ids: base.ids,
    };
    const result = await saveToLibrary(ports, CTX, { externalRef: "fake:movie-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("local-only");
    expect(result.value.detail).toBe("queued locally");
  });
});
