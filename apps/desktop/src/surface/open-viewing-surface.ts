/**
 * @wfx/app-desktop — the open-viewing surface (R23-W3, the R23-A/B Desktop
 * semantics).
 *
 * THE LAW THIS SURFACE PROJECTS (the plan's R23-A/R23-B, mirrored on
 * Desktop): public viewing is ACCOUNLESS —
 *
 * - ANONYMOUS viewers open the public surfaces (Home / Watch / Shorts /
 *   Search / item details / the player), play PUBLIC realizations, and
 *   watch continuously within their session — NO login wall may appear
 *   solely because the viewer lacks a WebFlix account;
 * - PROVIDER-AUTH vs WEBFLIX-ACCOUNT truth stays DISTINCT: a provider's
 *   own sign-in requirement is never satisfied (nor replaced) by a
 *   WebFlix login, and a WebFlix account never removes accountless
 *   viewing (the independence law);
 * - ANONYMOUS PROGRESS is SESSION-SCOPED: it lives in the session, never
 *   represented as durable cross-device identity until the viewer
 *   authenticates (the typed refusal); the lawful promotion after
 *   authentication is the watch-state engine's own `start` command;
 * - the AUTHENTICATED identity continues to ride the OS-keychain session
 *   law (R22-H's `createShellAuthSessionStore` — unchanged; this surface
 *   consumes the viewer truth, it never owns credential storage).
 *
 * WHAT THIS MODULE IS: the thin Desktop projection of Worker 1's frozen
 * R23-A/B contracts — `anonymousViewingView`, `resolveCapabilityAccess`,
 * `authorizePlaybackStart`, `mayOpenSurfaceAnonymously`,
 * `sessionScopedProgress`, `promoteSessionProgressToDurable` — bound to
 * the Desktop composition's own viewer truth. ZERO new product policy.
 *
 * WHAT THIS MODULE IS NOT: an auth store (the first-run surface + the OS
 * keychain own identity), a playback system (the runtime owns playback),
 * or a sources surface (the runtime's source-state store owns observed
 * source truth — this surface only folds it into the session facts).
 */

import type { ClientRuntime } from "@wfx/client-runtime";
import {
  anonymousViewingView,
  authorizePlaybackStart,
  forbidsAnonymousLoginRedirect,
  isLawfulLoginRedirect,
  mayOpenSurfaceAnonymously,
  progressScopeFor,
  promoteSessionProgressToDurable,
  providerAuthorizationFacts,
  realizationAccessClass,
  resolveCapabilityAccess,
  sessionScopedProgress,
  type AnonymousCapabilityAccessView,
  type AnonymousViewingSession,
  type AnonymousViewingView,
  type PlaybackAuthorizationDecision,
  type LoginRedirectReason,
  type ProgressPromotionOutcome,
  type RealizationAccessClass,
  type SessionScopedProgress,
  type ViewerProgressScope,
  type ViewerSessionKind,
} from "@wfx/client-runtime";
import type { PlaybackMode } from "@wfx/domain";

// ---------------------------------------------------------------------------
// The viewer truth seam (the composition's own derivation)
// ---------------------------------------------------------------------------

/**
 * The composition's viewer-session derivation: authenticated iff a
 * VERIFIED WebFlix session is active (the R22-H keychain law — the
 * first-run surface's own truth), anonymous otherwise. The surface never
 * guesses: the composition binds this seam from its real session state.
 */
export type DesktopViewerSessionOf = () => AnonymousViewingSession;

// ---------------------------------------------------------------------------
// The view shapes
// ---------------------------------------------------------------------------

/** One public surface's openness truth (the J37 walk's per-surface check). */
export interface DesktopSurfaceOpennessView {
  readonly surface: "home" | "watch" | "shorts" | "search" | "library" | "settings";
  /** Whether the surface opens without any WebFlix account (the frozen law). */
  readonly openAnonymously: boolean;
  /** The honest one-sentence note (the account surfaces' prerequisite truth). */
  readonly note: string;
}

/** The open-viewing view (the R23-A matrix + the J37 surface truths). */
export interface DesktopOpenViewingView {
  readonly viewer: ViewerSessionKind;
  /** The progress scope law's answer for this viewer. */
  readonly progressScope: ViewerProgressScope;
  /** Every R23-A matrix row with its access resolution (frozen order). */
  readonly rows: readonly AnonymousCapabilityAccessView[];
  /** The public surfaces' openness truths (the J37 walk). */
  readonly surfaces: readonly DesktopSurfaceOpennessView[];
  /** The honest account note (the distinct-truths law, one sentence). */
  readonly accountNote: string;
}

/** One playback authorization question (the surface's typed input). */
export interface DesktopPlaybackAuthorizationQuery {
  /** The realization playback would start. */
  readonly realization: {
    readonly mode: PlaybackMode;
    readonly connectorId?: string;
    /** The access class (the runtime's observed-source derivation — or "public" for the peer copy). */
    readonly accessClass: RealizationAccessClass;
  };
}

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

/** Options for {@link createDesktopOpenViewingSurface}. */
export interface DesktopOpenViewingOptions {
  /** The shared client runtime (the observed source truth + the watch state). */
  readonly runtime: ClientRuntime;
  /** The composition's viewer-session derivation (the R22-H keychain truth). */
  readonly viewerSessionOf: DesktopViewerSessionOf;
  /** The session id the session-scoped progress records against. */
  readonly sessionIdOf: () => string;
  /** The clock stamp for progress records (ISO 8601). */
  readonly nowOf: () => string;
}

/** The Desktop open-viewing surface (the R23-A/B projection). */
export interface DesktopOpenViewingSurface {
  /**
   * The R23-A matrix view for the CURRENT viewer session: every capability
   * row's access resolution + the public surfaces' openness + the progress
   * scope law. The J37 surfaces render THIS view.
   */
  viewingView(): DesktopOpenViewingView;
  /**
   * One capability's access for the current viewer (the frozen
   * `resolveCapabilityAccess` — the typed prerequisite, never a wall).
   */
  capabilityAccess(capability: Parameters<typeof resolveCapabilityAccess>[0]): AnonymousCapabilityAccessView;
  /**
   * One public surface's openness (the frozen
   * `mayOpenSurfaceAnonymously` law + the honest note).
   */
  surfaceOpenness(surface: DesktopSurfaceOpennessView["surface"]): DesktopSurfaceOpennessView;
  /**
   * THE PLAYBACK AUTHORIZATION (the R23-B boundary, the no-login-wall
   * law): the per-capability decision for one realization under the
   * current viewer + the observed provider truths. TWO outcomes only —
   * there is no lawful WebFlix-login answer for any playback decision.
   */
  playbackAuthorization(query: DesktopPlaybackAuthorizationQuery): PlaybackAuthorizationDecision;
  /**
   * The observed-source access-class derivation for a provider
   * realization (the runtime's own `realizationAccessClass` — the honest
   * observed truth, never a guess).
   */
  realizationAccess(realization: { readonly connectorId?: string }): RealizationAccessClass;
  /**
   * THE NO-LOGIN-WALL CHECK (machine-checkable, the J37 core): may a
   * route redirect THIS viewer to login for `capability` under `reason`?
   * The frozen law's answer — anonymous viewers on public-watch
   * capabilities are never walled.
   */
  loginRedirectLawful(
    capability: Parameters<typeof isLawfulLoginRedirect>[0],
    reason: LoginRedirectReason,
  ): boolean;
  /**
   * Record ONE session-scoped progress evidence (the anonymous watch
   * state's typed shape). Anonymous progress lives in the session; the
   * shape itself carries the law (`scope: "session-local"`).
   */
  recordSessionProgress(input: {
    readonly itemId: string;
    readonly positionMs: number;
  }): SessionScopedProgress;
  /**
   * THE ONLY LAWFUL PROMOTION of session progress into the durable
   * stream (the R23-B bridge): refused while anonymous (progress stays
   * session-local — never durable identity until authentication); after
   * authentication the promotion IS the watch-state engine's `start`
   * command. The surface reports the typed outcome — it never performs
   * the durable write itself (the engine owns that fold).
   */
  promoteProgress(progress: SessionScopedProgress): ProgressPromotionOutcome;
}

/**
 * Project the Desktop open-viewing surface. Pure projection over the
 * frozen R23-A/B contracts + the composition's viewer truth — no local
 * policy, no credential storage, no invented prerequisites.
 */
export function createDesktopOpenViewingSurface(
  options: DesktopOpenViewingOptions,
): DesktopOpenViewingSurface {
  const { runtime, viewerSessionOf, sessionIdOf, nowOf } = options;

  const sessionOf = (): AnonymousViewingSession => {
    const session = viewerSessionOf();
    if (session.providerAuthorizations !== undefined) return session;
    // Fold the runtime's observed source truth into the provider facts
    // (the R23-B observed-source fold) when the composition didn't carry
    // its own — the same derivation, one source of truth.
    return {
      viewer: session.viewer,
      providerAuthorizations: providerAuthorizationFacts(runtime.sources.list()),
    };
  };

  const surfaceNote = (
    surface: DesktopSurfaceOpennessView["surface"],
    viewer: ViewerSessionKind,
  ): string => {
    switch (surface) {
      case "library":
        return viewer === "authenticated"
          ? "Your Library keeps its full truth — watchlist, history, and offline copies."
          : "Library opens without an account — this session's titles and any offline copies on this device. Signing in brings your cross-device Library.";
      case "settings":
        return viewer === "authenticated"
          ? "Settings manages your account, sources, feeds, and models."
          : "Settings opens without an account — connecting a source or managing model providers asks you to sign in at that moment, not before.";
      default:
        return "Open without an account — public titles play right away.";
    }
  };

  return {
    viewingView(): DesktopOpenViewingView {
      const session = sessionOf();
      const view: AnonymousViewingView = anonymousViewingView(session);
      const surfaces: readonly DesktopSurfaceOpennessView[] = (
        ["home", "watch", "shorts", "search", "library", "settings"] as const
      ).map((surface) => ({
        surface,
        openAnonymously: mayOpenSurfaceAnonymously(surface),
        note: surfaceNote(surface, session.viewer),
      }));
      return {
        viewer: view.viewer,
        progressScope: progressScopeFor(view.viewer),
        rows: view.rows,
        surfaces,
        accountNote:
          view.viewer === "authenticated"
            ? "You are signed in — your identity, Library, and model policy follow your account. Public titles stay accountless either way."
            : "You are watching without an account — nothing here asks you to sign in just to watch. Signing in brings your Library, feeds, and model settings across devices.",
      };
    },

    capabilityAccess(
      capability: Parameters<typeof resolveCapabilityAccess>[0],
    ): AnonymousCapabilityAccessView {
      const session = sessionOf();
      const row = anonymousViewingView(session).rows.find(
        (candidate) => candidate.entry.capability === capability,
      );
      if (row === undefined) {
        throw new Error(
          `capabilityAccess: unknown capability '${String(capability)}' (the closed vocabulary is ANONYMOUS_VIEWING_CAPABILITY_IDS)`,
        );
      }
      return { entry: row.entry, access: resolveCapabilityAccess(capability, session) };
    },

    surfaceOpenness(surface: DesktopSurfaceOpennessView["surface"]): DesktopSurfaceOpennessView {
      return {
        surface,
        openAnonymously: mayOpenSurfaceAnonymously(surface),
        note: surfaceNote(surface, sessionOf().viewer),
      };
    },

    playbackAuthorization(query: DesktopPlaybackAuthorizationQuery): PlaybackAuthorizationDecision {
      const session = sessionOf();
      const connectorId = query.realization.connectorId;
      const providerAuthorized =
        connectorId !== undefined
          ? (session.providerAuthorizations ?? []).some(
              (fact) => fact.connectorId === connectorId && fact.authorized,
            )
          : false;
      return authorizePlaybackStart({
        viewer: session.viewer,
        providerAuthorized,
        realization: {
          mode: query.realization.mode,
          ...(connectorId !== undefined ? { connectorId } : {}),
          accessClass: query.realization.accessClass,
        },
      });
    },

    realizationAccess(realization: { readonly connectorId?: string }): RealizationAccessClass {
      return realizationAccessClass(realization, runtime.sources.list());
    },

    loginRedirectLawful(
      capability: Parameters<typeof isLawfulLoginRedirect>[0],
      reason: LoginRedirectReason,
    ): boolean {
      const viewer = sessionOf().viewer;
      if (viewer === "anonymous") {
        // The J37 forbidden invariant is the sharp end: an anonymous
        // viewer on a public-watch capability is NEVER walled.
        if (forbidsAnonymousLoginRedirect(capability, viewer, reason)) return false;
      }
      return isLawfulLoginRedirect(capability, reason);
    },

    recordSessionProgress(input: {
      readonly itemId: string;
      readonly positionMs: number;
    }): SessionScopedProgress {
      return sessionScopedProgress({
        sessionId: sessionIdOf(),
        itemId: input.itemId,
        positionMs: input.positionMs,
        updatedAt: nowOf(),
      });
    },

    promoteProgress(progress: SessionScopedProgress): ProgressPromotionOutcome {
      return promoteSessionProgressToDurable(progress, sessionOf().viewer);
    },
  };
}
