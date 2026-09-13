import { describe, expect, it } from "bun:test";

import type { ConnectorDescriptor, SourceConnector } from "@wfx/domain";

import {
  describeThrown,
  isUsableReceipt,
  connectorHas,
  makeFixturePorts,
  type ConnectorPort,
  type ExperienceContext,
  ExperienceError,
  assertValidExperienceContext,
  FIXTURE_CONNECTOR_ID,
} from "../src/index";

const CTX: ExperienceContext = { userId: "user-1", sessionId: "sess-1", locale: "en", region: "EU" };

describe("experience ports (WFX-005)", () => {
  it("the fixture connector satisfies the ConnectorPort seam at runtime", async () => {
    const ports = makeFixturePorts();
    const connector: ConnectorPort = ports.connector;
    expect(typeof connector.descriptor).toBe("function");
    expect(typeof connector.search).toBe("function");
    expect(typeof connector.metadata).toBe("function");
    expect(typeof connector.resolve).toBe("function");
    expect(typeof connector.executeAction).toBe("function");
    expect(typeof connector.readLibrary).toBe("function");
    expect(typeof connector.writeLibrary).toBe("function");

    const descriptor: ConnectorDescriptor = connector.descriptor();
    expect(descriptor.id).toBe(FIXTURE_CONNECTOR_ID);
    expect(descriptor.auth).toBe("none");

    // The ExperienceContext is structurally a frozen ConnectorContext.
    const hits = await connector.search(CTX, "rain");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("connectorHas answers the descriptor capability truth", () => {
    const ports = makeFixturePorts();
    expect(connectorHas(ports.connector, "catalogSearch")).toBe(true);
    expect(connectorHas(ports.connector, "like")).toBe(true);
    expect(connectorHas(ports.connector, "comment")).toBe(false);
    expect(connectorHas(ports.connector, "download")).toBe(false);
    expect(connectorHas(ports.connector, "transform")).toBe(false);
  });

  it("a SourceConnector-shaped object is usable as the port (runtime mirror of the compile-time assertion)", async () => {
    // The compile-time proof lives in src/ports.ts (the _SourceConnectorSatisfiesConnectorPort
    // assertion, the infer.ts pattern). This exercises the same fact at runtime.
    const ports = makeFixturePorts();
    const asConnector: SourceConnector = ports.connector;
    const viaPort: ConnectorPort = asConnector;
    expect(await viaPort.search(CTX, "drift")).toHaveLength(1);
  });

  it("assertValidExperienceContext accepts a well-formed context", () => {
    expect(() => assertValidExperienceContext(CTX)).not.toThrow();
  });

  it("assertValidExperienceContext rejects every malformed context with typed errors", () => {
    const cases: unknown[] = [
      null,
      { userId: "", sessionId: "s", locale: "en" },
      { userId: "u", sessionId: "", locale: "en" },
      { userId: "u", sessionId: "s", locale: "" },
      { userId: "u", sessionId: "s", locale: "en", region: 7 },
    ];
    for (const bad of cases) {
      let thrown: unknown;
      try {
        assertValidExperienceContext(bad as ExperienceContext);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ExperienceError);
      const typed = thrown as ExperienceError;
      expect(typed.kind).toBe("invalid-input");
      expect(typed.details.length).toBeGreaterThan(0);
      expect(typed.message).toContain("invalid experience-api input");
    }
  });

  it("assertValidExperienceContext aggregates all problems into the details", () => {
    let thrown: unknown;
    try {
      assertValidExperienceContext({ userId: "u", sessionId: "", locale: 1 } as unknown as ExperienceContext);
    } catch (error) {
      thrown = error;
    }
    const typed = thrown as ExperienceError;
    expect(typed.details).toHaveLength(2);
  });

  it("ExperienceError carries kind, details, and a joined message", () => {
    const error = new ExperienceError(["problem one", "problem two"]);
    expect(error.kind).toBe("invalid-input");
    expect(error.details).toEqual(["problem one", "problem two"]);
    expect(error.message).toBe("invalid experience-api input: problem one; problem two");
    expect(error.name).toBe("ExperienceError");
  });

  it("describeThrown formats Errors and other values", () => {
    expect(describeThrown(new TypeError("nope"))).toBe("TypeError: nope");
    expect(describeThrown("plain string")).toBe('"plain string"');
    expect(describeThrown(42)).toBe("42");
  });

  it("isUsableReceipt accepts well-formed receipts and rejects malformed ones", () => {
    expect(isUsableReceipt({ status: "confirmed", occurredAt: "2026-09-13T00:00:00.000Z" })).toBe(true);
    expect(
      isUsableReceipt({
        status: "local-only",
        externalId: "x-1",
        detail: "recorded locally",
        occurredAt: "2026-09-13T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(isUsableReceipt({ status: "confirmed" })).toBe(false); // missing occurredAt
    expect(isUsableReceipt({ status: "maybe", occurredAt: "2026-09-13T00:00:00.000Z" })).toBe(false);
    expect(isUsableReceipt({ status: "confirmed", occurredAt: "yesterday" })).toBe(false);
    expect(isUsableReceipt(null)).toBe(false);
    expect(isUsableReceipt("confirmed")).toBe(false);
  });
});
