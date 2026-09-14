/**
 * @wfx/model-fabric — router tests (WFX-030): capability filter, privacy
 * exclusion (local-only NEVER routes to cloud), cost exclusion,
 * preferred-then-fallback ordering, dedupe, unknown ids, empty plans, and
 * route-level policy misuse.
 */

import { describe, expect, it } from "bun:test";
import type { ModelPolicy, ModelTask } from "@wfx/domain";

import {
  makeEchoProvider,
  ModelFabricRegistry,
  ModelRouter,
  RoutePolicyError,
  type RoutePlan,
} from "../src/index";

function basePolicy(overrides: Partial<ModelPolicy> = {}): ModelPolicy {
  return {
    task: "ranking",
    fallbackProviders: [],
    privacy: "any-cloud",
    ...overrides,
  };
}

function setup(
  providers: Array<{ id: string; capabilities: ModelTask[]; privacy: "local" | "cloud"; cost?: number }>,
): { registry: ModelFabricRegistry; router: ModelRouter } {
  const registry = new ModelFabricRegistry();
  for (const spec of providers) {
    registry.register(
      makeEchoProvider(spec.id, {
        capabilities: spec.capabilities,
        privacy: spec.privacy,
        ...(spec.cost === undefined ? {} : { costs: { ranking: spec.cost } }),
      }),
    );
  }
  return { registry, router: new ModelRouter(registry) };
}

describe("model-fabric router — capability filter", () => {
  it("routes only providers that declare the task", () => {
    const { router } = setup([
      { id: "ranker", capabilities: ["ranking"], privacy: "local" },
      { id: "summarizer", capabilities: ["summary"], privacy: "local" },
    ]);
    const plan = router.route("ranking", basePolicy({ fallbackProviders: ["ranker", "summarizer"] }));
    expect(plan.task).toBe("ranking");
    expect(plan.entries.map((e) => e.providerId)).toEqual(["ranker"]);
  });

  it("drops ids that are not registered at all", () => {
    const { router } = setup([{ id: "real", capabilities: ["ranking"], privacy: "local" }]);
    const plan = router.route(
      "ranking",
      basePolicy({ preferredProvider: "ghost", fallbackProviders: ["phantom", "real"] }),
    );
    expect(plan.entries.map((e) => e.providerId)).toEqual(["real"]);
  });

  it("an empty fallback list (and no eligible preferred) yields an empty plan", () => {
    const { router } = setup([{ id: "a", capabilities: ["ranking"], privacy: "local" }]);
    const plan = router.route("ranking", basePolicy());
    expect(plan.entries).toEqual([]);
  });

  it("a policy listing only incapable providers yields an empty plan", () => {
    const { router } = setup([{ id: "summarizer", capabilities: ["summary"], privacy: "local" }]);
    const plan = router.route("ranking", basePolicy({ fallbackProviders: ["summarizer"] }));
    expect(plan.entries).toEqual([]);
  });
});

describe("model-fabric router — privacy exclusion", () => {
  it("local-only NEVER routes to cloud providers — even as the preferred provider", () => {
    const { router } = setup([
      { id: "cloud-a", capabilities: ["ranking"], privacy: "cloud" },
      { id: "cloud-b", capabilities: ["ranking"], privacy: "cloud" },
      { id: "local-a", capabilities: ["ranking"], privacy: "local" },
    ]);
    const plan = router.route(
      "ranking",
      basePolicy({
        privacy: "local-only",
        preferredProvider: "cloud-a",
        fallbackProviders: ["cloud-b", "local-a"],
      }),
    );
    expect(plan.entries.map((e) => e.providerId)).toEqual(["local-a"]);
    expect(plan.entries[0]!.privacy).toBe("local");
  });

  it("local-only with only cloud providers yields an empty plan", () => {
    const { router } = setup([
      { id: "cloud-a", capabilities: ["ranking"], privacy: "cloud" },
      { id: "cloud-b", capabilities: ["ranking"], privacy: "cloud" },
    ]);
    const plan = router.route("ranking", basePolicy({ privacy: "local-only", fallbackProviders: ["cloud-a", "cloud-b"] }));
    expect(plan.entries).toEqual([]);
  });

  it("trusted-cloud and any-cloud both allow cloud providers (no trust tier in provider metadata yet)", () => {
    const { router } = setup([{ id: "cloud-a", capabilities: ["ranking"], privacy: "cloud" }]);
    const trusted = router.route(
      "ranking",
      basePolicy({ privacy: "trusted-cloud", fallbackProviders: ["cloud-a"] }),
    );
    const any = router.route(
      "ranking",
      basePolicy({ privacy: "any-cloud", fallbackProviders: ["cloud-a"] }),
    );
    expect(trusted.entries.map((e) => e.providerId)).toEqual(["cloud-a"]);
    expect(any.entries.map((e) => e.providerId)).toEqual(["cloud-a"]);
  });
});

describe("model-fabric router — cost exclusion", () => {
  it("excludes providers whose declared cost exceeds maxCostPerOperation", () => {
    const { router } = setup([
      { id: "cheap", capabilities: ["ranking"], privacy: "local", cost: 3 },
      { id: "pricey", capabilities: ["ranking"], privacy: "local", cost: 11 },
    ]);
    const plan = router.route(
      "ranking",
      basePolicy({ maxCostPerOperation: 10, fallbackProviders: ["cheap", "pricey"] }),
    );
    expect(plan.entries.map((e) => e.providerId)).toEqual(["cheap"]);
    expect(plan.entries[0]!.declaredCost).toBe(3);
  });

  it("a provider costing exactly the ceiling is INCLUDED (exceeds, not meets, is excluded)", () => {
    const { router } = setup([{ id: "exact", capabilities: ["ranking"], privacy: "local", cost: 10 }]);
    const plan = router.route(
      "ranking",
      basePolicy({ maxCostPerOperation: 10, fallbackProviders: ["exact"] }),
    );
    expect(plan.entries.map((e) => e.providerId)).toEqual(["exact"]);
  });

  it("providers with no declared cost for the task are never cost-excluded", () => {
    const { router } = setup([{ id: "free", capabilities: ["ranking"], privacy: "local" }]);
    const plan = router.route(
      "ranking",
      basePolicy({ maxCostPerOperation: 0, fallbackProviders: ["free"] }),
    );
    expect(plan.entries.map((e) => e.providerId)).toEqual(["free"]);
    expect("declaredCost" in plan.entries[0]!).toBe(false);
  });

  it("costs declared for OTHER tasks do not affect this route", () => {
    const registry = new ModelFabricRegistry();
    registry.register(
      makeEchoProvider("other-task-cost", {
        capabilities: ["ranking", "summary"],
        privacy: "local",
        costs: { summary: 999 },
      }),
    );
    const router = new ModelRouter(registry);
    const plan = router.route(
      "ranking",
      basePolicy({ maxCostPerOperation: 1, fallbackProviders: ["other-task-cost"] }),
    );
    expect(plan.entries.map((e) => e.providerId)).toEqual(["other-task-cost"]);
    expect("declaredCost" in plan.entries[0]!).toBe(false);
  });

  it("no maxCostPerOperation means no cost filtering", () => {
    const { router } = setup([{ id: "pricey", capabilities: ["ranking"], privacy: "local", cost: 1000 }]);
    const plan = router.route("ranking", basePolicy({ fallbackProviders: ["pricey"] }));
    expect(plan.entries.map((e) => e.providerId)).toEqual(["pricey"]);
  });
});

describe("model-fabric router — preferred-then-fallback order", () => {
  it("preferred comes first, then fallbacks in policy order", () => {
    const { router } = setup([
      { id: "a", capabilities: ["ranking"], privacy: "local" },
      { id: "b", capabilities: ["ranking"], privacy: "local" },
      { id: "c", capabilities: ["ranking"], privacy: "local" },
    ]);
    const plan = router.route(
      "ranking",
      basePolicy({ preferredProvider: "c", fallbackProviders: ["a", "b"] }),
    );
    expect(plan.entries.map((e) => e.providerId)).toEqual(["c", "a", "b"]);
  });

  it("without a preferred provider, fallback order is preserved", () => {
    const { router } = setup([
      { id: "a", capabilities: ["ranking"], privacy: "local" },
      { id: "b", capabilities: ["ranking"], privacy: "local" },
    ]);
    const plan = router.route("ranking", basePolicy({ fallbackProviders: ["b", "a"] }));
    expect(plan.entries.map((e) => e.providerId)).toEqual(["b", "a"]);
  });

  it("a preferred provider that is also a fallback appears exactly once", () => {
    const { router } = setup([
      { id: "a", capabilities: ["ranking"], privacy: "local" },
      { id: "b", capabilities: ["ranking"], privacy: "local" },
    ]);
    const plan = router.route(
      "ranking",
      basePolicy({ preferredProvider: "a", fallbackProviders: ["a", "b", "a"] }),
    );
    expect(plan.entries.map((e) => e.providerId)).toEqual(["a", "b"]);
  });

  it("duplicate fallback ids collapse to first occurrence", () => {
    const { router } = setup([
      { id: "a", capabilities: ["ranking"], privacy: "local" },
      { id: "b", capabilities: ["ranking"], privacy: "local" },
    ]);
    const plan = router.route("ranking", basePolicy({ fallbackProviders: ["a", "b", "a", "b"] }));
    expect(plan.entries.map((e) => e.providerId)).toEqual(["a", "b"]);
  });

  it("an ineligible preferred provider is dropped and fallbacks proceed", () => {
    const { router } = setup([
      { id: "cloud", capabilities: ["ranking"], privacy: "cloud" },
      { id: "local", capabilities: ["ranking"], privacy: "local" },
    ]);
    const plan = router.route(
      "ranking",
      basePolicy({ privacy: "local-only", preferredProvider: "cloud", fallbackProviders: ["local"] }),
    );
    expect(plan.entries.map((e) => e.providerId)).toEqual(["local"]);
  });
});

describe("model-fabric router — plan metadata", () => {
  it("entries carry the provider privacy and declared cost snapshot", () => {
    const { router } = setup([{ id: "a", capabilities: ["ranking"], privacy: "cloud", cost: 4 }]);
    const plan: RoutePlan = router.route("ranking", basePolicy({ fallbackProviders: ["a"] }));
    expect(plan.entries).toEqual([{ providerId: "a", privacy: "cloud", declaredCost: 4 }]);
  });

  it("cost-undeclared entries omit declaredCost entirely", () => {
    const { router } = setup([{ id: "a", capabilities: ["ranking"], privacy: "local" }]);
    const plan = router.route("ranking", basePolicy({ fallbackProviders: ["a"] }));
    expect(plan.entries).toEqual([{ providerId: "a", privacy: "local" }]);
  });
});

describe("model-fabric router — route-level policy misuse", () => {
  it("throws RoutePolicyError when policy.task does not match the routed task", () => {
    const { router } = setup([{ id: "a", capabilities: ["ranking"], privacy: "local" }]);
    expect(() =>
      router.route("summary", basePolicy({ task: "ranking", fallbackProviders: ["a"] })),
    ).toThrow(RoutePolicyError);
  });

  it("throws RoutePolicyError for an invalid privacy value (fail closed)", () => {
    const { router } = setup([{ id: "a", capabilities: ["ranking"], privacy: "local" }]);
    const bad = basePolicy({ privacy: "local" as ModelPolicy["privacy"], fallbackProviders: ["a"] });
    expect(() => router.route("ranking", bad)).toThrow(RoutePolicyError);
  });

  it("constructor rejects a directory that is not a directory", () => {
    expect(() => new ModelRouter({} as never)).toThrow();
  });
});
