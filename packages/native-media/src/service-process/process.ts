/**
 * @wfx/native-media — the child-process engine transport (R10, production).
 *
 * A production `NativeEngineProcess` implementation that SPAWNS the real
 * engine service entry (`service-process/main.ts`) as a child process
 * (`Bun.spawn` — a Bun builtin) and speaks the frozen v1 DTO protocol
 * over stdio JSON lines:
 *
 * ```text
 *  send(command)  ──stdin JSON line──>   main.ts ──> the real engine
 *  onEvent(event) <──stdout JSON line──  main.ts <── engine updates
 * ```
 *
 * WIRE ORDERING DISCIPLINE (documented, relied upon): the v1 protocol
 * carries NO request ids — a command is answered by the event that
 * follows it. The entry (main.ts) guarantees the ordering that makes
 * in-order matching sound: while a command is being processed, every
 * spontaneous event is BUFFERED until the command's acknowledgment has
 * been written. The transport therefore matches the FIRST event line
 * after a command write to that command's pending send, and routes every
 * other line to the spontaneous handlers. Sends are serialized (one
 * outstanding command at a time) through an internal queue.
 *
 * CRASH LAW (v1 rule 3, transport side): the child dying (kill, crash,
 * non-zero exit), writing a malformed event, or a broken pipe crashes
 * the handle: the pending send (if any) rejects with a typed `INTERNAL`
 * error, every `onEvent` handler receives ONE well-formed synthesized
 * `error` event (code `INTERNAL`, the honest detail) — which consumers
 * (the R08 binding, the WFX-014 adapter) treat as process-fatal for
 * every live session — and the child is reaped. No fake success, no
 * silent dead handle.
 *
 * `terminate()` is graceful-first: the stdin pipe is closed (the entry's
 * documented EOF shutdown path — journal evidence, clean exit 0), and a
 * kill follows only after a grace period. After `terminate`, `send`
 * rejects with the typed `INVALID_INPUT` error (the boundary contract).
 */

import { join } from "node:path";

import { NativeMediaError } from "../errors";
import {
  isEngineCommand,
  isEngineEvent,
  validateEngineConfig,
  type EngineCommand,
  type EngineConfig,
  type EngineEvent,
  type EngineEventHandler,
  type EngineHandle,
  type NativeEngineProcess,
} from "../engine/process";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for {@link createChildProcessEngine}. */
export interface ChildProcessEngineOptions {
  /**
   * The service entry file to spawn. Default: `main.ts` next to this
   * module (the REAL production entry).
   */
  readonly entryPath?: string;
  /** Extra environment variables for the child (merged over `process.env`). */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * The grace period after a graceful `terminate` before the child is
   * killed, ms. Default: 2000.
   */
  readonly gracefulExitTimeoutMs?: number;
  /**
   * TEST HOOK — stderr routing: `"inherit"` (default) pipes the child's
   * stderr through; `"ignore"` silences it (kept because a killed child
   * can be noisy on some platforms). Never affects the DTO channel.
   */
  readonly stderr?: "inherit" | "ignore";
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_GRACEFUL_EXIT_TIMEOUT_MS = 2_000;

/** One pending command send (the in-order response slot). */
interface PendingSend {
  readonly command: EngineCommand;
  resolve(event: EngineEvent): void;
  reject(error: NativeMediaError): void;
}

/**
 * Can this event be the RESPONSE to this command? (v1 structural rule:
 * responses are `state-changed` acks — any session for `open`, the
 * command's own session for controls — or `error` DTOs. `progress` and
 * `buffered` telemetry is NEVER a response.) The structural match is the
 * backstop against pipe-latency races: a telemetry line that lands after
 * the next command was written must not steal its response slot.
 */
function isResponseFor(command: EngineCommand, event: EngineEvent): boolean {
  if (event.kind === "error") return true;
  if (event.kind !== "state-changed") return false;
  if (command.kind === "open") return true;
  return event.session.id === command.sessionId;
}

class ChildProcessEngine implements NativeEngineProcess {
  private readonly entryPath: string;
  private readonly env: Readonly<Record<string, string>>;
  private readonly gracefulExitTimeoutMs: number;
  private readonly stderr: "inherit" | "ignore";

  constructor(options: ChildProcessEngineOptions = {}) {
    this.entryPath = options.entryPath ?? join(import.meta.dir, "main.ts");
    this.env = options.env ?? {};
    this.gracefulExitTimeoutMs =
      options.gracefulExitTimeoutMs ?? DEFAULT_GRACEFUL_EXIT_TIMEOUT_MS;
    this.stderr = options.stderr ?? "inherit";
  }

  spawn(config: EngineConfig): EngineHandle {
    // Synchronous config validation (the process-boundary contract).
    validateEngineConfig(config);
    return new ChildProcessHandle(
      this.entryPath,
      config,
      this.env,
      this.gracefulExitTimeoutMs,
      this.stderr,
    );
  }
}

class ChildProcessHandle implements EngineHandle {
  private readonly handlers = new Set<EngineEventHandler>();
  private readonly proc: ReturnType<typeof Bun.spawn>;
  private readonly stdinSink: Bun.FileSink;
  private readonly stdoutStream: ReadableStream<Uint8Array>;
  private readonly gracefulExitTimeoutMs: number;
  private pending: PendingSend | undefined;
  private terminated = false;
  private crashed = false;
  /** Serializes sends: ONE outstanding command at a time (v1 in-order). */
  private queueTail: Promise<unknown> = Promise.resolve();

  constructor(
    entryPath: string,
    config: EngineConfig,
    env: Readonly<Record<string, string>>,
    gracefulExitTimeoutMs: number,
    stderr: "inherit" | "ignore",
  ) {
    this.gracefulExitTimeoutMs = gracefulExitTimeoutMs;
    this.proc = Bun.spawn({
      cmd: [process.execPath, entryPath],
      env: {
        ...process.env,
        ...env,
        WFX_ENGINE_CONFIG: JSON.stringify({
          cacheDir: config.cacheDir,
          maxCacheBytes: config.maxCacheBytes,
          ...(config.socketPath !== undefined ? { socketPath: config.socketPath } : {}),
          ...(config.binaryPath !== undefined ? { binaryPath: config.binaryPath } : {}),
        }),
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr,
    });
    // "pipe" was requested for both channels — narrow the union Bun's
    // types keep for the inherited forms.
    this.stdinSink = this.proc.stdin as Bun.FileSink;
    this.stdoutStream = this.proc.stdout as ReadableStream<Uint8Array>;
    // The child's exit is observed forever: an UNGRACEFUL death while the
    // handle is live is the crash law (a graceful terminate() is not).
    void this.proc.exited.then(
      (code) => {
        this.crash(`the engine process exited (code ${String(code)})`);
      },
      (e: unknown) => {
        this.crash(
          `the engine process exit could not be observed: ${e instanceof Error ? e.message : String(e)}`,
        );
      },
    );
    void this.pumpStdout();
  }

  send(command: EngineCommand): Promise<EngineEvent> {
    if (this.terminated) {
      return Promise.reject(
        new NativeMediaError("INVALID_INPUT", {
          detail: "send: the engine process was terminated",
        }),
      );
    }
    // Marshal through the same JSON transform a real transport applies.
    let wire: EngineCommand;
    try {
      wire = JSON.parse(JSON.stringify(command)) as EngineCommand;
      if (!isEngineCommand(wire)) {
        throw new NativeMediaError("INTERNAL", {
          detail: `send: command '${command.kind}' failed wire validation after marshalling`,
        });
      }
    } catch (e) {
      return Promise.reject(
        e instanceof NativeMediaError
          ? e
          : new NativeMediaError("INTERNAL", {
              detail: `send: command marshalling failed: ${e instanceof Error ? e.message : String(e)}`,
            }),
      );
    }
    const result = this.queueTail.then(
      () => this.sendOne(wire),
      () => this.sendOne(wire),
    );
    this.queueTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  onEvent(handler: EngineEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    // Graceful first: closing stdin is the entry's documented shutdown
    // path (journal evidence + clean exit). A kill follows after the
    // grace period if the child lingers.
    try {
      this.stdinSink.end();
    } catch {
      try {
        this.proc.kill(9);
      } catch {
        // already dead — nothing to do
      }
    }
    setTimeout(
      () => {
        try {
          this.proc.kill(9);
        } catch {
          // already dead — nothing to do
        }
      },
      this.gracefulExitTimeoutMs,
    ).unref?.();
  }

  // --- internals -------------------------------------------------------------

  /** Write ONE command line and await its in-order response. */
  private sendOne(wire: EngineCommand): Promise<EngineEvent> {
    return new Promise<EngineEvent>((resolve, reject) => {
      // The command rides on the pending slot for the structural match.
      if (this.terminated || this.crashed) {
        reject(
          new NativeMediaError(
            this.crashed ? "INTERNAL" : "INVALID_INPUT",
            {
              detail: this.crashed
                ? "send: the engine process failed earlier — every live session was failed"
                : "send: the engine process was terminated",
            },
          ),
        );
        return;
      }
      this.pending = { command: wire, resolve, reject };
      const onWriteError = (e: unknown): void => {
        this.crash(
          `writing a command to the engine stdin failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      };
      try {
        const written = this.stdinSink.write(`${JSON.stringify(wire)}\n`);
        if (typeof written === "number") {
          // Synchronous accept: the bytes are buffered — flush them out.
          this.stdinSink.flush();
        } else {
          void written.then(
            () => {
              this.stdinSink.flush();
            },
            onWriteError,
          );
        }
      } catch (e) {
        onWriteError(e);
      }
    });
  }

  /** The stdout pump: JSON lines → responses (in-order) + spontaneous events. */
  private async pumpStdout(): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    const reader = this.stdoutStream.getReader();
    type ReadResult = Awaited<ReturnType<typeof reader.read>>;
    for (;;) {
      let chunk: ReadResult;
      try {
        chunk = await reader.read();
      } catch {
        this.crash("reading the engine stdout failed (broken pipe)");
        return;
      }
      if (chunk.done) return;
      buffer += decoder.decode(chunk.value, { stream: true });
      let newlineAt: number;
      while ((newlineAt = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineAt);
        buffer = buffer.slice(newlineAt + 1);
        if (line.trim().length === 0) continue;
        this.onLine(line);
        if (this.crashed) return;
      }
    }
  }

  /** One outbound line: the pending response, or a spontaneous event. */
  private onLine(line: string): void {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      this.crash(`the engine emitted a non-JSON line: ${line.slice(0, 120)}`);
      return;
    }
    if (!isEngineEvent(event)) {
      this.crash(`the engine emitted a malformed event (failed the runtime guard): ${line.slice(0, 120)}`);
      return;
    }
    const pending = this.pending;
    if (pending !== undefined && isResponseFor(pending.command, event)) {
      // The in-order response (the entry buffers spontaneous events while
      // a command is in flight AND carries command-driven changes only in
      // the acks — see module docs; the structural match below is the
      // backstop against pipe-latency races).
      this.pending = undefined;
      if (event.kind === "error") {
        // A command failure crosses as the error event DTO: rebuild the
        // typed error (code/detail/sessionId/retryable survive the wire).
        pending.reject(rebuildError(event));
        return;
      }
      pending.resolve(event);
      return;
    }
    if (this.terminated) return;
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  /** The crash law: reject the pending send, notify handlers ONCE, reap. */
  private crash(detail: string): void {
    if (this.crashed) return;
    this.crashed = true;
    const pending = this.pending;
    this.pending = undefined;
    if (pending !== undefined) {
      pending.reject(
        new NativeMediaError("INTERNAL", { detail }),
      );
    }
    if (this.terminated) return; // a graceful teardown is not a failure
    // The synthesized v1 error event: consumers apply the crash law to
    // every live session (process-fatal, rule 3).
    const event: EngineEvent = {
      protocolVersion: 1,
      kind: "error",
      code: "INTERNAL",
      detail,
    };
    for (const handler of this.handlers) {
      handler(event);
    }
    try {
      this.proc.kill(9);
    } catch {
      // already dead — nothing to do
    }
  }
}

/** Rebuild a typed error from a wire `error` event (the v1 round trip). */
function rebuildError(
  event: Extract<EngineEvent, { kind: "error" }>,
): NativeMediaError {
  const options: { detail?: string; sessionId?: string } = {};
  if (event.detail !== undefined) options.detail = event.detail;
  if (event.sessionId !== undefined) options.sessionId = event.sessionId;
  return new NativeMediaError(event.code, options);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the child-process `NativeEngineProcess`: every `spawn(config)`
 * starts a REAL engine service (main.ts) with the config on its
 * environment (`WFX_ENGINE_CONFIG`), and returns the stdio JSON-lines
 * handle. This is the transport the R10 tests use to prove the REAL
 * entry end-to-end, and the reference embedding for hosts without the
 * R08 shell seam.
 */
export function createChildProcessEngine(
  options: ChildProcessEngineOptions = {},
): NativeEngineProcess {
  if (typeof options !== "object" || options === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createChildProcessEngine: options must be an object",
    });
  }
  return new ChildProcessEngine(options);
}
