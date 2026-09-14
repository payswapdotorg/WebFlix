/**
 * @wfx/model-fabric — types, error shapes, guards, and trace vocabulary tests
 * (WFX-030). Every packet-mandated error shape is asserted EXACTLY; guards
 * are exercised against valid and invalid shapes.
 */

import { describe, expect, it } from "bun:test";
import { isIso8601 } from "@wfx/domain";

import {
  costError,
  describeFabricError,
  FABRIC_ERROR_KINDS,
  INVOCATION_ID_PREFIX,
  isCostError,
  isErr,
  isFabricError,
  isInvocationId,
  isModelPolicyPrivacy,
  isModelTask,
  isNoProvider,
  isOk,
  isPolicyError,
  isPrivacyError,
  isProviderError,
  isTimeoutError,
  MODEL_POLICY_PRIVACIES,
  MODEL_TASKS,
  newInvocationId,
  noProvider,
  policyError,
  privacyError,
  providerError,
  timeoutError,
} from "../src/index";

describe("model-fabric types — vocabularies", () => {
  it("MODEL_TASKS mirrors the frozen ModelTask union exactly, in contract order", () => {
    expect([...MODEL_TASKS]).toEqual([
      "recommendation",
      "ranking",
      "summary",
      "translation",
      "transcription",
      "speechToText",
      "textToSpeech",
      "dubbing",
      "commentary",
    ]);
  });

  it("isModelTask accepts every frozen task and rejects everything else", () => {
    for (const task of MODEL_TASKS) expect(isModelTask(task)).toBe(true);
    expect(isModelTask("summarize")).toBe(false); // not a frozen task
    expect(isModelTask("")).toBe(false);
    expect(isModelTask(42)).toBe(false);
    expect(isModelTask(undefined)).toBe(false);
    expect(isModelTask(null)).toBe(false);
  });

  it("MODEL_POLICY_PRIVACIES mirrors the frozen privacy union exactly", () => {
    expect([...MODEL_POLICY_PRIVACIES]).toEqual(["local-only", "trusted-cloud", "any-cloud"]);
  });

  it("isModelPolicyPrivacy accepts the frozen values and rejects others", () => {
    expect(isModelPolicyPrivacy("local-only")).toBe(true);
    expect(isModelPolicyPrivacy("trusted-cloud")).toBe(true);
    expect(isModelPolicyPrivacy("any-cloud")).toBe(true);
    expect(isModelPolicyPrivacy("local")).toBe(false); // provider privacy, not policy privacy
    expect(isModelPolicyPrivacy("cloud")).toBe(false);
    expect(isModelPolicyPrivacy(7)).toBe(false);
  });
});

describe("model-fabric types — error shapes (exact, per packet)", () => {
  it("FABRIC_ERROR_KINDS covers exactly the six packet kinds", () => {
    expect([...FABRIC_ERROR_KINDS]).toEqual([
      "no-provider",
      "policy",
      "privacy",
      "cost",
      "provider-error",
      "timeout",
    ]);
  });

  it("no-provider error has exactly { kind, task }", () => {
    expect(noProvider("ranking")).toEqual({ kind: "no-provider", task: "ranking" });
  });

  it("policy error has exactly { kind, detail }", () => {
    expect(policyError("bad policy")).toEqual({ kind: "policy", detail: "bad policy" });
  });

  it("privacy error has exactly { kind, detail }", () => {
    expect(privacyError("would leak")).toEqual({ kind: "privacy", detail: "would leak" });
  });

  it("cost error has exactly { kind, budget, spent }", () => {
    expect(costError(10, 4)).toEqual({ kind: "cost", budget: 10, spent: 4 });
  });

  it("provider-error has exactly { kind, providerId, detail }", () => {
    expect(providerError("prov-a", "boom")).toEqual({
      kind: "provider-error",
      providerId: "prov-a",
      detail: "boom",
    });
  });

  it("timeout error has exactly { kind, providerId, ms }", () => {
    expect(timeoutError("prov-b", 30_000)).toEqual({
      kind: "timeout",
      providerId: "prov-b",
      ms: 30_000,
    });
  });
});

describe("model-fabric types — guards", () => {
  it("per-kind guards narrow their own variant and reject the others", () => {
    const errors = [
      noProvider("summary"),
      policyError("d"),
      privacyError("d"),
      costError(1, 0),
      providerError("p", "d"),
      timeoutError("p", 5),
    ] as const;
    const guards = [
      isNoProvider,
      isPolicyError,
      isPrivacyError,
      isCostError,
      isProviderError,
      isTimeoutError,
    ] as const;
    for (let i = 0; i < errors.length; i += 1) {
      for (let j = 0; j < guards.length; j += 1) {
        expect(guards[j]!(errors[i]!)).toBe(i === j);
      }
    }
  });

  it("isFabricError validates runtime shapes of every variant", () => {
    expect(isFabricError(noProvider("dubbing"))).toBe(true);
    expect(isFabricError(policyError("d"))).toBe(true);
    expect(isFabricError(privacyError("d"))).toBe(true);
    expect(isFabricError(costError(2, 1))).toBe(true);
    expect(isFabricError(providerError("p", "d"))).toBe(true);
    expect(isFabricError(timeoutError("p", 9))).toBe(true);
  });

  it("isFabricError rejects lookalikes and non-errors", () => {
    expect(isFabricError(null)).toBe(false);
    expect(isFabricError(undefined)).toBe(false);
    expect(isFabricError("timeout")).toBe(false);
    expect(isFabricError(new Error("timeout"))).toBe(false);
    expect(isFabricError({ kind: "nope" })).toBe(false);
    expect(isFabricError({ kind: "no-provider", task: "not-a-task" })).toBe(false);
    expect(isFabricError({ kind: "cost", budget: "10", spent: 0 })).toBe(false);
    expect(isFabricError({ kind: "timeout", providerId: "p" })).toBe(false); // ms missing
    expect(isFabricError({ kind: "provider-error", providerId: "p", detail: 5 })).toBe(false);
  });

  it("isOk / isErr narrow the FabricResult branches", () => {
    const okBranch = { ok: true as const, value: 1, trace: {} as never };
    const errBranch = { ok: false as const, error: noProvider("ranking") };
    expect(isOk(okBranch)).toBe(true);
    expect(isErr(okBranch)).toBe(false);
    expect(isOk(errBranch)).toBe(false);
    expect(isErr(errBranch)).toBe(true);
  });
});

describe("model-fabric types — invocation ids", () => {
  it("newInvocationId mints wfxinv_-prefixed ULID-body ids", () => {
    const id = newInvocationId();
    expect(id.startsWith(INVOCATION_ID_PREFIX)).toBe(true);
    expect(isInvocationId(id)).toBe(true);
    // 26-char Crockford Base32 body: sortable timestamp + randomness.
    expect(id.slice(INVOCATION_ID_PREFIX.length)).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  });

  it("successive invocation ids are distinct", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) seen.add(newInvocationId());
    expect(seen.size).toBe(100);
  });

  it("isInvocationId rejects malformed ids", () => {
    expect(isInvocationId("wfxinv_")).toBe(false);
    expect(isInvocationId("wfxinv_SHORT")).toBe(false);
    expect(isInvocationId("wfxinv_0123456789ABCDEFGHJKMNPQRSTVWX")).toBe(false); // lowercase
    expect(isInvocationId("wfxevt_01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(false); // wrong prefix
    expect(isInvocationId(123)).toBe(false);
  });
});

describe("model-fabric types — describeFabricError", () => {
  it("every kind renders a one-line summary that names the kind", () => {
    const summaries = [
      describeFabricError(noProvider("commentary")),
      describeFabricError(policyError("d")),
      describeFabricError(privacyError("d")),
      describeFabricError(costError(5, 2)),
      describeFabricError(providerError("p", "d")),
      describeFabricError(timeoutError("p", 10)),
    ];
    for (const summary of summaries) {
      expect(typeof summary).toBe("string");
      expect(summary.length).toBeGreaterThan(0);
    }
    expect(summaries[0]!.startsWith("no-provider:")).toBe(true);
    expect(summaries[1]!.startsWith("policy:")).toBe(true);
    expect(summaries[2]!.startsWith("privacy:")).toBe(true);
    expect(summaries[3]!.startsWith("cost:")).toBe(true);
    expect(summaries[4]!.startsWith("provider-error:")).toBe(true);
    expect(summaries[5]!.startsWith("timeout:")).toBe(true);
  });
});

describe("model-fabric types — ISO timestamp compatibility", () => {
  it("the trace vocabulary's startedAt convention is isIso8601-compatible", () => {
    expect(isIso8601(new Date().toISOString())).toBe(true);
  });
});
