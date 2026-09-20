/**
 * @wfx/client-runtime — the feed-mode control store (R21-A).
 *
 * The shared control contract behind the Home / Watch / Shorts feed-mode
 * control (the plan's orientation surface: "current feed mode: For you /
 * Following / BYOF / Hybrid"). The RUNTIME owns this presentation state
 * (the frozen layering law: navigation + presentation state is runtime
 * state); Web/Desktop/Mobile bind the SAME control semantics — only the
 * availability TRUTH differs per adapter (whether following
 * relationships or an imported feed actually exist).
 *
 * LAWS:
 *
 * 1. CLOSED VOCABULARY — the mode union is {@link FeedMode} (frozen in
 *    discoverability.ts); a non-vocabulary set is caller misuse and
 *    throws the typed `RuntimeError` (`invalid-input`).
 * 2. HONEST AVAILABILITY — the store never GUESSES whether Following /
 *    BYOF / Hybrid can be honored: the ADAPTER reports the truth
 *    (following relationships exist; an imported feed exists). "For you"
 *    is always available (the WebFlix-ranked discovery feed is the
 *    default orientation). Setting an UNAVAILABLE mode answers the typed
 *    `unavailable` result WITH its recovery hint — never a silent
 *    success, never a silent no-op, and never a hidden mode.
 * 3. DISCOVERABLE, NOT HIDDEN — unavailability is a VIEW concern
 *    (R21-C's feed-mode choice view renders every mode with its
 *    explanation + next action); this store carries the truth the view
 *    derives from.
 * 4. DETERMINISM — no clock, no ids, no I/O; ordering is the call order.
 */

import { FEED_MODES, FEED_MODE_LABELS, isFeedMode } from "./discoverability";
import type { FeedMode } from "./discoverability";
import { RuntimeError } from "./errors";
import type { Unsubscribe } from "@wfx/platform-contracts";

// ---------------------------------------------------------------------------
// The availability truth (adapter-reported, never guessed)
// ---------------------------------------------------------------------------

/**
 * Whether each non-default mode can be honored RIGHT NOW. The adapter
 * reports this from its real data (following relationships, imported
 * feeds); the store never fabricates availability.
 */
export interface FeedModeAvailability {
  /** Whether any following relationship exists (the Following mode's data). */
  readonly following: boolean;
  /** Whether any imported (BYOF) feed exists (the imported-feed mode's data). */
  readonly byof: boolean;
}

/** The default availability truth: "For you" only (nothing connected/imported). */
export const DEFAULT_FEED_MODE_AVAILABILITY: FeedModeAvailability = {
  following: false,
  byof: false,
};

/** The default feed mode (the WebFlix-ranked discovery orientation). */
export const DEFAULT_FEED_MODE: FeedMode = "foryou";

/**
 * Derive the effective availability of EVERY mode from the adapter's
 * truth (pure): "For you" is always available; Hybrid needs at least one
 * non-default source; Following/BYOF mirror their own truth.
 */
export function effectiveFeedModeAvailability(
  availability: FeedModeAvailability,
): Readonly<Record<FeedMode, boolean>> {
  const hybrid = availability.following || availability.byof;
  return { foryou: true, following: availability.following, byof: availability.byof, hybrid };
}

// ---------------------------------------------------------------------------
// The typed set result (failure + recovery hint — never a silent no-op)
// ---------------------------------------------------------------------------

/** Why a feed-mode set was refused (the typed failure vocabulary). */
export type FeedModeSetFailureKind = "unavailable";

/** One typed feed-mode set failure + its recovery hint. */
export interface FeedModeSetFailure {
  readonly kind: FeedModeSetFailureKind;
  /** The mode that was refused. */
  readonly mode: FeedMode;
  /** The honest detail (why the mode cannot be honored right now). */
  readonly detail: string;
  /**
   * The recovery hint — the next action the surface offers (the
   * "unsupported is not undiscoverable" law).
   */
  readonly recoveryHint: string;
}

/** The result of one feed-mode set (typed refusal, never silent). */
export type FeedModeSetResult =
  | { readonly ok: true; readonly mode: FeedMode }
  | { readonly ok: false; readonly failure: FeedModeSetFailure };

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** Listener for feed-mode selection changes. */
export type FeedModeListener = (mode: FeedMode) => void;

/**
 * The feed-mode operations the runtime exposes (surfaces consume through
 * `runtime.feedMode` — the ADD-ONLY R21-A wiring).
 */
export interface FeedModeOperations {
  /** The currently selected mode (defaults to "foryou"). */
  get(): FeedMode;
  /**
   * Select a mode. A non-vocabulary mode throws the typed
   * `RuntimeError`; an unavailable mode answers the typed
   * `unavailable` failure WITH its recovery hint (never a silent
   * success/no-op).
   */
  set(mode: FeedMode): FeedModeSetResult;
  /** The adapter-reported availability truth (default: "For you" only). */
  availability(): FeedModeAvailability;
  /**
   * The adapter reports fresh availability truth (following/import
   * existence changed). Report-only: an already-selected mode that
   * becomes unavailable STAYS selected (the session's choice is not
   * silently reverted — the view renders its honest state; the next
   * `set` of that mode is refused until truth returns).
   */
  setAvailability(availability: FeedModeAvailability): void;
  /** Subscribe to mode-selection changes. */
  subscribe(listener: FeedModeListener): Unsubscribe;
}

/**
 * Create the feed-mode store (pure presentation state; no I/O). Created
 * by `createRuntime`; usable standalone in tests.
 */
export function createFeedModeStore(): FeedModeOperations {
  let current: FeedMode = DEFAULT_FEED_MODE;
  let truth: FeedModeAvailability = DEFAULT_FEED_MODE_AVAILABILITY;
  const listeners = new Set<FeedModeListener>();

  function emit(): void {
    for (const listener of listeners) listener(current);
  }

  function unavailableFailure(mode: FeedMode): FeedModeSetFailure {
    const detail =
      mode === "following"
        ? "the Following mode needs someone you follow first"
        : mode === "byof"
          ? "the imported-feed mode needs an imported feed first"
          : "the Blend mode needs a followed account or an imported feed first";
    const recoveryHint =
      mode === "following"
        ? "Follow a creator from any title or connect a source with following."
        : mode === "byof"
          ? "Bring your feed to import your existing subscriptions."
          : "Bring your feed or follow a creator to blend relationships with discovery.";
    return { kind: "unavailable", mode, detail, recoveryHint };
  }

  return {
    get: () => current,

    set(mode: FeedMode): FeedModeSetResult {
      if (!isFeedMode(mode)) {
        throw new RuntimeError(
          "invalid-input",
          `feedMode.set: expected one of ${FEED_MODES.map((m) => FEED_MODE_LABELS[m]).join(" | ")}, got ${JSON.stringify(mode)}`,
        );
      }
      const effective = effectiveFeedModeAvailability(truth);
      if (!effective[mode]) {
        // The typed refusal with the recovery hint — the surface renders
        // the next action; the mode is never silently selected.
        return { ok: false, failure: unavailableFailure(mode) };
      }
      const previous = current;
      current = mode;
      if (previous !== mode) emit();
      return { ok: true, mode };
    },

    availability: () => truth,

    setAvailability(availability: FeedModeAvailability): void {
      if (
        typeof availability?.following !== "boolean" ||
        typeof availability?.byof !== "boolean"
      ) {
        throw new RuntimeError(
          "invalid-input",
          "feedMode.setAvailability: expected { following: boolean, byof: boolean }",
        );
      }
      truth = { following: availability.following, byof: availability.byof };
    },

    subscribe(listener: FeedModeListener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
