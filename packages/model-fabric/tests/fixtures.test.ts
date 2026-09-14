/**
 * @wfx/model-fabric — fixture tests (WFX-030): the TEST FIXTURES themselves
 * (echo / failing / slow). Fixtures are test doubles — these tests pin their
 * declared contract so the machinery tests above can rely on them.
 */

import { describe, expect, it } from "bun:test";

import {
  makeEchoProvider,
  makeFailingProvider,
  makeSlowProvider,
  type EchoProvider,
  type FailingProvider,
  type SlowProvider,
} from "../src/index";

describe("model-fabric fixtures — fixture branding", () => {
  it("every fixture is branded isTestFixture: true", () => {
    expect(makeEchoProvider("echo").isTestFixture).toBe(true);
    expect(makeFailingProvider("fail").isTestFixture).toBe(true);
    expect(makeSlowProvider("slow", 1).isTestFixture).toBe(true);
  });
});

describe("model-fabric fixtures — echo provider", () => {
  it("returns the input unchanged by default", async () => {
    const echo = makeEchoProvider("echo-default");
    const value = await echo.invoke<string, string>("summary", "same");
    expect(value).toBe("same");
  });

  it("returns the input transformed by the stub function", async () => {
    const echo = makeEchoProvider("echo-transform", {
      transform: (input: unknown) => ({ upper: String(input).toUpperCase() }),
    });
    const value = await echo.invoke<string, { upper: string }>("translation", "abc");
    expect(value).toEqual({ upper: "ABC" });
  });

  it("declares every frozen ModelTask by default, and chosen ones when overridden", () => {
    expect(makeEchoProvider("all").capabilities.length).toBe(9);
    expect(makeEchoProvider("some", { capabilities: ["ranking", "dubbing"] }).capabilities).toEqual([
      "ranking",
      "dubbing",
    ]);
  });

  it("declares chosen privacy (default local) and costs (default none)", () => {
    const defaults = makeEchoProvider("defaults");
    expect(defaults.privacy).toBe("local");
    expect(defaults.costPerOperation("ranking")).toBeUndefined();

    const configured: EchoProvider = makeEchoProvider("configured", {
      privacy: "cloud",
      costs: { ranking: 4, summary: 0 },
    });
    expect(configured.privacy).toBe("cloud");
    expect(configured.costPerOperation("ranking")).toBe(4);
    expect(configured.costPerOperation("summary")).toBe(0);
    expect(configured.costPerOperation("dubbing")).toBeUndefined();
  });

  it("records every invocation in its call log", async () => {
    const echo = makeEchoProvider("logged");
    await echo.invoke("summary", "a");
    await echo.invoke("ranking", "b");
    expect(echo.calls).toEqual([
      { task: "summary", input: "a" },
      { task: "ranking", input: "b" },
    ]);
  });

  it("capabilities getter returns a copy — mutating it never changes the fixture", () => {
    const echo = makeEchoProvider("copy", { capabilities: ["ranking"] });
    const caps = echo.capabilities;
    caps.push("dubbing");
    expect(echo.capabilities).toEqual(["ranking"]);
  });
});

describe("model-fabric fixtures — failing provider", () => {
  it("default mode rejects with the default error message", async () => {
    const failing = makeFailingProvider("reject-default");
    let message = "";
    await failing.invoke<string, string>("summary", "x").catch((error: Error) => {
      message = error.message;
    });
    expect(message).toBe("fixture: deliberate provider failure");
  });

  it("reject mode rejects with the configured message and records the call", async () => {
    const failing: FailingProvider = makeFailingProvider("reject", {
      failure: "reject",
      errorMessage: "custom boom",
    });
    expect(failing.failureMode).toBe("reject");
    await expect(failing.invoke<string, string>("summary", "x")).rejects.toThrow("custom boom");
    expect(failing.calls).toEqual([{ task: "summary", input: "x" }]);
  });

  it("sync-throw mode throws synchronously out of invoke()", () => {
    const failing = makeFailingProvider("sync", { failure: "sync-throw" });
    expect(() => failing.invoke<string, string>("summary", "x")).toThrow();
    expect(failing.calls.length).toBe(1);
  });

  it("hang mode never settles (the fabric's timeout exercises it)", async () => {
    const failing = makeFailingProvider("hang", { failure: "hang" });
    let settled = false;
    void failing.invoke<string, string>("summary", "x").then(() => {
      settled = true;
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(settled).toBe(false);
    expect(failing.calls.length).toBe(1);
  });

  it("declares registration metadata like any provider", () => {
    const failing = makeFailingProvider("meta", {
      capabilities: ["commentary"],
      privacy: "cloud",
      costs: { commentary: 2 },
    });
    expect(failing.capabilities).toEqual(["commentary"]);
    expect(failing.privacy).toBe("cloud");
    expect(failing.costPerOperation("commentary")).toBe(2);
  });
});

describe("model-fabric fixtures — slow provider", () => {
  it("resolves with the input after the configured delay", async () => {
    const slow: SlowProvider = makeSlowProvider("slow", 5);
    expect(slow.delayMs).toBe(5);
    const value = await slow.invoke<string, string>("summary", "late");
    expect(value).toBe("late");
    expect(slow.calls).toEqual([{ task: "summary", input: "late" }]);
  });

  it("declares registration metadata", () => {
    const slow = makeSlowProvider("slow-meta", 1, {
      capabilities: ["transcription"],
      privacy: "cloud",
      costs: { transcription: 9 },
    });
    expect(slow.capabilities).toEqual(["transcription"]);
    expect(slow.privacy).toBe("cloud");
    expect(slow.costPerOperation("transcription")).toBe(9);
  });

  it("rejects a malformed delay at construction (fixture programmer error)", () => {
    expect(() => makeSlowProvider("bad", -1)).toThrow();
    expect(() => makeSlowProvider("bad", Number.POSITIVE_INFINITY)).toThrow();
  });
});
