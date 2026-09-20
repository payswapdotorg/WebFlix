/**
 * @wfx/client-runtime — R22-C BYOM management contract tests.
 *
 * The F8 completion law, at the shared seam:
 * - the binding summary over the EXISTING registry rows (bound vs
 *   first-party, secret-free);
 * - supported task capabilities + privacy mode + availability truth
 *   (never a fabricated capability);
 * - the derived VERIFY/USABLE truth: capability + availability + the
 *   task's fail-closed effective privacy class (an unset policy behaves
 *   local-only — a cloud BYOM provider is unusable for the task until
 *   the policy allows a cloud class);
 * - add/bind: the shared command validation mirroring the service's own
 *   rules;
 * - remove/unbind: the typed per-entry action;
 * - typed errors/recovery for bind/unbind transport failures;
 * - the SECRET LAW: the view never carries the provider key (machine
 *   checked); garbage rows carrying key material never become entries;
 * - in-model degradation + the honest empty state.
 */

import { describe, expect, it } from "bun:test";

import type { ModelPolicy, ModelTask } from "@wfx/domain";

import {
  assertByomManagementSecretFree,
  assertNoSecretMaterial,
  BYOM_ADD_ACTION,
  BYOM_EMPTY_DETAIL,
  BYOM_MODEL_TASKS,
  BYOM_POLICY_PRIVACY_LABELS,
  BYOM_PRIVACY_LABELS,
  byomBindCommandProblems,
  byomManagementRecovery,
  byomManagementView,
  describeByomBindProblems,
  isByomModelTask,
  isUsableModelProviderRow,
  type ByomBindCommand,
  type ModelProviderInfo,
} from "../src/index";

/** A valid first-party provider row (the registry's local WFX model). */
function wfxModel(): ModelProviderInfo {
  return {
    id: "wfx-model",
    privacy: "local",
    capabilities: ["summary", "translation", "transcription"],
    byomBound: false,
    costs: { summary: 0, translation: 0, transcription: 0 },
    availability: "available",
  };
}

/** A valid BYOM-bound provider row (the registry's secret-free projection). */
function byomProvider(overrides: Partial<ModelProviderInfo> = {}): ModelProviderInfo {
  return {
    id: "my-openai",
    privacy: "cloud",
    capabilities: ["summary", "translation", "commentary"],
    byomBound: true,
    costs: { summary: 2, translation: 2, commentary: 3 },
    availability: "available",
    ...overrides,
  };
}

function policy(privacy: ModelPolicy["privacy"], preferred?: string): ModelPolicy {
  return {
    task: "summary",
    fallbackProviders: [],
    privacy,
    ...(preferred !== undefined ? { preferredProvider: preferred } : {}),
  };
}

// ---------------------------------------------------------------------------
// The binding summary + capability/privacy/availability truth
// ---------------------------------------------------------------------------

describe("R22-C — the binding summary over the existing registry rows", () => {
  it("splits bound BYOM providers from first-party rows with stable order", () => {
    const view = byomManagementView({
      providers: [wfxModel(), byomProvider()],
    });
    expect(view.bound.map((entry) => entry.providerId)).toEqual(["my-openai"]);
    expect(view.firstParty.map((entry) => entry.providerId)).toEqual(["wfx-model"]);
    // The bound entry's summary: capabilities, costs, privacy mode, availability.
    const bound = view.bound[0]!;
    expect(bound.bound).toBe(true);
    expect(bound.capabilities).toEqual(["summary", "translation", "commentary"]);
    expect(bound.costs["summary"]).toBe(2);
    expect(bound.privacy).toBe("cloud");
    expect(bound.privacyLabel).toBe(BYOM_PRIVACY_LABELS.cloud);
    expect(bound.availability).toBe("available");
    expect(bound.action.kind).toBe("remove");
    expect(bound.action.label).toBe("Remove");
  });

  it("the first-party row renders its context truth with NO user action", () => {
    const view = byomManagementView({ providers: [wfxModel()] });
    const entry = view.firstParty[0]!;
    expect(entry.bound).toBe(false);
    expect(entry.stateLabel).toBe("Built-in");
    expect(entry.action.kind).toBe("none");
    expect(entry.tone).toBe("neutral");
  });

  it("the panel's single primary action is the frozen ADD action", () => {
    const view = byomManagementView({ providers: [wfxModel()] });
    expect(view.addAction).toEqual(BYOM_ADD_ACTION);
    expect(view.addAction.kind).toBe("add");
    expect(view.addAction.label).toBe("Add your model provider");
    expect(view.addAction.detail).toContain("encrypted");
  });

  it("an unavailable provider is honestly unavailable — never fabricated as working", () => {
    const view = byomManagementView({
      providers: [byomProvider({ availability: "unsupported" })],
    });
    const entry = view.bound[0]!;
    expect(entry.availability).toBe("unsupported");
    expect(entry.stateLabel).toBe("Unavailable");
    expect(entry.tone).toBe("negative");
    expect(entry.taskUsability.every((row) => row.usable === false)).toBe(true);
    expect(entry.taskUsability[0]?.unusableReason).toContain("isn't available");
  });

  it("garbage registry rows are skipped — never a provider entry", () => {
    const garbage = [
      { id: "", privacy: "cloud", capabilities: [], byomBound: true, costs: {}, availability: "available" },
      { id: "no-privacy", capabilities: [], byomBound: true, costs: {}, availability: "available" },
      { id: "bad-task", privacy: "cloud", capabilities: ["teleport"], byomBound: true, costs: {}, availability: "available" },
      { id: "bad-cost", privacy: "cloud", capabilities: [], byomBound: true, costs: { summary: -1 }, availability: "available" },
      { id: "bad-availability", privacy: "cloud", capabilities: [], byomBound: true, costs: {}, availability: "maybe" },
      "not-even-a-row",
    ];
    const view = byomManagementView({ providers: [...garbage] as unknown as ModelProviderInfo[] });
    expect(view.bound).toEqual([]);
    expect(view.firstParty).toEqual([]);
    expect(isUsableModelProviderRow(byomProvider())).toBe(true);
    expect(isUsableModelProviderRow(garbage[2])).toBe(false);
  });

  it("a row carrying key material is UNUSABLE — never a provider entry", () => {
    const poisoned = {
      ...byomProvider(),
      key: "sk-provider-secret",
    } as unknown as ModelProviderInfo;
    expect(isUsableModelProviderRow(poisoned)).toBe(false);
    const view = byomManagementView({ providers: [poisoned] });
    expect(view.bound).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The privacy mode + the derived verify/usable truth
// ---------------------------------------------------------------------------

describe("R22-C — privacy mode + the derived verify/usable truth", () => {
  it("an unset policy is the honest null + the fail-closed local-only effective class", () => {
    const view = byomManagementView({ providers: [byomProvider()] });
    const summary = view.taskPolicies.find((row) => row.task === "summary")!;
    expect(summary.policyPrivacy).toBeNull();
    expect(summary.effectivePrivacy).toBe("local-only");
    expect(summary.preferredProvider).toBeNull();
    // Every frozen task carries its policy row.
    expect(view.taskPolicies.map((row) => row.task)).toEqual([...BYOM_MODEL_TASKS]);
  });

  it("a cloud BYOM provider is UNUSABLE for a task under local-only (the fail-closed law), with the honest reason", () => {
    const view = byomManagementView({ providers: [byomProvider()] });
    const entry = view.bound[0]!;
    for (const row of entry.taskUsability) {
      expect(row.usable).toBe(false);
      expect(row.unusableReason).toContain("local models");
    }
    expect(entry.stateLabel).toBe("Added — not in use");
    expect(entry.stateDetail).toContain("policies");
    expect(entry.tone).toBe("attention");
  });

  it("allowing a cloud class makes the cloud provider usable for that task (the verify truth)", () => {
    const policies: Partial<Record<ModelTask, ModelPolicy | null>> = {
      summary: policy("any-cloud"),
      translation: policy("trusted-cloud"),
      // commentary stays unset ⇒ local-only ⇒ unusable
    };
    const view = byomManagementView({ providers: [byomProvider()], policies });
    const entry = view.bound[0]!;
    const summary = entry.taskUsability.find((row) => row.task === "summary")!;
    expect(summary.usable).toBe(true);
    const translation = entry.taskUsability.find((row) => row.task === "translation")!;
    expect(translation.usable).toBe(true);
    const commentary = entry.taskUsability.find((row) => row.task === "commentary")!;
    expect(commentary.usable).toBe(false);
    expect(commentary.unusableReason).toContain("local models");
    expect(entry.stateLabel).toBe("Added");
    expect(entry.stateDetail).toContain("2 of 3");
    expect(entry.tone).toBe("positive");
  });

  it("a local provider is usable under every policy class (local never conflicts)", () => {
    const view = byomManagementView({
      providers: [wfxModel()],
      policies: { summary: policy("local-only") },
    });
    const entry = view.firstParty[0]!;
    expect(entry.taskUsability.every((row) => row.usable)).toBe(true);
  });

  it("the stored policy's preferred provider and privacy class ride the task rows", () => {
    const view = byomManagementView({
      providers: [byomProvider()],
      policies: { summary: policy("trusted-cloud", "my-openai") },
    });
    const summary = view.taskPolicies.find((row) => row.task === "summary")!;
    expect(summary.policyPrivacy).toBe("trusted-cloud");
    expect(summary.effectivePrivacy).toBe("trusted-cloud");
    expect(summary.preferredProvider).toBe("my-openai");
    expect(BYOM_POLICY_PRIVACY_LABELS["local-only"]).toBe("Local models only");
  });
});

// ---------------------------------------------------------------------------
// The bind command validation (mirrors the service's own rules)
// ---------------------------------------------------------------------------

describe("R22-C — the add/bind command validation", () => {
  const valid: ByomBindCommand = {
    providerId: "my-openai",
    endpointUrl: "https://api.example.com/v1",
    key: "sk-the-provider-key",
    capabilities: ["summary", "translation"],
    costPerCall: 2,
  };

  it("accepts a valid command (problems list empty)", () => {
    expect(byomBindCommandProblems(valid)).toEqual([]);
  });

  it("rejects a blank providerId, a non-http endpoint, and a blank key (typed fields)", () => {
    const problems = byomBindCommandProblems({
      ...valid,
      providerId: "   ",
      endpointUrl: "ftp://example.com",
      key: "  ",
    });
    expect(problems.map((problem) => problem.field)).toEqual([
      "providerId",
      "endpointUrl",
      "key",
    ]);
    // The key problem's sentence states the secret law.
    expect(problems.find((problem) => problem.field === "key")?.detail).toContain("encrypted");
  });

  it("rejects out-of-vocabulary capabilities and a negative cost", () => {
    const problems = byomBindCommandProblems({
      ...valid,
      capabilities: ["teleport" as unknown as ModelTask],
      costPerCall: -1,
    });
    expect(problems.map((problem) => problem.field)).toEqual(["capabilities", "costPerCall"]);
    expect(isByomModelTask("summary")).toBe(true);
    expect(isByomModelTask("teleport")).toBe(false);
  });

  it("collects every problem at once; describe renders them for diagnostics", () => {
    const problems = byomBindCommandProblems({ ...valid, key: "" });
    expect(problems).toHaveLength(1);
    expect(describeByomBindProblems(problems)).toContain("key:");
  });
});

// ---------------------------------------------------------------------------
// The typed errors/recovery (bind/unbind)
// ---------------------------------------------------------------------------

describe("R22-C — typed bind/unbind failure recovery (never a dead end)", () => {
  it("maps every transport failure kind to its typed recovery", () => {
    expect(
      byomManagementRecovery("bind", { kind: "network", detail: "offline" }).kind,
    ).toBe("retry");
    expect(
      byomManagementRecovery("unbind", { kind: "unauthorized", detail: "401" }).kind,
    ).toBe("sign-in-again");
    expect(
      byomManagementRecovery("bind", { kind: "unavailable", detail: "503" }).kind,
    ).toBe("retry");
    expect(
      byomManagementRecovery("unbind", { kind: "malformed", detail: "garbage" }).kind,
    ).toBe("retry");
    expect(
      byomManagementRecovery("bind", { kind: "invalid-input", detail: "bad url" }).kind,
    ).toBe("fix-and-retry");
  });

  it("every recovery sentence is honest user vocabulary (no jargon, names the outcome)", () => {
    for (const operation of ["bind", "unbind"] as const) {
      for (const kind of ["network", "unauthorized", "unavailable", "malformed"] as const) {
        const recovery = byomManagementRecovery(operation, { kind, detail: "x" });
        expect(recovery.label.length).toBeGreaterThan(0);
        expect(recovery.detail).toContain(
          operation === "bind" ? "wasn't added" : "wasn't removed",
        );
        expect(/http|4\d\d|5\d\d|PUT|DELETE|transport/i.test(recovery.label)).toBe(false);
      }
    }
  });

  it("the malformed/unavailable truths state nothing was saved", () => {
    expect(
      byomManagementRecovery("bind", { kind: "malformed", detail: "x" }).detail,
    ).toContain("nothing was saved");
    expect(
      byomManagementRecovery("bind", { kind: "unavailable", detail: "x" }).detail,
    ).toContain("try again in a moment");
  });
});

// ---------------------------------------------------------------------------
// In-model degradation + the honest empty state + the secret law
// ---------------------------------------------------------------------------

describe("R22-C — degradation, the honest empty state, and the secret law", () => {
  it("an error status keeps the entries visible (in-model degradation)", () => {
    const status = {
      state: "error" as const,
      error: { kind: "network" as const, detail: "GET /experience/model-providers did not complete" },
    };
    const view = byomManagementView({
      providers: [byomProvider()],
      status,
    });
    expect(view.status).toEqual(status);
    expect(view.bound).toHaveLength(1);
  });

  it("the honest empty state names the built-in truth (present tense, never stale copy)", () => {
    const view = byomManagementView({ providers: [wfxModel()] });
    expect(view.bound).toEqual([]);
    expect(view.emptyDetail).toBe(BYOM_EMPTY_DETAIL);
    expect(view.emptyDetail).toContain("built-in local model");
    expect(/arrives later|coming soon|ships with/i.test(view.emptyDetail ?? "")).toBe(false);
    // A bound provider clears the empty state.
    const withBound = byomManagementView({ providers: [wfxModel(), byomProvider()] });
    expect(withBound.emptyDetail).toBeNull();
    // A degraded read does not claim the empty state either.
    const degraded = byomManagementView({
      providers: [wfxModel()],
      status: { state: "error", error: { kind: "network", detail: "down" } },
    });
    expect(degraded.emptyDetail).toBeNull();
  });

  it("the view is SECRET-FREE (machine-checked) — the key never appears after submission", () => {
    const view = byomManagementView({
      providers: [wfxModel(), byomProvider()],
      policies: { summary: policy("any-cloud", "my-openai") },
    });
    expect(() => assertByomManagementSecretFree(view)).not.toThrow();
    const serialized = JSON.stringify(view);
    // No secret VALUES (the fixture key material never enters the view)...
    expect(serialized.includes("sk-")).toBe(false);
    // ...and no secret FIELDS (a JSON field named key/secret/token/password).
    expect(/"(key|secret|apiKey|password|token|credential|sealedSecret)"\s*:/.test(serialized)).toBe(false);
    // (The word "key" in the ADD action's user sentence — "paste your
    // provider's web address and key" — is language, not material.)
  });

  it("assertByomManagementSecretFree throws on secret material (the machine check)", () => {
    const poisoned = {
      status: { state: "ready" as const },
      addAction: BYOM_ADD_ACTION,
      bound: [{ providerId: "x", key: "sk-leak" }],
      firstParty: [],
      taskPolicies: [],
      emptyDetail: null,
    };
    expect(() => assertByomManagementSecretFree(poisoned as never)).toThrow(/key/);
    expect(() => assertNoSecretMaterial({ nested: { apiKey: "leak" } }, "x")).toThrow(
      /apiKey/,
    );
  });
});
