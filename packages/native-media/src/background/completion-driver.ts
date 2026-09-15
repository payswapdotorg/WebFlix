/**
 * @wfx/native-media — background completion driver (WFX-024, Lane B).
 *
 * `createCompletionDriver(engine, policy, clock, options)` is the STATEFUL
 * completion state machine driver: it applies the pure policy decisions
 * (policy.ts) to real engine sessions, keeps continued background
 * completions scheduling through the MERGED WFX-023 scheduler tick
 * contract, and maintains the storage policy through the WFX-024
 * `StorageGovernor`. No timers, no network, no battery APIs — the clock
 * and the environment are INJECTED (the frozen architecture: "Mobile uses
 * native media/platform facilities and OS-constrained background
 * behavior" — the platform hints arrive as typed inputs, never as
 * assumptions).
 *
 * Host-facing contract:
 * - `onSessionBackground(session, facts?)` — playback paused/ended (the
 *   session moved to `background`). Applies `decideCompletion`:
 *   continue ⇒ the session joins the background scheduling set (its
 *   demands tick through the internal WFX-023 scheduler with state
 *   `"background"`, so the merged background fairness — reduced horizon,
 *   dilated deadlines, never starved — applies automatically); pause ⇒
 *   `engine.pause` (typed envelope, failures recorded — the session stays
 *   resumable); cancel ⇒ `engine.close` + cache release per policy.
 *   Concurrency: at most `maxConcurrentCompletions` sessions continue;
 *   the excess PAUSE with a typed reason (resumable) in arrival order.
 * - `onEnvironmentChange(environment)` — re-evaluates EVERY tracked
 *   session against the new environment: policy-paused sessions resume
 *   when the environment allows again (wifi returns), active sessions
 *   pause when it degrades. Transitions are always typed + logged.
 * - `onSessionUpdate(session, metrics?)` — the host pushes session
 *   snapshots (the frozen engine has NO status primitive — WFX-004 design
 *   note 2 — so snapshots are host-pushed). COMPLETION DETECTION: a
 *   tracked session reaching `complete` is evicted from the active set,
 *   marked persistent per `StoragePolicy.protectedItems`, and emits a
 *   typed `CompletionEvent` to the INJECTED `CompletionSink` exactly once
 *   (no hidden callbacks). A session reaching `failed` has its session
 *   cache released per policy. A freed concurrency slot resumes the
 *   earliest cap-paused session (FIFO release order).
 * - `tick()` — one scheduling pass over the continued background
 *   sessions, delegating to the merged WFX-023 scheduler (the returned
 *   `SchedulerTickReport` IS that contract, verbatim).
 * - `log()` / `stats()` — the `BackgroundLog` audit trail (session,
 *   transition, cause, reason, error) and a defensive stats snapshot.
 *
 * Design decisions (documented for lead review):
 *
 * 1. SERIALIZED OPERATIONS. All mutating calls are queued in call order
 *    (an internal promise chain, mirroring the WFX-023 scheduler driver)
 *    so concurrent host calls never interleave driver state.
 * 2. POLICY-VIEW BOOKKEEPING ON ENGINE FAILURE. The frozen engine returns
 *    `void` from pause/resume/close with no status feedback, so when a
 *    call FAILS the driver cannot know the engine's real state. It keeps
 *    its own POLICY view (the transition stands, the failure is recorded
 *    as a typed `BackgroundFailure` + log entry with the mapped error)
 *    and survives. A failed close still removes the session from the
 *    driver (the decision was cancel); a failed resume leaves the session
 *    paused.
 * 3. CONCURRENCY CAP HIERARCHY. The pure `decideCompletion` answer is
 *    reported as `policyDecision`; the cap may override a `continue` into
 *    an effective `pause` (reported as `effective`). The outcome always
 *    carries both — no silent divergence.
 * 4. COMPLETION NEEDS HOST-REPORTED BYTES. `CompletionEvent.totalBytes`
 *    comes from the `metrics` the host pushes with the completing
 *    snapshot. Without them the completion is still processed (evict from
 *    active, persistent mark, slot release) but the event is a TYPED
 *    REFUSAL — the driver never fabricates a byte count.
 * 5. COMPLETION EVENTS ARE FOR WATCHED SESSIONS ONLY. A session arriving
 *    already-terminal at `onSessionBackground` is cancelled without an
 *    event: this driver never watched it complete. `onSessionUpdate` for
 *    an untracked session is a recognized:false no-op.
 * 6. SCHEDULING FACTS ARE THE HOST'S TRUTH. `facts` (bitrate, playback
 *    rate, buffer ahead, stall budget) are supplied at backgrounding and
 *    refreshed from later snapshots (`positionMs` verbatim,
 *    `bufferAheadMs = max(0, bufferedMs - positionMs)`). A session
 *    continued WITHOUT facts is tracked but unschedulable — reported in
 *    the outcome and `stats().unschedulable`, never silently scheduled
 *    with invented numbers. The WFX-023 semantics rule the plans: a
 *    paused-by-host rate-0 demand yields an empty plan (nothing is
 *    consumed ⇒ nothing is needed) — the driver does not invent demand.
 * 7. TERMINAL-COMPLETE CANCELS KEEP THE CACHE. A cancel releases the
 *    session cache (cancel/failed per policy) EXCEPT when the session is
 *    `complete`: a finished download persists per storage policy
 *    (persistent if protected, otherwise ordinary evictable cache).
 */

import type { NativeMediaEngine, NativeMediaSession } from "@wfx/domain";

import { NativeMediaError } from "../errors";
import { mapEngineError, type ServiceResponse } from "../service";
import { createScheduler } from "../scheduler/drive";
import type {
  Scheduler,
  SchedulerClock,
  SchedulerTickReport,
} from "../scheduler/drive";
import { validatePlaybackDemand } from "../scheduler/model";
import type {
  PlaybackDemand,
  SchedulerConfigInput,
} from "../scheduler/model";
import {
  decideCompletion,
  validateBackgroundEnvironment,
  validateBackgroundPolicy,
  validateBackgroundSession,
  type BackgroundEnvironment,
  type BackgroundPolicy,
  type CompletionDecision,
} from "./policy";
import { createStorageGovernor } from "./storage";
import type {
  StorageGovernor,
  StorageReleaseResult,
} from "./storage";

// ---------------------------------------------------------------------------
// Types — completion sink, log, outcomes
// ---------------------------------------------------------------------------

/**
 * The typed completion event, emitted EXACTLY ONCE per completing session
 * to the injected sink. `completedAt` is the injected clock's reading at
 * detection; `totalBytes` is the host-reported total.
 */
export interface CompletionEvent {
  readonly sessionId: string;
  readonly assetId: string;
  readonly completedAt: number;
  readonly totalBytes: number;
}

/**
 * The INJECTED completion sink (no hidden callbacks, no global emitter).
 * A throwing / rejecting `onCompletion` is recorded as a typed failure —
 * the driver survives.
 */
export interface CompletionSink {
  onCompletion(event: CompletionEvent): void | Promise<void>;
}

/**
 * The scheduling facts the host owns for one backgrounded session (the
 * WFX-023 `PlaybackDemand` minus the driver-owned `sessionId`/`state`).
 */
export type BackgroundDemandFacts = Omit<
  PlaybackDemand,
  "sessionId" | "state"
>;

/** Byte metrics a host may push with a session snapshot. */
export interface SessionMetrics {
  /** Total size of the completed download (positive safe integer). */
  readonly totalBytes: number;
}

/** The audit-trail transitions the driver records. */
export type BackgroundTransition =
  | "continue"
  | "pause"
  | "resume"
  | "cancel"
  | "complete"
  | "failed";

/** The typed cause code attached to every log entry. */
export type BackgroundCause =
  /** The completion policy (mode × environment) decided. */
  | "policy"
  /** The maxConcurrentCompletions cap overrode a continue. */
  | "concurrency"
  /** An environment change triggered the re-evaluation. */
  | "environment"
  /** A freed completion slot resumed a cap-paused session (FIFO). */
  | "slot-freed"
  /** The session was already terminal when decided. */
  | "terminal"
  /** An engine (or sink) call failed while applying a transition. */
  | "engine-failure"
  /** The session reached complete. */
  | "completion"
  /** The session reached failed. */
  | "session-failure";

/** One `BackgroundLog` audit-trail entry (session, transition, cause). */
export interface BackgroundLogEntry {
  /** The injected clock's reading when the entry was appended. */
  readonly atMs: number;
  readonly sessionId: string;
  readonly assetId: string;
  readonly transition: BackgroundTransition;
  readonly cause: BackgroundCause;
  readonly reason: string;
  /** The typed mapped error, for `engine-failure` entries. */
  readonly error?: NativeMediaError;
}

/** The audit trail itself: an ordered, append-only entry list. */
export type BackgroundLog = readonly BackgroundLogEntry[];

/** One typed engine-call outcome issued while applying a decision. */
export interface EngineCallOutcome {
  readonly sessionId: string;
  readonly operation: "pause" | "resume" | "close";
  readonly result: ServiceResponse<{ sessionId: string }>;
}

/** The outcome of applying a decision to one session. */
export interface BackgroundOutcome {
  readonly sessionId: string;
  /** The PURE policy decision (mode × environment × session state). */
  readonly policyDecision: CompletionDecision;
  /** What the driver effectively did (the cap may override continue). */
  readonly effective: CompletionDecision;
  /** The applied transition; null when nothing changed (re-evaluation). */
  readonly transition: BackgroundTransition | null;
  /** True when the session is schedulable through `tick()`. */
  readonly schedulable: boolean;
  /** Every typed engine call issued while applying the decision. */
  readonly engineCalls: readonly EngineCallOutcome[];
  /** The cache-release result, when a cancel released a session cache. */
  readonly release?: StorageReleaseResult;
}

/** The report of one environment change (every tracked session). */
export interface EnvironmentChangeReport {
  readonly environment: BackgroundEnvironment;
  /** The previous environment (never null — the factory requires one). */
  readonly previousEnvironment: BackgroundEnvironment;
  /** Per-session outcomes, in deterministic tracking order. */
  readonly outcomes: readonly BackgroundOutcome[];
}

/** The outcome of one host-pushed session snapshot. */
export interface SessionUpdateOutcome {
  readonly sessionId: string;
  /** False when the driver does not track this session (a no-op). */
  readonly recognized: boolean;
  /** True when this update detected completion. */
  readonly completed: boolean;
  /** True when this update detected failure. */
  readonly failed: boolean;
  /** The emitted event, when one was emitted. */
  readonly event?: CompletionEvent;
  /** Typed refusal when completion was detected without totalBytes. */
  readonly completionRefusal?: NativeMediaError;
  /** The cache-release result, when a failed session was released. */
  readonly release?: StorageReleaseResult;
  /** Engine calls issued while processing (e.g. FIFO slot release). */
  readonly engineCalls: readonly EngineCallOutcome[];
}

/** A paused session as seen through `stats()`. */
export interface PausedSessionInfo {
  readonly sessionId: string;
  readonly assetId: string;
  readonly cause: "policy" | "concurrency";
  readonly reason: string;
  readonly pausedAtMs: number;
}

/** A typed failure recorded by the driver (never swallowed). */
export interface BackgroundFailure {
  readonly sessionId: string;
  readonly operation: "pause" | "resume" | "close" | "completion-event";
  readonly error: NativeMediaError;
  readonly atMs: number;
}

/** The driver's observable stats snapshot (telemetry / tests). */
export interface CompletionDriverStats {
  readonly environment: BackgroundEnvironment;
  /** Active (continuing) completion session ids, in tracking order. */
  readonly activeCompletions: readonly string[];
  /** Paused sessions, in pause (FIFO) order, with typed causes. */
  readonly paused: readonly PausedSessionInfo[];
  /** Active sessions continued WITHOUT scheduling facts. */
  readonly unschedulable: readonly string[];
  /** Total tracked sessions (active + paused). */
  readonly trackedSessions: number;
  readonly completions: number;
  readonly sessionFailures: number;
  readonly cancels: number;
  /** Cumulative typed failures (engine calls + sink + event refusals). */
  readonly failureCount: number;
  /** Failures recorded during the LAST completed driver operation. */
  readonly lastErrors: readonly BackgroundFailure[];
}

/** Options for {@link createCompletionDriver}. */
export interface CompletionDriverOptions {
  /**
   * REQUIRED initial environment (network class + charging state). The
   * driver NEVER assumes platform hints — they are injected here and
   * updated via `onEnvironmentChange`.
   */
  readonly environment: BackgroundEnvironment;
  /** REQUIRED injected completion-event sink (no hidden callbacks). */
  readonly completionSink: CompletionSink;
  /**
   * Optional config for the internal MERGED WFX-023 scheduler (defaults
   * used when omitted).
   */
  readonly schedulerConfig?: SchedulerConfigInput;
  /**
   * Optional injected storage governor; created from `policy.storage`
   * when omitted (exposed via `storage()` either way).
   */
  readonly governor?: StorageGovernor;
}

/** The background completion driver surface. */
export interface CompletionDriver {
  /**
   * Playback paused/ended: apply the completion decision to the session.
   * `facts` (optional) are the host's scheduling facts — without them a
   * continued session is tracked but unschedulable (typed in the outcome).
   */
  onSessionBackground(
    session: NativeMediaSession,
    facts?: BackgroundDemandFacts,
  ): Promise<BackgroundOutcome>;
  /**
   * The environment changed: re-evaluate every tracked session (paused
   * sessions resume when policy allows again; active sessions pause when
   * it degrades). Transitions are typed + logged.
   */
  onEnvironmentChange(
    environment: BackgroundEnvironment,
  ): Promise<EnvironmentChangeReport>;
  /**
   * Host-pushed session snapshot. Completion detection: a tracked session
   * reaching `complete` fires the completion path exactly once (event via
   * the injected sink, persistent mark, FIFO slot release). Reaching
   * `failed` releases the session cache per policy.
   */
  onSessionUpdate(
    session: NativeMediaSession,
    metrics?: SessionMetrics,
  ): Promise<SessionUpdateOutcome>;
  /**
   * One scheduling pass over the continued background sessions through
   * the MERGED WFX-023 scheduler tick contract (background fairness:
   * reduced horizon, dilated deadlines — never starved).
   */
  tick(): Promise<SchedulerTickReport>;
  /** The full audit trail (defensive copy). */
  log(): BackgroundLog;
  /** A defensive stats snapshot. */
  stats(): CompletionDriverStats;
  /** The storage governor this driver enforces. */
  storage(): StorageGovernor;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function invalidInput(detail: string): NativeMediaError {
  return new NativeMediaError("INVALID_INPUT", { detail });
}

function validateEngineSurface(engine: unknown): NativeMediaEngine {
  if (typeof engine !== "object" || engine === null) {
    throw invalidInput("createCompletionDriver: engine must be an object");
  }
  for (const method of [
    "open",
    "seek",
    "prioritize",
    "pause",
    "resume",
    "close",
  ] as const) {
    if (typeof (engine as Record<string, unknown>)[method] !== "function") {
      throw invalidInput(
        `createCompletionDriver: engine is missing the '${method}' method required by the frozen NativeMediaEngine contract`,
      );
    }
  }
  return engine as NativeMediaEngine;
}

function validateSinkShape(sink: unknown): CompletionSink {
  if (typeof sink !== "object" || sink === null) {
    throw invalidInput(
      "createCompletionDriver: options.completionSink must be an object",
    );
  }
  if (typeof (sink as Record<string, unknown>).onCompletion !== "function") {
    throw invalidInput(
      "createCompletionDriver: options.completionSink must expose onCompletion(event) — the sink is injected, there are no hidden callbacks",
    );
  }
  return sink as CompletionSink;
}

function validateGovernorShape(governor: unknown): StorageGovernor {
  if (typeof governor !== "object" || governor === null) {
    throw invalidInput("createCompletionDriver: options.governor must be an object");
  }
  for (const method of [
    "associate",
    "admit",
    "touch",
    "release",
    "markPersistent",
    "isProtected",
    "stats",
  ] as const) {
    if (typeof (governor as Record<string, unknown>)[method] !== "function") {
      throw invalidInput(
        `createCompletionDriver: options.governor is missing the '${method}' method`,
      );
    }
  }
  return governor as StorageGovernor;
}

function validateMetrics(metrics: unknown): SessionMetrics {
  if (typeof metrics !== "object" || metrics === null) {
    throw invalidInput("onSessionUpdate: metrics must be an object when provided");
  }
  const m = metrics as Record<string, unknown>;
  if (
    typeof m.totalBytes !== "number" ||
    !Number.isSafeInteger(m.totalBytes) ||
    m.totalBytes <= 0
  ) {
    throw invalidInput(
      `onSessionUpdate: metrics.totalBytes must be a positive safe integer (got ${String(m.totalBytes)})`,
    );
  }
  return { totalBytes: m.totalBytes };
}

/**
 * Create the background completion driver around ANY frozen
 * `NativeMediaEngine`.
 *
 * @param engine  the engine to drive (validated against the frozen method
 *                surface).
 * @param policy  the WFX-024 background policy (completion + storage),
 *                deeply validated.
 * @param clock   the INJECTED clock — required, no hidden timers.
 * @param options required: the initial `environment` and the injected
 *                `completionSink`; optional: `schedulerConfig`,
 *                `governor`.
 * @throws NativeMediaError (`INVALID_INPUT`) on a malformed engine, policy,
 *         clock, or options — factory-time programmer errors.
 */
export function createCompletionDriver(
  engine: NativeMediaEngine,
  policy: BackgroundPolicy,
  clock: SchedulerClock,
  options: CompletionDriverOptions,
): CompletionDriver {
  const validatedEngine = validateEngineSurface(engine);
  const validatedPolicy = validateBackgroundPolicy(policy);
  if (typeof clock !== "function") {
    throw invalidInput(
      "createCompletionDriver: clock must be a function () => number",
    );
  }
  if (typeof options !== "object" || options === null) {
    throw invalidInput("createCompletionDriver: options must be an object");
  }
  const environment = validateBackgroundEnvironment(options.environment);
  const sink = validateSinkShape(options.completionSink);
  const scheduler = createScheduler(
    validatedEngine,
    options.schedulerConfig ?? {},
    clock,
  );
  const governor =
    options.governor === undefined
      ? createStorageGovernor(validatedPolicy.storage)
      : validateGovernorShape(options.governor);
  return new CompletionDriverImpl(
    validatedEngine,
    validatedPolicy,
    clock,
    environment,
    sink,
    scheduler,
    governor,
  );
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** What the driver tracks per backgrounded session (internal, mutable). */
interface TrackedSession {
  readonly sessionId: string;
  readonly assetId: string;
  /** Latest host-pushed snapshot (validated). */
  session: NativeMediaSession;
  /** Host scheduling facts; null ⇒ tracked but unschedulable. */
  facts: BackgroundDemandFacts | null;
  status: "active" | "paused";
  pauseCause: "policy" | "concurrency" | null;
  pauseReason: string;
  pausedAtMs: number | null;
  /** Monotonic pause sequence — the stable FIFO release order. */
  pauseSeq: number | null;
}

/** Log target: a tracked record or a bare (sessionId, assetId) pair. */
interface LogTarget {
  readonly sessionId: string;
  readonly assetId: string;
}

class CompletionDriverImpl implements CompletionDriver {
  /** Insertion ordered: deterministic re-evaluation + stats order. */
  private readonly tracked = new Map<string, TrackedSession>();
  private readonly logEntries: BackgroundLogEntry[] = [];
  private readonly failures: BackgroundFailure[] = [];
  /** Failures recorded during the current (or last) public operation. */
  private opFailures: BackgroundFailure[] = [];
  private readonly environment: { current: BackgroundEnvironment };
  private completions = 0;
  private sessionFailures = 0;
  private cancels = 0;
  private pauseSeqCounter = 0;
  /** Serializes public operations in call order (state never interleaves). */
  private queueTail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly engine: NativeMediaEngine,
    private readonly policy: BackgroundPolicy,
    private readonly clock: SchedulerClock,
    initialEnvironment: BackgroundEnvironment,
    private readonly sink: CompletionSink,
    private readonly scheduler: Scheduler,
    private readonly governor: StorageGovernor,
  ) {
    this.environment = { current: initialEnvironment };
  }

  // --- public surface ------------------------------------------------------

  async onSessionBackground(
    session: NativeMediaSession,
    facts?: BackgroundDemandFacts,
  ): Promise<BackgroundOutcome> {
    const validated = validateBackgroundSession(session);
    const validatedFacts =
      facts === undefined ? null : this.validateFacts(validated.id, facts);
    return this.enqueue(async () => {
      this.opFailures = [];
      const engineCalls: EngineCallOutcome[] = [];
      const policyDecision = decideCompletion(
        validated,
        this.policy.completion,
        this.environment.current,
      );

      const existing = this.tracked.get(validated.id);
      if (existing !== undefined) {
        // Re-push: refresh the snapshot/facts and re-apply the decision.
        existing.session = validated;
        if (validatedFacts !== null) existing.facts = validatedFacts;
        const applied = await this.applyDecision(
          existing,
          policyDecision,
          "background",
          engineCalls,
        );
        return this.buildOutcome(existing, policyDecision, applied, engineCalls);
      }

      // Fresh session: bind it to its asset so cancel/failed releases work.
      this.governor.associate(validated.id, validated.assetId);

      if (policyDecision.action === "cancel") {
        const closeResult = await this.engineCall(
          validated.id,
          "close",
          engineCalls,
        );
        // Cache release on cancel — unless the session completed (a
        // finished download persists per storage policy).
        const release =
          validated.state === "complete"
            ? undefined
            : this.governor.release(validated.id);
        const cause =
          validated.state === "complete" || validated.state === "failed"
            ? "terminal"
            : "policy";
        if (closeResult.ok) {
          this.cancels += 1;
          this.appendLog(
            { sessionId: validated.id, assetId: validated.assetId },
            "cancel",
            cause,
            policyDecision.reason,
          );
        } else {
          const error = closeResult.error;
          this.appendLog(
            { sessionId: validated.id, assetId: validated.assetId },
            "cancel",
            "engine-failure",
            policyDecision.reason,
            error,
          );
        }
        const outcome: BackgroundOutcome = {
          sessionId: validated.id,
          policyDecision,
          effective: policyDecision,
          transition: "cancel",
          schedulable: false,
          engineCalls,
        };
        return release === undefined
          ? outcome
          : { ...outcome, release };
      }

      // Fresh continue/pause: create the record, then apply the cap.
      const record: TrackedSession = {
        sessionId: validated.id,
        assetId: validated.assetId,
        session: validated,
        facts: validatedFacts,
        status: policyDecision.action === "continue" ? "active" : "paused",
        pauseCause: null,
        pauseReason: "",
        pausedAtMs: null,
        pauseSeq: null,
      };
      let effective = policyDecision;
      if (
        policyDecision.action === "continue" &&
        this.activeCount() >= this.policy.completion.maxConcurrentCompletions
      ) {
        // Cap override: the policy allows continuing, the cap does not.
        const capReason = this.capReason();
        record.status = "paused";
        record.pauseCause = "concurrency";
        record.pauseReason = capReason;
        record.pausedAtMs = this.now();
        record.pauseSeq = this.nextPauseSeq();
        effective = { action: "pause", reason: capReason };
      } else if (policyDecision.action === "pause") {
        record.pauseCause = "policy";
        record.pauseReason = policyDecision.reason;
        record.pausedAtMs = this.now();
        record.pauseSeq = this.nextPauseSeq();
      }
      this.tracked.set(record.sessionId, record);

      if (record.status === "paused") {
        const pauseResult = await this.engineCall(
          record.sessionId,
          "pause",
          engineCalls,
        );
        if (pauseResult.ok) {
          this.appendLog(
            record,
            "pause",
            record.pauseCause === "concurrency" ? "concurrency" : "policy",
            record.pauseReason,
          );
        } else {
          this.appendLog(
            record,
            "pause",
            "engine-failure",
            record.pauseReason,
            pauseResult.error,
          );
        }
      } else {
        this.appendLog(record, "continue", "policy", policyDecision.reason);
      }
      return this.buildOutcomeForValues(
        record,
        policyDecision,
        effective,
        record.status === "active" ? "continue" : "pause",
        engineCalls,
      );
    });
  }

  async onEnvironmentChange(
    environment: BackgroundEnvironment,
  ): Promise<EnvironmentChangeReport> {
    const validated = validateBackgroundEnvironment(environment);
    return this.enqueue(async () => {
      this.opFailures = [];
      const previous = this.environment.current;
      this.environment.current = validated;
      const outcomes: BackgroundOutcome[] = [];
      for (const record of [...this.tracked.values()]) {
        const decision = decideCompletion(
          record.session,
          this.policy.completion,
          validated,
        );
        const engineCalls: EngineCallOutcome[] = [];
        const applied = await this.applyDecision(
          record,
          decision,
          "environment",
          engineCalls,
        );
        outcomes.push(
          this.buildOutcome(record, decision, applied, engineCalls),
        );
      }
      return {
        environment: validated,
        previousEnvironment: previous,
        outcomes,
      };
    });
  }

  async onSessionUpdate(
    session: NativeMediaSession,
    metrics?: SessionMetrics,
  ): Promise<SessionUpdateOutcome> {
    const validated = validateBackgroundSession(session);
    const validatedMetrics = metrics === undefined ? undefined : validateMetrics(metrics);
    return this.enqueue(async () => {
      this.opFailures = [];
      const engineCalls: EngineCallOutcome[] = [];
      const record = this.tracked.get(validated.id);
      if (record === undefined) {
        return {
          sessionId: validated.id,
          recognized: false,
          completed: false,
          failed: false,
          engineCalls,
        };
      }
      record.session = validated;
      if (record.facts !== null) {
        // Refresh the derived scheduling facts from real snapshot data.
        record.facts = {
          ...record.facts,
          positionMs: validated.positionMs,
          bufferAheadMs: Math.max(0, validated.bufferedMs - validated.positionMs),
        };
      }

      if (validated.state === "complete") {
        return await this.handleCompletion(record, validatedMetrics, engineCalls);
      }
      if (validated.state === "failed") {
        return await this.handleFailure(record, engineCalls);
      }
      return {
        sessionId: validated.id,
        recognized: true,
        completed: false,
        failed: false,
        engineCalls,
      };
    });
  }

  async tick(): Promise<SchedulerTickReport> {
    return this.enqueue(async () => {
      this.opFailures = [];
      const demands: PlaybackDemand[] = [];
      for (const record of this.tracked.values()) {
        if (record.status !== "active" || record.facts === null) continue;
        const facts = record.facts;
        demands.push({
          sessionId: record.sessionId,
          state: "background",
          positionMs: facts.positionMs,
          playbackRate: facts.playbackRate,
          bitrateBps: facts.bitrateBps,
          bufferAheadMs: facts.bufferAheadMs,
          stallBudgetMs: facts.stallBudgetMs,
        });
      }
      return this.scheduler.tick(demands);
    });
  }

  log(): BackgroundLog {
    return [...this.logEntries];
  }

  stats(): CompletionDriverStats {
    const active: string[] = [];
    const paused: PausedSessionInfo[] = [];
    const unschedulable: string[] = [];
    for (const record of this.tracked.values()) {
      if (record.status === "active") {
        active.push(record.sessionId);
        if (record.facts === null) unschedulable.push(record.sessionId);
      } else {
        paused.push({
          sessionId: record.sessionId,
          assetId: record.assetId,
          cause: record.pauseCause === "concurrency" ? "concurrency" : "policy",
          reason: record.pauseReason,
          pausedAtMs: record.pausedAtMs ?? 0,
        });
      }
    }
    paused.sort((a, b) => a.pausedAtMs - b.pausedAtMs);
    return {
      environment: { ...this.environment.current },
      activeCompletions: active,
      paused,
      unschedulable,
      trackedSessions: this.tracked.size,
      completions: this.completions,
      sessionFailures: this.sessionFailures,
      cancels: this.cancels,
      failureCount: this.failures.length,
      lastErrors: [...this.opFailures],
    };
  }

  storage(): StorageGovernor {
    return this.governor;
  }

  // --- decision application ------------------------------------------------

  /**
   * Apply a decision to an EXISTING tracked record (re-evaluation). The
   * trigger shapes the log cause. Returns the applied transition (null
   * when nothing changed) and the effective decision.
   */
  private async applyDecision(
    record: TrackedSession,
    decision: CompletionDecision,
    trigger: "background" | "environment",
    engineCalls: EngineCallOutcome[],
  ): Promise<{
    transition: BackgroundTransition | null;
    effective: CompletionDecision;
    release?: StorageReleaseResult;
  }> {
    if (decision.action === "cancel") {
      return await this.applyCancel(record, decision, engineCalls);
    }
    if (decision.action === "pause") {
      const cause = trigger === "environment" ? "environment" : "policy";
      if (record.status === "active") {
        const pauseResult = await this.engineCall(
          record.sessionId,
          "pause",
          engineCalls,
        );
        this.markPaused(record, "policy", decision.reason);
        if (pauseResult.ok) {
          this.appendLog(record, "pause", cause, decision.reason);
        } else {
          this.appendLog(
            record,
            "pause",
            "engine-failure",
            decision.reason,
            pauseResult.error,
          );
        }
        return { transition: "pause", effective: decision };
      }
      // Already paused: record a cause change only (audit, no noise).
      if (record.pauseCause !== "policy" || record.pauseReason !== decision.reason) {
        this.markPaused(record, "policy", decision.reason);
        this.appendLog(record, "pause", cause, decision.reason);
      }
      return { transition: null, effective: decision };
    }

    // decision.action === "continue"
    if (record.status === "active") {
      return { transition: null, effective: decision };
    }
    if (this.activeCount() >= this.policy.completion.maxConcurrentCompletions) {
      // Policy allows, the cap does not: stay paused under the cap cause.
      const capReason = this.capReason();
      if (record.pauseCause !== "concurrency" || record.pauseReason !== capReason) {
        this.markPaused(record, "concurrency", capReason);
        this.appendLog(record, "pause", "concurrency", capReason);
      }
      return { transition: null, effective: { action: "pause", reason: capReason } };
    }
    const resumeResult = await this.engineCall(
      record.sessionId,
      "resume",
      engineCalls,
    );
    if (resumeResult.ok) {
      this.markActive(record);
      this.appendLog(
        record,
        "resume",
        trigger === "environment" ? "environment" : "policy",
        decision.reason,
      );
      return { transition: "resume", effective: decision };
    }
    this.appendLog(
      record,
      "resume",
      "engine-failure",
      decision.reason,
      resumeResult.error,
    );
    return { transition: null, effective: decision };
  }

  /** Cancel path: close the engine session, release per policy, remove. */
  private async applyCancel(
    record: TrackedSession,
    decision: CompletionDecision,
    engineCalls: EngineCallOutcome[],
  ): Promise<{
    transition: BackgroundTransition | null;
    effective: CompletionDecision;
    release?: StorageReleaseResult;
  }> {
    const wasActive = record.status === "active";
    const closeResult = await this.engineCall(
      record.sessionId,
      "close",
      engineCalls,
    );
    const release =
      record.session.state === "complete"
        ? undefined
        : this.governor.release(record.sessionId);
    this.tracked.delete(record.sessionId);
    const cause =
      record.session.state === "complete" || record.session.state === "failed"
        ? "terminal"
        : "policy";
    if (closeResult.ok) {
      this.cancels += 1;
      this.appendLog(record, "cancel", cause, decision.reason);
    } else {
      this.appendLog(
        record,
        "cancel",
        "engine-failure",
        decision.reason,
        closeResult.error,
      );
    }
    if (wasActive) {
      await this.resumeFifo(engineCalls);
    }
    if (release === undefined) {
      return { transition: "cancel", effective: decision };
    }
    return { transition: "cancel", effective: decision, release };
  }

  /**
   * FIFO release: a concurrency slot freed — resume the earliest
   * cap-paused sessions (pause order) that the CURRENT environment still
   * allows. Engine failures are recorded and the next candidate is tried;
   * the driver survives.
   */
  private async resumeFifo(engineCalls: EngineCallOutcome[]): Promise<void> {
    const candidates = [...this.tracked.values()]
      .filter(
        (record) => record.status === "paused" && record.pauseCause === "concurrency",
      )
      .sort((a, b) => (a.pauseSeq ?? 0) - (b.pauseSeq ?? 0));
    for (const candidate of candidates) {
      if (this.activeCount() >= this.policy.completion.maxConcurrentCompletions) {
        break;
      }
      const decision = decideCompletion(
        candidate.session,
        this.policy.completion,
        this.environment.current,
      );
      if (decision.action === "cancel") {
        // Defensive: cap-paused records are non-terminal by construction,
        // but an injected snapshot could say otherwise — handle it typed.
        await this.applyCancel(candidate, decision, engineCalls);
        continue;
      }
      if (decision.action === "pause") {
        // The environment no longer allows this session to continue.
        if (candidate.pauseCause !== "policy") {
          this.markPaused(candidate, "policy", decision.reason);
          this.appendLog(candidate, "pause", "environment", decision.reason);
        }
        continue;
      }
      const resumeResult = await this.engineCall(
        candidate.sessionId,
        "resume",
        engineCalls,
      );
      if (resumeResult.ok) {
        this.markActive(candidate);
        this.appendLog(candidate, "resume", "slot-freed", decision.reason);
      } else {
        this.appendLog(
          candidate,
          "resume",
          "engine-failure",
          decision.reason,
          resumeResult.error,
        );
      }
    }
  }

  // --- completion / failure handling ----------------------------------------

  private async handleCompletion(
    record: TrackedSession,
    metrics: SessionMetrics | undefined,
    engineCalls: EngineCallOutcome[],
  ): Promise<SessionUpdateOutcome> {
    const wasActive = record.status === "active";
    this.tracked.delete(record.sessionId);

    // Mark persistent per StoragePolicy.protectedItems.
    let persistent = false;
    if (this.governor.isProtected(record.assetId)) {
      const mark = this.governor.markPersistent(record.assetId);
      persistent = mark.ok;
    }

    // Emit the typed event to the injected sink — exactly once, with
    // host-reported bytes. Without metrics this is a TYPED REFUSAL: the
    // driver never fabricates a byte count.
    let event: CompletionEvent | undefined;
    let refusal: NativeMediaError | undefined;
    if (metrics !== undefined) {
      event = {
        sessionId: record.sessionId,
        assetId: record.assetId,
        completedAt: this.now(),
        totalBytes: metrics.totalBytes,
      };
      try {
        await this.sink.onCompletion(event);
      } catch (e) {
        const error = mapEngineError(e, record.sessionId);
        this.recordFailure(record.sessionId, "completion-event", error);
        this.appendLog(
          record,
          "complete",
          "engine-failure",
          `completion event sink failed: ${error.message}`,
          error,
        );
      }
    } else {
      refusal = new NativeMediaError("INVALID_INPUT", {
        sessionId: record.sessionId,
        detail:
          `onSessionUpdate: session '${record.sessionId}' reached complete without metrics.totalBytes — ` +
          "the CompletionEvent requires the host-reported total byte count; no event was emitted",
      });
      this.recordFailure(record.sessionId, "completion-event", refusal);
    }

    this.completions += 1;
    this.appendLog(
      record,
      "complete",
      "completion",
      `session '${record.sessionId}' reached complete — evicted from active completions` +
        (persistent
          ? `; asset '${record.assetId}' marked persistent per StoragePolicy.protectedItems`
          : ""),
    );
    if (wasActive) {
      await this.resumeFifo(engineCalls);
    }
    const outcome: SessionUpdateOutcome = {
      sessionId: record.sessionId,
      recognized: true,
      completed: true,
      failed: false,
      engineCalls,
      ...(event !== undefined ? { event } : {}),
      ...(refusal !== undefined ? { completionRefusal: refusal } : {}),
    };
    return outcome;
  }

  private async handleFailure(
    record: TrackedSession,
    engineCalls: EngineCallOutcome[],
  ): Promise<SessionUpdateOutcome> {
    const wasActive = record.status === "active";
    this.tracked.delete(record.sessionId);
    const release = this.governor.release(record.sessionId);
    this.sessionFailures += 1;
    this.appendLog(
      record,
      "failed",
      "session-failure",
      `session '${record.sessionId}' reached failed — ${describeRelease(release)}`,
    );
    if (wasActive) {
      await this.resumeFifo(engineCalls);
    }
    return {
      sessionId: record.sessionId,
      recognized: true,
      completed: false,
      failed: true,
      engineCalls,
      release,
    };
  }

  // --- helpers --------------------------------------------------------------

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queueTail.then(run, run);
    // Keep the chain alive regardless of this operation's outcome.
    this.queueTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private now(): number {
    const atMs = this.clock();
    if (typeof atMs !== "number" || !Number.isFinite(atMs) || atMs < 0) {
      throw invalidInput(
        `clock() must return a finite number >= 0 (got ${String(atMs)})`,
      );
    }
    return atMs;
  }

  private validateFacts(
    sessionId: string,
    facts: BackgroundDemandFacts,
  ): BackgroundDemandFacts {
    const demand = validatePlaybackDemand({
      sessionId,
      state: "background",
      ...facts,
    });
    return {
      positionMs: demand.positionMs,
      playbackRate: demand.playbackRate,
      bitrateBps: demand.bitrateBps,
      bufferAheadMs: demand.bufferAheadMs,
      stallBudgetMs: demand.stallBudgetMs,
    };
  }

  private activeCount(): number {
    let count = 0;
    for (const record of this.tracked.values()) {
      if (record.status === "active") count += 1;
    }
    return count;
  }

  private capReason(): string {
    return (
      `maxConcurrentCompletions (${this.policy.completion.maxConcurrentCompletions}) reached — ` +
      "session paused (resumable; resumes FIFO when a completion slot frees)"
    );
  }

  private nextPauseSeq(): number {
    this.pauseSeqCounter += 1;
    return this.pauseSeqCounter;
  }

  private markPaused(
    record: TrackedSession,
    cause: "policy" | "concurrency",
    reason: string,
  ): void {
    record.status = "paused";
    record.pauseCause = cause;
    record.pauseReason = reason;
    record.pausedAtMs = this.now();
    if (record.pauseSeq === null) record.pauseSeq = this.nextPauseSeq();
  }

  private markActive(record: TrackedSession): void {
    record.status = "active";
    record.pauseCause = null;
    record.pauseReason = "";
    record.pausedAtMs = null;
    record.pauseSeq = null;
  }

  private appendLog(
    target: LogTarget,
    transition: BackgroundTransition,
    cause: BackgroundCause,
    reason: string,
    error?: NativeMediaError,
  ): void {
    const entry: BackgroundLogEntry =
      error === undefined
        ? {
            atMs: this.now(),
            sessionId: target.sessionId,
            assetId: target.assetId,
            transition,
            cause,
            reason,
          }
        : {
            atMs: this.now(),
            sessionId: target.sessionId,
            assetId: target.assetId,
            transition,
            cause,
            reason,
            error,
          };
    this.logEntries.push(entry);
  }

  private recordFailure(
    sessionId: string,
    operation: BackgroundFailure["operation"],
    error: NativeMediaError,
  ): void {
    const failure: BackgroundFailure = {
      sessionId,
      operation,
      error,
      atMs: this.now(),
    };
    this.failures.push(failure);
    this.opFailures.push(failure);
  }

  /**
   * Issue one engine control call with the merged WFX-004 service
   * convention: failures are mapped with `mapEngineError` into typed
   * envelopes, recorded as `BackgroundFailure`s, and NEVER thrown — the
   * driver survives.
   */
  private async engineCall(
    sessionId: string,
    operation: "pause" | "resume" | "close",
    engineCalls: EngineCallOutcome[],
  ): Promise<ServiceResponse<{ sessionId: string }>> {
    let result: ServiceResponse<{ sessionId: string }>;
    try {
      if (operation === "pause") {
        await this.engine.pause(sessionId);
      } else if (operation === "resume") {
        await this.engine.resume(sessionId);
      } else {
        await this.engine.close(sessionId);
      }
      result = { ok: true, value: { sessionId } };
    } catch (e) {
      const error = mapEngineError(e, sessionId);
      this.recordFailure(sessionId, operation, error);
      result = { ok: false, error };
    }
    engineCalls.push({ sessionId, operation, result });
    return result;
  }

  private buildOutcome(
    record: TrackedSession,
    policyDecision: CompletionDecision,
    applied: {
      transition: BackgroundTransition | null;
      effective: CompletionDecision;
      release?: StorageReleaseResult;
    },
    engineCalls: readonly EngineCallOutcome[],
  ): BackgroundOutcome {
    return this.buildOutcomeForValues(
      record,
      policyDecision,
      applied.effective,
      applied.transition,
      engineCalls,
      applied.release,
    );
  }

  private buildOutcomeForValues(
    record: TrackedSession,
    policyDecision: CompletionDecision,
    effective: CompletionDecision,
    transition: BackgroundTransition | null,
    engineCalls: readonly EngineCallOutcome[],
    release?: StorageReleaseResult,
  ): BackgroundOutcome {
    const schedulable = record.status === "active" && record.facts !== null;
    const outcome: BackgroundOutcome = {
      sessionId: record.sessionId,
      policyDecision,
      effective,
      transition,
      schedulable,
      engineCalls,
    };
    return release === undefined ? outcome : { ...outcome, release };
  }
}

/** Human summary of a release result for log reasons. */
function describeRelease(release: StorageReleaseResult): string {
  if (release.ok) {
    return release.note === undefined
      ? `session cache released (${release.freedBytes} bytes freed)`
      : `session cache release: ${release.note}`;
  }
  return `cache release refused (${release.refusal.reason})`;
}
