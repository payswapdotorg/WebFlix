import { describe, expect, it } from "bun:test";

import type { ConnectorDescriptor } from "@wfx/domain";

import {
  CAPABILITIES,
  ConnectorRegistry,
  DuplicateConnectorError,
  DescriptorValidationError,
  makeStubConnector,
  STUB_CONNECTOR_ID,
  type CapabilityMatrixRow,
} from "../src/index";

const DESCRIPTOR_ONLY: ConnectorDescriptor = {
  id: "known-source",
  version: "2.0.0",
  displayName: "Known Source",
  capabilities: ["metadata", "availability"],
  auth: "oauth",
};

describe("ConnectorRegistry — instance registration", () => {
  it("register / get / all round-trip", () => {
    const registry = new ConnectorRegistry();
    const stub = makeStubConnector();

    expect(registry.register(stub)).toBe(registry); // chainable
    expect(registry.get(STUB_CONNECTOR_ID)).toBe(stub);
    expect(registry.all()).toEqual([stub]);
    expect(registry.size()).toBe(1);
    expect(registry.get("unknown-id")).toBeUndefined();
  });

  it("registering garbage throws DescriptorValidationError", () => {
    const registry = new ConnectorRegistry();
    for (const garbage of [null, undefined, 42, "string", { id: "BAD" }]) {
      expect(() => registry.register(garbage as never)).toThrow(DescriptorValidationError);
    }
  });

  it("an instance whose descriptor() throws is reported as a validation error", () => {
    const registry = new ConnectorRegistry();
    const hostile = {
      descriptor: () => {
        throw new Error("boom");
      },
    };
    expect(() => registry.register(hostile as never)).toThrow(DescriptorValidationError);
  });

  it("an instance carrying an invalid descriptor is rejected", () => {
    const registry = new ConnectorRegistry();
    const badDescriptor = {
      descriptor: () => ({ id: "Not-Kebab", version: "1.0.0", displayName: "X", capabilities: [], auth: "none" }),
    };
    expect(() => registry.register(badDescriptor as never)).toThrow(DescriptorValidationError);
  });
});

describe("ConnectorRegistry — duplicate ids throw", () => {
  it("instance + instance collides", () => {
    const registry = new ConnectorRegistry();
    registry.register(makeStubConnector());
    expect(() => registry.register(makeStubConnector())).toThrow(DuplicateConnectorError);
  });

  it("instance + descriptor collides (and vice versa)", () => {
    const registry = new ConnectorRegistry();
    registry.register(makeStubConnector());
    expect(() =>
      registry.register({ ...DESCRIPTOR_ONLY, id: STUB_CONNECTOR_ID }),
    ).toThrow(DuplicateConnectorError);

    const fresh = new ConnectorRegistry();
    fresh.register(DESCRIPTOR_ONLY);
    expect(() => fresh.register({ ...DESCRIPTOR_ONLY })).toThrow(DuplicateConnectorError);
  });

  it("the duplicate error carries the id", () => {
    const registry = new ConnectorRegistry();
    registry.register(makeStubConnector());
    try {
      registry.register(makeStubConnector());
      throw new Error("expected DuplicateConnectorError");
    } catch (caught) {
      expect(caught).toBeInstanceOf(DuplicateConnectorError);
      expect((caught as DuplicateConnectorError).id).toBe(STUB_CONNECTOR_ID);
      expect((caught as DuplicateConnectorError).name).toBe("DuplicateConnectorError");
    }
  });

  it("a failed registration leaves the registry unchanged", () => {
    const registry = new ConnectorRegistry();
    registry.register(makeStubConnector());
    // This one collides on id and must throw:
    expect(() =>
      registry.register({ ...DESCRIPTOR_ONLY, id: STUB_CONNECTOR_ID }),
    ).toThrow(DuplicateConnectorError);
    expect(registry.size()).toBe(1);
    expect(registry.all()).toHaveLength(1);
  });
});

describe("ConnectorRegistry — descriptor-only registration (known but not connected)", () => {
  it("appears in the matrix but not in instance queries", () => {
    const registry = new ConnectorRegistry();
    const stub = makeStubConnector();
    registry.register(stub);
    registry.register(DESCRIPTOR_ONLY);

    expect(registry.size()).toBe(2);
    expect(registry.get("known-source")).toBeUndefined();
    expect(registry.all()).toEqual([stub]); // instances only
    expect(registry.withCapability("metadata")).toEqual([stub]); // instances only
    expect(registry.withCapability("availability")).toEqual([]); // descriptor-only is not live
  });
});

describe("ConnectorRegistry — capability queries", () => {
  it("withCapability filters by declared capabilities", () => {
    const registry = new ConnectorRegistry();
    const stub = makeStubConnector(); // catalogSearch, metadata, playEmbed
    registry.register(stub);

    expect(registry.withCapability("playEmbed")).toEqual([stub]);
    expect(registry.withCapability("catalogSearch")).toEqual([stub]);
    expect(registry.withCapability("libraryWrite")).toEqual([]);
    expect(registry.withCapability("download")).toEqual([]);
  });
});

describe("ConnectorRegistry — capabilityMatrix (id × capability truth table)", () => {
  it("covers every registration with all 16 capability columns", () => {
    const registry = new ConnectorRegistry();
    registry.register(makeStubConnector());
    registry.register(DESCRIPTOR_ONLY);

    const matrix = registry.capabilityMatrix();
    expect(matrix).toHaveLength(2);
    // sorted by id for deterministic rendering
    expect(matrix.map((row: CapabilityMatrixRow) => row.id)).toEqual([
      "known-source",
      "stub-test",
    ]);

    const stubRow = matrix.find((row) => row.id === "stub-test");
    expect(stubRow).toBeDefined();
    expect(Object.keys(stubRow?.capabilities ?? {})).toHaveLength(CAPABILITIES.length);
    for (const cap of CAPABILITIES) {
      expect(stubRow?.capabilities[cap]).toBe(
        ["catalogSearch", "metadata", "playEmbed"].includes(cap),
      );
    }
    expect(stubRow?.hasInstance).toBe(true);
    expect(stubRow?.displayName).toBe(
      "Stub Test Connector (TEST FIXTURE — never production)",
    );
    expect(stubRow?.version).toBe("0.1.0");
    expect(stubRow?.auth).toBe("none");

    const knownRow = matrix.find((row) => row.id === "known-source");
    expect(knownRow?.hasInstance).toBe(false);
    expect(knownRow?.capabilities["metadata"]).toBe(true);
    expect(knownRow?.capabilities["playNative"]).toBe(false);
    expect(knownRow?.auth).toBe("oauth");
  });

  it("rows are frozen (UI cannot lie by mutating the matrix)", () => {
    const registry = new ConnectorRegistry();
    registry.register(makeStubConnector());
    const row = registry.capabilityMatrix()[0];
    expect(Object.isFrozen(row)).toBe(true);
    expect(Object.isFrozen(row?.capabilities)).toBe(true);
  });

  it("empty registry yields an empty matrix", () => {
    expect(new ConnectorRegistry().capabilityMatrix()).toEqual([]);
  });
});
