/**
 * @wfx/client-runtime — the anonymous playback boundary (R23-B).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-open-viewing-torrent-ai-plan.md — R23-B): playback
 * and read authorization is checked PER CAPABILITY, never globally.
 *
 * THE AUDIT THIS MODULE RECORDS: the R01-R22 runtime playback/read paths
 * (`resolveRealizations` / `resolvePlaybackSession` / the navigation
 * state machine / the read models) were inspected at the R23 baseline
 * (d3f5e23) and contain NO global authentication gate — there is no
 * login wall to remove. What the paths lacked is the TYPED AUTHORIZATION
 * BOUNDARY this module now freezes: the single decision table every
 * playback/read path consults, so "authorization" can never silently
 * become "WebFlix account" again.
 *
 * THE FOUR INVARIANTS (machine-checkable, all tested):
 *
 * 1. ANONYMOUS + PUBLIC REALIZATION => PLAYBACK MAY START. The decision
 *    table {@link authorizePlaybackStart} answers `playback-may-start`
 *    for every public realization regardless of viewer session.
 * 2. ANONYMOUS => REDIRECT TO LOGIN IS FORBIDDEN. For PLAYBACK
 *    authorization specifically the law is absolute:
 *    {@link isLoginRedirectLawfulForPlayback} is `false` for EVERY
 *    playback decision — a public realization needs no login, and a
 *    provider-authorization gap needs the provider's own authorization,
 *    which a WebFlix login NEVER satisfies. There is no third playback
 *    outcome that could lawfully route to a WebFlix sign-in.
 * 3. PROVIDER/CONNECTOR AUTHORIZATION STAYS INDEPENDENT FROM WEBFLIX
 *    ACCOUNT AUTHENTICATION. The decision derivation structurally NEVER
 *    consults the viewer's WebFlix session: `viewer` rides the query for
 *    OBSERVABILITY (the decision view names who asked) but no branch of
 *    the decision table reads it — and the tests assert anonymous and
 *    authenticated queries produce IDENTICAL decisions.
 * 4. ANONYMOUS PROGRESS MAY EXIST AS SESSION-SCOPED/LOCAL STATE BUT MUST
 *    NEVER BE REPRESENTED AS DURABLE CROSS-DEVICE IDENTITY UNTIL
 *    AUTHENTICATION. {@link progressScopeFor} types the scope;
 *    {@link mayRepresentAsDurableIdentity} refuses it for anonymous
 *    viewers; {@link promoteSessionProgressToDurable} is the ONLY lawful
 *    promotion — and it refuses while the viewer is anonymous.
 *
 * WHAT THIS MODULE IS: PURE derivations + typed data (the control-views
 * law). No fetching, no clock, no ids, no UI. The boundary consumes the
 * R23-A vocabulary (`RealizationAccessClass`, `ViewerSessionKind`,
 * `ProviderAuthorizationFact`) and the R03 observed source truth
 * (`SourceInfo`) — it never invents authorization state.
 *
 * WHAT THIS MODULE IS NOT: a session store, a playback engine, or an
 * authentication mechanism. The watch-state engine stays the owner of
 * event folding; the playback controller stays the owner of session
 * lifecycle; this boundary only answers "may THIS playback start, and
 * what is the honest missing piece when it may not".
 */

import type { PlaybackMode, WatchStateCommand } from "@wfx/domain";

import type { SourceInfo } from "./server-port";
import type {
  AnonymousViewingCapabilityId,
  ProviderAuthorizationFact,
  RealizationAccessClass,
  ViewerSessionKind,
} from "./anonymous-viewing";
import { isViewerSessionKind } from "./anonymous-viewing";

// ---------------------------------------------------------------------------
// The boundary realization (the per-realization authorization facts)
// ---------------------------------------------------------------------------

/**
 * The realization facts the boundary needs — deliberately narrower than
 * the frozen `PlaybackRealization`: authorization depends on the MODE
 * (which per-capability row applies), the ACCESS CLASS (what the
 * realization requires), and the CONNECTOR (whose authorization would
 * satisfy it). Nothing else about a realization affects authorization.
 */
export interface PlaybackBoundaryRealization {
  /** The frozen playback mode (native / embed / browser / external). */
  readonly mode: PlaybackMode;
  /**
   * What this realization requires: `"public"` or
   * `"provider-authorization-required"` (the R23-A vocabulary — what the
   * realization REQUIRES, independent of any viewer).
   */
  readonly accessClass: RealizationAccessClass;
  /**
   * The connector the realization plays through (whose own authorization
   * would satisfy a provider-authorization requirement); absent for
   * unattributed public realizations.
   */
  readonly connectorId?: string;
}

/**
 * The query the boundary resolves: WHO is asking (viewer — observability
 * only, never a decision input), WHAT would play, and the CURRENT
 * provider-authorization truth for its connector.
 */
export interface PlaybackAuthorizationQuery {
  /** The viewer's WebFlix session state (observability — never consulted). */
  readonly viewer: ViewerSessionKind;
  /** The realization playback would start. */
  readonly realization: PlaybackBoundaryRealization;
  /**
   * The provider's OWN authorization truth for the realization's
   * connector (the observed `authState === "signedIn"` fold — see
   * {@link providerAuthorizationOf}). For public realizations this is
   * irrelevant (a public realization may not start being gated on it);
   * for provider-authorization-required realizations it is decisive.
   */
  readonly providerAuthorized: boolean;
}

// ---------------------------------------------------------------------------
// The decision (the per-capability authorization table)
// ---------------------------------------------------------------------------

/**
 * The outcome of one playback authorization check. TWO kinds only — by
 * construction there is NO outcome that could lawfully route playback to
 * a WebFlix login (the no-login-wall law for playback authorization):
 *
 * - `"playback-may-start"` — authorization is satisfied: the realization
 *   is public, or its provider's own authorization is active.
 * - `"provider-authorization-required"` — the honest missing piece is
 *   the provider's OWN authorization for the realization's connector.
 */
export type PlaybackAuthorizationDecision =
  | {
      /** Authorization satisfied — playback may start. */
      kind: "playback-may-start";
      /** The per-capability row that authorized this (the R23-A matrix id). */
      readonly capability: AnonymousViewingCapabilityId;
      /** The honest one-sentence truth of the authorization. */
      readonly detail: string;
    }
  | {
      /** The provider's own authorization is the missing piece. */
      kind: "provider-authorization-required";
      /** The connector whose authorization is missing ("the source" when unattributed). */
      readonly connectorId: string;
      /** The typed next action (authorize with the provider — never a WebFlix login). */
      readonly action: {
        readonly kind: "provider-authorization";
        readonly label: string;
        readonly detail: string;
      };
      /** The honest one-sentence truth of the gap. */
      readonly detail: string;
    };

/**
 * THE PER-CAPABILITY AUTHORIZATION DECISION TABLE (pure; the single
 * derivation every playback path consults):
 *
 * | accessClass                    | providerAuthorized | decision                          |
 * |--------------------------------|--------------------|-----------------------------------|
 * | public                         | (irrelevant)       | playback-may-start                |
 * | provider-authorization-required | true              | playback-may-start                |
 * | provider-authorization-required | false             | provider-authorization-required  |
 *
 * THE VIEWER COLUMN DOES NOT EXIST. The table never reads
 * `query.viewer` — WebFlix account state is not an authorization input
 * for playback (invariant 3). The tests assert decision-identity across
 * anonymous/authenticated queries; the law is structural.
 */
export function authorizePlaybackStart(
  query: PlaybackAuthorizationQuery,
): PlaybackAuthorizationDecision {
  const { realization } = query;
  const capability = playbackCapabilityFor(
    realization.mode,
    realization.accessClass,
  );
  switch (realization.accessClass) {
    case "public":
      // Invariant 1: anonymous + public => playback may start. Public
      // realizations authorize for EVERY viewer; the provider's own
      // authorization state (whatever it is) never gates them.
      return {
        kind: "playback-may-start",
        capability,
        detail:
          "This way of watching is public — playback can start for anyone, no account and no source sign-in needed.",
      };
    case "provider-authorization-required":
      if (query.providerAuthorized) {
        return {
          kind: "playback-may-start",
          capability,
          detail:
            "This source's own sign-in is active — playback can start (with or without a WebFlix account).",
        };
      }
      return {
        kind: "provider-authorization-required",
        connectorId: realization.connectorId ?? "the source",
        action: {
          kind: "provider-authorization",
          label: "Authorize with this source",
          detail:
            "This way of watching needs the source's own sign-in — that is the source's requirement, not a WebFlix account.",
        },
        detail: `The source '${realization.connectorId ?? "the source"}' requires its own authorization before this playback can start.`,
      };
  }
}

/**
 * The R23-A matrix row one playback authorization consults — the
 * per-CAPABILITY check (each mode × access class maps to exactly one
 * matrix row; no mode is special-cased into a global gate):
 * - public realization: the mode's own public-play matrix row
 *   (`play-public-embed` / `play-public-browser` / `play-public-external`
 *   / `play-public-native-compatible` — all anonymous-class);
 * - provider-authorization-required realization: the
 *   `play-provider-authorized-realization` row (provider-authorized
 *   class), for every mode.
 */
export function playbackCapabilityFor(
  mode: PlaybackMode,
  accessClass: RealizationAccessClass,
): AnonymousViewingCapabilityId {
  if (accessClass === "provider-authorization-required") {
    return "play-provider-authorized-realization";
  }
  switch (mode) {
    case "native":
      return "play-public-native-compatible";
    case "embed":
      return "play-public-embed";
    case "browser":
      return "play-public-browser";
    case "external":
      return "play-public-external";
  }
}

// ---------------------------------------------------------------------------
// The no-login-wall law for playback authorization (invariant 2)
// ---------------------------------------------------------------------------

/**
 * THE FORBIDDEN INVARIANT, sharp end: may a playback authorization
 * outcome EVER be answered with a WebFlix login redirect? NO — always.
 *
 * - A `playback-may-start` decision has nothing to authorize (no login
 *   could be relevant).
 * - A `provider-authorization-required` decision needs the PROVIDER's
 *   own authorization; presenting a WebFlix login instead conflates the
 *   two auth classes (the independence law).
 *
 * There is no playback decision for which a WebFlix login redirect is
 * lawful. The anonymous case is the J37 forbidden invariant
 * ("anonymous => redirect to login is FORBIDDEN"); the authenticated
 * case is equally forbidden — an authenticated viewer missing provider
 * authorization needs the provider authorization, not another login.
 */
export function isLoginRedirectLawfulForPlayback(
  decision: PlaybackAuthorizationDecision,
): false {
  switch (decision.kind) {
    case "playback-may-start":
      return false; // nothing is missing — nothing to sign in to
    case "provider-authorization-required":
      return false; // the provider's own sign-in is the missing piece — never a WebFlix login
  }
}

// ---------------------------------------------------------------------------
// Read-path guard (the surfaces an anonymous viewer may open)
// ---------------------------------------------------------------------------

/**
 * May an anonymous viewer OPEN one primary navigation surface? Always
 * YES — the R23-A read-path law frozen as a total function: Home / Watch
 * / Shorts / Search / Library / Settings are all openable without a
 * WebFlix account. Account-scoped SECTIONS inside those surfaces carry
 * the typed sign-in prerequisite (the R23-A matrix); the SURFACE itself
 * never walls the viewer out.
 */
export function mayOpenSurfaceAnonymously(
  _surface:
    | "home"
    | "watch"
    | "shorts"
    | "search"
    | "library"
    | "settings",
): true {
  return true;
}

// ---------------------------------------------------------------------------
// Observed-source derivations (the R03 truth the boundary consumes)
// ---------------------------------------------------------------------------

/**
 * Derive a realization's ACCESS CLASS from the observed source truth
 * (pure; never guesses):
 * - no connector attribution → `"public"` (an unattributed realization
 *   carries no provider-authorization requirement);
 * - the connector's observed `requiresAuthorization` is false →
 *   `"public"` (the source itself declares no authorization needed);
 * - the connector's observed `requiresAuthorization` is true →
 *   `"provider-authorization-required"`;
 * - connector not in the observed rows → `"public"` with the honest
 *   caveat that the runtime only classifies from OBSERVED rows — the
 *   server-side resolve answer's own availability remains the deeper
 *   truth (never fabricated here).
 */
export function realizationAccessClass(
  realization: { readonly connectorId?: string },
  sources: readonly SourceInfo[],
): RealizationAccessClass {
  const connectorId = realization.connectorId;
  if (connectorId === undefined || connectorId.length === 0) {
    return "public";
  }
  const source = sources.find((row) => row.connectorId === connectorId);
  if (source === undefined) {
    return "public";
  }
  return source.requiresAuthorization
    ? "provider-authorization-required"
    : "public";
}

/**
 * The provider's OWN authorization truth for one connector, folded from
 * the observed source rows: active iff `authState === "signedIn"` (an
 * in-flight `authorizing` is NOT yet authorized; `expired`/`failed`/
 * `signedOut` are not). Unknown connectors are not authorized.
 */
export function providerAuthorizationOf(
  connectorId: string,
  sources: readonly SourceInfo[],
): boolean {
  const source = sources.find((row) => row.connectorId === connectorId);
  return source !== undefined && source.authState === "signedIn";
}

/**
 * Fold the observed source rows into the R23-A provider-authorization
 * facts (the `AnonymousViewingSession` input): one fact per source,
 * `authorized` iff the provider's own authorization is active.
 */
export function providerAuthorizationFacts(
  sources: readonly SourceInfo[],
): readonly ProviderAuthorizationFact[] {
  return sources.map((source) => ({
    connectorId: source.connectorId,
    authorized: source.authState === "signedIn",
  }));
}

// ---------------------------------------------------------------------------
// The anonymous progress scope law (invariant 4)
// ---------------------------------------------------------------------------

/**
 * Where one viewer's watch progress durably lives:
 * - `"session-local"` — anonymous progress: alive within the session,
 *   never cross-device, never account identity;
 * - `"durable-cross-device"` — authenticated progress: the server-side
 *   profile fold (cross-device continuity).
 */
export type ViewerProgressScope = "session-local" | "durable-cross-device";

/** Every value of {@link ViewerProgressScope}. */
export const VIEWER_PROGRESS_SCOPES: readonly ViewerProgressScope[] = [
  "session-local",
  "durable-cross-device",
] as const;

/** Runtime membership check against the progress-scope union. */
export function isViewerProgressScope(x: unknown): x is ViewerProgressScope {
  return (
    typeof x === "string" &&
    (VIEWER_PROGRESS_SCOPES as readonly string[]).includes(x)
  );
}

/**
 * The progress scope for one viewer session (pure; the single derivation
 * source): anonymous → session-local; authenticated →
 * durable-cross-device. Anonymous progress is HONEST session state —
 * never represented as durable identity.
 */
export function progressScopeFor(
  viewer: ViewerSessionKind,
): ViewerProgressScope {
  return viewer === "anonymous" ? "session-local" : "durable-cross-device";
}

/**
 * May progress for this viewer be REPRESENTED as durable cross-device
 * identity (history entries, cross-device resume claims, profile
 * statistics)? Only after authentication — the invariant-4 guard.
 */
export function mayRepresentAsDurableIdentity(viewer: ViewerSessionKind): boolean {
  return viewer === "authenticated";
}

/**
 * One session-scoped progress record — the typed shape anonymous watch
 * state takes. `scope` is pinned to `"session-local"` (the shape itself
 * carries the law); durable progress is the watch-state engine's own
 * domain, never this record.
 */
export interface SessionScopedProgress {
  /** Always `"session-local"` — the shape IS the scope law. */
  readonly scope: "session-local";
  /** The anonymous session the progress belongs to. */
  readonly sessionId: string;
  /** The canonical item the progress is for. */
  readonly itemId: string;
  /** Last position evidence in milliseconds (>= 0). */
  readonly positionMs: number;
  /** Full ISO 8601 timestamp of the last progress evidence. */
  readonly updatedAt: string;
}

/** Structural guard for a claimed session-scoped progress record. */
export function isSessionScopedProgress(
  x: unknown,
): x is SessionScopedProgress {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  if (record.scope !== "session-local") return false;
  if (typeof record.sessionId !== "string" || record.sessionId.length === 0) {
    return false;
  }
  if (typeof record.itemId !== "string" || record.itemId.length === 0) {
    return false;
  }
  if (
    typeof record.positionMs !== "number" ||
    !Number.isFinite(record.positionMs) ||
    record.positionMs < 0
  ) {
    return false;
  }
  return typeof record.updatedAt === "string" && record.updatedAt.length > 0;
}

/** Construct one session-scoped progress record (validates honestly). */
export function sessionScopedProgress(input: {
  readonly sessionId: string;
  readonly itemId: string;
  readonly positionMs: number;
  readonly updatedAt: string;
}): SessionScopedProgress {
  if (input.sessionId.length === 0) {
    throw new Error("sessionScopedProgress: sessionId must be non-empty");
  }
  if (input.itemId.length === 0) {
    throw new Error("sessionScopedProgress: itemId must be non-empty");
  }
  if (
    !Number.isFinite(input.positionMs) ||
    input.positionMs < 0
  ) {
    throw new Error("sessionScopedProgress: positionMs must be >= 0 and finite");
  }
  if (input.updatedAt.length === 0) {
    throw new Error("sessionScopedProgress: updatedAt must be non-empty");
  }
  return { scope: "session-local", ...input };
}

/**
 * THE ONLY LAWFUL PROMOTION of session-scoped progress into the durable
 * stream — and it REFUSES while the viewer is anonymous (invariant 4:
 * anonymous progress is never durable identity until authentication).
 *
 * When the viewer HAS authenticated, the promotion is the watch-state
 * engine's own `start` command (resume at the last session position) —
 * the durable fold stays the engine's domain; this typed bridge only
 * proves the promotion crosses at the right boundary.
 */
export type ProgressPromotionOutcome =
  | {
      /** Promoted: the durable `start` command carrying the session position. */
      kind: "promoted";
      readonly command: WatchStateCommand;
    }
  | {
      /** Refused: the viewer is anonymous — progress stays session-local. */
      kind: "refused";
      readonly reason: string;
    };

/** Promote session-scoped progress to durable identity (or refuse honestly). */
export function promoteSessionProgressToDurable(
  progress: SessionScopedProgress,
  viewer: ViewerSessionKind,
): ProgressPromotionOutcome {
  if (!isViewerSessionKind(viewer)) {
    throw new Error(
      `promoteSessionProgressToDurable: unknown viewer session kind '${String(viewer)}'`,
    );
  }
  if (viewer === "anonymous") {
    return {
      kind: "refused",
      reason:
        "anonymous progress stays session-scoped — it becomes durable identity only after authentication",
    };
  }
  return {
    kind: "promoted",
    command: {
      kind: "start",
      itemId: progress.itemId,
      positionMs: progress.positionMs,
      playbackSessionId: progress.sessionId,
    },
  };
}
