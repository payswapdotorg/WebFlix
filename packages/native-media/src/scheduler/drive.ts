/**
 * @wfx/native-media — scheduler loop driver (WFX-023, Lane B).
 *
 * `createScheduler(engine, config, clock)` is the STATEFUL loop driver that
 * turns per-session playback demands into `engine.prioritize` batches. It
 * owns NO timers of its own: the host calls `tick(sessions)` and the clock
 * is an injected `() => number` — no hidden `Date.now()`, no intervals.
 *
 * MERGED-SERVICE CONVENTION (design decision, documented for lead review):
 * the frozen engine API is per-session, so the driver calls
 * `engine.prioritize(sessionId, deadlines)` DIRECTLY (one merged batch per
 * session) and runs every failure through the merged WFX-004 service
 * convention: errors are mapped with `mapEngineError` (the exact mapping
 * `createNativeMediaService` uses) and surfaced as typed failures inside
 * `ServiceResponse` envelopes. The scheduler does NOT wrap the engine in a
 * second `createNativeMediaService` instance: that adapter tracks session
 * ownership (sessions opened elsewhere answer NOT_FOUND), which would break
 * host-owned sessions — the demand's sessionId is the scheduler's only
 * session identity, and the frozen engine surface has no status primitive
 * (WFX-004 design note 2).
 *
 * Tick contract:
 * - Sessions are processed FOREGROUND FIRST (priority weight descending,
 *   sessionId ascending as the deterministic tie-break).
 * - One tick never schedules beyond the horizon (plan.ts rule 5).
 * - Repeated ticks with unchanged demands and an unchanged clock are
 *   IDEMPOTENT: identical batches, no deadline drift.
 * - Engine errors NEVER crash the tick: they are recorded as typed
 *   `SchedulerFailure`s (and as `ok: false` envelopes on the session's
 *   tick result); the remaining sessions are still scheduled. Nothing is
 *   dropped silently — every skipped session carries a typed reason.
 * - Malformed demands and duplicate session ids are likewise recorded as
 *   typed `INVALID_INPUT` failures; only a broken CLOCK or a non-array
 *   sessions argument (host programmer errors) throw out of the tick.
 * - Concurrent `tick` calls are serialized in call order (an internal
 *   promise chain) so stats never interleave.
 */

import type { NativeMediaEngine } from "@wfx/domain";

import { NativeMediaError } from "../errors";
import { mapEngineError, type ServiceResponse } from "../service";
import { planPriorities } from "./plan";
import {
  DEFAULT_NETWORK_ESTIMATE_MS,
  priorityForState,
  resolveSchedulerConfig,
  validatePlaybackDemand,
  type PlaybackDemand,
  type PlannedPieceDeadline,
  type SchedulerConfig,
  type SchedulerConfigInput,
  type SessionPriority,
} from "./model";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The injected clock: a pure `() => number` returning epoch-style
 * milliseconds. NO real timers anywhere in the scheduler — the host owns
 * time.
 */
export type SchedulerClock = () => number;

/** One entry of a merged prioritize batch — the frozen engine wire shape. */
export interface SchedulerBatchEntry {
  readonly piece: number;
  readonly deadlineMs: number;
}

/** The successful outcome of one session's prioritize send. */
export interface SchedulerBatchReceipt {
  readonly sessionId: string;
  /** The exact batch handed to `engine.prioritize` (marker fields stripped). */
  readonly batch: readonly SchedulerBatchEntry[];
  /** Late-marked pieces within the batch. */
  readonly latePieces: number;
}

/** A typed failure recorded during a tick (never swallowed, never faked). */
export interface SchedulerFailure {
  /** The session the failure concerns, when extractable from the demand. */
  readonly sessionId: string | undefined;
  /** The 1-based tick number the failure was recorded in. */
  readonly tick: number;
  /** The typed, mapped error (code / retryable / detail preserved). */
  readonly error: NativeMediaError;
}

/** The per-session result of one tick (the plan and the engine outcome). */
export interface SessionTickResult {
  readonly sessionId: string;
  readonly priority: SessionPriority;
  /** Planned pieces (0 for non-playing / paused / failed-to-plan sessions). */
  readonly planSize: number;
  /** Late-marked pieces in the plan. */
  readonly latePieces: number;
  /** False when there was nothing to send (empty plan) — an explicit no-op. */
  readonly engineCalled: boolean;
  /** The merged-service-convention outcome of the prioritize send. */
  readonly result: ServiceResponse<SchedulerBatchReceipt>;
}

/** The full report of one tick (plain data; safe to log / assert on). */
export interface SchedulerTickReport {
  /** 1-based tick number. */
  readonly tick: number;
  /** The clock reading the whole tick was planned against. */
  readonly atMs: number;
  /** Per-session results, FOREGROUND FIRST (weight desc, sessionId asc). */
  readonly sessions: readonly SessionTickResult[];
  /** Every typed failure recorded during this tick. */
  readonly failures: readonly SchedulerFailure[];
}

/**
 * The observable scheduler state snapshot (telemetry / tests): cumulative
 * counters plus the LAST tick's per-session plan sizes and errors.
 */
export interface SchedulerStats {
  /** Completed ticks. */
  readonly ticks: number;
  /** Clock ms of the last completed tick; null before the first tick. */
  readonly lastTickAt: number | null;
  /** Cumulative pieces successfully delivered to `engine.prioritize`. */
  readonly piecesScheduled: number;
  /** Cumulative late-marked pieces in successfully delivered batches. */
  readonly latePieces: number;
  /** LAST tick's plan size per session id (all seen sessions, incl. empty). */
  readonly perSessionPlanSizes: ReadonlyMap<string, number>;
  /** Failures recorded during the LAST tick. */
  readonly lastErrors: readonly SchedulerFailure[];
  /** Cumulative typed failures across all ticks. */
  readonly errorCount: number;
}

/** The scheduler loop driver surface. */
export interface Scheduler {
  /**
   * One scheduling pass over the given demands. Engine failures never
   * reject; only host programmer errors do (broken clock, non-array
   * sessions argument).
   */
  tick(sessions: readonly PlaybackDemand[]): Promise<SchedulerTickReport>;
  /** A defensive snapshot of the scheduler stats (fresh copies each call). */
  stats(): SchedulerStats;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the scheduler loop driver around ANY frozen `NativeMediaEngine`.
 *
 * @param engine            the engine to drive (validated against the
 *                          frozen method surface).
 * @param config            scheduler config; omitted fields fall back to
 *                          validated defaults (`{}` = all defaults).
 * @param clock             the INJECTED clock — required, no hidden
 *                          timers.
 * @param networkEstimateMs optional INJECTED network estimate (default:
 *                          the fixed constant, never a probe).
 * @throws NativeMediaError (`INVALID_INPUT`) on a malformed engine /
 *         config / clock / estimate — factory-time programmer errors.
 */
export function createScheduler(
  engine: NativeMediaEngine,
  config: SchedulerConfigInput,
  clock: SchedulerClock,
  networkEstimateMs?: number,
): Scheduler {
  if (typeof engine !== "object" || engine === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createScheduler: engine must be an object",
    });
  }
  for (const method of [
    "open",
    "seek",
    "prioritize",
    "pause",
    "resume",
    "close",
  ] as const) {
    if (
      typeof (engine as unknown as Record<string, unknown>)[method] !== "function"
    ) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: `createScheduler: engine is missing the '${method}' method required by the frozen NativeMediaEngine contract`,
      });
    }
  }
  const resolvedConfig = resolveSchedulerConfig(config);
  if (typeof clock !== "function") {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createScheduler: clock must be a function () => number",
    });
  }
  const estimate =
    networkEstimateMs ?? DEFAULT_NETWORK_ESTIMATE_MS;
  if (
    typeof estimate !== "number" ||
    !Number.isFinite(estimate) ||
    estimate < 0
  ) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `createScheduler: networkEstimateMs must be a finite number >= 0 (got ${String(networkEstimateMs)})`,
    });
  }
  return new SchedulerImpl(engine, resolvedConfig, clock, estimate);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Best-effort session id extraction from an unvalidated demand. */
function extractSessionId(raw: unknown): string | undefined {
  if (typeof raw === "object" && raw !== null) {
    const id = (raw as Record<string, unknown>).sessionId;
    if (typeof id === "string" && id.trim().length > 0) return id;
  }
  return undefined;
}

class SchedulerImpl implements Scheduler {
  private ticks = 0;
  private lastTickAt: number | null = null;
  private piecesScheduled = 0;
  private latePieces = 0;
  private perSessionPlanSizes: ReadonlyMap<string, number> = new Map();
  private lastErrors: readonly SchedulerFailure[] = [];
  private errorCount = 0;
  /** Serializes concurrent ticks in call order (stats never interleave). */
  private queueTail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly engine: NativeMediaEngine,
    private readonly config: SchedulerConfig,
    private readonly clock: SchedulerClock,
    private readonly networkEstimateMs: number,
  ) {}

  tick(sessions: readonly PlaybackDemand[]): Promise<SchedulerTickReport> {
    const run = this.queueTail.then(() => this.runTick(sessions));
    // Keep the chain alive regardless of this tick's outcome.
    this.queueTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  stats(): SchedulerStats {
    return {
      ticks: this.ticks,
      lastTickAt: this.lastTickAt,
      piecesScheduled: this.piecesScheduled,
      latePieces: this.latePieces,
      perSessionPlanSizes: new Map(this.perSessionPlanSizes),
      lastErrors: [...this.lastErrors],
      errorCount: this.errorCount,
    };
  }

  private async runTick(
    sessions: readonly PlaybackDemand[],
  ): Promise<SchedulerTickReport> {
    if (!Array.isArray(sessions)) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "tick: sessions must be an array of PlaybackDemand",
      });
    }
    const atMs = this.clock();
    if (typeof atMs !== "number" || !Number.isFinite(atMs) || atMs < 0) {
      // A broken clock is a host programmer error (not an engine error):
      // there is no sane "now" to plan against, so the tick refuses to run.
      throw new NativeMediaError("INVALID_INPUT", {
        detail: `tick: clock() must return a finite number >= 0 (got ${String(atMs)})`,
      });
    }
    const tickNumber = this.ticks + 1;
    const failures: SchedulerFailure[] = [];

    // --- validate demands; first occurrence wins on duplicate ids --------
    const seen = new Set<string>();
    const demands: PlaybackDemand[] = [];
    for (const raw of sessions) {
      const sessionId = extractSessionId(raw);
      try {
        const demand = validatePlaybackDemand(raw);
        if (seen.has(demand.sessionId)) {
          throw new NativeMediaError("INVALID_INPUT", {
            detail: `tick: duplicate PlaybackDemand for session '${demand.sessionId}' (first occurrence wins)`,
            sessionId: demand.sessionId,
          });
        }
        seen.add(demand.sessionId);
        demands.push(demand);
      } catch (e) {
        const error = mapEngineError(e, sessionId);
        failures.push({ sessionId, tick: tickNumber, error });
      }
    }

    // --- foreground first: weight desc, sessionId asc (deterministic) ----
    const ordered = [...demands].sort((a, b) => {
      const weightDelta =
        priorityForState(b.state).weight - priorityForState(a.state).weight;
      if (weightDelta !== 0) return weightDelta;
      return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0;
    });

    // --- plan + send, one merged batch per session ------------------------
    const results: SessionTickResult[] = [];
    const planSizes = new Map<string, number>();
    for (const demand of ordered) {
      const priority = priorityForState(demand.state);

      let plan: PlannedPieceDeadline[] = [];
      try {
        plan = planPriorities(demand, this.config, atMs, this.networkEstimateMs);
      } catch (e) {
        // planPriorities inputs were both validated above, so this is a
        // belt-and-braces branch: recorded, typed, never silent.
        const error = mapEngineError(e, demand.sessionId);
        failures.push({ sessionId: demand.sessionId, tick: tickNumber, error });
        planSizes.set(demand.sessionId, 0);
        results.push({
          sessionId: demand.sessionId,
          priority,
          planSize: 0,
          latePieces: 0,
          engineCalled: false,
          result: { ok: false, error },
        });
        continue;
      }

      const lateInPlan = plan.reduce(
        (count, entry) => (entry.late ? count + 1 : count),
        0,
      );
      planSizes.set(demand.sessionId, plan.length);

      if (plan.length === 0) {
        // Non-playing / paused session: nothing needed — an explicit no-op
        // (NOT a dropped schedule: the empty plan is the typed semantics).
        results.push({
          sessionId: demand.sessionId,
          priority,
          planSize: 0,
          latePieces: 0,
          engineCalled: false,
          result: {
            ok: true,
            value: { sessionId: demand.sessionId, batch: [], latePieces: 0 },
          },
        });
        continue;
      }

      // The engine batch: the frozen { piece, deadlineMs } wire shape.
      const batch: SchedulerBatchEntry[] = plan.map((entry) => ({
        piece: entry.piece,
        deadlineMs: entry.deadlineMs,
      }));

      // Defensive invariant: our own planner must emit engine-valid entries.
      const invalid = batch.find(
        (entry) =>
          !Number.isSafeInteger(entry.piece) ||
          entry.piece < 0 ||
          !Number.isFinite(entry.deadlineMs) ||
          entry.deadlineMs < 0,
      );
      if (invalid !== undefined) {
        const error = new NativeMediaError("INTERNAL", {
          detail: `planner emitted an invalid batch entry for session '${demand.sessionId}' (piece=${String(invalid.piece)}, deadlineMs=${String(invalid.deadlineMs)})`,
          sessionId: demand.sessionId,
        });
        failures.push({ sessionId: demand.sessionId, tick: tickNumber, error });
        results.push({
          sessionId: demand.sessionId,
          priority,
          planSize: plan.length,
          latePieces: lateInPlan,
          engineCalled: false,
          result: { ok: false, error },
        });
        continue;
      }

      // Send through the merged-service convention: direct per-session
      // engine call, failures mapped by mapEngineError into the envelope.
      let result: ServiceResponse<SchedulerBatchReceipt>;
      try {
        // A private copy goes to the engine; the receipt keeps its own
        // pristine snapshot (a mutating engine cannot corrupt the record).
        await this.engine.prioritize(
          demand.sessionId,
          batch.map((entry) => ({ piece: entry.piece, deadlineMs: entry.deadlineMs })),
        );
        result = {
          ok: true,
          value: { sessionId: demand.sessionId, batch, latePieces: lateInPlan },
        };
        this.piecesScheduled += batch.length;
        this.latePieces += lateInPlan;
      } catch (e) {
        const error = mapEngineError(e, demand.sessionId);
        failures.push({ sessionId: demand.sessionId, tick: tickNumber, error });
        result = { ok: false, error };
      }
      results.push({
        sessionId: demand.sessionId,
        priority,
        planSize: plan.length,
        latePieces: lateInPlan,
        engineCalled: true,
        result,
      });
    }

    // --- commit the tick's stats ------------------------------------------
    this.ticks = tickNumber;
    this.lastTickAt = atMs;
    this.perSessionPlanSizes = planSizes;
    this.lastErrors = failures;
    this.errorCount += failures.length;

    return { tick: tickNumber, atMs, sessions: results, failures };
  }
}
