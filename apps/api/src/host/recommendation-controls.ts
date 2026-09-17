/**
 * @wfx/app-api — the R05 recommendation-controls host.
 *
 * The composition seam between the `/experience/{policy,intents,feedback}`
 * routes and the persistence-layer stores
 * (`PostgresRecommendationStateStore` + `PostgresIntentStore` +
 * `PostgresRecommendationFeedbackStore`), owning the three laws the routes
 * share:
 *
 * 1. SCOPE TRUTH (the R01 law, server side): `temporary` intents REQUIRE a
 *    future ISO expiry at submission; one-objective-per-scope updates are
 *    deterministic upserts (the store's unique key); expired temporary
 *    intents are filtered at READ time (`listActiveForProfile`).
 * 2. HONEST VALIDATION: field-level, aggregated — every problem is named
 *    (the same discipline the domain validators follow); nothing coerced.
 * 3. REVERSIBILITY: intents delete by id; feedback delete = gone. Nothing
 *    here ever touches `event_outbox` / `watch_history` (the R04 event-sink
 *    law — `already-watched` is a recommendation control, not a history
 *    edit).
 *
 * WIRE SHAPES (the adapters' frozen transport guards, verbatim):
 * - `GET /experience/policy` answers the stored `RecommendationPolicy` or
 *   `null` (JSON null) — the HONEST empty, never a fabricated
 *   default-as-if-configured (the runtime's default view is the client's).
 * - `GET /experience/intents` answers `IntentRecord[]` (the R02-extended
 *   `readIntents` shape: id/userId/objective/weight/confidence/createdAt/
 *   updatedAt/evidenceCount + scope/provenance/expiresAt/lastReinforcedAt).
 * - feedback answers this module's `FeedbackWireRecord` (id/kind/targetType/
 *   targetId/note/createdAt + userId).
 *
 * The API does NOT depend on `@wfx/client-runtime` (the lane rule); the
 * wire shapes are structurally identical, so TypeScript's structural typing
 * keeps them compatible.
 *
 * Determinism: pure composition over the stores; the clock/ids are the
 * injected seams (no hidden wall clock, no randomness).
 */

import {
  ATTENTION_MODES,
  INTENT_OBJECTIVE_MAX_LENGTH,
  INTENT_PROVENANCES,
  INTENT_SCOPES,
  validatePolicy,
  type IntentScope,
  type RecommendationPolicy,
} from "@wfx/domain";
import type { Clock, IdGen } from "@wfx/experience";
import {
  FEEDBACK_KIND_TARGETS,
  FEEDBACK_NOTE_MAX_LENGTH,
  PostgresIntentStore,
  PostgresProfileService,
  PostgresRecommendationFeedbackStore,
  PostgresRecommendationStateStore,
  RECOMMENDATION_FEEDBACK_KINDS,
  type FeedbackRecord,
  type IntentUpsertInput,
  type PersistedIntent,
  type RecommendationFeedbackKind,
} from "@wfx/persistence";

import { describeThrown } from "@wfx/experience";

// ---------------------------------------------------------------------------
// The command wire shapes (the adapters' frozen POST/PUT bodies)
// ---------------------------------------------------------------------------

/** `PUT /experience/policy` body — the frozen `RecommendationPolicyCommand`. */
export interface PolicyCommandInput {
  readonly attentionMode?: unknown;
  readonly exploration?: unknown;
  readonly novelty?: unknown;
  readonly socialInfluence?: unknown;
}

/** `POST /experience/intents` body — the frozen `UserIntentCommand`. */
export interface IntentCommandInput {
  readonly objective?: unknown;
  readonly scope?: unknown;
  readonly weight?: unknown;
  readonly expiresAt?: unknown;
  readonly provenance?: unknown;
}

/** `POST /experience/feedback` body (the R05 control submission). */
export interface FeedbackCommandInput {
  readonly kind?: unknown;
  readonly targetId?: unknown;
  readonly note?: unknown;
}

// ---------------------------------------------------------------------------
// Wire shapes (what the routes answer)
// ---------------------------------------------------------------------------

/** One intent record as `GET /experience/intents` answers it. */
export type IntentWireRecord = PersistedIntent;

/** One feedback record as `GET /experience/feedback` / POST answers it. */
export type FeedbackWireRecord = FeedbackRecord;

// ---------------------------------------------------------------------------
// Typed validation (field-level, aggregated — the repo's law)
// ---------------------------------------------------------------------------

/** The ISO 8601 shape check the server applies (strict Z or offset form). */
function isIso8601String(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

/** Validate a policy command; returns every problem (never throws). */
export function policyCommandProblems(command: PolicyCommandInput): readonly string[] {
  const problems: string[] = [];
  if (typeof command?.attentionMode !== "string" || !(ATTENTION_MODES as readonly string[]).includes(command.attentionMode)) {
    problems.push(
      `policy.attentionMode: expected one of ${ATTENTION_MODES.join(" | ")}, got ${JSON.stringify(command?.attentionMode)}`,
    );
  }
  for (const dial of ["exploration", "novelty", "socialInfluence"] as const) {
    const value = command?.[dial];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      problems.push(
        `policy.${dial}: expected a finite number in [0,1] when present, got ${JSON.stringify(value)}`,
      );
    }
  }
  return problems;
}

/**
 * Validate an intent command against the R01 scope-truth law. The clock is
 * the injected seam (future expiry is judged against it — deterministic).
 */
export function intentCommandProblems(
  command: IntentCommandInput,
  nowMs: number,
): readonly string[] {
  const problems: string[] = [];
  const objective = command?.objective;
  if (
    typeof objective !== "string" ||
    objective.trim().length === 0 ||
    objective.length > INTENT_OBJECTIVE_MAX_LENGTH
  ) {
    problems.push(
      `intent.objective: expected 1..${INTENT_OBJECTIVE_MAX_LENGTH} characters (after trim), got ${JSON.stringify(objective)}`,
    );
  }
  const scope = command?.scope;
  if (typeof scope !== "string" || !(INTENT_SCOPES as readonly string[]).includes(scope)) {
    problems.push(
      `intent.scope: expected one of ${INTENT_SCOPES.join(" | ")}, got ${JSON.stringify(scope)}`,
    );
  }
  const weight = command?.weight;
  if (weight !== undefined && (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0)) {
    problems.push(
      `intent.weight: expected a finite positive number when present, got ${JSON.stringify(weight)}`,
    );
  }
  const provenance = command?.provenance;
  if (
    provenance !== undefined &&
    (typeof provenance !== "string" || !(INTENT_PROVENANCES as readonly string[]).includes(provenance))
  ) {
    problems.push(
      `intent.provenance: expected one of ${INTENT_PROVENANCES.join(" | ")} when present, got ${JSON.stringify(provenance)}`,
    );
  }
  const expiresAt = command?.expiresAt;
  const scopeOk = typeof scope === "string" && (INTENT_SCOPES as readonly string[]).includes(scope);
  if (scopeOk && scope === "temporary") {
    // Law 1: temporary intents REQUIRE a future expiry.
    if (!isIso8601String(expiresAt)) {
      problems.push(
        `intent.expiresAt: REQUIRED for scope 'temporary' (when the exploration window ends) — expected an ISO 8601 datetime, got ${JSON.stringify(expiresAt)}`,
      );
    } else if (Date.parse(expiresAt) <= nowMs) {
      problems.push(
        `intent.expiresAt: expected a future timestamp, got ${JSON.stringify(expiresAt)} (already past)`,
      );
    }
  } else if (expiresAt !== undefined && !isIso8601String(expiresAt)) {
    problems.push(
      `intent.expiresAt: expected an ISO 8601 datetime when present, got ${JSON.stringify(expiresAt)}`,
    );
  }
  return problems;
}

/** Validate a feedback command (the J15 control vocabulary + target law). */
export function feedbackCommandProblems(command: FeedbackCommandInput): readonly string[] {
  const problems: string[] = [];
  const kind = command?.kind;
  if (
    typeof kind !== "string" ||
    !(RECOMMENDATION_FEEDBACK_KINDS as readonly string[]).includes(kind)
  ) {
    problems.push(
      `feedback.kind: expected one of ${RECOMMENDATION_FEEDBACK_KINDS.join(" | ")}, got ${JSON.stringify(kind)}`,
    );
    return problems; // the target law depends on the kind — nothing more to check
  }
  const targetId = command?.targetId;
  if (typeof targetId !== "string" || targetId.trim().length === 0) {
    problems.push(
      `feedback.targetId: expected a non-empty string (after trim), got ${JSON.stringify(targetId)}`,
    );
  } else {
    const feedbackKind = kind as RecommendationFeedbackKind;
    if (FEEDBACK_KIND_TARGETS[feedbackKind] === "item" && !targetId.startsWith("wfxitm_")) {
      problems.push(
        `feedback.targetId: expected a canonical item id (wfxitm_ prefix) for kind "${kind}", got ${JSON.stringify(targetId)}`,
      );
    }
  }
  const note = command?.note;
  if (
    note !== undefined &&
    (typeof note !== "string" || note.length > FEEDBACK_NOTE_MAX_LENGTH)
  ) {
    problems.push(
      `feedback.note: expected a string of at most ${FEEDBACK_NOTE_MAX_LENGTH} characters when present`,
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

/** Constructor dependencies (all injected — deterministic). */
export interface RecommendationControlsHostOptions {
  readonly db: import("@wfx/persistence").DbClient;
  readonly clock: Clock;
  readonly ids: IdGen;
}

/** One field-level validation failure (typed, aggregated). */
export class RecommendationControlsError extends Error {
  constructor(
    readonly problems: readonly string[],
  ) {
    super(`recommendation-controls: ${problems.join("; ")}`);
    this.name = "RecommendationControlsError";
  }
}

/** Canonical policy id prefix (the store's row identity). */
export const POLICY_ID_PREFIX = "wfxpol_";

/**
 * The R05 recommendation-controls host: policy + intents + feedback over the
 * persistence stores, with the scope-truth and validation laws the routes
 * share. Created once per service boot (alongside the history host).
 */
export class RecommendationControlsHost {
  private readonly state: PostgresRecommendationStateStore;
  private readonly intents: PostgresIntentStore;
  private readonly feedback: PostgresRecommendationFeedbackStore;
  private readonly profiles: PostgresProfileService;
  private readonly clock: Clock;
  private readonly ids: IdGen;

  constructor(options: RecommendationControlsHostOptions) {
    this.state = new PostgresRecommendationStateStore({
      db: options.db,
      clock: options.clock,
      ids: options.ids,
    });
    this.intents = new PostgresIntentStore({ db: options.db, ids: options.ids, clock: options.clock });
    this.feedback = new PostgresRecommendationFeedbackStore({
      db: options.db,
      clock: options.clock,
      ids: options.ids,
    });
    this.profiles = new PostgresProfileService({
      db: options.db,
      ids: options.ids,
      clock: options.clock,
    });
    this.clock = options.clock;
    this.ids = options.ids;
  }

  /**
   * The effective profile key for the ANONYMOUS channel (the frozen header
   * law's `x-wfx-user-id`): the registered user's default profile or the
   * legacy pseudo bucket — the same seam every profile-scoped store uses.
   */
  async anonymousProfileKey(userId: string): Promise<string> {
    return this.profiles.resolveEffectiveProfileKey(userId);
  }

  // — policy ————————————————————————————————————————————————————————————
  /**
   * The profile's stored `RecommendationPolicy`, or null when unset (the
   * honest empty — never a fabricated default-as-if-configured).
   */
  async readPolicy(profileId: string): Promise<RecommendationPolicy | null> {
    const loaded = await this.state.loadForProfile(profileId);
    return loaded.found ? loaded.state!.policy : null;
  }

  /**
   * Write the profile's policy from a `RecommendationPolicyCommand`
   * (validated against the frozen ATTENTION_MODES vocabulary + dial ranges;
   * typed problems otherwise). The stored policy's id and objectives are
   * PRESERVED across updates (the command carries mode + dials only — the
   * objectives are custom-mode configuration the PUT may not erase).
   */
  async writePolicy(input: {
    profileId: string;
    userId: string;
    command: PolicyCommandInput;
  }): Promise<RecommendationPolicy> {
    const problems = [...policyCommandProblems(input.command)];
    if (typeof input.userId !== "string" || input.userId.length === 0) {
      problems.push("userId: expected a non-empty string");
    }
    if (typeof input.profileId !== "string" || input.profileId.length === 0) {
      problems.push("profileId: expected a non-empty string");
    }
    if (problems.length > 0) throw new RecommendationControlsError(problems);

    const loaded = await this.state.loadForProfile(input.profileId);
    const existing = loaded.found ? loaded.state : null;
    const command = input.command as {
      attentionMode: RecommendationPolicy["attentionMode"];
      exploration?: number;
      novelty?: number;
      socialInfluence?: number;
    };
    const policy: RecommendationPolicy = {
      id: existing?.policy.id ?? POLICY_ID_PREFIX + this.ids.next(),
      userId: input.userId,
      objectives: existing?.policy.objectives ?? [],
      exploration: command.exploration ?? existing?.policy.exploration ?? 0.5,
      novelty: command.novelty ?? existing?.policy.novelty ?? 0.5,
      socialInfluence: command.socialInfluence ?? existing?.policy.socialInfluence ?? 0.5,
      attentionMode: command.attentionMode,
    };
    const check = validatePolicy(policy);
    if (!check.ok) throw new RecommendationControlsError(check.errors);

    const saved = await this.state.saveForProfile({
      userId: input.userId,
      profileId: input.profileId,
      policy,
      state: existing?.state ?? {},
    });
    return saved.policy;
  }

  // — intents ———————————————————————————————————————————————————————————
  /**
   * The profile's ACTIVE intents (the R01 live-expiry law: expired
   * temporary intents filtered at read), heaviest first.
   */
  async readActiveIntents(profileId: string): Promise<readonly IntentWireRecord[]> {
    return this.intents.listActiveForProfile(
      profileId,
      new Date(this.clock.now()).toISOString(),
    );
  }

  /**
   * Submit one intent (scope truth enforced; one-objective-per-scope
   * deterministic update-in-place — the store's unique key keeps the
   * canonical id stable and never duplicates).
   */
  async submitIntent(input: {
    profileId: string;
    userId: string;
    command: IntentCommandInput;
  }): Promise<IntentWireRecord> {
    const problems = [...intentCommandProblems(input.command, this.clock.now())];
    if (typeof input.userId !== "string" || input.userId.length === 0) {
      problems.push("userId: expected a non-empty string");
    }
    if (typeof input.profileId !== "string" || input.profileId.length === 0) {
      problems.push("profileId: expected a non-empty string");
    }
    if (problems.length > 0) throw new RecommendationControlsError(problems);

    const command = input.command as {
      objective: string;
      scope: IntentScope;
      weight?: number;
      expiresAt?: string;
      provenance?: IntentUpsertInput["provenance"];
    };
    const objective = command.objective.trim();
    const nowIso = new Date(this.clock.now()).toISOString();

    // The one-objective-per-scope law: find the existing record for the
    // (scope, objective) triple under this profile — re-submission UPDATES
    // it (weight/expiry/evidence), never duplicates.
    const existing = (await this.intents.listForProfile(input.profileId)).find(
      (record) => record.scope === command.scope && record.objective === objective,
    );
    const record: IntentUpsertInput = {
      id: existing?.id ?? ("wfxint_" + this.ids.next()) as IntentUpsertInput["id"],
      userId: input.userId,
      scope: command.scope,
      objective,
      weight: command.weight ?? 1,
      confidence: 1, // explicit submission is certain (the runtime's floor)
      ...(command.expiresAt !== undefined ? { expiresAt: command.expiresAt } : {}),
      provenance: command.provenance ?? "explicit",
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
      lastReinforcedAt: nowIso,
      evidenceCount: (existing?.evidenceCount ?? 0) + 1,
    };
    return this.intents.upsertIntentForProfile(record, input.profileId);
  }

  /** Remove one intent by canonical id, PROFILE-SCOPED (the undo law). */
  async deleteIntent(profileId: string, intentId: string): Promise<boolean> {
    return this.intents.deleteIntentForProfile(profileId, intentId);
  }

  // — feedback ——————————————————————————————————————————————————————————
  /** Add one feedback control (validated; update-in-place per target). */
  async addFeedback(input: {
    profileId: string;
    userId: string;
    command: FeedbackCommandInput;
  }): Promise<FeedbackWireRecord> {
    const problems = [...feedbackCommandProblems(input.command)];
    if (typeof input.userId !== "string" || input.userId.length === 0) {
      problems.push("userId: expected a non-empty string");
    }
    if (typeof input.profileId !== "string" || input.profileId.length === 0) {
      problems.push("profileId: expected a non-empty string");
    }
    if (problems.length > 0) throw new RecommendationControlsError(problems);

    const command = input.command as {
      kind: RecommendationFeedbackKind;
      targetId: string;
      note?: string;
    };
    return this.feedback.addForProfile({
      userId: input.userId,
      profileId: input.profileId,
      kind: command.kind,
      targetId: command.targetId,
      ...(command.note !== undefined ? { note: command.note } : {}),
    });
  }

  /** The profile's feedback records, newest first (the J15 controls list). */
  async listFeedback(profileId: string): Promise<readonly FeedbackWireRecord[]> {
    return this.feedback.listForProfile(profileId);
  }

  /** Remove one feedback record, PROFILE-SCOPED. Delete is GONE. */
  async deleteFeedback(profileId: string, id: string): Promise<boolean> {
    return this.feedback.deleteForProfile(profileId, id);
  }
}

/** Describe an unknown thrown failure (operator diagnostics — never secrets). */
export { describeThrown };
