/**
 * @wfx/app-desktop — the deterministic shell simulator (R08). ⚠️ TESTS ONLY ⚠️
 *
 * The in-process double of the native shell: a complete `ShellIpc`
 * implementation with NO I/O, NO network, NO real process spawn —
 * everything deterministic (a manual clock, scripted outcomes, explicit
 * test pumps). The adapter's TypeScript side is proven against THIS
 * double; the real Rust shell (`apps/desktop/shell/`) is source-delivered
 * and lead-verified at R19 acceptance with the native toolchain (see
 * `shell/README.md` for the honest sandbox build status).
 *
 * The simulated engine speaks the REAL WFX-014 wire protocol: every
 * command and event crossing the simulated process boundary passes
 * through `JSON.parse(JSON.stringify(...))` AND the frozen runtime guards
 * (`isEngineCommand` / `isEngineEvent`) — the same discipline as
 * `@wfx/native-media`'s in-process simulation pipe, re-implemented here
 * so the tests own the scenarios (open/telemetry/complete/crash).
 */

import { isEngineCommand, isEngineEvent, NativeMediaError, validateEngineConfig } from "@wfx/native-media";
import type {
  EngineCommand,
  EngineConfig,
  EngineEvent,
  EngineEventHandler,
  EngineHandle,
  EngineSessionDto,
  NativeEngineProcess,
  NativeMediaErrorCode,
} from "@wfx/native-media";
import type { Unsubscribe } from "@wfx/platform-contracts";

import { ShellIpcError } from "../src/platform/shell-ipc";
import type {
  ShellAuthStoreEntry,
  ShellAuthStoreSupport,
  ShellEngineConfig,
  ShellFilePickOutcome,
  ShellFilePickRequest,
  ShellFilePickSupport,
  ShellIpc,
  ShellLifecycleEvent,
  ShellNotification,
  ShellNotifyOutcome,
  ShellPermissionState,
  ShellShareOutcome,
  ShellShareRequest,
  ShellStorageQuota,
  ShellSurfaceEvent,
  ShellSurfaceOpenRequest,
  ShellTaskReport,
  ShellTaskOutcome,
  ShellTaskSpec,
  ShellTaskStatus,
  ShellInfo,
} from "../src/platform/shell-ipc";

// ---------------------------------------------------------------------------
// The wire round-trip (proving DTO honesty across the simulated boundary)
// ---------------------------------------------------------------------------

function acrossTheWire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// The simulated ENGINE side (the "real engine" in the simulation)
// ---------------------------------------------------------------------------

/** The engine-side state machine's tunables. */
export interface SimEngineSideOptions {
  /** The state a freshly opened session reports (default `"buffering"`). */
  readonly openState?: EngineSessionDto["state"];
}

/**
 * The engine-side state machine: sessions, the six frozen operations, and
 * the state the test pumps patch. Speaks ONLY in DTOs.
 */
export class SimEngineSide {
  private counter = 0;
  private readonly sessions = new Map<string, EngineSessionDto>();
  private armedFailure: { code: NativeMediaErrorCode; detail?: string } | undefined;
  private readonly commandLog: EngineCommand[] = [];
  openState: EngineSessionDto["state"];
  terminated = false;

  constructor(options: SimEngineSideOptions = {}) {
    this.openState = options.openState ?? "buffering";
  }

  /** Every command the engine received, in order (assertion surface). */
  get commands(): readonly EngineCommand[] {
    return this.commandLog;
  }

  /** Arm a typed failure for the NEXT command (then clears). */
  failNextCommand(code: NativeMediaErrorCode, detail?: string): void {
    this.armedFailure = detail !== undefined ? { code, detail } : { code };
  }

  /** The engine-side command handler: answers the state-changed ack. */
  handleCommand(command: EngineCommand): EngineEvent {
    if (this.terminated) {
      throw new NativeMediaError("INVALID_INPUT", { detail: "the simulated engine was terminated" });
    }
    this.commandLog.push(command);
    const armed = this.armedFailure;
    if (armed !== undefined) {
      this.armedFailure = undefined;
      const options: { detail?: string; sessionId?: string } = {};
      if (armed.detail !== undefined) options.detail = armed.detail;
      if (command.kind !== "open" && command.sessionId !== undefined) {
        options.sessionId = command.sessionId;
      }
      throw new NativeMediaError(armed.code, options);
    }
    switch (command.kind) {
      case "open": {
        this.counter += 1;
        const dto: EngineSessionDto = {
          id: `sim-session-${this.counter}`,
          assetId: `sim-asset-${this.counter}`,
          fileId: `sim-file-${this.counter}`,
          state: this.openState,
          bufferedMs: 0,
          positionMs: 0,
        };
        this.sessions.set(dto.id, dto);
        return { protocolVersion: 1, kind: "state-changed", session: { ...dto } };
      }
      case "seek": {
        const session = this.requireSession(command.sessionId);
        const next = { ...session, positionMs: command.positionMs };
        this.sessions.set(next.id, next);
        return { protocolVersion: 1, kind: "state-changed", session: { ...next } };
      }
      case "prioritize":
      case "pause":
      case "resume": {
        const session = this.requireSession(command.sessionId);
        return { protocolVersion: 1, kind: "state-changed", session: { ...session } };
      }
      case "close": {
        const session = this.sessions.get(command.sessionId);
        if (session === undefined) {
          throw new NativeMediaError("NOT_FOUND", {
            sessionId: command.sessionId,
            detail: `no session '${command.sessionId}' in the simulated engine`,
          });
        }
        this.sessions.delete(session.id);
        // The final snapshot before the engine forgets the session.
        return { protocolVersion: 1, kind: "state-changed", session: { ...session } };
      }
    }
  }

  /** Test pump state: patch a tracked session + answer its DTO. */
  patchSession(sessionId: string, patch: Partial<EngineSessionDto>): EngineSessionDto {
    const session = this.requireSession(sessionId);
    const next = { ...session, ...patch };
    this.sessions.set(next.id, next);
    return next;
  }

  private requireSession(sessionId: string): EngineSessionDto {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new NativeMediaError("NOT_FOUND", {
        sessionId,
        detail: `no session '${sessionId}' in the simulated engine`,
      });
    }
    return session;
  }
}

// ---------------------------------------------------------------------------
// The simulated ENGINE handle (the process-boundary double)
// ---------------------------------------------------------------------------

/**
 * The engine handle double: `send` marshals commands through the JSON
 * wire + guards; the test pumps push spontaneous events through the same
 * wire to the registered handlers.
 */
export class SimEngineHandle implements EngineHandle {
  private readonly handlers = new Set<EngineEventHandler>();

  constructor(readonly side: SimEngineSide) {}

  async send(command: EngineCommand): Promise<EngineEvent> {
    const wire = acrossTheWire(command);
    if (!isEngineCommand(wire)) {
      throw new NativeMediaError("INTERNAL", { detail: "the sim wire garbled the command" });
    }
    const answer = await this.side.handleCommand(wire);
    const wireAnswer = acrossTheWire(answer);
    if (!isEngineEvent(wireAnswer)) {
      throw new NativeMediaError("INTERNAL", { detail: "the sim wire garbled the answer" });
    }
    return wireAnswer;
  }

  onEvent(handler: EngineEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  terminate(): void {
    this.side.terminated = true;
    this.handlers.clear();
  }

  // — test pumps (spontaneous telemetry, through the wire) —

  /** Pump: the engine reports playback position progress. */
  emitProgress(sessionId: string, positionMs: number): void {
    this.push({ protocolVersion: 1, kind: "progress", sessionId, positionMs });
  }

  /** Pump: the engine reports buffered-ahead duration. */
  emitBuffered(sessionId: string, bufferedMs: number): void {
    this.push({ protocolVersion: 1, kind: "buffered", sessionId, bufferedMs });
  }

  /** Pump: the engine reports an authoritative state change. */
  emitStateChanged(session: EngineSessionDto): void {
    const authoritative = this.side.patchSession(session.id, session);
    this.push({ protocolVersion: 1, kind: "state-changed", session: authoritative });
  }

  /** Pump: the engine died — an error event on the spontaneous channel. */
  crash(detail: string): void {
    this.push({ protocolVersion: 1, kind: "error", code: "INTERNAL", detail });
    this.side.terminated = true;
  }

  /** Pump: the engine emitted garbage (the malformed-event crash law). */
  emitMalformed(): void {
    for (const handler of this.handlers) {
      handler({ protocolVersion: 999, kind: "garbage" } as unknown as EngineEvent);
    }
  }

  private push(event: EngineEvent): void {
    const wire = acrossTheWire(event);
    if (!isEngineEvent(wire)) {
      throw new NativeMediaError("INTERNAL", { detail: "the sim wire garbled the event" });
    }
    for (const handler of this.handlers) handler(wire);
  }
}

/**
 * The standalone `NativeEngineProcess` double: each `spawn` mints a fresh
 * simulated engine + handle. Used directly by the binding tests (no shell
 * involvement) and injectable as the desktop app's engine process.
 */
export class SimEngineProcess implements NativeEngineProcess {
  /** Scripted spawn failure (then clears). */
  nextSpawnFailure: Error | undefined;
  /** The most recently spawned engine side (test accessor). */
  lastSide: SimEngineSide | undefined;
  /** The most recently spawned engine handle (test pump surface). */
  lastHandle: SimEngineHandle | undefined;
  /** Every spawned side, oldest first. */
  readonly sides: SimEngineSide[] = [];

  spawn(config: EngineConfig): EngineHandle {
    validateEngineConfig(config); // typed INVALID_INPUT on malformed values
    if (this.nextSpawnFailure !== undefined) {
      const failure = this.nextSpawnFailure;
      this.nextSpawnFailure = undefined;
      throw failure;
    }
    const side = new SimEngineSide();
    this.lastSide = side;
    this.sides.push(side);
    const handle = new SimEngineHandle(side);
    this.lastHandle = handle;
    return handle;
  }
}

// ---------------------------------------------------------------------------
// The shell simulator
// ---------------------------------------------------------------------------

/** Options for {@link SimShell}. */
export interface SimShellOptions {
  /** The simulated app-data dir path (default `"/sim/app-data"`). */
  readonly appDataDir?: string;
  /**
   * The simulated volume's free space in bytes — the DISK-TRUTH quota the
   * storage area reports and enforces (default 1 MiB).
   */
  readonly storageBoundBytes?: number;
  /** The shell's shutdown budget in ms (default 5 000; informational here). */
  readonly shutdownTimeoutMs?: number;
  /** Whether the OS share sheet exists on this simulated platform (default true). */
  readonly shareSheetPresent?: boolean;
  /** Whether notification permission can still be requested (default true). */
  readonly notificationCanRequest?: boolean;
  /**
   * Whether the platform can show a native file dialog (default `true`).
   * `false` simulates the honest `unsupported` pick verdict — a
   * headless/dialog-less platform (the R20-F typed truth).
   */
  readonly fileDialogPresent?: boolean;
  /**
   * Whether the OS credential store (keychain) is present on this
   * simulated platform (default `true`). `false` simulates the honest
   * `unsupported` store verdict — a platform with no keychain service
   * (the R22-H typed truth; the adapter must surface it, never silently
   * downgrade to plaintext storage).
   */
  readonly keychainPresent?: boolean;
}

/** One tracked surface session (isolation observable through cookie jars). */
interface SimSurface {
  readonly id: string;
  url: string;
  readonly purpose: "playback" | "authorization" | "general";
  /** The surface's OWN cookie jar — never shared with another surface. */
  readonly cookieJar: Map<string, string>;
  closed: boolean;
}

/**
 * The deterministic in-process native-shell double. Implements the full
 * `ShellIpc` contract; every fallible command rejects with the typed
 * `ShellIpcError`.
 */
export class SimShell implements ShellIpc {
  readonly shellId = "wfx-desktop-shell-sim";
  readonly shellVersion = "0.1.0-sim";
  readonly appDataDir: string;
  readonly storageBoundBytes: number;
  readonly shutdownTimeoutMs: number;

  // — manual clock (deterministic event timestamps) —
  private nowMs = 0;

  // — lifecycle —
  private readonly lifecycleHandlers = new Set<(event: ShellLifecycleEvent) => void>();
  private readonly lifecycleLog: ShellLifecycleEvent[] = [];
  private completeResolver: (() => void) | null = null;
  /** Whether `lifecycleShutdownComplete` was called after shutdown. */
  shutdownCompleted = false;
  terminated = false;

  // — storage —
  private readonly kv = new Map<string, string>();
  private readonly blobs = new Map<string, Uint8Array>();
  private readonly corruptedKeys = new Set<string>();

  // — surfaces —
  private surfaceCounter = 0;
  private readonly surfaces = new Map<string, SimSurface>();
  private readonly surfaceHandlers = new Set<(event: ShellSurfaceEvent) => void>();
  /** URLs the shell policy refuses (test hook). */
  blockedUrlPattern: RegExp | undefined;

  // — notifications —
  private permissionGranted = false;
  private readonly canRequestPermission: boolean;
  private permissionHardDenied = false;
  private permissionReason: string | undefined;
  /** Every notification the OS channel showed (assertion surface). */
  readonly shownNotifications: ShellNotification[] = [];

  // — background work —
  private readonly tasks = new Map<string, ShellTaskStatus>();
  private readonly taskHandlers = new Set<(status: ShellTaskStatus) => void>();
  /** How many tasks may be tracked at once (default unbounded). */
  taskCapacity = Number.POSITIVE_INFINITY;

  // — sharing —
  private readonly shareSheetPresent: boolean;
  /** The outcome the next `sharePresent` answers (default `shared`). */
  nextShareOutcome: ShellShareOutcome = { outcome: "shared" };
  /** Every share request the sheet saw (assertion surface). */
  readonly shareRequests: ShellShareRequest[] = [];

  // — native file import (R20-F) —
  private readonly fileDialogPresent: boolean;
  /** The scripted filesystem (path → bytes) the pick/read commands serve. */
  private readonly files = new Map<string, Uint8Array>();
  /**
   * The next pick's scripted answer (default: the user dismissed the
   * dialog — the deterministic no-op user path). A picked file must exist
   * in the scripted filesystem.
   */
  nextFilePickOutcome: { readonly picked: true; readonly path: string } | { readonly picked: false; readonly reason: "dismissed" } = {
    picked: false,
    reason: "dismissed",
  };
  /** Paths `fileRead` refuses with the honest `io` failure (test hook). */
  readonly unreadablePaths = new Set<string>();
  /** Every pick request the dialog saw (assertion surface). */
  readonly pickRequests: ShellFilePickRequest[] = [];

  // — auth store (R22-H: the OS keychain for the session secret) —
  private readonly keychainPresent: boolean;
  /** The in-memory credential entry (the keychain's single-slot truth). */
  private keychainEntry: ShellAuthStoreEntry | null = null;
  /**
   * Test hook: force `authStoreGet` to answer the honest `corrupt`
   * failure (a stored secret that cannot be read back — surfaced, never
   * silently treated as absent).
   */
  keychainCorrupt = false;
  /** Test hook: force `authStoreSet` to fail with the typed `io` code. */
  keychainWriteFailure = false;

  // — engine hosting —
  private engineCounter = 0;
  private readonly engines = new Map<string, { handle: SimEngineHandle; handlers: Set<EngineEventHandler> }>();
  /** Scripted engine spawn failure (then clears). */
  nextEngineSpawnFailure: ShellIpcError | undefined;

  constructor(options: SimShellOptions = {}) {
    this.appDataDir = options.appDataDir ?? "/sim/app-data";
    this.storageBoundBytes = options.storageBoundBytes ?? 1024 * 1024;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
    this.shareSheetPresent = options.shareSheetPresent ?? true;
    this.canRequestPermission = options.notificationCanRequest ?? true;
    this.fileDialogPresent = options.fileDialogPresent ?? true;
    this.keychainPresent = options.keychainPresent ?? true;
  }

  // -----------------------------------------------------------------------
  // The manual clock + lifecycle pumps
  // -----------------------------------------------------------------------

  /** Advance the shell's deterministic clock. */
  advanceClock(ms: number): void {
    this.nowMs += ms;
  }

  /** The shell's current (deterministic) time. */
  clockNow(): number {
    return this.nowMs;
  }

  /** Pump: emit a lifecycle transition (the window events). */
  emitLifecycle(kind: ShellLifecycleEvent["kind"]): void {
    if (this.terminated) return;
    const event: ShellLifecycleEvent = { kind, occurredAtMs: this.nowMs };
    this.lifecycleLog.push(event);
    for (const handler of this.lifecycleHandlers) handler(event);
    if (kind === "shutdown") {
      this.terminated = true; // the shell is terminating (bounded wait)
    }
  }

  /** Every lifecycle event emitted, in order (assertion surface). */
  get lifecycleEvents(): readonly ShellLifecycleEvent[] {
    return this.lifecycleLog;
  }

  /** Pump: the user requested window close (the bounded shutdown wait). */
  async requestShutdown(): Promise<void> {
    this.emitLifecycle("shutdown");
    await new Promise<void>((resolve) => {
      this.completeResolver = resolve;
    });
  }

  // -----------------------------------------------------------------------
  // ShellIpc — info + lifecycle
  // -----------------------------------------------------------------------

  async info(): Promise<ShellInfo> {
    return {
      shellId: this.shellId,
      shellVersion: this.shellVersion,
      shutdownTimeoutMs: this.shutdownTimeoutMs,
      appDataDir: this.appDataDir,
    };
  }

  onLifecycleEvent(handler: (event: ShellLifecycleEvent) => void): Unsubscribe {
    this.lifecycleHandlers.add(handler);
    return () => {
      this.lifecycleHandlers.delete(handler);
    };
  }

  async lifecycleShutdownComplete(): Promise<void> {
    this.shutdownCompleted = true;
    const resolve = this.completeResolver;
    this.completeResolver = null;
    if (resolve !== null) resolve();
  }

  // -----------------------------------------------------------------------
  // ShellIpc — storage (in-memory filesystem with disk-truth quota)
  // -----------------------------------------------------------------------

  /** Test hook: mark a key's stored value as bit-rotted (corrupt reads). */
  corruptKey(key: string): void {
    this.corruptedKeys.add(key);
  }

  private usageBytes(): number {
    let total = 0;
    for (const value of this.kv.values()) total += value.length;
    for (const blob of this.blobs.values()) total += blob.byteLength;
    return total;
  }

  private assertKey(key: string, operation: string): void {
    if (typeof key !== "string" || key.length === 0 || key.includes("\u0000")) {
      throw new ShellIpcError("invalid-key", `${operation}: unusable key '${String(key)}'`);
    }
  }

  async kvGet(key: string): Promise<string | null> {
    if (this.corruptedKeys.has(key)) {
      throw new ShellIpcError("corrupt", `kvGet: the stored value for '${key}' failed the integrity check`);
    }
    return this.kv.get(key) ?? null;
  }

  async kvSet(key: string, value: string): Promise<void> {
    this.assertKey(key, "kvSet");
    const previous = this.kv.get(key) ?? "";
    const next = this.usageBytes() - previous.length + value.length;
    if (next > this.storageBoundBytes) {
      throw new ShellIpcError(
        "quota-exceeded",
        `kvSet('${key}'): the write would exceed the volume's free space (${next} > ${this.storageBoundBytes} bytes)`,
      );
    }
    this.kv.set(key, value);
  }

  async kvRemove(key: string): Promise<void> {
    this.kv.delete(key);
    this.corruptedKeys.delete(key);
  }

  async kvKeys(prefix?: string): Promise<readonly string[]> {
    const all = [...this.kv.keys()].sort();
    return prefix === undefined ? all : all.filter((key) => key.startsWith(prefix));
  }

  async blobPut(key: string, bytes: Uint8Array): Promise<void> {
    this.assertKey(key, "blobPut");
    const previous = this.blobs.get(key)?.byteLength ?? 0;
    const next = this.usageBytes() - previous + bytes.byteLength;
    if (next > this.storageBoundBytes) {
      throw new ShellIpcError(
        "quota-exceeded",
        `blobPut('${key}'): the write would exceed the volume's free space (${next} > ${this.storageBoundBytes} bytes)`,
      );
    }
    this.blobs.set(key, bytes);
  }

  async blobGet(key: string): Promise<Uint8Array | null> {
    if (this.corruptedKeys.has(key)) {
      throw new ShellIpcError("corrupt", `blobGet: the stored blob for '${key}' failed the integrity check`);
    }
    return this.blobs.get(key) ?? null;
  }

  async blobRemove(key: string): Promise<void> {
    this.blobs.delete(key);
    this.corruptedKeys.delete(key);
  }

  async storageQuota(): Promise<ShellStorageQuota> {
    return { usageBytes: this.usageBytes(), quotaBytes: this.storageBoundBytes };
  }

  // -----------------------------------------------------------------------
  // ShellIpc — contained browser surfaces
  // -----------------------------------------------------------------------

  /** Test accessor: one surface's cookie jar (isolation assertions). */
  surfaceCookieJar(sessionId: string): Map<string, string> | undefined {
    return this.surfaces.get(sessionId)?.cookieJar;
  }

  private surfaceEvent(event: ShellSurfaceEvent): void {
    for (const handler of this.surfaceHandlers) handler(event);
  }

  async surfaceOpen(request: ShellSurfaceOpenRequest): Promise<{ readonly sessionId: string }> {
    if (request.restrictCookies !== "isolate") {
      throw new ShellIpcError(
        "invalid-session",
        "the cookie-isolation contract is not optional (the shell refuses non-isolated surfaces)",
      );
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      throw new ShellIpcError("invalid-url", `the URL '${request.url}' is not openable in the contained surface`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ShellIpcError(
        "invalid-url",
        `the contained surface only opens http(s) URLs (got '${url.protocol}')`,
      );
    }
    if (this.blockedUrlPattern?.test(request.url) === true) {
      throw new ShellIpcError("blocked", `the shell's policy refuses '${request.url}' (simulated policy)`);
    }
    this.surfaceCounter += 1;
    const id = `sim-surface-${this.surfaceCounter}`;
    this.surfaces.set(id, {
      id,
      url: request.url,
      purpose: request.purpose,
      cookieJar: new Map<string, string>(),
      closed: false,
    });
    return { sessionId: id };
  }

  async surfaceNavigate(sessionId: string, url: string): Promise<void> {
    const surface = this.surfaces.get(sessionId);
    if (surface === undefined || surface.closed) {
      throw new ShellIpcError("invalid-session", `no open surface '${sessionId}'`);
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ShellIpcError("invalid-url", `the URL '${url}' is not navigable`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ShellIpcError("invalid-url", "the surface only navigates to http(s) URLs");
    }
    if (this.blockedUrlPattern?.test(url) === true) {
      this.surfaceEvent({
        kind: "blocked",
        sessionId,
        url,
        occurredAtMs: this.nowMs,
        reason: "the shell's policy refused this navigation (simulated policy)",
      });
      throw new ShellIpcError("blocked", `the shell's policy refuses '${url}'`);
    }
    surface.url = url;
    // The provider page set its own cookie in ITS jar (observed, untouched).
    surface.cookieJar.set(parsed.hostname, `sim-provider-cookie-${sessionId}`);
    this.surfaceEvent({ kind: "navigated", sessionId, url, occurredAtMs: this.nowMs });
  }

  async surfaceClose(sessionId: string): Promise<void> {
    const surface = this.surfaces.get(sessionId);
    if (surface === undefined) {
      throw new ShellIpcError("invalid-session", `no surface '${sessionId}' to close`);
    }
    if (!surface.closed) {
      surface.closed = true;
      this.surfaceEvent({ kind: "closed", sessionId, occurredAtMs: this.nowMs });
    }
  }

  onSurfaceEvent(handler: (event: ShellSurfaceEvent) => void): Unsubscribe {
    this.surfaceHandlers.add(handler);
    return () => {
      this.surfaceHandlers.delete(handler);
    };
  }

  // -----------------------------------------------------------------------
  // ShellIpc — notifications
  // -----------------------------------------------------------------------

  /** Test hook: hard-deny the permission (canRequest becomes false). */
  hardDenyPermission(reason: string): void {
    this.permissionGranted = false;
    this.permissionHardDenied = true;
    this.permissionReason = reason;
  }

  async notificationPermission(): Promise<ShellPermissionState> {
    return {
      granted: this.permissionGranted,
      canRequest: this.canRequestPermission && !this.permissionGranted && !this.permissionHardDenied,
      ...(this.permissionReason !== undefined ? { reason: this.permissionReason } : {}),
    };
  }

  async notificationRequestPermission(): Promise<ShellPermissionState> {
    if (!this.canRequestPermission || this.permissionHardDenied) {
      return {
        granted: false,
        canRequest: false,
        reason: this.permissionReason ?? "permission was hard-denied",
      };
    }
    this.permissionGranted = true;
    this.permissionReason = undefined;
    return { granted: true, canRequest: false };
  }

  async notificationShow(notification: ShellNotification): Promise<ShellNotifyOutcome> {
    if (!this.permissionGranted) {
      return {
        delivered: false,
        reason: "permission-denied",
        detail: "the OS notification permission is not granted",
      };
    }
    this.shownNotifications.push(notification);
    return { delivered: true };
  }

  // -----------------------------------------------------------------------
  // ShellIpc — background work
  // -----------------------------------------------------------------------

  /** Test pump: move one task to a new state/progress (emits the change). */
  pumpTask(taskId: string, patch: Partial<ShellTaskStatus>): void {
    const task = this.tasks.get(taskId);
    if (task === undefined) return;
    const next: ShellTaskStatus = { ...task, ...patch, updatedAtMs: this.nowMs };
    this.tasks.set(taskId, next);
    for (const handler of this.taskHandlers) handler(next);
  }

  async taskSchedule(task: ShellTaskSpec): Promise<ShellTaskOutcome> {
    if (typeof task.taskId !== "string" || task.taskId.length === 0) {
      return {
        accepted: false,
        reason: "invalid-task",
        detail: "the taskId must be a non-empty string",
      };
    }
    if (task.kind !== "acquisition" && task.kind !== "sync" && task.kind !== "maintenance") {
      return {
        accepted: false,
        reason: "unsupported-kind",
        detail: `unknown background task kind '${String(task.kind)}'`,
      };
    }
    const existing = this.tasks.get(task.taskId);
    if (existing !== undefined && existing.state !== "cancelled") {
      // Idempotent per taskId: re-scheduling answers accepted, no duplicate.
      return { accepted: true, taskId: task.taskId };
    }
    if (this.tasks.size >= this.taskCapacity) {
      return {
        accepted: false,
        reason: "at-capacity",
        detail: `the task registry is at capacity (${this.taskCapacity})`,
      };
    }
    const status: ShellTaskStatus = {
      taskId: task.taskId,
      kind: task.kind,
      state: "scheduled",
      progress: -1,
      updatedAtMs: this.nowMs,
    };
    this.tasks.set(task.taskId, status);
    for (const handler of this.taskHandlers) handler(status);
    return { accepted: true, taskId: task.taskId };
  }

  async taskCancel(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (task === undefined) return false;
    if (task.state === "completed" || task.state === "failed" || task.state === "cancelled") {
      return false; // finished tasks are not cancellable
    }
    const next: ShellTaskStatus = { ...task, state: "cancelled", updatedAtMs: this.nowMs };
    this.tasks.set(taskId, next);
    for (const handler of this.taskHandlers) handler(next);
    return true;
  }

  async taskStatus(taskId: string): Promise<ShellTaskStatus | null> {
    const task = this.tasks.get(taskId);
    return task === undefined ? null : { ...task };
  }

  async taskList(): Promise<readonly ShellTaskStatus[]> {
    return [...this.tasks.values()].map((task) => ({ ...task }));
  }

  onTaskEvent(handler: (status: ShellTaskStatus) => void): Unsubscribe {
    this.taskHandlers.add(handler);
    return () => {
      this.taskHandlers.delete(handler);
    };
  }

  /** The executor report seam: move a KNOWN task (an unknown id answers false, never a fake transition). */
  async taskReport(report: ShellTaskReport): Promise<boolean> {
    const task = this.tasks.get(report.taskId);
    if (task === undefined) return false;
    this.pumpTask(report.taskId, {
      state: report.state,
      progress: report.progress,
      ...(report.detail !== undefined ? { detail: report.detail } : {}),
    });
    return true;
  }

  // -----------------------------------------------------------------------
  // ShellIpc — native file import (R20-F)
  // -----------------------------------------------------------------------

  /** Test hook: place one file in the scripted filesystem. */
  scriptFile(path: string, bytes: Uint8Array): void {
    this.files.set(path, bytes);
  }

  /** The scripted filesystem's file (assertion surface). */
  file(path: string): Uint8Array | undefined {
    return this.files.get(path);
  }

  async filePickAvailable(): Promise<ShellFilePickSupport> {
    if (!this.fileDialogPresent) {
      return {
        available: false,
        detail: "the simulated platform has no native file-dialog service (headless-like truth)",
      };
    }
    return { available: true };
  }

  async filePickOpen(request: ShellFilePickRequest): Promise<ShellFilePickOutcome> {
    this.pickRequests.push(request);
    if (!this.fileDialogPresent) {
      return {
        picked: false,
        reason: "unsupported",
        detail: "the simulated platform has no native file-dialog service (headless-like truth)",
      };
    }
    if (this.nextFilePickOutcome.picked) {
      const path = this.nextFilePickOutcome.path;
      const bytes = this.files.get(path);
      if (bytes === undefined) {
        throw new Error(
          `SimShell: filePickOpen scripted path '${path}' has no scripted file — call scriptFile(path, bytes) first`,
        );
      }
      const separator = path.lastIndexOf("/");
      const fileName = separator >= 0 ? path.slice(separator + 1) : path;
      return {
        picked: true,
        file: { path, fileName, sizeBytes: bytes.byteLength },
      };
    }
    return {
      picked: false,
      reason: this.nextFilePickOutcome.reason,
      detail: "the user closed the file dialog without choosing a file",
    };
  }

  async fileRead(path: string): Promise<Uint8Array> {
    if (this.unreadablePaths.has(path)) {
      throw new ShellIpcError("io", `fileRead('${path}'): the file could not be read (scripted failure)`);
    }
    const bytes = this.files.get(path);
    if (bytes === undefined) {
      throw new ShellIpcError("io", `fileRead('${path}'): the file does not exist on this platform`);
    }
    return bytes;
  }

  // -----------------------------------------------------------------------
  // ShellIpc — auth store (R22-H: the OS keychain for the session secret)
  // -----------------------------------------------------------------------

  async authStoreSupport(): Promise<ShellAuthStoreSupport> {
    if (!this.keychainPresent) {
      return {
        available: false,
        detail:
          "the simulated platform has no OS credential service (the honest unsupported truth — the adapter surfaces it, never a plaintext fallback)",
      };
    }
    return { available: true };
  }

  async authStoreSet(entry: ShellAuthStoreEntry): Promise<void> {
    if (!this.keychainPresent) {
      throw new ShellIpcError(
        "unavailable",
        "authStoreSet: the simulated platform has no OS credential service (the honest unsupported truth)",
      );
    }
    if (this.keychainWriteFailure) {
      throw new ShellIpcError("io", "authStoreSet: the credential service refused the write (scripted failure)");
    }
    if (typeof entry?.payload !== "string" || entry.payload.length === 0) {
      throw new ShellIpcError("invalid-key", "authStoreSet: expected a non-empty payload");
    }
    if (typeof entry?.savedAt !== "string" || entry.savedAt.length === 0) {
      throw new ShellIpcError("invalid-key", "authStoreSet: expected a non-empty savedAt instant");
    }
    // The keychain's own upsert: one slot, `set` REPLACES.
    this.keychainEntry = { payload: entry.payload, savedAt: entry.savedAt };
  }

  async authStoreGet(): Promise<ShellAuthStoreEntry | null> {
    if (!this.keychainPresent) {
      throw new ShellIpcError(
        "unavailable",
        "authStoreGet: the simulated platform has no OS credential service (the honest unsupported truth)",
      );
    }
    if (this.keychainCorrupt) {
      throw new ShellIpcError("corrupt", "authStoreGet: the stored entry could not be read (scripted corruption)");
    }
    if (this.keychainEntry === null) return null;
    return { ...this.keychainEntry };
  }

  async authStoreClear(): Promise<void> {
    if (!this.keychainPresent) {
      throw new ShellIpcError(
        "unavailable",
        "authStoreClear: the simulated platform has no OS credential service (the honest unsupported truth)",
      );
    }
    // Idempotent: clearing when nothing was stored is a success.
    this.keychainEntry = null;
    this.keychainCorrupt = false;
  }

  // -----------------------------------------------------------------------
  // ShellIpc — sharing
  // -----------------------------------------------------------------------

  async shareCanPresent(request: ShellShareRequest): Promise<boolean> {
    void request;
    return this.shareSheetPresent;
  }

  async sharePresent(request: ShellShareRequest): Promise<ShellShareOutcome> {
    this.shareRequests.push(request);
    if (!this.shareSheetPresent) {
      return {
        outcome: "unsupported",
        detail: "the simulated platform has no OS share sheet (Linux-like truth)",
      };
    }
    return this.nextShareOutcome;
  }

  // -----------------------------------------------------------------------
  // ShellIpc — engine hosting
  // -----------------------------------------------------------------------

  /** Test accessor: the engine side of one hosted engine. */
  engineSide(engineId: string): SimEngineSide | undefined {
    return this.engines.get(engineId)?.handle.side;
  }

  private engineEvent(engineId: string, event: EngineEvent): void {
    const engine = this.engines.get(engineId);
    if (engine === undefined) return;
    const wire = acrossTheWire(event);
    if (!isEngineEvent(wire)) return; // a garbled relay is dropped (guarded)
    for (const handler of engine.handlers) handler(wire);
  }

  async engineSpawn(config: ShellEngineConfig): Promise<{ readonly engineId: string }> {
    if (this.nextEngineSpawnFailure !== undefined) {
      const failure = this.nextEngineSpawnFailure;
      this.nextEngineSpawnFailure = undefined;
      throw failure;
    }
    validateEngineConfig(config);
    this.engineCounter += 1;
    const engineId = `sim-engine-${this.engineCounter}`;
    const handle = new SimEngineHandle(new SimEngineSide());
    this.engines.set(engineId, { handle, handlers: new Set<EngineEventHandler>() });
    return { engineId };
  }

  async engineSend(engineId: string, command: EngineCommand): Promise<EngineEvent> {
    const engine = this.engines.get(engineId);
    if (engine === undefined || engine.handle.side.terminated) {
      throw new ShellIpcError("NOT_FOUND", `no live engine '${engineId}'`);
    }
    const wire = acrossTheWire(command);
    if (!isEngineCommand(wire)) {
      throw new ShellIpcError("INTERNAL", "the engine command failed the wire guard");
    }
    try {
      const answer = await engine.handle.side.handleCommand(wire);
      const wireAnswer = acrossTheWire(answer);
      if (!isEngineEvent(wireAnswer)) {
        throw new ShellIpcError("INTERNAL", "the engine answer failed the wire guard");
      }
      return wireAnswer;
    } catch (thrown) {
      if (thrown instanceof NativeMediaError) {
        throw new ShellIpcError(thrown.code, thrown.detail ?? thrown.code, thrown.sessionId);
      }
      throw new ShellIpcError("INTERNAL", thrown instanceof Error ? thrown.message : String(thrown));
    }
  }

  onEngineEvent(engineId: string, handler: EngineEventHandler): Unsubscribe {
    const engine = this.engines.get(engineId);
    if (engine === undefined) return () => undefined;
    engine.handlers.add(handler);
    return () => {
      engine.handlers.delete(handler);
    };
  }

  async engineTerminate(engineId: string): Promise<void> {
    const engine = this.engines.get(engineId);
    if (engine === undefined) return;
    engine.handle.terminate();
    this.engines.delete(engineId);
  }

  // — engine-side pumps through the shell relay (spontaneous events) —

  /** Pump: a hosted engine reports position progress. */
  engineEmitProgress(engineId: string, sessionId: string, positionMs: number): void {
    this.engineEvent(engineId, { protocolVersion: 1, kind: "progress", sessionId, positionMs });
  }

  /** Pump: a hosted engine reports buffered-ahead duration. */
  engineEmitBuffered(engineId: string, sessionId: string, bufferedMs: number): void {
    this.engineEvent(engineId, { protocolVersion: 1, kind: "buffered", sessionId, bufferedMs });
  }

  /** Pump: a hosted engine reports an authoritative state change. */
  engineEmitStateChanged(engineId: string, session: EngineSessionDto): void {
    this.engineEvent(engineId, { protocolVersion: 1, kind: "state-changed", session });
  }

  /** Pump: a hosted engine died. */
  engineCrash(engineId: string, detail: string): void {
    this.engineEvent(engineId, { protocolVersion: 1, kind: "error", code: "INTERNAL", detail });
    const engine = this.engines.get(engineId);
    if (engine !== undefined) engine.handle.side.terminated = true;
  }
}
