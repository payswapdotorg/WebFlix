/**
 * R12 — the playback scheduler state machine (pure transition tests).
 *
 * The closed graph, the guard's totality for garbage, and the FSM class's
 * throw-on-illegal discipline (the R11 `InvalidTorrentTransitionError`
 * precedent: illegal internal hops are programmer errors, never enveloped).
 */

import { describe, expect, it } from "bun:test";

import {
  ALLOWED_PLAYBACK_SCHEDULER_TRANSITIONS,
  InvalidPlaybackSchedulerTransitionError,
  PLAYBACK_SCHEDULER_STATES,
  PlaybackSchedulerFsm,
  canTransitionPlaybackSchedulerState,
  isPlaybackSchedulerState,
} from "../src/scheduler/state-machine";

describe("R12 — the playback scheduler state machine", () => {
  it("the five states, in lifecycle order", () => {
    expect(PLAYBACK_SCHEDULER_STATES).toEqual([
      "idle",
      "startup",
      "steady",
      "seeking",
      "background-completion",
    ]);
  });

  it("the guard is total for garbage", () => {
    expect(isPlaybackSchedulerState("idle")).toBe(true);
    expect(isPlaybackSchedulerState("downloading")).toBe(false); // R11 vocabulary, not ours
    expect(isPlaybackSchedulerState(42)).toBe(false);
    expect(isPlaybackSchedulerState(undefined)).toBe(false);
    expect(canTransitionPlaybackSchedulerState("garbage" as never, "steady")).toBe(false);
    expect(canTransitionPlaybackSchedulerState("steady", "garbage" as never)).toBe(false);
  });

  it("idle births playback: start (startup) and seek are the only exits", () => {
    expect(ALLOWED_PLAYBACK_SCHEDULER_TRANSITIONS.idle).toEqual(["startup", "seeking"]);
    expect(canTransitionPlaybackSchedulerState("idle", "steady")).toBe(false);
    expect(canTransitionPlaybackSchedulerState("idle", "background-completion")).toBe(false);
  });

  it("startup exits: steady (window satisfied), seeking, background-completion (stop), idle (detach)", () => {
    for (const to of ["steady", "seeking", "background-completion", "idle"] as const) {
      expect(canTransitionPlaybackSchedulerState("startup", to)).toBe(true);
    }
    expect(canTransitionPlaybackSchedulerState("startup", "startup")).toBe(false);
  });

  it("steady exits: seeking, background-completion, idle — never back to startup directly", () => {
    for (const to of ["seeking", "background-completion", "idle"] as const) {
      expect(canTransitionPlaybackSchedulerState("steady", to)).toBe(true);
    }
    expect(canTransitionPlaybackSchedulerState("steady", "startup")).toBe(false);
    expect(canTransitionPlaybackSchedulerState("steady", "steady")).toBe(false);
  });

  it("seeking accepts ITSELF (rapid scrubbing re-anchors) and every honest exit", () => {
    for (const to of ["steady", "seeking", "background-completion", "idle"] as const) {
      expect(canTransitionPlaybackSchedulerState("seeking", to)).toBe(true);
    }
  });

  it("background-completion resumes playback: startup, seeking, idle", () => {
    for (const to of ["startup", "seeking", "idle"] as const) {
      expect(canTransitionPlaybackSchedulerState("background-completion", to)).toBe(true);
    }
    expect(canTransitionPlaybackSchedulerState("background-completion", "background-completion")).toBe(false);
    expect(canTransitionPlaybackSchedulerState("background-completion", "steady")).toBe(false);
  });

  it("the FSM starts idle, transitions legally, and THROWS on illegal hops", () => {
    const fsm = new PlaybackSchedulerFsm();
    expect(fsm.state()).toBe("idle");
    fsm.transitionTo("startup");
    expect(fsm.state()).toBe("startup");
    fsm.transitionTo("steady");
    fsm.transitionTo("seeking");
    fsm.transitionTo("seeking"); // re-seek
    fsm.transitionTo("background-completion");
    fsm.transitionTo("startup");
    expect(fsm.state()).toBe("startup");
    expect(() => fsm.transitionTo("steady")).not.toThrow();
    expect(() => fsm.transitionTo("steady")).toThrow(InvalidPlaybackSchedulerTransitionError);
  });

  it("an explicit initial state is honored (recovery wiring); garbage throws at construction", () => {
    expect(new PlaybackSchedulerFsm("background-completion").state()).toBe("background-completion");
    expect(() => new PlaybackSchedulerFsm("garbage" as never)).toThrow(
      InvalidPlaybackSchedulerTransitionError,
    );
  });

  it("the error carries from/to as plain strings (runtime callers may pass garbage)", () => {
    const error = new InvalidPlaybackSchedulerTransitionError("a", "b");
    expect(error.from).toBe("a");
    expect(error.to).toBe("b");
    expect(error.name).toBe("InvalidPlaybackSchedulerTransitionError");
    expect(error.message).toContain("cannot transition");
  });
});
