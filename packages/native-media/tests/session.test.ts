import { describe, expect, it } from "bun:test";

import type { NativeMediaSession } from "@wfx/domain";

import {
  ALLOWED_TRANSITIONS,
  InvalidTransitionError,
  isSessionState,
  makeSession,
  NativeMediaError,
  SESSION_STATES,
  canTransition,
  transition,
} from "../src/index";

describe("SESSION_STATES — frozen union mirror", () => {
  it("lists the six frozen NativeMediaSession states, in order", () => {
    expect([...SESSION_STATES]).toEqual([
      "resolving",
      "buffering",
      "playing",
      "background",
      "complete",
      "failed",
    ]);
  });

  it("contains no duplicates", () => {
    expect(new Set(SESSION_STATES).size).toBe(SESSION_STATES.length);
  });

  it("isSessionState accepts every state and rejects garbage", () => {
    for (const state of SESSION_STATES) {
      expect(isSessionState(state)).toBe(true);
    }
    expect(isSessionState("paused")).toBe(false);
    expect(isSessionState("")).toBe(false);
    expect(isSessionState(42)).toBe(false);
    expect(isSessionState(null)).toBe(false);
    expect(isSessionState(undefined)).toBe(false);
  });
});

describe("ALLOWED_TRANSITIONS — the closed graph", () => {
  it("defines an entry for every session state", () => {
    for (const state of SESSION_STATES) {
      expect(Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, state)).toBe(true);
    }
  });

  it("terminal states have no outgoing transitions", () => {
    expect(ALLOWED_TRANSITIONS.complete).toEqual([]);
    expect(ALLOWED_TRANSITIONS.failed).toEqual([]);
  });

  it("models the task graph: resolving→buffering→playing⇄background, terminal complete|failed", () => {
    expect(canTransition("resolving", "buffering")).toBe(true);
    expect(canTransition("buffering", "playing")).toBe(true);
    expect(canTransition("playing", "background")).toBe(true);
    expect(canTransition("background", "playing")).toBe(true);
    expect(canTransition("playing", "complete")).toBe(true);
  });

  it("models background completion (background→complete) per the frozen architecture", () => {
    expect(canTransition("background", "complete")).toBe(true);
  });

  it("failed is reachable from every live state", () => {
    expect(canTransition("resolving", "failed")).toBe(true);
    expect(canTransition("buffering", "failed")).toBe(true);
    expect(canTransition("playing", "failed")).toBe(true);
    expect(canTransition("background", "failed")).toBe(true);
  });

  it("rejects the documented illegal hops", () => {
    expect(canTransition("resolving", "complete")).toBe(false);
    expect(canTransition("resolving", "playing")).toBe(false);
    expect(canTransition("buffering", "background")).toBe(false);
    expect(canTransition("playing", "resolving")).toBe(false);
    expect(canTransition("complete", "playing")).toBe(false);
    expect(canTransition("failed", "playing")).toBe(false);
    expect(canTransition("complete", "failed")).toBe(false);
  });

  it("is total for unknown states (answers false, never throws)", () => {
    expect(canTransition("bogus" as never, "playing")).toBe(false);
    expect(canTransition("playing", "bogus" as never)).toBe(false);
    expect(canTransition("bogus" as never, "bogus" as never)).toBe(false);
  });
});

describe("transition — pure state machine", () => {
  const base: NativeMediaSession = {
    id: "s1",
    assetId: "asset-1",
    fileId: "file-1",
    state: "resolving",
    bufferedMs: 0,
    positionMs: 0,
  };

  it("walks the legal path resolving→buffering→playing→background→playing→complete", () => {
    let s = transition(base, "buffering");
    expect(s.state).toBe("buffering");
    s = transition(s, "playing");
    expect(s.state).toBe("playing");
    s = transition(s, "background");
    expect(s.state).toBe("background");
    s = transition(s, "playing");
    expect(s.state).toBe("playing");
    s = transition(s, "complete");
    expect(s.state).toBe("complete");
  });

  it("returns a NEW object and never mutates the input (purity)", () => {
    const next = transition(base, "buffering");
    expect(next).not.toBe(base);
    expect(next).toEqual({ ...base, state: "buffering" });
    expect(base.state).toBe("resolving"); // input untouched
  });

  it("preserves every other session field", () => {
    const rich: NativeMediaSession = {
      id: "s2",
      assetId: "a",
      fileId: "f",
      state: "buffering",
      bufferedMs: 12_345,
      positionMs: 6_789,
    };
    expect(transition(rich, "playing")).toEqual({ ...rich, state: "playing" });
  });

  it("resolving→complete throws InvalidTransitionError (illegal hop)", () => {
    expect(() => transition(base, "complete")).toThrow(InvalidTransitionError);
  });

  it("throws InvalidTransitionError for terminal→anything", () => {
    const done = transition(transition(transition(base, "buffering"), "playing"), "complete");
    expect(() => transition(done, "playing")).toThrow(InvalidTransitionError);
    expect(() => transition(done, "failed")).toThrow(InvalidTransitionError);
  });

  it("throws InvalidTransitionError for unknown target state", () => {
    expect(() => transition(base, "paused" as never)).toThrow(InvalidTransitionError);
  });

  it("throws InvalidTransitionError when the session state itself is garbage", () => {
    const corrupted = { ...base, state: "bogus" } as unknown as NativeMediaSession;
    expect(() => transition(corrupted, "playing")).toThrow(InvalidTransitionError);
  });

  it("InvalidTransitionError carries from/to and a descriptive message", () => {
    try {
      transition(base, "complete");
      throw new Error("expected InvalidTransitionError");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      const ite = e as InvalidTransitionError;
      expect(ite.name).toBe("InvalidTransitionError");
      expect(ite.from).toBe("resolving");
      expect(ite.to).toBe("complete");
      expect(ite.message).toContain("resolving");
      expect(ite.message).toContain("complete");
    }
  });
});

describe("makeSession — validated factory", () => {
  it("builds a session with documented defaults (resolving, 0, 0)", () => {
    expect(makeSession({ id: "m1", assetId: "a", fileId: "f" })).toEqual({
      id: "m1",
      assetId: "a",
      fileId: "f",
      state: "resolving",
      bufferedMs: 0,
      positionMs: 0,
    });
  });

  it("accepts explicit state, bufferedMs, and positionMs", () => {
    expect(
      makeSession({ id: "m2", assetId: "a", fileId: "f", state: "playing", bufferedMs: 10, positionMs: 4 }),
    ).toEqual({
      id: "m2",
      assetId: "a",
      fileId: "f",
      state: "playing",
      bufferedMs: 10,
      positionMs: 4,
    });
  });

  it("throws typed INVALID_INPUT for every malformed field", () => {
    const bad = (input: unknown) => () => makeSession(input as never);
    expect(bad({})).toThrow(NativeMediaError);
    expect(bad(null)).toThrow(NativeMediaError);
    expect(bad(undefined)).toThrow(NativeMediaError);
    expect(bad("nope")).toThrow(NativeMediaError);
    expect(bad({ id: "", assetId: "a", fileId: "f" })).toThrow(NativeMediaError);
    expect(bad({ id: "   ", assetId: "a", fileId: "f" })).toThrow(NativeMediaError);
    expect(bad({ id: "m", assetId: "", fileId: "f" })).toThrow(NativeMediaError);
    expect(bad({ id: "m", assetId: "a", fileId: "" })).toThrow(NativeMediaError);
    expect(bad({ id: "m", assetId: "a", fileId: "f", state: "paused" })).toThrow(NativeMediaError);
    expect(bad({ id: "m", assetId: "a", fileId: "f", bufferedMs: -1 })).toThrow(NativeMediaError);
    expect(bad({ id: "m", assetId: "a", fileId: "f", bufferedMs: Number.NaN })).toThrow(NativeMediaError);
    expect(bad({ id: "m", assetId: "a", fileId: "f", bufferedMs: Number.POSITIVE_INFINITY })).toThrow(NativeMediaError);
    expect(bad({ id: "m", assetId: "a", fileId: "f", positionMs: -5 })).toThrow(NativeMediaError);
    expect(bad({ id: "m", assetId: "a", fileId: "f", positionMs: "10" as never })).toThrow(NativeMediaError);
  });

  it("validation failures carry the INVALID_INPUT code and a field-naming detail", () => {
    try {
      makeSession({ id: "", assetId: "a", fileId: "f" });
      throw new Error("expected NativeMediaError");
    } catch (e) {
      const nme = e as NativeMediaError;
      expect(nme).toBeInstanceOf(NativeMediaError);
      expect(nme.code).toBe("INVALID_INPUT");
      expect(nme.detail).toContain("id");
    }
  });
});
