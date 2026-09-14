/**
 * WFX-032 — the BYOM adapter (Lane A — intelligence).
 *
 * `createByomAdapter(byom, options?)` wraps an arbitrary external scoring
 * function (the INJECTED `ByomModel` seam — the real model is the user's;
 * here the SEAM is the deliverable) as a frozen `RecommendationModel`, with
 * every policy enforced AROUND it:
 *
 *   score(ctx):
 *     1. VALIDATE the ctx against the merged OS validator
 *        (`validateRecommendationContext`, WFX-021 public API — the same
 *        field-path law the first-party adapter uses). Malformed ctx ⇒ typed
 *        ByomError "invalid-context"; redaction never touches malformed input.
 *     2. REDACT per the model's privacy class (`redactForPrivacy`) — the
 *        model sees the serialized context MINUS the redacted fields, never
 *        the caller's objects.
 *     3. CHECK THE COST CEILING (`checkCostCeiling`): costPerCall ×
 *        estimatedCalls vs the policy's maxCostPerOperation — over budget ⇒
 *        typed ByomError "cost-refused" BEFORE the model is invoked.
 *     4. INVOKE `byom.score(redacted)` — latency measured with the INJECTED
 *        clock. A throw/rejection ⇒ typed ByomError "model-failure"
 *        propagated as a Promise rejection the OS can catch: models may fail;
 *        the OS decides fallback; the adapter NEVER silently substitutes.
 *     5. VALIDATE the output (`validateByomOutput`) — malformed ⇒ typed
 *        ByomError "invalid-output" carrying the field-path errors.
 *     6. ENFORCE (`enforcePolicy`) — clamps, caps; an EMPTY (but valid)
 *        response ⇒ the typed `degraded` verdict: ByomError "degraded" with
 *        confidence 0 and NO fabricated scores. The OS sees the verdict and
 *        decides.
 *
 * Every step is recorded in a `ByomTrace` — redaction report, cost check,
 * invocation latency, validation summary, enforcement actions — attached to
 * the adapter's DEBUG ACCESSOR (`adapter.debug.lastTrace()`), never to the
 * scores: the returned `RecommendationScore[]` stays clean model output.
 *
 * Clock call sequence (deterministic, for injected fake clocks): entry
 * (startedAt) → pre-invoke → post-invoke (latency) → finish (duration). The
 * refused path stops after entry+finish; the failure paths skip only the
 * stages they never reached.
 */

import type { RecommendationContext, RecommendationModel, RecommendationScore } from "@wfx/domain";

import { validateRecommendationContext } from "@wfx/recommendation";

import type { ByomModel, ByomPrivacyClass } from "./byom";
import { assertValidByomModel } from "./byom";
import {
  assertValidByomEnforcementPolicy,
  checkCostCeiling,
  enforcePolicy,
  validateByomOutput,
  type ByomEnforcementPolicy,
  type ByomValidationSummary,
  type CostCheckRecord,
  type ExplanationCap,
  type ScoreClamp,
} from "./enforce";
import {
  BYOM_DEFAULT_PSEUDONYM_SALT,
  redactForPrivacy,
  type RedactionReport,
} from "./redaction";

// ---------------------------------------------------------------------------
// ByomError — the adapter's closed failure vocabulary
// ---------------------------------------------------------------------------

/** The closed set of BYOM adapter failure kinds. */
export type ByomErrorKind =
  /** The ctx failed the merged OS validator (details = field paths). */
  | "invalid-context"
  /** Over budget: costPerCall × estimatedCalls > maxCostPerOperation, refused BEFORE invocation. */
  | "cost-refused"
  /** The model's output failed the strict RecommendationScore[] schema (details = paths). */
  | "invalid-output"
  /** The model returned a VALID but EMPTY response — confidence 0, no fabricated scores. */
  | "degraded"
  /** The model's score() threw or rejected (bounded message, never the input). */
  | "model-failure";

/** Every ByomError kind, in vocabulary order. */
export const BYOM_ERROR_KINDS = [
  "invalid-context",
  "cost-refused",
  "invalid-output",
  "degraded",
  "model-failure",
] as const satisfies readonly ByomErrorKind[];

/** Optional structured extras a ByomError may carry (per kind). */
export interface ByomErrorExtras {
  /** "cost-refused": the policy ceiling that was exceeded. */
  budget?: number;
  /** "cost-refused": the estimated cost that exceeded it. */
  estimatedCost?: number;
  /** "degraded": always the literal 0 — the verdict-level confidence marking. */
  confidence?: 0;
}

/**
 * The typed error of the BYOM adapter — the ONLY rejection shape that
 * escapes `score()` (besides it, every failure is converted; an unexpected
 * internal throw would be a bug). Never a raw throwable: the model's own
 * error is re-typed as "model-failure" with a bounded message.
 */
export class ByomError extends Error {
  readonly kind: ByomErrorKind;
  /** Field-level problem descriptions / diagnostics (at least one). */
  readonly details: readonly string[];
  readonly budget?: number;
  readonly estimatedCost?: number;
  readonly confidence?: 0;

  constructor(kind: ByomErrorKind, details: string | readonly string[], extras: ByomErrorExtras = {}) {
    const list = typeof details === "string" ? [details] : details;
    super(`ByomError (${kind}): ${list.join("; ")}`);
    this.name = "ByomError";
    this.kind = kind;
    this.details = list;
    if (extras.budget !== undefined) this.budget = extras.budget;
    if (extras.estimatedCost !== undefined) this.estimatedCost = extras.estimatedCost;
    if (extras.confidence !== undefined) this.confidence = extras.confidence;
  }
}

/** Runtime guard: is `x` a ByomError (for OS-side catch blocks)? */
export function isByomError(x: unknown): x is ByomError {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as { name?: unknown }).name === "ByomError" &&
    (BYOM_ERROR_KINDS as readonly string[]).includes(
      String((x as { kind?: unknown }).kind),
    ) &&
    Array.isArray((x as { details?: unknown }).details)
  );
}

/**
 * One-line, human-readable summary of a typed BYOM error — always names the
 * kind so a degraded rendering is never mistaken for success.
 */
export function describeByomError(error: ByomError): string {
  switch (error.kind) {
    case "invalid-context":
      return `invalid-context: the recommendation context failed OS validation (${error.details.length} field problem(s))`;
    case "cost-refused":
      return `cost-refused: estimated cost ${error.estimatedCost} exceeds the policy ceiling ${error.budget} — the model was never invoked`;
    case "invalid-output":
      return `invalid-output: the model's response failed the strict score schema (${error.details.length} problem(s))`;
    case "degraded":
      return `degraded: the model returned no scores (confidence ${error.confidence}) — no scores were fabricated; the caller decides fallback`;
    case "model-failure":
      return `model-failure: the model's score() failed: ${error.details.join("; ")}`;
  }
}

/** The terminal outcome of one adapter invocation ("ok" or the error kind). */
export type ByomOutcome = "ok" | ByomErrorKind;

// ---------------------------------------------------------------------------
// ByomTrace — the debug observability record
// ---------------------------------------------------------------------------

/** The byom invocation stage record. */
export interface ByomInvocationRecord {
  /** Whether the model was actually invoked (false only on pre-invocation refusals). */
  invoked: boolean;
  /** The model call's latency from the injected clock (ms). */
  latencyMs: number;
}

/** The enforcement stage record for the trace. */
export interface ByomEnforcementTrace {
  verdict: "ok" | "degraded";
  clamps: readonly ScoreClamp[];
  explanationCaps: readonly ExplanationCap[];
  /** Present only when degraded — the machine-readable reason. */
  degradedReason?: string;
}

/**
 * The observability record of ONE `score()` invocation. Stages are present
 * iff they ran (a refused invocation has no validation stage); `outcome`
 * summarizes the terminal result. Attached to `adapter.debug` — NEVER to the
 * scores.
 */
export interface ByomTrace {
  /** 1-based monotonic invocation counter for this adapter. */
  invocationIndex: number;
  /** The wrapped model's identity. */
  model: { id: string; version: string; privacyClass: ByomPrivacyClass };
  /** ISO 8601 timestamp from the injected clock at score() entry. */
  startedAt: string;
  /** Wall-clock duration of the whole score() call (injected clock, ms). */
  durationMs: number;
  /** The terminal outcome ("ok" or the ByomError kind that was thrown). */
  outcome: ByomOutcome;
  /** Stage: privacy redaction (present once ctx validation passed). */
  redaction?: RedactionReport;
  /** Stage: pre-invocation cost ceiling check. */
  costCheck?: CostCheckRecord;
  /** Stage: the model invocation itself. */
  invocation?: ByomInvocationRecord;
  /** Stage: output validation (present iff the model resolved). */
  validation?: ByomValidationSummary;
  /** Stage: policy enforcement (present iff validation passed). */
  enforcement?: ByomEnforcementTrace;
}

/** The debug accessor surface of a BYOM adapter (traces, never on scores). */
export interface ByomAdapterDebug {
  /**
   * The trace of the most recent score() invocation — recorded on success
   * AND failure paths (the finally block always writes); null before any.
   */
  lastTrace(): ByomTrace | null;
  /** How many score() invocations this adapter has traced. */
  invocationCount(): number;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Construction options for {@link createByomAdapter}. */
export interface ByomAdapterOptions {
  /**
   * The enforcement policy: cost ceiling (fabric units), clamp bounds,
   * explanation cap. Default: no cost ceiling, the documented default
   * bounds/cap. Validated at construction (typed InvalidByomPolicyError).
   */
  policy?: ByomEnforcementPolicy;
  /**
   * Estimated byom calls per score() invocation. Default: 1 — the adapter's
   * own call pattern (one model call per score; no retries, no hidden
   * calls). Positive integer.
   */
  estimatedCallsPerScore?: number;
  /**
   * The clock (epoch milliseconds) used for startedAt/durationMs/latencyMs.
   * Default: Date.now. INJECTED for deterministic tests.
   */
  clock?: () => number;
  /**
   * The pseudonymization salt for cloud-class redaction. Default:
   * {@link BYOM_DEFAULT_PSEUDONYM_SALT}. Per-deployment constant — NOT
   * randomness (determinism is the law).
   */
  pseudonymSalt?: string;
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

/**
 * A BYOM adapter: the frozen `RecommendationModel` surface plus the debug
 * accessor. The extra `debug` field is accepted everywhere a
 * `RecommendationModel` is (structural typing — the OS validator tolerates
 * unknown extra fields).
 */
export interface ByomAdapter extends RecommendationModel {
  /** The trace accessor — every stage of every invocation, off the scores. */
  readonly debug: ByomAdapterDebug;
}

/** Bounded, safe rendering of a model failure (never the input itself). */
function byomFailureMessage(error: unknown): string {
  let message: string;
  if (error instanceof Error) {
    message = error.message.length > 0 ? error.message : String(error);
  } else {
    message = String(error);
  }
  return message.length > 200 ? `${message.slice(0, 197)}...` : message;
}

/**
 * Create the BYOM adapter: wrap an injected `ByomModel` as a frozen
 * `RecommendationModel` with privacy redaction, cost ceiling, strict output
 * validation, and safety enforcement around it — every stage traced to the
 * debug accessor, every failure a typed `ByomError` rejection.
 *
 * @throws InvalidByomModelError when the byom model violates the port shape.
 * @throws InvalidByomPolicyError when the options' policy is malformed.
 * @throws Error when estimatedCallsPerScore / clock / pseudonymSalt options
 *         are malformed (construction-time wiring bugs — the merged
 *         ModelFabric constructor precedent).
 */
export function createByomAdapter(byom: ByomModel, options: ByomAdapterOptions = {}): ByomAdapter {
  assertValidByomModel(byom);

  const policy: ByomEnforcementPolicy = options.policy ?? {};
  assertValidByomEnforcementPolicy(policy);

  const estimatedCalls = options.estimatedCallsPerScore ?? 1;
  if (!Number.isInteger(estimatedCalls) || estimatedCalls < 1) {
    throw new Error(
      `createByomAdapter: estimatedCallsPerScore must be a positive integer, got ${options.estimatedCallsPerScore}`,
    );
  }
  const clock = options.clock ?? (() => Date.now());
  if (typeof clock !== "function") {
    throw new Error("createByomAdapter: clock must be a function () => number");
  }
  const pseudonymSalt = options.pseudonymSalt ?? BYOM_DEFAULT_PSEUDONYM_SALT;
  if (typeof pseudonymSalt !== "string" || pseudonymSalt.length === 0) {
    throw new Error(
      `createByomAdapter: pseudonymSalt must be a non-empty string, got ${String(options.pseudonymSalt)}`,
    );
  }

  let lastTrace: ByomTrace | null = null;
  let invocationCount = 0;

  const adapter: ByomAdapter = {
    id: byom.id,
    version: byom.version,

    async score(ctx: RecommendationContext): Promise<RecommendationScore[]> {
      const startMs = clock();
      const startedAt = new Date(startMs).toISOString();
      invocationCount += 1;
      const invocationIndex = invocationCount;

      // Stage records — present iff the stage ran.
      let redaction: RedactionReport | undefined;
      let costCheck: CostCheckRecord | undefined;
      let invocation: ByomInvocationRecord | undefined;
      let validation: ByomValidationSummary | undefined;
      let enforcement: ByomEnforcementTrace | undefined;
      let outcome: ByomOutcome = "ok";

      try {
        // --- 1. ctx validation (the merged OS validator, field paths) -------
        const ctxCheck = validateRecommendationContext(ctx);
        if (!ctxCheck.ok) {
          outcome = "invalid-context";
          throw new ByomError("invalid-context", ctxCheck.errors);
        }

        // --- 2. privacy redaction ------------------------------------------
        const redacted = redactForPrivacy(ctxCheck.value, byom.privacyClass, {
          salt: pseudonymSalt,
        });
        redaction = redacted.report;

        // --- 3. pre-invocation cost ceiling ---------------------------------
        const cost = checkCostCeiling(byom, estimatedCalls, policy);
        costCheck = cost;
        if (!cost.allowed && cost.maxCostPerOperation !== undefined) {
          outcome = "cost-refused";
          throw new ByomError(
            "cost-refused",
            [
              `estimated cost ${cost.estimatedCost} (${byom.costPerCall} per call × ${cost.estimatedCalls} estimated call(s)) exceeds the policy ceiling ${cost.maxCostPerOperation} — refusing BEFORE the model is invoked`,
            ],
            { budget: cost.maxCostPerOperation, estimatedCost: cost.estimatedCost },
          );
        }

        // --- 4. invoke the model (latency from the injected clock) ----------
        const invokeStart = clock();
        let raw: unknown;
        try {
          raw = await byom.score(redacted.input);
        } catch (error) {
          invocation = { invoked: true, latencyMs: clock() - invokeStart };
          outcome = "model-failure";
          if (isByomError(error)) throw error; // already typed (a wrapped byom)
          throw new ByomError("model-failure", [
            `byom model "${byom.id}" v${byom.version} score() failed: ${byomFailureMessage(error)}`,
          ]);
        }
        invocation = { invoked: true, latencyMs: clock() - invokeStart };

        // --- 5. strict output validation ------------------------------------
        const outputCheck = validateByomOutput(raw);
        validation = {
          ok: outputCheck.ok,
          errors: outputCheck.ok ? [] : outputCheck.errors,
          unknownFields: outputCheck.report.unknownFields,
        };
        if (!outputCheck.ok) {
          outcome = "invalid-output";
          throw new ByomError("invalid-output", outputCheck.errors);
        }

        // --- 6. policy enforcement ------------------------------------------
        const enforced = enforcePolicy(outputCheck.value, policy);
        enforcement = {
          verdict: enforced.verdict,
          clamps: enforced.report.clamps,
          explanationCaps: enforced.report.explanationCaps,
          ...(enforced.verdict === "degraded" ? { degradedReason: enforced.reason } : {}),
        };
        if (enforced.verdict === "degraded") {
          outcome = "degraded";
          throw new ByomError(
            "degraded",
            [
              `${enforced.reason}: the byom model "${byom.id}" v${byom.version} returned no scores — confidence ${enforced.confidence}, no scores fabricated (the caller decides fallback)`,
            ],
            { confidence: 0 },
          );
        }

        // --- 7. return: the scores stay clean (no trace attached) ------------
        return enforced.scores;
      } finally {
        // The trace is written on EVERY exit path — success, typed refusal,
        // model failure — before the outcome propagates.
        lastTrace = {
          invocationIndex,
          model: { id: byom.id, version: byom.version, privacyClass: byom.privacyClass },
          startedAt,
          durationMs: clock() - startMs,
          outcome,
          ...(redaction !== undefined ? { redaction } : {}),
          ...(costCheck !== undefined ? { costCheck } : {}),
          ...(invocation !== undefined ? { invocation } : {}),
          ...(validation !== undefined ? { validation } : {}),
          ...(enforcement !== undefined ? { enforcement } : {}),
        };
      }
    },

    debug: {
      lastTrace(): ByomTrace | null {
        return lastTrace;
      },
      invocationCount(): number {
        return invocationCount;
      },
    },
  };

  return adapter;
}
