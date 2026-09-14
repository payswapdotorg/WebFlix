/**
 * @wfx/experience — library command planning (WFX-029, Lane C).
 *
 * `planLibraryCommand(intent)` is the OPTIMISTIC UI MODEL of a library
 * command: a TYPED PLAN for save / remove / move-to-list intents —
 *
 * - WHICH WFX-005 use-case to call (`saveToLibrary` / `removeFromLibrary`
 *   with the exact typed input) and the frozen `LibraryCommand` that will
 *   reach `writeLibrary`;
 * - WHICH WFX-022 outbox entry will result, with an IDEMPOTENCY KEY PREVIEW
 *   that exactly mirrors the published `idempotencyKeyFor` algorithm
 *   (packages/actions/src/sync/outbox.ts: a deterministic 128-bit FNV-1a
 *   digest over [userId, connectorId, action verb, externalRef,
 *   clientRequestToken]). The mirror exists because @wfx/actions is not a
 *   dependency of this package (the dispatch forbids dependency edits) —
 *   it is a PREVIEW, not the authority: the real outbox mints the key.
 * - The OPTIMISTIC local state transition (a DESCRIPTION ONLY — nothing is
 *   mutated here; the host applies it to its own view state);
 * - The ROLLBACK PLAN for every WFX-022 outbox status the mirrored record
 *   can settle in: hold (pending / in-flight), commit (delivered), or a
 *   typed revert with explicit suggestions (failed / unsupported /
 *   conflict). No auto-resolution: suggestions are descriptions of the
 *   user's options, never actions this model performs.
 *
 * Library-mirror encoding (lead-visible decision, documented): the frozen
 * `UserAction` union has no unsave verb, so a library remove mirrors into
 * the outbox as action verb `"save"` with the frozen `LibraryCommand`
 * (op `"remove"`) in the payload — the encoding WFX-022's closed vocabulary
 * admits. Distinct intents therefore REQUIRE distinct `clientRequestToken`s:
 * an add and a remove of the same ref with the SAME token would produce the
 * SAME idempotency key (the outbox answers a typed content conflict, never
 * a silent overwrite — that is WFX-022's own law, restated here).
 *
 * "move-to-list" plans ONE upsert-style `add` command whose metadata carries
 * the target list (the view's `metadata.list` convention) rather than a
 * remove+add pair: a pair has a window in which the item is unsaved at the
 * source (remove delivered, add failed ⇒ data loss), while the single
 * upsert has none. Sources that cannot update entry metadata will surface
 * that honestly in their receipt.
 *
 * Error channel: invalid caller input (unknown kind, blank identity fields,
 * malformed metadata) throws the typed `ExperienceError` (the package's
 * caller-misuse channel). No network, no persistence, no randomness.
 */

import type { LibraryCommand, UserAction } from "@wfx/domain";
import { isRecord, previewValue } from "@wfx/domain";

import { ExperienceError } from "../ports";
import type { RemoveFromLibraryInput, SaveToLibraryInput } from "../use-cases/library";
import type { LibraryOutboxStatus } from "./model";
import { DEFAULT_LIST_NAME } from "./model";

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

/** The intent kinds the planner supports. */
export type LibraryIntentKind = "save" | "remove" | "move-to-list";

/** Shared identity/context fields of every library intent. */
interface IntentBase {
  userId: string;
  connectorId: string;
  externalRef: string;
  locale: string;
  region?: string;
  /** Fresh per-intent token — the idempotency-key discriminator. */
  clientRequestToken: string;
}

/** Save an item to a connector library (optionally into a named list). */
export interface SaveLibraryIntent extends IntentBase {
  kind: "save";
  title?: string;
  metadata?: Record<string, unknown>;
  /** Target user list (view convention: `metadata.list`). */
  listName?: string;
}

/** Remove an item from a connector library. */
export interface RemoveLibraryIntent extends IntentBase {
  kind: "remove";
}

/** Move a saved item to another user list (one upsert-style add command). */
export interface MoveToListLibraryIntent extends IntentBase {
  kind: "move-to-list";
  /** The list to move INTO (required, non-blank). */
  toList: string;
  /** The list the row is expected to move FROM (rollback reference). */
  fromList?: string;
  title?: string;
}

/** Every library intent. */
export type LibraryIntent = SaveLibraryIntent | RemoveLibraryIntent | MoveToListLibraryIntent;

// ---------------------------------------------------------------------------
// Plan types
// ---------------------------------------------------------------------------

/**
 * Which WFX-005 use-case to call, with the exact input it takes and the
 * frozen `LibraryCommand` that will reach `writeLibrary` (derived from the
 * intent; see the module doc for the move-to-list upsert decision).
 */
export interface UseCaseCallPlan {
  useCase: "saveToLibrary" | "removeFromLibrary";
  input: SaveToLibraryInput | RemoveFromLibraryInput;
  command: LibraryCommand;
}

/**
 * The WFX-022 outbox entry preview: the entry identity the mirror will
 * carry, the idempotency-key preview (exact algorithm mirror), and the
 * predicted record id (`"wfxout_" + key` — WFX-022's deterministic scheme).
 */
export interface OutboxEntryPreview {
  entry: {
    userId: string;
    connectorId: string;
    action: UserAction["type"];
    externalRef: string;
    clientRequestToken: string;
    locale: string;
    region?: string;
    payload?: Record<string, unknown>;
  };
  idempotencyKey: string;
  recordId: string;
}

/**
 * The optimistic local state transition — a DESCRIPTION ONLY (the packet's
 * "no mutation here" law). The host applies it to its own view state:
 *
 * - `show-saved`   — the row appears under `listName` with a pending badge.
 * - `hide-saved`   — the row is hidden wherever it appears.
 * - `restore-saved`— a previously hidden row is restored where it was.
 * - `move-list`    — the row moves from `fromList` (when known) to `toList`.
 */
export type OptimisticEffect =
  | { kind: "show-saved"; connectorId: string; externalRef: string; listName: string }
  | { kind: "hide-saved"; connectorId: string; externalRef: string }
  | { kind: "restore-saved"; connectorId: string; externalRef: string }
  | {
      kind: "move-list";
      connectorId: string;
      externalRef: string;
      fromList?: string;
      toList: string;
    };

/** One explicit next-step suggestion — NEVER auto-applied by this model. */
export interface RollbackSuggestion {
  action: "retry" | "keep-local" | "dismiss" | "inspect";
  label: string;
  detail: string;
}

/**
 * The typed outcome for one WFX-022 outbox status:
 * - `hold`   — pending / in-flight: the optimistic state persists.
 * - `commit` — delivered: the optimistic state becomes permanent.
 * - `revert` — a terminal bad state: apply the inverse effect (when given)
 *              and surface the typed consequence + suggestions.
 */
export interface OutboxOutcomePlan {
  action: "hold" | "commit" | "revert";
  /** Present iff `action === "revert"`: the inverse optimistic effect. */
  revert?: OptimisticEffect;
  /** Deterministic, human-readable consequence (a11y-ready). */
  consequence: string;
  suggestions: readonly RollbackSuggestion[];
}

/** The rollback plan: one typed outcome for EVERY mirrored outbox status. */
export type RollbackPlan = Readonly<Record<LibraryOutboxStatus, OutboxOutcomePlan>>;

/** The full plan `planLibraryCommand` returns. */
export interface LibraryCommandPlan {
  intent: LibraryIntent;
  useCase: UseCaseCallPlan;
  outbox: OutboxEntryPreview;
  optimistic: OptimisticEffect;
  rollback: RollbackPlan;
}

// ---------------------------------------------------------------------------
// The idempotency-key preview (exact WFX-022 algorithm mirror)
// ---------------------------------------------------------------------------

/** One round of 32-bit FNV-1a over `input`, seeded with `seed`. */
function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 128-bit deterministic hex digest of `key` (4 seeded FNV-1a rounds). */
function digestHex(key: string): string {
  let hex = "";
  for (let round = 0; round < 4; round += 1) {
    const hash = fnv1a32(`wfx-sync-v1:${round}:${key}`, 0x811c9dc5);
    hex += hash.toString(16).padStart(8, "0");
  }
  return hex;
}

/**
 * The idempotency-key PREVIEW: an exact mirror of WFX-022's published
 * `idempotencyKeyFor` (a deterministic hash over userId, connectorId, action
 * verb, externalRef, clientRequestToken). Same identity ⇒ same key;
 * different tokens ⇒ different keys. The real outbox remains the authority
 * — if WFX-022 ever changes its digest, this preview (and only it) drifts.
 */
export function previewIdempotencyKey(identity: {
  userId: string;
  connectorId: string;
  action: UserAction["type"];
  externalRef: string;
  clientRequestToken: string;
}): string {
  const canonical = JSON.stringify([
    identity.userId,
    identity.connectorId,
    identity.action,
    identity.externalRef,
    identity.clientRequestToken,
  ]);
  return digestHex(canonical);
}

// ---------------------------------------------------------------------------
// Input validation (caller misuse — typed throw)
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertValidIntentBase(intent: Record<string, unknown>, kind: string): void {
  const problems: string[] = [];
  if (!isNonEmptyString(intent.userId)) {
    problems.push(`intent.userId: expected a non-empty string, got ${previewValue(intent.userId)}`);
  }
  if (!isNonEmptyString(intent.connectorId)) {
    problems.push(
      `intent.connectorId: expected a non-empty string, got ${previewValue(intent.connectorId)}`,
    );
  }
  if (!isNonEmptyString(intent.externalRef)) {
    problems.push(
      `intent.externalRef: expected a non-empty string (after trim), got ${previewValue(intent.externalRef)}`,
    );
  }
  if (!isNonEmptyString(intent.locale)) {
    problems.push(`intent.locale: expected a non-empty string, got ${previewValue(intent.locale)}`);
  }
  if (intent.region !== undefined && typeof intent.region !== "string") {
    problems.push(
      `intent.region: expected a string when present, got ${previewValue(intent.region)}`,
    );
  }
  if (!isNonEmptyString(intent.clientRequestToken)) {
    problems.push(
      `intent.clientRequestToken: expected a non-empty string, got ${previewValue(intent.clientRequestToken)}`,
    );
  }
  if (problems.length > 0) throw new ExperienceError(problems.map((p) => `${p} (${kind})`));
}

function assertValidIntent(intent: LibraryIntent): void {
  if (!isRecord(intent)) {
    throw new ExperienceError("intent: expected a LibraryIntent object");
  }
  const kind = intent.kind;
  if (kind !== "save" && kind !== "remove" && kind !== "move-to-list") {
    throw new ExperienceError(
      `intent.kind: expected one of save | remove | move-to-list, got ${previewValue(kind)}`,
    );
  }
  assertValidIntentBase(intent, kind);
  const problems: string[] = [];
  if (kind === "save" || kind === "move-to-list") {
    if (intent.title !== undefined && typeof intent.title !== "string") {
      problems.push(`intent.title: expected a string when present, got ${previewValue(intent.title)}`);
    }
    if (intent.metadata !== undefined && !isRecord(intent.metadata)) {
      problems.push(
        `intent.metadata: expected an object when present, got ${previewValue(intent.metadata)}`,
      );
    }
    if (kind === "save" && intent.listName !== undefined && !isNonEmptyString(intent.listName)) {
      problems.push(
        `intent.listName: expected a non-empty string when present, got ${previewValue(intent.listName)}`,
      );
    }
    if (kind === "move-to-list") {
      if (!isNonEmptyString(intent.toList)) {
        problems.push(
          `intent.toList: expected a non-empty string, got ${previewValue(intent.toList)}`,
        );
      }
      if (intent.fromList !== undefined && !isNonEmptyString(intent.fromList)) {
        problems.push(
          `intent.fromList: expected a non-empty string when present, got ${previewValue(intent.fromList)}`,
        );
      }
    }
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

// ---------------------------------------------------------------------------
// Rollback plan construction (per intent kind)
// ---------------------------------------------------------------------------

const RETRY_SUGGESTION: RollbackSuggestion = {
  action: "retry",
  label: "Try again",
  detail: "Re-plan the command with a fresh client request token (a new idempotency key).",
};

const KEEP_LOCAL_SUGGESTION: RollbackSuggestion = {
  action: "keep-local",
  label: "Keep locally",
  detail: "Keep the row in the local view without source sync (an explicit user choice).",
};

const DISMISS_SUGGESTION: RollbackSuggestion = {
  action: "dismiss",
  label: "Dismiss",
  detail: "Drop the optimistic change and leave the library as it is.",
};

const INSPECT_SUGGESTION: RollbackSuggestion = {
  action: "inspect",
  label: "Inspect the source answer",
  detail: "Inspect the outbox record's stored cause/receipt before deciding anything.",
};

function rollbackPlan(intent: LibraryIntent, revert: OptimisticEffect): RollbackPlan {
  const isSave = intent.kind === "save" || intent.kind === "move-to-list";
  const noun = intent.kind === "move-to-list" ? "move" : intent.kind === "save" ? "save" : "removal";

  const failedConsequence = isSave
    ? `The optimistic ${noun} is reverted (the row leaves the view) and the typed failure is surfaced.`
    : `The optimistic removal is reverted (the row is restored) and the typed failure is surfaced.`;
  const unsupportedConsequence = isSave
    ? `The source cannot perform this ${noun} (typed unsupported — never retried); the optimistic change is reverted and the answer surfaced.`
    : `The source cannot perform this removal (typed unsupported — never retried); the row is restored and the answer surfaced.`;
  const conflictConsequence = isSave
    ? `The source recorded the ${noun} without external confirmation (local-only receipt); the optimistic change is reverted and a typed conflict is surfaced.`
    : `The source recorded the removal without external confirmation (local-only receipt); the row is restored and a typed conflict is surfaced.`;

  const failedSuggestions: RollbackSuggestion[] = isSave
    ? [RETRY_SUGGESTION, KEEP_LOCAL_SUGGESTION]
    : [RETRY_SUGGESTION, INSPECT_SUGGESTION];
  const unsupportedSuggestions: RollbackSuggestion[] = isSave
    ? [INSPECT_SUGGESTION, KEEP_LOCAL_SUGGESTION]
    : [INSPECT_SUGGESTION];
  const conflictSuggestions: RollbackSuggestion[] = [
    RETRY_SUGGESTION,
    DISMISS_SUGGESTION,
    INSPECT_SUGGESTION,
  ];

  return {
    pending: {
      action: "hold",
      consequence: `The ${noun} is recorded locally and awaits delivery; the optimistic view state persists.`,
      suggestions: [],
    },
    "in-flight": {
      action: "hold",
      consequence: `A dispatch attempt for the ${noun} is executing; the optimistic view state persists.`,
      suggestions: [],
    },
    delivered: {
      action: "commit",
      consequence: `The source confirmed the ${noun}; the optimistic view state becomes permanent.`,
      suggestions: [],
    },
    failed: {
      action: "revert",
      revert,
      consequence: failedConsequence,
      suggestions: failedSuggestions,
    },
    unsupported: {
      action: "revert",
      revert,
      consequence: unsupportedConsequence,
      suggestions: unsupportedSuggestions,
    },
    conflict: {
      action: "revert",
      revert,
      consequence: conflictConsequence,
      suggestions: conflictSuggestions,
    },
  };
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

/**
 * Plan a library command (see the module doc). PURE: constructs the typed
 * plan only — no use-case call, no outbox enqueue, no view mutation.
 */
export function planLibraryCommand(intent: LibraryIntent): LibraryCommandPlan {
  assertValidIntent(intent);

  const trimmedRef = intent.externalRef.trim();
  const useCase: UseCaseCallPlan = { useCase: "saveToLibrary", input: { externalRef: trimmedRef }, command: { op: "add", externalRef: trimmedRef } };
  let optimistic: OptimisticEffect;
  let revert: OptimisticEffect;

  if (intent.kind === "remove") {
    useCase.useCase = "removeFromLibrary";
    useCase.input = { externalRef: trimmedRef };
    useCase.command = { op: "remove", externalRef: trimmedRef };
    optimistic = { kind: "hide-saved", connectorId: intent.connectorId, externalRef: trimmedRef };
    revert = { kind: "restore-saved", connectorId: intent.connectorId, externalRef: trimmedRef };
  } else {
    // save and move-to-list both plan ONE upsert-style add command.
    const command: LibraryCommand = { op: "add", externalRef: trimmedRef };
    const input: SaveToLibraryInput = { externalRef: trimmedRef };
    const metadata: Record<string, unknown> =
      intent.kind === "save" ? { ...(intent.metadata ?? {}) } : {};
    const targetList =
      intent.kind === "move-to-list" ? intent.toList : intent.listName ?? DEFAULT_LIST_NAME;
    metadata.list = targetList;

    if (intent.title !== undefined) command.title = intent.title;
    command.metadata = metadata;
    input.metadata = metadata;
    if (intent.title !== undefined) input.title = intent.title;

    useCase.useCase = "saveToLibrary";
    useCase.input = input;
    useCase.command = command;

    if (intent.kind === "move-to-list") {
      optimistic = {
        kind: "move-list",
        connectorId: intent.connectorId,
        externalRef: trimmedRef,
        ...(intent.fromList !== undefined ? { fromList: intent.fromList } : {}),
        toList: intent.toList,
      };
      revert = {
        kind: "move-list",
        connectorId: intent.connectorId,
        externalRef: trimmedRef,
        fromList: intent.toList,
        toList: intent.fromList ?? DEFAULT_LIST_NAME,
      };
    } else {
      optimistic = {
        kind: "show-saved",
        connectorId: intent.connectorId,
        externalRef: trimmedRef,
        listName: targetList,
      };
      revert = { kind: "hide-saved", connectorId: intent.connectorId, externalRef: trimmedRef };
    }
  }

  const idempotencyKey = previewIdempotencyKey({
    userId: intent.userId,
    connectorId: intent.connectorId,
    // Library writes mirror as verb "save" (the frozen UserAction union has
    // no unsave verb — see the module doc; the payload disambiguates).
    action: "save",
    externalRef: trimmedRef,
    clientRequestToken: intent.clientRequestToken,
  });

  const outbox: OutboxEntryPreview = {
    entry: {
      userId: intent.userId,
      connectorId: intent.connectorId,
      action: "save",
      externalRef: trimmedRef,
      clientRequestToken: intent.clientRequestToken,
      locale: intent.locale,
      ...(intent.region !== undefined ? { region: intent.region } : {}),
      payload: { libraryCommand: useCase.command },
    },
    idempotencyKey,
    recordId: `wfxout_${idempotencyKey}`,
  };

  return {
    // The caller's intent echoed verbatim (reference, never mutated); the
    // use-case input/command carry the trimmed externalRef, exactly like
    // WFX-005's saveToLibrary/removeFromLibrary do internally.
    intent,
    useCase,
    outbox,
    optimistic,
    rollback: rollbackPlan(intent, revert),
  };
}
