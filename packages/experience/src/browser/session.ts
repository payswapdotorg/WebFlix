/**
 * @wfx/experience — in-app browser surface SESSION FSM (WFX-026, Lane C).
 *
 * `BrowserSurfaceSession` is the CONTAINED browser session model: the typed
 * state machine behind one in-app browser surface, its provider context,
 * its auditable session trail, and its PERSISTENT SHELF — the WebFlix shell
 * state that survives every navigation (frozen architecture: "The user
 * should normally perceive one continuous WebFlix experience even when
 * playback is ... rendered inside an in-app browser surface").
 *
 * THE FSM:
 *
 *   closed -> opening -> ready -> navigating -> ready -> ... -> closed
 *
 * - `beginOpen` / `completeOpen` split the open into its two observable
 *   phases (the controller calls `host.open()` between them; a throwing
 *   host aborts through `abortOpen`, back to closed).
 * - `observeNavigation` / `settleNavigation` split every navigation the
 *   same way: the host reports where the session navigated (`ready` ->
 *   `navigating`), the controller settles it once the event is fully
 *   processed (`navigating` -> `ready`).
 * - `close` is legal from every non-closed state (a user can dismiss the
 *   surface while it opens or navigates).
 * - EVERY illegal transition is rejected with the typed `ExperienceError`
 *   naming the current state and the legal targets — never a silent
 *   pass, never a fake success.
 *
 * PROVIDER HANDOFF — THE LAW (docs/architecture/product-boundaries.md):
 * when the user clicks out of the contained realization page to the full
 * provider site (or anywhere off the provider host), the session
 * OBSERVES it: it records the outbound navigation in the session trail,
 * appends a typed `ProviderHandoffEvent` (emitted through the injected
 * observer), updates its current URL, and KEEPS GOING. It NEVER blocks,
 * never redirects back, never injects anything into the provider page —
 * the browser surface is a UX surface, not a mechanism for defeating
 * provider security.
 *
 * Handoff rule (deliberate, lead-visible): the provider host is the host
 * of the realization URL (`beginOpen` parses and validates it). A
 * navigation to the SAME host stays in-surface; a navigation to ANY
 * other host — even another subdomain of the same site, because a pure
 * model assumes no public-suffix knowledge — is a recorded handoff.
 *
 * The session never calls the host: the CONTROLLER (`component.ts`) binds
 * host + session + shell. Time enters ONLY through the injected `Clock`
 * (no `Date.now()`); entropy nowhere. The shell state is the
 * `shell.ts` model, held here so it survives navigation.
 */

import { isPlaybackSessionId, isRecord, previewValue } from "@wfx/domain";

import { ExperienceError, describeThrown, type Clock } from "../ports";
import { parseBrowserUrl } from "./isolation";
import {
  initialShellState,
  reduceShellState,
  assertValidSurfaceShellState,
  type ShellAction,
  type SurfaceShellState,
} from "./shell";
import type { BrowserSessionHandle } from "./host";

// ---------------------------------------------------------------------------
// The FSM — states and the frozen transition table
// ---------------------------------------------------------------------------

/** The states of the browser surface session FSM. */
export type BrowserSessionState = "closed" | "opening" | "ready" | "navigating";

/** All session states, in lifecycle order. */
export const BROWSER_SESSION_STATES: readonly BrowserSessionState[] = [
  "closed",
  "opening",
  "ready",
  "navigating",
];

/** The frozen transition table of the browser surface session (see the type). */
const TRANSITIONS: Readonly<Record<BrowserSessionState, readonly BrowserSessionState[]>> = {
  closed: ["opening"],
  opening: ["ready", "closed"],
  ready: ["navigating", "closed"],
  navigating: ["ready", "closed"],
};

/**
 * The frozen transition table of the browser surface session:
 * `closed -> opening`, `opening -> ready | closed`,
 * `ready -> navigating | closed`, `navigating -> ready | closed`.
 * `close` is legal from every non-closed state; nothing else is.
 */
export const BROWSER_SESSION_TRANSITIONS: Readonly<
  Record<BrowserSessionState, readonly BrowserSessionState[]>
> = Object.freeze(TRANSITIONS);

/** Is the value a `BrowserSessionState`? (defensive read for untyped callers) */
function isBrowserSessionState(value: unknown): value is BrowserSessionState {
  return typeof value === "string" && (BROWSER_SESSION_STATES as readonly string[]).includes(value);
}

/**
 * Whether `from -> to` is a legal browser surface session transition
 * (pure table read; both arguments validated).
 */
export function canTransitionBrowserSession(
  from: BrowserSessionState,
  to: BrowserSessionState,
): boolean {
  assertBrowserSessionState(from, "from");
  assertBrowserSessionState(to, "to");
  return BROWSER_SESSION_TRANSITIONS[from].includes(to);
}

/**
 * Assert `from -> to` is legal — the typed misuse channel of the FSM.
 * Throws the `ExperienceError` naming both states and the legal targets.
 */
export function assertBrowserSessionTransition(
  from: BrowserSessionState,
  to: BrowserSessionState,
): void {
  assertBrowserSessionState(from, "from");
  assertBrowserSessionState(to, "to");
  if (!BROWSER_SESSION_TRANSITIONS[from].includes(to)) {
    throw new ExperienceError(
      `illegal browser surface session transition: '${from}' -> '${to}' (legal targets from '${from}': ${BROWSER_SESSION_TRANSITIONS[from].join(", ")})`,
    );
  }
}

function assertBrowserSessionState(value: unknown, field: string): void {
  if (!isBrowserSessionState(value)) {
    throw new ExperienceError(
      `${field}: expected one of ${BROWSER_SESSION_STATES.join(" | ")}, got ${previewValue(value)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Identity, targets, handoffs, trail
// ---------------------------------------------------------------------------

/**
 * The session identity: which playback session (canonical `wfxpses_` id)
 * this surface realizes, through which provider connector. Adopted at the
 * FIRST `beginOpen` and immutable after; a re-open must present the SAME
 * identity (a different playback session is a different surface).
 */
export interface BrowserSessionIdentity {
  readonly playbackSessionId: string;
  readonly connectorId: string;
}

/**
 * What one `beginOpen` opens: the realization URL (the provider web page
 * this surface shows — parsed and host-validated), plus the identity.
 */
export interface BrowserSessionTarget {
  /** The browser-mode realization URL (http/https with a host). */
  readonly url: string;
  /** The provider connector whose realization this is. */
  readonly connectorId: string;
  /** The canonical playback session id (`wfxpses_` + ULID body). */
  readonly playbackSessionId: string;
}

/**
 * The typed provider handoff event: the user navigated OFF the provider
 * host (typically out to the full provider site). OBSERVED and recorded —
 * NEVER blocked (provider security boundary). Emitted through the
 * injected `onProviderHandoff` observer and kept on the session trail.
 */
export interface ProviderHandoffEvent {
  readonly kind: "provider-handoff";
  /** The playback session whose surface navigated out. */
  readonly playbackSessionId: string;
  /** The provider connector the surface was realizing. */
  readonly connectorId: string;
  /** The URL the session navigated FROM. */
  readonly fromUrl: string;
  /** The OUTBOUND URL the user clicked out to. */
  readonly toUrl: string;
  /** The host of the outbound URL. */
  readonly toHost: string;
  /** ISO 8601, from the injected clock. */
  readonly occurredAt: string;
}

/**
 * One entry of the auditable session trail: what the contained browser
 * session did — opens (and aborted opens), every navigation (flagged
 * when it was a provider handoff), and the close.
 */
export type SessionTrailEntry =
  | {
      readonly kind: "opened";
      readonly url: string;
      readonly handleId: string;
      readonly occurredAt: string;
    }
  | {
      readonly kind: "open-aborted";
      readonly url: string;
      readonly reason: string;
      readonly occurredAt: string;
    }
  | {
      readonly kind: "navigation";
      readonly fromUrl: string;
      readonly toUrl: string;
      readonly providerHandoff: boolean;
      readonly occurredAt: string;
    }
  | {
      readonly kind: "closed";
      readonly occurredAt: string;
    };

// ---------------------------------------------------------------------------
// BrowserSurfaceSessionDeps
// ---------------------------------------------------------------------------

/** What a `BrowserSurfaceSession` needs injected (host access is NOT one of them). */
export interface BrowserSessionDeps {
  /** The ONLY time source — no `Date.now()` in this module. */
  readonly clock: Clock;
  /** Observer of provider handoffs (observed, never blocked). May throw — propagates. */
  readonly onProviderHandoff?: ((event: ProviderHandoffEvent) => void) | undefined;
  /**
   * The shelf to start from (defaults to `initialShellState(clock.now())`).
   * The controller supplies the carried shelf when it re-opens a surface.
   */
  readonly initialShell?: SurfaceShellState | undefined;
}

/** Maximum ECMAScript epoch milliseconds a Date can represent (8.64e15). */
const MAX_EPOCH_MS = 8.64e15;

// ---------------------------------------------------------------------------
// BrowserSurfaceSession — the FSM (host-driven; the controller drives it)
// ---------------------------------------------------------------------------

/**
 * ONE contained browser surface session: the FSM, the provider context
 * (target URL + parsed/validated provider host + identity), the auditable
 * trail with recorded handoffs, and the PERSISTENT SHELF (`shell.ts`
 * state) that survives every navigation.
 *
 * The session never calls the host — the controller (`component.ts`)
 * binds them. Every method validates FIRST and mutates after, so a
 * rejected call leaves the session exactly where it was.
 */
export class BrowserSurfaceSession {
  private readonly clock: Clock;
  private readonly handoffObserver: ((event: ProviderHandoffEvent) => void) | undefined;
  private currentState: BrowserSessionState = "closed";
  private readonly visited: BrowserSessionState[] = ["closed"];
  private readonly trailEntries: SessionTrailEntry[] = [];
  private readonly handoffEvents: ProviderHandoffEvent[] = [];
  private shellValue: SurfaceShellState;
  private identityValue: BrowserSessionIdentity | undefined;
  private targetUrlValue: string | undefined;
  private currentUrlValue: string | undefined;
  private providerHostValue: string | undefined;
  private handleIdValue: string | undefined;

  constructor(deps: BrowserSessionDeps) {
    if (!isRecord(deps) || !isRecord(deps.clock) || typeof deps.clock.now !== "function") {
      throw new ExperienceError(
        `deps.clock: expected a Clock object with a now() function, got ${previewValue(deps)}`,
      );
    }
    if (
      deps.onProviderHandoff !== undefined &&
      typeof deps.onProviderHandoff !== "function"
    ) {
      throw new ExperienceError(
        `deps.onProviderHandoff: expected a function when present, got ${previewValue(deps.onProviderHandoff)}`,
      );
    }
    this.clock = deps.clock;
    this.handoffObserver = deps.onProviderHandoff;
    this.shellValue =
      deps.initialShell !== undefined ? deps.initialShell : initialShellState(this.nowMs());
    assertValidSurfaceShellState(this.shellValue);
  }

  // --- reads ---------------------------------------------------------------

  /** The current FSM state. */
  get state(): BrowserSessionState {
    return this.currentState;
  }

  /** Every state this session passed through, in order (starts `["closed"]`). */
  get stateHistory(): readonly BrowserSessionState[] {
    return this.visited;
  }

  /** The session identity (undefined until the first `beginOpen`). */
  get identity(): BrowserSessionIdentity | undefined {
    return this.identityValue;
  }

  /** The realization URL this surface opened (undefined until `beginOpen`). */
  get targetUrl(): string | undefined {
    return this.targetUrlValue;
  }

  /** Where the session is now — the realization URL, then the last navigated URL. */
  get currentUrl(): string | undefined {
    return this.currentUrlValue;
  }

  /** The parsed + validated provider host of the target URL. */
  get providerHost(): string | undefined {
    return this.providerHostValue;
  }

  /** The host session handle id of the current/last open (undefined before `completeOpen`). */
  get handleId(): string | undefined {
    return this.handleIdValue;
  }

  /** The auditable session trail (opens, navigations, handoffs flagged, close). */
  get trail(): readonly SessionTrailEntry[] {
    return this.trailEntries;
  }

  /** Every recorded provider handoff, in order (observed, never blocked). */
  get handoffs(): readonly ProviderHandoffEvent[] {
    return this.handoffEvents;
  }

  /** The PERSISTENT SHELF — survives every navigation, outlives close (readable). */
  get shell(): SurfaceShellState {
    return this.shellValue;
  }

  // --- the FSM: open -------------------------------------------------------

  /**
   * Begin opening: `closed -> opening`. Validates and ADOPTS the target
   * (realization URL parsed with a host, canonical `wfxpses_` id, connector
   * id) — a re-open must present the SAME identity (a different playback
   * session is a different surface). Throws the typed `ExperienceError`
   * for any other state, a closed shelf (terminal), or a malformed target.
   */
  beginOpen(target: BrowserSessionTarget): void {
    this.expectState("beginOpen", "closed");
    if (this.shellValue.closed) {
      throw new ExperienceError(
        "beginOpen: the shell is closed — its state is terminal; construct a new browser surface session instead",
      );
    }
    const parsed = parseSessionTarget(target, this.identityValue);
    if (this.identityValue === undefined) {
      this.identityValue = { playbackSessionId: parsed.playbackSessionId, connectorId: parsed.connectorId };
    }
    this.targetUrlValue = parsed.url;
    this.currentUrlValue = parsed.url;
    this.providerHostValue = parsed.host;
    this.handleIdValue = undefined;
    this.transition("opening");
  }

  /**
   * Complete the open with the host's handle: `opening -> ready`. Records
   * the "opened" trail entry. Throws the typed `ExperienceError` for any
   * other state or a malformed handle.
   */
  completeOpen(handle: BrowserSessionHandle): void {
    this.expectState("completeOpen", "opening");
    if (
      !isRecord(handle) ||
      typeof handle.id !== "string" ||
      handle.id.length === 0 ||
      typeof handle.url !== "string" ||
      handle.url.length === 0
    ) {
      throw new ExperienceError(
        `completeOpen.handle: expected a BrowserSessionHandle { id, url }, got ${previewValue(handle)}`,
      );
    }
    this.handleIdValue = handle.id;
    this.transition("ready");
    this.trailEntries.push({
      kind: "opened",
      url: this.targetUrlValue ?? "",
      handleId: handle.id,
      occurredAt: this.nowIso(),
    });
  }

  /**
   * Abort an open that failed: `opening -> closed` (a `host.open()` that
   * threw). Records the "open-aborted" trail entry with the reason.
   */
  abortOpen(reason: string): void {
    this.expectState("abortOpen", "opening");
    this.transition("closed");
    this.trailEntries.push({
      kind: "open-aborted",
      url: this.targetUrlValue ?? "",
      reason: typeof reason === "string" ? reason : previewValue(reason),
      occurredAt: this.nowIso(),
    });
  }

  // --- the FSM: navigation -------------------------------------------------

  /**
   * Observe a navigation the host reported: `ready -> navigating`. The
   * session parses the URL, records the navigation on the trail, detects a
   * PROVIDER HANDOFF (any off-provider-host navigation — recorded + emitted
   * as the typed `ProviderHandoffEvent`, NEVER blocked), and moves its
   * current URL. The shell is deliberately NOT touched — the shelf
   * survives navigation.
   *
   * Throws the typed `ExperienceError` from any state other than `ready`
   * (a host that reports navigation events after close violates the port
   * contract) or for a malformed/unhosted URL (same contract).
   */
  observeNavigation(url: string): void {
    this.expectState("observeNavigation", "ready");
    const parsed = parseBrowserUrl(url);
    if (!parsed.ok || (parsed.parsed.scheme !== "http" && parsed.parsed.scheme !== "https") || parsed.parsed.host.length === 0) {
      throw new ExperienceError(
        `observeNavigation.url: the host reported a navigation that is not a parseable web URL with a host (${parsed.ok ? "no host" : parsed.detail}) — host contract violation, got ${previewValue(url)}`,
      );
    }
    const fromUrl = this.currentUrlValue ?? "";
    const toUrl = url;
    const toHost = parsed.parsed.host;
    const providerHandoff = toHost !== this.providerHostValue;
    const occurredAt = this.nowIso();
    this.transition("navigating");
    this.trailEntries.push({ kind: "navigation", fromUrl, toUrl, providerHandoff, occurredAt });
    this.currentUrlValue = toUrl;
    if (providerHandoff && this.identityValue !== undefined) {
      const event: ProviderHandoffEvent = {
        kind: "provider-handoff",
        playbackSessionId: this.identityValue.playbackSessionId,
        connectorId: this.identityValue.connectorId,
        fromUrl,
        toUrl,
        toHost,
        occurredAt,
      };
      this.handoffEvents.push(event);
      if (this.handoffObserver !== undefined) this.handoffObserver(event);
    }
  }

  /**
   * Settle the observed navigation: `navigating -> ready`. The controller
   * calls this once a navigation event is fully processed (the port
   * delivers completed navigations, so the transient `navigating` phase
   * resolves within one event). Throws the typed `ExperienceError` from
   * any state other than `navigating`.
   */
  settleNavigation(): void {
    this.expectState("settleNavigation", "navigating");
    this.transition("ready");
  }

  // --- the FSM: close ------------------------------------------------------

  /**
   * Close the session: any non-closed state `-> closed`. Records the
   * "closed" trail entry. The PERSISTENT SHELF survives — readable for
   * resume — and the session may `beginOpen` again (same identity) unless
   * the app has closed the shell itself.
   */
  close(): void {
    if (this.currentState === "closed") {
      throw new ExperienceError(
        "close: session is already 'closed' — legal from 'opening' | 'ready' | 'navigating' only",
      );
    }
    this.transition("closed");
    this.trailEntries.push({ kind: "closed", occurredAt: this.nowIso() });
  }

  // --- the persistent shelf --------------------------------------------------

  /**
   * Apply ONE shell action to the persistent shelf (pure `shell.ts`
   * reduction — valid, terminal-aware, navigation-proof by construction).
   */
  applyShell(action: ShellAction): void {
    this.shellValue = reduceShellState(this.shellValue, action);
  }

  /**
   * Record a resume heartbeat: a `heartbeat` shell action stamped from the
   * session's injected clock. `resumePositionMs` must be finite and >= 0.
   */
  heartbeat(resumePositionMs: number): void {
    this.applyShell({ kind: "heartbeat", resumePositionMs, atMs: this.nowMs() });
  }

  // --- internals -------------------------------------------------------------

  private transition(to: BrowserSessionState): void {
    assertBrowserSessionTransition(this.currentState, to);
    this.currentState = to;
    this.visited.push(to);
  }

  private expectState(operation: string, expected: BrowserSessionState): void {
    if (this.currentState !== expected) {
      throw new ExperienceError(
        `${operation}: session is '${this.currentState}' — legal only from '${expected}' (legal targets from '${this.currentState}': ${BROWSER_SESSION_TRANSITIONS[this.currentState].join(", ")})`,
      );
    }
  }

  /** Validated epoch ms from the injected clock (the ONLY time source). */
  private nowMs(): number {
    let nowMs: unknown;
    try {
      nowMs = this.clock.now();
    } catch (thrown) {
      throw new ExperienceError(
        `clock.now(): threw instead of returning epoch milliseconds (${describeThrown(thrown)})`,
      );
    }
    if (
      typeof nowMs !== "number" ||
      !Number.isFinite(nowMs) ||
      nowMs < 0 ||
      nowMs >= MAX_EPOCH_MS
    ) {
      throw new ExperienceError(
        `clock.now(): expected finite epoch milliseconds in [0, ${MAX_EPOCH_MS}), got ${previewValue(nowMs)}`,
      );
    }
    return nowMs;
  }

  private nowIso(): string {
    return new Date(this.nowMs()).toISOString();
  }
}

// ---------------------------------------------------------------------------
// Target validation (caller misuse — typed throw)
// ---------------------------------------------------------------------------

/** Parse + validate a session target; enforces identity persistence on re-open. */
function parseSessionTarget(
  target: BrowserSessionTarget,
  existingIdentity: BrowserSessionIdentity | undefined,
): { url: string; host: string; playbackSessionId: string; connectorId: string } {
  if (!isRecord(target)) {
    throw new ExperienceError(`target: expected a BrowserSessionTarget object, got ${previewValue(target)}`);
  }
  const problems: string[] = [];
  if (typeof target.connectorId !== "string" || target.connectorId.trim().length === 0) {
    problems.push(`target.connectorId: expected a non-empty provider connector id, got ${previewValue(target.connectorId)}`);
  }
  if (!isPlaybackSessionId(target.playbackSessionId)) {
    problems.push(
      `target.playbackSessionId: expected a canonical playback-session ID (wfxpses_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(target.playbackSessionId)}`,
    );
  }
  const parsed = parseBrowserUrl(target.url);
  const isWebUrl =
    parsed.ok && (parsed.parsed.scheme === "http" || parsed.parsed.scheme === "https") && parsed.parsed.host.length > 0;
  if (!isWebUrl) {
    problems.push(
      `target.url: expected an http/https realization URL with a host${parsed.ok ? "" : ` (${parsed.detail})`}, got ${previewValue(target.url)}`,
    );
  }
  if (problems.length > 0) throw new ExperienceError(problems);

  // Identity persistence: a re-open must present the SAME playback session
  // and provider connector — a different playback session is a different
  // surface (construct a new controller/session instead).
  if (existingIdentity !== undefined) {
    if (target.playbackSessionId !== existingIdentity.playbackSessionId) {
      throw new ExperienceError(
        `target.playbackSessionId: this session is '${existingIdentity.playbackSessionId}' — a re-open cannot switch playback sessions (construct a new browser surface)`,
      );
    }
    if (target.connectorId !== existingIdentity.connectorId) {
      throw new ExperienceError(
        `target.connectorId: this session realizes connector '${existingIdentity.connectorId}' — a re-open cannot switch connectors`,
      );
    }
  }
  // isWebUrl checked above; parsed.parsed.host is defined here
  const host = parsed.ok ? parsed.parsed.host : "";
  return {
    url: target.url,
    host,
    playbackSessionId: target.playbackSessionId,
    connectorId: target.connectorId,
  };
}
