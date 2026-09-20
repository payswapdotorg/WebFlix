/**
 * @wfx/app-web — the anonymous-playback truth binding (R23 web-A).
 *
 * THE LAW THIS MODULE BINDS (docs/plans/
 * 2026-09-20-webflix-open-viewing-torrent-ai-plan.md — R23-A/R23-B;
 * Worker 1's frozen contracts in `@wfx/client-runtime`, consumed
 * verbatim — never forked): watching PUBLIC content in WebFlix requires
 * NO WebFlix account. The web surfaces render:
 *
 * - the typed PER-REALIZATION access truth (public plays for everyone;
 *   a provider's OWN sign-in requirement is the PROVIDER's truth,
 *   rendered distinctly from any WebFlix-account truth);
 * - the typed SESSION-SCOPED PROGRESS truth for anonymous viewers
 *   (`progressScopeFor`: "session-local" — kept for this session on
 *   this device, never represented as durable cross-device identity);
 * - the lawful POST-AUTHENTICATION PROMOTION
 *   (`promoteSessionProgressToDurable`): when a viewer signs in, the
 *   anonymous session's positions are promoted into the identity's
 *   watch-state `start` commands — the one lawful durable write.
 *
 * WHAT THIS MODULE IS NOT: a second authorization derivation. Every
 * decision comes from the frozen shared contracts; this module only
 * reads the sources fold + the session state and projects the views the
 * Web surfaces render. No redirect logic lives here — no public-watch
 * route may redirect to login merely because the viewer is anonymous
 * (`forbidsAnonymousLoginRedirect` keeps the law machine-checkable).
 */

import {
  authorizePlaybackStart,
  forbidsAnonymousLoginRedirect,
  isLawfulLoginRedirect,
  progressScopeFor,
  promoteSessionProgressToDurable,
  providerAuthorizationOf,
  realizationAccessClass,
  sessionScopedProgress,
} from "@wfx/client-runtime";
import type {
  PlaybackAuthorizationDecision,
  ProviderAuthorizationFact,
  RealizationAccessClass,
  SessionScopedProgress,
  ViewerProgressScope,
  ViewerSessionKind,
} from "@wfx/client-runtime";
import type { PlaybackMode } from "@wfx/domain";
import type { SourceInfo } from "@wfx/client-runtime";

// ---------------------------------------------------------------------------
// The viewer fold (session state → the shared viewer vocabulary)
// ---------------------------------------------------------------------------

/** Fold the web session state onto the shared viewer vocabulary. (Pure.) */
export function viewerKindOf(session: {
  readonly signedIn: boolean;
}): ViewerSessionKind {
  return session.signedIn ? "authenticated" : "anonymous";
}

// ---------------------------------------------------------------------------
// The provider-authorization facts (the observed sources fold)
// ---------------------------------------------------------------------------

/**
 * The observed provider-authorization facts of the current sources read
 * (Worker 1's fold: `authState === "signedIn"`). Typed transport
 * failures answer the honest EMPTY fact list — never a fabricated
 * authorization.
 */
export function providerAuthFactsOf(
  sources: readonly SourceInfo[],
): readonly ProviderAuthorizationFact[] {
  return sources.map((source) => ({
    connectorId: source.connectorId,
    authorized: providerAuthorizationOf(source.connectorId, sources),
  }));
}

// ---------------------------------------------------------------------------
// The per-realization playback truth (the R23-B boundary, consumed)
// ---------------------------------------------------------------------------

/** One way-to-watch's typed access truth (the rendered vocabulary). */
export interface RealizationAccessTruth {
  /** The R23-A access class of the realization. */
  readonly accessClass: RealizationAccessClass;
  /**
   * The typed R23-B decision for starting playback through this
   * realization (never consults the viewer — see the frozen boundary).
   */
  readonly playbackDecision: PlaybackAuthorizationDecision;
  /**
   * The one-sentence USER truth (rendered verbatim by the surfaces):
   * public realizations name their openness; provider-gated realizations
   * name the SOURCE's own sign-in as the requirement — never a WebFlix
   * account.
   */
  readonly sentence: string;
}

/**
 * Derive one realization's access truth: the R23-B boundary decision
 * over the realization's access class + the connector's observed
 * authorization. (Pure; the single derivation the surfaces render.)
 */
export function realizationAccessTruth(input: {
  readonly viewer: ViewerSessionKind;
  readonly mode: PlaybackMode;
  readonly connectorId: string;
  readonly sources: readonly SourceInfo[];
}): RealizationAccessTruth {
  const accessClass = realizationAccessClass(
    { connectorId: input.connectorId },
    input.sources,
  );
  const providerAuthorized = providerAuthorizationOf(
    input.connectorId,
    input.sources,
  );
  const decision = authorizePlaybackStart({
    viewer: input.viewer,
    realization: {
      mode: input.mode,
      accessClass,
      connectorId: input.connectorId,
    },
    providerAuthorized,
  });
  const sentence =
    decision.kind === "playback-may-start"
      ? accessClass === "public"
        ? "Public — plays for everyone, no account needed."
        : "This source's own sign-in is active, so playback works without a WebFlix account."
      : `Needs ${input.connectorId}'s own sign-in — the source's requirement, not a WebFlix account.`;
  return { accessClass, playbackDecision: decision, sentence };
}

// ---------------------------------------------------------------------------
// The session-scoped progress truth (the R23-B scope law, rendered)
// ---------------------------------------------------------------------------

/** The rendered progress-scope truth of the current viewer. (Pure.) */
export interface ProgressScopeTruth {
  /** The shared scope vocabulary ("session-local" | "durable-cross-device"). */
  readonly scope: ViewerProgressScope;
  /** The one-sentence user truth about where progress is kept. */
  readonly sentence: string;
  /** Whether signing in is offered as the OPTIONAL durable upgrade. */
  readonly offersSignInUpgrade: boolean;
}

/**
 * Derive the progress-scope truth for a viewer: anonymous progress is
 * SESSION-LOCAL (kept for this session on this device) with sign-in as
 * an optional upgrade — never a wall; authenticated progress is durable
 * cross-device. (Pure; consumes `progressScopeFor` verbatim.)
 */
export function progressScopeTruthOf(
  viewer: ViewerSessionKind,
): ProgressScopeTruth {
  const scope = progressScopeFor(viewer);
  if (scope === "durable-cross-device") {
    return {
      scope,
      sentence:
        "Your place is kept with your account — it follows you on every device.",
      offersSignInUpgrade: false,
    };
  }
  return {
    scope,
    sentence:
      "Watching without an account — your place is kept for this session on this device. Sign in any time to keep it everywhere; playback itself never requires it.",
    offersSignInUpgrade: true,
  };
}

/** Build one session-scoped progress record (the shared shape). (Pure.) */
export function anonymousProgressRecord(input: {
  readonly sessionId: string;
  readonly itemId: string;
  readonly positionMs: number;
  readonly updatedAt: string;
}): SessionScopedProgress {
  return sessionScopedProgress(input);
}

/**
 * THE LAWFUL POST-AUTHENTICATION PROMOTION: promote one anonymous
 * session position into the durable watch-state start command (the
 * shared typed outcome; the login flow maps it onto the identity
 * runtime's `start` command — the one lawful durable write).
 */
export function promoteAnonymousProgress(input: {
  readonly sessionId: string;
  readonly itemId: string;
  readonly positionMs: number;
  readonly updatedAt: string;
}): ReturnType<typeof promoteSessionProgressToDurable> {
  return promoteSessionProgressToDurable(
    anonymousProgressRecord(input),
    "authenticated",
  );
}

// ---------------------------------------------------------------------------
// The no-login-wall law (machine-checkable, re-exported for the tests)
// ---------------------------------------------------------------------------

export {
  /** The J37 forbidden invariant: a blanket anonymous login redirect. */
  forbidsAnonymousLoginRedirect,
  /** The lawful-reason check (intent-following destinations only). */
  isLawfulLoginRedirect,
};
