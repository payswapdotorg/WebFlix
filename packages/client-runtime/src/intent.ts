/**
 * @wfx/client-runtime — intent submission (R01; R05 server wiring).
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
 *
 * R05 — THE SERVER-BACKED DURABLE WIRING (the seam the R02 ServerPort
 * members fill): a store constructed with a `server` gains
 * - DURABLE WRITE-THROUGH (runtime-level, see runtime.ts): `persistent`,
 *   `social`, and `temporary` submissions are also written through the
 *   port; `session`/`momentary` NEVER leave the runtime (they die at
 *   `endSession` — leaking them into the next session's server read would
 *   break scope truth);
 * - `refresh()`: the cross-device hydration — the server's durable
 *   records REPLACE their local twins (the server is the convergence
 *   point) and the server's policy (when set) becomes the policy view; a
 *   failing read answers the ERROR model (the last synced views stay
 *   visible — never a fake empty set); an unset server policy (null) keeps
 *   the current view (the honest empty).
 */

import { ATTENTION_MODES, INTENT_ID_PREFIX, INTENT_PROVENANCES, INTENT_SCOPES } from "@wfx/domain";
import type { IntentScope, RecommendationPolicy } from "@wfx/domain";
import { previewValue } from "@wfx/domain";

import { RuntimeError, serverFailureKind } from "./errors";
import { errorSection, readySection, type ModelSectionStatus } from "./models";
import type { RuntimeClock, RuntimeIdGen } from "./runtime-seams";
import type { ServerPort } from "./server-port";

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
// R05 — the durable/server-backed intent + policy wiring
// ---------------------------------------------------------------------------

/**
 * The DURABLE scopes: intents that outlive the runtime session and are
 * therefore written through to the server (persistent survives sessions;
 * social is a standing social-scope ask; temporary expires at `expiresAt`).
 *
 * `session` and `momentary` are SESSION-LOCAL BY LAW: they die at
 * `endSession` and are NEVER sent to the server — a session intent that
 * leaked into the next session's server-backed read would break the R01
 * scope truth. (The server may still hold rows in those scopes written by
 * other API clients; `refresh` ignores them defensively for the same
 * law.)
 */
export const DURABLE_INTENT_SCOPES: readonly IntentScope[] = ["persistent", "social", "temporary"];

/** Structural membership check against {@link DURABLE_INTENT_SCOPES}. */
export function isDurableIntentScope(scope: IntentScope): boolean {
  return (DURABLE_INTENT_SCOPES as readonly string[]).includes(scope);
}

/**
 * The model {@link IntentOperations.refresh} answers: a typed section
 * status (the R03 sources pattern — in-model degradation, never a fake
 * success and never a silent wipe). On `error` the last synced views stay
 * visible through the sync operations.
 */
export interface IntentRefreshModel {
  readonly status: ModelSectionStatus;
}

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
  /**
   * R05: hydrate the DURABLE intents + the policy view from the server
   * (cross-device continuity — another device's writes surface here).
   * Durable scopes are SERVER-OWNED after refresh (the server is the
   * convergence point); session/momentary intents are never touched. A
   * failing read answers the ERROR model — the last synced views stay
   * visible (never a fake empty set). An unset server policy (null) keeps
   * the current view (the honest empty — the runtime default stands).
   */
  refresh(): Promise<IntentRefreshModel>;
}

/** Options for {@link IntentStore}'s server-backed (R05) wiring. */
export interface IntentStoreServerOptions {
  /**
   * The server port whose R02 members (`readIntents`/`writeIntent`/
   * `readPolicy`/`writePolicy`) back the durable intents + policy view.
   * Optional: a store without a server keeps the pre-R05 session-only
   * semantics (usable standalone in tests).
   */
  readonly server?: ServerPort;
}

/**
 * The session intent store + attention-mode policy view, optionally
 * backed by the server's durable policy/intent stores (R05). Created by
 * `createRuntime`; usable standalone in tests.
 */
export class IntentStore {
  private readonly byKey = new Map<string, RecordedIntent>();
  private policyView: RecommendationPolicyView;
  private readonly server: ServerPort | undefined;

  constructor(
    private readonly clock: RuntimeClock,
    private readonly ids: RuntimeIdGen,
    options?: IntentStoreServerOptions,
  ) {
    this.policyView = {
      attentionMode: DEFAULT_ATTENTION_MODE,
      exploration: 0.5,
      novelty: 0.5,
      socialInfluence: 0.5,
      updatedAt: new Date(clock.now()).toISOString(),
    };
    this.server = options?.server;
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

  /**
   * R05: hydrate the durable intents + the policy view from the server.
   * See {@link IntentOperations.refresh}. Durable-scope server records
   * REPLACE their local twins (the server is the convergence point —
   * cross-device); session/momentary rows are skipped (the scope-truth
   * law — they never cross sessions) and malformed rows are skipped
   * (a broken row is never an intent).
   */
  async refresh(): Promise<IntentRefreshModel> {
    if (this.server === undefined) {
      return {
        status: errorSection(
          "unavailable",
          "no server port is bound to this intent store — the durable intent/policy hydration needs the R02 ServerPort members",
        ),
      };
    }

    const [intentsResult, policyResult] = await Promise.all([
      this.server.readIntents(),
      this.server.readPolicy(),
    ]);

    if (!intentsResult.ok) {
      return {
        status: errorSection(
          serverFailureKind(intentsResult.failure),
          intentsResult.failure.detail,
        ),
      };
    }
    if (!policyResult.ok) {
      return {
        status: errorSection(
          serverFailureKind(policyResult.failure),
          policyResult.failure.detail,
        ),
      };
    }

    // Merge the durable server records (the convergence point).
    for (const record of intentsResult.value) {
      if (!isDurableIntentScope(record.scope)) continue; // the scope-truth law
      if (typeof record.objective !== "string" || record.objective.trim().length === 0) continue;
      this.byKey.set(`${record.scope}:${record.objective}`, {
        id: record.id,
        scope: record.scope,
        objective: record.objective,
        weight: Number.isFinite(record.weight) ? record.weight : 1,
        confidence: Number.isFinite(record.confidence) ? record.confidence : 1,
        ...(record.expiresAt !== undefined ? { expiresAt: record.expiresAt } : {}),
        provenance: record.provenance,
        submittedAt: record.updatedAt,
      });
    }

    // Adopt the server policy when one is set (null keeps the current view —
    // the honest empty; the runtime's default view is the client's).
    if (policyResult.value !== null) {
      this.policyView = {
        attentionMode: policyResult.value.attentionMode,
        exploration: policyResult.value.exploration,
        novelty: policyResult.value.novelty,
        socialInfluence: policyResult.value.socialInfluence,
        updatedAt: new Date(this.clock.now()).toISOString(),
      };
    }

    return { status: readySection() };
  }

  /** The operations surface. */
  operations(): IntentOperations {
    return {
      intents: () => this.active(),
      policy: () => ({ ...this.policyView }),
      endSession: () => this.endSession(),
      refresh: () => this.refresh(),
    };
  }
}
