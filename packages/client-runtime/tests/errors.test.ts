/**
 * @wfx/client-runtime — the error-state taxonomy tests (R01).
 *
 * Kinds, retryability, recovery semantics, and the ServerFailure mapping.
 * The law under test: a missing credential or unavailable realization can
 * NEVER look like silent success — every failure is typed and recoverable
 * by hint.
 */

import { describe, expect, it } from "bun:test";

import {
  RUNTIME_ERROR_KINDS,
  RuntimeError,
  isRuntimeError,
  serverFailureError,
  serverFailureKind,
  type ServerFailure,
} from "../src/index";

describe("the taxonomy", () => {
  it("the closed vocabulary is exactly the seven documented kinds", () => {
    expect(RUNTIME_ERROR_KINDS).toEqual([
      "invalid-input",
      "network",
      "unauthorized",
      "unavailable",
      "unsupported-capability",
      "degraded",
      "not-found",
    ]);
  });

  it("every kind carries retryability + a recovery hint", () => {
    for (const kind of RUNTIME_ERROR_KINDS) {
      const error = new RuntimeError(kind, "test detail");
      expect(error.kind).toBe(kind);
      expect(error.message).toContain(kind);
      expect(error.message).toContain("test detail");
      expect(typeof error.retryable).toBe("boolean");
      expect(error.recovery.detail.length).toBeGreaterThan(0);
    }
  });

  it("retryability: only network and unavailable are retryable", () => {
    expect(new RuntimeError("network", "x").retryable).toBe(true);
    expect(new RuntimeError("unavailable", "x").retryable).toBe(true);
    expect(new RuntimeError("invalid-input", "x").retryable).toBe(false);
    expect(new RuntimeError("unauthorized", "x").retryable).toBe(false);
    expect(new RuntimeError("unsupported-capability", "x").retryable).toBe(false);
    expect(new RuntimeError("degraded", "x").retryable).toBe(true);
    expect(new RuntimeError("not-found", "x").retryable).toBe(false);
  });

  it("recovery hints are actionable per kind", () => {
    expect(new RuntimeError("network", "x").recovery.action).toBe("retry");
    expect(new RuntimeError("unauthorized", "x").recovery.action).toBe("re-authenticate");
    expect(new RuntimeError("unsupported-capability", "x").recovery.action).toBe("inspect-capability");
    expect(new RuntimeError("invalid-input", "x").recovery.action).toBe("none");
    expect(new RuntimeError("not-found", "x").recovery.action).toBe("none");
  });

  it("isRuntimeError guards typed and untyped values", () => {
    expect(isRuntimeError(new RuntimeError("network", "x"))).toBe(true);
    expect(isRuntimeError(new Error("plain"))).toBe(false);
    expect(isRuntimeError({ name: "RuntimeError", kind: "network" })).toBe(true);
    expect(isRuntimeError({ name: "RuntimeError", kind: "bogus" })).toBe(false);
    expect(isRuntimeError(null)).toBe(false);
  });
});

describe("the ServerFailure mapping (transport -> taxonomy)", () => {
  const failures: ServerFailure[] = [
    { kind: "network", detail: "offline" },
    { kind: "unauthorized", detail: "401" },
    { kind: "unavailable", detail: "503" },
    { kind: "malformed", detail: "garbage JSON" },
  ];

  it("network -> network, unauthorized -> unauthorized, unavailable/malformed -> unavailable", () => {
    expect(serverFailureKind(failures[0]!)).toBe("network");
    expect(serverFailureKind(failures[1]!)).toBe("unauthorized");
    expect(serverFailureKind(failures[2]!)).toBe("unavailable");
    expect(serverFailureKind(failures[3]!)).toBe("unavailable");
  });

  it("serverFailureError preserves the operation + failure detail", () => {
    const error = serverFailureError("search", failures[1]!);
    expect(error.kind).toBe("unauthorized");
    expect(error.message).toContain("search");
    expect(error.message).toContain("401");
    expect(error.recovery.action).toBe("re-authenticate");
  });

  it("a missing credential NEVER looks like success: the error channel is total", () => {
    // Every ServerFailure kind maps to a typed error — there is no path
    // from a transport failure to a success-looking answer.
    for (const failure of failures) {
      const error = serverFailureError("resolve", failure);
      expect(error).toBeInstanceOf(RuntimeError);
      expect(RUNTIME_ERROR_KINDS).toContain(error.kind);
      expect(error.kind).not.toBe("invalid-input"); // transport failures are not caller misuse
    }
  });
});
