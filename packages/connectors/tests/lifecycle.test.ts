import { describe, expect, it } from "bun:test";

import {
  assertOperational,
  ConnectorLifecycle,
  isOperational,
  LifecycleError,
  type LifecycleState,
} from "../src/index";

describe("ConnectorLifecycle — legal transitions", () => {
  it("starts registered, initializes, disposes", () => {
    const lifecycle = new ConnectorLifecycle();
    expect(lifecycle.state()).toBe<LifecycleState>("registered");

    lifecycle.initialize();
    expect(lifecycle.state()).toBe<LifecycleState>("initialized");

    lifecycle.dispose();
    expect(lifecycle.state()).toBe<LifecycleState>("disposed");
  });

  it("fail() is legal from registered and initialized, recording the reason", () => {
    const fromRegistered = new ConnectorLifecycle();
    fromRegistered.fail("boot error");
    expect(fromRegistered.state()).toBe<LifecycleState>("failed");
    expect(fromRegistered.failureReason()).toBe("boot error");

    const fromInitialized = new ConnectorLifecycle();
    fromInitialized.initialize();
    fromInitialized.fail("runtime error");
    expect(fromInitialized.state()).toBe<LifecycleState>("failed");
    expect(fromInitialized.failureReason()).toBe("runtime error");
  });

  it("fail() without a reason leaves failureReason undefined", () => {
    const lifecycle = new ConnectorLifecycle();
    lifecycle.fail();
    expect(lifecycle.state()).toBe<LifecycleState>("failed");
    expect(lifecycle.failureReason()).toBeUndefined();
  });
});

describe("ConnectorLifecycle — illegal transitions throw (never ignored)", () => {
  it("initialize twice throws", () => {
    const lifecycle = new ConnectorLifecycle();
    lifecycle.initialize();
    expect(() => lifecycle.initialize()).toThrow(LifecycleError);
    expect(lifecycle.state()).toBe<LifecycleState>("initialized");
  });

  it("dispose before initialize throws", () => {
    const lifecycle = new ConnectorLifecycle();
    expect(() => lifecycle.dispose()).toThrow(LifecycleError);
    expect(lifecycle.state()).toBe<LifecycleState>("registered");
  });

  it("initialize after dispose throws", () => {
    const lifecycle = new ConnectorLifecycle();
    lifecycle.initialize();
    lifecycle.dispose();
    expect(() => lifecycle.initialize()).toThrow(LifecycleError);
  });

  it("dispose twice throws", () => {
    const lifecycle = new ConnectorLifecycle();
    lifecycle.initialize();
    lifecycle.dispose();
    expect(() => lifecycle.dispose()).toThrow(LifecycleError);
  });

  it("failed is terminal: initialize/dispose/fail all throw", () => {
    const lifecycle = new ConnectorLifecycle();
    lifecycle.fail("dead");
    expect(() => lifecycle.initialize()).toThrow(LifecycleError);
    expect(() => lifecycle.dispose()).toThrow(LifecycleError);
    expect(() => lifecycle.fail("again")).toThrow(LifecycleError);
    expect(lifecycle.state()).toBe<LifecycleState>("failed");
  });

  it("fail after dispose throws (disposed is terminal too)", () => {
    const lifecycle = new ConnectorLifecycle();
    lifecycle.initialize();
    lifecycle.dispose();
    expect(() => lifecycle.fail("late")).toThrow(LifecycleError);
  });

  it("the thrown error is typed with from-state and attempted action", () => {
    const lifecycle = new ConnectorLifecycle();
    try {
      lifecycle.dispose();
      throw new Error("expected LifecycleError");
    } catch (caught) {
      expect(caught).toBeInstanceOf(LifecycleError);
      const error = caught as LifecycleError;
      expect(error.name).toBe("LifecycleError");
      expect(error.from).toBe<LifecycleState>("registered");
      expect(error.attempted).toBe("dispose");
      expect(error.message).toContain("registered");
    }
  });
});

describe("assertOperational guard helper", () => {
  it("passes only for initialized", () => {
    expect(() => assertOperational("initialized")).not.toThrow();
    for (const state of ["registered", "disposed", "failed"] as const) {
      let thrown: unknown;
      try {
        assertOperational(state);
      } catch (caught) {
        thrown = caught;
      }
      expect(thrown).toBeInstanceOf(LifecycleError);
      expect((thrown as LifecycleError).from).toBe(state);
      expect((thrown as LifecycleError).attempted).toBe("assertOperational");
    }
  });

  it("isOperational is the non-throwing companion", () => {
    expect(isOperational("initialized")).toBe(true);
    expect(isOperational("registered")).toBe(false);
    expect(isOperational("disposed")).toBe(false);
    expect(isOperational("failed")).toBe(false);
  });
});
