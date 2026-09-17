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
 *    the R05 wiring below).
 * 2. ONE OBJECTIVE PER SCOPE — re-submitting the same objective within a
 *    scope UPDATES it (weight/expiry), never duplicates (deterministic).
 * 3. EXPIRY IS LIVE — expired intents leave the active set; `intents()`
 *    filters by the injected clock at read time.
 * 4. HONEST VALIDATION — malformed commands throw the typed `RuntimeError`
 *    (`invalid-input`): empty objective, unknown scope, non-finite weight,
 *    past expiry, non-ISO expiry.
 *
 * THE R05 SERVER WIRING (ADD-ONLY — the ServerPort seam stays frozen; only
 * this store's BACKING grows): when a `ServerPort` is injected (every
 * adapter injects one), the store additionally:
 *
 * - WRITES THROUGH the DURABLE scopes (`persistent` | `temporary` |
 *   `social`) to the profile's server-side records — cross-device
 *   continuity; a typed server failure throws the mapped `RuntimeError`
 *   (the local session set keeps the intent for THIS session; the failure
 *   is never a silent success). `session`/`momentary` intents NEVER reach
 *   the server — they are cleared at `endSession` by law, so persisting
 *   them would corrupt that truth.
 * - HYDRATES the local view from the server's durable records
 *   (`hydrate()` — adapters call it at boot): expired records are filtered
 *   at read (law 3, server-side twin); local entries WIN per (scope,
 *   objective) — the session's own submissions are the freshest truth; the
 *   server policy seeds the local policy view when the user has not
 *   changed it locally.
 *
 * Attention-mode submission rides the same store (the recommendation
 * policy view): validated against the frozen `ATTENTION_MODES` vocabulary.
 */

import { ATTENTION_MODES, INTENT_ID_PREFIX, INTENT_PROVENANCES, INTENT_SCOPES } from "@wfx/domain";
import type { IntentScope, RecommendationPolicy } from "@wfx/domain";
import { previewValue } from "@wfx/domain";

import { RuntimeError, serverFailureError } from "./errors";
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
   * R05: hydrate the local view from the server's durable intent records
   * + policy (cross-device continuity). Adapters call it once at boot;
   * a typed server failure throws the mapped `RuntimeError` (never a
   * silent empty hydration).
   */
  hydrate(): Promise<void>;
}

/** The scopes whose intents persist server-side (durable). */
const DURABLE_INTENT_SCOPES: readonly IntentScope[] = ["persistent", "temporary", "social"];

function isDurableIntentScope(scope: IntentScope): boolean {
  return (DURABLE_INTENT_SCOPES as readonly string[]).includes(scope);
}

/**
 * The session intent store + attention-mode policy view. Created by
 * `createRuntime`; usable standalone in tests. The optional `server`
 * (R05) adds the durable write-through + boot hydration over the frozen
 * ServerPort seam — the local laws above are unchanged either way.
 */
export class IntentStore {
  private readonly byKey = new Map<string, RecordedIntent>();
  private policyView: RecommendationPolicyView;
  private readonly server: ServerPort | undefined;
  private policyDirty = false;

  constructor(
    private readonly clock: RuntimeClock,
    private readonly ids: RuntimeIdGen,
    server?: ServerPort,
  ) {
    this.policyView = {
      attentionMode: DEFAULT_ATTENTION_MODE,
      exploration: 0.5,
      novelty: 0.5,
      socialInfluence: 0.5,
      updatedAt: new Date(clock.now()).toISOString(),
    };
    this.server = server;
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
    this.policyDirty = true;
    return this.policyView;
  }

  /**
   * R05: record one intent locally (the R01 law) AND write it through to
   * the server's durable records when the scope is durable
   * (persistent/temporary/social — cross-device continuity). A typed
   * server failure throws the mapped `RuntimeError` — the local session
   * set keeps the intent for THIS session (documented: the durable write
   * can be retried by re-submitting the same command, which updates in
   * place); the failure is never a silent success.
   */
  async syncIntent(command: UserIntentCommand): Promise<RecordedIntent> {
    const recorded = this.set(command); // validated; invalid input throws
    if (this.server === undefined) return recorded;
    if (!isDurableIntentScope(command.scope)) return recorded; // session/momentary: per-session by law
    const result = await this.server.writeIntent(command);
    if (!result.ok) {
      throw serverFailureError("writeIntent", result.failure);
    }
    return recorded;
  }

  /**
   * R05: update the policy view locally AND write the command through to
   * the server (the active profile's stored policy). A typed server
   * failure throws the mapped `RuntimeError` (the local view keeps the
   * change for THIS session; retry re-issues the same command).
   */
  async syncPolicy(command: RecommendationPolicyCommand): Promise<RecommendationPolicyView> {
    const view = this.setPolicy(command); // validated; invalid input throws
    if (this.server === undefined) return view;
    const result = await this.server.writePolicy(command);
    if (!result.ok) {
      throw serverFailureError("writePolicy", result.failure);
    }
    return view;
  }

  /**
   * R05: hydrate the local view from the server's durable records —
   * cross-device continuity (any device with the same profile sees the
   * same intents/policy). LAWS: expired records never hydrate (law 3,
   * read-time filtering against the injected clock); `session`/`momentary`
   * records never hydrate (per-session by construction — their session
   * ended); LOCAL entries WIN per (scope, objective) — the session's own
   * submissions are the freshest truth; the server policy seeds the local
   * view only when the user has not changed it locally this session.
   * A typed server failure throws the mapped `RuntimeError`.
   */
  async hydrate(): Promise<void> {
    if (this.server === undefined) return;
    const read = await this.server.readIntents();
    if (!read.ok) {
      throw serverFailureError("readIntents", read.failure);
    }
    const now = this.clock.now();
    for (const record of read.value) {
      if (!(INTENT_SCOPES as readonly string[]).includes(record.scope)) continue; // not our vocabulary — skip honestly
      if (!isDurableIntentScope(record.scope)) continue;
      if (record.expiresAt !== undefined) {
        const at = Date.parse(record.expiresAt);
        if (Number.isFinite(at) && at <= now) continue; // live-expiry law
      }
      const key = `${record.scope}:${record.objective}`;
      if (this.byKey.has(key)) continue; // the session's own submission is fresher
      this.byKey.set(key, {
        id: record.id,
        scope: record.scope,
        objective: record.objective,
        weight: record.weight,
        confidence: record.confidence,
        ...(record.expiresAt !== undefined ? { expiresAt: record.expiresAt } : {}),
        provenance: record.provenance,
        submittedAt: record.updatedAt,
      });
    }
    const policyRead = await this.server.readPolicy();
    if (!policyRead.ok) {
      throw serverFailureError("readPolicy", policyRead.failure);
    }
    if (policyRead.value !== null && !this.policyDirty) {
      const policy: RecommendationPolicy = policyRead.value;
      this.policyView = {
        attentionMode: policy.attentionMode,
        exploration: policy.exploration,
        novelty: policy.novelty,
        socialInfluence: policy.socialInfluence,
        updatedAt: new Date(now).toISOString(),
      };
    }
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
      hydrate: () => this.hydrate(),
    };
  }
}
