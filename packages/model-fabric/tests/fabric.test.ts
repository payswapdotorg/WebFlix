/**
 * @wfx/model-fabric — gateway tests (WFX-030): happy path with trace,
 * fallback on provider-error/timeout, all-fail chain, no-provider, cost
 * budget skip, privacy defense-in-depth, policy validation, default
 * routing, distinct invocation ids.
 */

import { describe, expect, it } from "bun:test";
import { isIso8601 } from "@wfx/domain";
import type { ModelPolicy, ModelTask } from "@wfx/domain";

import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  isInvocationId,
  isPolicyError,
  isPrivacyError,
  makeEchoProvider,
  makeFailingProvider,
  makeSlowProvider,
  ModelFabric,
  ModelFabricRegistry,
  type RoutePlan,
  type RoutePlanEntry,
  type RoutePlanner,
} from "../src/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function policy(overrides: Partial<ModelPolicy> = {}): ModelPolicy {
  return {
    task: "ranking",
    fallbackProviders: [],
    privacy: "any-cloud",
    ...overrides,
  };
}

/** A planner that ignores all filtering and returns the given entries (test-only). */
function stubPlanner(
  resolveEntries: (task: ModelTask, policy: ModelPolicy) => RoutePlanEntry[],
): RoutePlanner {
  return {
    route(task, policyArg): RoutePlan {
      return { task, entries: resolveEntries(task, policyArg) };
    },
  };
}

function entry(providerId: string): RoutePlanEntry {
  return { providerId, privacy: "local" }; // privacy is informational for the gateway
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("model-fabric gateway — happy path with trace", () => {
  it("returns the value with a fully populated trace", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(makeEchoProvider("solo", { capabilities: ["ranking"] }));
    const fabric = new ModelFabric(registry);

    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ preferredProvider: "solo" }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toBe("input");
    expect(result.trace.taskId).toBe("ranking");
    expect(result.trace.providerId).toBe("solo");
    expect(result.trace.fallbacks).toEqual([]);
    expect(isInvocationId(result.trace.invocationId)).toBe(true);
    expect(isIso8601(result.trace.startedAt)).toBe(true);
    expect(result.trace.durationMs).toBeGreaterThanOrEqual(0);
    expect("cost" in result.trace).toBe(false); // no provider declared a cost
  });

  it("applies the echo fixture's transform and passes the exact input through", async () => {
    const registry = new ModelFabricRegistry();
    const provider = makeEchoProvider("transformer", {
      capabilities: ["summary"],
      transform: (input: unknown) => `summarized: ${String(input)}`,
    });
    registry.register(provider);
    const fabric = new ModelFabric(registry);

    const result = await fabric.invoke<string, string>("summary", "a tale", policy({ task: "summary", preferredProvider: "transformer" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("summarized: a tale");
    expect(provider.calls).toEqual([{ task: "summary", input: "a tale" }]);
  });
});

// ---------------------------------------------------------------------------
// Fallback chains
// ---------------------------------------------------------------------------

describe("model-fabric gateway — fallback on provider failure", () => {
  it("falls back to the next provider after a provider-error, recording the chain", async () => {
    const registry = new ModelFabricRegistry();
    const failing = makeFailingProvider("failing", { capabilities: ["ranking"], errorMessage: "boom" });
    const echo = makeEchoProvider("echo", { capabilities: ["ranking"] });
    registry.register(failing).register(echo);
    const fabric = new ModelFabric(registry);

    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ fallbackProviders: ["failing", "echo"] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toBe("input");
    expect(result.trace.providerId).toBe("echo");
    expect(result.trace.fallbacks).toEqual(["failing"]);
    expect(failing.calls.length).toBe(1);
    expect(echo.calls.length).toBe(1);
  });

  it("falls back after a TIMEOUT to the next provider (slow provider past the deadline)", async () => {
    const registry = new ModelFabricRegistry();
    const slow = makeSlowProvider("slow", 120, { capabilities: ["ranking"] });
    const echo = makeEchoProvider("echo", { capabilities: ["ranking"] });
    registry.register(slow).register(echo);
    const fabric = new ModelFabric(registry);

    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ fallbackProviders: ["slow", "echo"] }),
      { timeoutMs: 25 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toBe("input");
    expect(result.trace.providerId).toBe("echo");
    expect(result.trace.fallbacks).toEqual(["slow"]);
    expect(result.trace.durationMs).toBeGreaterThanOrEqual(20); // waited out the deadline
    expect(slow.calls.length).toBe(1); // it was attempted (and timed out)
  });

  it("falls back after a hung provider (never settles) times out", async () => {
    const registry = new ModelFabricRegistry();
    const hung = makeFailingProvider("hung", { capabilities: ["ranking"], failure: "hang" });
    const echo = makeEchoProvider("echo", { capabilities: ["ranking"] });
    registry.register(hung).register(echo);
    const fabric = new ModelFabric(registry);

    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ fallbackProviders: ["hung", "echo"] }),
      { timeoutMs: 20 },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.trace.fallbacks).toEqual(["hung"]);
  });

  it("all attempts fail → provider-error with the FULL attempted chain in the trace", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(makeFailingProvider("a", { capabilities: ["ranking"], errorMessage: "a down" }));
    registry.register(makeFailingProvider("b", { capabilities: ["ranking"], errorMessage: "b down" }));
    registry.register(makeFailingProvider("c", { capabilities: ["ranking"], errorMessage: "c down" }));
    const fabric = new ModelFabric(registry);

    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ fallbackProviders: ["a", "b", "c"] }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toEqual({
      kind: "provider-error",
      providerId: "c",
      detail: "c down",
    });
    // The full chain: a and b were attempted and failed before c.
    expect(result.trace?.fallbacks).toEqual(["a", "b"]);
    expect(result.trace?.providerId).toBe("c");
    expect(result.trace?.taskId).toBe("ranking");
    expect(isInvocationId(result.trace?.invocationId ?? "")).toBe(true);
  });

  it("a TIMEOUT as the last failure surfaces as a typed timeout error (never swallowed)", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(makeFailingProvider("rejector", { capabilities: ["ranking"] }));
    registry.register(makeFailingProvider("hanging", { capabilities: ["ranking"], failure: "hang" }));
    const fabric = new ModelFabric(registry);

    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ fallbackProviders: ["rejector", "hanging"] }),
      { timeoutMs: 20 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toEqual({ kind: "timeout", providerId: "hanging", ms: 20 });
    expect(result.trace?.fallbacks).toEqual(["rejector"]);
    expect(result.trace?.providerId).toBe("hanging");
  });

  it("a SYNCHRONOUS throw out of invoke() maps to a provider-error, never escapes the gateway", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(makeFailingProvider("sync-thrower", { capabilities: ["ranking"], failure: "sync-throw", errorMessage: "sync boom" }));
    registry.register(makeEchoProvider("echo", { capabilities: ["ranking"] }));
    const fabric = new ModelFabric(registry);

    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ fallbackProviders: ["sync-thrower", "echo"] }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.trace.fallbacks).toEqual(["sync-thrower"]);
  });

  it("a slow provider WITHIN the deadline still succeeds", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(makeSlowProvider("slow-ok", 15, { capabilities: ["ranking"] }));
    const fabric = new ModelFabric(registry);

    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ fallbackProviders: ["slow-ok"] }),
      { timeoutMs: 500 },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("input");
      expect(result.trace.providerId).toBe("slow-ok");
      expect(result.trace.fallbacks).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// No-provider
// ---------------------------------------------------------------------------

describe("model-fabric gateway — no-provider", () => {
  it("empty registry → typed no-provider error, no trace (nothing ran)", async () => {
    const fabric = new ModelFabric(new ModelFabricRegistry());
    const result = await fabric.invoke<string, string>("ranking", "input", policy());
    expect(result).toEqual({ ok: false, error: { kind: "no-provider", task: "ranking" } });
    expect("trace" in result).toBe(false);
  });

  it("policy listing only unregistered ids → no-provider", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(makeEchoProvider("registered", { capabilities: ["ranking"] }));
    const fabric = new ModelFabric(registry);
    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ fallbackProviders: ["ghost", "phantom"] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toEqual({ kind: "no-provider", task: "ranking" });
    expect("trace" in result).toBe(false);
  });

  it("providers without the task capability → no-provider (capability filter end-to-end)", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(makeEchoProvider("summarizer", { capabilities: ["summary"] }));
    const fabric = new ModelFabric(registry);
    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ fallbackProviders: ["summarizer"] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toEqual({ kind: "no-provider", task: "ranking" });
  });

  it("local-only policy with only CLOUD providers → empty plan → no-provider (nothing leaked)", async () => {
    const registry = new ModelFabricRegistry();
    const cloud = makeEchoProvider("cloud-only", { capabilities: ["ranking"], privacy: "cloud" });
    registry.register(cloud);
    const fabric = new ModelFabric(registry);
    const result = await fabric.invoke<string, string>(
      "ranking",
      "secret-input",
      policy({ privacy: "local-only", fallbackProviders: ["cloud-only"] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toEqual({ kind: "no-provider", task: "ranking" });
    expect(cloud.calls.length).toBe(0); // the input never reached the cloud
  });
});

// ---------------------------------------------------------------------------
// Cost budget
// ---------------------------------------------------------------------------

describe("model-fabric gateway — cost budget", () => {
  it("sums declared costs across attempted providers in the trace", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(
      makeFailingProvider("costly-failure", { capabilities: ["ranking"], costs: { ranking: 5 } }),
    );
    registry.register(
      makeEchoProvider("costly-success", { capabilities: ["ranking"], costs: { ranking: 3 } }),
    );
    const fabric = new ModelFabric(registry);

    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ fallbackProviders: ["costly-failure", "costly-success"] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.trace.cost).toBe(8); // 5 (failed attempt) + 3 (success)
  });

  it("skips a provider whose attempt would exceed the budget — provider-error surfaces, skip never invoked", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(
      makeFailingProvider("a", { capabilities: ["ranking"], costs: { ranking: 6 } }),
    );
    const skipped = makeEchoProvider("b", { capabilities: ["ranking"], costs: { ranking: 6 } });
    registry.register(skipped);
    const fabric = new ModelFabric(registry);

    // Each provider alone is within the ceiling (router includes both), but
    // 6 (already spent on a) + 6 (b) > 10 — b is skipped BEFORE any attempt.
    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ fallbackProviders: ["a", "b"], maxCostPerOperation: 10 }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toEqual({
      kind: "provider-error",
      providerId: "a",
      detail: expect.stringContaining("fixture"),
    });
    expect(result.trace?.cost).toBe(6);
    expect(result.trace?.fallbacks).toEqual([]);
    expect(skipped.calls.length).toBe(0); // skipped, never invoked
  });

  it("ALL providers skipped → typed cost error (defense in depth via injected planner)", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(makeEchoProvider("a", { capabilities: ["ranking"], costs: { ranking: 6 } }));
    registry.register(makeEchoProvider("b", { capabilities: ["ranking"], costs: { ranking: 7 } }));
    // A planner that ignores cost filtering (broken-router simulation).
    const fabric = new ModelFabric(registry, {
      router: stubPlanner(() => [entry("a"), entry("b")]),
    });

    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ fallbackProviders: ["a", "b"], maxCostPerOperation: 5 }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toEqual({ kind: "cost", budget: 5, spent: 0 });
    expect("trace" in result).toBe(false); // nothing was ever invoked
  });

  it("cost exactly at budget is attempted (exceeds, not meets, is skipped)", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(makeEchoProvider("exact", { capabilities: ["ranking"], costs: { ranking: 10 } }));
    const fabric = new ModelFabric(registry);

    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ fallbackProviders: ["exact"], maxCostPerOperation: 10 }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.trace.cost).toBe(10);
  });

  it("undeclared costs never trigger skips and never appear in the trace", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(makeFailingProvider("free-failure", { capabilities: ["ranking"] }));
    registry.register(makeEchoProvider("free-success", { capabilities: ["ranking"] }));
    const fabric = new ModelFabric(registry);

    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ fallbackProviders: ["free-failure", "free-success"], maxCostPerOperation: 0 }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trace.fallbacks).toEqual(["free-failure"]);
      expect("cost" in result.trace).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Privacy defense in depth
// ---------------------------------------------------------------------------

describe("model-fabric gateway — privacy defense in depth", () => {
  it("local-only: the REAL router never lets the input reach a cloud provider (end-to-end)", async () => {
    const registry = new ModelFabricRegistry();
    const cloud = makeEchoProvider("cloud-ranker", { capabilities: ["ranking"], privacy: "cloud" });
    const local = makeEchoProvider("local-ranker", { capabilities: ["ranking"], privacy: "local" });
    registry.register(cloud).register(local);
    const fabric = new ModelFabric(registry);

    const result = await fabric.invoke<string, string>(
      "ranking",
      "private-input",
      policy({ privacy: "local-only", fallbackProviders: ["cloud-ranker", "local-ranker"] }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trace.providerId).toBe("local-ranker");
      expect(result.trace.fallbacks).toEqual([]); // cloud was excluded at ROUTE time
    }
    expect(cloud.calls.length).toBe(0); // NEVER saw the input
    expect(local.calls).toEqual([{ task: "ranking", input: "private-input" }]);
  });

  it("local-only + a plan that contains a cloud provider → typed privacy error, NOTHING invoked", async () => {
    const registry = new ModelFabricRegistry();
    const cloud = makeEchoProvider("cloud-evil", { capabilities: ["ranking"], privacy: "cloud" });
    const local = makeEchoProvider("local-good", { capabilities: ["ranking"], privacy: "local" });
    registry.register(cloud).register(local);
    // Broken/injected planner that ignores privacy filtering.
    const fabric = new ModelFabric(registry, {
      router: stubPlanner(() => [entry("cloud-evil"), entry("local-good")]),
    });

    const result = await fabric.invoke<string, string>(
      "ranking",
      "private-input",
      policy({ privacy: "local-only", fallbackProviders: ["cloud-evil", "local-good"] }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    if (!isPrivacyError(result.error)) throw new Error("expected a privacy error");
    expect(result.error.detail).toContain("cloud-evil");
    expect("trace" in result).toBe(false);
    // Fail closed: not even the local provider ran.
    expect(cloud.calls.length).toBe(0);
    expect(local.calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Policy validation (typed policy errors — never throws)
// ---------------------------------------------------------------------------

describe("model-fabric gateway — policy validation", () => {
  it("a policy for a different task answers a typed policy error", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(makeEchoProvider("solo", { capabilities: ["ranking"] }));
    const fabric = new ModelFabric(registry);

    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ task: "summary", fallbackProviders: ["solo"] }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    if (!isPolicyError(result.error)) throw new Error("expected a policy error");
    expect(result.error.detail).toContain("summary");
    expect("trace" in result).toBe(false);
  });

  it("an invalid runtime privacy value answers a typed policy error", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(makeEchoProvider("solo", { capabilities: ["ranking"] }));
    const fabric = new ModelFabric(registry);

    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ privacy: "local" as ModelPolicy["privacy"], fallbackProviders: ["solo"] }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("policy");
  });

  it("a negative maxCostPerOperation answers a typed policy error", async () => {
    const fabric = new ModelFabric(new ModelFabricRegistry());
    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ maxCostPerOperation: -1 }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("policy");
  });

  it("a malformed fallbackProviders list answers a typed policy error", async () => {
    const fabric = new ModelFabric(new ModelFabricRegistry());
    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ fallbackProviders: "not-an-array" as unknown as string[] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("policy");
  });

  it("an invalid context.timeoutMs answers a typed policy error", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(makeEchoProvider("solo", { capabilities: ["ranking"] }));
    const fabric = new ModelFabric(registry);
    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ fallbackProviders: ["solo"] }),
      { timeoutMs: 0 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("policy");
  });
});

// ---------------------------------------------------------------------------
// Default routing without a policy
// ---------------------------------------------------------------------------

describe("model-fabric gateway — policy-less invoke (default routing)", () => {
  it("routes to every provider registered for the task, in registration order", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(makeFailingProvider("first", { capabilities: ["ranking"] }));
    registry.register(makeEchoProvider("second", { capabilities: ["ranking"] }));
    const fabric = new ModelFabric(registry);

    const result = await fabric.invoke<string, string>("ranking", "input");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("input");
      expect(result.trace.providerId).toBe("second");
      expect(result.trace.fallbacks).toEqual(["first"]);
    }
  });

  it("no registered provider for the task → no-provider", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(makeEchoProvider("summarizer", { capabilities: ["summary"] }));
    const fabric = new ModelFabric(registry);
    const result = await fabric.invoke<string, string>("ranking", "input");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toEqual({ kind: "no-provider", task: "ranking" });
  });
});

// ---------------------------------------------------------------------------
// Distinct invocation ids
// ---------------------------------------------------------------------------

describe("model-fabric gateway — distinct invocation ids", () => {
  it("duplicate invocations get distinct invocationIds", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(makeEchoProvider("solo", { capabilities: ["ranking"] }));
    const fabric = new ModelFabric(registry);

    const first = await fabric.invoke<string, string>("ranking", "a");
    const second = await fabric.invoke<string, string>("ranking", "b");

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("unreachable");
    expect(first.trace.invocationId).not.toBe(second.trace.invocationId);
    expect(isInvocationId(first.trace.invocationId)).toBe(true);
    expect(isInvocationId(second.trace.invocationId)).toBe(true);
  });

  it("a successful fallback and a failing invocation never share an id", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(makeFailingProvider("only", { capabilities: ["ranking"] }));
    const fabric = new ModelFabric(registry);

    const failure = await fabric.invoke<string, string>("ranking", "a");
    const ids = new Set<string>();
    if (!failure.ok && failure.trace) ids.add(failure.trace.invocationId);

    registry.register(makeEchoProvider("rescue", { capabilities: ["ranking"] }));
    const success = await fabric.invoke<string, string>(
      "ranking",
      "a",
      policy({ fallbackProviders: ["rescue"] }),
    );
    if (success.ok) ids.add(success.trace.invocationId);
    expect(ids.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Timeout configuration
// ---------------------------------------------------------------------------

describe("model-fabric gateway — timeout configuration", () => {
  it("the default per-provider timeout is 30 seconds (packet default)", () => {
    expect(DEFAULT_PROVIDER_TIMEOUT_MS).toBe(30_000);
  });

  it("defaultTimeoutMs from construction is enforced without a context override", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(makeFailingProvider("hung", { capabilities: ["ranking"], failure: "hang" }));
    const fabric = new ModelFabric(registry, { defaultTimeoutMs: 20 });

    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ fallbackProviders: ["hung"] }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toEqual({ kind: "timeout", providerId: "hung", ms: 20 });
  });

  it("constructor rejects an invalid defaultTimeoutMs (fail fast at wiring time)", () => {
    const registry = new ModelFabricRegistry();
    expect(() => new ModelFabric(registry, { defaultTimeoutMs: 0 })).toThrow();
    expect(() => new ModelFabric(registry, { defaultTimeoutMs: Number.NaN })).toThrow();
  });

  it("constructor rejects a non-planner router and a non-directory registry", () => {
    const registry = new ModelFabricRegistry();
    expect(() => new ModelFabric(registry, { router: {} as never })).toThrow();
    expect(() => new ModelFabric({} as never)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Defense in depth against stale plans (injected planner)
// ---------------------------------------------------------------------------

describe("model-fabric gateway — stale plan defense", () => {
  it("ghost plan entries (unregistered ids) are skipped, never invented", async () => {
    const registry = new ModelFabricRegistry();
    registry.register(makeEchoProvider("real", { capabilities: ["ranking"] }));
    const fabric = new ModelFabric(registry, {
      router: stubPlanner(() => [entry("ghost"), entry("real")]),
    });

    const result = await fabric.invoke<string, string>("ranking", "input");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.trace.providerId).toBe("real");
  });

  it("entries whose provider no longer declares the task are skipped (capability re-check)", async () => {
    const registry = new ModelFabricRegistry();
    const incapable = makeEchoProvider("incapable", { capabilities: ["summary"] });
    registry.register(incapable);
    const fabric = new ModelFabric(registry, {
      router: stubPlanner(() => [entry("incapable")]),
    });

    const result = await fabric.invoke<string, string>("ranking", "input");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toEqual({ kind: "no-provider", task: "ranking" });
    expect(incapable.calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Real-router + preferred integration
// ---------------------------------------------------------------------------

describe("model-fabric gateway — routing integration", () => {
  it("the preferred provider wins over registration order", async () => {
    const registry = new ModelFabricRegistry();
    const first = makeEchoProvider("first", { capabilities: ["ranking"] });
    registry.register(first);
    registry.register(makeEchoProvider("preferred", { capabilities: ["ranking"] }));
    const fabric = new ModelFabric(registry);

    const result = await fabric.invoke<string, string>(
      "ranking",
      "input",
      policy({ preferredProvider: "preferred", fallbackProviders: ["first"] }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trace.providerId).toBe("preferred");
      expect(result.trace.fallbacks).toEqual([]);
      expect(first.calls.length).toBe(0);
    }
  });

  it("multiple tasks route independently (task isolation)", async () => {
    const registry = new ModelFabricRegistry();
    const ranker = makeEchoProvider("ranker", { capabilities: ["ranking"] });
    const summarizer = makeEchoProvider("summarizer", {
      capabilities: ["summary"],
      transform: (input: unknown) => `s:${String(input)}`,
    });
    registry.register(ranker).register(summarizer);
    const fabric = new ModelFabric(registry);

    const ranked = await fabric.invoke<string, string>(
      "ranking",
      "x",
      policy({ fallbackProviders: ["ranker", "summarizer"] }),
    );
    const summarized = await fabric.invoke<string, string>(
      "summary",
      "x",
      policy({ task: "summary", fallbackProviders: ["summarizer"] }),
    );

    expect(ranked.ok && summarized.ok).toBe(true);
    if (!ranked.ok || !summarized.ok) throw new Error("unreachable");
    expect(ranked.trace.providerId).toBe("ranker");
    expect(summarized.value).toBe("s:x");
    expect(summarizer.calls.length).toBe(1); // never asked to rank
  });
});
