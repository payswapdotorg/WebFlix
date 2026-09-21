/**
 * @wfx/native-media — THE SPAWNABLE SERVICE ENTRY (R10, production).
 *
 * The real engine service process: speaks the frozen v1 DTO protocol
 * (`engine/process.ts`) over stdio as JSON LINES — one `EngineCommand`
 * per stdin line in, one `EngineEvent` (the acknowledgment, or the typed
 * `error` DTO for a command that could not be applied) per command out,
 * plus spontaneous `progress`/`buffered`/`state-changed` telemetry on
 * the same stream. It hosts the full production assembly
 * (`createEngineService`): the REAL local-file/store-backed engine, the
 * asset store with SHA-256 digests, the append-only session journal,
 * crash RECOVERY, the loopback production range gateway, the merged
 * WFX-024 background completion driver, and the translated WFX-023
 * scheduler wiring.
 *
 * SPAWN CONTRACT:
 * - CONFIG: the spawn `EngineConfig` arrives as the `WFX_ENGINE_CONFIG`
 *   environment variable (JSON). A missing/malformed config is reported
 *   as a v1 `error` event on stdout followed by exit code 2 — never a
 *   silently-dead process.
 * - TUNABLES: the OPTIONAL `WFX_ENGINE_TUNABLES` environment variable
 *   (JSON, a partial engine config — read chunk, nominal bitrate, read
 *   throughput, tick, rebuffer lead, content type) lets the spawner
 *   shape the engine without code changes; malformed tunables fail
 *   startup exactly like a malformed config (typed + exit 2).
 * - DISCOVERY: once the gateway is bound, `engine-info.json` under the
 *   cache dir records the protocol version, the pid, and the gateway
 *   port/base URL (the spawner's discovery path for the range channel).
 * - STARTUP: the journal is REPLAYED before stdin is read — recovered
 *   sessions (intact bytes ⇒ `buffering` at the journaled control point;
 *   vanished/corrupt bytes ⇒ `failed` with the honest detail) are
 *   announced on the wire as spontaneous `state-changed` events. v1
 *   consumers ignore unknown-session snapshots by law, so this is safe
 *   for every legacy consumer and observable for new ones.
 * - SHUTDOWN: the v1 wire has NO shutdown command (the frozen six only)
 *   — the spec's `shutdown`/EOF maps onto the process-level paths, both
 *   graceful: stdin EOF (the spawner closing the pipe) and SIGTERM/
 *   SIGINT journal a `shutdown` evidence record, dispose the service,
 *   and exit 0.
 * - VERSIONING: every inbound line is validated by the frozen runtime
 *   guards (including `protocolVersion`) — nothing is parsed
 *   optimistically.
 *
 * CRASH LAW (v1 protocol rule 3, entry side): a malformed inbound frame
 * (not JSON, a failed command guard, an unknown protocol version) means
 * the WIRE is corrupt: every live session is journaled `failed` with the
 * honest detail, ONE `error` event (code `INTERNAL`) is written — which
 * consumers treat as fatal for every live session — and the process
 * exits with code 1, honestly poisoned (no further commands are
 * processed).
 *
 * EVENT ORDERING GUARANTEE (the transport relies on this — see
 * process.ts): while a command is being processed, spontaneous events
 * are buffered and flushed only AFTER the command's acknowledgment has
 * been written, so the first event following a command is always its
 * response.
 */

import {
  errorToEvent,
  isEngineCommand,
  PROTOCOL_VERSION,
  sessionFromDto,
  sessionToDto,
  validateEngineConfig,
  type EngineConfig,
  type EngineEvent,
} from "../engine/process";
import { NativeMediaError } from "../errors";
import { mapEngineError } from "../service";
import type { NativeMediaSession } from "@wfx/domain";

import { createEngineService, type EngineServiceHandle } from "./service";

// ---------------------------------------------------------------------------
// Serialized stdout writer (strict event ordering)
// ---------------------------------------------------------------------------

let writeChain: Promise<void> = Promise.resolve();

/** Append one JSON line to stdout (ordering guaranteed by the chain). */
function writeEventLine(event: EngineEvent): void {
  writeChain = writeChain
    .then(() => Bun.write(Bun.stdout, `${JSON.stringify(event)}\n`))
    .then(() => undefined)
    .catch(() => {
      // The spawner closed our stdout: nothing can be reported anymore —
      // exit quietly (the consumer is gone by definition).
      process.exit(0);
    });
}

/**
 * The startup-failure path: one v1 error event, then exit code 2 once
 * the line has landed (the write chain holds the process alive).
 */
function fatalStartup(detail: string, code: NativeMediaError["code"]): void {
  writeEventLine({ protocolVersion: PROTOCOL_VERSION, kind: "error", code, detail });
  void writeChain.then(() => process.exit(2));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

let service: EngineServiceHandle | undefined;
/** The last snapshot announced per session (the telemetry diff baseline). */
const lastSeen = new Map<string, NativeMediaSession>();
/** Sessions whose engine state moved since their last announcement. */
const dirty = new Set<string>();
let inFlight = false;

/**
 * Engine update → mark the session for DIFF-BASED emission at flush time.
 * Events are NEVER built eagerly: a command's ack is the authoritative
 * announcement of the command's own effect (the ack updates the baseline,
 * so command-driven changes never duplicate as spontaneous events —
 * only genuinely later, timer-driven changes emit).
 */
function onEngineUpdate(session: NativeMediaSession): void {
  if (lastSeen.has(session.id)) {
    dirty.add(session.id);
  }
  // Sessions without a baseline are pre-acknowledgment (open) or recovery
  // announcements — the ack/announcement owns their first emission.
}

/** Emit the wire telemetry for one session's CURRENT state vs its baseline. */
function emitDeltasFor(active: EngineServiceHandle, sessionId: string): void {
  const current = active.engine.snapshot(sessionId);
  const previous = lastSeen.get(sessionId);
  if (current === undefined || previous === undefined) return;
  if (previous.state !== current.state || previous.integrity !== current.integrity) {
    writeEventLine({
      protocolVersion: PROTOCOL_VERSION,
      kind: "state-changed",
      session: sessionToDto(current),
    });
  }
  if (previous.bufferedMs !== current.bufferedMs) {
    writeEventLine({
      protocolVersion: PROTOCOL_VERSION,
      kind: "buffered",
      sessionId,
      bufferedMs: current.bufferedMs,
    });
  }
  if (previous.positionMs !== current.positionMs) {
    writeEventLine({
      protocolVersion: PROTOCOL_VERSION,
      kind: "progress",
      sessionId,
      positionMs: current.positionMs,
    });
  }
  lastSeen.set(sessionId, { ...current });
}

/** Flush the marked sessions' deltas (called after a command's ack lands). */
function flushSpontaneous(active: EngineServiceHandle): void {
  for (const sessionId of dirty) {
    emitDeltasFor(active, sessionId);
  }
  dirty.clear();
}

/** Seed a session as announced (recovery) and emit its startup snapshot. */
function announceRestored(session: NativeMediaSession): void {
  lastSeen.set(session.id, { ...session });
  writeEventLine({
    protocolVersion: PROTOCOL_VERSION,
    kind: "state-changed",
    session: sessionToDto(session),
  });
}


/**
 * THE CRASH LAW (entry side): journal every live session failed with the
 * honest detail, emit the single process-fatal `error` event, exit 1.
 */
async function poisonWire(detail: string): Promise<never> {
  const active = service;
  if (active !== undefined) {
    try {
      active.journal.appendEvidence("wire-poisoned", { detail });
      for (const [sessionId, session] of [...lastSeen]) {
        if (session.state === "complete" || session.state === "failed") continue;
        active.journal.appendState({
          sessionId,
          state: "failed",
          bufferedMs: session.bufferedMs,
          positionMs: session.positionMs,
          integrity: session.integrity,
          evidence: { reason: "wire-poisoned", detail },
        });
      }
      await active.dispose();
    } catch {
      // Journaling best-effort during poison — the exit is the truth.
    }
  }
  writeEventLine({
    protocolVersion: PROTOCOL_VERSION,
    kind: "error",
    code: "INTERNAL",
    detail: `the wire was poisoned by a malformed frame: ${detail}`,
  });
  await writeChain;
  process.exit(1);
}

/** Graceful shutdown (EOF / SIGTERM / SIGINT): journal + dispose + exit 0. */
let shuttingDown = false;
async function gracefulShutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const active = service;
  if (active !== undefined) {
    try {
      await active.dispose();
    } catch {
      // best-effort teardown
    }
  }
  await writeChain;
  process.exit(0);
}

async function main(): Promise<void> {
  // 1. Config from the environment (the spawn contract).
  const rawConfig = process.env.WFX_ENGINE_CONFIG;
  if (rawConfig === undefined || rawConfig.trim().length === 0) {
    fatalStartup(
      "the WFX_ENGINE_CONFIG environment variable (the JSON EngineConfig) is required to start the engine service",
      "INVALID_INPUT",
    );
    return;
  }

  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(rawConfig);
  } catch (e) {
    fatalStartup(
      `WFX_ENGINE_CONFIG is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      "INVALID_INPUT",
    );
    return;
  }
  try {
    validateEngineConfig(parsedConfig);
  } catch (e) {
    const error = mapEngineError(e);
    fatalStartup(`WFX_ENGINE_CONFIG is invalid: ${error.message}`, error.code);
    return;
  }
  const config = parsedConfig as EngineConfig;

  // 2. The OPTIONAL spawn-time engine tunables (see the spawn contract).
  const rawTunables = process.env.WFX_ENGINE_TUNABLES;
  let tunables: Record<string, unknown> = {};
  if (rawTunables !== undefined && rawTunables.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(rawTunables);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("the tunables must be a JSON object");
      }
      tunables = parsed as Record<string, unknown>;
    } catch (e) {
      fatalStartup(
        `WFX_ENGINE_TUNABLES is invalid: ${e instanceof Error ? e.message : String(e)}`,
        "INVALID_INPUT",
      );
      return;
    }
  }

  // 3. Assemble the service (engine + store + journal + gateway + driver).
  try {
    service = createEngineService({
      cacheDir: config.cacheDir,
      maxCacheBytes: config.maxCacheBytes,
      engine: {
        ...(tunables as Record<string, never>),
        // The child hosts a live long-running service: the read-ahead and
        // playback timer runs; tests that spawn this entry keep fixtures
        // small so the real clock completes them in bounded time.
        autoTick: true,
      },
    });
  } catch (e) {
    const error = mapEngineError(e);
    fatalStartup(`the engine service could not start: ${error.message}`, error.code);
    return;
  }
  const active = service;

  // 4. Wire the engine's update channel (spontaneous telemetry) + the
  //    periodic flush that emits timer-driven deltas between commands
  //    (command-driven changes are carried by the acks themselves).
  active.onSessionUpdate(onEngineUpdate);
  const flushTimer = setInterval(() => {
    if (!inFlight) {
      flushSpontaneous(active);
    }
  }, 25);

  // 5. RECOVERY: replay the journal before reading any command (module
  //    docs — recovered/vanished sessions announce on the wire).
  try {
    const report = await active.recover();
    for (const restored of report.recovered) {
      const snapshot = active.engine.snapshot(restored.sessionId);
      if (snapshot !== undefined) announceRestored(snapshot);
    }
    for (const failed of report.failed) {
      const snapshot = active.engine.snapshot(failed.sessionId);
      if (snapshot !== undefined) announceRestored(snapshot);
    }
  } catch (e) {
    const error = mapEngineError(e);
    fatalStartup(`journal recovery failed: ${error.message}`, error.code);
    return;
  }

  // 6. Signals → graceful shutdown.
  // (bun-types' `process.on` override declares only the "memoryPressure"
  // event and hides the inherited signal overloads under the current
  // @types/node — route through the EventEmitter's own typed binding so
  // the signal listeners register exactly as before.)
  const onSignal = process.on.bind(process) as unknown as (
    event: "SIGTERM" | "SIGINT",
    listener: () => void,
  ) => typeof process;
  onSignal("SIGTERM", () => {
    void gracefulShutdown();
  });
  onSignal("SIGINT", () => {
    void gracefulShutdown();
  });

  // 7. The command loop: one JSON line per command, serialized; EOF exits.
  const decoder = new TextDecoder();
  let buffer = "";
  const reader = Bun.stdin.stream().getReader();
  flushTimer.unref?.();
  type ReadResult = Awaited<ReturnType<typeof reader.read>>;
  for (;;) {
    let chunk: ReadResult;
    try {
      chunk = await reader.read();
    } catch {
      // The spawner's stdin broke: the graceful path (nothing more can
      // arrive).
      await gracefulShutdown();
      return;
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let newlineAt: number;
    while ((newlineAt = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineAt);
      buffer = buffer.slice(newlineAt + 1);
      if (line.trim().length === 0) continue;
      await handleWireLine(line, active);
      if (shuttingDown) return;
    }
  }
  // stdin closed (the spawner ended the pipe): the graceful path.
  await gracefulShutdown();
}

/** One inbound wire line: guard → dispatch → ack/error (the crash law). */
async function handleWireLine(
  line: string,
  active: EngineServiceHandle,
): Promise<void> {
  let command: unknown;
  try {
    command = JSON.parse(line);
  } catch {
    await poisonWire(`the line is not valid JSON: ${line.slice(0, 120)}`);
    return;
  }
  // The frozen runtime guards — unknown protocol versions included, never
  // parsed optimistically (v1 rule 4).
  if (!isEngineCommand(command)) {
    await poisonWire(
      `the frame failed the v1 command guard (protocolVersion must be ${PROTOCOL_VERSION}): ${line.slice(0, 120)}`,
    );
    return;
  }
  inFlight = true;
  try {
    const ack = await active.dispatchCommand(command);
    // The ack is authoritative: adopt its snapshot as the diff baseline
    // (command-driven changes never duplicate as spontaneous events).
    const session: NativeMediaSession = sessionFromDto(ack.session);
    lastSeen.set(session.id, session);
    writeEventLine(ack);
  } catch (e) {
    // A command that could not be applied crosses as the typed error
    // event DTO (v1 rule 3) — the process stays alive.
    const error = mapEngineError(e);
    writeEventLine(errorToEvent(error));
  } finally {
    inFlight = false;
    flushSpontaneous(active);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

void main().catch(async (e: unknown) => {
  // A truly unexpected boot fault: the honest typed startup failure.
  const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  fatalStartup(`unexpected engine service fault: ${detail}`, "INTERNAL");
});
