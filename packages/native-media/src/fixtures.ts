/**
 * @wfx/native-media — TEST FIXTURES (WFX-004, Lane B).
 *
 * TEST FIXTURES ONLY — NEVER WIRED AS PRODUCTION.
 *
 * `stubEngine()` builds an in-memory `NativeMediaEngine` double with:
 * - simulated buffering progress (`advanceBufferedMs`),
 * - controllable state (`forceState`, `openState`, failure/hang hooks),
 * - a call log for asserting adapter → engine mapping,
 * - the optional `RangeAccessEngine` extension over a deterministic
 *   in-memory payload, so the service envelope's range path is testable
 *   end-to-end,
 * - NO I/O of any kind (no network, no filesystem, no timers beyond the
 *   never-settling hang promises used to exercise ENGINE_TIMEOUT).
 *
 * `sampleSessions`, `sampleErrors`, and `sampleRangeRequests` are canned
 * data for tests. Fixtures are exported for tests only; nothing in this
 * module is ever registered as a production engine.
 */

import type { NativeMediaEngine, NativeMediaSession } from "@wfx/domain";

import { NativeMediaError, NATIVE_MEDIA_ERROR_CODES } from "./errors";
import type { RangeRequest } from "./range";
import type { RangeAccessEngine } from "./service";
import { isSessionState, makeSession, type SessionState } from "./session";

// ---------------------------------------------------------------------------
// Stub engine
// ---------------------------------------------------------------------------

/** One recorded engine method invocation. */
export interface StubCall {
  method: string;
  args: readonly unknown[];
}

/** Options for {@link stubEngine}. */
export interface StubEngineOptions {
  /** In-memory payload served by the range extension. Default: 1024 deterministic bytes. */
  payload?: Uint8Array;
  /** Content type reported by `statMedia`. Default: `"application/octet-stream"`. */
  contentType?: string;
  /**
   * Initial state of sessions returned by `open()`. Default: `"buffering"` —
   * the fixture simulates an engine that has resolved metadata and begun
   * buffering by the time `open()` resolves (`resolving` is the transient
   * state DURING the open call).
   */
  openState?: SessionState;
}

/**
 * The stub engine TEST FIXTURE: the frozen engine surface plus the range
 * extension and test-only control hooks. Every hook mutates fixture state
 * only — there is no I/O.
 */
export interface StubEngine extends NativeMediaEngine, RangeAccessEngine {
  /** Brand: this object is a TEST FIXTURE, never a production engine. */
  readonly isTestFixture: true;
  /** Every engine method invocation, in order (assert adapter → engine mapping). */
  readonly calls: readonly StubCall[];
  /** The stub's live sessions. */
  readonly sessions: ReadonlyMap<string, NativeMediaSession>;
  /** The in-memory payload served by the range extension. */
  readonly payload: Uint8Array;

  /** Initial state for sessions created by `open()`. */
  openState: SessionState;
  /** When set, the next `open()` REJECTS with this error (then clears). */
  nextOpenError: Error | undefined;
  /** When set, the next `open()` RESOLVES with this raw value (then clears) — use to feed the adapter malformed engine results. */
  nextOpenResult: unknown;
  /** When true, the next `open()` never settles (ENGINE_TIMEOUT tests; then clears). */
  hangNextOpen: boolean;
  /** When set, the next control call (seek/pause/resume/prioritize/close) THROWS this error (then clears). */
  nextControlError: Error | undefined;
  /** When true, the next control call never settles (ENGINE_TIMEOUT tests; then clears). */
  hangNextControl: boolean;

  /**
   * Test hook: force a session's state, BYPASSING the FSM by design (a
   * fixture power tool for constructing scenarios; production code must go
   * through `transition()`). Returns false for unknown sessions or invalid
   * states.
   */
  forceState(sessionId: string, state: SessionState): boolean;
  /**
   * Test hook: advance a session's `bufferedMs` by `deltaMs` (simulated
   * buffering progress). Requires a non-terminal state and a resulting
   * `bufferedMs >= 0`; returns false otherwise.
   */
  advanceBufferedMs(sessionId: string, deltaMs: number): boolean;
}

/** Deterministic default payload: 1024 bytes, `byte[i] = i % 251`. */
function defaultPayload(): Uint8Array {
  const bytes = new Uint8Array(1024);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = i % 251;
  }
  return bytes;
}

class StubEngineImpl implements StubEngine {
  readonly isTestFixture = true as const;
  readonly payload: Uint8Array;
  private readonly contentType: string;
  private readonly liveSessions = new Map<string, NativeMediaSession>();
  private readonly closedIds = new Set<string>();
  private readonly callLog: StubCall[] = [];
  private counter = 0;

  openState: SessionState;
  nextOpenError: Error | undefined;
  nextOpenResult: unknown;
  hangNextOpen = false;
  nextControlError: Error | undefined;
  hangNextControl = false;

  constructor(options: StubEngineOptions = {}) {
    this.payload = options.payload ?? defaultPayload();
    this.contentType = options.contentType ?? "application/octet-stream";
    this.openState = options.openState ?? "buffering";
  }

  get calls(): readonly StubCall[] {
    return this.callLog;
  }

  get sessions(): ReadonlyMap<string, NativeMediaSession> {
    return this.liveSessions;
  }

  // --- frozen NativeMediaEngine surface ----------------------------------

  async open(
    input: { magnet?: string; torrentBytes?: Uint8Array; localPath?: string },
  ): Promise<NativeMediaSession> {
    this.record("open", [input]);
    if (this.hangNextOpen) {
      this.hangNextOpen = false;
      return new Promise<NativeMediaSession>(() => {});
    }
    if (this.nextOpenError !== undefined) {
      const e = this.nextOpenError;
      this.nextOpenError = undefined;
      throw e;
    }
    if (this.nextOpenResult !== undefined) {
      const raw = this.nextOpenResult;
      this.nextOpenResult = undefined;
      return raw as NativeMediaSession;
    }
    if (
      input === null ||
      input === undefined ||
      (input.magnet === undefined && input.torrentBytes === undefined && input.localPath === undefined)
    ) {
      throw new Error("stub: open requires at least one source (fixture-level validation)");
    }
    this.counter += 1;
    const session = makeSession({
      id: `stub-session-${this.counter}`,
      assetId: `stub-asset-${this.counter}`,
      fileId: `stub-file-${this.counter}`,
      state: this.openState,
      bufferedMs: 0,
      positionMs: 0,
    });
    this.liveSessions.set(session.id, session);
    return { ...session };
  }

  async seek(sessionId: string, positionMs: number): Promise<void> {
    this.record("seek", [sessionId, positionMs]);
    if (this.shouldHangControl()) return new Promise<void>(() => {});
    this.throwNextControlError();
    const session = this.requireSession(sessionId);
    this.liveSessions.set(sessionId, { ...session, positionMs });
  }

  async prioritize(
    sessionId: string,
    deadlines: { piece: number; deadlineMs: number }[],
  ): Promise<void> {
    this.record("prioritize", [sessionId, deadlines]);
    if (this.shouldHangControl()) return new Promise<void>(() => {});
    this.throwNextControlError();
    this.requireSession(sessionId);
  }

  async pause(sessionId: string): Promise<void> {
    this.record("pause", [sessionId]);
    if (this.shouldHangControl()) return new Promise<void>(() => {});
    this.throwNextControlError();
    this.requireSession(sessionId);
  }

  async resume(sessionId: string): Promise<void> {
    this.record("resume", [sessionId]);
    if (this.shouldHangControl()) return new Promise<void>(() => {});
    this.throwNextControlError();
    this.requireSession(sessionId);
  }

  async close(sessionId: string): Promise<void> {
    this.record("close", [sessionId]);
    if (this.shouldHangControl()) return new Promise<void>(() => {});
    this.throwNextControlError();
    if (this.liveSessions.has(sessionId)) {
      this.liveSessions.delete(sessionId);
      this.closedIds.add(sessionId);
      return;
    }
    if (!this.closedIds.has(sessionId)) {
      throw new Error(`stub: unknown session '${sessionId}'`);
    }
    // Double close on an already-closed stub session: idempotent no-op.
  }

  // --- optional RangeAccessEngine extension -------------------------------

  async statMedia(
    sessionId: string,
  ): Promise<{ totalBytes: number; contentType: string }> {
    this.record("statMedia", [sessionId]);
    if (!this.liveSessions.has(sessionId) && !this.closedIds.has(sessionId)) {
      throw new Error(`stub: unknown session '${sessionId}'`);
    }
    return { totalBytes: this.payload.length, contentType: this.contentType };
  }

  async readRange(sessionId: string, startByte: number, endByte: number): Promise<Uint8Array> {
    this.record("readRange", [sessionId, startByte, endByte]);
    if (!this.liveSessions.has(sessionId) && !this.closedIds.has(sessionId)) {
      throw new Error(`stub: unknown session '${sessionId}'`);
    }
    const from = Math.max(0, startByte);
    const to = Math.min(this.payload.length - 1, endByte);
    if (to < from) {
      throw new Error(`stub: empty range ${startByte}-${endByte}`);
    }
    return this.payload.slice(from, to + 1);
  }

  // --- test hooks ----------------------------------------------------------

  forceState(sessionId: string, state: SessionState): boolean {
    const session = this.liveSessions.get(sessionId);
    if (session === undefined || !isSessionState(state)) return false;
    // Deliberately bypasses the FSM: fixture power tool (see interface docs).
    this.liveSessions.set(sessionId, { ...session, state });
    return true;
  }

  advanceBufferedMs(sessionId: string, deltaMs: number): boolean {
    const session = this.liveSessions.get(sessionId);
    if (session === undefined) return false;
    if (!Number.isFinite(deltaMs)) return false;
    if (session.state === "complete" || session.state === "failed") return false;
    const next = session.bufferedMs + deltaMs;
    if (next < 0) return false;
    this.liveSessions.set(sessionId, { ...session, bufferedMs: next });
    return true;
  }

  // --- internals -----------------------------------------------------------

  private record(method: string, args: readonly unknown[]): void {
    this.callLog.push({ method, args });
  }

  /** Consume the one-shot hang flag for control calls. */
  private shouldHangControl(): boolean {
    if (this.hangNextControl) {
      this.hangNextControl = false;
      return true;
    }
    return false;
  }

  /** Consume the one-shot control error hook, if armed. */
  private throwNextControlError(): void {
    if (this.nextControlError !== undefined) {
      const e = this.nextControlError;
      this.nextControlError = undefined;
      throw e;
    }
  }

  /** Look up a live session; throws for unknown/closed stub sessions. */
  private requireSession(sessionId: string): NativeMediaSession {
    if (!this.liveSessions.has(sessionId)) {
      throw new Error(
        this.closedIds.has(sessionId)
          ? `stub: session '${sessionId}' is closed`
          : `stub: unknown session '${sessionId}'`,
      );
    }
    const session = this.liveSessions.get(sessionId);
    if (session === undefined) {
      throw new Error(`stub: inconsistent session map for '${sessionId}'`);
    }
    return session;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the stub engine TEST FIXTURE (in-memory, no I/O, controllable
 * state, simulated buffering, optional range extension over the payload).
 * NEVER wire as a production engine.
 */
export function stubEngine(options?: StubEngineOptions): StubEngine {
  return new StubEngineImpl(options);
}

// ---------------------------------------------------------------------------
// Sample data (canned values for tests — never production data)
// ---------------------------------------------------------------------------

/** One well-formed session per state, covering the whole frozen union. */
export const sampleSessions: readonly NativeMediaSession[] = [
  { id: "sample-resolving", assetId: "asset-001", fileId: "file-001", state: "resolving", bufferedMs: 0, positionMs: 0, integrity: "verified" },
  { id: "sample-buffering", assetId: "asset-001", fileId: "file-001", state: "buffering", bufferedMs: 5_000, positionMs: 0, integrity: "verified" },
  { id: "sample-playing", assetId: "asset-001", fileId: "file-001", state: "playing", bufferedMs: 120_000, positionMs: 30_000, integrity: "verified" },
  { id: "sample-background", assetId: "asset-001", fileId: "file-001", state: "background", bufferedMs: 300_000, positionMs: 30_000, integrity: "verified" },
  { id: "sample-complete", assetId: "asset-001", fileId: "file-001", state: "complete", bufferedMs: 3_600_000, positionMs: 3_600_000, integrity: "verified" },
  { id: "sample-failed", assetId: "asset-001", fileId: "file-001", state: "failed", bufferedMs: 42_000, positionMs: 10_000, integrity: "failed" },
];

/** One `NativeMediaError` per taxonomy code (in code order). */
export const sampleErrors: readonly NativeMediaError[] = NATIVE_MEDIA_ERROR_CODES.map(
  (code) => new NativeMediaError(code, { detail: `sample error: ${code.toLowerCase()}` }),
);

/**
 * Sample range requests: closed, open-ended, suffix-form (negative
 * startByte), and an unknown-session request for NOT_FOUND paths.
 */
export const sampleRangeRequests: readonly RangeRequest[] = [
  { sessionId: "sample-playing", startByte: 0, endByte: 1023 },
  { sessionId: "sample-playing", startByte: 512 },
  { sessionId: "sample-playing", startByte: -256 },
  { sessionId: "sample-complete", startByte: 0 },
  { sessionId: "sample-unknown", startByte: 0, endByte: 99 },
];
