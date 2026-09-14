/**
 * @wfx/experience — in-app browser surface COMPONENT controller (WFX-026, Lane C).
 *
 * `createBrowserSurface(deps)` is the framework-neutral component logic: a
 * typed controller BINDING the three parts of the contained browser
 * session model —
 *
 *   the HOST    (`host.ts`):        the platform seam (webview adapter or fixture)
 *   the SESSION (`session.ts`):     the FSM + trail + provider handoff observation
 *   the SHELL   (`shell.ts`):       the persistent WebFlix shelf (chrome + resume)
 *
 * plus the ISOLATION POLICY (`isolation.ts`) that gates every open. It owns
 * ONE `BrowserSurfaceSession` for its whole lifetime, so the persistent
 * shelf survives navigation AND close/re-open cycles (a re-open must carry
 * the SAME playback session identity — a different playback session is a
 * different surface, construct a new controller).
 *
 * Open flow (every step typed, no fake success):
 *   1. isolation verdict (pure) — refused URLs NEVER reach the host; the
 *      typed `isolated-refused` result carries the reason.
 *   2. `session.beginOpen` — target validation + identity adoption.
 *   3. `host.open(url, { restrictCookies: "isolate" })` — a throwing host
 *      aborts the open (typed `host-open-failed`) and the session returns
 *      to closed with the abort recorded on the trail.
 *   4. `session.completeOpen` + `host.onNavigation` wiring — every host
 *      navigation event drives the session through its `navigating` phase
 *      (observe) and back to `ready` (settle); provider handoffs inside
 *      those events are observed and recorded, never blocked.
 *
 * The REACT WRAPPER is documented at the bottom of this file in comment
 * form: the workspace provides no react types at this base, and the lane
 * rules forbid adding the dependency — the controller ships alone and the
 * wrapper lifts verbatim when an app package gains react.
 */

import { isRecord, previewValue } from "@wfx/domain";

import { ExperienceError, describeThrown, type Clock } from "../ports";
import type { BrowserHost, BrowserSessionHandle } from "./host";
import {
  isolationVerdict,
  assertValidIsolationPolicies,
  type IsolationPolicy,
  type IsolationRefusalReason,
  type ProviderIsolationPolicies,
} from "./isolation";
import {
  BrowserSurfaceSession,
  type BrowserSessionState,
  type ProviderHandoffEvent,
  type SessionTrailEntry,
} from "./session";
import type { ShellCommand, SurfaceChromeState, SurfaceShellState } from "./shell";

// ---------------------------------------------------------------------------
// Deps, target, results
// ---------------------------------------------------------------------------

/** What `createBrowserSurface` needs injected — host, isolation, clock, observers. */
export interface BrowserSurfaceDeps {
  /** The platform seam: a real webview adapter, or the fixture host in tests. */
  readonly host: BrowserHost;
  /**
   * The per-provider-connector isolation policies (typed map supplied by
   * the CALLER — the app layer assembles it from connector descriptors).
   * Validated ONCE here; connectors without an entry open nothing.
   */
  readonly isolation: ProviderIsolationPolicies;
  /** The ONLY time source — stamps trail entries, handoff events, heartbeats. */
  readonly clock: Clock;
  /** Observer of provider handoffs (observed, never blocked). May throw — propagates. */
  readonly onProviderHandoff?: ((event: ProviderHandoffEvent) => void) | undefined;
}

/** What ONE `open()` opens: the realization URL + the session identity. */
export interface BrowserSurfaceTarget {
  /** The browser-mode realization URL (must pass the isolation policy). */
  readonly url: string;
  /** The provider connector whose allow-list governs the URL. */
  readonly connectorId: string;
  /** The canonical playback session this surface realizes (`wfxpses_` id). */
  readonly playbackSessionId: string;
}

/**
 * The typed result of opening the surface:
 * - `ok: true` — open; carries the host handle and the governing policy.
 * - `isolated-refused` — the URL was refused by the isolation policy (file /
 *   private network / non-allowlisted domain / no policy / malformed). The
 *   host was NEVER called.
 * - `host-open-failed` — the host's `open()` threw; the session aborted back
 *   to closed (the abort is on the trail).
 */
export type BrowserSurfaceOpenResult =
  | {
      ok: true;
      handle: BrowserSessionHandle;
      url: string;
      host: string;
      policy: IsolationPolicy;
    }
  | {
      ok: false;
      kind: "isolated-refused";
      url: string;
      reason: IsolationRefusalReason;
      detail: string;
    }
  | {
      ok: false;
      kind: "host-open-failed";
      url: string;
      detail: string;
    };

/**
 * The typed result of `evaluate` (capability truth): hosts MAY provide
 * script evaluation; when they do not, the result is the typed
 * `unsupported` — never a fake success.
 */
export type BrowserEvaluationResult =
  | { ok: true; value: unknown }
  | { ok: false; kind: "unsupported"; detail: string }
  | { ok: false; kind: "host-evaluate-failed"; detail: string };

// ---------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------

/** The framework-neutral browser surface controller (see `createBrowserSurface`). */
export interface BrowserSurfaceController {
  /**
   * Open the surface at the target's realization URL. Isolation FIRST —
   * refused URLs never reach the host. Throws the typed `ExperienceError`
   * for caller misuse (already open, closed shell, malformed target).
   */
  open(target: BrowserSurfaceTarget): BrowserSurfaceOpenResult;
  /**
   * Close the surface: the host session closes first (a throwing host
   * leaves the FSM untouched — retryable), then the session records the
   * close. The persistent shelf survives (readable for resume).
   */
  close(): void;
  /** Issue a typed shell command (back-to-feed / minimize / close). */
  shell(command: ShellCommand): void;
  /** Set the surface chrome directly (compact / expanded / hidden). */
  setChrome(chrome: SurfaceChromeState): void;
  /** Record a resume heartbeat (stamped from the injected clock). */
  heartbeat(resumePositionMs: number): void;
  /**
   * Evaluate a script in the open host session. TYPED `unsupported` when
   * the host provides no `evaluate` (capability truth — no fake success).
   */
  evaluate(script: string): Promise<BrowserEvaluationResult>;
  /** The session FSM's current state. */
  get state(): BrowserSessionState;
  /** The one session this controller binds (FSM + trail + shelf). */
  get session(): BrowserSurfaceSession;
  /** The persistent shell state (chrome + resume heartbeat). */
  get shellState(): SurfaceShellState;
  /** The auditable session trail (opens, navigations, handoffs, close). */
  get trail(): readonly SessionTrailEntry[];
  /** Every recorded provider handoff (observed, never blocked). */
  get handoffs(): readonly ProviderHandoffEvent[];
}

/**
 * Build the browser surface controller: ONE session bound to the injected
 * host, isolation policies, clock, and handoff observer. The persistent
 * shelf starts from `initialShellState` here and survives every navigation
 * and close/re-open of this controller's lifetime.
 *
 * Throws the typed `ExperienceError` for malformed deps (host shape,
 * isolation policies, clock, observer) — validated eagerly, once.
 */
export function createBrowserSurface(deps: BrowserSurfaceDeps): BrowserSurfaceController {
  if (!isRecord(deps)) {
    throw new ExperienceError(`deps: expected a BrowserSurfaceDeps object, got ${previewValue(deps)}`);
  }
  const problems: string[] = [];
  if (!isRecord(deps.host)) {
    problems.push(`deps.host: expected a BrowserHost object, got ${previewValue(deps.host)}`);
  } else {
    if (typeof deps.host.open !== "function") {
      problems.push("deps.host.open: expected a function (open(url, options): BrowserSessionHandle)");
    }
    if (typeof deps.host.close !== "function") {
      problems.push("deps.host.close: expected a function (close(handle): void)");
    }
    if (typeof deps.host.onNavigation !== "function") {
      problems.push("deps.host.onNavigation: expected a function (onNavigation(handle, cb): void)");
    }
    if (deps.host.evaluate !== undefined && typeof deps.host.evaluate !== "function") {
      problems.push("deps.host.evaluate: expected a function when present (optional capability)");
    }
  }
  if (!isRecord(deps.clock) || typeof deps.clock.now !== "function") {
    problems.push(`deps.clock: expected a Clock object with a now() function, got ${previewValue(deps.clock)}`);
  }
  if (deps.onProviderHandoff !== undefined && typeof deps.onProviderHandoff !== "function") {
    problems.push(
      `deps.onProviderHandoff: expected a function when present, got ${previewValue(deps.onProviderHandoff)}`,
    );
  }
  if (problems.length > 0) throw new ExperienceError(problems);
  assertValidIsolationPolicies(deps.isolation); // typed throw on malformed policies

  const host: BrowserHost = deps.host;
  const clock: Clock = deps.clock;
  const session = new BrowserSurfaceSession({
    clock,
    ...(deps.onProviderHandoff !== undefined
      ? { onProviderHandoff: deps.onProviderHandoff }
      : {}),
  });
  let currentHandle: BrowserSessionHandle | undefined;

  return {
    open(target: BrowserSurfaceTarget): BrowserSurfaceOpenResult {
      if (session.state !== "closed") {
        throw new ExperienceError(
          `open: the surface session is '${session.state}' — close it before opening again`,
        );
      }
      if (session.shell.closed) {
        throw new ExperienceError(
          "open: the shell is closed — its state is terminal; construct a new browser surface",
        );
      }
      // 1. Isolation FIRST: refused URLs never reach the host, and the
      //    session never even begins opening (no trail noise).
      const verdict = isolationVerdict(target.url, target.connectorId, deps.isolation);
      if (!verdict.ok) {
        return {
          ok: false,
          kind: "isolated-refused",
          url: verdict.url,
          reason: verdict.reason,
          detail: verdict.detail,
        };
      }
      // 2. The session validates the target container (caller misuse throws)
      //    and adopts/persists the identity.
      session.beginOpen(target);
      // 3. The host opens under the cookie-isolation contract. A throwing
      //    host aborts the open (typed result) and the session returns to
      //    closed with the abort on the trail.
      let handle: BrowserSessionHandle;
      try {
        handle = host.open(target.url, { restrictCookies: "isolate" });
      } catch (thrown) {
        const detail = describeThrown(thrown);
        session.abortOpen(detail);
        return { ok: false, kind: "host-open-failed", url: target.url, detail };
      }
      // 4. Complete the FSM open and wire navigation observation: every
      //    host navigation event drives the session through its navigating
      //    phase and back to ready; handoffs inside it are observed, never
      //    blocked. A host that reports a malformed navigation (or events
      //    after close) violates the port contract and gets the typed
      //    error thrown into its dispatch.
      session.completeOpen(handle);
      host.onNavigation(handle, (navigation) => {
        session.observeNavigation(navigation.url);
        session.settleNavigation();
      });
      currentHandle = handle;
      return { ok: true, handle, url: target.url, host: verdict.host, policy: verdict.policy };
    },

    close(): void {
      if (session.state === "closed") {
        throw new ExperienceError("close: the surface session is already 'closed'");
      }
      const handle = currentHandle;
      if (handle !== undefined) {
        host.close(handle); // may throw (port violation) — FSM untouched, retryable
        currentHandle = undefined;
      }
      session.close();
    },

    shell(command: ShellCommand): void {
      session.applyShell(command);
    },

    setChrome(chrome: SurfaceChromeState): void {
      session.applyShell({ kind: "set-chrome", chrome });
    },

    heartbeat(resumePositionMs: number): void {
      session.heartbeat(resumePositionMs);
    },

    async evaluate(script: string): Promise<BrowserEvaluationResult> {
      if (typeof script !== "string" || script.length === 0) {
        throw new ExperienceError(
          `evaluate.script: expected a non-empty script string, got ${previewValue(script)}`,
        );
      }
      const handle = currentHandle;
      if (handle === undefined) {
        throw new ExperienceError("evaluate: no open browser session — open() first");
      }
      const evaluateImpl = host.evaluate;
      if (evaluateImpl === undefined) {
        return {
          ok: false,
          kind: "unsupported",
          detail: "this browser host does not provide script evaluation (optional capability, absent)",
        };
      }
      try {
        return { ok: true, value: await evaluateImpl(handle, script) };
      } catch (thrown) {
        return { ok: false, kind: "host-evaluate-failed", detail: describeThrown(thrown) };
      }
    },

    get state(): BrowserSessionState {
      return session.state;
    },

    get session(): BrowserSurfaceSession {
      return session;
    },

    get shellState(): SurfaceShellState {
      return session.shell;
    },

    get trail(): readonly SessionTrailEntry[] {
      return session.trail;
    },

    get handoffs(): readonly ProviderHandoffEvent[] {
      return session.handoffs;
    },
  };
}

// ---------------------------------------------------------------------------
// The React wrapper — DOCUMENTED WIRING (comment-only, by design)
// ---------------------------------------------------------------------------
//
// The workspace at this base provides NO react types (apps/web,
// apps/desktop, apps/mobile are framework-neutral scaffolds), and the lane
// rules forbid adding `react` to packages/experience dependencies. Per the
// dispatch packet the THIN wrapper therefore ships in this comment-documented
// form — lift it verbatim into `react.ts` when an app package gains react:
//
//   import { useEffect, useRef, useState } from "react";
//   import {
//     createBrowserSurface,
//     type BrowserSurfaceController,
//     type BrowserSurfaceDeps,
//     type BrowserSurfaceOpenResult,
//     type BrowserSurfaceTarget,
//     type ProviderHandoffEvent,
//   } from "@wfx/experience";
//
//   export interface BrowserSurfaceProps {
//     deps: BrowserSurfaceDeps;       // host adapter + isolation policies + clock
//     target: BrowserSurfaceTarget;   // realization URL + playback session identity
//     onOpenResult?: (result: BrowserSurfaceOpenResult) => void;
//   }
//
//   export function BrowserSurface({ deps, target, onOpenResult }: BrowserSurfaceProps) {
//     // The controller is created ONCE per mounted surface (deps are
//     // creation-time inputs — changing them means a new surface; key the
//     // component on playbackSessionId in the app).
//     const [controller] = useState(() => createBrowserSurface(deps));
//     const [openResult, setOpenResult] = useState<BrowserSurfaceOpenResult | null>(null);
//
//     useEffect(() => {
//       const result = controller.open(target);
//       setOpenResult(result);
//       onOpenResult?.(result);
//       return () => controller.close(); // unmount closes the surface (host first)
//     }, [controller]); // open once per mounted surface
//
//     if (openResult !== null && !openResult.ok) {
//       // The typed refusal — isolation and host failures are DATA here,
//       // never crashes, never fake successes.
//       return (
//         <div role="alert">
//           The provider page cannot open in the browser surface ({openResult.kind}): {openResult.detail}
//         </div>
//       );
//     }
//     return null; // the platform host renders the actual webview behind this shell
//   }
//
// The wrapper is DELIBERATELY this thin: every rule (isolation, the FSM,
// handoff observation, the persistent shelf) lives in the framework-neutral
// controller above. The app's chrome binds the shell commands —
// `controller.shell({ kind: "minimize" })`, `controller.shell({ kind: "back-to-feed" })`,
// `controller.heartbeat(positionMs)` from its progress ticker — and reads
// `controller.shellState.heartbeat.resumePositionMs` when the surface closes, to
// hand the resume position back to the frozen `PlaybackSession`.
