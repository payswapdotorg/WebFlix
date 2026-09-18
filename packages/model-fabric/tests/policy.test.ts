/**
 * @wfx/model-fabric — R06 policy tests: total validation of the frozen
 * `ModelPolicy` contract, the effective-policy resolution (the BYOM
 * replacement law, the local-only unbending, cost-ceiling preservation),
 * and the provider catalog with per-task capability truth.
 *
 * Determinism: pure functions + fabricated registries (makeEchoProvider
 * doubles); no I/O, no network.
 */

import { describe, expect, it } from "bun:test";

import {
  buildModelProviderCatalog,
  isModelTask,
  makeEchoProvider,
  MAX_FALLBACK_PROVIDERS,
  ModelFabricRegistry,
  resolveEffectiveModelPolicy,
  validateModelPolicyInput,
  WFX_MODEL_ID,
  type ByomBindingSummary,
  type RegisteredModelProvider,
} from "../src/index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The canonical echo provider (fabric testing double — never production). */
function echo(
  id: string,
  options: { tasks?: readonly string[]; privacy?: "local" | "cloud" } = {},
): RegisteredModelProvider {
  return makeEchoProvider(id, {
    ...(options.tasks !== undefined ? { capabilities: options.tasks as never } : {}),
    ...(options.privacy !== undefined ? { privacy: options.privacy } : {}),
  });
}

const FIRST_PARTY = echo(WFX_MODEL_ID, { tasks: ["recommendation", "ranking"] });
const LOCAL_TRANSFORM = echo("wfx-local-transform", { tasks: ["translation", "summary"] });
const CLOUD_BYOM = echo("byom-cloud-alpha", { tasks: ["translation"], privacy: "cloud" });

function registryWith(providers: readonly RegisteredModelProvider[]): ModelFabricRegistry {
  const registry = new ModelFabricRegistry();
  for (const provider of providers) registry.register(provider);
  return registry;
}

const REGISTRY = registryWith([FIRST_PARTY, LOCAL_TRANSFORM, CLOUD_BYOM]);

const BYOM_CLOUD: ByomBindingSummary = {
  providerId: "byom-cloud-alpha",
  privacy: "cloud",
  tasks: ["translation"],
};

// ---------------------------------------------------------------------------
// validateModelPolicyInput
// ---------------------------------------------------------------------------

describe("validateModelPolicyInput (the frozen contract, total validation)", () => {
  it("accepts a well-formed policy verbatim", () => {
    const result = validateModelPolicyInput({
      task: "translation",
      fallbackProviders: ["byom-cloud-alpha", WFX_MODEL_ID],
      privacy: "trusted-cloud",
      maxCostPerOperation: 0.5,
      preferredProvider: "byom-cloud-alpha",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.task).toBe("translation");
      expect(result.value.fallbackProviders).toHaveLength(2);
      expect(result.value.privacy).toBe("trusted-cloud");
      expect(result.value.maxCostPerOperation).toBe(0.5);
    }
  });

  it("accepts a policy without the optional fields", () => {
    const result = validateModelPolicyInput({
      task: "summary",
      fallbackProviders: [WFX_MODEL_ID],
      privacy: "local-only",
    });
    expect(result.ok).toBe(true);
  });

  it("names EVERY problem in one typed answer (never one at a time)", () => {
    const result = validateModelPolicyInput({
      task: "not-a-task",
      fallbackProviders: [],
      privacy: "sky",
      preferredProvider: "  ",
      maxCostPerOperation: -1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.problems.map((problem) => problem.path).sort();
      expect(paths).toEqual([
        "policy.fallbackProviders",
        "policy.maxCostPerOperation",
        "policy.preferredProvider",
        "policy.privacy",
        "policy.task",
      ]);
    }
  });

  it("rejects a non-object and non-string fallback entries with paths", () => {
    const notObject = validateModelPolicyInput("local-only");
    expect(notObject.ok).toBe(false);

    const badEntries = validateModelPolicyInput({
      task: "summary",
      fallbackProviders: ["ok", 42],
      privacy: "any-cloud",
    });
    expect(badEntries.ok).toBe(false);
    if (!badEntries.ok) {
      expect(badEntries.problems[0]!.path).toBe("policy.fallbackProviders[1]");
    }
  });

  it("rejects an over-long fallback chain with the bound named", () => {
    const chain = Array.from({ length: MAX_FALLBACK_PROVIDERS + 1 }, (_, i) => `p${i}`);
    const result = validateModelPolicyInput({
      task: "summary",
      fallbackProviders: chain,
      privacy: "any-cloud",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems[0]!.message).toContain(String(MAX_FALLBACK_PROVIDERS));
    }
  });
});

// ---------------------------------------------------------------------------
// resolveEffectiveModelPolicy — the BYOM replacement law
// ---------------------------------------------------------------------------

describe("resolveEffectiveModelPolicy (the R06 replacement law)", () => {
  it("a BYOM binding for the task REPLACES the first-party preferred route", () => {
    const resolution = resolveEffectiveModelPolicy({
      task: "translation",
      stored: {
        task: "translation",
        fallbackProviders: [WFX_MODEL_ID],
        privacy: "any-cloud",
      },
      byomBindings: [BYOM_CLOUD],
      registry: REGISTRY,
      firstPartyProviderId: WFX_MODEL_ID,
    });
    expect(resolution.preferredSource).toBe("byom-replacement");
    expect(resolution.policy.preferredProvider).toBe("byom-cloud-alpha");
    // The first-party default stays the recoverable floor in the chain.
    expect(resolution.policy.fallbackProviders[0]).toBe("byom-cloud-alpha");
    expect(resolution.policy.fallbackProviders).toContain(WFX_MODEL_ID);
    expect(resolution.policy.privacy).toBe("any-cloud");
    expect(resolution.byomConsidered[0]!.eligible).toBe(true);
  });

  it("a CLOUD binding is INELIGIBLE under the local-only class — the policy never bends for BYOM", () => {
    const resolution = resolveEffectiveModelPolicy({
      task: "translation",
      stored: {
        task: "translation",
        fallbackProviders: ["wfx-local-transform"],
        privacy: "local-only",
      },
      byomBindings: [BYOM_CLOUD],
      registry: REGISTRY,
      firstPartyProviderId: WFX_MODEL_ID,
    });
    expect(resolution.preferredSource).toBe("stored");
    expect(resolution.policy.preferredProvider).toBe("wfx-local-transform");
    expect(resolution.policy.fallbackProviders).not.toContain("byom-cloud-alpha");
    expect(resolution.byomConsidered[0]!.eligible).toBe(false);
    expect(resolution.byomConsidered[0]!.reason).toContain("local-only");
  });

  it("a LOCAL binding is eligible under local-only", () => {
    const resolution = resolveEffectiveModelPolicy({
      task: "translation",
      byomBindings: [{ providerId: "wfx-local-transform", privacy: "local", tasks: ["translation"] }],
      registry: REGISTRY,
      firstPartyProviderId: WFX_MODEL_ID,
    });
    expect(resolution.preferredSource).toBe("byom-replacement");
    expect(resolution.policy.preferredProvider).toBe("wfx-local-transform");
    expect(resolution.policy.privacy).toBe("local-only");
  });

  it("an UNREGISTERED binding is ineligible with the honest reason", () => {
    const resolution = resolveEffectiveModelPolicy({
      task: "translation",
      byomBindings: [{ providerId: "byom-ghost", privacy: "cloud", tasks: ["translation"] }],
      registry: REGISTRY,
      firstPartyProviderId: WFX_MODEL_ID,
    });
    expect(resolution.preferredSource).toBe("first-party-default");
    expect(resolution.byomConsidered[0]!.eligible).toBe(false);
    expect(resolution.byomConsidered[0]!.reason).toContain("not registered");
  });

  it("a binding for a DIFFERENT task never replaces this task's route", () => {
    const resolution = resolveEffectiveModelPolicy({
      task: "summary",
      byomBindings: [BYOM_CLOUD],
      registry: REGISTRY,
      firstPartyProviderId: WFX_MODEL_ID,
    });
    expect(resolution.preferredSource).toBe("first-party-default");
    expect(resolution.byomConsidered).toHaveLength(0);
  });

  it("no stored policy ⇒ fail-closed local-only with the first-party default", () => {
    const resolution = resolveEffectiveModelPolicy({
      task: "recommendation",
      byomBindings: [],
      registry: REGISTRY,
      firstPartyProviderId: WFX_MODEL_ID,
    });
    expect(resolution.policy.privacy).toBe("local-only");
    expect(resolution.policy.fallbackProviders).toContain(WFX_MODEL_ID);
    expect(resolution.preferredSource).toBe("first-party-default");
  });

  it("the stored cost ceiling is PRESERVED on the effective policy", () => {
    const resolution = resolveEffectiveModelPolicy({
      task: "translation",
      stored: {
        task: "translation",
        fallbackProviders: [WFX_MODEL_ID],
        privacy: "any-cloud",
        maxCostPerOperation: 0.25,
      },
      byomBindings: [BYOM_CLOUD],
      registry: REGISTRY,
      firstPartyProviderId: WFX_MODEL_ID,
    });
    expect(resolution.policy.maxCostPerOperation).toBe(0.25);
  });

  it("local-only with NO local provider answers the honest empty chain (no silent substitution)", () => {
    // Registry with ONLY cloud providers for the task.
    const cloudOnly = registryWith([CLOUD_BYOM, FIRST_PARTY]);
    const resolution = resolveEffectiveModelPolicy({
      task: "translation",
      byomBindings: [],
      registry: cloudOnly,
      firstPartyProviderId: WFX_MODEL_ID,
    });
    // The stored chain is empty and the only candidates are cloud: the
    // resolver must NOT substitute a cloud provider under local-only.
    expect(resolution.policy.privacy).toBe("local-only");
    expect(
      resolution.policy.fallbackProviders.every((id) => {
        const provider = cloudOnly.get(id);
        return provider === undefined || provider.privacy === "local";
      }),
    ).toBe(true);
    if (resolution.preferredSource === "local-only-fallback") {
      expect(resolution.policy.fallbackProviders).toHaveLength(0);
    }
  });

  it("the stored chain is honored in order (deduplicated, unregistered ids dropped)", () => {
    const resolution = resolveEffectiveModelPolicy({
      task: "recommendation",
      stored: {
        task: "recommendation",
        fallbackProviders: ["ghost-provider", "wfx-first-party", "wfx-first-party"],
        privacy: "any-cloud",
      },
      byomBindings: [],
      registry: REGISTRY,
      firstPartyProviderId: WFX_MODEL_ID,
    });
    expect(resolution.policy.fallbackProviders).toEqual(["wfx-first-party"]);
  });
});

// ---------------------------------------------------------------------------
// buildModelProviderCatalog — the capability-truth view
// ---------------------------------------------------------------------------

describe("buildModelProviderCatalog (capability truth)", () => {
  it("classifies first-party / BYOM / local rows and reports per-task truth", () => {
    const catalog = buildModelProviderCatalog({
      registry: REGISTRY,
      byomBindings: [BYOM_CLOUD],
      firstPartyProviderId: WFX_MODEL_ID,
    });
    const byId = new Map(catalog.providers.map((entry) => [entry.id, entry] as const));
    expect(byId.get(WFX_MODEL_ID)!.origin).toBe("first-party");
    expect(byId.get(WFX_MODEL_ID)!.bound).toBe(true);
    expect(byId.get("byom-cloud-alpha")!.origin).toBe("byom");
    expect(byId.get("byom-cloud-alpha")!.bound).toBe(true);
    expect(byId.get("wfx-local-transform")!.origin).toBe("local");
    expect(byId.get("wfx-local-transform")!.bound).toBe(true);

    const firstParty = byId.get(WFX_MODEL_ID)!;
    const recommendation = firstParty.capabilities.find((c) => c.task === "recommendation")!;
    expect(recommendation.available).toBe(true);
    const translation = firstParty.capabilities.find((c) => c.task === "translation")!;
    expect(translation.available).toBe(false); // NOT declared — the truth
    expect(firstParty.capabilities).toHaveLength(9); // every frozen ModelTask
  });

  it("reports local support HONESTLY per task (never assumed)", () => {
    const catalog = buildModelProviderCatalog({
      registry: REGISTRY,
      byomBindings: [],
      firstPartyProviderId: WFX_MODEL_ID,
    });
    expect(catalog.localSupport.recommendation).toBe(true); // the first-party local model
    expect(catalog.localSupport.ranking).toBe(true); // the first-party local model
    expect(catalog.localSupport.translation).toBe(true); // the local transform double
    expect(catalog.localSupport.summary).toBe(true); // the local transform double
    expect(catalog.localSupport.dubbing).toBe(false); // no local provider — honest
    expect(catalog.localSupport.commentary).toBe(false); // no local provider — honest
    // every frozen task has an entry (isModelTask sanity)
    for (const task of Object.keys(catalog.localSupport)) {
      expect(isModelTask(task)).toBe(true);
    }
  });

  it("binding notes carry metadata ONLY (never key material)", () => {
    const catalog = buildModelProviderCatalog({
      registry: REGISTRY,
      byomBindings: [BYOM_CLOUD],
      firstPartyProviderId: WFX_MODEL_ID,
      bindingNotes: new Map([["byom-cloud-alpha", "a bound byom provider (endpoint example.net)"]]),
    });
    const byom = catalog.providers.find((entry) => entry.id === "byom-cloud-alpha")!;
    expect(byom.note).toContain("example.net");
    expect(byom.note).not.toContain("secret");
    expect(byom.note).not.toContain("apiKey");
  });
});
