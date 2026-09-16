/**
 * @wfx/client-runtime — the navigation state machine (R01).
 *
 * The runtime OWNS navigation and presentation state (frozen remediation
 * layering law): the product surfaces are TYPED STATES with legal
 * transitions, a bounded back-stack, and typed results. Adapters render
 * whatever the runtime's navigation state says; they never own it.
 *
 * Laws:
 *
 * 1. TYPED STATES — every surface carries its required payload (`item`
 *    REQUIRES a canonical `wfxitm_` item id; `search` REQUIRES a non-empty
 *    query). A target without its payload is an `invalid-target` result,
 *    never a guessed state.
 * 2. LEGAL TRANSITIONS — the `NAVIGATION_TRANSITIONS` table below is the
 *    explicit, auditable transition law. Illegal moves answer
 *    `illegal-transition`. Self-transitions are typed per surface:
 *    unparameterized surfaces (home/watch/shorts) are no-ops; `search`
 *    refines (replaces the top state); `item` chains (pushes a different
 *    item, no-ops the same one); `settings`/`library` re-entry is illegal
 *    (they are destination surfaces — change the section, not the route).
 * 3. BOUNDED BACK-STACK — every push records the previous state (max
 *    {@link MAX_NAVIGATION_HISTORY}; overflow drops the OLDEST entry,
 *    documented). `back()` on an empty stack answers `no-history` — never
 *    a silent no-op, never a crash.
 * 4. DETERMINISM — no clock, no randomness, no globals; ordering is the
 *    call order. Untyped callers are validated (misuse throws the typed
 *    `RuntimeError`, never a generic `Error`).
 * 5. NO FAKE HISTORY — `reset()` clears the stack (a deep link has no
 *    fabricated past); `navigate` pushes only real previous states.
 */

import { isEntertainmentItemId, isRecord, previewValue } from "@wfx/domain";
import type { Unsubscribe } from "@wfx/platform-contracts";

import { RuntimeError } from "./errors";

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/** The settings surface's sections (extended by R03 sources / R06 model). */
export type SettingsSection = "sources" | "model" | "general";

/** Every value of `SettingsSection`, in union order. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = ["sources", "model", "general"];

/** The library surface's sections. */
export type LibrarySection = "watchlist" | "history";

/** Every value of `LibrarySection`, in union order. */
export const LIBRARY_SECTIONS: readonly LibrarySection[] = ["watchlist", "history"];

/** Every product surface of the runtime (frozen remediation spec). */
export type SurfaceId = "home" | "watch" | "shorts" | "search" | "item" | "library" | "settings";

/** Every value of `SurfaceId`, in union order. */
export const SURFACE_IDS: readonly SurfaceId[] = [
  "home",
  "watch",
  "shorts",
  "search",
  "item",
  "library",
  "settings",
];

/**
 * One navigation state. States double as navigation TARGETS — the payload
 * requirements below are the target validation law.
 */
export type NavigationState =
  | { readonly surface: "home" }
  /** Long-form watch browsing (the watch feed surface). */
  | { readonly surface: "watch" }
  /** The vertical shorts stack. */
  | { readonly surface: "shorts" }
  /** Search: `query` non-empty (trimmed). */
  | { readonly surface: "search"; readonly query: string }
  /** Item detail: `itemId` is a canonical `wfxitm_` id. */
  | { readonly surface: "item"; readonly itemId: string }
  /** The library destination (watchlist/history sections). */
  | { readonly surface: "library"; readonly section?: LibrarySection }
  /** Settings (sources/model/general sections). */
  | { readonly surface: "settings"; readonly section?: SettingsSection };

/** The initial state (also the `reset()` default). */
export const INITIAL_NAVIGATION_STATE: NavigationState = { surface: "home" };

// ---------------------------------------------------------------------------
// The transition table
// ---------------------------------------------------------------------------

/**
 * The legal surface-to-surface transitions. Exhaustive per source surface;
 * `settings` cannot re-enter itself and `library` cannot re-enter itself
 * (destination surfaces — see module doc law 2). Self-handling of
 * parameterized surfaces (search refine / item chain) is implemented in
 * `navigate`, not the table.
 */
export const NAVIGATION_TRANSITIONS: Readonly<Record<SurfaceId, readonly SurfaceId[]>> = {
  home: ["watch", "shorts", "search", "item", "library", "settings"],
  watch: ["home", "shorts", "search", "item", "library", "settings"],
  shorts: ["home", "watch", "search", "item", "library", "settings"],
  search: ["home", "watch", "shorts", "item", "library", "settings"],
  item: ["home", "watch", "shorts", "search", "item", "library", "settings"],
  settings: ["home", "watch", "shorts", "search", "item", "library"],
  library: ["home", "watch", "shorts", "search", "item", "settings"],
};

/** The back-stack bound; overflow drops the OLDEST entry (documented). */
export const MAX_NAVIGATION_HISTORY = 50;

/** Is a surface-to-surface move legal per the table? (Pure.) */
export function isLegalSurfaceTransition(from: SurfaceId, to: SurfaceId): boolean {
  const legal = NAVIGATION_TRANSITIONS[from];
  return legal !== undefined && legal.includes(to);
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Why a navigation command failed. */
export type NavigationFailureReason =
  /** The surface-to-surface move is not in the transition table. */
  | "illegal-transition"
  /** The target state is malformed (missing/invalid payload). */
  | "invalid-target"
  /** `back()` with an empty back-stack. */
  | "no-history";

/** The typed result of every navigation command. */
export type NavigationResult =
  | {
      readonly ok: true;
      readonly state: NavigationState;
      /** The state before the command (null after the initial construction). */
      readonly previous: NavigationState | null;
      /** Whether the command changed the state at all. */
      readonly changed: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: NavigationFailureReason;
      readonly detail: string;
    };

/** Listener for navigation state changes. */
export type NavigationListener = (
  state: NavigationState,
  previous: NavigationState | null,
) => void;

// ---------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------

/** The navigation + presentation-state controller the runtime exposes. */
export interface NavigationController {
  /** The current state (a fresh copy each call). */
  current(): NavigationState;
  /** Whether `back()` has history to pop. */
  canGoBack(): boolean;
  /** The bounded back-stack (oldest first), read-only view. */
  history(): readonly NavigationState[];
  /** Navigate to a target state (typed result; see module doc laws). */
  navigate(target: NavigationState): NavigationResult;
  /** Pop the back-stack (typed result; `no-history` when empty). */
  back(): NavigationResult;
  /** Deep-link/reset: replace everything with one state (default home). */
  reset(state?: NavigationState): NavigationResult;
  /** Observe state changes (listener receives current + previous). */
  subscribe(listener: NavigationListener): Unsubscribe;
}

// ---------------------------------------------------------------------------
// State validation + equality (pure)
// ---------------------------------------------------------------------------

/**
 * Validate a claimed navigation state STRUCTURALLY (surface is a member;
 * payloads are the right types). Throws the typed `RuntimeError`
 * (`invalid-input`) — the same misuse channel the codebase uses everywhere.
 * SEMANTIC payload validity (canonical ids, non-empty queries, section
 * vocabulary) is `navigate`'s `invalid-target` RESULT — untrusted deep-link
 * input is answered honestly, never crashed on.
 */
export function assertValidNavigationState(state: NavigationState): void {
  if (!isRecord(state)) {
    throw new RuntimeError(
      "invalid-input",
      `state: expected a NavigationState object, got ${previewValue(state)}`,
    );
  }
  const surface = state.surface;
  if (typeof surface !== "string" || !(SURFACE_IDS as readonly string[]).includes(surface)) {
    throw new RuntimeError(
      "invalid-input",
      `state.surface: expected one of ${SURFACE_IDS.join(" | ")}, got ${previewValue(surface)}`,
    );
  }
  switch (state.surface) {
    case "search": {
      const query = (state as { query?: unknown }).query;
      if (typeof query !== "string") {
        throw new RuntimeError(
          "invalid-input",
          `state.query: expected a string, got ${previewValue(query)}`,
        );
      }
      break;
    }
    case "item": {
      const itemId = (state as { itemId?: unknown }).itemId;
      if (typeof itemId !== "string") {
        throw new RuntimeError(
          "invalid-input",
          `state.itemId: expected a string, got ${previewValue(itemId)}`,
        );
      }
      break;
    }
    case "library":
    case "settings": {
      const section = (state as { section?: unknown }).section;
      if (section !== undefined && typeof section !== "string") {
        throw new RuntimeError(
          "invalid-input",
          `state.section: expected a string when present, got ${previewValue(section)}`,
        );
      }
      break;
    }
    default:
      break;
  }
}

/** Are two navigation states EQUAL (surface + payload)? (Pure.) */
export function navigationStatesEqual(a: NavigationState, b: NavigationState): boolean {
  if (a.surface !== b.surface) return false;
  switch (a.surface) {
    case "search":
      return a.query === (b as { surface: "search"; query: string }).query;
    case "item":
      return a.itemId === (b as { surface: "item"; itemId: string }).itemId;
    case "library": {
      const other = b as { surface: "library"; section?: LibrarySection };
      return a.section === other.section;
    }
    case "settings": {
      const other = b as { surface: "settings"; section?: SettingsSection };
      return a.section === other.section;
    }
    default:
      return true;
  }
}

/** Defensive copy of one state (callers may mutate their target objects). */
function cloneState(state: NavigationState): NavigationState {
  return { ...(state as Record<string, unknown>) } as NavigationState;
}

// ---------------------------------------------------------------------------
// The store implementation
// ---------------------------------------------------------------------------

/**
 * The navigation state machine (pure bookkeeping: no clock, no ids, no
 * globals). Created by `createRuntime`; usable standalone in tests.
 */
export function createNavigationStore(
  initial: NavigationState = INITIAL_NAVIGATION_STATE,
): NavigationController {
  assertValidNavigationState(initial);
  let current: NavigationState = cloneState(initial);
  const stack: NavigationState[] = [];
  const listeners = new Set<NavigationListener>();

  function emit(previous: NavigationState | null): void {
    for (const listener of listeners) listener(current, previous);
  }

  function pushPrevious(): void {
    stack.push(current);
    if (stack.length > MAX_NAVIGATION_HISTORY) {
      stack.shift(); // overflow drops the OLDEST entry (documented law 3)
    }
  }

  function navigate(target: NavigationState): NavigationResult {
    assertValidNavigationState(target);
    const from = current.surface;
    const to = target.surface;

    // Target payload validation (typed result, not a throw — the target may
    // come from untrusted deep-link input and must be answered honestly).
    switch (to) {
      case "search": {
        const query = (target as { surface: "search"; query: string }).query;
        if (typeof query !== "string" || query.trim().length === 0) {
          return {
            ok: false,
            reason: "invalid-target",
            detail: `search requires a non-empty query, got ${previewValue(query)}`,
          };
        }
        break;
      }
      case "item": {
        const itemId = (target as { surface: "item"; itemId: string }).itemId;
        if (!isEntertainmentItemId(itemId)) {
          return {
            ok: false,
            reason: "invalid-target",
            detail: `item requires a canonical wfxitm_ item id, got ${previewValue(itemId)}`,
          };
        }
        break;
      }
      case "library": {
        const section = (target as { surface: "library"; section?: LibrarySection }).section;
        if (section !== undefined && !(LIBRARY_SECTIONS as readonly string[]).includes(section)) {
          return {
            ok: false,
            reason: "invalid-target",
            detail: `library section must be one of ${LIBRARY_SECTIONS.join(" | ")}, got ${previewValue(section)}`,
          };
        }
        break;
      }
      case "settings": {
        const section = (target as { surface: "settings"; section?: SettingsSection }).section;
        if (section !== undefined && !(SETTINGS_SECTIONS as readonly string[]).includes(section)) {
          return {
            ok: false,
            reason: "invalid-target",
            detail: `settings section must be one of ${SETTINGS_SECTIONS.join(" | ")}, got ${previewValue(section)}`,
          };
        }
        break;
      }
      default:
        break;
    }

    // Self-transitions (law 2) are handled BEFORE the table: typed per
    // surface (no-op / refine / chain / destination-surface rejection).
    if (from === to) {
      switch (to) {
        case "home":
        case "watch":
        case "shorts": {
          // Unparameterized surfaces: same state — an honest no-op.
          return { ok: true, state: current, previous: current, changed: false };
        }
        case "search": {
          // Refinement: replace the current search state, no stack push.
          const previous = current;
          current = cloneState(target);
          emit(previous);
          return { ok: true, state: current, previous, changed: true };
        }
        case "item": {
          // Chaining: a different item pushes; the same item is a no-op.
          if (navigationStatesEqual(current, target)) {
            return { ok: true, state: current, previous: current, changed: false };
          }
          const previous = current;
          pushPrevious();
          current = cloneState(target);
          emit(previous);
          return { ok: true, state: current, previous, changed: true };
        }
        default: {
          // settings -> settings / library -> library: destination surfaces
          // never re-enter themselves (change the section, not the route).
          return {
            ok: false,
            reason: "illegal-transition",
            detail: `navigation '${from}' -> '${to}' is not in the transition table (destination surfaces do not re-enter themselves)`,
          };
        }
      }
    }

    if (!isLegalSurfaceTransition(from, to)) {
      return {
        ok: false,
        reason: "illegal-transition",
        detail: `navigation '${from}' -> '${to}' is not in the transition table`,
      };
    }

    const previous = current;
    pushPrevious();
    current = cloneState(target);
    emit(previous);
    return { ok: true, state: current, previous, changed: true };
  }

  function back(): NavigationResult {
    const previous = stack.pop();
    if (previous === undefined) {
      return {
        ok: false,
        reason: "no-history",
        detail: "the back-stack is empty — nowhere to go back to",
      };
    }
    const before = current;
    current = previous;
    emit(before);
    return { ok: true, state: current, previous: before, changed: true };
  }

  function reset(state?: NavigationState): NavigationResult {
    const target = state ?? INITIAL_NAVIGATION_STATE;
    assertValidNavigationState(target);
    const previous = current;
    stack.length = 0; // a deep link has no fabricated past (law 5)
    current = cloneState(target);
    emit(previous);
    return { ok: true, state: current, previous, changed: !navigationStatesEqual(previous, current) };
  }

  return {
    current: () => cloneState(current),
    canGoBack: () => stack.length > 0,
    history: () => stack.map((entry) => cloneState(entry)),
    navigate,
    back,
    reset,
    subscribe(listener: NavigationListener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
