/**
 * @wfx/model-fabric — registry tests (WFX-030): capability indexing,
 * duplicate-id rejection, describe() id × task matrix, registration
 * validation, defensive copies.
 */

import { describe, expect, it } from "bun:test";
import type { ModelTask } from "@wfx/domain";

import {
  DuplicateProviderError,
  InvalidProviderRegistrationError,
  makeEchoProvider,
  makeFailingProvider,
  ModelFabricRegistry,
  type RegisteredModelProvider,
} from "../src/index";
import { MODEL_TASKS } from "../src/index";

function echo(id: string, capabilities: ModelTask[], privacy: "local" | "cloud" = "local") {
  return makeEchoProvider(id, { capabilities, privacy });
}

describe("model-fabric registry — registration & indexing", () => {
  it("registers providers and indexes them under every declared capability", () => {
    const registry = new ModelFabricRegistry();
    const ranker = echo("ranker", ["ranking", "recommendation"]);
    const summarizer = echo("summarizer", ["summary"]);
    registry.register(ranker).register(summarizer);

    expect(registry.size()).toBe(2);
    expect(registry.providersFor("ranking")).toEqual([ranker]);
    expect(registry.providersFor("recommendation")).toEqual([ranker]);
    expect(registry.providersFor("summary")).toEqual([summarizer]);
    expect(registry.providersFor("translation")).toEqual([]);
  });

  it("providersFor preserves registration order within a task", () => {
    const registry = new ModelFabricRegistry();
    const a = echo("a", ["ranking"]);
    const b = echo("b", ["ranking"]);
    const c = echo("c", ["ranking"]);
    registry.register(a).register(b).register(c);
    expect(registry.providersFor("ranking").map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("get resolves by id and returns undefined for unknown ids", () => {
    const registry = new ModelFabricRegistry();
    const provider = echo("known", ["summary"]);
    registry.register(provider);
    expect(registry.get("known")).toBe(provider);
    expect(registry.get("unknown")).toBeUndefined();
  });

  it("providersFor returns a defensive copy — mutating it never corrupts the index", () => {
    const registry = new ModelFabricRegistry();
    registry.register(echo("a", ["ranking"]));
    const list = registry.providersFor("ranking") as RegisteredModelProvider[];
    list.length = 0; // caller mutates the returned array
    expect(registry.providersFor("ranking").length).toBe(1);
  });
});

describe("model-fabric registry — duplicate-id rejection", () => {
  it("rejects a second registration under the same id", () => {
    const registry = new ModelFabricRegistry();
    registry.register(echo("dup", ["summary"]));
    let caught: unknown;
    try {
      registry.register(echo("dup", ["ranking"]));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DuplicateProviderError);
    expect((caught as DuplicateProviderError).id).toBe("dup");
    expect((caught as Error).message).toContain("dup");
    // The original registration is untouched — ids are never overwritten.
    expect(registry.size()).toBe(1);
    expect(registry.providersFor("summary").map((p) => p.id)).toEqual(["dup"]);
    expect(registry.providersFor("ranking")).toEqual([]);
  });
});

describe("model-fabric registry — registration validation", () => {
  it("rejects an empty id", () => {
    const registry = new ModelFabricRegistry();
    expect(() => registry.register(echo("", ["summary"]))).toThrow(
      InvalidProviderRegistrationError,
    );
  });

  it("rejects invalid privacy values", () => {
    const registry = new ModelFabricRegistry();
    const bad = makeEchoProvider("bad-privacy", {
      capabilities: ["summary"],
      privacy: "any-cloud" as "local" | "cloud", // a POLICY privacy, not a provider privacy
    });
    expect(() => registry.register(bad)).toThrow(InvalidProviderRegistrationError);
  });

  it("rejects capabilities outside the frozen ModelTask union", () => {
    const registry = new ModelFabricRegistry();
    const bad = makeEchoProvider("bad-caps", {
      capabilities: ["summary", "summarize" as ModelTask],
    });
    expect(() => registry.register(bad)).toThrow(InvalidProviderRegistrationError);
  });

  it("rejects a registration whose invoke is not a function", () => {
    const registry = new ModelFabricRegistry();
    const bad = {
      id: "no-invoke",
      capabilities: ["summary"],
      privacy: "local",
      costPerOperation: () => undefined,
      invoke: "not-a-function",
    } as unknown as RegisteredModelProvider;
    expect(() => registry.register(bad)).toThrow(InvalidProviderRegistrationError);
  });

  it("rejects a registration whose costPerOperation is not a function", () => {
    const registry = new ModelFabricRegistry();
    const bad = {
      id: "no-cost-fn",
      capabilities: ["summary"],
      privacy: "local",
      invoke: async () => null,
      costPerOperation: 3,
    } as unknown as RegisteredModelProvider;
    expect(() => registry.register(bad)).toThrow(InvalidProviderRegistrationError);
  });

  it("validation failures leave the registry unchanged", () => {
    const registry = new ModelFabricRegistry();
    registry.register(echo("good", ["summary"]));
    try {
      registry.register(echo("", ["summary"]));
    } catch {
      // expected
    }
    expect(registry.size()).toBe(1);
  });
});

describe("model-fabric registry — describe() id × task matrix", () => {
  it("renders provider rows in registration order with privacy and capabilities", () => {
    const registry = new ModelFabricRegistry();
    registry
      .register(echo("local-ranker", ["ranking"], "local"))
      .register(echo("cloud-summarizer", ["summary"], "cloud"));

    const description = registry.describe();
    expect(description.providers).toEqual([
      { id: "local-ranker", privacy: "local", capabilities: ["ranking"] },
      { id: "cloud-summarizer", privacy: "cloud", capabilities: ["summary"] },
    ]);
  });

  it("byTask covers EVERY frozen ModelTask, including tasks with no providers", () => {
    const registry = new ModelFabricRegistry();
    expect(Object.keys(registry.describe().byTask).sort()).toEqual([...MODEL_TASKS].sort());

    registry.register(echo("a", ["ranking"])).register(echo("b", ["ranking", "summary"]));
    const byTask = registry.describe().byTask;
    expect(byTask.ranking).toEqual(["a", "b"]);
    expect(byTask.summary).toEqual(["b"]);
    expect(byTask.dubbing).toEqual([]);
    expect(byTask.commentary).toEqual([]);
  });

  it("describe() returns fresh data — mutating it never corrupts the registry", () => {
    const registry = new ModelFabricRegistry();
    registry.register(echo("a", ["ranking"]));
    const first = registry.describe();
    (first.providers[0]!.capabilities as string[]).push("dubbing");
    (first.byTask.ranking as string[]).push("ghost");
    const second = registry.describe();
    expect(second.providers[0]!.capabilities).toEqual(["ranking"]);
    expect(second.byTask.ranking).toEqual(["a"]);
  });

  it("describes fixtures with declared costs without invoking cost logic (matrix is metadata-only)", () => {
    const registry = new ModelFabricRegistry();
    const costly = makeEchoProvider("costly", {
      capabilities: ["translation"],
      costs: { translation: 7 },
    });
    registry.register(costly);
    expect(costly.costPerOperation("translation")).toBe(7);
    expect(costly.costPerOperation("ranking")).toBeUndefined();
    expect(registry.describe().byTask.translation).toEqual(["costly"]);
  });
});

describe("model-fabric registry — integrates with the failing fixture", () => {
  it("registers failing providers like any other provider", () => {
    const registry = new ModelFabricRegistry();
    const failing = makeFailingProvider("f", { capabilities: ["summary"] });
    registry.register(failing);
    expect(registry.get("f")).toBe(failing);
    expect(registry.providersFor("summary")).toEqual([failing]);
  });
});
