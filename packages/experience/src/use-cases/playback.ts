/**
 * @wfx/experience — playback session use-case (WFX-005, Lane C).
 *
 * `startPlayback` resolves realizations for an item THROUGH THE PORT and
 * picks one per the frozen Media Surface precedence order
 * (Native → Embed → Browser → External). The full resolver — device
 * capability checks via `canPlay`, expiry, quality — is WFX-025; this shell
 * only needs to accept a caller-chosen `PlaybackRealization` (e.g. from a
 * feed card, or later from WFX-025) or a simple port-provided list.
 *
 * Every session is a frozen `PlaybackSession` with `resumePositionMs`
 * 0 or the caller-supplied resume position, stored in a PURE in-memory
 * `PlaybackSessionStore` keyed by session id. `reportProgress` /
 * `reportComplete` / `reportSkip` mirror playback into that store (resume
 * position updates) and emit the matching frozen `EntertainmentEvent`s
 * (validated with the WFX-002 `validateEntertainmentEvent` before they reach
 * the EventSink). Playback events carry `playbackSessionId` (and
 * `positionMs` for progress) in the event payload for correlation.
 *
 * Wiring: `startPlayback` accepts an optional trailing `sessions` store and
 * the report functions require one — reports are meaningless without the
 * map they update. The `createExperienceApi` facade binds a single store so
 * plain facade callers never think about it.
 *
 * Event `sessionId` policy: events are stamped with the ExperienceContext
 * session (the EventSink contract — "sessionId handled by caller or a
 * wrapper"); the playback session identity rides in the payload.
 */

import type {
  Capability,
  PlaybackMode,
  PlaybackRealization,
  PlaybackSession,
} from "@wfx/domain";
import {
  PLAYBACK_SESSION_ID_PREFIX,
  isEntertainmentItemId,
  isRecord,
  isSourceRealizationId,
  previewValue,
  validatePlaybackRealization,
} from "@wfx/domain";

import {
  ExperienceError,
  assertValidExperienceContext,
  connectorHas,
  describeThrown,
  type ExperienceContext,
  type ExperienceResult,
  type Ports,
} from "../ports";
import { composeExperienceEvent, type ExperienceEventSpec } from "./events";

// ---------------------------------------------------------------------------
// Realization picking (frozen precedence; full resolution is WFX-025)
// ---------------------------------------------------------------------------

/** The frozen Media Surface precedence order. */
export const PLAYBACK_MODE_PRECEDENCE: readonly PlaybackMode[] = [
  "native",
  "embed",
  "browser",
  "external",
];

/** Capabilities that can produce a playback realization (any one suffices). */
const PLAY_CAPABILITIES: readonly Capability[] = [
  "playNative",
  "playEmbed",
  "playBrowser",
  "playExternal",
];

/**
 * Pick the best realization from a port-provided list by the frozen
 * precedence order. Realizations that fail the WFX-002 shape validator are
 * ignored — a broken realization is never adopted, never repaired.
 */
export function pickRealizationByPrecedence(
  candidates: readonly PlaybackRealization[],
): PlaybackRealization | null {
  const valid = candidates.filter((candidate) => validatePlaybackRealization(candidate).ok);
  for (const mode of PLAYBACK_MODE_PRECEDENCE) {
    const match = valid.find((candidate) => candidate.mode === mode);
    if (match !== undefined) return match;
  }
  return null;
}

// ---------------------------------------------------------------------------
// PlaybackSessionStore — the pure in-memory session map
// ---------------------------------------------------------------------------

/**
 * The in-memory `PlaybackSession` map keyed by session id. Pure bookkeeping:
 * no clock, no ids, no sink — `updateResume` returns a NEW session object
 * (sessions are treated as immutable values).
 */
export class PlaybackSessionStore {
  private readonly sessions = new Map<string, PlaybackSession>();

  constructor(initial: readonly PlaybackSession[] = []) {
    for (const session of initial) {
      this.sessions.set(session.id, session);
    }
  }

  put(session: PlaybackSession): void {
    this.sessions.set(session.id, session);
  }

  get(id: string): PlaybackSession | undefined {
    return this.sessions.get(id);
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  get size(): number {
    return this.sessions.size;
  }

  list(): PlaybackSession[] {
    return [...this.sessions.values()];
  }

  remove(id: string): boolean {
    return this.sessions.delete(id);
  }

  /** Set the resume position; returns the updated session, or null when the id is unknown. */
  updateResume(id: string, resumePositionMs: number): PlaybackSession | null {
    const existing = this.sessions.get(id);
    if (existing === undefined) return null;
    const updated: PlaybackSession = { ...existing, resumePositionMs };
    this.sessions.set(id, updated);
    return updated;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Playback intent: what to play and where to resume. Either a chosen
 * `realization` (caller/WFX-025) or an `externalRef` the port can resolve —
 * when a realization is chosen, no port resolution happens.
 */
export interface PlaybackIntent {
  /** Canonical entertainment-item ID (`wfxitm_...`) of the item to play. */
  itemId: string;
  /** External reference on the connector; required when no realization is chosen. */
  externalRef?: string;
  /** A chosen playback realization (skips port resolution). */
  realization?: PlaybackRealization;
  /** Canonical source-realization ID (`wfxsrc_...`) for event correlation. */
  sourceRealizationId?: string;
  /** Resume position in milliseconds (>= 0); defaults to 0 (start). */
  resumePositionMs?: number;
}

/**
 * A playback report: which session, and (for progress) the current
 * position. `positionMs` is REQUIRED for progress reports and OPTIONAL for
 * complete/skip reports (a completed/skipped session keeps its last reported
 * resume position unless the caller knows the final position).
 */
export interface PlaybackReport {
  /** The playback session id (from the started session). */
  sessionId: string;
  positionMs?: number;
}

// ---------------------------------------------------------------------------
// Input validation (caller misuse — typed throw)
// ---------------------------------------------------------------------------

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function assertValidPlaybackIntent(intent: PlaybackIntent): void {
  if (!isRecord(intent)) {
    throw new ExperienceError("intent: expected a PlaybackIntent object");
  }
  const problems: string[] = [];
  if (!isEntertainmentItemId(intent.itemId)) {
    problems.push(
      `intent.itemId: expected a canonical entertainment-item ID (wfxitm_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(intent.itemId)}`,
    );
  }
  if (
    intent.externalRef !== undefined &&
    (typeof intent.externalRef !== "string" || intent.externalRef.trim().length === 0)
  ) {
    problems.push(
      `intent.externalRef: expected a non-empty string when present, got ${previewValue(intent.externalRef)}`,
    );
  }
  if (intent.resumePositionMs !== undefined && !isNonNegativeFinite(intent.resumePositionMs)) {
    problems.push(
      `intent.resumePositionMs: expected a finite non-negative number when present, got ${previewValue(intent.resumePositionMs)}`,
    );
  }
  if (
    intent.sourceRealizationId !== undefined &&
    !isSourceRealizationId(intent.sourceRealizationId)
  ) {
    problems.push(
      `intent.sourceRealizationId: expected a canonical source-realization ID (wfxsrc_ prefix + 26-char Crockford Base32 ULID body) when present, got ${previewValue(intent.sourceRealizationId)}`,
    );
  }
  if (intent.realization !== undefined) {
    const checked = validatePlaybackRealization(intent.realization);
    if (!checked.ok) {
      problems.push(...checked.errors.map((message) => `intent.realization: ${message}`));
    }
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

function assertValidPlaybackReport(report: PlaybackReport, requirePosition: boolean): void {
  if (!isRecord(report)) {
    throw new ExperienceError("report: expected a PlaybackReport object");
  }
  const problems: string[] = [];
  if (typeof report.sessionId !== "string" || report.sessionId.length === 0) {
    problems.push(
      `report.sessionId: expected a non-empty string, got ${previewValue(report.sessionId)}`,
    );
  }
  const positionInvalid =
    typeof report.positionMs !== "number" || !Number.isFinite(report.positionMs) || report.positionMs < 0;
  if (requirePosition && (report.positionMs === undefined || positionInvalid)) {
    problems.push(
      `report.positionMs: required for progress reports — expected a finite non-negative number, got ${previewValue(report.positionMs)}`,
    );
  } else if (!requirePosition && report.positionMs !== undefined && positionInvalid) {
    problems.push(
      `report.positionMs: expected a finite non-negative number when present, got ${previewValue(report.positionMs)}`,
    );
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

// ---------------------------------------------------------------------------
// startPlayback
// ---------------------------------------------------------------------------

/**
 * Start playback for one item: resolve realizations via the port (or accept
 * a chosen one), construct a frozen `PlaybackSession` (resume position 0 or
 * the supplied `resumePositionMs`), store it in `sessions` (a fresh store
 * when omitted — one-shot sessions work standalone), and emit the frozen
 * `"start"` event through the EventSink.
 *
 * Failure modes (typed, never fake):
 * - `unsupported` — the connector declares no play capability at all (the
 *   SDK's resolve gating map mirrored here).
 * - `unresolvable` — the port resolved no valid realization for the ref.
 * - `port-failed` — the port rejected during resolution.
 * A sink that throws/rejects propagates to the caller (a lost start event
 * is never a silent success).
 */
export async function startPlayback(
  ports: Ports,
  ctx: ExperienceContext,
  intent: PlaybackIntent,
  sessions?: PlaybackSessionStore,
): Promise<ExperienceResult<PlaybackSession>> {
  assertValidExperienceContext(ctx);
  assertValidPlaybackIntent(intent);

  let realization: PlaybackRealization;
  if (intent.realization !== undefined) {
    // Caller-chosen realization (feed card / WFX-025 handoff). Shape-validated
    // in assertValidPlaybackIntent; full resolution stays WFX-025's scope.
    realization = intent.realization;
  } else {
    const ref = intent.externalRef;
    if (ref === undefined || ref.trim().length === 0) {
      throw new ExperienceError(
        "intent.externalRef: required when no realization is chosen (nothing to resolve)",
      );
    }
    if (!PLAY_CAPABILITIES.some((capability) => connectorHas(ports.connector, capability))) {
      return {
        ok: false,
        reason: "unsupported",
        capability: "playNative",
        detail: `connector '${ports.connector.descriptor().id}' declares none of ${PLAY_CAPABILITIES.join(" | ")}`,
      };
    }
    let candidates: PlaybackRealization[];
    try {
      candidates = await ports.connector.resolve(ctx, ref);
    } catch (thrown) {
      return {
        ok: false,
        reason: "port-failed",
        operation: "resolve",
        detail: describeThrown(thrown),
      };
    }
    if (!Array.isArray(candidates)) {
      return {
        ok: false,
        reason: "unresolvable",
        detail: `connector '${ports.connector.descriptor().id}' resolved ${previewValue(candidates)} for '${ref}' (expected an array of PlaybackRealization)`,
      };
    }
    const picked = pickRealizationByPrecedence(candidates);
    if (picked === null) {
      return {
        ok: false,
        reason: "unresolvable",
        detail: `no valid PlaybackRealization for '${ref}' on connector '${ports.connector.descriptor().id}'`,
      };
    }
    realization = picked;
  }

  const sessionId = PLAYBACK_SESSION_ID_PREFIX + ports.ids.next();
  const session: PlaybackSession = {
    id: sessionId,
    userId: ctx.userId,
    itemId: intent.itemId,
    realization,
    resumePositionMs: intent.resumePositionMs ?? 0,
    createdAt: new Date(ports.clock.now()).toISOString(),
  };
  (sessions ?? new PlaybackSessionStore()).put(session);

  const startSpec: ExperienceEventSpec = {
    itemId: intent.itemId,
    type: "start",
    payload: { playbackSessionId: session.id },
  };
  if (intent.sourceRealizationId !== undefined) {
    startSpec.sourceRealizationId = intent.sourceRealizationId;
  }
  await ports.events.emit(composeExperienceEvent(ports.clock, ctx, startSpec));
  return { ok: true, value: session };
}

// ---------------------------------------------------------------------------
// reportProgress / reportComplete / reportSkip
// ---------------------------------------------------------------------------

async function reportPlaybackEvent(
  ports: Ports,
  ctx: ExperienceContext,
  report: PlaybackReport,
  sessions: PlaybackSessionStore,
  kind: { type: "progress" | "complete" | "skip"; requirePosition: boolean },
): Promise<ExperienceResult<PlaybackSession>> {
  assertValidExperienceContext(ctx);
  assertValidPlaybackReport(report, kind.requirePosition);

  const existing = sessions.get(report.sessionId);
  if (existing === undefined) {
    return {
      ok: false,
      reason: "not-found",
      detail: `no playback session '${report.sessionId}' in this store`,
    };
  }

  let session = existing;
  if (report.positionMs !== undefined) {
    const updated = sessions.updateResume(report.sessionId, report.positionMs);
    if (updated === null) {
      // Defensive: unreachable in single-threaded callers between get and update.
      return {
        ok: false,
        reason: "not-found",
        detail: `playback session '${report.sessionId}' disappeared during the update`,
      };
    }
    session = updated;
  }

  const payload: Record<string, unknown> = { playbackSessionId: session.id };
  if (report.positionMs !== undefined) payload.positionMs = report.positionMs;

  await ports.events.emit(
    composeExperienceEvent(ports.clock, ctx, {
      itemId: session.itemId,
      type: kind.type,
      payload,
    }),
  );
  return { ok: true, value: session };
}

/**
 * Report playback progress: update the session's `resumePositionMs` to the
 * reported position and emit the frozen `"progress"` event. `positionMs` is
 * required. Unknown session ids are typed `not-found` results.
 */
export async function reportProgress(
  ports: Ports,
  ctx: ExperienceContext,
  report: PlaybackReport,
  sessions: PlaybackSessionStore,
): Promise<ExperienceResult<PlaybackSession>> {
  return reportPlaybackEvent(ports, ctx, report, sessions, { type: "progress", requirePosition: true });
}

/**
 * Report playback completion: optionally update the resume position (when the
 * caller knows the final position) and emit the frozen `"complete"` event.
 * The session stays in the store (its final state remains readable).
 */
export async function reportComplete(
  ports: Ports,
  ctx: ExperienceContext,
  report: PlaybackReport,
  sessions: PlaybackSessionStore,
): Promise<ExperienceResult<PlaybackSession>> {
  return reportPlaybackEvent(ports, ctx, report, sessions, { type: "complete", requirePosition: false });
}

/** Report a skip: like complete, with the frozen `"skip"` event. */
export async function reportSkip(
  ports: Ports,
  ctx: ExperienceContext,
  report: PlaybackReport,
  sessions: PlaybackSessionStore,
): Promise<ExperienceResult<PlaybackSession>> {
  return reportPlaybackEvent(ports, ctx, report, sessions, { type: "skip", requirePosition: false });
}
