/**
 * @wfx/app-desktop — the Tauri global-API shell binding (R08, production).
 *
 * The PRODUCTION `ShellIpc` implementation over the Tauri v2 global API:
 * the shell config (`shell/tauri.conf.json`) enables `app.withGlobalTauri`,
 * exposing `window.__TAURI__` in the webview with `core.invoke` for
 * commands and `event.listen` for the push channels — NO npm dependency
 * (the frozen lockfile is unchanged; the structural types below are the
 * only Tauri surface the adapter consumes).
 *
 * Command names follow one law: `wfx_<area>_<operation>` — the exact
 * surface the Rust shell registers (`shell/src-tauri/src/ipc.rs`):
 *
 * | ShellIpc command            | Tauri command                 |
 * |-----------------------------|-------------------------------|
 * | `info`                      | `wfx_shell_info`              |
 * | `lifecycleShutdownComplete` | `wfx_lifecycle_shutdown_done` |
 * | `kvGet`/`kvSet`/…           | `wfx_storage_kv_get`/…        |
 * | `surfaceOpen`/…             | `wfx_surface_open`/…          |
 * | `notificationShow`/…        | `wfx_notify_show`/…           |
 * | `taskSchedule`/…            | `wfx_task_schedule`/…         |
 * | `sharePresent`/…            | `wfx_share_present`/…         |
 * | `engineSpawn`/…             | `wfx_engine_spawn`/…          |
 *
 * Event channels use the `wfx://<area>` naming (`wfx://lifecycle`,
 * `wfx://surface`, `wfx://task`, `wfx://engine/<id>`).
 *
 * This module cannot be exercised in the sandbox (no native build); the
 * TypeScript side of the adapter is proven against the shell simulator
 * double (`tests/shell-simulator.ts`) which implements the same
 * `ShellIpc` contract — documented honestly in `shell/README.md`.
 */

import type { Unsubscribe } from "@wfx/platform-contracts";

import { isShellIpcError, ShellIpcError, type ShellIpc } from "./shell-ipc";

// ---------------------------------------------------------------------------
// The structural Tauri surface (no @tauri-apps/api dependency)
// ---------------------------------------------------------------------------

/** The structural `invoke` the Tauri global API exposes. */
export type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/** The structural event API the Tauri global API exposes. */
export interface TauriEventApi {
  listen(
    event: string,
    handler: (payload: { readonly payload: unknown }) => void,
  ): Promise<() => void>;
}

/** The structural `window.__TAURI__` the adapter consumes. */
export interface TauriGlobal {
  readonly core: { readonly invoke: TauriInvoke };
  readonly event: TauriEventApi;
}

/** Read the Tauri global API from the webview window (typed structurally). */
export function tauriGlobalFromWindow(): TauriGlobal {
  const candidate = (globalThis as { __TAURI__?: unknown }).__TAURI__;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof (candidate as { core?: unknown }).core !== "object" ||
    (candidate as { core?: unknown }).core === null ||
    typeof (candidate as { core?: { invoke?: unknown } }).core?.invoke !== "function" ||
    typeof (candidate as { event?: unknown }).event !== "object" ||
    (candidate as { event?: unknown }).event === null ||
    typeof (candidate as { event?: { listen?: unknown } }).event?.listen !== "function"
  ) {
    throw new ShellIpcError(
      "unavailable",
      "the Tauri global API (window.__TAURI__) is not present — the desktop adapter must run inside the WebFlix native shell (see shell/README.md)",
    );
  }
  return candidate as TauriGlobal;
}

// ---------------------------------------------------------------------------
// The binding
// ---------------------------------------------------------------------------

/** Options for {@link createTauriShellIpc}. */
export interface TauriShellIpcOptions {
  /** The Tauri global API (default: read from `window.__TAURI__`). */
  readonly tauri?: TauriGlobal;
}

/**
 * Build the production `ShellIpc` over the Tauri global API. Rejections
 * are normalized into typed `ShellIpcError`s (the Rust side returns
 * `{ code, detail }` error payloads; anything else is surfaced as an
 * honest `INTERNAL`/`unavailable` failure — never a bare Error).
 */
export function createTauriShellIpc(options: TauriShellIpcOptions = {}): ShellIpc {
  const tauri = options.tauri ?? tauriGlobalFromWindow();
  const invoke = tauri.core.invoke;

  async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    let answer: unknown;
    try {
      answer = await invoke(command, args);
    } catch (thrown) {
      throw normalize(command, thrown);
    }
    return answer as T;
  }

  function normalize(command: string, thrown: unknown): ShellIpcError {
    if (isShellIpcError(thrown)) return thrown;
    // The Rust commands return Result<_, ShellError> where ShellError
    // serializes as { code, detail } — an invoke rejection carries it.
    if (typeof thrown === "object" && thrown !== null) {
      const candidate = thrown as { code?: unknown; detail?: unknown; sessionId?: unknown };
      if (typeof candidate.code === "string" && typeof candidate.detail === "string") {
        return new ShellIpcError(
          candidate.code as ShellIpcError["code"],
          candidate.detail,
          typeof candidate.sessionId === "string" ? candidate.sessionId : undefined,
        );
      }
    }
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    return new ShellIpcError("unavailable", `shell command '${command}' failed: ${detail}`);
  }

  function listen(event: string, handler: (payload: unknown) => void): Unsubscribe {
    let unsub: (() => void) | null = null;
    let pending = true;
    void tauri.event
      .listen(event, (payload) => {
        if (pending) handler(payload.payload);
      })
      .then((unlisten) => {
        unsub = unlisten;
      })
      .catch(() => {
        // A failed event registration is surfaced through the port's own
        // failure channels; the subscription stays a silent no-op rather
        // than crashing the adapter (documented, best-effort events).
      });
    return () => {
      pending = false;
      if (unsub !== null) unsub();
    };
  }

  return {
    info: () => call("wfx_shell_info"),

    onLifecycleEvent(handler) {
      return listen("wfx://lifecycle", (payload) => handler(payload as never));
    },
    lifecycleShutdownComplete: () => call("wfx_lifecycle_shutdown_done"),

    kvGet: (key) => call("wfx_storage_kv_get", { key }),
    kvSet: (key, value) => call("wfx_storage_kv_set", { key, value }),
    kvRemove: (key) => call("wfx_storage_kv_remove", { key }),
    kvKeys: (prefix) => call("wfx_storage_kv_keys", prefix !== undefined ? { prefix } : undefined),
    blobPut: (key, bytes) => call("wfx_storage_blob_put", { key, bytes }),
    blobGet: (key) => call("wfx_storage_blob_get", { key }),
    blobRemove: (key) => call("wfx_storage_blob_remove", { key }),
    storageQuota: () => call("wfx_storage_quota"),

    surfaceOpen: (request) => call("wfx_surface_open", { request }),
    surfaceNavigate: (sessionId, url) => call("wfx_surface_navigate", { sessionId, url }),
    surfaceClose: (sessionId) => call("wfx_surface_close", { sessionId }),
    onSurfaceEvent(handler) {
      return listen("wfx://surface", (payload) => handler(payload as never));
    },

    notificationPermission: () => call("wfx_notify_permission"),
    notificationRequestPermission: () => call("wfx_notify_request_permission"),
    notificationShow: (notification) => call("wfx_notify_show", { notification }),

    taskSchedule: (task) => call("wfx_task_schedule", { task }),
    taskCancel: (taskId) => call("wfx_task_cancel", { taskId }),
    taskStatus: (taskId) => call("wfx_task_status", { taskId }),
    taskList: () => call("wfx_task_list"),
    onTaskEvent(handler) {
      return listen("wfx://task", (payload) => handler(payload as never));
    },

    shareCanPresent: (request) => call("wfx_share_can_present", { request }),
    sharePresent: (request) => call("wfx_share_present", { request }),

    engineSpawn: (config) => call("wfx_engine_spawn", { config }),
    engineSend: (engineId, command) => call("wfx_engine_send", { engineId, command }),
    onEngineEvent(engineId, handler) {
      return listen(`wfx://engine/${engineId}`, (payload) => handler(payload as never));
    },
    engineTerminate: (engineId) => call("wfx_engine_terminate", { engineId }),
  };
}
