/**
 * @wfx/client-runtime — session watch state (R01).
 *
 * The runtime's session watch-state semantics: position, completed-ness,
 * and labels per item, folded from watch-state events with the SAME LAWS as
 * the existing watch-history fold (`@wfx/experience` WFX-029), adapted to
 * the runtime's at-least-once delivery reality:
 *
 * 1. CHRONOLOGICAL LAST-WRITER-WINS — per item, `start`/`progress` set
 *    `"in-progress"`, `complete` sets `"completed"`, `skip` sets
 *    `"skipped"`; position comes from the event payload
 *    (`payload.positionMs`) — the same event vocabulary and fold order the
 *    WFX-029 fold uses (`occurredAt` epoch, input-index tie-break).
 * 2. AT-LEAST-ONCE REDELIVERY TOLERANCE — the runtime mints one canonical
 *    event identity per logical watch event and applies each EXACTLY ONCE
 *    locally (a redelivered/retried event is idempotent); the SERVER-side
 *    fold tolerates duplicates by chronology (documented; the pure fold
 *    test proves duplicate input yields the same state).
 * 3. STALENESS LAW (monotone-in-time position) — an event whose evidence
 *    (`occurredAt` epoch + local sequence) is OLDER than the last applied
 *    evidence for the item is DROPPED: a late redelivery or an
 *    out-of-order report can never rewind or corrupt the folded position.
 *    A seek backward is still legal — it arrives as a FRESH event.
 * 4. NO SILENT LOSS — every watch event goes through the at-least-once
 *    outbox: a failed `emitEvent` keeps the event PENDING and THROWS the
 *    typed `RuntimeError` to the caller (the EventSink law: a lost
 *    watch-state event is never a silent success). `retryPendingWatchEvents`
 *    re-attempts; the runtime registers a lifecycle `shutdown` hook that
 *    flushes pending events (adapters await async shutdown hooks).
 * 5. HONEST COMPLETION — `completionRatio` is 1 exactly when completed,
 *    `clamp(position/duration)` when the item's duration is known, and
 *    `null` when it is not (never a fake 0 or 1).
 *
 * Determinism: no wall clock, no randomness — time and ids are injected
 * seams (`RuntimeClock` / `RuntimeIdGen`).
 */

import type { EntertainmentEvent } from "@wfx/domain";
import { validateEntertainmentEvent } from "@wfx/domain";
import type { Unsubscribe } from "@wfx/platform-contracts";

import { RuntimeError, serverFailureError } from "./errors";
import type { RuntimeClock, RuntimeIdGen, RuntimeContext } from "./runtime-seams";
import type { ServerPort } from "./server-port";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The per-item watch status vocabulary (mirrors the WFX-029 fold). */
export type SessionWatchStatus = "in-progress" | "completed" | "skipped";

/** Every value of `SessionWatchStatus`, in union order. */
export const SESSION_WATCH_STATUSES: readonly SessionWatchStatus[] = [
  "in-progress",
  "completed",
  "skipped",
];

/** The watch-state event types that carry watch state (the WFX-029 scope). */
export const WATCH_STATE_EVENT_TYPES: readonly EntertainmentEvent["type"][] = [
  "start",
  "progress",
  "complete",
  "skip",
];

/** The runtime's folded per-item watch state. */
export interface SessionWatchState {
  readonly itemId: string;
  /** Last applied position (milliseconds, >= 0). */
  readonly lastPositionMs: number;
  /**
   * High-water position: the maximum position ever applied. A legitimate
   * seek backward lowers `lastPositionMs` but never the high-water mark.
   */
  readonly highestPositionMs: number;
  /** 1 when completed; clamp(position/duration) when known; null when not. */
  readonly completionRatio: number | null;
  /** ISO timestamp of the last applied evidence. */
  readonly lastWatchedAt: string;
  readonly status: SessionWatchStatus;
}

/** One command to the watch-state engine. */
export type WatchStateCommand =
  | {
      readonly kind: "start";
      readonly itemId: string;
      readonly positionMs?: number;
      readonly playbackSessionId?: string;
    }
  | {
      readonly kind: "progress";
      readonly itemId: string;
      readonly positionMs: number;
      readonly playbackSessionId?: string;
    }
  | {
      readonly kind: "complete";
      readonly itemId: string;
      readonly positionMs?: number;
      readonly playbackSessionId?: string;
    }
  | {
      readonly kind: "skip";
      readonly itemId: string;
      readonly positionMs?: number;
      readonly playbackSessionId?: string;
    };

/** A queued at-least-once event (delivery bookkeeping). */
export interface PendingWatchEvent {
  /** Canonical event identity (the runtime's idempotency key). */
  readonly eventId: string;
  readonly event: EntertainmentEvent;
  /** Delivery attempts so far (>= 0). */
  readonly attempts: number;
  /** ISO timestamp of the last attempt (present after the first attempt). */
  readonly lastAttemptAt?: string;
  /** The typed failure of the last attempt (present when it failed). */
  readonly lastFailureDetail?: string;
}

/** The report of one `retryPendingWatchEvents` run. */
export interface WatchEventRetryReport {
  readonly retried: number;
  readonly delivered: number;
  readonly remaining: number;
  /** Non-empty when at least one attempt failed again. */
  readonly failures: readonly string[];
}

/** Listener for watch-state changes. */
export type WatchStateListener = (state: SessionWatchState) => void;

// ---------------------------------------------------------------------------
// The pure fold (the law, testable without any port)
// ---------------------------------------------------------------------------

/** Internal evidence ordering key: (occurredAt epoch, local sequence). */
interface Evidence {
  readonly atMs: number;
  readonly seq: number;
}

/** Compare evidence keys (older first). */
function evidenceOlder(a: Evidence, b: Evidence): boolean {
  return a.atMs < b.atMs || (a.atMs === b.atMs && a.seq < b.seq);
}

/**
 * Fold ONE watch-state event into a state (pure; the staleness law).
 * Returns the NEXT state, or `null` when the event is STALE (older evidence
 * than the current state's) — the caller drops it. The event must already
 * be validated (shape) by the caller; its payload position is read
 * defensively (malformed positions are ignored, never crash).
 * `previousEvidence` is the engine's applied-evidence record for the item;
 * when omitted, the state's `lastWatchedAt` with the incoming seq is the
 * comparison base (equal timestamps: the incoming event wins — the WFX-029
 * input-order tiebreak).
 */
export function foldWatchEvent(
  state: SessionWatchState | null,
  event: EntertainmentEvent,
  evidence: Evidence,
  durationMs?: number,
  previousEvidence?: Evidence,
): SessionWatchState | null {
  if (state !== null) {
    const stateEvidence = previousEvidence ?? parseEvidence(state.lastWatchedAt, evidence.seq);
    if (evidenceOlder(evidence, stateEvidence)) return null; // staleness law
  }

  const payloadPosition = readPayloadPosition(event);
  const prior = state?.lastPositionMs ?? 0;
  let status: SessionWatchStatus;
  let positionMs: number;
  switch (event.type) {
    case "start":
      status = "in-progress";
      positionMs = payloadPosition ?? prior;
      break;
    case "progress":
      status = "in-progress";
      positionMs = payloadPosition ?? prior;
      break;
    case "complete":
      status = "completed";
      positionMs = payloadPosition ?? prior;
      break;
    case "skip":
      status = "skipped";
      positionMs = payloadPosition ?? prior;
      break;
    default:
      return null; // not a watch-state event type (documented scope)
  }

  const highest = Math.max(state?.highestPositionMs ?? 0, positionMs);
  let completionRatio: number | null;
  if (status === "completed") {
    completionRatio = 1;
  } else if (durationMs !== undefined && durationMs > 0) {
    completionRatio = Math.min(Math.max(positionMs / durationMs, 0), 1);
  } else {
    completionRatio = null;
  }

  return {
    itemId: event.itemId,
    lastPositionMs: positionMs,
    highestPositionMs: highest,
    completionRatio,
    lastWatchedAt: event.occurredAt,
    status,
  };
}

/** Read a valid non-negative position from an event payload, if present. */
function readPayloadPosition(event: EntertainmentEvent): number | undefined {
  const payload = event.payload;
  if (payload === undefined || typeof payload !== "object") return undefined;
  const value = (payload as Record<string, unknown>).positionMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Parse an ISO timestamp to epoch ms (NaN sorts oldest — defensive). */
function parseEvidence(iso: string, fallbackSeq: number): Evidence {
  const at = Date.parse(iso);
  return { atMs: Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at, seq: fallbackSeq };
}

// ---------------------------------------------------------------------------
// The engine (state + at-least-once outbox)
// ---------------------------------------------------------------------------

/** The watch-state engine's operations surface (exposed via the runtime). */
export interface WatchStateOperations {
  /** The folded state of one item (undefined when never watched). */
  get(itemId: string): SessionWatchState | undefined;
  /** Every folded state, most recently watched first (deterministic). */
  all(): readonly SessionWatchState[];
  /** How many events are pending delivery (at-least-once visibility). */
  pendingEventCount(): number;
  /** The pending events, oldest first (diagnostics; copies). */
  pendingEvents(): readonly PendingWatchEvent[];
  /** Observe watch-state changes. */
  subscribe(listener: WatchStateListener): Unsubscribe;
}

/**
 * The watch-state engine: folds events locally, emits them through the
 * ServerPort with at-least-once delivery, and never silently loses one.
 * Created by `createRuntime`; usable standalone in tests.
 */
export class WatchStateEngine {
  private readonly states = new Map<string, SessionWatchState>();
  private readonly appliedEventIds = new Set<string>();
  private readonly pending = new Map<string, PendingWatchEvent>();
  private readonly listeners = new Set<WatchStateListener>();
  private readonly durations = new Map<string, number>();
  /** Per-item applied evidence (atMs + seq) — the staleness law's comparison base. */
  private readonly evidenceByItem = new Map<string, Evidence>();
  private sequence = 0;

  constructor(
    private readonly server: ServerPort,
    private readonly context: RuntimeContext,
    private readonly clock: RuntimeClock,
    private readonly ids: RuntimeIdGen,
  ) {}

  /** Register a canonical item duration (for honest completion ratios). */
  registerItemDuration(itemId: string, durationMs: number | undefined): void {
    if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0) {
      this.durations.set(itemId, durationMs);
    }
  }

  /**
   * Apply + emit one watch-state command (the runtime's
   * `updateWatchState`). Local fold first (local-first), then at-least-once
   * delivery. THROWS the typed `RuntimeError` when delivery fails — the
   * event stays pending and `retryPendingWatchEvents` will re-attempt.
   */
  async apply(command: WatchStateCommand): Promise<void> {
    const problems: string[] = [];
    if (typeof command?.itemId !== "string" || command.itemId.length === 0) {
      problems.push(`command.itemId: expected a non-empty string, got ${preview(command?.itemId)}`);
    }
    if (command !== null && typeof command === "object" && "positionMs" in command) {
      const position = (command as { positionMs?: unknown }).positionMs;
      if (position !== undefined && (typeof position !== "number" || !Number.isFinite(position) || position < 0)) {
        problems.push(
          `command.positionMs: expected a finite non-negative number when present, got ${preview(position)}`,
        );
      }
    }
    if (
      command !== null &&
      typeof command === "object" &&
      "playbackSessionId" in command &&
      (command as { playbackSessionId?: unknown }).playbackSessionId !== undefined &&
      typeof (command as { playbackSessionId?: unknown }).playbackSessionId !== "string"
    ) {
      problems.push("command.playbackSessionId: expected a string when present");
    }
    if (problems.length > 0) throw new RuntimeError("invalid-input", problems.join("; "));

    const occurredAtMs = this.clock.now();
    const event: EntertainmentEvent = {
      userId: this.context.userId,
      itemId: command.itemId,
      type: command.kind,
      occurredAt: new Date(occurredAtMs).toISOString(),
      sessionId: this.context.sessionId,
      payload: buildPayload(command),
    };
    const checked = validateEntertainmentEvent(event);
    if (!checked.ok) {
      throw new RuntimeError("invalid-input", checked.errors.join("; "));
    }
    const eventId = this.ids.next();
    const evidence: Evidence = { atMs: occurredAtMs, seq: ++this.sequence };

    this.fold(eventId, event, evidence, command.itemId);

    // At-least-once delivery.
    await this.deliver({ eventId, event, attempts: 0 });
  }

  /**
   * Apply + queue one watch-state event WITHOUT throwing on delivery
   * failure (the controller's observation channel): the event stays
   * pending and visible (`pendingEventCount`), retried by
   * `retryPendingWatchEvents` / flushed at shutdown — never silent.
   */
  async applyObserved(command: WatchStateCommand): Promise<void> {
    try {
      await this.apply(command);
    } catch (thrown) {
      if (thrown instanceof RuntimeError && thrown.kind === "invalid-input") throw thrown;
      // Delivery failure: retained pending; surfaced via the outbox.
    }
  }

  /** The local fold (idempotent per canonical event id; staleness law). */
  private fold(
    eventId: string,
    event: EntertainmentEvent,
    evidence: Evidence,
    itemId: string,
  ): void {
    if (this.appliedEventIds.has(eventId)) return; // at-least-once redelivery: idempotent
    this.appliedEventIds.add(eventId);
    const duration = this.durations.get(itemId);
    const folded = foldWatchEvent(
      this.states.get(itemId) ?? null,
      event,
      evidence,
      duration,
      this.evidenceByItem.get(itemId),
    );
    if (folded !== null) {
      this.states.set(itemId, folded);
      this.evidenceByItem.set(itemId, evidence);
      for (const listener of this.listeners) listener(folded);
    }
  }

  /** Attempt delivery of one event; on failure it stays pending and throws. */
  private async deliver(entry: PendingWatchEvent): Promise<void> {
    const attempt: PendingWatchEvent = {
      ...entry,
      attempts: entry.attempts + 1,
      lastAttemptAt: new Date(this.clock.now()).toISOString(),
    };
    const result = await this.server.emitEvent(attempt.event);
    if (result.ok) {
      this.pending.delete(entry.eventId);
      return;
    }
    this.pending.set(entry.eventId, {
      ...attempt,
      lastFailureDetail: result.failure.detail,
    });
    // The EventSink law: a lost watch-state event is never a silent success.
    throw serverFailureError("emitEvent (watch state)", result.failure);
  }

  /** Re-attempt every pending event; resolves with the honest report. */
  async retryPendingWatchEvents(): Promise<WatchEventRetryReport> {
    const entries = [...this.pending.values()];
    const failures: string[] = [];
    let delivered = 0;
    for (const entry of entries) {
      try {
        await this.deliver(entry);
        delivered += 1;
      } catch (thrown) {
        failures.push(thrown instanceof Error ? thrown.message : String(thrown));
      }
    }
    return {
      retried: entries.length,
      delivered,
      remaining: this.pending.size,
      failures,
    };
  }

  /** Flush pending events (the shutdown hook body; best-effort, honest). */
  async flush(): Promise<WatchEventRetryReport> {
    return this.retryPendingWatchEvents();
  }

  /** The operations surface (queries + subscription). */
  operations(): WatchStateOperations {
    return {
      get: (itemId) => this.states.get(itemId),
      all: () =>
        [...this.states.values()].sort((a, b) => {
          const aMs = Date.parse(a.lastWatchedAt);
          const bMs = Date.parse(b.lastWatchedAt);
          return (
            (Number.isNaN(bMs) ? Number.NEGATIVE_INFINITY : bMs) -
              (Number.isNaN(aMs) ? Number.NEGATIVE_INFINITY : aMs) ||
            (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0)
          );
        }),
      pendingEventCount: () => this.pending.size,
      pendingEvents: () => [...this.pending.values()].map((entry) => ({ ...entry })),
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      },
    };
  }
}

/** Build the event payload for one command (mirrors the WFX-005 conventions). */
function buildPayload(command: WatchStateCommand): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (command.playbackSessionId !== undefined) {
    payload.playbackSessionId = command.playbackSessionId;
  }
  if ("positionMs" in command && command.positionMs !== undefined) {
    payload.positionMs = command.positionMs;
  }
  return payload;
}

/** Compact value preview for error details (defensive, no imports needed). */
function preview(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  try {
    return String(value);
  } catch {
    return "unprintable";
  }
}
