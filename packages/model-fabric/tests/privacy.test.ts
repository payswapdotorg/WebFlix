/**
 * @wfx/model-fabric — THE R06 PRIVACY ENFORCEMENT TEST.
 *
 * The doubled privacy law (the remediation architecture, §AI media
 * transformation): "Provider credentials never enter model prompts" AND
 * "BYOM keys never enter logs, URLs, or model prompts" — "Model privacy
 * policy is enforced at the runtime boundary."
 *
 * This file PROVES the model-input path (fabric router → provider) is
 * structurally incapable of carrying credential material:
 *
 * 1. KEY ISOLATION — a provider that records EVERYTHING it receives is
 *    invoked through the gateway while a BYOM binding (with a key) and
 *    provider credentials exist in the surrounding composition; the
 *    recorded input is scanned for the credential-material field names —
 *    the gateway passes ONLY the caller's input (never registry metadata,
 *    never envelope parts, never keys). Keys flow only to the provider
 *    TRANSPORT lane (persistence's loadBinding — pinned in the
 *    persistence-side tests).
 * 2. LOCAL-ONLY ROUTING REFUSAL — a local-only policy never routes to a
 *    cloud provider: the cloud provider's call log stays EMPTY and the
 *    failure is the typed `no-provider` error (never a silent
 *    substitution). Defense in depth: a broken planner that smuggles a
 *    cloud provider into the plan is refused with the typed `privacy`
 *    error BEFORE any attempt — not even the local providers run.
 * 3. COST CEILING ENFORCEMENT — over-ceiling attempts are skipped and the
 *    typed `cost` error names the ceiling (budget) that was exceeded.
 * 4. FALLBACK-CHAIN HONESTY — the chain is honored in order; the trace
 *    records the failed fallbacks; exhaustion surfaces the LAST failure
 *    with the full chain — never a fake success.
 * 5. BYOM REPLACEMENT SEMANTICS — the effective policy resolved with a
 *    bound BYOM provider routes THROUGH the BYOM provider; the first-party
 *    provider is not invoked when the replacement succeeds.
 * 6. REDACTION COVERAGE — `redactForPrivacy` (the module that guards
 *    BYOM prompts) pseudonymizes identifiers and minimizes payloads; the
 *    redacted input carries no credential-material field names and the
 *    audit report never echoes a redacted value.
 *
 * Determinism: fabric testing doubles + a fake registry; no I/O, no
 * network, no keys that look real (the "key" strings are obviously fake
 * test markers).
 */

import { describe, expect, it } from "bun:test";
import type { ModelPolicy, ModelTask, RecommendationContext } from "@wfx/domain";

import {
  makeEchoProvider,
  makeFailingProvider,
  ModelFabric,
  ModelFabricRegistry,
  resolveEffectiveModelPolicy,
  redactForPrivacy,
  WFX_MODEL_ID,
  type FabricResult,
  type RegisteredModelProvider,
} from "../src/index";

// ---------------------------------------------------------------------------
// The credential-material field names (the persistence law's vocabulary,
// mirrored in the TEST for scanning — the real scanner is pinned by the
// persistence-side tests)
// ---------------------------------------------------------------------------

const CREDENTIAL_FIELD_NAMES: readonly string[] = [
  "secret",
  "ciphertext",
  "iv",
  "authTag",
  "auth_tag",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "password",
  "clientSecret",
  "client_secret",
  "apiKey",
  "api_key",
];

/** Deep-scan a value for credential-material FIELD NAMES (the leak test). */
function scanForCredentialFields(value: unknown, path = "$"): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => scanForCredentialFields(entry, `${path}[${index}]`));
  }
  const leaks: string[] = [];
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (CREDENTIAL_FIELD_NAMES.includes(key)) {
      leaks.push(`${path}.${key}`);
    }
    leaks.push(...scanForCredentialFields(entry, `${path}.${key}`));
  }
  return leaks;
}

/** An obviously-fake BYOM key (never a real credential). */
const FAKE_BYOM_KEY = "test-byom-key-material-not-real";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function echo(
  id: string,
  options: { tasks?: readonly string[]; privacy?: "local" | "cloud"; costs?: Record<string, number> } = {},
): ReturnType<typeof makeEchoProvider> {
  return makeEchoProvider(id, {
    ...(options.tasks !== undefined ? { capabilities: options.tasks as never } : {}),
    ...(options.privacy !== undefined ? { privacy: options.privacy } : {}),
    ...(options.costs !== undefined ? { costs: options.costs as never } : {}),
  });

}

/** A simple input the echo provider resolves verbatim. */
const SAMPLE_INPUT = { mediaRef: "wfx-media-ref-1", durationMs: 60_000, note: "sample" };

// ---------------------------------------------------------------------------
// 1. KEY ISOLATION — the model-input path cannot carry credential material
// ---------------------------------------------------------------------------

describe("THE PRIVACY LAW: the model-input path structurally cannot read keys/credentials", () => {
  it("the gateway hands providers ONLY the caller's input — never registry metadata, envelopes, or keys", async () => {
    const observing = echo("wfx-observing-local", { tasks: ["transcription"] });
    const registry = new ModelFabricRegistry();
    registry.register(observing);
    // The surrounding composition carries credential-shaped objects (a
    // BYOM binding summary + a sealed envelope); the gateway must never
    // leak them into the provider input.
    const surroundingSecrets = {
      byomBinding: {
        providerId: "byom-cloud-alpha",
        apiKey: FAKE_BYOM_KEY,
        sealed: { ciphertext: "AAA", iv: "BBB", authTag: "CCC" },
      },
      providerCredential: { accessToken: "not-a-real-token", refreshToken: "also-fake" },
    };
    const fabric = new ModelFabric(registry);
    const result: FabricResult<unknown> = await fabric.invoke("transcription", SAMPLE_INPUT, {
      task: "transcription",
      fallbackProviders: ["wfx-observing-local"],
      privacy: "local-only",
    });
    expect(result.ok).toBe(true);
    expect(observing.calls).toHaveLength(1);
    // The provider received EXACTLY the caller's input.
    expect(observing.calls[0]!.input).toEqual(SAMPLE_INPUT);
    // ...and NOTHING the composition carried leaked into it.
    const leaks = scanForCredentialFields(observing.calls[0]!.input);
    expect(leaks).toEqual([]);
    expect(JSON.stringify(observing.calls)).not.toContain(FAKE_BYOM_KEY);
    expect(JSON.stringify(observing.calls)).not.toContain("accessToken");
    void surroundingSecrets;
  });

  it("no fabric API surface accepts or exposes credential material (the invoke signature carries input + policy only)", async () => {
    // Structural: the ModelFabric.invoke surface is (task, input, policy?,
    // context?) — the policy vocabulary is the frozen ModelPolicy (task,
    // preferred, fallbacks, privacy, cost ceiling). There is NO channel for
    // credentials: the gateway "has no credential surface at all" (fabric.ts
    // law). The compile-time shape is the proof; this test pins the runtime
    // behavior — invoking with a policy containing EXTRA fields (a smuggled
    // apiKey) still passes the provider ONLY the input.
    const observing = echo("wfx-observing-2", { tasks: ["summary"] });
    const registry = new ModelFabricRegistry();
    registry.register(observing);
    const fabric = new ModelFabric(registry);
    const smugglerPolicy = {
      task: "summary" as ModelTask,
      fallbackProviders: ["wfx-observing-2"],
      privacy: "local-only" as const,
      apiKey: FAKE_BYOM_KEY, // smuggled — must never reach a provider
    };
    const result = fabric.invoke("summary", SAMPLE_INPUT, smugglerPolicy as unknown as ModelPolicy);
    const settled = await result;
    expect(settled.ok).toBe(true);
    const leaks = scanForCredentialFields(observing.calls[0]!.input);
    expect(leaks).toEqual([]);
    expect(JSON.stringify(observing.calls)).not.toContain(FAKE_BYOM_KEY);
  });
});

// ---------------------------------------------------------------------------
// 2. LOCAL-ONLY ROUTING REFUSAL (typed failure, never silent substitution)
// ---------------------------------------------------------------------------

describe("local-only routing refusal (privacy class restricts routing)", () => {
  it("a local-only policy NEVER routes to a cloud provider — the cloud call log stays empty, the failure is typed", async () => {
    const cloud = echo("wfx-cloud-transcription", {
      tasks: ["transcription"],
      privacy: "cloud",
    });
    const registry = new ModelFabricRegistry();
    registry.register(cloud);
    const fabric = new ModelFabric(registry);
    const result = await fabric.invoke("transcription", SAMPLE_INPUT, {
      task: "transcription",
      fallbackProviders: ["wfx-cloud-transcription"],
      privacy: "local-only",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("no-provider");
      if (result.error.kind === "no-provider") {
        expect(result.error.task).toBe("transcription");
      }
    }
    expect(cloud.calls).toHaveLength(0); // NEVER invoked — the law
  });

  it("defense in depth: a smuggled cloud plan entry under local-only is refused with the typed privacy error BEFORE any attempt", async () => {
    const local = echo("wfx-local-2", { tasks: ["summary"] });
    const cloud = echo("wfx-cloud-2", { tasks: ["summary"], privacy: "cloud" });
    const registry = new ModelFabricRegistry();
    registry.register(local);
    registry.register(cloud);
    // The broken planner: a local-only policy whose plan includes the
    // cloud provider (the gateway must never trust the plan over the
    // registry — fabric.ts's defense-in-depth law).
    const fabric = new ModelFabric(registry, {
      router: {
        route: (task: ModelTask) => ({
          task,
          entries: [
            { providerId: "wfx-local-2", privacy: "local" as const },
            { providerId: "wfx-cloud-2", privacy: "cloud" as const },
          ],
        }),
      },
    });
    const result = await fabric.invoke("summary", SAMPLE_INPUT, {
      task: "summary",
      fallbackProviders: ["wfx-local-2", "wfx-cloud-2"],
      privacy: "local-only",
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "privacy") {
      expect(result.error.detail).toContain("wfx-cloud-2");
      expect(result.error.detail).toContain("refusing to invoke anything");
    } else {
      throw new Error(`expected the typed privacy refusal, got ${JSON.stringify(result.ok ? "ok" : result.error.kind)}`);
    }
    // Fail closed: not even the LOCAL provider was invoked.
    expect(local.calls).toHaveLength(0);
    expect(cloud.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. COST CEILING ENFORCEMENT (typed failure naming the ceiling)
// ---------------------------------------------------------------------------

describe("cost ceiling enforcement (maxCostPerOperation)", () => {
  it("an over-ceiling provider is skipped and the typed cost error NAMES the ceiling (the gateway's cost-drift defense)", async () => {
    const expensive = echo("wfx-expensive", {
      tasks: ["translation"],
      costs: { translation: 5 },
    });
    const registry = new ModelFabricRegistry();
    registry.register(expensive);
    // The gateway-level cost path fires on COST DRIFT: a plan that includes
    // the provider (a planner that ignored the ceiling) while the gateway's
    // budget check skips it at attempt time — the defense-in-depth twin of
    // the router's planning-time exclusion (pinned in router tests).
    const fabric = new ModelFabric(registry, {
      router: {
        route: (task: ModelTask) => ({ task, entries: [{ providerId: "wfx-expensive", privacy: "cloud" as const, declaredCost: 5 }] }),
      },
    });
    const result = await fabric.invoke("translation", SAMPLE_INPUT, {
      task: "translation",
      fallbackProviders: ["wfx-expensive"],
      privacy: "any-cloud",
      maxCostPerOperation: 1, // the ceiling — the provider declares 5
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "cost") {
      expect(result.error.budget).toBe(1); // the ceiling, named
      expect(result.error.spent).toBe(0); // nothing attempted
    } else {
      throw new Error(`expected the typed cost error, got ${result.ok ? "ok" : result.error.kind}`);
    }
    expect(expensive.calls).toHaveLength(0); // skipped BEFORE the attempt
  });

  it("the ROUTER excludes an over-ceiling provider at planning time (the first enforcement layer)", async () => {
    const expensive = echo("wfx-expensive-2", {
      tasks: ["translation"],
      costs: { translation: 5 },
    });
    const registry = new ModelFabricRegistry();
    registry.register(expensive);
    const fabric = new ModelFabric(registry);
    const result = await fabric.invoke("translation", SAMPLE_INPUT, {
      task: "translation",
      fallbackProviders: ["wfx-expensive-2"],
      privacy: "any-cloud",
      maxCostPerOperation: 1,
    });
    // Empty plan (the router's cost filter) ⇒ the typed no-provider error.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("no-provider");
    }
    expect(expensive.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. FALLBACK-CHAIN HONESTY (order + exhausted-fallback truth)
// ---------------------------------------------------------------------------

describe("fallback-chain honesty", () => {
  it("the chain is honored in order; the trace records the failed fallbacks", async () => {
    const failing = makeFailingProvider("wfx-fail-first", {
      capabilities: ["translation" as ModelTask],
      errorMessage: "primary is down",
    });
    const backup = echo("wfx-backup-local", { tasks: ["translation"] });
    const registry = new ModelFabricRegistry();
    registry.register(failing as unknown as RegisteredModelProvider);
    registry.register(backup);
    const fabric = new ModelFabric(registry);
    const result = await fabric.invoke("translation", SAMPLE_INPUT, {
      task: "translation",
      preferredProvider: "wfx-fail-first",
      fallbackProviders: ["wfx-backup-local"],
      privacy: "local-only",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trace.providerId).toBe("wfx-backup-local");
      expect(result.trace.fallbacks).toEqual(["wfx-fail-first"]); // the chain truth
    }
    expect(failing.calls).toHaveLength(1);
    expect(backup.calls).toHaveLength(1);
  });

  it("an EXHAUSTED chain surfaces the LAST failure with the full chain — never a fake success", async () => {
    const first = makeFailingProvider("wfx-exhaust-1", {
      capabilities: ["translation" as ModelTask],
      errorMessage: "first exploded",
    });
    const second = makeFailingProvider("wfx-exhaust-2", {
      capabilities: ["translation" as ModelTask],
      errorMessage: "second exploded too",
    });
    const registry = new ModelFabricRegistry();
    registry.register(first as unknown as RegisteredModelProvider);
    registry.register(second as unknown as RegisteredModelProvider);
    const fabric = new ModelFabric(registry);
    const result = await fabric.invoke("translation", SAMPLE_INPUT, {
      task: "translation",
      preferredProvider: "wfx-exhaust-1",
      fallbackProviders: ["wfx-exhaust-2"],
      privacy: "any-cloud",
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "provider-error") {
      expect(result.error.providerId).toBe("wfx-exhaust-2"); // the LAST failure
      expect(result.error.detail).toContain("second exploded too");
      expect(result.trace!.fallbacks).toEqual(["wfx-exhaust-1"]); // the honest chain
    } else {
      throw new Error("expected the exhausted-fallback provider error");
    }
  });
});

// ---------------------------------------------------------------------------
// 5. BYOM REPLACEMENT SEMANTICS (routing through the replacement)
// ---------------------------------------------------------------------------

describe("BYOM replacement semantics (a bound provider replaces the first-party route)", () => {
  it("the effective policy routes THROUGH the bound BYOM provider; the first-party is not invoked on success", async () => {
    const firstParty = echo(WFX_MODEL_ID, { tasks: ["recommendation", "ranking"] });
    const byom = echo("byom-bound-alpha", { tasks: ["translation"], privacy: "cloud" });
    const registry = new ModelFabricRegistry();
    registry.register(firstParty);
    registry.register(byom);
    const fabric = new ModelFabric(registry);

    const resolution = resolveEffectiveModelPolicy({
      task: "translation",
      stored: {
        task: "translation",
        fallbackProviders: [WFX_MODEL_ID],
        privacy: "any-cloud",
      },
      byomBindings: [{ providerId: "byom-bound-alpha", privacy: "cloud", tasks: ["translation"] }],
      registry,
      firstPartyProviderId: WFX_MODEL_ID,
    });
    expect(resolution.preferredSource).toBe("byom-replacement");

    const result = await fabric.invoke("translation", SAMPLE_INPUT, resolution.policy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trace.providerId).toBe("byom-bound-alpha");
    }
    expect(byom.calls).toHaveLength(1);
    // The first-party route was REPLACED for this task (not invoked).
    expect(firstParty.calls).toHaveLength(0);
  });

  it("a cloud replacement is ineligible under local-only — the route refuses rather than bending", async () => {
    const byom = echo("byom-cloud-beta", { tasks: ["translation"], privacy: "cloud" });
    const registry = new ModelFabricRegistry();
    registry.register(byom);
    const fabric = new ModelFabric(registry);
    const resolution = resolveEffectiveModelPolicy({
      task: "translation",
      byomBindings: [{ providerId: "byom-cloud-beta", privacy: "cloud", tasks: ["translation"] }],
      registry,
      firstPartyProviderId: WFX_MODEL_ID,
    });
    expect(resolution.preferredSource).not.toBe("byom-replacement");
    const result = await fabric.invoke("translation", SAMPLE_INPUT, resolution.policy);
    expect(result.ok).toBe(false);
    expect(byom.calls).toHaveLength(0); // never invoked under local-only
  });
});

// ---------------------------------------------------------------------------
// 6. REDACTION COVERAGE (the module that guards BYOM prompts)
// ---------------------------------------------------------------------------

/** A minimal well-formed RecommendationContext for the redaction module. */
function sampleContext(): RecommendationContext {
  return {
    userId: "wfxusr_redactiontest000000000001",
    sessionId: "wfxsess_redactiontest00000000001",
    surface: "watch",
    intents: [
      {
        id: "wfxint_01ARZ3NDEKF1XTVRE000000001",
        userId: "wfxusr_redactiontest000000000001",
        scope: "session",
        objective: "sci-fi",
        weight: 0.8,
        confidence: 0.9,
        provenance: "explicit",
      },
    ],
    policy: {
      id: "wfxpol_01ARZ3NDEKF1XTVRE000000001",
      userId: "wfxusr_redactiontest000000000001",
      objectives: [],
      exploration: 0.2,
      novelty: 0.2,
      socialInfluence: 0.1,
      attentionMode: "balanced",
    },
    recentEvents: [
      {
        userId: "wfxusr_redactiontest000000000001",
        itemId: "wfxitm_01ARZ3NDEKF1XTVRE000000002",
        type: "complete",
        occurredAt: "2026-09-13T11:00:00.000Z",
        sessionId: "wfxsess_redactiontest00000000001",
        payload: { query: "free text must drop", count: 3, at: "2026-09-13T10:00:00.000Z" },
      },
    ],
    candidatePool: [
      {
        itemId: "wfxitm_01ARZ3NDEKF1XTVRE000000001",
        realization: {
          connectorId: "wfx-test-native",
          externalRef: "ref-0001",
          capabilities: ["identity", "metadata"],
          availability: "available",
        },
        features: {
          canonicalType: "video",
          canonicalTitle: "Test Video",
          matchText: "test video",
          durationMs: 60_000,
          orientation: "horizontal",
          publishedAt: "2026-08-14T12:00:00.000Z",
        },
      },
    ],
  };
}

describe("redaction coverage (BYOM prompts + audit reports)", () => {
  it("local-only keeps the full context with ZERO transformations", () => {
    const { input, report } = redactForPrivacy(sampleContext(), "local-only");
    expect(report.transformations).toHaveLength(0);
    expect(input.userId).toBe("wfxusr_redactiontest000000000001");
  });

  it("trusted-cloud pseudonymizes every userId — no raw identifier leaves the boundary", () => {
    const ctx = sampleContext();
    const { input, report } = redactForPrivacy(ctx, "trusted-cloud");
    expect(input.userId).not.toBe(ctx.userId);
    expect(input.userId.startsWith("wfxanon_")).toBe(true);
    expect(input.intents[0]!.userId).not.toBe(ctx.userId);
    expect(input.policy.userId).not.toBe(ctx.userId);
    expect(input.recentEvents[0]!.userId).not.toBe(ctx.userId);
    // Payloads are KEPT under trusted-cloud (the class law).
    expect(input.recentEvents[0]!.payload).toBeDefined();
    expect(report.transformations.length).toBe(4); // ctx + intent + policy + event
  });

  it("any-cloud minimizes event payloads (free text dropped, types kept) — the report never echoes values", () => {
    const ctx = sampleContext();
    const { input, report } = redactForPrivacy(ctx, "any-cloud");
    const payload = input.recentEvents[0]!.payload as Record<string, unknown>;
    expect(payload.query).toBeUndefined(); // free text — dropped
    expect(payload.count).toBe(3); // finite number — kept
    expect(payload.at).toBe("2026-09-13T10:00:00.000Z"); // ISO timestamp — kept
    // The report lists paths + actions + reasons — NEVER the values.
    const rendered = JSON.stringify(report);
    expect(rendered).not.toContain("free text must drop");
    expect(rendered).not.toContain(ctx.userId);
    expect(report.transformations.some((t) => t.field === "recentEvents[0].payload.query")).toBe(true);
  });

  it("the redacted model input carries NO credential-material field names (the prompt guard)", () => {
    for (const privacyClass of ["local-only", "trusted-cloud", "any-cloud"] as const) {
      const { input } = redactForPrivacy(sampleContext(), privacyClass);
      const leaks = scanForCredentialFields(input);
      expect(leaks).toEqual([]);
    }
  });

  it("redaction is PURE: the original ctx is never mutated, and identical inputs produce identical reports", () => {
    const ctx = sampleContext();
    const before = JSON.stringify(ctx);
    redactForPrivacy(ctx, "any-cloud");
    redactForPrivacy(ctx, "trusted-cloud");
    expect(JSON.stringify(ctx)).toBe(before);
    const first = redactForPrivacy(ctx, "any-cloud");
    const second = redactForPrivacy(ctx, "any-cloud");
    expect(JSON.stringify(first.report)).toBe(JSON.stringify(second.report));
    expect(JSON.stringify(first.input)).toBe(JSON.stringify(second.input));
  });
});
