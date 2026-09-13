import { describe, expect, it } from "bun:test";

import {
  describeConnectorError,
  errResult,
  invalidInput,
  isConnectorError,
  isInvalidInput,
  isOk,
  isErr,
  isTransport,
  isUnauthorized,
  isUnsupported,
  okResult,
  transport,
  unauthorized,
  unsupported,
  type ConnectorError,
} from "../src/index";

describe("ConnectorError constructors", () => {
  it("unsupported carries kind + capability, detail only when given", () => {
    const bare = unsupported("like");
    expect(bare).toEqual({ kind: "unsupported", capability: "like" });
    expect("detail" in bare).toBe(false);

    const detailed = unsupported("save", "not declared");
    expect(detailed).toEqual({
      kind: "unsupported",
      capability: "save",
      detail: "not declared",
    });
  });

  it("unauthorized carries kind + connectorId", () => {
    expect(unauthorized("archive-org")).toEqual({
      kind: "unauthorized",
      connectorId: "archive-org",
    });
  });

  it("transport carries kind + connectorId + detail", () => {
    expect(transport("some-source", "socket hang up")).toEqual({
      kind: "transport",
      connectorId: "some-source",
      detail: "socket hang up",
    });
  });

  it("invalid-input carries kind + detail", () => {
    expect(invalidInput("query must be a string")).toEqual({
      kind: "invalid-input",
      detail: "query must be a string",
    });
  });
});

describe("ConnectorError type guards", () => {
  const errors: ConnectorError[] = [
    unsupported("like"),
    unauthorized("a"),
    transport("a", "down"),
    invalidInput("bad"),
  ];

  it("each guard discriminates its own kind only", () => {
    for (const error of errors) {
      expect(isUnsupported(error)).toBe(error.kind === "unsupported");
      expect(isUnauthorized(error)).toBe(error.kind === "unauthorized");
      expect(isTransport(error)).toBe(error.kind === "transport");
      expect(isInvalidInput(error)).toBe(error.kind === "invalid-input");
    }
  });

  it("isConnectorError accepts all four shapes and rejects impostors", () => {
    for (const error of errors) {
      expect(isConnectorError(error)).toBe(true);
    }
    const impostors: unknown[] = [
      null,
      undefined,
      "unsupported",
      42,
      {},
      { kind: "bogus" },
      { kind: "unsupported" }, // missing capability
      { kind: "unauthorized" }, // missing connectorId
      { kind: "transport", connectorId: "a" }, // missing detail
      { kind: "invalid-input" }, // missing detail
      { ok: true, value: 1 },
    ];
    for (const impostor of impostors) {
      expect(isConnectorError(impostor)).toBe(false);
    }
  });
});

describe("ConnectorResult helpers", () => {
  it("okResult / errResult build the envelope", () => {
    expect(okResult([1, 2])).toEqual({ ok: true, value: [1, 2] });
    const error = invalidInput("nope");
    expect(errResult<string>(error)).toEqual({ ok: false, error });
  });

  it("isOk / isErr narrow", () => {
    expect(isOk(okResult("x"))).toBe(true);
    expect(isErr(okResult("x"))).toBe(false);
    expect(isOk(errResult(invalidInput("x")))).toBe(false);
    expect(isErr(errResult(invalidInput("x")))).toBe(true);
    // null and void values are legitimate successes
    expect(isOk(okResult<string | null>(null))).toBe(true);
  });

  it("describeConnectorError always names the kind", () => {
    expect(describeConnectorError(unsupported("like"))).toContain("unsupported");
    expect(describeConnectorError(unsupported("like"))).toContain("like");
    expect(describeConnectorError(unauthorized("c1"))).toContain("unauthorized");
    expect(describeConnectorError(transport("c1", "down"))).toContain("transport");
    expect(describeConnectorError(invalidInput("bad"))).toContain("invalid-input");
  });
});
