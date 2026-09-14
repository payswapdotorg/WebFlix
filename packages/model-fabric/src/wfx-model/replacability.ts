/**
 * WFX-031 — the replaceability invariant, as a typed contract + test helpers
 * (Lane A — intelligence).
 *
 * The frozen architecture's promise: the Recommendation OS NEVER depends on
 * any specific model — models are injected through the frozen
 * `RecommendationModel` interface (`runRecommendation(ctx, { model })` is
 * the only channel; the OS's own default heuristic is itself just an
 * injection). This module drift-proofs that invariant:
 *
 * - `ModelSwapContract` — a typed contract bound to one fixed
 *   `RecommendationContext`: `runWith(model)` runs the SAME OS pipeline with
 *   ANY model through the same interface, and `parity(first, second)`
 *   compares two runs for INTERFACE PARITY (shape/type equality — never
 *   value equality: different models MUST be allowed to rank differently).
 *   `prove(candidate)` is the one-call proof: stub vs candidate model.
 * - `assertModelContract(model, ctx?)` — verifies a model satisfies the
 *   contract the OS relies on: the frozen shape (via the merged OS
 *   validator), well-formed item-keyed output for a probe context (via the
 *   merged OS scoring stage's own enforcement), and byte-identical
 *   determinism across two invocations. Violations throw the typed
 *   `ModelContractViolationError` with field-level details.
 * - `createStubRecommendationModel()` — a TEST HELPER stub (never a
 *   production strategy): a deterministic, constant, well-formed model used
 *   as the "other side" of the swap proof. Precedent: the fabric's own
 *   `testing.ts` ships test fixtures from `src/`.
 */

import type { RecommendationContext, RecommendationModel } from "@wfx/domain";

import {
  assembleFeatures,
  assertValidContext,
  RecommendationOSError,
  runRecommendation,
  score as scoreThroughOsStage,
  validateRecommendationModel,
  type FeedPage,
} from "@wfx/recommendation";

import { createWfxRecommendationModel, WFX_MODEL_VERSION } from "./model";

// ---------------------------------------------------------------------------
// The stub model (TEST HELPER — never a production strategy)
// ---------------------------------------------------------------------------

/** The stub's identity (clearly not a real strategy). */
export const WFX_STUB_MODEL_ID = "wfx-stub-swap-model";
/** The stub's version (semver-valid placeholder). */
export const WFX_STUB_MODEL_VERSION = "0.0.0";
/** The stub's constant score for every distinct item. */
export const WFX_STUB_SCORE = 0.5;

/**
 * Create the interface-parity stub model: every DISTINCT pool item receives
 * the constant score `WFX_STUB_SCORE`, one honest explanation line, and
 * confidence 0.5 — deterministic, well-formed, and deliberately different
 * from any real strategy. For VALID contexts only (the OS pipeline
 * pre-validates; `assertModelContract` probes with valid contexts).
 */
export function createStubRecommendationModel(): RecommendationModel {
  return {
    id: WFX_STUB_MODEL_ID,
    version: WFX_STUB_MODEL_VERSION,
    async score(ctx: RecommendationContext) {
      const itemIds: string[] = [];
      const seen = new Set<string>();
      for (const candidate of ctx.candidatePool) {
        if (!seen.has(candidate.itemId)) {
          seen.add(candidate.itemId);
          itemIds.push(candidate.itemId);
        }
      }
      return itemIds
        .map((itemId) => ({
          itemId,
          score: WFX_STUB_SCORE,
          explanations: [
            `stub: constant score ${WFX_STUB_SCORE.toFixed(3)} (interface-parity probe — not a real strategy)`,
          ],
          confidence: 0.5,
        }))
        .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
    },
  };
}

// ---------------------------------------------------------------------------
// ModelSwapContract — the typed replaceability contract
// ---------------------------------------------------------------------------

/** Field-level parity differences between two pipeline runs (empty when compatible). */
export interface ModelSwapParity {
  /** True when both runs are interface-compatible (shape parity). */
  ok: boolean;
  /** One human-readable line per detected shape difference. */
  differences: readonly string[];
}

/**
 * The replaceability contract: run the SAME OS pipeline with ANY model
 * through the SAME frozen interface, and compare runs for interface parity.
 * The bound `context` is used verbatim for every run — callers must not
 * mutate it between runs (the contract is the control variable).
 */
export interface ModelSwapContract {
  /** The contract's identity (audit). */
  readonly id: "wfx-model-swap-contract";
  /** The fixed context every `runWith` invocation receives. */
  readonly context: RecommendationContext;
  /** Run the full OS pipeline with the injected model (the ONLY channel). */
  runWith(model: RecommendationModel): Promise<FeedPage>;
  /** Compare two pipeline runs for INTERFACE parity (never value equality). */
  parity(first: FeedPage, second: FeedPage): ModelSwapParity;
  /**
   * The one-call replaceability proof: run the pipeline with the stub model
   * and with `candidate` (default: a fresh first-party model — convenience
   * only; ANY model is a legal candidate), then parity-check the two runs.
   */
  prove(candidate?: RecommendationModel): Promise<ModelSwapParity>;
}

/** Runtime kind classifier for parity checks (null and arrays are distinct kinds). */
function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Require that both sides' runtime kinds are members of `allowed` and that
 * they MATCH each other (nullness parity for nullable fields). A violation
 * records one field-level difference.
 */
function requireKinds(
  differences: string[],
  path: string,
  first: unknown,
  second: unknown,
  allowed: readonly string[],
): void {
  const firstKind = kindOf(first);
  const secondKind = kindOf(second);
  if (!allowed.includes(firstKind) || !allowed.includes(secondKind)) {
    differences.push(
      `${path}: expected ${allowed.join(" | ")} on both sides, got ${firstKind} vs ${secondKind}`,
    );
    return;
  }
  if (firstKind !== secondKind) {
    differences.push(`${path}: ${firstKind} vs ${secondKind} — kinds must match (nullness parity)`);
  }
}

/** Require that an array value's every element is a string (both sides). */
function requireStringArray(
  differences: string[],
  path: string,
  first: unknown,
  second: unknown,
): void {
  for (const [label, value] of [
    ["first", first],
    ["second", second],
  ] as const) {
    if (Array.isArray(value) && !value.every((entry) => typeof entry === "string")) {
      differences.push(`${path} (${label}): expected an array of strings`);
    }
  }
}

/**
 * The interface-parity comparison of two pipeline runs over the SAME ctx:
 * identical headers (ctx-derived, model-independent), identical card count,
 * per-card FIELD-TYPE parity (values may differ — ranking is the model's
 * own), identical item MEMBERSHIP (the OS permutation law: every distinct
 * item exactly once, under any model), and identical trace SHAPE (six frozen
 * stages in order, model identity carried verbatim as opaque strings).
 */
function pipelineParity(first: FeedPage, second: FeedPage): ModelSwapParity {
  const differences: string[] = [];

  // --- headers (derived from the shared ctx — must match exactly) ---
  if (first.surface !== second.surface) {
    differences.push(`surface: ${first.surface} vs ${second.surface}`);
  }
  if (first.userId !== second.userId) {
    differences.push(`userId: ${first.userId} vs ${second.userId}`);
  }
  if (first.sessionId !== second.sessionId) {
    differences.push(`sessionId: ${first.sessionId} vs ${second.sessionId}`);
  }

  // --- cards: count, per-card field kinds, item membership ---
  if (first.cards.length !== second.cards.length) {
    differences.push(`cards.length: ${first.cards.length} vs ${second.cards.length}`);
  }
  const count = Math.min(first.cards.length, second.cards.length);
  for (let index = 0; index < count; index += 1) {
    const cardA = first.cards[index]!;
    const cardB = second.cards[index]!;
    requireKinds(differences, `cards[${index}].position`, cardA.position, cardB.position, [
      "number",
    ]);
    requireKinds(differences, `cards[${index}].candidate`, cardA.candidate, cardB.candidate, [
      "object",
    ]);
    if (kindOf(cardA.candidate) === "object" && kindOf(cardB.candidate) === "object") {
      requireKinds(
        differences,
        `cards[${index}].candidate.itemId`,
        cardA.candidate.itemId,
        cardB.candidate.itemId,
        ["string"],
      );
    }
    requireKinds(differences, `cards[${index}].modelScore`, cardA.modelScore, cardB.modelScore, [
      "number",
      "null",
    ]);
    requireKinds(differences, `cards[${index}].confidence`, cardA.confidence, cardB.confidence, [
      "number",
      "null",
    ]);
    requireKinds(differences, `cards[${index}].explanations`, cardA.explanations, cardB.explanations, [
      "array",
    ]);
    requireStringArray(
      differences,
      `cards[${index}].explanations`,
      cardA.explanations,
      cardB.explanations,
    );
    requireKinds(
      differences,
      `cards[${index}].dominantObjective`,
      cardA.dominantObjective,
      cardB.dominantObjective,
      ["string", "null"],
    );
    requireKinds(
      differences,
      `cards[${index}].positionReasons`,
      cardA.positionReasons,
      cardB.positionReasons,
      ["array"],
    );
    requireStringArray(
      differences,
      `cards[${index}].positionReasons`,
      cardA.positionReasons,
      cardB.positionReasons,
    );
  }

  // --- item membership: the OS permutation law (model-independent) ---
  const membership = (page: FeedPage): string =>
    page.cards
      .map((card) => card.candidate.itemId)
      .sort()
      .join("\u0000");
  if (membership(first) !== membership(second)) {
    differences.push(
      "candidate itemIds: the item sets differ — every distinct pool item must appear exactly once under ANY model",
    );
  }

  // --- trace: model identity shape + frozen stage sequence + record fields ---
  requireKinds(differences, "trace.model.id", first.trace.model.id, second.trace.model.id, [
    "string",
  ]);
  requireKinds(
    differences,
    "trace.model.version",
    first.trace.model.version,
    second.trace.model.version,
    ["string"],
  );
  const stageNames = (page: FeedPage): string =>
    page.trace.stages.map((stage) => stage.stage).join("\u0000");
  if (stageNames(first) !== stageNames(second)) {
    differences.push(
      "trace.stages: the stage sequence differs — the frozen six-stage order is model-independent",
    );
  }
  const stageCount = Math.min(first.trace.stages.length, second.trace.stages.length);
  for (let index = 0; index < stageCount; index += 1) {
    const stageA = first.trace.stages[index]!;
    const stageB = second.trace.stages[index]!;
    requireKinds(differences, `trace.stages[${index}].stage`, stageA.stage, stageB.stage, [
      "string",
    ]);
    requireKinds(
      differences,
      `trace.stages[${index}].inputCount`,
      stageA.inputCount,
      stageB.inputCount,
      ["number"],
    );
    requireKinds(
      differences,
      `trace.stages[${index}].outputCount`,
      stageA.outputCount,
      stageB.outputCount,
      ["number"],
    );
    requireKinds(
      differences,
      `trace.stages[${index}].decisions`,
      stageA.decisions,
      stageB.decisions,
      ["array"],
    );
    for (const [label, decisions] of [
      ["first", stageA.decisions],
      ["second", stageB.decisions],
    ] as const) {
      if (
        Array.isArray(decisions) &&
        !decisions.every(
          (decision) =>
            typeof decision?.kind === "string" &&
            typeof decision?.detail === "string" &&
            Array.isArray(decision?.itemIds),
        )
      ) {
        differences.push(`trace.stages[${index}].decisions (${label}): expected TraceDecision records`);
      }
    }
  }

  return { ok: differences.length === 0, differences: Object.freeze(differences) };
}

/**
 * Bind the swap contract to one fixed context.
 *
 * @throws RecommendationOSError (the merged OS typed error, kind
 *         "invalid-input") when the context is malformed — the control
 *         variable must be a legal OS input, validated up front.
 */
export function createModelSwapContract(context: RecommendationContext): ModelSwapContract {
  assertValidContext(context);
  const contract: ModelSwapContract = {
    id: "wfx-model-swap-contract",
    context,
    async runWith(model: RecommendationModel): Promise<FeedPage> {
      // Injection is the ONLY model channel — the OS never hardcodes one.
      return runRecommendation(context, { model });
    },
    parity(first: FeedPage, second: FeedPage): ModelSwapParity {
      return pipelineParity(first, second);
    },
    async prove(candidate?: RecommendationModel): Promise<ModelSwapParity> {
      const resolved = candidate ?? createWfxRecommendationModel(WFX_MODEL_VERSION);
      const stubPage = await contract.runWith(createStubRecommendationModel());
      const candidatePage = await contract.runWith(resolved);
      return contract.parity(stubPage, candidatePage);
    },
  };
  return contract;
}

// ---------------------------------------------------------------------------
// assertModelContract — the contract the OS relies on, enforced
// ---------------------------------------------------------------------------

/** Thrown by {@link assertModelContract} when a model violates the contract. */
export class ModelContractViolationError extends Error {
  /** Field-level violation descriptions (at least one). */
  readonly details: readonly string[];

  constructor(details: string | readonly string[]) {
    const list = typeof details === "string" ? [details] : details;
    super(`ModelContractViolationError: ${list.join("; ")}`);
    this.name = "ModelContractViolationError";
    this.details = list;
  }
}

/** The built-in deterministic probe context (valid, small, signal-rich). */
function builtInProbeContext(): RecommendationContext {
  return {
    userId: "wfx-probe-user",
    sessionId: "wfx-probe-session",
    surface: "watch",
    intents: [
      {
        id: "wfxint_01ARZ3NDEKF1XTVRE000000001",
        userId: "wfx-probe-user",
        scope: "session",
        objective: "sci-fi",
        weight: 0.8,
        confidence: 0.9,
        provenance: "explicit",
      },
    ],
    policy: {
      id: "wfxpol_01ARZ3NDEKF1XT0P000000001",
      userId: "wfx-probe-user",
      objectives: [],
      exploration: 0.2,
      novelty: 0.2,
      socialInfluence: 0.1,
      attentionMode: "balanced",
    },
    recentEvents: [
      {
        userId: "wfx-probe-user",
        itemId: "wfxitm_01ARZ3NDEKF1XTVRE000000002",
        type: "complete",
        occurredAt: "2026-09-13T11:00:00.000Z",
        sessionId: "wfx-probe-session",
      },
    ],
    candidatePool: [
      {
        itemId: "wfxitm_01ARZ3NDEKF1XTVRE000000001",
        realization: {
          connectorId: "wfx-probe-native",
          externalRef: "ref-0001",
          capabilities: ["identity", "metadata", "playNative"],
          availability: "available",
        },
        features: {
          canonicalType: "video",
          canonicalTitle: "Dune Part Two",
          matchText: "dune part two sci-fi epic movie horizontal",
          durationMs: 9_960_000,
          orientation: "horizontal",
          publishedAt: "2026-08-14T12:00:00.000Z",
        },
      },
      {
        itemId: "wfxitm_01ARZ3NDEKF1XTVRE000000002",
        realization: {
          connectorId: "wfx-probe-native",
          externalRef: "ref-0002",
          capabilities: ["identity", "metadata", "playNative"],
          availability: "available",
        },
        features: {
          canonicalType: "video",
          canonicalTitle: "Desk Setup Tour",
          matchText: "desk setup tour tech vertical",
          durationMs: 60_000,
          orientation: "vertical",
          publishedAt: "2026-09-12T12:00:00.000Z",
        },
      },
    ],
  };
}

/**
 * Assert that `model` satisfies the contract the Recommendation OS relies on:
 *
 * 1. SHAPE — the frozen `RecommendationModel` surface (via the merged OS
 *    validator `validateRecommendationModel`);
 * 2. OUTPUT — for the probe context (the provided `ctx`, or the built-in
 *    deterministic probe), the model returns well-formed, item-keyed,
 *    duplicate-free `RecommendationScore[]` — enforced by the merged OS
 *    scoring stage itself, so this check cannot drift from the OS;
 * 3. DETERMINISM — two invocations on the identical context produce
 *    byte-identical output (the OS's own end-to-end determinism promise
 *    requires deterministic models).
 *
 * @throws ModelContractViolationError with field-level details on any
 *         violation (typed OS errors surfaced during probing are re-wrapped
 *         with their original details — never swallowed).
 */
export async function assertModelContract(
  model: RecommendationModel,
  ctx?: RecommendationContext,
): Promise<void> {
  const shapeCheck = validateRecommendationModel(model);
  if (!shapeCheck.ok) {
    throw new ModelContractViolationError(shapeCheck.errors);
  }

  const probeContext = ctx ?? builtInProbeContext();
  assertValidContext(probeContext); // the probe itself must be a legal OS input

  try {
    // The merged OS scoring stage enforces the output contract on the
    // model's verbatim result (well-formed entries, pool membership,
    // no duplicates) — reusing it keeps this check drift-free.
    const features = assembleFeatures(probeContext);
    await scoreThroughOsStage(probeContext, features, model);

    // Determinism: byte-identical output for the identical context.
    const first = await model.score(probeContext);
    const second = await model.score(probeContext);
    if (JSON.stringify(first) !== JSON.stringify(second)) {
      throw new ModelContractViolationError([
        "determinism: two score(ctx) invocations on the identical context produced different outputs — the OS's end-to-end determinism promise requires byte-identical model output",
      ]);
    }
  } catch (error) {
    if (error instanceof ModelContractViolationError) throw error;
    if (error instanceof RecommendationOSError) {
      // Typed OS refusal (model-contract violations carry field-level
      // details) — re-wrapped, details preserved.
      throw new ModelContractViolationError(
        error.details.map((detail) => `${error.kind}: ${detail}`),
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ModelContractViolationError([`model probe failed: ${message}`]);
  }
}
