/**
 * @wfx/client-runtime — playback command semantics (R01).
 *
 * resolve/prepare/play/pause/seek/stop as TYPED COMMANDS with truthful
 * buffering and degraded states. The frozen laws this module keeps:
 *
 * 1. CAPABILITY-FILTERED RESOLUTION — realizations are validated
 *    (shape), filtered by PLATFORM CAPABILITY TRUTH (native needs the
 *    native media binding; browser needs the contained surface; embed/
 *    external render everywhere), then picked by the frozen precedence
 *    Native > Embed > Browser > External. A realization the platform
 *    truthfully cannot play is SKIPPED and NAMED in the failure when
 *    nothing else remains — never attempted, never faked.
 * 2. NO FAKE PROGRESS — `positionMs` changes ONLY through surface
 *    evidence (observations) or an ACCEPTED seek command. The runtime has
 *    no ticker: after `play()`, position stays where it was until the
 *    surface reports. Native sessions get truthful bufferedMs/positionMs
 *    from the NativeMediaPort event stream.
 * 3. TRUTHFUL BUFFERING — entering `playing` requires playback evidence
 *    (`started`/`progress` observations); a stall reports `buffering`
 *    (never continued fake playing); degradation is an EXPLICIT state with
 *    detail, never silent.
 * 4. TERMINAL HONESTY — `unresolvable`/`failed`/`stopped` are terminal;
 *    commands against them are typed failures, never zombie sessions.
 * 5. WATCH-STATE MIRRORING — first play emits the `start` watch event,
 *    progress observations emit `progress`, `ended` emits `complete`
 *    (through the at-least-once engine; delivery failures stay pending and
 *    visible, never silent).
 *
 * Platform engagement at `prepare`:
 * - `browser` mode — the runtime OPENS the contained BrowserHostPort
 *   surface at the realization URL (cookie-isolated, provider-owned).
 * - `embed` mode — R09: contained EXACTLY LIKE THE BROWSER RUNG — where
 *   the platform truthfully hosts a contained surface, the embed session
 *   opens through the SAME BrowserHostPort (the Desktop adapter's native
 *   contained webview; the Web adapter's sandboxed opaque-origin iframe).
 *   Without a contained host or an embed URL, the surface stays
 *   adapter-owned and `prepare` is the readiness signal.
 * - `native` mode — the runtime OPENS a NativeMediaPort session with the
 *   caller-supplied authorized open input (the R10 service binding seam;
 *   the runtime never invents torrent/magnet logic — that is R11's, behind
 *   the native-media boundary).
 * - `external` — the adapter owns the handoff; `prepare` is its readiness
 *   signal (the command resolves when the adapter confirms).
 */

import type {
  EntertainmentItem,
  PlaybackMode,
  PlaybackRealization,
  PlaybackSession,
} from "@wfx/domain";
import {
  PLAYBACK_SESSION_ID_PREFIX,
  isEntertainmentItemId,
  isRecord,
  previewValue,
  validatePlaybackRealization,
} from "@wfx/domain";
import type {
  BrowserSurfaceEvent,
  NativeMediaOpenInput,
  NativeMediaPort,
  NativeMediaSessionEvent,
  PlatformCapabilities,
  Unsubscribe,
} from "@wfx/platform-contracts";
import { supportsBrowserHost, supportsNativeMedia } from "@wfx/platform-contracts";

import { RuntimeError, serverFailureError } from "./errors";
import type { RuntimeClock, RuntimeIdGen, RuntimeContext } from "./runtime-seams";
import type { ServerPort } from "./server-port";
import type { SurfaceResolverSeam, SurfaceResolutionOutcome } from "./surface-resolution";
import type { WatchStateEngine } from "./watch-state";

// ---------------------------------------------------------------------------
// Capability truth (platform x playback mode — the frozen precedence filter)
// ---------------------------------------------------------------------------

/**
 * Can THIS PLATFORM truthfully realize the playback mode? (Pure; the
 * capability-declaration check — never a probe.)
 */
export function canUsePlaybackMode(capabilities: PlatformCapabilities, mode: PlaybackMode): boolean {
  switch (mode) {
    case "native":
      return supportsNativeMedia(capabilities);
    case "browser":
      return supportsBrowserHost(capabilities);
    case "embed":
    case "external":
      return true; // every platform kind renders embeds / hands off to the OS
  }
}

/** The frozen Media Surface precedence order (verbatim). */
export const PLAYBACK_MODE_PRECEDENCE: readonly PlaybackMode[] = [
  "native",
  "embed",
  "browser",
  "external",
];

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/** The playback session's phase (the command state machine's states). */
export type PlaybackPhase =
  /** Resolving realizations (transient inside resolvePlayback). */
  | "resolving"
  /** Realization chosen; surface not yet engaged. */
  | "prepared"
  /** Engaging the surface (browser open / native session open). */
  | "preparing"
  /** Engaged; awaiting playback evidence (truthful buffering). */
  | "buffering"
  /** Playing (evidence-backed). */
  | "playing"
  | "paused"
  /** Playing at reduced fidelity (explicit, with detail). */
  | "degraded"
  /** User stopped; watch state recorded. Terminal. */
  | "stopped"
  /** Engagement or control failed. Terminal. */
  | "failed"
  /** Resolution found nothing playable. Terminal. */
  | "unresolvable";

/** Every value of `PlaybackPhase`, in union order. */
export const PLAYBACK_PHASES: readonly PlaybackPhase[] = [
  "resolving",
  "prepared",
  "preparing",
  "buffering",
  "playing",
  "paused",
  "degraded",
  "stopped",
  "failed",
  "unresolvable",
];

/** The terminal phases (no command exits them). */
export const TERMINAL_PLAYBACK_PHASES: readonly PlaybackPhase[] = ["stopped", "failed", "unresolvable"];

/** The observable playback state snapshot (truthful at all times). */
export interface PlaybackState {
  readonly sessionId: string;
  readonly itemId: string;
  readonly mode: PlaybackMode;
  readonly realization: PlaybackRealization;
  readonly phase: PlaybackPhase;
  /** Last position EVIDENCE (ms) — never a ticker, never a guess. */
  readonly positionMs: number;
  /** Last buffered-ahead evidence (ms); 0 when unknown/none. */
  readonly bufferedMs: number;
  /** Duration (ms) when known. */
  readonly durationMs?: number;
  /** Present iff `phase === "degraded"`: the honest degradation detail. */
  readonly degradedDetail?: string;
  /** Present iff `phase === "failed"`: the honest failure. */
  readonly failure?: { readonly kind: RuntimeErrorKindOfFailure; readonly detail: string };
  /** ISO timestamp when the session was created. */
  readonly createdAt: string;
  /**
   * R09: the Media Surface precedence trace WHEN the session was resolved
   * through the injected surface-resolver seam — one line per rung in
   * frozen precedence order. The answer NAMES what was chosen and why;
   * absent when the runtime used its built-in capability-filtered walk
   * (no seam injected).
   */
  readonly precedenceTrace?: readonly string[];
  /**
   * R09: the engaged CONTAINED surface session (browser rung, and the
   * embed rung where the platform hosts a contained surface): the host's
   * opaque session id + the URL it was opened at. Absent when no
   * contained surface is engaged (native/external rungs, or the adapter
   * owns the surface).
   */
  readonly containedSurface?: { readonly id: string; readonly url: string };
}

/** The failure kinds a playback state can carry (subset of the taxonomy). */
export type RuntimeErrorKindOfFailure =
  | "network"
  | "unauthorized"
  | "unavailable"
  | "unsupported-capability"
  | "invalid-input";

/** Listener for playback state changes. */
export type PlaybackListener = (state: PlaybackState) => void;

/** Truthful evidence from the engaged surface (the ONLY progress source). */
export type PlaybackObservation =
  /** The surface began playing (optionally with a position). */
  | { readonly kind: "started"; readonly positionMs?: number }
  /** Position evidence (the runtime's only position mover). */
  | { readonly kind: "progress"; readonly positionMs: number }
  /** Buffered-ahead evidence. */
  | { readonly kind: "buffered"; readonly bufferedMs: number }
  /** Playback stalled — truthful buffering, never fake playing. */
  | { readonly kind: "stalled" }
  /** Explicit degradation (quality drop, mode fallback) — never silent. */
  | { readonly kind: "degraded"; readonly detail: string }
  /** The degradation lifted. */
  | { readonly kind: "recovered" }
  /** Playback ended (completion). */
  | { readonly kind: "ended" };

/** The typed result of a playback command. */
export type PlaybackCommandResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: RuntimeErrorKindOfFailure; readonly detail: string };

/** Input to `prepare` (the engagement payload per mode). */
export interface PrepareInput {
  /**
   * REQUIRED for `native` mode: the authorized open input for the native
   * media service (the R10 seam — the runtime never invents it).
   */
  readonly nativeOpen?: NativeMediaOpenInput;
}

/** Input to `stop`. */
export interface StopInput {
  /** Mark the item skipped in watch state (default false — stop ≠ skip). */
  readonly markSkipped?: boolean;
}

// ---------------------------------------------------------------------------
// Resolution (the capability-filtered frozen precedence)
// ---------------------------------------------------------------------------

/** One valid realization skipped because the platform cannot play its mode. */
export interface SkippedForCapability {
  readonly realization: PlaybackRealization;
  readonly reason: string;
}

/** The outcome of realization resolution (internal). */
interface ResolutionOutcome {
  readonly chosen: PlaybackRealization | null;
  readonly skipped: readonly SkippedForCapability[];
  readonly valid: readonly PlaybackRealization[];
}

/** Validate + capability-filter + precedence-pick a realization list. (Pure.) */
export function resolveRealizations(
  capabilities: PlatformCapabilities,
  candidates: readonly PlaybackRealization[],
): ResolutionOutcome {
  const valid: PlaybackRealization[] = [];
  for (const candidate of candidates) {
    if (validatePlaybackRealization(candidate).ok) valid.push(candidate);
  }
  const skipped: SkippedForCapability[] = [];
  const playable: PlaybackRealization[] = [];
  for (const candidate of valid) {
    if (canUsePlaybackMode(capabilities, candidate.mode)) {
      playable.push(candidate);
    } else {
      skipped.push({
        realization: candidate,
        reason: `platform '${capabilities.platform}' truthfully cannot realize '${candidate.mode}' playback (${
          candidate.mode === "native"
            ? `nativeMedia: '${capabilities.nativeMedia}'`
            : `browserHost: '${capabilities.browserHost}'`
        })`,
      });
    }
  }
  let chosen: PlaybackRealization | null = null;
  for (const mode of PLAYBACK_MODE_PRECEDENCE) {
    const match = playable.find((candidate) => candidate.mode === mode);
    if (match !== undefined) {
      chosen = match;
      break;
    }
  }
  return { chosen, skipped, valid };
}

// ---------------------------------------------------------------------------
// The playback intent + controller
// ---------------------------------------------------------------------------

/** What to play (the `resolvePlayback` input). */
export interface PlaybackIntent {
  /** Canonical entertainment-item ID (`wfxitm_...`) of the item to play. */
  readonly itemId: string;
  /** External reference to resolve (required when no realization is chosen). */
  readonly externalRef?: string;
  /** A chosen realization (skips server resolution; still capability-checked). */
  readonly realization?: PlaybackRealization;
  /** Resume position in milliseconds (>= 0); defaults to 0. */
  readonly resumePositionMs?: number;
}

/** The playback controller surface (the command API). */
export interface PlaybackController {
  readonly sessionId: string;
  readonly itemId: string;
  /** The current truthful state snapshot. */
  state(): PlaybackState;
  /** Observe state changes. */
  subscribe(listener: PlaybackListener): Unsubscribe;
  /** Engage the surface for the chosen mode (typed result). */
  prepare(input?: PrepareInput): Promise<PlaybackCommandResult>;
  /** Issue the play intent (native: resume; others: recorded + awaiting evidence). */
  play(): Promise<PlaybackCommandResult>;
  /** Pause (native: port pause; others: recorded intent). */
  pause(): Promise<PlaybackCommandResult>;
  /**
   * Seek (native: port seek; others: adapter-mediated). On ACCEPTANCE the
   * position becomes the seek target (acceptance is position evidence);
   * `external` mode cannot seek (typed unsupported-capability failure).
   */
  seek(positionMs: number): Promise<PlaybackCommandResult>;
  /** Stop the session (closes engaged surfaces; records watch state). */
  stop(input?: StopInput): Promise<PlaybackCommandResult>;
  /** Surface evidence (the ONLY progress source; never throws). */
  observe(observation: PlaybackObservation): void;
}

/** The runtime's playback operations surface. */
export interface PlaybackOperations {
  /** The controller of one session id (undefined when unknown/finished). */
  controller(sessionId: string): PlaybackController | undefined;
  /** Every live controller snapshot, newest first. */
  active(): readonly PlaybackState[];
}

// ---------------------------------------------------------------------------
// The controller implementation
// ---------------------------------------------------------------------------

/**
 * One playback session's controller. Created by `resolvePlayback`; the
 * state machine laws are documented on the module.
 */
export class PlaybackSessionController implements PlaybackController {
  private phase: PlaybackPhase = "prepared";
  private positionMs: number;
  private bufferedMs = 0;
  private degradedDetail: string | undefined;
  private failure: PlaybackState["failure"] = undefined;
  private firstPlayIssued = false;
  private playIntentActive = false;
  private readonly listeners = new Set<PlaybackListener>();
  private browserUnsubscribe: Unsubscribe | null = null;
  private nativeUnsubscribe: Unsubscribe | null = null;
  private nativeSessionId: string | null = null;
  /** R09: the precedence trace (present iff resolved through the seam). */
  private readonly precedenceTrace: readonly string[] | undefined;
  /** R09: the engaged contained surface (id + URL) once one is opened. */
  private containedSurface: PlaybackState["containedSurface"] = undefined;

  private constructor(
    private readonly session: PlaybackSession,
    private readonly capabilities: PlatformCapabilities,
    private readonly server: ServerPort,
    private readonly watch: WatchStateEngine,
    private readonly clock: RuntimeClock,
    readonly itemId: string,
    private readonly durationMs: number | undefined,
    precedenceTrace?: readonly string[],
  ) {
    this.positionMs = session.resumePositionMs;
    this.precedenceTrace = precedenceTrace;
  }

  /** Internal factory (used by the runtime). */
  static create(
    session: PlaybackSession,
    capabilities: PlatformCapabilities,
    server: ServerPort,
    watch: WatchStateEngine,
    clock: RuntimeClock,
    durationMs: number | undefined,
    precedenceTrace?: readonly string[],
  ): PlaybackSessionController {
    return new PlaybackSessionController(
      session,
      capabilities,
      server,
      watch,
      clock,
      session.itemId,
      durationMs,
      precedenceTrace,
    );
  }

  get sessionId(): string {
    return this.session.id;
  }

  state(): PlaybackState {
    return {
      sessionId: this.session.id,
      itemId: this.session.itemId,
      mode: this.session.realization.mode,
      realization: this.session.realization,
      phase: this.phase,
      positionMs: this.positionMs,
      bufferedMs: this.bufferedMs,
      ...(this.durationMs !== undefined ? { durationMs: this.durationMs } : {}),
      ...(this.degradedDetail !== undefined ? { degradedDetail: this.degradedDetail } : {}),
      ...(this.failure !== undefined ? { failure: this.failure } : {}),
      createdAt: this.session.createdAt,
      ...(this.precedenceTrace !== undefined ? { precedenceTrace: this.precedenceTrace } : {}),
      ...(this.containedSurface !== undefined ? { containedSurface: this.containedSurface } : {}),
    };
  }

  subscribe(listener: PlaybackListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = this.state();
    for (const listener of this.listeners) listener(snapshot);
  }

  private fail(kind: RuntimeErrorKindOfFailure, detail: string): PlaybackCommandResult {
    this.phase = "failed";
    this.failure = { kind, detail };
    this.emit();
    return { ok: false, kind, detail };
  }

  private illegal(detail: string): PlaybackCommandResult {
    return { ok: false, kind: "invalid-input", detail };
  }

  async prepare(input?: PrepareInput): Promise<PlaybackCommandResult> {
    if (this.phase === "failed" || this.phase === "stopped" || this.phase === "unresolvable") {
      return this.illegal(`prepare is not legal in terminal phase '${this.phase}'`);
    }
    if (this.phase !== "prepared") {
      return this.illegal(`prepare is not legal in phase '${this.phase}' (already engaged)`);
    }
    const mode = this.session.realization.mode;

    if (mode === "browser") {
      const port = this.capabilities.ports.browserHost;
      const url = this.session.realization.url;
      if (port === null || url === undefined || url.length === 0) {
        return this.fail(
          "unsupported-capability",
          `browser playback requires a contained BrowserHostPort and a realization URL (url: ${previewValue(url)})`,
        );
      }
      this.phase = "preparing";
      this.emit();
      try {
        const surface = await port.open({
          url,
          restrictCookies: "isolate",
          purpose: "playback",
        });
        this.containedSurface = { id: surface.id, url: surface.url };
        this.browserUnsubscribe = surface.subscribe((event: BrowserSurfaceEvent) => {
          if (event.kind === "closed") {
            // The user (or host) closed the provider surface: honest stop.
            void this.finishStop(false);
          }
        });
      } catch (thrown) {
        return this.fail(
          "unavailable",
          `contained browser surface failed to open: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
        );
      }
      this.phase = "buffering";
      this.emit();
      return { ok: true };
    }

    if (mode === "embed") {
      // R09: the EMBED rung is CONTAINED EXACTLY LIKE THE BROWSER RUNG —
      // where the platform truthfully hosts a contained surface, the
      // embed session opens through the SAME BrowserHostPort (cookie-
      // isolated, provider-owned, opaque origin); on the Desktop adapter
      // that is the contained native webview. A platform without a
      // contained host, or a realization without an embed URL, leaves the
      // surface adapter-owned (the honest readiness signal below — the
      // adapter renders the honest no-url/adapter-owned stage).
      const port = this.capabilities.ports.browserHost;
      const url = this.session.realization.url;
      if (port !== null && url !== undefined && url.length > 0) {
        this.phase = "preparing";
        this.emit();
        try {
          const surface = await port.open({
            url,
            restrictCookies: "isolate",
            purpose: "playback",
          });
          this.containedSurface = { id: surface.id, url: surface.url };
          this.browserUnsubscribe = surface.subscribe((event: BrowserSurfaceEvent) => {
            if (event.kind === "closed") {
              // The user (or host) closed the provider's embed surface:
              // honest stop — the provider page stays provider-owned.
              void this.finishStop(false);
            }
          });
        } catch (thrown) {
          return this.fail(
            "unavailable",
            `contained embed surface failed to open: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
          );
        }
      }
      this.phase = "buffering";
      this.emit();
      return { ok: true };
    }

    if (mode === "native") {
      const port: NativeMediaPort | null = this.capabilities.ports.nativeMedia;
      if (port === null) {
        return this.fail(
          "unsupported-capability",
          `native playback requires a NativeMediaPort (platform declares nativeMedia: '${this.capabilities.nativeMedia}')`,
        );
      }
      if (input?.nativeOpen === undefined) {
        return this.fail(
          "invalid-input",
          "native playback requires prepare({ nativeOpen }) — the authorized native-media open input (the R10 service binding seam)",
        );
      }
      this.phase = "preparing";
      this.emit();
      try {
        const nativeSession = await port.open(input.nativeOpen);
        this.nativeSessionId = nativeSession.id;
        this.nativeUnsubscribe = port.subscribe((event: NativeMediaSessionEvent) => {
          if (event.sessionId !== this.nativeSessionId) return;
          this.applyNativeEvent(event);
        });
      } catch (thrown) {
        return this.fail(
          "unavailable",
          `native media session failed to open: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
        );
      }
      this.phase = "buffering";
      this.emit();
      return { ok: true };
    }

    // embed / external: the adapter owns the surface; prepare is its
    // readiness signal (resolved synchronously, honestly).
    this.phase = "buffering";
    this.emit();
    return { ok: true };
  }

  async play(): Promise<PlaybackCommandResult> {
    if (this.phase === "failed" || this.phase === "stopped" || this.phase === "unresolvable") {
      return this.illegal(`play is not legal in terminal phase '${this.phase}'`);
    }
    if (this.phase === "prepared") {
      return this.illegal("play is not legal in phase 'prepared' (prepare first)");
    }
    if (this.phase === "playing") {
      return { ok: true }; // idempotent
    }
    if (this.nativeSessionId !== null) {
      const port = this.capabilities.ports.nativeMedia;
      if (port !== null) {
        try {
          await port.resume(this.nativeSessionId);
        } catch (thrown) {
          return this.fail(
            "unavailable",
            `native resume failed: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
          );
        }
      }
    }
    this.phase = this.degradedDetail !== undefined ? "degraded" : "buffering";
    this.playIntentActive = true;
    this.emit();

    if (!this.firstPlayIssued) {
      this.firstPlayIssued = true;
      void this.watch
        .applyObserved({
          kind: "start",
          itemId: this.session.itemId,
          ...(this.session.resumePositionMs > 0 ? { positionMs: this.session.resumePositionMs } : {}),
          playbackSessionId: this.session.id,
        })
        .catch(() => undefined); // pending stays visible (at-least-once)
    }
    return { ok: true };
  }

  async pause(): Promise<PlaybackCommandResult> {
    if (this.phase === "failed" || this.phase === "stopped" || this.phase === "unresolvable") {
      return this.illegal(`pause is not legal in terminal phase '${this.phase}'`);
    }
    if (this.phase !== "playing" && this.phase !== "buffering" && this.phase !== "degraded") {
      return this.illegal(`pause is not legal in phase '${this.phase}'`);
    }
    if (this.nativeSessionId !== null) {
      const port = this.capabilities.ports.nativeMedia;
      if (port !== null) {
        try {
          await port.pause(this.nativeSessionId);
        } catch (thrown) {
          return this.fail(
            "unavailable",
            `native pause failed: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
          );
        }
      }
    }
    this.phase = "paused";
    this.playIntentActive = false;
    this.emit();
    return { ok: true };
  }

  async seek(positionMs: number): Promise<PlaybackCommandResult> {
    if (typeof positionMs !== "number" || !Number.isFinite(positionMs) || positionMs < 0) {
      return this.illegal(
        `seek.positionMs: expected a finite non-negative number, got ${previewValue(positionMs)}`,
      );
    }
    if (this.phase === "failed" || this.phase === "stopped" || this.phase === "unresolvable") {
      return this.illegal(`seek is not legal in terminal phase '${this.phase}'`);
    }
    if (this.phase === "prepared" || this.phase === "preparing") {
      return this.illegal(`seek is not legal in phase '${this.phase}' (not yet engaged)`);
    }
    if (this.session.realization.mode === "external") {
      return {
        ok: false,
        kind: "unsupported-capability",
        detail: "external handoff playback cannot be seeked by WebFlix (the OS player owns it)",
      };
    }
    if (this.nativeSessionId !== null) {
      const port = this.capabilities.ports.nativeMedia;
      if (port !== null) {
        try {
          await port.seek(this.nativeSessionId, positionMs);
        } catch (thrown) {
          return this.fail(
            "unavailable",
            `native seek failed: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
          );
        }
      }
    }
    // Acceptance of the seek command IS position evidence (documented law).
    this.positionMs = positionMs;
    this.emit();
    return { ok: true };
  }

  async stop(input?: StopInput): Promise<PlaybackCommandResult> {
    if (this.phase === "failed" || this.phase === "stopped" || this.phase === "unresolvable") {
      return this.illegal(`stop is not legal in terminal phase '${this.phase}'`);
    }
    await this.finishStop(input?.markSkipped === true);
    return { ok: true };
  }

  observe(observation: PlaybackObservation): void {
    if (!isRecord(observation)) return; // defensive: untrusted surface input
    if (this.phase === "failed" || this.phase === "stopped" || this.phase === "unresolvable") {
      return; // terminal sessions ignore evidence (documented)
    }
    switch (observation.kind) {
      case "started": {
        if (observation.positionMs !== undefined) this.positionMs = observation.positionMs;
        if (this.phase === "buffering" || this.phase === "paused") {
          this.phase = "playing";
        }
        this.emit();
        break;
      }
      case "progress": {
        if (typeof observation.positionMs === "number" && Number.isFinite(observation.positionMs) && observation.positionMs >= 0) {
          this.positionMs = observation.positionMs;
        }
        if (this.phase === "buffering" || this.phase === "paused") this.phase = "playing";
        this.emit();
        void this.watch
          .applyObserved({
            kind: "progress",
            itemId: this.session.itemId,
            positionMs: this.positionMs,
            playbackSessionId: this.session.id,
          })
          .catch(() => undefined); // pending stays visible (at-least-once)
        break;
      }
      case "buffered": {
        if (typeof observation.bufferedMs === "number" && Number.isFinite(observation.bufferedMs) && observation.bufferedMs >= 0) {
          this.bufferedMs = observation.bufferedMs;
        }
        this.emit();
        break;
      }
      case "stalled": {
        if (this.phase === "playing" || this.phase === "degraded") {
          this.phase = "buffering"; // truthful buffering, never fake playing
        }
        this.emit();
        break;
      }
      case "degraded": {
        const detail = typeof observation.detail === "string" && observation.detail.length > 0 ? observation.detail : "unspecified degradation";
        this.degradedDetail = detail;
        if (this.phase === "playing" || this.phase === "buffering") this.phase = "degraded";
        this.emit();
        break;
      }
      case "recovered": {
        this.degradedDetail = undefined;
        if (this.phase === "degraded") {
          this.phase = this.playIntentActive ? "playing" : "buffering";
        }
        this.emit();
        break;
      }
      case "ended": {
        void this.finishStop(false, true).catch(() => undefined);
        break;
      }
      default:
        break;
    }
  }

  /** Truthfully map a native media service event (the native progress source). */
  private applyNativeEvent(event: NativeMediaSessionEvent): void {
    this.bufferedMs = event.bufferedMs;
    switch (event.state) {
      case "playing":
        this.observe({ kind: "started", positionMs: event.positionMs });
        break;
      case "buffering":
        this.observe({ kind: "stalled" });
        this.positionMs = event.positionMs;
        this.emit();
        break;
      case "complete":
        this.observe({ kind: "ended" });
        break;
      case "failed":
        this.fail(
          "unavailable",
          event.detail !== undefined && event.detail.length > 0
            ? `native media session failed: ${event.detail}`
            : "native media session failed (no detail supplied)",
        );
        break;
      default:
        break; // resolving/background: no playback evidence yet
    }
  }

  /** Close engaged surfaces, record watch state, settle terminal phase. */
  private async finishStop(markSkipped: boolean, completed = false): Promise<void> {
    if (this.browserUnsubscribe !== null) {
      this.browserUnsubscribe();
      this.browserUnsubscribe = null;
    }
    this.containedSurface = undefined;
    if (this.nativeUnsubscribe !== null) {
      this.nativeUnsubscribe();
      this.nativeUnsubscribe = null;
    }
    if (this.nativeSessionId !== null) {
      const port = this.capabilities.ports.nativeMedia;
      if (port !== null) {
        try {
          await port.close(this.nativeSessionId);
        } catch {
          // close failures do not un-stop the session; the surfaces are
          // adapter-owned and best-effort here (documented).
        }
      }
      this.nativeSessionId = null;
    }
    this.phase = "stopped";
    this.emit();
    try {
      if (completed) {
        await this.watch.applyObserved({
          kind: "complete",
          itemId: this.session.itemId,
          ...(this.durationMs !== undefined ? { positionMs: this.durationMs } : {}),
          playbackSessionId: this.session.id,
        });
      } else if (markSkipped) {
        await this.watch.applyObserved({
          kind: "skip",
          itemId: this.session.itemId,
          positionMs: this.positionMs,
          playbackSessionId: this.session.id,
        });
      }
    } catch {
      // Delivery failures stay pending + visible (at-least-once outbox).
    }
  }
}

// ---------------------------------------------------------------------------
// resolvePlayback (the session factory)
// ---------------------------------------------------------------------------

/** The internal bundle `resolvePlayback` needs (assembled by the runtime). */
export interface PlaybackResolutionDeps {
  readonly capabilities: PlatformCapabilities;
  readonly server: ServerPort;
  readonly watch: WatchStateEngine;
  readonly clock: RuntimeClock;
  readonly ids: RuntimeIdGen;
  readonly context: RuntimeContext;
  /** Duration registry access (for honest completion ratios). */
  readonly durationOf: (itemId: string) => number | undefined;
  /**
   * Canonical-item registry access (R09: feeds the surface seam).
   * Optional — a caller without a registry resolves through the seam with
   * the item id alone (the resolver validates the item's shape only).
   */
  readonly itemOf?: (itemId: string) => EntertainmentItem | undefined;
  /**
   * R09: the injected Media Surface resolution seam — the adapter's wiring
   * of the FROZEN resolver (`@wfx/experience`'s `resolveSurface`). Absent ⇒
   * the runtime keeps its built-in capability-filtered precedence walk.
   */
  readonly surfaceResolver?: SurfaceResolverSeam;
}

/**
 * Adopt the seam's answer as THE precedence decision (R09). Returns the
 * chosen realization + its precedence trace, or throws the typed
 * `RuntimeError` — LOUDLY, never a silent fallback:
 * - a malformed answer (shape/mode disagreement) is an incoherent wiring;
 * - a chosen mode the platform TRUTHFULLY cannot realize is an incoherent
 *   wiring (the seam's derived device truth disagrees with the runtime's
 *   own bundle) — typed `unsupported-capability`, named.
 */
function adoptSurfaceResolution(
  capabilities: PlatformCapabilities,
  outcome: SurfaceResolutionOutcome,
  itemId: string,
): { chosen: PlaybackRealization; precedenceTrace: readonly string[] } {
  if (!isRecord(outcome) || outcome.ok !== true) {
    throw new RuntimeError(
      "invalid-input",
      "surfaceResolver.resolve: expected a SurfaceResolutionOutcome object with ok: true (the runtime's failure path handles the unresolvable channel)",
    );
  }
  const chosenCheck = validatePlaybackRealization(outcome.chosen);
  if (!chosenCheck.ok) {
    throw new RuntimeError(
      "invalid-input",
      `surfaceResolver.resolve: the chosen realization is invalid (${chosenCheck.errors.join("; ")})`,
    );
  }
  if (outcome.mode !== chosenCheck.value.mode) {
    throw new RuntimeError(
      "invalid-input",
      `surfaceResolver.resolve: mode '${String(outcome.mode)}' disagrees with the chosen realization's mode '${chosenCheck.value.mode}'`,
    );
  }
  if (outcome.itemId !== itemId) {
    throw new RuntimeError(
      "invalid-input",
      `surfaceResolver.resolve: itemId '${String(outcome.itemId)}' disagrees with the playback intent's item '${itemId}'`,
    );
  }
  if (!Array.isArray(outcome.precedenceTrace)) {
    throw new RuntimeError(
      "invalid-input",
      "surfaceResolver.resolve: expected a precedenceTrace array of trace lines",
    );
  }
  if (!canUsePlaybackMode(capabilities, chosenCheck.value.mode)) {
    throw new RuntimeError(
      "unsupported-capability",
      `the injected surface resolver chose '${chosenCheck.value.mode}' playback but platform '${capabilities.platform}' truthfully cannot realize it (the seam's device-capability derivation disagrees with the runtime's capability bundle — fix the adapter wiring)`,
    );
  }
  return { chosen: chosenCheck.value, precedenceTrace: [...outcome.precedenceTrace] };
}

/**
 * The seam's UNRESOLVABLE reasons, surfaced verbatim in the runtime's own
 * typed failure (never swallowed — the dead-end audit rides along).
 */
function surfaceReasonsOf(outcome: SurfaceResolutionOutcome): string[] {
  if (isRecord(outcome) && outcome.ok === false && Array.isArray(outcome.reasons)) {
    return outcome.reasons.map((reason) => String(reason));
  }
  return [];
}

/**
 * Resolve + create one playback session (the `resolvePlayback` body).
 * Throws the typed `RuntimeError` on failure — the honest channels:
 * `invalid-input` (malformed intent), `not-found` (unknown item source),
 * `network`/`unauthorized`/`unavailable` (transport), and
 * `unsupported-capability` when realizations exist but THIS PLATFORM
 * truthfully cannot play any of them.
 *
 * R09: when `deps.surfaceResolver` is injected, THE FROZEN PRECEDENCE
 * decides — the seam (the adapter's wiring of `@wfx/experience`'s
 * `resolveSurface`) resolves the candidate set, the runtime adopts its
 * answer (re-checked against its own capability truth — an incoherent
 * wiring fails loudly), and the answer's `precedenceTrace` rides on the
 * playback state so the adapters render WHAT WAS CHOSEN AND WHY. The
 * unresolvable channel keeps the runtime's own error law verbatim (the
 * capability-skip reasons stay in the failure) with the seam's reasons
 * appended — never swallowed, never fabricated.
 */
export async function resolvePlaybackSession(
  deps: PlaybackResolutionDeps,
  intent: PlaybackIntent,
): Promise<{ session: PlaybackSession; controller: PlaybackSessionController }> {
  if (!isRecord(intent) || !isEntertainmentItemId(intent.itemId)) {
    throw new RuntimeError(
      "invalid-input",
      `intent.itemId: expected a canonical entertainment-item ID (wfxitm_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue((intent as { itemId?: unknown })?.itemId)}`,
    );
  }
  if (intent.resumePositionMs !== undefined && (typeof intent.resumePositionMs !== "number" || !Number.isFinite(intent.resumePositionMs) || intent.resumePositionMs < 0)) {
    throw new RuntimeError(
      "invalid-input",
      `intent.resumePositionMs: expected a finite non-negative number when present, got ${previewValue(intent.resumePositionMs)}`,
    );
  }

  let candidates: readonly PlaybackRealization[];
  if (intent.realization !== undefined) {
    const checked = validatePlaybackRealization(intent.realization);
    if (!checked.ok) {
      throw new RuntimeError("invalid-input", `intent.realization: ${checked.errors.join("; ")}`);
    }
    candidates = [intent.realization];
  } else {
    const ref = intent.externalRef;
    if (ref === undefined || ref.trim().length === 0) {
      throw new RuntimeError(
        "invalid-input",
        "intent.externalRef: required when no realization is chosen (nothing to resolve)",
      );
    }
    const result = await deps.server.resolve(ref);
    if (!result.ok) throw serverFailureError("resolve", result.failure);
    if (!Array.isArray(result.value)) {
      throw new RuntimeError(
        "unavailable",
        `resolve: the server answered a non-array (${previewValue(result.value)})`,
      );
    }
    candidates = result.value;
  }

  // R09 — THE FROZEN PRECEDENCE, WIRED: the injected seam decides.
  if (deps.surfaceResolver !== undefined) {
    const knownItem = deps.itemOf !== undefined ? deps.itemOf(intent.itemId) : undefined;
    const outcome = deps.surfaceResolver.resolve({
      itemId: intent.itemId,
      ...(knownItem !== undefined ? { item: knownItem } : {}),
      realizations: candidates,
    });
    if (isRecord(outcome) && outcome.ok === true) {
      const adopted = adoptSurfaceResolution(deps.capabilities, outcome, intent.itemId);
      const session: PlaybackSession = {
        id: PLAYBACK_SESSION_ID_PREFIX + deps.ids.next(),
        userId: deps.context.userId,
        itemId: intent.itemId,
        realization: adopted.chosen,
        resumePositionMs: intent.resumePositionMs ?? 0,
        createdAt: new Date(deps.clock.now()).toISOString(),
      };
      const controller = PlaybackSessionController.create(
        session,
        deps.capabilities,
        deps.server,
        deps.watch,
        deps.clock,
        deps.durationOf(intent.itemId),
        adopted.precedenceTrace,
      );
      return { session, controller };
    }
    // The seam's unresolvable dead end: the runtime's own error law stays
    // verbatim (kind + capability-skip reasons), the seam's reasons ride
    // along — the honest dead-end audit, never swallowed.
    const builtin = resolveRealizations(deps.capabilities, candidates);
    const surfaceReasons = surfaceReasonsOf(outcome);
    if (builtin.chosen === null && builtin.skipped.length > 0) {
      const reasons = builtin.skipped.map((entry) => entry.reason).join("; ");
      throw new RuntimeError(
        "unsupported-capability",
        `realizations exist but platform '${deps.capabilities.platform}' truthfully cannot play any: ${reasons}${
          surfaceReasons.length > 0 ? ` | media surface resolution: ${surfaceReasons.join(" | ")}` : ""
        }`,
      );
    }
    throw new RuntimeError(
      "unavailable",
      `no valid playback realization could be resolved for this item${
        surfaceReasons.length > 0 ? `: ${surfaceReasons.join(" | ")}` : ""
      }`,
    );
  }

  const outcome = resolveRealizations(deps.capabilities, candidates);
  if (outcome.chosen === null) {
    if (outcome.skipped.length > 0) {
      const reasons = outcome.skipped.map((entry) => entry.reason).join("; ");
      throw new RuntimeError(
        "unsupported-capability",
        `realizations exist but platform '${deps.capabilities.platform}' truthfully cannot play any: ${reasons}`,
      );
    }
    throw new RuntimeError(
      "unavailable",
      "no valid playback realization could be resolved for this item",
    );
  }

  const session: PlaybackSession = {
    id: PLAYBACK_SESSION_ID_PREFIX + deps.ids.next(),
    userId: deps.context.userId,
    itemId: intent.itemId,
    realization: outcome.chosen,
    resumePositionMs: intent.resumePositionMs ?? 0,
    createdAt: new Date(deps.clock.now()).toISOString(),
  };
  const controller = PlaybackSessionController.create(
    session,
    deps.capabilities,
    deps.server,
    deps.watch,
    deps.clock,
    deps.durationOf(intent.itemId),
  );
  return { session, controller };
}
