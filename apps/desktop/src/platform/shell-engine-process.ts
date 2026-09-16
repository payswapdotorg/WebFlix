/**
 * @wfx/app-desktop — the shell-backed engine process (R08, production).
 *
 * The PRODUCTION `NativeEngineProcess` implementation: the native shell
 * (Rust host) spawns/attaches the native-media engine binary as a child
 * process (JSON-lines DTO protocol over stdio — the WFX-014 boundary),
 * and relays its commands and events across the `ShellIpc` seam:
 *
 * ```text
 * NativeMediaBinding ── EngineCommand DTO ──> ShellIpc.engineSend
 *        ^                                        │
 *        │                                        v
 *        └── EngineEvent DTO ── ShellIpc.onEngineEvent ── Rust host
 *                                                   │
 *                                                   v
 *                                          engine child process
 *                                          (the R10 service binary)
 * ```
 *
 * The binary is resolved by the shell: the bundled engine sidecar
 * (`externalBin` in the Tauri config) or `WFX_ENGINE_PATH`; the engine
 * gets its cache directory under the OS app-data dir and its byte budget
 * from the spawn config. THIS module adds no logic of its own — it is the
 * faithful transport of the frozen DTO protocol across the seam, with
 * typed `ShellIpcError` -> `NativeMediaError` mapping so the binding sees
 * the engine's own error vocabulary.
 *
 * Spawn semantics over an async seam (documented): `spawn` validates the
 * config SYNCHRONOUSLY (typed `INVALID_INPUT` on malformed values — the
 * process-boundary contract) and returns the handle immediately; the
 * shell's actual process-start result is awaited by the first `send` (a
 * start failure rejects every send with the typed engine error — never a
 * silent dead handle). Tests do NOT use this module (no real process
 * spawn): the binding is proven against the in-process simulated engine
 * process in `apps/desktop/tests/shell-simulator.ts`.
 */

import {
  NativeMediaError,
  validateEngineConfig,
  type EngineCommand,
  type EngineConfig,
  type EngineEvent,
  type EngineEventHandler,
  type EngineHandle,
  type NativeEngineProcess,
} from "@wfx/native-media";

import { isShellIpcError, type ShellEngineConfig, type ShellIpc } from "./shell-ipc";

/** Map a typed shell failure onto the engine's `NativeMediaError` (1:1 vocabulary). */
function engineError(thrown: unknown, fallbackDetail: string): NativeMediaError {
  if (isShellIpcError(thrown)) {
    const options: { detail?: string; sessionId?: string } = { detail: thrown.detail };
    if (thrown.sessionId !== undefined) options.sessionId = thrown.sessionId;
    switch (thrown.code) {
      case "INVALID_INPUT":
      case "UNSUPPORTED_SOURCE":
      case "NOT_FOUND":
      case "IO_ERROR":
      case "VERIFICATION_FAILED":
      case "RANGE_NOT_SATISFIABLE":
      case "SESSION_CLOSED":
      case "ENGINE_TIMEOUT":
      case "INTERNAL":
        return new NativeMediaError(thrown.code, options);
      default:
        // Storage/surface-area codes cannot originate from engine commands.
        return new NativeMediaError("INTERNAL", {
          detail: `unexpected shell code '${thrown.code}' during ${fallbackDetail}: ${thrown.detail}`,
        });
    }
  }
  const detail = thrown instanceof Error ? thrown.message : String(thrown);
  return new NativeMediaError("INTERNAL", { detail: `${fallbackDetail}: ${detail}` });
}

/** Translate the spawn config across the seam (field-for-field). */
function toShellConfig(config: EngineConfig): ShellEngineConfig {
  return {
    cacheDir: config.cacheDir,
    maxCacheBytes: config.maxCacheBytes,
    ...(config.socketPath !== undefined ? { socketPath: config.socketPath } : {}),
    ...(config.binaryPath !== undefined ? { binaryPath: config.binaryPath } : {}),
  };
}

/**
 * Build the shell-backed `NativeEngineProcess` (the production spawn/attach
 * wiring of the R10 seam's transport). `spawn` asks the shell to start the
 * engine process; the handle relays the DTO protocol until termination.
 */
export function createShellEngineProcess(shell: ShellIpc): NativeEngineProcess {
  return {
    spawn(config: EngineConfig): EngineHandle {
      // Synchronous config validation (the process-boundary contract).
      validateEngineConfig(config);

      let engineId: string | null = null;
      let terminated = false;
      let relayUnsub: (() => void) | null = null;
      const handlers = new Set<EngineEventHandler>();

      // The shell's process-start result; a start failure rejects every
      // subsequent send with the typed engine error (never a silent dead
      // handle — the binding surfaces it as the typed `unavailable`).
      const spawned: Promise<void> = shell
        .engineSpawn(toShellConfig(config))
        .then((handleId) => {
          engineId = handleId.engineId;
          // The engine event relay: registered as soon as the engine lives.
          relayUnsub = shell.onEngineEvent(engineId, (event) => {
            for (const handler of handlers) handler(event);
          });
        });

      return {
        send(command: EngineCommand): Promise<EngineEvent> {
          if (terminated) {
            return Promise.reject(
              new NativeMediaError("INVALID_INPUT", {
                detail: "the engine process was terminated",
              }),
            );
          }
          return (async () => {
            try {
              await spawned;
            } catch (thrown) {
              throw engineError(thrown, "engineSpawn");
            }
            if (engineId === null) {
              throw new NativeMediaError("INTERNAL", {
                detail: "the engine id was never minted (shell contract violation)",
              });
            }
            try {
              return await shell.engineSend(engineId, command);
            } catch (thrown) {
              throw engineError(thrown, `engineSend(${command.kind})`);
            }
          })();
        },

        onEvent(handler: EngineEventHandler): () => void {
          handlers.add(handler);
          return () => {
            handlers.delete(handler);
          };
        },

        terminate(): void {
          if (terminated) return;
          terminated = true;
          if (relayUnsub !== null) {
            relayUnsub();
            relayUnsub = null;
          }
          void spawned
            .then(() => {
              if (engineId !== null) return shell.engineTerminate(engineId);
              return undefined;
            })
            .catch(() => undefined); // best-effort teardown of a dead engine
        },
      };
    },
  };
}
