/**
 * @wfx/experience — in-app browser surface PERSISTENT SHELL (WFX-026, Lane C).
 *
 * The WebFlix shell model that wraps the in-app browser surface: the
 * surface chrome visibility, the resume-position heartbeat, and the typed
 * shell commands — the "one continuous WebFlix experience" the frozen
 * architecture promises while playback happens inside a provider's web
 * page.
 *
 * THE PERSISTENT SHELF: this state is deliberately DECOUPLED from the
 * browser session FSM (`session.ts`). It must SURVIVE NAVIGATION (the
 * packet's explicit requirement) and it OUTLIVES the surface's close —
 * after close the heartbeat is still readable as the resume payload the
 * app hands back to the frozen `PlaybackSession.resumePositionMs`
 * (docs/architecture/contracts.md, "Media Surface"). The shell therefore
 * accepts actions regardless of the session state, except once CLOSED
 * (terminal — the resume data stays readable, but nothing more happens).
 *
 * `close` here is the SHELL's close (the surface chrome is gone for good),
 * NOT the session FSM's close (`BrowserSurfaceSession.close()` — the
 * surface can re-open after that one). The app closes the shell when the
 * whole surface component goes away; it closes the session when the user
 * dismisses the browser view for now. Both are typed, both keep the
 * heartbeat.
 *
 * PURE state + reducers: no clock, no ids, no host — timestamps ride IN
 * the heartbeat action (the session/controller, which owns the injected
 * `Clock`, stamps them). Invalid actions throw the typed `ExperienceError`
 * (caller misuse — never a silent pass, never a fabricated value).
 */

import { isRecord, previewValue } from "@wfx/domain";

import { ExperienceError } from "../ports";

// ---------------------------------------------------------------------------
// SurfaceChromeState — the shell chrome visibility
// ---------------------------------------------------------------------------

/**
 * The visibility of the WebFlix surface chrome around the browser view.
 *
 * - `expanded` — the full shell chrome (title, controls, actions).
 * - `compact`  — a minimized, video-first strip (the persistent shelf).
 * - `hidden`   — chrome hidden entirely (immersive; the surface stays).
 */
export type SurfaceChromeState = "compact" | "expanded" | "hidden";

/** All chrome states, for validation of untyped input. */
const CHROME_STATES: readonly string[] = ["compact", "expanded", "hidden"];

// ---------------------------------------------------------------------------
// The heartbeat — the resume payload
// ---------------------------------------------------------------------------

/**
 * The resume heartbeat payload the shell maintains while the browser
 * surface plays: the playback position as it was last observed, and when.
 * `resumePositionMs` is the same unit/semantics as the frozen
 * `PlaybackSession.resumePositionMs` — this is the value the app hands to
 * resume flow when the user returns.
 */
export interface ShellHeartbeat {
  /** Playback position in milliseconds at the last heartbeat. */
  readonly resumePositionMs: number;
  /** When the heartbeat was recorded (epoch ms, from the injected clock). */
  readonly atMs: number;
}

// ---------------------------------------------------------------------------
// SurfaceShellState — the persistent shelf
// ---------------------------------------------------------------------------

/**
 * The full persistent shell state — the WebFlix chrome + resume heartbeat
 * that survives every navigation (and, read-only, the surface's close).
 */
export interface SurfaceShellState {
  /** Chrome visibility. */
  readonly chrome: SurfaceChromeState;
  /** The resume heartbeat. */
  readonly heartbeat: ShellHeartbeat;
  /** Terminal marker: the shell was closed (heartbeat stays readable). */
  readonly closed: boolean;
}

// ---------------------------------------------------------------------------
// ShellCommands and actions
// ---------------------------------------------------------------------------

/**
 * The typed shell commands — the surface chrome's user intents:
 *
 * - `back-to-feed` — the user returns to the WebFlix feed; the chrome
 *   hides so the feed shows through (app-side navigation is the caller's
 *   concern — this is the STATE model).
 * - `minimize`    — the user shrinks the surface to the persistent shelf
 *   (compact chrome, keeps playing).
 * - `close`       — the shell closes TERMINALLY; the heartbeat is kept as
 *   the resume payload, nothing further is accepted.
 */
export type ShellCommand =
  | { readonly kind: "back-to-feed" }
  | { readonly kind: "minimize" }
  | { readonly kind: "close" };

/** Everything the shell reducer accepts: the commands plus state updates. */
export type ShellAction =
  | ShellCommand
  | { readonly kind: "set-chrome"; readonly chrome: SurfaceChromeState }
  | { readonly kind: "heartbeat"; readonly resumePositionMs: number; readonly atMs: number };

// ---------------------------------------------------------------------------
// Validation (caller misuse — typed throw)
// ---------------------------------------------------------------------------

/**
 * Validate a shell action. Throws the typed `ExperienceError` listing every
 * problem (untyped JS callers included): unknown action kinds, invalid
 * chrome states, non-finite or negative positions/timestamps.
 */
export function assertValidShellAction(action: ShellAction): void {
  if (!isRecord(action)) {
    throw new ExperienceError(
      `action: expected a ShellAction object with a kind, got ${previewValue(action)}`,
    );
  }
  const kind: unknown = action.kind;
  if (typeof kind !== "string") {
    throw new ExperienceError(
      `action.kind: expected one of back-to-feed | minimize | close | set-chrome | heartbeat, got ${previewValue(kind)}`,
    );
  }
  const record: Record<string, unknown> = action;
  switch (kind) {
    case "back-to-feed":
    case "minimize":
    case "close":
      return;
    case "set-chrome": {
      const chrome: unknown = record.chrome;
      if (typeof chrome !== "string" || !CHROME_STATES.includes(chrome)) {
        throw new ExperienceError(
          `action.chrome: expected one of ${CHROME_STATES.join(" | ")}, got ${previewValue(chrome)}`,
        );
      }
      return;
    }
    case "heartbeat": {
      const resumePositionMs: unknown = record.resumePositionMs;
      const atMs: unknown = record.atMs;
      const problems: string[] = [];
      if (
        typeof resumePositionMs !== "number" ||
        !Number.isFinite(resumePositionMs) ||
        resumePositionMs < 0
      ) {
        problems.push(
          `action.resumePositionMs: expected a finite non-negative number, got ${previewValue(resumePositionMs)}`,
        );
      }
      if (typeof atMs !== "number" || !Number.isFinite(atMs) || atMs < 0) {
        problems.push(
          `action.atMs: expected finite epoch milliseconds, got ${previewValue(atMs)}`,
        );
      }
      if (problems.length > 0) throw new ExperienceError(problems);
      return;
    }
    default:
      throw new ExperienceError(
        `action.kind: expected one of back-to-feed | minimize | close | set-chrome | heartbeat, got ${previewValue(kind)}`,
      );
  }
}

/**
 * Validate a shell STATE object (defensive: untyped callers, carried
 * shelves crossing controller boundaries). Throws the typed
 * `ExperienceError` listing every problem.
 */
export function assertValidSurfaceShellState(state: SurfaceShellState): void {
  if (
    !isRecord(state) ||
    typeof state.chrome !== "string" ||
    !CHROME_STATES.includes(state.chrome) ||
    typeof state.closed !== "boolean" ||
    !isRecord(state.heartbeat) ||
    typeof state.heartbeat.resumePositionMs !== "number" ||
    !Number.isFinite(state.heartbeat.resumePositionMs) ||
    state.heartbeat.resumePositionMs < 0 ||
    typeof state.heartbeat.atMs !== "number" ||
    !Number.isFinite(state.heartbeat.atMs) ||
    state.heartbeat.atMs < 0
  ) {
    throw new ExperienceError(
      `state: expected a SurfaceShellState { chrome, heartbeat { resumePositionMs, atMs }, closed }, got ${previewValue(state)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// The reducer — pure
// ---------------------------------------------------------------------------

/**
 * The initial shell state: expanded chrome, heartbeat at position 0 — the
 * shelf a fresh surface starts from. `atMs` comes from the caller's clock
 * (the session/controller owns the injected `Clock`; the reducer stays pure).
 */
export function initialShellState(atMs: number): SurfaceShellState {
  if (typeof atMs !== "number" || !Number.isFinite(atMs) || atMs < 0) {
    throw new ExperienceError(
      `atMs: expected finite epoch milliseconds, got ${previewValue(atMs)}`,
    );
  }
  return { chrome: "expanded", heartbeat: { resumePositionMs: 0, atMs }, closed: false };
}

/**
 * Reduce ONE shell action against the shell state. PURE — no clock, no
 * host, no session: the returned state is a fresh object, the input is
 * untouched. Command semantics:
 *
 * - `back-to-feed` → `chrome: "hidden"` (surface stays, chrome hides).
 * - `minimize`     → `chrome: "compact"`.
 * - `close`        → `closed: true` — TERMINAL; heartbeat kept for resume.
 * - `set-chrome`   → the given chrome.
 * - `heartbeat`    → the heartbeat payload replaced.
 *
 * Actions on a CLOSED shell throw the typed `ExperienceError` (terminal
 * means terminal — the resume data stays readable on the last state, but
 * no further reductions are accepted). Invalid actions throw the typed
 * `ExperienceError` with every problem (see `assertValidShellAction`).
 */
export function reduceShellState(
  state: SurfaceShellState,
  action: ShellAction,
): SurfaceShellState {
  assertValidShellAction(action);
  assertValidSurfaceShellState(state);
  if (state.closed) {
    throw new ExperienceError(
      `the shell is closed — its state is terminal (heartbeat stays readable for resume); construct a new browser surface instead of reducing a closed shell`,
    );
  }
  switch (action.kind) {
    case "back-to-feed":
      return { ...state, chrome: "hidden" };
    case "minimize":
      return { ...state, chrome: "compact" };
    case "close":
      return { ...state, closed: true };
    case "set-chrome":
      return { ...state, chrome: action.chrome };
    case "heartbeat":
      return { ...state, heartbeat: { resumePositionMs: action.resumePositionMs, atMs: action.atMs } };
  }
}
