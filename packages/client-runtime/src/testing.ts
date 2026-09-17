/**
 * @wfx/client-runtime — TEST DOUBLES (R01). ⚠️ TESTING ONLY ⚠️
 *
 * Deterministic, in-memory doubles for the runtime's injected seams:
 * an `InMemoryServerPort` (programmable answers + failure injection + the
 * emitted-event log) and platform capability stubs (web/desktop/mobile
 * bundles with in-memory ports). PRODUCTION CODE MUST NEVER IMPORT THIS
 * MODULE — it exists for tests and local development harnesses only (the
 * same discipline as `@wfx/experience`'s `fixtures.ts` and
 * `@wfx/native-media`'s `fixtures.ts`; a fixture is never silently
 * presented as production capability — frozen invariant 10).
 *
 * Everything here is deterministic: fixed clocks, sequential ids, no
 * network, no timers.
 */

import type {
  ActionReceipt,
  EntertainmentEvent,
  IntentRecord,
  LibraryCommand,
  LibraryEntry,
  PlaybackRealization,
  RecommendationPolicy,
  SearchResult,
  SourceItem,
  UserAction,
} from "@wfx/domain";
import { NativeMediaPortError } from "@wfx/platform-contracts";
import type {
  BackgroundWorkOutcome,
  BackgroundWorkPort,
  BackgroundTaskSpec,
  BackgroundTaskStatus,
  BrowserHostPort,
  BrowserSurfaceEvent,
  BrowserSurfaceRequest,
  BrowserSurfaceSession,
  LifecycleEvent,
  LifecycleEventKind,
  LifecycleHook,
  LifecycleListener,
  LifecyclePhase,
  LifecyclePort,
  NativeMediaOpenInput,
  NativeMediaPort,
  NativeMediaSessionEvent,
  NativeMediaSessionSnapshot,
  NotificationOutcome,
  NotificationPermission,
  NotificationPort,
  NotificationRequest,
  PlatformCapabilities,
  SharingPort,
  ShareOutcome,
  ShareRequest,
  StoragePort,
  StorageQuota,
  Unsubscribe,
} from "@wfx/platform-contracts";

import type { RuntimeClock, RuntimeIdGen } from "./runtime-seams";
import type {
  ProfileHistoryEntry,
  ServerFailure,
  ServerPort,
  ServerResult,
  SourceInfo,
} from "./server-port";
import type { RecommendationPolicyCommand, UserIntentCommand } from "./intent";

// ---------------------------------------------------------------------------
// Clock + id doubles
// ---------------------------------------------------------------------------

/** A fixed clock the test advances explicitly. Deterministic. */
export class FixedClock implements RuntimeClock {
  constructor(private nowMs: number) {}
  now(): number {
    return this.nowMs;
  }
  advance(ms: number): void {
    this.nowMs += ms;
  }
  set(ms: number): void {
    this.nowMs = ms;
  }
}

/** The Crockford Base32 alphabet (excludes I, L, O, U) — 32 symbols. */
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A sequential ULID-body generator (deterministic, valid canonical bodies). */
export class SequentialIdGen implements RuntimeIdGen {
  private counter = 0;
  next(): string {
    this.counter += 1;
    // A valid 26-char Crockford Base32 body: '0' + 17 zeros + the counter
    // Crockford-encoded in the last 8 chars — sequential, unique, canonical.
    let remaining = this.counter;
    let encoded = "";
    for (let index = 0; index < 8; index += 1) {
      encoded = CROCKFORD_ALPHABET[remaining % 32]! + encoded;
      remaining = Math.floor(remaining / 32);
    }
    return `0${"0".repeat(17)}${encoded}`;
  }
}

// ---------------------------------------------------------------------------
// InMemoryServerPort
// ---------------------------------------------------------------------------

/** The programmable state of one server operation's next answer. */
export type ScriptedServerAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ServerFailure };

/**
 * The in-memory ServerPort double: programmable answers per operation,
 * failure injection, and the emitted-event log (for at-least-once and
 * redelivery assertions). Implements the FULL port INCLUDING the R02
 * profile-aware reads (programmable + logged — see `intentWrites`,
 * `policyWrites`). TESTING ONLY.
 */
export class InMemoryServerPort implements ServerPort {
  readonly serviceId = "in-memory-test-service";

  private readonly searchAnswers = new Map<string, ScriptedServerAnswer<readonly SearchResult[]>>();
  private readonly shortsAnswers = new Map<string, ScriptedServerAnswer<readonly SearchResult[]>>();
  private readonly metadataAnswers = new Map<string, ScriptedServerAnswer<SourceItem | null>>();
  private readonly resolveAnswers = new Map<string, ScriptedServerAnswer<readonly PlaybackRealization[]>>();
  private readonly actionAnswers: ScriptedServerAnswer<ActionReceipt>[] = [];
  private readonly libraryReadAnswers: ScriptedServerAnswer<readonly LibraryEntry[]>[] = [];
  private readonly libraryWriteAnswers: ScriptedServerAnswer<ActionReceipt>[] = [];
  private readonly historyAnswers: ScriptedServerAnswer<readonly ProfileHistoryEntry[]>[] = [];
  private readonly profileLibraryAnswers: ScriptedServerAnswer<readonly LibraryEntry[]>[] = [];
  private readonly intentsReadAnswers: ScriptedServerAnswer<readonly IntentRecord[]>[] = [];
  private readonly intentWriteAnswers: ScriptedServerAnswer<void>[] = [];
  private readonly policyReadAnswers: ScriptedServerAnswer<RecommendationPolicy | null>[] = [];
  private readonly policyWriteAnswers: ScriptedServerAnswer<void>[] = [];
  private readonly sourcesReadAnswers: ScriptedServerAnswer<readonly SourceInfo[]>[] = [];
  private emitFailures: ServerFailure[] = [];

  /** Every event the port accepted, in delivery order (duplicates visible). */
  readonly emittedEvents: EntertainmentEvent[] = [];
  /** Every intent command the port accepted (R02 assertion surface). */
  readonly intentWrites: UserIntentCommand[] = [];
  /** Every policy command the port accepted (R02 assertion surface). */
  readonly policyWrites: RecommendationPolicyCommand[] = [];

  // — scripting —

  scriptSearch(query: string, answer: ScriptedServerAnswer<readonly SearchResult[]>): void {
    this.searchAnswers.set(query, answer);
  }

  scriptShorts(query: string, answer: ScriptedServerAnswer<readonly SearchResult[]>): void {
    this.shortsAnswers.set(query, answer);
  }

  scriptMetadata(ref: string, answer: ScriptedServerAnswer<SourceItem | null>): void {
    this.metadataAnswers.set(ref, answer);
  }

  scriptResolve(ref: string, answer: ScriptedServerAnswer<readonly PlaybackRealization[]>): void {
    this.resolveAnswers.set(ref, answer);
  }

  scriptAction(answer: ScriptedServerAnswer<ActionReceipt>): void {
    this.actionAnswers.push(answer);
  }

  scriptLibraryRead(answer: ScriptedServerAnswer<readonly LibraryEntry[]>): void {
    this.libraryReadAnswers.push(answer);
  }

  scriptLibraryWrite(answer: ScriptedServerAnswer<ActionReceipt>): void {
    this.libraryWriteAnswers.push(answer);
  }

  /** R02: script the next profile-scoped history read(s). */
  scriptHistoryRead(answer: ScriptedServerAnswer<readonly ProfileHistoryEntry[]>): void {
    this.historyAnswers.push(answer);
  }

  /** R02: script the next profile-scoped library read(s). */
  scriptProfileLibraryRead(answer: ScriptedServerAnswer<readonly LibraryEntry[]>): void {
    this.profileLibraryAnswers.push(answer);
  }

  /** R02: script the next profile-scoped intents read(s). */
  scriptIntentsRead(answer: ScriptedServerAnswer<readonly IntentRecord[]>): void {
    this.intentsReadAnswers.push(answer);
  }

  /** R02: script the next intent write answer(s). */
  scriptIntentWrite(answer: ScriptedServerAnswer<void>): void {
    this.intentWriteAnswers.push(answer);
  }

  /** R02: script the next policy read answer(s) (null = unset policy). */
  scriptPolicyRead(answer: ScriptedServerAnswer<RecommendationPolicy | null>): void {
    this.policyReadAnswers.push(answer);
  }

  /** R02: script the next policy write answer(s). */
  scriptPolicyWrite(answer: ScriptedServerAnswer<void>): void {
    this.policyWriteAnswers.push(answer);
  }

  /** R03: script the next source-management read(s) (`readSources`). */
  scriptSourcesRead(answer: ScriptedServerAnswer<readonly SourceInfo[]>): void {
    this.sourcesReadAnswers.push(answer);
  }

  /** Queue the NEXT emitEvent failure(s); an empty queue accepts. */
  failNextEmits(...failures: ServerFailure[]): void {
    this.emitFailures.push(...failures);
  }

  // — ServerPort —

  async search(query: string): Promise<ServerResult<readonly SearchResult[]>> {
    return answerOr(this.searchAnswers.get(query), [], `search(${query})`);
  }

  async shorts(query?: string): Promise<ServerResult<readonly SearchResult[]>> {
    return answerOr(this.shortsAnswers.get(query ?? ""), [], `shorts(${query ?? ""})`);
  }

  async metadata(ref: string): Promise<ServerResult<SourceItem | null>> {
    return answerOr(this.metadataAnswers.get(ref), null, `metadata(${ref})`);
  }

  async resolve(ref: string): Promise<ServerResult<readonly PlaybackRealization[]>> {
    return answerOr(this.resolveAnswers.get(ref), [], `resolve(${ref})`);
  }

  async executeAction(action: UserAction): Promise<ServerResult<ActionReceipt>> {
    void action;
    const scripted = this.actionAnswers.shift();
    if (scripted !== undefined) return toResult(scripted);
    // Default: an honest confirmed receipt.
    return {
      ok: true,
      value: { status: "confirmed", occurredAt: new Date(0).toISOString() },
    };
  }

  async readLibrary(): Promise<ServerResult<readonly LibraryEntry[]>> {
    const scripted = this.libraryReadAnswers.shift();
    if (scripted !== undefined) return toResult(scripted);
    return { ok: true, value: [] };
  }

  async writeLibrary(command: LibraryCommand): Promise<ServerResult<ActionReceipt>> {
    const scripted = this.libraryWriteAnswers.shift();
    if (scripted !== undefined) return toResult(scripted);
    void command;
    return {
      ok: true,
      value: { status: "confirmed", occurredAt: new Date(0).toISOString() },
    };
  }

  async emitEvent(event: EntertainmentEvent): Promise<ServerResult<void>> {
    const failure = this.emitFailures.shift();
    if (failure !== undefined) return { ok: false, failure };
    this.emittedEvents.push(event);
    return { ok: true, value: undefined };
  }

  // — the R02 profile extension (unscripted reads answer honest empty
  // defaults; writes log + answer ok, exactly like the R01 double's law) —

  async readHistory(): Promise<ServerResult<readonly ProfileHistoryEntry[]>> {
    const scripted = this.historyAnswers.shift();
    if (scripted !== undefined) return toResult(scripted);
    return { ok: true, value: [] };
  }

  async readProfileLibrary(): Promise<ServerResult<readonly LibraryEntry[]>> {
    const scripted = this.profileLibraryAnswers.shift();
    if (scripted !== undefined) return toResult(scripted);
    return { ok: true, value: [] };
  }

  async readIntents(): Promise<ServerResult<readonly IntentRecord[]>> {
    const scripted = this.intentsReadAnswers.shift();
    if (scripted !== undefined) return toResult(scripted);
    return { ok: true, value: [] };
  }

  async writeIntent(intent: UserIntentCommand): Promise<ServerResult<void>> {
    this.intentWrites.push(intent);
    const scripted = this.intentWriteAnswers.shift();
    if (scripted !== undefined) return toResult(scripted);
    return { ok: true, value: undefined };
  }

  async readPolicy(): Promise<ServerResult<RecommendationPolicy | null>> {
    const scripted = this.policyReadAnswers.shift();
    if (scripted !== undefined) return toResult(scripted);
    return { ok: true, value: null };
  }

  async writePolicy(policy: RecommendationPolicyCommand): Promise<ServerResult<void>> {
    this.policyWrites.push(policy);
    const scripted = this.policyWriteAnswers.shift();
    if (scripted !== undefined) return toResult(scripted);
    return { ok: true, value: undefined };
  }

  // — the R03 source extension (the honest empty list is the anonymous
  // truth; tests script what they assert) —

  async readSources(): Promise<ServerResult<readonly SourceInfo[]>> {
    const scripted = this.sourcesReadAnswers.shift();
    if (scripted !== undefined) return toResult(scripted);
    return { ok: true, value: [] };
  }
}

function toResult<T>(scripted: ScriptedServerAnswer<T>): ServerResult<T> {
  return scripted.ok
    ? { ok: true, value: scripted.value }
    : { ok: false, failure: scripted.failure };
}

function answerOr<T>(
  scripted: ScriptedServerAnswer<T> | undefined,
  emptyDefault: T,
  label: string,
): ServerResult<T> {
  if (scripted !== undefined) return toResult(scripted);
  // Unscripted reads answer the honest empty default (tests script what
  // they assert; the label documents the fallthrough).
  void label;
  return { ok: true, value: emptyDefault };
}

// ---------------------------------------------------------------------------
// In-memory platform ports
// ---------------------------------------------------------------------------

/** In-memory LifecyclePort: tests drive the phase transitions explicitly. */
export class InMemoryLifecyclePort implements LifecyclePort {
  private currentPhase: LifecyclePhase = "initializing";
  private readonly listeners = new Set<LifecycleListener>();
  private readonly hooks = new Map<LifecycleEventKind, Set<LifecycleHook>>();
  /** Every emitted event, in order (assertion surface). */
  readonly events: LifecycleEvent[] = [];

  async emit(kind: LifecycleEventKind, occurredAtMs: number): Promise<void> {
    const event: LifecycleEvent = { kind, occurredAtMs };
    this.events.push(event);
    if (kind === "ready") this.currentPhase = "active";
    else if (kind === "background") this.currentPhase = "background";
    else if (kind === "resume") this.currentPhase = "active";
    else if (kind === "shutdown") this.currentPhase = "shutdown";
    for (const listener of this.listeners) listener(event);
    // Async hooks (shutdown flushes) are AWAITED — the adapter contract.
    for (const hook of this.hooks.get(kind) ?? []) await hook(event);
  }

  phase(): LifecyclePhase {
    return this.currentPhase;
  }

  subscribe(listener: LifecycleListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  hook(kind: LifecycleEventKind, hook: LifecycleHook): Unsubscribe {
    const set = this.hooks.get(kind) ?? new Set();
    set.add(hook);
    this.hooks.set(kind, set);
    return () => {
      set.delete(hook);
    };
  }
}

/** In-memory StoragePort with a byte bound (quota-aware, typed errors). */
export class InMemoryStoragePort implements StoragePort {
  private readonly kv = new Map<string, string>();
  private readonly blobs = new Map<string, Uint8Array>();

  constructor(private readonly boundBytes = 1024 * 1024) {}

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    if (key.length === 0) throw storageError("invalid-key", "set", "empty key");
    const next = this.usage() - byteLength(this.kv.get(key) ?? "") + byteLength(value);
    if (next > this.boundBytes) {
      throw storageError("quota-exceeded", "set", `would exceed the ${this.boundBytes}-byte bound`);
    }
    this.kv.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.kv.delete(key);
  }

  async keys(prefix?: string): Promise<readonly string[]> {
    const all = [...this.kv.keys()];
    return prefix === undefined ? all : all.filter((key) => key.startsWith(prefix));
  }

  async putBlob(key: string, bytes: Uint8Array): Promise<void> {
    if (key.length === 0) throw storageError("invalid-key", "putBlob", "empty key");
    const next = this.usage() - (this.blobs.get(key)?.length ?? 0) + bytes.length;
    if (next > this.boundBytes) {
      throw storageError("quota-exceeded", "putBlob", `would exceed the ${this.boundBytes}-byte bound`);
    }
    this.blobs.set(key, bytes);
  }

  async getBlob(key: string): Promise<Uint8Array | null> {
    return this.blobs.get(key) ?? null;
  }

  async removeBlob(key: string): Promise<void> {
    this.blobs.delete(key);
  }

  async quota(): Promise<StorageQuota> {
    return { usageBytes: this.usage(), quotaBytes: this.boundBytes };
  }

  private usage(): number {
    let total = 0;
    for (const value of this.kv.values()) total += byteLength(value);
    for (const blob of this.blobs.values()) total += blob.length;
    return total;
  }
}

function byteLength(value: string): number {
  return value.length;
}

function storageError(code: "quota-exceeded" | "invalid-key", operation: string, detail: string): Error {
  const error = new Error(`storage failure (${code}) during ${operation}: ${detail}`);
  error.name = "StorageError";
  return Object.assign(error, { code, operation, retryable: code === "quota-exceeded" });
}

/** Recorded browser-surface open (assertion surface for the isolation contract). */
export type RecordedSurfaceOpen = BrowserSurfaceRequest;

/** In-memory BrowserHostPort: scripted surfaces, recorded opens. */
export class InMemoryBrowserHostPort implements BrowserHostPort {
  private counter = 0;
  readonly opens: RecordedSurfaceOpen[] = [];

  async open(request: BrowserSurfaceRequest): Promise<BrowserSurfaceSession> {
    if (request.restrictCookies !== "isolate") {
      throw new Error("browser surface failure (invalid-session): the cookie-isolation contract is not optional");
    }
    this.counter += 1;
    this.opens.push({ ...request });
    const id = `test-surface-${this.counter}`;
    const listeners = new Set<(event: BrowserSurfaceEvent) => void>();
    let closed = false;
    const occurredAtMs = 0;
    return {
      id,
      url: request.url,
      navigate: async (url: string) => {
        if (closed) throw new Error("browser surface failure (invalid-session): closed");
        for (const listener of listeners) {
          listener({ kind: "navigated", sessionId: id, url, occurredAtMs });
        }
      },
      close: async () => {
        closed = true;
        for (const listener of listeners) {
          listener({ kind: "closed", sessionId: id, occurredAtMs });
        }
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
  }
}

/** In-memory NativeMediaPort (the clearly-marked R10 test double). */
export class InMemoryNativeMediaPort implements NativeMediaPort {
  private counter = 0;
  private readonly sessions = new Map<string, NativeMediaSessionSnapshot>();
  private readonly listeners = new Set<(event: NativeMediaSessionEvent) => void>();
  /** The open inputs the port received (assertion surface). */
  readonly opens: NativeMediaOpenInput[] = [];

  async open(input: NativeMediaOpenInput): Promise<NativeMediaSessionSnapshot> {
    this.counter += 1;
    this.opens.push(input);
    const id = `test-native-${this.counter}`;
    const snapshot: NativeMediaSessionSnapshot = {
      id,
      assetId: `test-asset-${this.counter}`,
      fileId: `test-file-${this.counter}`,
      state: "resolving",
      bufferedMs: 0,
      positionMs: 0,
      integrity: "unknown",
    };
    this.sessions.set(id, snapshot);
    return snapshot;
  }

  async close(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async pause(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) throw unknownSession(sessionId);
    this.transition(sessionId, "buffering");
  }

  async resume(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) throw unknownSession(sessionId);
    this.transition(sessionId, "playing");
  }

  async seek(sessionId: string, positionMs: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) throw unknownSession(sessionId);
    this.publish({ ...session, positionMs, state: "playing" });
  }

  async prioritize(): Promise<void> {
    // The test double schedules nothing; deadlines are R12's real logic.
  }

  async readRange(
    _sessionId: string,
    _request: { offset: number; length: number },
  ): Promise<Uint8Array> {
    // The test double serves zeros — tests assert the call, not the bytes.
    return new Uint8Array(_request.length);
  }

  async inspect(sessionId: string): Promise<NativeMediaSessionSnapshot> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) throw unknownSession(sessionId);
    return { ...session };
  }

  subscribe(listener: (event: NativeMediaSessionEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Test pump: publish a truthful session event (with optional failure detail). */
  publish(session: NativeMediaSessionSnapshot, detail?: string): void {
    this.sessions.set(session.id, session);
    const event: NativeMediaSessionEvent = {
      sessionId: session.id,
      state: session.state,
      bufferedMs: session.bufferedMs,
      positionMs: session.positionMs,
      integrity: session.integrity,
      occurredAtMs: 0,
      ...(detail !== undefined ? { detail } : {}),
    };
    for (const listener of this.listeners) listener(event);
  }

  private transition(sessionId: string, state: NativeMediaSessionSnapshot["state"]): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) throw unknownSession(sessionId);
    this.publish({ ...session, state });
  }
}

/** The double's typed unknown-session failure (the port contract's error). */
function unknownSession(sessionId: string): NativeMediaPortError {
  return new NativeMediaPortError("unknown-session", `no session '${sessionId}' in the test double`);
}

/** In-memory NotificationPort: permission is scripted, delivery recorded. */
export class InMemoryNotificationPort implements NotificationPort {
  private granted = false;
  readonly notifications: NotificationRequest[] = [];

  async permission(): Promise<NotificationPermission> {
    return { granted: this.granted, canRequest: true };
  }

  async requestPermission(): Promise<NotificationPermission> {
    this.granted = true;
    return { granted: true, canRequest: true };
  }

  async notify(request: NotificationRequest): Promise<NotificationOutcome> {
    if (!this.granted) {
      return { delivered: false, reason: "permission-denied", detail: "permission not granted" };
    }
    this.notifications.push(request);
    return { delivered: true };
  }
}

/** In-memory BackgroundWorkPort: tracked tasks, scripted transitions. */
export class InMemoryBackgroundWorkPort implements BackgroundWorkPort {
  private readonly tasks = new Map<string, BackgroundTaskStatus>();
  private readonly listeners = new Set<(status: BackgroundTaskStatus) => void>();

  async schedule(task: BackgroundTaskSpec): Promise<BackgroundWorkOutcome> {
    if (task.taskId.length === 0) {
      return { accepted: false, reason: "invalid-task", detail: "empty taskId" };
    }
    const status: BackgroundTaskStatus = {
      taskId: task.taskId,
      kind: task.kind,
      state: "scheduled",
      progress: -1,
      updatedAtMs: 0,
    };
    this.tasks.set(task.taskId, status);
    this.publish(status);
    return { accepted: true, taskId: task.taskId };
  }

  async cancel(taskId: string): Promise<boolean> {
    return this.tasks.delete(taskId);
  }

  async status(taskId: string): Promise<BackgroundTaskStatus | null> {
    const status = this.tasks.get(taskId);
    return status === undefined ? null : { ...status };
  }

  async list(): Promise<readonly BackgroundTaskStatus[]> {
    return [...this.tasks.values()].map((status) => ({ ...status }));
  }

  subscribe(listener: (status: BackgroundTaskStatus) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Test pump: publish a task status change. */
  publish(status: BackgroundTaskStatus): void {
    this.tasks.set(status.taskId, status);
    for (const listener of this.listeners) listener(status);
  }
}

/** In-memory SharingPort: records requests; scripted outcomes. */
export class InMemorySharingPort implements SharingPort {
  readonly requests: ShareRequest[] = [];
  nextOutcome: ShareOutcome = { outcome: "shared" };

  async canShare(request: ShareRequest): Promise<boolean> {
    return typeof request.title === "string" && request.title.length > 0;
  }

  async share(request: ShareRequest): Promise<ShareOutcome> {
    this.requests.push(request);
    return this.nextOutcome;
  }
}

// ---------------------------------------------------------------------------
// Capability bundles (truthful per-platform presets)
// ---------------------------------------------------------------------------

/**
 * The TRUTHFUL WEB bundle: no native media (no native torrent on the
 * browser — honest unsupported states), no background work, contained
 * browser host where permitted, browser storage.
 */
export function makeWebCapabilities(): PlatformCapabilities & {
  ports: PlatformCapabilities["ports"] & {
    readonly lifecycle: InMemoryLifecyclePort;
    readonly storage: InMemoryStoragePort;
    readonly browserHost: InMemoryBrowserHostPort;
  };
} {
  const lifecycle = new InMemoryLifecyclePort();
  const storage = new InMemoryStoragePort();
  const browserHost = new InMemoryBrowserHostPort();
  return {
    platform: "web",
    storage: "browser",
    browserHost: "contained",
    nativeMedia: "none",
    backgroundWork: "none",
    sharing: true,
    notifications: true,
    descriptor: {
      platform: "web",
      adapterId: "wfx-web-adapter-test",
      adapterVersion: "0.1.0-test",
      limitations: {
        nativeMedia: "browsers cannot host the native media service — authorized native acquisition is Desktop-only",
        backgroundWork: "browser tabs suspend; no truthful background acquisition",
      },
    },
    ports: {
      lifecycle,
      storage,
      browserHost,
      nativeMedia: null,
      notifications: new InMemoryNotificationPort(),
      backgroundWork: null,
      sharing: new InMemorySharingPort(),
    },
  };
}

/**
 * The TRUTHFUL DESKTOP bundle: the full reference capability — native
 * media service, full background work, filesystem storage, contained
 * browser host.
 */
export function makeDesktopCapabilities(): PlatformCapabilities & {
  ports: PlatformCapabilities["ports"] & {
    readonly lifecycle: InMemoryLifecyclePort;
    readonly storage: InMemoryStoragePort;
    readonly browserHost: InMemoryBrowserHostPort;
    readonly nativeMedia: InMemoryNativeMediaPort;
    readonly backgroundWork: InMemoryBackgroundWorkPort;
  };
} {
  const lifecycle = new InMemoryLifecyclePort();
  const storage = new InMemoryStoragePort();
  const browserHost = new InMemoryBrowserHostPort();
  const nativeMedia = new InMemoryNativeMediaPort();
  const backgroundWork = new InMemoryBackgroundWorkPort();
  return {
    platform: "desktop",
    storage: "filesystem",
    browserHost: "contained",
    nativeMedia: "native-service",
    backgroundWork: "full",
    sharing: true,
    notifications: true,
    descriptor: {
      platform: "desktop",
      adapterId: "wfx-desktop-adapter-test",
      adapterVersion: "0.1.0-test",
    },
    ports: {
      lifecycle,
      storage,
      browserHost,
      nativeMedia,
      notifications: new InMemoryNotificationPort(),
      backgroundWork,
      sharing: new InMemorySharingPort(),
    },
  };
}

/**
 * The TRUTHFUL MOBILE bundle (the future adapter's reference shape):
 * local native media, limited background work, OS-managed storage,
 * contained browser host.
 */
export function makeMobileCapabilities(): PlatformCapabilities {
  const lifecycle = new InMemoryLifecyclePort();
  const storage = new InMemoryStoragePort();
  const browserHost = new InMemoryBrowserHostPort();
  const nativeMedia = new InMemoryNativeMediaPort();
  const backgroundWork = new InMemoryBackgroundWorkPort();
  return {
    platform: "mobile",
    storage: "os-managed",
    browserHost: "contained",
    nativeMedia: "local",
    backgroundWork: "limited",
    sharing: true,
    notifications: true,
    descriptor: {
      platform: "mobile",
      adapterId: "wfx-mobile-adapter-test",
      adapterVersion: "0.1.0-test",
      limitations: {
        backgroundWork: "OS-scheduled windows only — background completion is bounded",
      },
    },
    ports: {
      lifecycle,
      storage,
      browserHost,
      nativeMedia,
      notifications: new InMemoryNotificationPort(),
      backgroundWork,
      sharing: new InMemorySharingPort(),
    },
  };
}
