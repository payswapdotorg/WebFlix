/**
 * @wfx/client-runtime — intent submission (R01).
 *
 * Session/temporary vs persistent intent + attention-mode submission, on
 * the frozen Intent Graph vocabulary (`IntentScope` = persistent |
 * temporary | session | momentary | social; `UserIntent` shape). The
 * runtime owns the SESSION INTENT SET (R01 scope):
 *
 * 1. SCOPE TRUTH — `temporary` intents REQUIRE `expiresAt` (ISO, in the
 *    future at submission); `session`/`momentary` intents are cleared when
 *    the runtime session ends (`endSession`); `persistent` intents live
 *    for the runtime lifetime (CROSS-SESSION persistence is server-side —
 *    R02/R05 wiring, documented for the lead).
 * 2. ONE OBJECTIVE PER SCOPE — re-submitting the same objective within a
 *    scope UPDATES it (weight/expiry), never duplicates (deterministic).
 * 3. EXPIRY IS LIVE — expired intents leave the active set; `intents()`
 *    filters by the injected clock at read time.
 * 4. HONEST VALIDATION — malformed commands throw the typed `RuntimeError`
 *    (`invalid-input`): empty objective, unknown scope, non-finite weight,
 *    past expiry, non-ISO expiry.
 *
 * Attention-mode submission rides the same store (the recommendation
 * policy view): validated against the frozen `ATTENTION_MODES` vocabulary.
 */

import { ATTENTION_MODES, INTENT_ID_PREFIX, INTENT_PROVENANCES, INTENT_SCOPES } from "@wfx/domain";
import type { IntentScope, RecommendationPolicy } from "@wfx/domain";
import { previewValue } from "@wfx/domain";

import { RuntimeError } from "./errors";
import type { RuntimeClock, RuntimeIdGen } from "./runtime-seams";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The attention-mode vocabulary (the frozen `RecommendationPolicy` field). */
export type AttentionMode = RecommendationPolicy["attentionMode"];

/** The frozen intent provenance vocabulary. */
export type IntentProvenance = "explicit" | "inferred" | "imported";

/** The command the runtime's `setIntent` accepts (the sketch's input). */
export interface UserIntentCommand {
  /** The intent's objective (non-empty; e.g. "cozy-comedy-tonight"). */
  readonly objective: string;
  /** The frozen scope vocabulary member. */
  readonly scope: IntentScope;
  /** Weight (>0, finite; defaults 1). */
  readonly weight?: number;
  /** REQUIRED for `temporary` scope: ISO 8601, in the future. */
  readonly expiresAt?: string;
  /** Defaults `"explicit"` for user submission. */
  readonly provenance?: IntentProvenance;
}

/** One recorded intent (the frozen `UserIntent` shape, runtime-minted ids). */
export interface RecordedIntent {
  readonly id: string;
  readonly scope: IntentScope;
  readonly objective: string;
  readonly weight: number;
  readonly confidence: number;
  readonly expiresAt?: string;
  readonly provenance: IntentProvenance;
  readonly submittedAt: string;
}

/** The command the runtime's `setRecommendationPolicy` accepts. */
export interface RecommendationPolicyCommand {
  /** The frozen attention-mode vocabulary member (required). */
  readonly attentionMode: AttentionMode;
  /** Optional policy dials in [0,1] (the full controls are R05's). */
  readonly exploration?: number;
  readonly novelty?: number;
  readonly socialInfluence?: number;
}

/** The runtime's current recommendation-policy view. */
export interface RecommendationPolicyView {
  readonly attentionMode: AttentionMode;
  readonly exploration: number;
  readonly novelty: number;
  readonly socialInfluence: number;
  readonly updatedAt: string;
}

/** The default policy view (balanced — the frozen default mode). */
export const DEFAULT_ATTENTION_MODE: AttentionMode = "balanced";

// ---------------------------------------------------------------------------
// Validation (law 4 — honest, typed)
// ---------------------------------------------------------------------------

/**
 * Validate one intent command. Throws the typed `RuntimeError` on every
 * violation (see module doc law 4). Returns the normalized intent.
 */
export function assertValidIntentCommand(
  command: UserIntentCommand,
  clock: RuntimeClock,
): { objective: string; scope: IntentScope; weight: number; expiresAt?: string; provenance: IntentProvenance } {
  const problems: string[] = [];
  if (typeof command?.objective !== "string" || command.objective.trim().length === 0) {
    problems.push(
      `command.objective: expected a non-empty string (after trim), got ${previewValue((command as { objective?: unknown })?.objective)}`,
    );
  }
  if (typeof command?.scope !== "string" || !(INTENT_SCOPES as readonly string[]).includes(command.scope)) {
    problems.push(
      `command.scope: expected one of ${INTENT_SCOPES.join(" | ")}, got ${previewValue((command as { scope?: unknown })?.scope)}`,
    );
  }
  if (command?.weight !== undefined && (typeof command.weight !== "number" || !Number.isFinite(command.weight) || command.weight <= 0)) {
    problems.push(
      `command.weight: expected a finite positive number when present, got ${previewValue(command?.weight)}`,
    );
  }
  if (
    command?.provenance !== undefined &&
    !(INTENT_PROVENANCES as readonly string[]).includes(command.provenance)
  ) {
    problems.push(
      `command.provenance: expected one of ${INTENT_PROVENANCES.join(" | ")} when present, got ${previewValue(command?.provenance)}`,
    );
  }
  if (problems.length > 0) throw new RuntimeError("invalid-input", problems.join("; "));

  // Law 1: temporary intents REQUIRE a future expiry.
  if (command.scope === "temporary") {
    if (typeof command.expiresAt !== "string" || command.expiresAt.length === 0) {
      throw new RuntimeError(
        "invalid-input",
        "command.expiresAt: REQUIRED for scope 'temporary' (when the exploration window ends)",
      );
    }
    const at = Date.parse(command.expiresAt);
    if (Number.isNaN(at)) {
      throw new RuntimeError(
        "invalid-input",
        `command.expiresAt: expected an ISO 8601 datetime, got ${previewValue(command.expiresAt)}`,
      );
    }
    if (at <= clock.now()) {
      throw new RuntimeError(
        "invalid-input",
        `command.expiresAt: expected a future timestamp, got ${previewValue(command.expiresAt)} (already past)`,
      );
    }
  } else if (
    command.expiresAt !== undefined &&
    (typeof command.expiresAt !== "string" || Number.isNaN(Date.parse(command.expiresAt)))
  ) {
    throw new RuntimeError(
      "invalid-input",
      `command.expiresAt: expected an ISO 8601 datetime when present, got ${previewValue(command.expiresAt)}`,
    );
  }

  return {
    objective: command.objective.trim(),
    scope: command.scope,
    weight: command.weight ?? 1,
    ...(command.expiresAt !== undefined ? { expiresAt: command.expiresAt } : {}),
    provenance: command.provenance ?? "explicit",
  };
}

/** Validate one policy command (the attention-mode law). */
export function assertValidPolicyCommand(command: RecommendationPolicyCommand): void {
  const problems: string[] = [];
  if (
    typeof command?.attentionMode !== "string" ||
    !(ATTENTION_MODES as readonly string[]).includes(command.attentionMode)
  ) {
    problems.push(
      `command.attentionMode: expected one of ${ATTENTION_MODES.join(" | ")}, got ${previewValue((command as { attentionMode?: unknown })?.attentionMode)}`,
    );
  }
  for (const dial of ["exploration", "novelty", "socialInfluence"] as const) {
    const value = command?.[dial];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) {
      problems.push(`command.${dial}: expected a finite number in [0,1] when present, got ${previewValue(value)}`);
    }
  }
  if (problems.length > 0) throw new RuntimeError("invalid-input", problems.join("; "));
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** The intent store's operations surface (exposed via the runtime). */
export interface IntentOperations {
  /** The ACTIVE intents (expiry-filtered at read time — law 3). */
  intents(): readonly RecordedIntent[];
  /** The current recommendation-policy view. */
  policy(): RecommendationPolicyView;
  /** End the session: clear session/momentary intents (law 1). */
  endSession(): void;
}

/**
 * The session intent store + attention-mode policy view. Created by
 * `createRuntime`; usable standalone in tests.
 */
export class IntentStore {
  private readonly byKey = new Map<string, RecordedIntent>();
  private policyView: RecommendationPolicyView;

  constructor(
    private readonly clock: RuntimeClock,
    private readonly ids: RuntimeIdGen,
  ) {
    this.policyView = {
      attentionMode: DEFAULT_ATTENTION_MODE,
      exploration: 0.5,
      novelty: 0.5,
      socialInfluence: 0.5,
      updatedAt: new Date(clock.now()).toISOString(),
    };
  }

  /** Record/update one intent (law 2 — one objective per scope). */
  set(command: UserIntentCommand): RecordedIntent {
    const normalized = assertValidIntentCommand(command, this.clock);
    const key = `${normalized.scope}:${normalized.objective}`;
    const existing = this.byKey.get(key);
    const recorded: RecordedIntent = {
      id: existing?.id ?? INTENT_ID_PREFIX + this.ids.next(),
      scope: normalized.scope,
      objective: normalized.objective,
      weight: normalized.weight,
      confidence: 1, // explicit submission is certain (the frozen shape's floor)
      ...(normalized.expiresAt !== undefined ? { expiresAt: normalized.expiresAt } : {}),
      provenance: normalized.provenance,
      submittedAt: new Date(this.clock.now()).toISOString(),
    };
    this.byKey.set(key, recorded);
    return recorded;
  }

  /** Update the attention-mode/policy view (validated). */
  setPolicy(command: RecommendationPolicyCommand): RecommendationPolicyView {
    assertValidPolicyCommand(command);
    this.policyView = {
      attentionMode: command.attentionMode,
      exploration: command.exploration ?? this.policyView.exploration,
      novelty: command.novelty ?? this.policyView.novelty,
      socialInfluence: command.socialInfluence ?? this.policyView.socialInfluence,
      updatedAt: new Date(this.clock.now()).toISOString(),
    };
    return this.policyView;
  }

  /** The active intents (expiry-filtered — law 3). */
  active(): readonly RecordedIntent[] {
    const now = this.clock.now();
    return [...this.byKey.values()].filter((intent) => {
      if (intent.expiresAt === undefined) return true;
      const at = Date.parse(intent.expiresAt);
      return !(Number.isFinite(at) && at <= now);
    });
  }

  /** End the session (law 1: session/momentary intents are cleared). */
  endSession(): void {
    for (const [key, intent] of this.byKey) {
      if (intent.scope === "session" || intent.scope === "momentary") {
        this.byKey.delete(key);
      }
    }
  }

  /** The operations surface. */
  operations(): IntentOperations {
    return {
      intents: () => this.active(),
      policy: () => ({ ...this.policyView }),
      endSession: () => this.endSession(),
    };
  }
}
