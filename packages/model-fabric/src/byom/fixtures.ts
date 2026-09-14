/**
 * WFX-032 — BYOM TEST FIXTURES (Lane A — intelligence).
 *
 * TEST FIXTURES ONLY — NEVER PRODUCTION MODELS. The ByomModel is INJECTED
 * (the packet's law: no real network/model calls); these deterministic,
 * in-memory doubles exercise the adapter's paths:
 *
 * - `makeWellBehavedByom(id, opts)` — computes a valid, deterministic
 *   `RecommendationScore[]` from the (redacted) input it receives: one score
 *   per DISTINCT pool item (first occurrence order), a bounded deterministic
 *   formula, one explanation line, confidence 0.9, total-order sorted.
 * - `makeScriptedByom(id, opts)` — resolves with pre-scripted RAW responses
 *   (cycled per call): the malformed-output, empty-output, and
 *   clamp/cap-exercising cases.
 * - `makeThrowingByom(id, opts)` — always fails: async rejection or
 *   synchronous throw out of `score`.
 *
 * Every fixture carries `isTestFixture: true` and a `calls` log (the exact
 * `ByomInput` each invocation received) so tests can assert WHAT the model
 * saw — pseudonymized or verbatim, minimized or full — and that it was NEVER
 * invoked on refused paths (`calls.length === 0` proves it). No I/O of any
 * kind; no timers; no randomness.
 */

import type { RecommendationScore } from "@wfx/domain";

import type { ByomInput, ByomModel, ByomPrivacyClass } from "./byom";

// ---------------------------------------------------------------------------
// Shared fixture surface
// ---------------------------------------------------------------------------

/** Registration options shared by every BYOM fixture factory. */
export interface ByomFixtureOptions {
  /** The fixture's privacy class. Default: `'local-only'`. */
  privacyClass?: ByomPrivacyClass;
  /** The fixture's declared cost per call (fabric abstract units). Default: 0. */
  costPerCall?: number;
  /** The fixture's version string. Default: `'1.0.0'`. */
  version?: string;
}

/** The fixture base: a full `ByomModel` plus test observability. */
export interface ByomFixture extends ByomModel {
  /** Brand: this object is a TEST FIXTURE, never a production model. */
  readonly isTestFixture: true;
  /** Every input the fixture received, in order (the redaction assertions). */
  readonly calls: readonly ByomInput[];
}

/** Shared plumbing: metadata + the invocation log. */
abstract class ByomFixtureBase implements ByomFixture {
  readonly isTestFixture = true as const;
  readonly version: string;
  readonly privacyClass: ByomPrivacyClass;
  readonly costPerCall: number;
  private readonly callLog: ByomInput[] = [];

  protected constructor(
    readonly id: string,
    options: ByomFixtureOptions = {},
  ) {
    this.version = options.version ?? "1.0.0";
    this.privacyClass = options.privacyClass ?? "local-only";
    this.costPerCall = options.costPerCall ?? 0;
  }

  get calls(): readonly ByomInput[] {
    return this.callLog;
  }

  /** Record one invocation for test assertions. */
  protected record(input: ByomInput): void {
    this.callLog.push(input);
  }

  abstract score(input: ByomInput): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// makeWellBehavedByom
// ---------------------------------------------------------------------------

/** The well-behaved fixture's constant confidence. */
export const WELL_BEHAVED_CONFIDENCE = 0.9;

/**
 * The well-behaved BYOM fixture: scores every DISTINCT pool item with the
 * bounded deterministic formula `0.5 − 0.05 × (distinctIndex % 10)` (always
 * inside [0.05, 0.5] ⊂ the default clamp range), one explanation line,
 * confidence {@link WELL_BEHAVED_CONFIDENCE}. Output order: score desc, then
 * itemId asc — a deterministic total order (byte-identical across identical
 * inputs).
 */
export type WellBehavedByom = ByomFixture;

class WellBehavedByomImpl extends ByomFixtureBase implements WellBehavedByom {
  constructor(id: string, options: ByomFixtureOptions = {}) {
    super(id, options);
  }

  async score(input: ByomInput): Promise<unknown> {
    this.record(input);

    const distinct: string[] = [];
    const seen = new Set<string>();
    for (const candidate of input.candidatePool) {
      if (!seen.has(candidate.itemId)) {
        seen.add(candidate.itemId);
        distinct.push(candidate.itemId);
      }
    }

    const scores: RecommendationScore[] = distinct.map((itemId, index) => {
      const score = 0.5 - 0.05 * (index % 10);
      return {
        itemId,
        score,
        explanations: [
          `byom fixture "${this.id}": deterministic score ${score.toFixed(3)} for distinct pool item #${index}`,
        ],
        confidence: WELL_BEHAVED_CONFIDENCE,
      };
    });

    return scores.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
    });
  }
}

/** Create the well-behaved BYOM TEST FIXTURE (in-memory, no I/O). NEVER production. */
export function makeWellBehavedByom(
  id: string,
  options: ByomFixtureOptions = {},
): WellBehavedByom {
  return new WellBehavedByomImpl(id, options);
}

// ---------------------------------------------------------------------------
// makeScriptedByom
// ---------------------------------------------------------------------------

/** Options for {@link makeScriptedByom}: fixture options + the script. */
export interface ScriptedByomOptions extends ByomFixtureOptions {
  /**
   * The RAW responses to resolve with, cycled per call (call i answers
   * `responses[i % responses.length]`). At least one required. The values
   * are NOT validated here — the adapter's strict validation is the test
   * subject.
   */
  responses: readonly unknown[];
}

/** The scripted BYOM fixture: resolves with pre-scripted raw output. */
export type ScriptedByom = ByomFixture;

class ScriptedByomImpl extends ByomFixtureBase implements ScriptedByom {
  private readonly responses: readonly unknown[];

  constructor(id: string, options: ScriptedByomOptions) {
    super(id, options);
    if (!Array.isArray(options.responses) || options.responses.length === 0) {
      throw new Error("makeScriptedByom: responses must be a non-empty array of raw outputs");
    }
    this.responses = options.responses;
  }

  async score(input: ByomInput): Promise<unknown> {
    const callIndex = this.calls.length; // 0-based, captured before recording
    this.record(input);
    return this.responses[callIndex % this.responses.length]!;
  }
}

/** Create the scripted BYOM TEST FIXTURE (in-memory, no I/O). NEVER production. */
export function makeScriptedByom(id: string, options: ScriptedByomOptions): ScriptedByom {
  return new ScriptedByomImpl(id, options);
}

// ---------------------------------------------------------------------------
// makeThrowingByom
// ---------------------------------------------------------------------------

/** How the throwing fixture fails. */
export type ThrowingByomMode = "reject" | "sync-throw";

/** Options for {@link makeThrowingByom}. */
export interface ThrowingByomOptions extends ByomFixtureOptions {
  /** Failure mode. Default `'reject'` (async rejection). `'sync-throw'` throws synchronously. */
  failure?: ThrowingByomMode;
  /** The failure message. Default: `"byom fixture: deliberate model failure"`. */
  errorMessage?: string;
}

/** The throwing BYOM fixture: always fails, never succeeds. */
export type ThrowingByom = ByomFixture;

class ThrowingByomImpl extends ByomFixtureBase implements ThrowingByom {
  private readonly mode: ThrowingByomMode;
  private readonly errorMessage: string;

  constructor(id: string, options: ThrowingByomOptions = {}) {
    super(id, options);
    this.mode = options.failure ?? "reject";
    this.errorMessage = options.errorMessage ?? "byom fixture: deliberate model failure";
  }

  score(input: ByomInput): Promise<unknown> {
    this.record(input);
    if (this.mode === "sync-throw") {
      throw new Error(this.errorMessage);
    }
    return Promise.reject(new Error(this.errorMessage));
  }
}

/** Create the throwing BYOM TEST FIXTURE (in-memory, no I/O). NEVER production. */
export function makeThrowingByom(id: string, options: ThrowingByomOptions = {}): ThrowingByom {
  return new ThrowingByomImpl(id, options);
}
