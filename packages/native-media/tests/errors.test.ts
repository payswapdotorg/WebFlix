import { describe, expect, it } from "bun:test";

import {
  InvalidTransitionError,
  isNativeMediaError,
  isNativeMediaErrorCode,
  isRetryable,
  NativeMediaError,
  NATIVE_MEDIA_ERROR_CODES,
  RETRYABLE_ERROR_CODES,
} from "../src/index";

describe("NATIVE_MEDIA_ERROR_CODES — closed taxonomy", () => {
  it("contains exactly the nine task-packet codes, in order, without duplicates", () => {
    expect([...NATIVE_MEDIA_ERROR_CODES]).toEqual([
      "INVALID_INPUT",
      "UNSUPPORTED_SOURCE",
      "NOT_FOUND",
      "IO_ERROR",
      "VERIFICATION_FAILED",
      "RANGE_NOT_SATISFIABLE",
      "SESSION_CLOSED",
      "ENGINE_TIMEOUT",
      "INTERNAL",
    ]);
    expect(new Set(NATIVE_MEDIA_ERROR_CODES).size).toBe(NATIVE_MEDIA_ERROR_CODES.length);
  });

  it("isNativeMediaErrorCode discriminates members and rejects everything else", () => {
    for (const code of NATIVE_MEDIA_ERROR_CODES) {
      expect(isNativeMediaErrorCode(code)).toBe(true);
    }
    expect(isNativeMediaErrorCode("SOME_OTHER_CODE")).toBe(false);
    expect(isNativeMediaErrorCode("")).toBe(false);
    expect(isNativeMediaErrorCode(42)).toBe(false);
    expect(isNativeMediaErrorCode(null)).toBe(false);
  });
});

describe("isRetryable — the retryability table", () => {
  it("marks exactly IO_ERROR and ENGINE_TIMEOUT as retryable", () => {
    expect([...RETRYABLE_ERROR_CODES]).toEqual(["IO_ERROR", "ENGINE_TIMEOUT"]);
    for (const code of NATIVE_MEDIA_ERROR_CODES) {
      const expected = code === "IO_ERROR" || code === "ENGINE_TIMEOUT";
      expect(isRetryable(code)).toBe(expected);
    }
  });
});

describe("NativeMediaError — the typed error class", () => {
  it("carries code, derives retryable from the table, and names itself", () => {
    const e = new NativeMediaError("IO_ERROR", { detail: "disk hiccup", sessionId: "s1" });
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(NativeMediaError);
    expect(e.name).toBe("NativeMediaError");
    expect(e.code).toBe("IO_ERROR");
    expect(e.detail).toBe("disk hiccup");
    expect(e.sessionId).toBe("s1");
    expect(e.retryable).toBe(true);
    expect(e.message).toBe("NativeMediaError: IO_ERROR: disk hiccup");
  });

  it("detail and sessionId stay absent when not provided (no undefined materialization)", () => {
    const e = new NativeMediaError("INTERNAL");
    expect("detail" in e).toBe(false);
    expect("sessionId" in e).toBe(false);
    expect(e.message).toBe("NativeMediaError: INTERNAL");
    expect(e.retryable).toBe(false);
  });

  it("retryable always mirrors isRetryable for every code", () => {
    for (const code of NATIVE_MEDIA_ERROR_CODES) {
      const e = new NativeMediaError(code);
      expect(e.retryable).toBe(isRetryable(code));
    }
  });

  it("preserves the underlying cause", () => {
    const root = new Error("root cause");
    const e = new NativeMediaError("IO_ERROR", { detail: "wrapped", cause: root });
    expect(e.cause).toBe(root);
  });
});

describe("isNativeMediaError — type guard", () => {
  it("accepts real instances", () => {
    expect(isNativeMediaError(new NativeMediaError("INTERNAL"))).toBe(true);
    expect(isNativeMediaError(new NativeMediaError("RANGE_NOT_SATISFIABLE", { sessionId: "s" }))).toBe(true);
  });

  it("accepts structurally valid lookalikes (serialized/across boundaries)", () => {
    const lookalike = {
      name: "NativeMediaError",
      code: "IO_ERROR",
      retryable: true,
      detail: "crossed a boundary",
      message: "NativeMediaError: IO_ERROR: crossed a boundary",
    };
    expect(isNativeMediaError(lookalike)).toBe(true);
  });

  it("rejects plain Errors, impostors, and non-objects", () => {
    expect(isNativeMediaError(new Error("plain"))).toBe(false);
    expect(isNativeMediaError(new InvalidTransitionError("a", "b"))).toBe(false);
    expect(isNativeMediaError({ name: "OtherError", code: "IO_ERROR", retryable: true })).toBe(false);
    expect(isNativeMediaError({ name: "NativeMediaError", code: "MADE_UP", retryable: true })).toBe(false);
    expect(isNativeMediaError({ name: "NativeMediaError", code: "IO_ERROR" })).toBe(false); // missing retryable
    expect(isNativeMediaError({ name: "NativeMediaError", code: "IO_ERROR", retryable: "yes" })).toBe(false);
    expect(isNativeMediaError("NativeMediaError")).toBe(false);
    expect(isNativeMediaError(42)).toBe(false);
    expect(isNativeMediaError(null)).toBe(false);
    expect(isNativeMediaError(undefined)).toBe(false);
  });

  it("rejects lookalikes with malformed optional fields", () => {
    expect(isNativeMediaError({ name: "NativeMediaError", code: "IO_ERROR", retryable: true, detail: 7 })).toBe(false);
    expect(isNativeMediaError({ name: "NativeMediaError", code: "IO_ERROR", retryable: true, sessionId: 3 })).toBe(false);
  });
});

describe("InvalidTransitionError — FSM programmer error", () => {
  it("is an Error carrying from/to and a descriptive message", () => {
    const e = new InvalidTransitionError("resolving", "complete");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("InvalidTransitionError");
    expect(e.from).toBe("resolving");
    expect(e.to).toBe("complete");
    expect(e.message).toContain("resolving");
    expect(e.message).toContain("complete");
  });

  it("is NOT a NativeMediaError (programmer error, never an envelope error)", () => {
    expect(new InvalidTransitionError("a", "b")).not.toBeInstanceOf(NativeMediaError);
    expect(isNativeMediaError(new InvalidTransitionError("a", "b"))).toBe(false);
  });
});
