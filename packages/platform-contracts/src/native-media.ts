/**
 * @wfx/platform-contracts — NativeMediaPort (R01).
 *
 * INTERFACE ONLY. The platform adapter's binding to a native media service
 * (the R10 production path behind `packages/native-media`): session
 * lifecycle, range reads, playback control, and integrity/background state.
 * NO implementation lives here — a clearly-marked test double may live in
 * `@wfx/client-runtime`'s `src/testing.ts` conventions; the real service is
 * R10's deliverable. Torrent protocol internals stay behind that boundary
 * (R11) — this port never exposes pieces, peers, or protocol operations.
 *
 * Shape compatibility: the session/playback-control operations deliberately
 * mirror the frozen `NativeMediaEngine` surface of `@wfx/domain`
 * (open/seek/prioritize/pause/resume/close) so a real engine satisfies the
 * control core structurally; this port ADDS the observation stream, range
 * reads, and per-session inspection the shared runtime needs for truthful
 * buffering and integrity states. The frozen `NativeMediaSession` state
 * vocabulary (`resolving | buffering | playing | background | complete |
 * failed`) is reused verbatim, with the integrity field from the frozen
 * contracts doc (`unknown | verified | failed`).
 *
 * Truth laws:
 * - `bufferedMs` and `positionMs` in observed events are the SERVICE's
 *   honest numbers; the runtime never invents progress (no fake ticking).
 * - A missed playback deadline surfaces as `buffering` (or `failed` with
 *   detail) — NEVER as continued `playing`.
 * - `background` state means background COMPLETION continues truthfully;
 *   `complete` requires verified integrity (`integrity: "verified"`).
 */

import type { Unsubscribe } from "./common";

/** The frozen native media session state vocabulary (from `@wfx/domain`). */
export type NativeMediaSessionState =
  | "resolving"
  | "buffering"
  | "playing"
  | "background"
  | "complete"
  | "failed";

/** Every value of `NativeMediaSessionState`, in union order. */
export const NATIVE_MEDIA_SESSION_STATES: readonly NativeMediaSessionState[] = [
  "resolving",
  "buffering",
  "playing",
  "background",
  "complete",
  "failed",
];

/** Piece/byte integrity of the backing asset (frozen contracts doc). */
export type NativeMediaIntegrity = "unknown" | "verified" | "failed";

/** Every value of `NativeMediaIntegrity`, in union order. */
export const NATIVE_MEDIA_INTEGRITIES: readonly NativeMediaIntegrity[] = [
  "unknown",
  "verified",
  "failed",
];

/** What to open: an authorized magnet, torrent bytes, or a local path. */
export interface NativeMediaOpenInput {
  readonly magnet?: string;
  readonly torrentBytes?: Uint8Array;
  readonly localPath?: string;
}

/** One playback-range deadline (byte range + when it is needed). */
export interface MediaDeadline {
  /** Byte offset within the playable file. */
  readonly offset: number;
  /** Byte length of the range (>= 1). */
  readonly length: number;
  /** Epoch milliseconds (runtime clock) by which the range must be readable. */
  readonly deadlineMs: number;
}

/** The closed native-media failure vocabulary. */
export type NativeMediaErrorCode =
  /** The service is not running / not bound (retryable after rebind). */
  | "unavailable"
  /** The open input is malformed or unauthorized. */
  | "invalid-input"
  /** Integrity verification failed for the backing asset. */
  | "corrupt"
  /** A playback deadline was missed (surfaced, never faked as playing). */
  | "deadline-missed"
  /** The session id is unknown to the service. */
  | "unknown-session";

/** Every value of `NativeMediaErrorCode`, in union order. */
export const NATIVE_MEDIA_ERROR_CODES: readonly NativeMediaErrorCode[] = [
  "unavailable",
  "invalid-input",
  "corrupt",
  "deadline-missed",
  "unknown-session",
];

/** The typed failure every port method rejects with. */
export class NativeMediaPortError extends Error {
  readonly code: NativeMediaErrorCode;
  readonly detail: string;

  constructor(code: NativeMediaErrorCode, detail: string) {
    super(`native media failure (${code}): ${detail}`);
    this.name = "NativeMediaPortError";
    this.code = code;
    this.detail = detail;
  }
}

/** The service's truthful session snapshot (the frozen session shape). */
export interface NativeMediaSessionSnapshot {
  readonly id: string;
  readonly assetId: string;
  readonly fileId: string;
  readonly state: NativeMediaSessionState;
  /** Verified playable milliseconds (the service's honest number). */
  readonly bufferedMs: number;
  readonly positionMs: number;
  readonly integrity: NativeMediaIntegrity;
}

/** One observed session state change (the runtime's truthful progress source). */
export interface NativeMediaSessionEvent {
  readonly sessionId: string;
  readonly state: NativeMediaSessionState;
  readonly bufferedMs: number;
  readonly positionMs: number;
  readonly integrity: NativeMediaIntegrity;
  /** Epoch milliseconds (service clock). */
  readonly occurredAtMs: number;
  /** Honest failure detail when `state` is `"failed"`. */
  readonly detail?: string;
}

/**
 * The native media service binding. INTERFACE ONLY (see module doc): the
 * adapter constructs it over the R10 service process; the runtime consumes
 * it for `native`-mode playback, range reads, and truthful buffering state.
 */
export interface NativeMediaPort {
  /** Open a session for one authorized source. Rejects typed on failure. */
  open(input: NativeMediaOpenInput): Promise<NativeMediaSessionSnapshot>;
  /** Close a session (idempotent for the service). */
  close(sessionId: string): Promise<void>;

  /** Pause playback of a session. */
  pause(sessionId: string): Promise<void>;
  /** Resume playback of a paused session. */
  resume(sessionId: string): Promise<void>;
  /** Seek a session to a position (milliseconds). */
  seek(sessionId: string, positionMs: number): Promise<void>;
  /** Declare playback-range deadlines (the playback-aware scheduler seam). */
  prioritize(sessionId: string, deadlines: readonly MediaDeadline[]): Promise<void>;

  /**
   * Read a byte range of the session's playable file. Rejects with
   * `"deadline-missed"`/`"corrupt"` when the range cannot be served
   * verified — never fabricated bytes.
   */
  readRange(
    sessionId: string,
    request: { readonly offset: number; readonly length: number },
  ): Promise<Uint8Array>;

  /** The service's truthful snapshot of one session. */
  inspect(sessionId: string): Promise<NativeMediaSessionSnapshot>;

  /** Observe every session's state changes (the runtime's progress source). */
  subscribe(listener: (event: NativeMediaSessionEvent) => void): Unsubscribe;
}
