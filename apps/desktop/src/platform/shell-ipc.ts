/**
 * @wfx/app-desktop — the native shell IPC contract (R08).
 *
 * THE typed surface the desktop adapter consumes from its native shell
 * (the Tauri-style host under `apps/desktop/shell/`). Everything the frozen
 * remediation architecture assigns to the Desktop adapter — lifecycle,
 * filesystem storage, contained browser hosting, OS notifications,
 * background work, sharing, and the native-media engine process — crosses
 * this ONE seam as typed commands and typed events.
 *
 * The layering law (frozen):
 *
 *     Experience Core -> Shared Client Runtime -> Platform Adapter -> Desktop
 *                                                        |
 *                                                  this seam (ShellIpc)
 *                                                        |
 *                                              native shell (Rust host)
 *
 * Contract laws:
 * - Every fallible command rejects with a `ShellIpcError` carrying a CLOSED
 *   per-area code vocabulary (the port-side error taxonomies travel verbatim
 *   over the seam — the shell is the SOURCE of those failures, so it speaks
 *   their language). A plain `Error` from a shell implementation is a
 *   contract violation caught and re-typed by the port wrappers.
 * - Event channels (`onLifecycleEvent`, `onSurfaceEvent`, `onTaskEvent`,
 *   `onEngineEvent`) are push subscriptions; each registration returns an
 *   `Unsubscribe`. Occurrence times are epoch milliseconds stamped by the
 *   SHELL's clock (the native side is the clock owner for shell events).
 * - The engine channel carries the frozen `@wfx/native-media` engine
 *   process DTO protocol verbatim (`EngineCommand`/`EngineEvent` from
 *   `engine/process.ts`): the shell SPAWNS/ATTACHES the engine process; the
 *   binding (`native-media-binding.ts`) owns the port semantics on top.
 *
 * Implementations:
 * - PRODUCTION: `createTauriShellIpc()` over the Tauri v2 global API
 *   (`window.__TAURI__.core.invoke` + `event.listen` — no npm dependency:
 *   the shell config enables `withGlobalTauri`).
 * - TESTS: the deterministic in-process shell simulator
 *   (`apps/desktop/tests/shell-simulator.ts`) — same contract, no I/O.
 */

import type { Unsubscribe } from "@wfx/platform-contracts";

import type { EngineCommand, EngineEvent } from "@wfx/native-media";

// ---------------------------------------------------------------------------
// The typed shell failure
// ---------------------------------------------------------------------------

/**
 * The closed failure vocabulary a shell command can reject with. The area
 * prefixes travel with the port-side taxonomies (the shell owns the real
 * filesystem / webview / notification / engine failures and names them in
 * the port's language).
 */
export type ShellIpcErrorCode =
  // storage (the StoragePort vocabulary verbatim)
  | "unavailable"
  | "quota-exceeded"
  | "invalid-key"
  | "io"
  | "corrupt"
  // browser surface (the BrowserSurfaceError vocabulary verbatim)
  | "invalid-url"
  | "blocked"
  | "invalid-session"
  // engine (the NativeMediaError vocabulary verbatim)
  | "INVALID_INPUT"
  | "UNSUPPORTED_SOURCE"
  | "NOT_FOUND"
  | "IO_ERROR"
  | "VERIFICATION_FAILED"
  | "RANGE_NOT_SATISFIABLE"
  | "SESSION_CLOSED"
  | "ENGINE_TIMEOUT"
  | "INTERNAL";

/** Every value of {@link ShellIpcErrorCode}, in union order. */
export const SHELL_IPC_ERROR_CODES: readonly ShellIpcErrorCode[] = [
  "unavailable",
  "quota-exceeded",
  "invalid-key",
  "io",
  "corrupt",
  "invalid-url",
  "blocked",
  "invalid-session",
  "INVALID_INPUT",
  "UNSUPPORTED_SOURCE",
  "NOT_FOUND",
  "IO_ERROR",
  "VERIFICATION_FAILED",
  "RANGE_NOT_SATISFIABLE",
  "SESSION_CLOSED",
  "ENGINE_TIMEOUT",
  "INTERNAL",
];

/**
 * The typed failure every fallible `ShellIpc` command rejects with. The
 * port wrappers re-map this onto their own typed errors (`StorageError`,
 * `BrowserSurfaceError`, `NativeMediaPortError`) — never onto bare Errors.
 */
export class ShellIpcError extends Error {
  readonly code: ShellIpcErrorCode;
  readonly detail: string;
  /** The engine session the failure concerns, when known (engine area). */
  readonly sessionId?: string;

  constructor(code: ShellIpcErrorCode, detail: string, sessionId?: string) {
    super(`shell ipc failure (${code}): ${detail}`);
    this.name = "ShellIpcError";
    this.code = code;
    this.detail = detail;
    if (sessionId !== undefined) this.sessionId = sessionId;
  }
}

/** Type guard for shell rejections from untrusted transport values. */
export function isShellIpcError(value: unknown): value is ShellIpcError {
  return (
    value instanceof ShellIpcError ||
    (typeof value === "object" &&
      value !== null &&
      (value as { name?: unknown }).name === "ShellIpcError" &&
      typeof (value as { code?: unknown }).code === "string" &&
      (SHELL_IPC_ERROR_CODES as readonly string[]).includes((value as { code: string }).code) &&
      typeof (value as { detail?: unknown }).detail === "string")
  );
}

/** Normalize an arbitrary rejection into a `ShellIpcError` (never bare). */
export function toShellIpcError(
  code: ShellIpcErrorCode,
  thrown: unknown,
  fallbackDetail: string,
): ShellIpcError {
  if (isShellIpcError(thrown)) return thrown;
  const detail = thrown instanceof Error ? thrown.message : String(thrown);
  return new ShellIpcError(code, `${fallbackDetail}: ${detail}`);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * One native lifecycle transition, stamped by the SHELL's clock. Kinds are
 * the `LifecycleEventKind` vocabulary verbatim (the port re-exports them).
 */
export interface ShellLifecycleEvent {
  readonly kind: "ready" | "background" | "resume" | "shutdown";
  readonly occurredAtMs: number;
}

/**
 * The shell's identity + configuration surfaced for honest reporting: the
 * shutdown budget the shell honors while the adapter drains async shutdown
 * hooks (the runtime's at-least-once outbox flush).
 */
export interface ShellInfo {
  /** The shell's stable identity (e.g. `"wfx-desktop-shell"`). */
  readonly shellId: string;
  /** The shell's version string. */
  readonly shellVersion: string;
  /** How long the shell waits (ms) for `lifecycleShutdownComplete` before exit. */
  readonly shutdownTimeoutMs: number;
  /** The OS app-data directory the storage area lives under. */
  readonly appDataDir: string;
}

// ---------------------------------------------------------------------------
// Storage (filesystem-truth)
// ---------------------------------------------------------------------------

/** Filesystem storage accounting (disk-truth: the bound is real free space). */
export interface ShellStorageQuota {
  /** Bytes occupied by the adapter's storage areas (sum of file sizes). */
  readonly usageBytes: number;
  /**
   * The real byte bound (free space on the app-data volume), or `null`
   * when the shell genuinely cannot know — never a fabricated number.
   */
  readonly quotaBytes: number | null;
}

// ---------------------------------------------------------------------------
// Browser host (contained webview surface)
// ---------------------------------------------------------------------------

/** A surface-open request crossing the seam (the BrowserSurfaceRequest shape). */
export interface ShellSurfaceOpenRequest {
  readonly url: string;
  /** Always `"isolate"` — the cookie-isolation contract is not optional. */
  readonly restrictCookies: "isolate";
  readonly purpose: "playback" | "authorization" | "general";
}

/** A shell-side surface event (the BrowserSurfaceEvent shape). */
export interface ShellSurfaceEvent {
  readonly kind: "navigated" | "closed" | "blocked";
  readonly sessionId: string;
  readonly url?: string;
  readonly occurredAtMs: number;
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** The OS permission state for the notification channel. */
export interface ShellPermissionState {
  readonly granted: boolean;
  readonly canRequest: boolean;
  readonly reason?: string;
}

/** One notification to show through the OS channel. */
export interface ShellNotification {
  readonly title: string;
  readonly body?: string;
  readonly category: "acquisition" | "playback" | "general";
  readonly itemId?: string;
}

/** The OS handoff outcome (never a fabricated delivery). */
export type ShellNotifyOutcome =
  | { readonly delivered: true }
  | {
      readonly delivered: false;
      readonly reason: "permission-denied" | "unavailable" | "invalid-request";
      readonly detail: string;
    };

// ---------------------------------------------------------------------------
// Background work
// ---------------------------------------------------------------------------

/** One background task the shell tracks (the BackgroundTaskSpec shape). */
export interface ShellTaskSpec {
  readonly taskId: string;
  readonly kind: "acquisition" | "sync" | "maintenance";
  readonly label: string;
}

/** One background task status snapshot (the BackgroundTaskStatus shape). */
export interface ShellTaskStatus {
  readonly taskId: string;
  readonly kind: "acquisition" | "sync" | "maintenance";
  readonly state: "scheduled" | "running" | "suspended" | "completed" | "failed" | "cancelled";
  readonly progress: number;
  readonly detail?: string;
  readonly updatedAtMs: number;
}

/** The typed outcome of a schedule call (the BackgroundWorkOutcome shape). */
export type ShellTaskOutcome =
  | { readonly accepted: true; readonly taskId: string }
  | {
      readonly accepted: false;
      readonly reason: "unsupported-kind" | "at-capacity" | "invalid-task";
      readonly detail: string;
    };

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

/** One share request (the ShareRequest shape). */
export interface ShellShareRequest {
  readonly title: string;
  readonly text?: string;
  readonly url?: string;
  readonly itemId?: string;
}

/**
 * The OS share-sheet outcome. `unsupported` is the shell-side honest answer
 * when the platform has no share target for this request (e.g. Linux
 * without a standard sheet): the port maps it through `canShare` so the UI
 * renders an honest unsupported state — never a fake share.
 */
export type ShellShareOutcome =
  | { readonly outcome: "shared" }
  | { readonly outcome: "dismissed" }
  | { readonly outcome: "failed"; readonly detail: string }
  | { readonly outcome: "unsupported"; readonly detail: string };

// ---------------------------------------------------------------------------
// Engine process (the R10 seam's transport)
// ---------------------------------------------------------------------------

/** Engine spawn configuration crossing the seam (the EngineConfig shape). */
export interface ShellEngineConfig {
  readonly cacheDir: string;
  readonly maxCacheBytes: number;
  readonly socketPath?: string;
  readonly binaryPath?: string;
}

/** A live engine binding minted by the shell. */
export interface ShellEngineHandleId {
  readonly engineId: string;
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/**
 * The native shell IPC surface. The Desktop adapter's every capability is
 * served through these commands; the shell implementation owns the real
 * OS facilities behind them.
 */
export interface ShellIpc {
  /** The shell's identity + shutdown budget (honest reporting surface). */
  info(): Promise<ShellInfo>;

  // — lifecycle —
  /** Subscribe to native lifecycle transitions (ready/background/resume/shutdown). */
  onLifecycleEvent(handler: (event: ShellLifecycleEvent) => void): Unsubscribe;
  /**
   * Tell the shell the adapter finished draining its async shutdown hooks.
   * The shell waits up to `info().shutdownTimeoutMs` for this after emitting
   * `shutdown`, then exits regardless (bounded teardown — documented law).
   */
  lifecycleShutdownComplete(): Promise<void>;

  // — filesystem storage —
  kvGet(key: string): Promise<string | null>;
  kvSet(key: string, value: string): Promise<void>;
  kvRemove(key: string): Promise<void>;
  kvKeys(prefix?: string): Promise<readonly string[]>;
  blobPut(key: string, bytes: Uint8Array): Promise<void>;
  blobGet(key: string): Promise<Uint8Array | null>;
  blobRemove(key: string): Promise<void>;
  storageQuota(): Promise<ShellStorageQuota>;

  // — contained browser surface —
  surfaceOpen(request: ShellSurfaceOpenRequest): Promise<{ readonly sessionId: string }>;
  surfaceNavigate(sessionId: string, url: string): Promise<void>;
  surfaceClose(sessionId: string): Promise<void>;
  onSurfaceEvent(handler: (event: ShellSurfaceEvent) => void): Unsubscribe;

  // — OS notifications —
  notificationPermission(): Promise<ShellPermissionState>;
  notificationRequestPermission(): Promise<ShellPermissionState>;
  notificationShow(notification: ShellNotification): Promise<ShellNotifyOutcome>;

  // — background work —
  taskSchedule(task: ShellTaskSpec): Promise<ShellTaskOutcome>;
  taskCancel(taskId: string): Promise<boolean>;
  taskStatus(taskId: string): Promise<ShellTaskStatus | null>;
  taskList(): Promise<readonly ShellTaskStatus[]>;
  onTaskEvent(handler: (status: ShellTaskStatus) => void): Unsubscribe;

  // — sharing —
  shareCanPresent(request: ShellShareRequest): Promise<boolean>;
  sharePresent(request: ShellShareRequest): Promise<ShellShareOutcome>;

  // — native-media engine process (the R10 seam transport) —
  /** Spawn/attach the engine process. Rejects typed (`ShellIpcError`). */
  engineSpawn(config: ShellEngineConfig): Promise<ShellEngineHandleId>;
  /**
   * Send one engine command; resolves with the engine's answering event
   * (the v1 DTO protocol: a successfully applied command answers with a
   * `state-changed` ack). Rejects with an engine-area `ShellIpcError`.
   */
  engineSend(engineId: string, command: EngineCommand): Promise<EngineEvent>;
  /** Subscribe to the engine's spontaneous telemetry events. */
  onEngineEvent(engineId: string, handler: (event: EngineEvent) => void): Unsubscribe;
  /** Terminate one engine binding (idempotent). */
  engineTerminate(engineId: string): Promise<void>;
}
