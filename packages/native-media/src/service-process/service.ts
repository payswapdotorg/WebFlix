/**
 * @wfx/native-media — the engine service host (R10, production assembly).
 *
 * `createEngineService(config)` assembles THE PRODUCTION SERVICE the
 * spawnable entry (`main.ts`) hosts and in-process consumers (tests,
 * embeddings) use directly:
 *
 * ```text
 *                     ┌── journal (open/control/state/evidence) ──┐
 *   wire commands ──>  │ dispatchCommand: engine op + journaling   │ ──> state-changed acks
 *                     └───────────────────────────────────────────┘
 *   engine updates ──> journal state transitions, background-completion
 *                      detection (the merged WFX-024 driver), gateway
 *                      asset-map refresh
 *   playback demand ─> the merged WFX-023 scheduler over a RELATIVE→ABSOLUTE
 *                      piece adapter (the honest R12 wiring point)
 *   stored assets  ──> the production range gateway (loopback HTTP,
 *                      Range/ETag/416 over the real bytes)
 *   startup        ─> RECOVERY: journal replay, re-stat, honest restore
 * ```
 *
 * PRODUCTION DECISIONS (documented for lead review):
 *
 * 1. BACKGROUND ADMISSION IS POLICY-GATED. A wire `pause` of a `playing`
 *    session consults `decideCompletion` (WFX-024 policy × the injected
 *    environment): `continue` ⇒ the FSM-legal `playing -> background` hop
 *    + the completion driver tracks it (cap, FIFO, events); anything else
 *    ⇒ no background admission (the session stays paused — never a
 *    spurious driver resume of user-paused playback). R10's sources are
 *    local files + the store, so the environment gates scheduling
 *    structurally; the byte-real network gating arrives with R11's
 *    torrent source through the same driver.
 * 2. COMPLETION DETECTION FLOWS FROM THE ENGINE'S OWN UPDATES. The engine
 *    completes a session only after persist + digest verification
 *    (engine.ts law 3); the host observes the `complete` update, pushes
 *    the snapshot (+ the REAL stored size as metrics — never a fabricated
 *    byte count) to the driver, which emits its typed CompletionEvent
 *    exactly once and the host journals it as evidence.
 * 3. THE FOREGROUND SCHEDULER WIRES THROUGH A TRANSLATING ADAPTER. The
 *    merged WFX-023 `createScheduler` plans PIECE-RELATIVE ordinals
 *    (k=0 at the playhead — its documented model); the real engine's
 *    `prioritize` speaks ABSOLUTE indices (engine.ts law 5). The adapter
 *    translates `anchor + k` (anchor = the playhead's piece) and drops
 *    out-of-range ordinals — the honest pass-through R12 deepens.
 * 4. RECOVERY IS EXPLICIT AND JOURNALED. `recover()` replays the journal
 *    (torn-tail tolerant), re-opens non-terminal sessions with their OWN
 *    ids at their last journaled control point (the documented
 *    paused-by-restart mapping: `buffering`, buffered honestly 0, frozen
 *    clock until `resume`), marks `failed` (with honest detail) the ones
 *    whose bytes vanished, journals every decision, and emits each
 *    verdict on the wire through the engine's update channel (v1
 *    consumers ignore unknown-session snapshots by law — safe).
 * 5. KNOWN LIMITATION (R12/R13): closing a driver-tracked background
 *    session leaves the driver's record in place — its ticks then record
 *    typed NOT_FOUND failures (never swallowed, never fatal). The frozen
 *    driver surface has no removal API; deepening its lifecycle is R13's
 *    persistence item.
 */

import type { NativeMediaEngine, NativeMediaSession } from "@wfx/domain";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { NativeMediaError } from "../errors";
import { mapEngineError } from "../service";
import {
  errorToEvent,
  PROTOCOL_VERSION,
  sessionToDto,
  type EngineCommand,
  type EngineEvent,
} from "../engine/process";
import { createScheduler } from "../scheduler/drive";
import type {
  SchedulerClock,
  SchedulerTickReport,
} from "../scheduler/drive";
import type {
  PlaybackDemand,
  SchedulerConfigInput,
} from "../scheduler/model";
import {
  decideCompletion,
  DEFAULT_COMPLETION_POLICY,
  validateBackgroundEnvironment,
  type BackgroundEnvironment,
  type CompletionPolicy,
} from "../background/policy";
import {
  createCompletionDriver,
  type CompletionDriver,
  type CompletionEvent,
  type EnvironmentChangeReport,
} from "../background/completion-driver";

import {
  createRealEngine,
  type RealEngine,
  type RealEngineConfig,
  type SessionGeometryInfo,
} from "./engine";
import {
  createSessionJournal,
  type JournalRecord,
  type SessionJournal,
} from "./journal";
import type { AssetStore } from "./store";
import {
  startProductionGateway,
  type ProductionGatewayHandle,
  type ProductionGatewayOptions,
} from "./gateway";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** The engine tunables the service forwards (everything but the store). */
export type EngineTunables = Omit<RealEngineConfig, "storeRoot" | "maxCacheBytes">;

/** Background completion wiring options. */
export interface CompletionWiringOptions {
  /** Partial completion policy merged over the WFX-024 defaults. */
  readonly policy?: Partial<CompletionPolicy>;
  /**
   * The initial injected environment. Default: `{ networkClass: "wifi",
   * charging: true }` (the permissive host default — the host OWNS the
   * truth and updates it via {@link EngineServiceHandle.setEnvironment}).
   */
  readonly environment?: BackgroundEnvironment;
}

/** Options for {@link createEngineService}. */
export interface EngineServiceConfig {
  /** The store root (== the spawn `EngineConfig.cacheDir`). */
  readonly cacheDir: string;
  /** The store policy budget (== the spawn `EngineConfig.maxCacheBytes`). */
  readonly maxCacheBytes: number;
  /** Engine tunables (read throughput, nominal bitrate, timers, clock...). */
  readonly engine?: EngineTunables;
  /** The production gateway options; `false` disables the gateway. Default: enabled, ephemeral port. */
  readonly gateway?: ProductionGatewayOptions | false;
  /** Background completion wiring. Default: WFX-024 policy defaults + the permissive environment. */
  readonly completion?: CompletionWiringOptions;
  /** Scheduler config for the foreground wiring. Default: the merged defaults. */
  readonly scheduler?: SchedulerConfigInput;
  /** Run the periodic scheduler/driver tick automatically. Default: `true`. */
  readonly autoTick?: boolean;
  /** The periodic scheduler/driver tick interval, ms. Default: 250. */
  readonly schedulerTickMs?: number;
  /**
   * The default stall budget reported in foreground playback demands, ms.
   * Default: 2000.
   */
  readonly stallBudgetMs?: number;
}

// ---------------------------------------------------------------------------
// Recovery + service shapes
// ---------------------------------------------------------------------------

/** One recovered session (the journal replay verdict). */
export interface RecoveredSessionReport {
  readonly sessionId: string;
  readonly state: NativeMediaSession["state"];
  readonly positionMs: number;
}

/** One honestly-failed recovery (the bytes vanished / verification failed). */
export interface FailedRecoveryReport {
  readonly sessionId: string;
  readonly detail: string;
}

/** The report of one recovery pass. */
export interface RecoveryReport {
  readonly recovered: readonly RecoveredSessionReport[];
  readonly failed: readonly FailedRecoveryReport[];
}

/** The assembled production engine service. */
export interface EngineServiceHandle {
  /** The REAL engine (sessions, read-ahead, store, integrity). */
  readonly engine: RealEngine;
  /** The asset store (digests, layout, quota). */
  readonly store: AssetStore;
  /** The append-only session journal. */
  readonly journal: SessionJournal;
  /** The production range gateway; `undefined` when disabled by config. */
  readonly gateway: ProductionGatewayHandle | undefined;
  /** The merged WFX-024 background completion driver. */
  readonly completionDriver: CompletionDriver;
  /** Replay the journal and restore/fail the recoverable sessions (idempotent per session). */
  recover(): Promise<RecoveryReport>;
  /**
   * Dispatch ONE wire command: journal it, apply it to the engine, apply
   * the background-admission policy, and answer the v1 `state-changed`
   * acknowledgment. Engine failures throw typed `NativeMediaError`s (the
   * caller maps them to `error` event DTOs).
   */
  dispatchCommand(
    command: EngineCommand,
  ): Promise<Extract<EngineEvent, { kind: "state-changed" }>>;
  /** One foreground scheduling pass (the translated WFX-023 tick). */
  tickScheduler(): Promise<SchedulerTickReport>;
  /** Update the injected environment (re-evaluates tracked background sessions). */
  setEnvironment(environment: BackgroundEnvironment): Promise<EnvironmentChangeReport>;
  /** Subscribe to engine session updates (the raw observability channel). */
  onSessionUpdate(listener: (session: NativeMediaSession) => void): () => void;
  /** Graceful shutdown: gateway, timers, engine. Idempotent. */
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// The relative→absolute piece adapter (the honest R12 wiring point)
// ---------------------------------------------------------------------------

/**
 * Wrap the real engine for the merged scheduler: `prioritize` deadlines
 * arrive as playhead-RELATIVE ordinals (k=0 at the current position — the
 * WFX-023 model) and are translated onto the engine's ABSOLUTE geometry
 * as `anchor + k` (out-of-range ordinals dropped — the model's "media end
 * is unknown" law). Every other operation delegates verbatim.
 */
export function createRelativePieceAdapter(engine: RealEngine): NativeMediaEngine {
  return {
    open: (input) => engine.open(input),
    seek: (sessionId, positionMs) => engine.seek(sessionId, positionMs),
    pause: (sessionId) => engine.pause(sessionId),
    resume: (sessionId) => engine.resume(sessionId),
    close: (sessionId) => engine.close(sessionId),
    async prioritize(
      sessionId: string,
      deadlines: { piece: number; deadlineMs: number }[],
    ): Promise<void> {
      const geometry: SessionGeometryInfo | undefined =
        engine.sessionGeometry(sessionId);
      if (geometry === undefined) {
        throw new NativeMediaError("NOT_FOUND", {
          detail: `prioritize: session '${sessionId}' does not exist`,
          sessionId,
        });
      }
      const translated = deadlines
        .map((d) => ({ piece: geometry.playheadPiece + d.piece, deadlineMs: d.deadlineMs }))
        .filter((d) => d.piece < geometry.pieceCount);
      await engine.prioritize(sessionId, translated);
    },
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_SCHEDULER_TICK_MS = 250;
const DEFAULT_STALL_BUDGET_MS = 2_000;
const DEFAULT_ENVIRONMENT: BackgroundEnvironment = {
  networkClass: "wifi",
  charging: true,
};

class EngineServiceImpl implements EngineServiceHandle {
  readonly engine: RealEngine;
  readonly store: AssetStore;
  readonly journal: SessionJournal;
  readonly gateway: ProductionGatewayHandle | undefined;
  readonly completionDriver: CompletionDriver;
  private readonly completionPolicy: CompletionPolicy;
  private readonly environment: { current: BackgroundEnvironment };
  private readonly foregroundScheduler: ReturnType<typeof createScheduler>;
  private readonly stallBudgetMs: number;
  private readonly nominalBitrateBps: number;
  private readonly updateListeners = new Set<(session: NativeMediaSession) => void>();
  /** Last journaled state per session (transition journaling). */
  private readonly journaledState = new Map<string, NativeMediaSession>();
  private tickTimer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;

  constructor(config: EngineServiceConfig, clock: SchedulerClock) {
    this.engine = createRealEngine({
      ...(config.engine ?? {}),
      storeRoot: config.cacheDir,
      maxCacheBytes: config.maxCacheBytes,
      clock,
    });
    this.store = this.engine.store;
    this.journal = createSessionJournal(config.cacheDir, { clock: () => Date.now() });
    this.gateway =
      config.gateway === false
        ? undefined
        : startProductionGateway(this.engine, config.gateway ?? {});
    this.completionPolicy = {
      mode: config.completion?.policy?.mode ?? DEFAULT_COMPLETION_POLICY.mode,
      maxConcurrentCompletions:
        config.completion?.policy?.maxConcurrentCompletions ??
        DEFAULT_COMPLETION_POLICY.maxConcurrentCompletions,
    };
    this.environment = {
      current:
        config.completion?.environment !== undefined
          ? validateBackgroundEnvironment(config.completion.environment)
          : DEFAULT_ENVIRONMENT,
    };
    this.stallBudgetMs = config.stallBudgetMs ?? DEFAULT_STALL_BUDGET_MS;
    this.nominalBitrateBps =
      config.engine?.nominalBitrateBps ?? 2_000_000;
    this.foregroundScheduler = createScheduler(
      createRelativePieceAdapter(this.engine),
      config.scheduler ?? {},
      clock,
    );
    this.completionDriver = createCompletionDriver(
      this.engine,
      { completion: this.completionPolicy, storage: { maxCacheBytes: config.maxCacheBytes, protectedItems: [], evictOrder: "lru", minFreeBytes: 0 } },
      clock,
      {
        environment: this.environment.current,
        completionSink: {
          onCompletion: (event: CompletionEvent) => {
            this.journal.appendEvidence("background-completion", {
              sessionId: event.sessionId,
              assetId: event.assetId,
              totalBytes: event.totalBytes,
              completedAt: event.completedAt,
            });
          },
        },
      },
    );
    // Engine updates drive: transition journaling, completion detection
    // (the driver), the gateway asset map, and the raw listeners.
    this.engine.onUpdate((session) => this.onEngineUpdate(session));
    if (config.autoTick ?? true) {
      const interval = config.schedulerTickMs ?? DEFAULT_SCHEDULER_TICK_MS;
      this.tickTimer = setInterval(() => {
        void this.periodicTick();
      }, interval);
    }
    this.writeEngineInfo();
  }

  // --- recovery ----------------------------------------------------------------

  async recover(): Promise<RecoveryReport> {
    if (this.disposed) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "recover: the engine service is disposed",
      });
    }
    this.journal.appendEvidence("engine-start", {
      protocolVersion: PROTOCOL_VERSION,
      pid: process.pid,
    });
    const recovered: RecoveredSessionReport[] = [];
    const failed: FailedRecoveryReport[] = [];
    for (const candidate of this.journal.recoverableSessions()) {
      if (this.engine.snapshot(candidate.sessionId) !== undefined) {
        continue; // already live (idempotent recovery)
      }
      try {
        const session = await this.engine.restoreSession({
          sessionId: candidate.sessionId,
          sourcePath: candidate.sourcePath,
          positionMs: candidate.positionMs,
          ...(candidate.integrity !== "unknown"
            ? { integrity: candidate.integrity }
            : {}),
        });
        this.journaledState.set(session.id, session);
        this.journal.appendState({
          sessionId: session.id,
          state: session.state,
          bufferedMs: session.bufferedMs,
          positionMs: session.positionMs,
          integrity: session.integrity,
          evidence: {
            recovered: true,
            previousState: candidate.lastState,
            reason: "engine-restart",
            note: "paused-by-restart: buffering at the journaled control point; the clock is frozen until resume",
          },
        });
        recovered.push({
          sessionId: session.id,
          state: session.state,
          positionMs: session.positionMs,
        });
      } catch (e) {
        // The bytes vanished or the stored asset failed verification —
        // the honest failed tombstone (never a fabricated recovery).
        const error = mapEngineError(e, candidate.sessionId);
        const tombstone = this.engine.markRestoredSessionFailed({
          sessionId: candidate.sessionId,
          assetId: candidate.assetId,
          fileId: candidate.fileId,
          detail: error.message,
        });
        this.journaledState.set(tombstone.id, tombstone);
        this.journal.appendState({
          sessionId: candidate.sessionId,
          state: "failed",
          bufferedMs: 0,
          positionMs: candidate.positionMs,
          integrity: "unknown",
          evidence: {
            recovered: true,
            reason: error.code === "VERIFICATION_FAILED" ? "verification-failed" : "source-bytes-vanished",
            detail: error.message,
          },
        });
        failed.push({ sessionId: candidate.sessionId, detail: error.message });
      }
    }
    this.journal.appendEvidence("recovery-complete", {
      recovered: recovered.length,
      failed: failed.length,
    });
    return { recovered, failed };
  }

  // --- command dispatch ----------------------------------------------------------

  async dispatchCommand(
    command: EngineCommand,
  ): Promise<Extract<EngineEvent, { kind: "state-changed" }>> {
    if (this.disposed) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "dispatchCommand: the engine service is disposed",
      });
    }
    switch (command.kind) {
      case "open": {
        const source = command.source;
        const localPath = source.localPath;
        if (localPath === undefined) {
          // The engine would reject it identically; fail fast with the
          // same typed vocabulary.
          throw new NativeMediaError("UNSUPPORTED_SOURCE", {
            detail:
              "open: the R10 production engine serves localPath sources (magnet/torrent ingestion is R11's lane)",
          });
        }
        const session = await this.engine.open({ localPath });
        this.journaledState.set(session.id, session);
        this.journal.appendOpen({
          sessionId: session.id,
          assetId: session.assetId,
          fileId: session.fileId,
          sourcePath: localPath,
          state: session.state,
          positionMs: session.positionMs,
        });
        return this.ack(session);
      }
      case "seek": {
        await this.engine.seek(command.sessionId, command.positionMs);
        return this.controlAck(command.sessionId, "seek", `positionMs=${command.positionMs}`);
      }
      case "prioritize": {
        await this.engine.prioritize(command.sessionId, command.deadlines);
        return this.controlAck(
          command.sessionId,
          "prioritize",
          `${command.deadlines.length} deadline(s)`,
        );
      }
      case "pause": {
        await this.engine.pause(command.sessionId);
        // BACKGROUND ADMISSION (module docs, decision 1): a paused PLAYING
        // session consults the completion policy; `continue` moves it to
        // the background lane (FSM: playing -> background) and the driver
        // tracks it. Anything else: no admission — plain pause. The
        // admission is part of the pause command's processing so the ACK
        // carries the full post-command state.
        const paused = this.engine.snapshot(command.sessionId);
        if (paused !== undefined && paused.state === "playing") {
          const decision = decideCompletion(
            paused,
            this.completionPolicy,
            this.environment.current,
          );
          if (decision.action === "continue") {
            const background = await this.engine.enterBackground(command.sessionId);
            this.journal.appendControl({
              sessionId: command.sessionId,
              kind: "enter-background",
              positionMs: background.positionMs,
              state: background.state,
              detail: decision.reason,
            });
            const facts = this.demandFacts(background);
            await this.completionDriver.onSessionBackground(background, facts);
            this.journal.appendEvidence("background-admission", {
              sessionId: command.sessionId,
              reason: decision.reason,
            });
          }
        }
        return this.controlAck(command.sessionId, "pause");
      }
      case "resume": {
        await this.engine.resume(command.sessionId);
        return this.controlAck(command.sessionId, "resume");
      }
      case "close": {
        // The final snapshot BEFORE the engine forgets the session (the
        // v1 acknowledgment convention).
        const final = this.engine.snapshot(command.sessionId);
        await this.engine.close(command.sessionId);
        this.journaledState.delete(command.sessionId);
        const closed = final ?? {
          id: command.sessionId,
          assetId: "unknown",
          fileId: "unknown",
          state: "failed" as const,
          bufferedMs: 0,
          positionMs: 0,
          integrity: "unknown" as const,
        };
        this.journal.appendControl({
          sessionId: command.sessionId,
          kind: "close",
          positionMs: closed.positionMs,
          state: closed.state,
        });
        return this.ack(closed);
      }
    }
  }

  // --- scheduler + environment -----------------------------------------------------

  async tickScheduler(): Promise<SchedulerTickReport> {
    const demands: PlaybackDemand[] = [];
    for (const session of this.liveSessions()) {
      if (session.state !== "playing") continue;
      demands.push({
        sessionId: session.id,
        state: "playing",
        positionMs: session.positionMs,
        playbackRate: 1,
        bitrateBps: this.nominalBitrateBps,
        bufferAheadMs: Math.max(0, session.bufferedMs - session.positionMs),
        stallBudgetMs: this.stallBudgetMs,
      });
    }
    const report = await this.foregroundScheduler.tick(demands);
    // One background pass through the merged driver (its own internal
    // WFX-023 scheduler applies the background fairness).
    await this.completionDriver.tick();
    return report;
  }

  async setEnvironment(
    environment: BackgroundEnvironment,
  ): Promise<EnvironmentChangeReport> {
    const report = await this.completionDriver.onEnvironmentChange(environment);
    this.environment.current = report.environment;
    this.journal.appendEvidence("environment-change", {
      networkClass: report.environment.networkClass,
      charging: report.environment.charging,
    });
    return report;
  }

  onSessionUpdate(listener: (session: NativeMediaSession) => void): () => void {
    this.updateListeners.add(listener);
    return () => {
      this.updateListeners.delete(listener);
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.tickTimer !== undefined) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }
    this.journal.appendEvidence("shutdown", { pid: process.pid });
    if (this.gateway !== undefined) {
      await this.gateway.stop();
    }
    this.engine.dispose();
    this.updateListeners.clear();
  }

  // --- internals ----------------------------------------------------------------------

  /** The engine's live sessions (snapshot copies, insertion order). */
  private liveSessions(): NativeMediaSession[] {
    const out: NativeMediaSession[] = [];
    for (const id of this.liveSessionIds()) {
      const snapshot = this.engine.snapshot(id);
      if (snapshot !== undefined) out.push(snapshot);
    }
    return out;
  }

  private liveSessionIds(): string[] {
    // The engine exposes snapshots by id; iteration comes from the update
    // journal (every live session was opened/restored through it).
    const ids: string[] = [];
    for (const id of this.journaledState.keys()) {
      if (this.engine.snapshot(id) !== undefined) ids.push(id);
    }
    return ids;
  }

  /** One control command's ack + journal control record. */
  private async controlAck(
    sessionId: string,
    kind: "seek" | "pause" | "resume" | "prioritize",
    detail?: string,
  ): Promise<Extract<EngineEvent, { kind: "state-changed" }>> {
    const snapshot = this.engine.snapshot(sessionId);
    if (snapshot === undefined) {
      throw new NativeMediaError("INTERNAL", {
        detail: `dispatchCommand: session '${sessionId}' vanished during '${kind}'`,
        sessionId,
      });
    }
    this.journal.appendControl({
      sessionId,
      kind,
      positionMs: snapshot.positionMs,
      state: snapshot.state,
      ...(detail !== undefined ? { detail } : {}),
    });
    return this.ack(snapshot);
  }

  /** Render the v1 state-changed acknowledgment for a snapshot. */
  private ack(session: NativeMediaSession): Extract<EngineEvent, { kind: "state-changed" }> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      kind: "state-changed",
      session: sessionToDto(session),
    };
  }

  /** The WFX-024 background demand facts for one backgrounded session. */
  private demandFacts(session: NativeMediaSession) {
    return {
      positionMs: session.positionMs,
      // A paused background completion consumes nothing — the honest
      // rate-0 fact (the WFX-024 discipline; the engine's own read-ahead
      // keeps downloading regardless).
      playbackRate: 0,
      bitrateBps: this.nominalBitrateBps,
      bufferAheadMs: Math.max(0, session.bufferedMs - session.positionMs),
      stallBudgetMs: this.stallBudgetMs,
    };
  }

  /** Engine update → journal transitions, completion detection, listeners. */
  private onEngineUpdate(session: NativeMediaSession): void {
    const previous = this.journaledState.get(session.id);
    if (previous !== undefined && previous.state !== session.state) {
      const evidence = this.engine.lastEvidence(session.id);
      this.journal.appendState({
        sessionId: session.id,
        state: session.state,
        bufferedMs: session.bufferedMs,
        positionMs: session.positionMs,
        integrity: session.integrity,
        ...(evidence !== undefined ? { evidence } : {}),
      });
    }
    if (previous !== undefined) {
      this.journaledState.set(session.id, session);
    }
    if (session.state === "complete") {
      // The asset just persisted: make it servable immediately (the LIVE
      // gateway map) — playback-end and background completions alike.
      if (this.gateway !== undefined) {
        const size = this.store.statAsset(session.assetId);
        if (size !== null) {
          this.gateway.assets.set(`/media/${session.assetId}`, {
            source: { localPath: this.store.contentPath(session.assetId) },
            pieceCount: Math.max(1, Math.floor(size.sizeBytes / 262_144)),
          });
        }
      }
      // Push the completion to the driver with the REAL stored size —
      // never a fabricated byte count (absent size ⇒ the driver's typed
      // refusal, by design).
      const storedSize = this.store.statAsset(session.assetId);
      void this.completionDriver
        .onSessionUpdate(
          session,
          storedSize === null ? undefined : { totalBytes: storedSize.sizeBytes },
        )
        .catch(() => undefined); // driver failures are recorded internally; the update channel never throws
    }
    for (const listener of this.updateListeners) {
      listener(session);
    }
  }

  /** The periodic pass: the translated foreground tick + the driver tick. */
  private async periodicTick(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.tickScheduler();
    } catch {
      // Ticks are advisory (typed failures are recorded in the reports);
      // the service host never dies on a scheduling pass.
    }
  }

  /** Write the discovery file under the store root (port + protocol). */
  private writeEngineInfo(): void {
    const info = {
      protocolVersion: PROTOCOL_VERSION,
      pid: process.pid,
      gateway:
        this.gateway === undefined
          ? null
          : { port: this.gateway.port, baseUrl: this.gateway.baseUrl },
    };
    writeFileSync(join(this.store.root, "engine-info.json"), JSON.stringify(info, null, 2));
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the production engine service: the REAL engine + asset store +
 * journal + production gateway + background completion driver + the
 * translated foreground scheduler, all under `config.cacheDir`. Throws
 * typed `NativeMediaError`s on malformed configuration (never boots a
 * silently-broken service). Call {@link EngineServiceHandle.recover}
 * once at startup to replay the journal.
 */
export function createEngineService(config: EngineServiceConfig): EngineServiceHandle {
  if (typeof config !== "object" || config === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createEngineService: config must be an object",
    });
  }
  if (typeof config.cacheDir !== "string" || config.cacheDir.trim().length === 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createEngineService: cacheDir must be a non-empty string",
    });
  }
  if (
    typeof config.maxCacheBytes !== "number" ||
    !Number.isSafeInteger(config.maxCacheBytes) ||
    config.maxCacheBytes < 0
  ) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createEngineService: maxCacheBytes must be a non-negative safe integer",
    });
  }
  const clock: SchedulerClock = config.engine?.clock ?? (() => performance.now());
  if (typeof clock !== "function") {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createEngineService: engine.clock must be a function () => number",
    });
  }
  return new EngineServiceImpl(config, clock);
}

// ---------------------------------------------------------------------------
// Error event helper (shared with main.ts)
// ---------------------------------------------------------------------------

/** Render a typed engine failure as its v1 `error` event DTO. */
export function commandErrorEvent(error: NativeMediaError): EngineEvent {
  return errorToEvent(error);
}

/** Read the journal's records (test/inspection surface over the service). */
export function readJournalRecords(journal: SessionJournal): readonly JournalRecord[] {
  return journal.readAll();
}
