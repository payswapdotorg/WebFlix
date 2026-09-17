/**
 * @wfx/app-api — the R05 recommendation-controls host adapter.
 *
 * The composition seam between the `/experience/{policy,intents,feedback}`
 * routes and the persistence-layer stores (`PostgresIntentStore` +
 * `PostgresRecommendationStateStore` + `PostgresRecommendationFeedbackStore`).
 * It owns the R05 CONTROL LAWS the routes answer with:
 *
 * - POLICY (`GET/PUT /experience/policy`): the active profile's frozen
 *   `RecommendationPolicy` — attention mode + dials — or the HONEST null
 *   when unset (never a fabricated default-as-if-configured). Writes merge
 *   the validated command into the stored policy (stable id, preserved
 *   objectives, dials defaulting to the balanced baseline on first write).
 * - INTENTS (`GET/POST/DELETE /experience/intents[/:id]`): the profile's
 *   durable intent records. SCOPE TRUTH is enforced server-side exactly as
 *   the R01 runtime enforces it (`packages/client-runtime/src/intent.ts`,
 *   the law this endpoint backs): `temporary` REQUIRES a future ISO
 *   expiry; one-objective-per-scope UPDATES in place (deterministic, the
 *   canonical `wfxint_` id stable across merges — the store's identity
 *   index); reads filter EXPIRED records at read time (the R01
 *   live-expiry law, now server-side). DELETE is REVERSIBILITY: the undo
 *   law — every control that shapes recommendations can be undone.
 * - FEEDBACK (`POST/DELETE /experience/feedback[/:id]`): the J15 control
 *   set as typed per-profile records (kind + target + note + timestamp),
 *   idempotent per (profile, kind, target); DELETE is a REAL delete. The
 *   event_outbox is NEVER touched (the R04 event-sink law: recorded
 *   viewing events stay immutable audit truth).
 *
 * The wire shapes are the FROZEN ones the adapters' payload guards already
 * implement (`apps/{web,desktop}/src/platform/server-port.ts`): the API
 * does NOT depend on `@wfx/client-runtime` (the lane rule); the types are
 * structurally identical, so TypeScript's structural typing keeps them
 * compatible.
 *
 * Determinism: pure composition over the persistence stores + the injected
 * clock/ids seams (no Date.now / Math.random of its own).
 */

import {
  ATTENTION_MODES,
  INTENT_OBJECTIVE_MAX_LENGTH,
  INTENT_PROVENANCES,
  INTENT_SCOPES,
  isIso8601,
  isRecord,
  newPolicyId,
  previewValue,
  type IntentRecord,
  type RecommendationPolicy,
} from "@wfx/domain";
import type { Clock, IdGen } from "@wfx/experience";
import {
  PostgresIntentStore,
  PostgresRecommendationStateStore,
  PostgresRecommendationFeedbackStore,
  type DbClient,
  type PersistedFeedback,
} from "@wfx/persistence";

import {
  ITEM_TARGETED_FEEDBACK_KINDS,
  isRecommendationFeedbackKind,
  type RecommendationFeedbackKind,
} from "@wfx/recommendation";

// ---------------------------------------------------------------------------
// Wire shapes (structurally identical to the runtime's — the lane rule)
// ---------------------------------------------------------------------------

/** The intent command the runtime's `writeIntent` sends (the frozen shape). */
export interface UserIntentCommandWire {
  readonly objective: string;
  readonly scope: string;
  readonly weight?: number;
  readonly expiresAt?: string;
  readonly provenance?: string;
}

/** The policy command the runtime's `writePolicy` sends (the frozen shape). */
export interface RecommendationPolicyCommandWire {
  readonly attentionMode: string;
  readonly exploration?: number;
  readonly novelty?: number;
  readonly socialInfluence?: number;
}

/** The feedback command `POST /experience/feedback` accepts. */
export interface FeedbackCommandWire {
  readonly kind: string;
  readonly target: string;
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Validation (typed, every problem collected — the 400 channel's body)
// ---------------------------------------------------------------------------

/** The balanced-baseline dial defaults (first-write defaults, WFX-011). */
const DEFAULT_DIALS = { exploration: 0.2, novelty: 0.2, socialInfluence: 0.1 } as const;

/** Validate a policy command; returns EVERY problem (never one at a time). */
export function policyCommandProblems(
  command: RecommendationPolicyCommandWire,
): readonly string[] {
  const problems: string[] = [];
  if (
    typeof command?.attentionMode !== "string" ||
    !(ATTENTION_MODES as readonly string[]).includes(command.attentionMode)
  ) {
    problems.push(
      `attentionMode: expected one of ${ATTENTION_MODES.join(" | ")}, got ${previewValue(command?.attentionMode)}`,
    );
  }
  for (const dial of ["exploration", "novelty", "socialInfluence"] as const) {
    const value = command?.[dial];
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    ) {
      problems.push(
        `${dial}: expected a finite number in [0, 1] when present, got ${previewValue(value)}`,
      );
    }
  }
  return problems;
}

/** Validate an intent command against the R01 scope-truth law. */
export function intentCommandProblems(
  command: UserIntentCommandWire,
  nowEpochMs: number,
): readonly string[] {
  const problems: string[] = [];
  const objective = command?.objective;
  if (
    typeof objective !== "string" ||
    objective.trim().length === 0 ||
    objective.trim().length > INTENT_OBJECTIVE_MAX_LENGTH
  ) {
    problems.push(
      `objective: expected 1..${INTENT_OBJECTIVE_MAX_LENGTH} characters (after trim), got ${previewValue(objective)}`,
    );
  }
  if (typeof command?.scope !== "string" || !(INTENT_SCOPES as readonly string[]).includes(command.scope)) {
    problems.push(
      `scope: expected one of ${INTENT_SCOPES.join(" | ")}, got ${previewValue(command?.scope)}`,
    );
  }
  const weight = command?.weight;
  if (
    weight !== undefined &&
    (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0 || weight > 1)
  ) {
    problems.push(
      `weight: expected a finite number in (0, 1] when present, got ${previewValue(weight)}`,
    );
  }
  const provenance = command?.provenance;
  if (
    provenance !== undefined &&
    !(INTENT_PROVENANCES as readonly string[]).includes(provenance)
  ) {
    problems.push(
      `provenance: expected one of ${INTENT_PROVENANCES.join(" | ")} when present, got ${previewValue(provenance)}`,
    );
  }
  // SCOPE TRUTH: temporary REQUIRES a future ISO expiry (the R01 law).
  if (command?.scope === "temporary") {
    if (typeof command.expiresAt !== "string" || command.expiresAt.length === 0) {
      problems.push(
        "expiresAt: REQUIRED for scope 'temporary' (when the exploration window ends)",
      );
    } else if (!isIso8601(command.expiresAt)) {
      problems.push(
        `expiresAt: expected an ISO 8601 datetime, got ${previewValue(command.expiresAt)}`,
      );
    } else if (Date.parse(command.expiresAt) <= nowEpochMs) {
      problems.push(
        `expiresAt: expected a future timestamp, got ${previewValue(command.expiresAt)} (already past)`,
      );
    }
  } else if (
    command?.expiresAt !== undefined &&
    (typeof command.expiresAt !== "string" || !isIso8601(command.expiresAt))
  ) {
    problems.push(
      `expiresAt: expected an ISO 8601 datetime when present, got ${previewValue(command?.expiresAt)}`,
    );
  }
  return problems;
}

/** Validate a feedback command (the closed J15 vocabulary + per-kind target). */
export function feedbackCommandProblems(
  command: FeedbackCommandWire,
): readonly string[] {
  const problems: string[] = [];
  if (!isRecord(command)) {
    return [`body: expected { kind, target, note? }, got ${previewValue(command)}`];
  }
  if (!isRecommendationFeedbackKind(command.kind)) {
    problems.push(
      `kind: expected one of more-like-this | not-interested | dont-recommend-source | dont-recommend-creator | already-watched, got ${previewValue(command.kind)}`,
    );
  }
  const target = command.target;
  if (typeof target !== "string" || target.trim().length === 0 || target.length > 200) {
    problems.push(`target: expected 1..200 characters, got ${previewValue(target)}`);
  }
  if (
    command.note !== undefined &&
    (typeof command.note !== "string" || command.note.length > 500)
  ) {
    problems.push(
      `note: expected a string of at most 500 characters when present, got ${previewValue(command.note)}`,
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

/** Constructor dependencies (all injected). */
export interface ControlsHostOptions {
  readonly db: DbClient;
  readonly clock: Clock;
  readonly ids: IdGen;
}

/**
 * The R05 recommendation-controls host: policy + intents + feedback over the
 * profile-scoped persistence stores. Created once per service boot.
 */
export class RecommendationControlsHost {
  private readonly intents: PostgresIntentStore;
  private readonly state: PostgresRecommendationStateStore;
  private readonly feedback: PostgresRecommendationFeedbackStore;
  private readonly clock: Clock;
  private readonly ids: IdGen;

  constructor(options: ControlsHostOptions) {
    this.intents = new PostgresIntentStore({ db: options.db });
    this.state = new PostgresRecommendationStateStore({
      db: options.db,
      clock: options.clock,
      ids: options.ids,
    });
    this.feedback = new PostgresRecommendationFeedbackStore({
      db: options.db,
      clock: options.clock,
      ids: options.ids,
    });
    this.clock = options.clock;
    this.ids = options.ids;
  }

  /** The raw persistence stores (for the routes' edge cases + tests). */
  intentStore(): PostgresIntentStore {
    return this.intents;
  }

  stateStore(): PostgresRecommendationStateStore {
    return this.state;
  }

  feedbackStore(): PostgresRecommendationFeedbackStore {
    return this.feedback;
  }

  // — policy ——————————————————————————————————————————————————————————————

  /**
   * The profile's policy, or null when unset — the HONEST empty answer (a
   * first-read profile never sees a fabricated default-as-if-configured).
   */
  async readPolicy(profileId: string): Promise<RecommendationPolicy | null> {
    const loaded = await this.state.loadForProfile(profileId);
    return loaded.found ? loaded.state!.policy : null;
  }

  /**
   * Merge one validated policy command into the profile's stored policy:
   * stable id, preserved objectives (the command carries mode + dials only),
   * dials defaulting to the stored value, else the balanced baseline. The
   * opaque engine-state blob round-trips verbatim (this module never
   * interprets it). Returns the written policy.
   */
  async writePolicy(
    profileId: string,
    userId: string,
    command: RecommendationPolicyCommandWire,
  ): Promise<RecommendationPolicy> {
    const loaded = await this.state.loadForProfile(profileId);
    const existing = loaded.found ? loaded.state!.policy : null;
    const merged: RecommendationPolicy = {
      id: existing?.id ?? newPolicyId(),
      userId,
      objectives: existing?.objectives ?? [],
      exploration: command.exploration ?? existing?.exploration ?? DEFAULT_DIALS.exploration,
      novelty: command.novelty ?? existing?.novelty ?? DEFAULT_DIALS.novelty,
      socialInfluence:
        command.socialInfluence ?? existing?.socialInfluence ?? DEFAULT_DIALS.socialInfluence,
      attentionMode: command.attentionMode as RecommendationPolicy["attentionMode"],
    };
    const saved = await this.state.saveForProfile({
      userId,
      profileId,
      policy: merged,
      ...(loaded.found ? { state: loaded.state!.state } : {}),
    });
    return saved.policy;
  }

  // — intents —————————————————————————————————————————————————————————————

  /**
   * The profile's durable intent records with EXPIRED records filtered at
   * read time (the R01 live-expiry law, server-side): any record whose
   * `expiresAt` is at or before the injected now leaves the active set.
   */
  async readIntents(profileId: string): Promise<readonly IntentRecord[]> {
    const records = await this.intents.listForProfile(profileId);
    const now = this.clock.now();
    return records.filter((record) => {
      if (record.expiresAt === undefined) return true;
      const at = Date.parse(record.expiresAt);
      return !(Number.isFinite(at) && at <= now);
    });
  }

  /**
   * Write one intent: create or UPDATE-in-place (the one-objective-per-
   * scope law — the store's identity index keeps the canonical `wfxint_`
   * id stable across merges; every submission is evidence:
   * `evidenceCount` +1, `lastReinforcedAt`/`updatedAt` restamped; origin
   * provenance is never rewritten — the domain IntentGraph law).
   */
  async writeIntent(
    profileId: string,
    userId: string,
    command: UserIntentCommandWire,
  ): Promise<IntentRecord> {
    const nowIso = new Date(this.clock.now()).toISOString();
    const existing = (
      await this.intents.listForProfile(profileId)
    ).find(
      (record) => record.scope === command.scope && record.objective === command.objective.trim(),
    );
    // The R01 update law: a re-submission REPLACES weight/expiry, keeps the
    // canonical id, creation, and origin provenance, and counts as evidence.
    const expiresAt = command.expiresAt ?? existing?.expiresAt;
    const record: IntentRecord = {
      id: (existing?.id ?? ("wfxint_" + this.ids.next())) as IntentRecord["id"],
      userId,
      scope: command.scope as IntentRecord["scope"],
      objective: command.objective.trim(),
      weight: command.weight ?? existing?.weight ?? 1, // R01: explicit weight defaults 1
      confidence: existing?.confidence ?? 1, // explicit submission is certain
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      // Origin provenance is never rewritten (the domain IntentGraph law);
      // a first submission defaults to "explicit" (the R01 wire default).
      provenance:
        existing?.provenance ??
        ((command.provenance ?? "explicit") as IntentRecord["provenance"]),
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
      lastReinforcedAt: nowIso,
      evidenceCount: (existing?.evidenceCount ?? 0) + 1,
    };
    return this.intents.upsertIntentForProfile(record, profileId);
  }

  /**
   * REVERSIBILITY: delete one intent owned by this profile. Returns the
   * deleted record (for the honest answer), or null when unknown/not owned.
   */
  async deleteIntent(
    profileId: string,
    intentId: string,
  ): Promise<IntentRecord | null> {
    const existing = await this.intents.getIntent(intentId);
    if (existing === null) return null;
    // Ownership: the record must live under this effective profile.
    const owned = (
      await this.intents.listForProfile(profileId)
    ).some((record) => record.id === intentId);
    if (!owned) return null;
    await this.intents.deleteIntent(intentId);
    return existing;
  }

  // — feedback ————————————————————————————————————————————————————————————

  /** Record one feedback control (idempotent per (profile, kind, target)). */
  async addFeedback(
    profileId: string,
    userId: string,
    command: { kind: RecommendationFeedbackKind; target: string; note?: string },
  ): Promise<PersistedFeedback> {
    return this.feedback.addForProfile(
      { userId, kind: command.kind, target: command.target, ...(command.note !== undefined ? { note: command.note } : {}) },
      profileId,
    );
  }

  /** The profile's feedback controls, oldest first. */
  async listFeedback(profileId: string): Promise<readonly PersistedFeedback[]> {
    return this.feedback.listForProfile(profileId);
  }

  /**
   * REVERSIBILITY: delete one feedback control (a REAL delete). Returns the
   * deleted record, or null when unknown/not owned by this profile.
   */
  async deleteFeedback(profileId: string, id: string): Promise<PersistedFeedback | null> {
    const existing = await this.feedback.getForProfile(profileId, id);
    if (existing === null) return null;
    await this.feedback.deleteForProfile(profileId, id);
    return existing;
  }
}

/** The item-targeted kinds (exported for the routes' target validation). */
export { ITEM_TARGETED_FEEDBACK_KINDS };
