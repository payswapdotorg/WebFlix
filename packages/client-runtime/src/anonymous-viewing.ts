/**
 * @wfx/client-runtime — the anonymous viewing capability matrix (R23-A).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-open-viewing-torrent-ai-plan.md — R23-A; the tech-lead
 * handoff's product law: "public viewing is accountless"): watching public
 * content in WebFlix requires NO WebFlix account, exactly like a normal
 * public-video platform. Login is OPTIONAL for public read/play and becomes
 * a prerequisite only where durable identity or an authorization boundary
 * genuinely needs it. A PROVIDER's own source authorization is a SEPARATE
 * truth from a WebFlix account and the two are never conflated.
 *
 * THE THREE AUTH CLASSES (the typed distinction the plan freezes):
 *
 * 1. ANONYMOUS READ/PLAY (`"anonymous"`) — no WebFlix account required:
 *    open Home/Watch/Shorts/Search; open item details; resolve playable
 *    public realizations; play supported public embed/browser/external/
 *    native-compatible realizations; watch continuously within an
 *    anonymous session; use public playback controls; receive platform
 *    capability truth; use non-persistent local interaction where
 *    supported.
 * 2. AUTHENTICATED MUTATION/SYNC (`"webflix-account"`) — login required
 *    only where durable identity or an authorization boundary needs it:
 *    durable cross-device history/watchlist/profile; provider source
 *    connection + BYOF; account-authorized provider actions; BYOM
 *    management; durable recommendation identity; account-scoped model
 *    policy; synchronized social actions where the provider requires it.
 * 3. PROVIDER-AUTHENTICATED PLAYBACK (`"provider-authorized"`) — a
 *    provider may still require ITS OWN source authorization for that
 *    realization. This authorization is INDEPENDENT of WebFlix account
 *    authentication: an anonymous viewer WITH provider authorization may
 *    play; an authenticated viewer WITHOUT it may not — and the honest
 *    missing piece is the provider's authorization, NEVER a WebFlix
 *    sign-in prompt.
 *
 * THE NO-LOGIN-WALL LAW (J37's acceptance core, machine-checkable here):
 * no public-watch route may redirect to login MERELY because the viewer is
 * anonymous. {@link isLawfulLoginRedirect} encodes the complete law: an
 * anonymous-class capability is accountless BY DEFINITION, so ANY login
 * redirect on it is drift; a provider-authorization gap is never satisfied
 * by a WebFlix login; only the explicitly invoked account-capability
 * action (reason `"capability-requires-account"`) may lawfully land on the
 * sign-in destination — as a typed prerequisite, never a global wall.
 *
 * WHAT THIS MODULE IS: the shared capability MATRIX read model the
 * adapters render — PURE data + derivations (the control-views.ts law:
 * plain serializable views; adapters render them, they never re-derive
 * product semantics). No fetching, no clock, no UI. Workers 2/3 (the
 * R23 Web/Desktop surfaces) bind their anonymous-viewing UX to THIS
 * matrix so Web/Desktop cannot diverge in auth semantics; J37's evidence
 * verifies against the same contract.
 *
 * WHAT THIS MODULE IS NOT: a navigation system, a session store, or an
 * authentication mechanism. The runtime's navigation state machine stays
 * the one owner of surface state; the account-creation module stays the
 * owner of the register/sign-in journey; this matrix only answers
 * "which capabilities need which kind of authorization, and what is the
 * honest next action when it is missing".
 */

// ---------------------------------------------------------------------------
// The authentication-class vocabulary (the R23-A three-way distinction)
// ---------------------------------------------------------------------------

/**
 * The authorization class of ONE capability — the frozen three-way
 * distinction between accountless viewing, account-backed mutation/sync,
 * and provider-authorized playback.
 */
export type ViewerAuthClass =
  /** Anonymous read/play — no WebFlix account required. */
  | "anonymous"
  /** Authenticated mutation/sync — a WebFlix account is the honest prerequisite. */
  | "webflix-account"
  /** Provider-authenticated playback — the PROVIDER's own authorization. */
  | "provider-authorized";

/** Every value of {@link ViewerAuthClass}, in plan order. */
export const VIEWER_AUTH_CLASSES: readonly ViewerAuthClass[] = [
  "anonymous",
  "webflix-account",
  "provider-authorized",
] as const;

/** Runtime membership check against the auth-class union. */
export function isViewerAuthClass(x: unknown): x is ViewerAuthClass {
  return (
    typeof x === "string" &&
    (VIEWER_AUTH_CLASSES as readonly string[]).includes(x)
  );
}

/**
 * The viewer's WebFlix SESSION state — and nothing else. This is the ONLY
 * WebFlix-identity input the matrix consumes: the distinction the plan
 * freezes is accountless viewing, so the matrix never needs (and never
 * accepts) profile ids, user ids, or entitlement claims.
 */
export type ViewerSessionKind = "anonymous" | "authenticated";

/** Every value of {@link ViewerSessionKind}. */
export const VIEWER_SESSION_KINDS: readonly ViewerSessionKind[] = [
  "anonymous",
  "authenticated",
] as const;

/** Runtime membership check against the viewer-session union. */
export function isViewerSessionKind(x: unknown): x is ViewerSessionKind {
  return (
    typeof x === "string" &&
    (VIEWER_SESSION_KINDS as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// The capability vocabulary (exactly the plan's R23-A lists)
// ---------------------------------------------------------------------------

/**
 * One capability of the anonymous-viewing matrix. The union is CLOSED and
 * covers EXACTLY the plan's two lists — the anonymous read/play list and
 * the authentication-remains-available list — plus the one
 * provider-authorization row that completes the three-way distinction.
 */
export type AnonymousViewingCapabilityId =
  // — anonymous read/play (the plan's first list) —
  /** Open the Home surface (no WebFlix account required). */
  | "open-home"
  /** Open the Watch surface. */
  | "open-watch"
  /** Open the Shorts surface. */
  | "open-shorts"
  /** Open the Search surface. */
  | "open-search"
  /** Open an item's detail hub (canonical identity + Where to watch). */
  | "open-item-details"
  /** Resolve the playable public realizations of a canonical item. */
  | "resolve-public-realizations"
  /** Play a public official-embed realization. */
  | "play-public-embed"
  /** Play a public contained-browser realization. */
  | "play-public-browser"
  /** Play a public external-handoff realization. */
  | "play-public-external"
  /** Play a public native-compatible realization (e.g. Desktop native media). */
  | "play-public-native-compatible"
  /** Watch continuously within one anonymous session (session continuity). */
  | "watch-continuously-anonymous-session"
  /** Use the public playback controls (play/pause/seek/volume of public playback). */
  | "public-playback-controls"
  /** Receive platform capability truth (honest supported/unsupported states). */
  | "platform-capability-truth"
  /** Non-persistent local interaction where supported (session-scoped only). */
  | "non-persistent-local-interaction"
  // — provider-authenticated playback (the third auth class) —
  /** Play a realization whose provider requires ITS OWN source authorization. */
  | "play-provider-authorized-realization"
  // — authenticated mutation/sync (the plan's second list) —
  /** Durable cross-device watch history. */
  | "durable-history"
  /** Durable cross-device watchlist/library saves. */
  | "durable-watchlist"
  /** Profile management (creation/selection/settings). */
  | "profile-management"
  /** Provider source connection (connect/reauthorize/disconnect). */
  | "source-connection"
  /** Bring Your Own Feed (authorized feed import/sync). */
  | "bring-your-own-feed"
  /** Account-authorized provider actions (provider actions needing the account). */
  | "account-authorized-provider-actions"
  /** BYOM management (bind/unbind/verify model providers). */
  | "byom-management"
  /** Durable recommendation identity (cross-device personalization). */
  | "durable-recommendation-identity"
  /** Account-scoped model policy (privacy/cost policy bound to the account). */
  | "account-scoped-model-policy"
  /** Synchronized social actions where the provider requires it. */
  | "synchronized-social-actions";

/** Every value of {@link AnonymousViewingCapabilityId}, in matrix order. */
export const ANONYMOUS_VIEWING_CAPABILITY_IDS: readonly AnonymousViewingCapabilityId[] =
  [
    "open-home",
    "open-watch",
    "open-shorts",
    "open-search",
    "open-item-details",
    "resolve-public-realizations",
    "play-public-embed",
    "play-public-browser",
    "play-public-external",
    "play-public-native-compatible",
    "watch-continuously-anonymous-session",
    "public-playback-controls",
    "platform-capability-truth",
    "non-persistent-local-interaction",
    "play-provider-authorized-realization",
    "durable-history",
    "durable-watchlist",
    "profile-management",
    "source-connection",
    "bring-your-own-feed",
    "account-authorized-provider-actions",
    "byom-management",
    "durable-recommendation-identity",
    "account-scoped-model-policy",
    "synchronized-social-actions",
  ] as const;

/** Runtime membership check against the capability union. */
export function isAnonymousViewingCapability(
  x: unknown,
): x is AnonymousViewingCapabilityId {
  return (
    typeof x === "string" &&
    (ANONYMOUS_VIEWING_CAPABILITY_IDS as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// One matrix row
// ---------------------------------------------------------------------------

/**
 * One row of the frozen capability matrix: a capability, its authorization
 * class, and the honest user-language truth of what that means. The label
 * and detail are the ONE derivation source — every surface renders THIS
 * wording, never its own (the discoverability.ts vocabulary law).
 */
export interface AnonymousCapabilityMatrixEntry {
  /** The capability this row types. */
  readonly capability: AnonymousViewingCapabilityId;
  /** The authorization class the capability belongs to. */
  readonly authClass: ViewerAuthClass;
  /** The capability's user label (the one derivation source). */
  readonly label: string;
  /** One honest sentence explaining the authorization truth. */
  readonly detail: string;
}

/**
 * The frozen anonymous-viewing capability matrix — THE shared read model
 * the adapters render. Rows are in {@link ANONYMOUS_VIEWING_CAPABILITY_IDS}
 * order (the plan's anonymous read/play list first, then the
 * provider-authorization row, then the authentication-remains-available
 * list).
 */
export const ANONYMOUS_VIEWING_MATRIX: readonly AnonymousCapabilityMatrixEntry[] =
  [
    {
      capability: "open-home",
      authClass: "anonymous",
      label: "Browse Home",
      detail: "Home is open to everyone — no WebFlix account is needed to browse.",
    },
    {
      capability: "open-watch",
      authClass: "anonymous",
      label: "Watch",
      detail: "The Watch surface is open to everyone — no WebFlix account is needed.",
    },
    {
      capability: "open-shorts",
      authClass: "anonymous",
      label: "Shorts",
      detail: "Shorts are open to everyone — no WebFlix account is needed.",
    },
    {
      capability: "open-search",
      authClass: "anonymous",
      label: "Search",
      detail: "Search is open to everyone — no WebFlix account is needed.",
    },
    {
      capability: "open-item-details",
      authClass: "anonymous",
      label: "Open item details",
      detail:
        "Any item's details — what it is and where to watch it — are open to everyone.",
    },
    {
      capability: "resolve-public-realizations",
      authClass: "anonymous",
      label: "See where to watch",
      detail:
        "The playable public ways to watch an item resolve for everyone, anonymous included.",
    },
    {
      capability: "play-public-embed",
      authClass: "anonymous",
      label: "Play public embeds",
      detail: "Public embed playback starts without a WebFlix account.",
    },
    {
      capability: "play-public-browser",
      authClass: "anonymous",
      label: "Play in the browser surface",
      detail: "Public browser playback starts without a WebFlix account.",
    },
    {
      capability: "play-public-external",
      authClass: "anonymous",
      label: "Open externally",
      detail: "Public external handoff works without a WebFlix account.",
    },
    {
      capability: "play-public-native-compatible",
      authClass: "anonymous",
      label: "Play native-compatible media",
      detail:
        "Public native-compatible playback (where the platform supports it) needs no WebFlix account.",
    },
    {
      capability: "watch-continuously-anonymous-session",
      authClass: "anonymous",
      label: "Keep watching",
      detail:
        "Playback continues within the anonymous session — no account required mid-session.",
    },
    {
      capability: "public-playback-controls",
      authClass: "anonymous",
      label: "Playback controls",
      detail: "Play, pause, seek and volume work on public playback for everyone.",
    },
    {
      capability: "platform-capability-truth",
      authClass: "anonymous",
      label: "Platform truth",
      detail:
        "Every viewer — anonymous included — sees the honest supported/unsupported platform truth.",
    },
    {
      capability: "non-persistent-local-interaction",
      authClass: "anonymous",
      label: "Local session interactions",
      detail:
        "Where supported, interactions work locally for the session only — they never masquerade as durable identity.",
    },
    {
      capability: "play-provider-authorized-realization",
      authClass: "provider-authorized",
      label: "Provider-authorized playback",
      detail:
        "Some sources require their own sign-in for their content — that is the source's requirement, separate from any WebFlix account.",
    },
    {
      capability: "durable-history",
      authClass: "webflix-account",
      label: "Watch history everywhere",
      detail: "Cross-device history needs a WebFlix account — anonymous watching stays in this session.",
    },
    {
      capability: "durable-watchlist",
      authClass: "webflix-account",
      label: "Watchlist everywhere",
      detail: "A watchlist that follows you across devices needs a WebFlix account.",
    },
    {
      capability: "profile-management",
      authClass: "webflix-account",
      label: "Profiles",
      detail: "Profiles and their settings belong to a WebFlix account.",
    },
    {
      capability: "source-connection",
      authClass: "webflix-account",
      label: "Connect sources",
      detail: "Connecting a source to your WebFlix needs an account — the connection is yours.",
    },
    {
      capability: "bring-your-own-feed",
      authClass: "webflix-account",
      label: "Bring Your Feed",
      detail: "Importing your feed needs an account — the import is tied to you.",
    },
    {
      capability: "account-authorized-provider-actions",
      authClass: "webflix-account",
      label: "Account-authorized actions",
      detail: "Some provider actions need your WebFlix account to authorize them.",
    },
    {
      capability: "byom-management",
      authClass: "webflix-account",
      label: "Manage model providers",
      detail: "Managing your own model providers needs a WebFlix account — the bindings are yours.",
    },
    {
      capability: "durable-recommendation-identity",
      authClass: "webflix-account",
      label: "Recommendations that follow you",
      detail: "Cross-device personalized recommendations need a WebFlix account.",
    },
    {
      capability: "account-scoped-model-policy",
      authClass: "webflix-account",
      label: "Saved model policy",
      detail: "A saved privacy/cost model policy needs a WebFlix account.",
    },
    {
      capability: "synchronized-social-actions",
      authClass: "webflix-account",
      label: "Synchronized actions",
      detail: "Likes and saves that sync back to the source need a WebFlix account where the source requires it.",
    },
  ] as const;

/** The matrix row for one capability (throws for unknown ids — drift). */
export function matrixEntryOf(
  capability: AnonymousViewingCapabilityId,
): AnonymousCapabilityMatrixEntry {
  const entry = ANONYMOUS_VIEWING_MATRIX.find(
    (row) => row.capability === capability,
  );
  if (entry === undefined) {
    throw new Error(
      `anonymous-viewing: no matrix row for capability '${String(capability)}' — matrix drift`,
    );
  }
  return entry;
}

/** The authorization class of one capability (the one derivation source). */
export function authClassOf(
  capability: AnonymousViewingCapabilityId,
): ViewerAuthClass {
  return matrixEntryOf(capability).authClass;
}

/** Every capability of one authorization class, in matrix order. */
export function capabilitiesOfAuthClass(
  authClass: ViewerAuthClass,
): readonly AnonymousViewingCapabilityId[] {
  return ANONYMOUS_VIEWING_MATRIX.filter((row) => row.authClass === authClass).map(
    (row) => row.capability,
  );
}

/**
 * The accountless capability list (the plan's anonymous read/play list) —
 * the J37 verification set. Every id here is playable/open WITHOUT a
 * WebFlix account and may NEVER be gated behind a login redirect.
 */
export function anonymousViewingCapabilities(): readonly AnonymousViewingCapabilityId[] {
  return capabilitiesOfAuthClass("anonymous");
}

// ---------------------------------------------------------------------------
// Realization access class (what a realization REQUIRES, independent of viewer)
// ---------------------------------------------------------------------------

/**
 * What one playback/acquisition realization requires to be playable:
 *
 * - `"public"` — playable by ANY viewer; no authorization of any kind is
 *   required. Anonymous + public => playback may start (the R23-B
 *   invariant this vocabulary feeds).
 * - `"provider-authorization-required"` — the PROVIDER's own source
 *   authorization is required. This is the provider's requirement — it is
 *   satisfied by the provider's authorization, NEVER by a WebFlix account
 *   (the independence law).
 */
export type RealizationAccessClass =
  | "public"
  | "provider-authorization-required";

/** Every value of {@link RealizationAccessClass}. */
export const REALIZATION_ACCESS_CLASSES: readonly RealizationAccessClass[] = [
  "public",
  "provider-authorization-required",
] as const;

/** Runtime membership check against the access-class union. */
export function isRealizationAccessClass(
  x: unknown,
): x is RealizationAccessClass {
  return (
    typeof x === "string" &&
    (REALIZATION_ACCESS_CLASSES as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// Capability access resolution (the read model adapters render)
// ---------------------------------------------------------------------------

/**
 * The honest next action when a capability's prerequisite is missing —
 * the R22-A prerequisite pattern (a typed in-place next action, NEVER a
 * global wall and NEVER an empty dead end).
 */
export interface CapabilityPrerequisiteAction {
  /** What kind of prerequisite is missing. */
  readonly kind: "webflix-sign-in" | "provider-authorization";
  /** The action's control label (user vocabulary). */
  readonly label: string;
  /** Why the action is offered — one honest sentence. */
  readonly detail: string;
}

/** One capability's availability truth for one viewer session. */
export type CapabilityAccess =
  | {
      /** Usable right now — no prerequisite is missing. */
      kind: "open";
      /** The honest one-sentence truth of the open state. */
      readonly detail: string;
    }
  | {
      /** A WebFlix sign-in is the honest prerequisite (account capabilities). */
      kind: "sign-in-prerequisite";
      /** The typed next action (sign in / create account — user vocabulary). */
      readonly action: CapabilityPrerequisiteAction;
      /** Why the prerequisite is missing — one honest sentence. */
      readonly detail: string;
    }
  | {
      /** The provider's OWN authorization is missing — never a WebFlix sign-in. */
      kind: "provider-authorization-prerequisite";
      /** The typed next action (authorize with the provider). */
      readonly action: CapabilityPrerequisiteAction;
      /** The connector whose authorization is missing. */
      readonly connectorId: string;
      /** Why the prerequisite is missing — one honest sentence. */
      readonly detail: string;
    };

/**
 * The WebFlix sign-in prerequisite action (the one derivation source —
 * mirrors the R22-A/R22-B vocabulary: sign in OR create a profile; login
 * remains AVAILABLE but optional for viewing).
 */
export const WEBFLIX_SIGN_IN_PREREQUISITE: CapabilityPrerequisiteAction = {
  kind: "webflix-sign-in",
  label: "Sign in / Create a profile",
  detail:
    "This needs a WebFlix account — signing in is optional for watching, and creating a profile takes a moment.",
};

/**
 * The session input the matrix resolves against: the viewer's WebFlix
 * session kind plus the observed per-connector provider-authorization
 * truths (the sources' own authorization state, exactly as the source
 * store observes it — R03's `authState`). A connector absent from the
 * list, or present with `authorized: false`, is NOT authorized.
 */
export interface AnonymousViewingSession {
  /** The viewer's WebFlix session state (the only WebFlix-identity input). */
  readonly viewer: ViewerSessionKind;
  /** Per-connector provider authorization truths (absent = not authorized). */
  readonly providerAuthorizations?: readonly ProviderAuthorizationFact[];
}

/**
 * One observed provider-authorization truth: connector `connectorId` has
 * its own source authorization (`authorized: true`) or does not. This is
 * the PROVIDER's truth, carried independently of any WebFlix account
 * state — the independence law, in data.
 */
export interface ProviderAuthorizationFact {
  /** The connector this authorization belongs to. */
  readonly connectorId: string;
  /** Whether the provider's own authorization is currently usable. */
  readonly authorized: boolean;
}

/** Is the provider's own authorization usable for `connectorId`? (Pure.) */
export function isProviderAuthorized(
  session: AnonymousViewingSession,
  connectorId: string,
): boolean {
  const facts = session.providerAuthorizations ?? [];
  return facts.some(
    (fact) => fact.connectorId === connectorId && fact.authorized,
  );
}

/**
 * Resolve ONE capability's access for one viewer session. (Pure; total
 * over the closed capability union.)
 *
 * THE DECISION TABLE (the frozen R23-A law, in one place):
 * - ANONYMOUS-class capability → ALWAYS `"open"` — for anonymous AND
 *   authenticated viewers alike (signing in never REMOVES accountless
 *   viewing; J37's "login remains available but optional").
 * - WEBFLIX-ACCOUNT-class capability → `"open"` when authenticated;
 *   `"sign-in-prerequisite"` when anonymous (the honest typed next
 *   action — never a wall, never a dead end).
 * - PROVIDER-AUTHORIZED-class capability → decided by the PROVIDER's
 *   authorization truth ALONE: `"open"` when the connector is authorized
 *   (WHETHER OR NOT the viewer has a WebFlix account — the independence
 *   law), `"provider-authorization-prerequisite"` when it is not. The
 *   viewer's WebFlix session NEVER changes this outcome.
 */
export function resolveCapabilityAccess(
  capability: AnonymousViewingCapabilityId,
  session: AnonymousViewingSession,
): CapabilityAccess {
  const entry = matrixEntryOf(capability);
  switch (entry.authClass) {
    case "anonymous":
      // Accountless by definition — open for every viewer, always.
      return { kind: "open", detail: entry.detail };
    case "webflix-account":
      if (session.viewer === "authenticated") {
        return { kind: "open", detail: entry.detail };
      }
      return {
        kind: "sign-in-prerequisite",
        action: WEBFLIX_SIGN_IN_PREREQUISITE,
        detail: `${entry.detail} Right now you are browsing without an account.`,
      };
    case "provider-authorized": {
      // The connector the realization would play through (the matrix's
      // single provider-authorized row names the generic truth; callers
      // pass the concrete connector through the session's facts).
      const connectorId = providerConnectorOf(session, capability);
      if (isProviderAuthorized(session, connectorId)) {
        return {
          kind: "open",
          detail: `This source's own sign-in is active — playback works ${
            session.viewer === "authenticated"
              ? "for your account"
              : "without a WebFlix account"
          }.`,
        };
      }
      return {
        kind: "provider-authorization-prerequisite",
        action: {
          kind: "provider-authorization",
          label: "Authorize with this source",
          detail: `This content needs the source's own sign-in — that is the source's requirement, not a WebFlix account.`,
        },
        connectorId,
        detail: `The source '${connectorId}' requires its own authorization for this content.`,
      };
    }
  }
}

/**
 * The connector a provider-authorized capability resolves against: the
 * FIRST observed provider-authorization fact (stable, deterministic for
 * tests); when no facts are observed the generic "the source" truth is
 * named honestly. (Pure; the matrix itself is connector-neutral — the
 * concrete connector is session data, never matrix data.)
 */
function providerConnectorOf(
  session: AnonymousViewingSession,
  _capability: AnonymousViewingCapabilityId,
): string {
  const facts = session.providerAuthorizations ?? [];
  const first = facts[0];
  return first !== undefined ? first.connectorId : "the source";
}

// ---------------------------------------------------------------------------
// The full view (the matrix read model the adapters render)
// ---------------------------------------------------------------------------

/** One rendered row: the matrix entry + its access resolution. */
export interface AnonymousCapabilityAccessView {
  readonly entry: AnonymousCapabilityMatrixEntry;
  readonly access: CapabilityAccess;
}

/**
 * The complete anonymous-viewing read model: every matrix row with its
 * access resolution for the session. This is the frozen view Workers 2/3
 * render — the J37 surfaces (no login wall for public playback, honest
 * sign-in prerequisites for account capabilities, provider requirements
 * distinguished from WebFlix requirements) all derive from it.
 */
export interface AnonymousViewingView {
  /** The viewer session the view resolved against. */
  readonly viewer: ViewerSessionKind;
  /** Every matrix row in {@link ANONYMOUS_VIEWING_MATRIX} order. */
  readonly rows: readonly AnonymousCapabilityAccessView[];
}

/** Resolve the full matrix view for one session. (Pure.) */
export function anonymousViewingView(
  session: AnonymousViewingSession,
): AnonymousViewingView {
  return {
    viewer: session.viewer,
    rows: ANONYMOUS_VIEWING_MATRIX.map((entry) => ({
      entry,
      access: resolveCapabilityAccess(entry.capability, session),
    })),
  };
}

// ---------------------------------------------------------------------------
// The no-login-wall law (machine-checkable)
// ---------------------------------------------------------------------------

/**
 * WHY a route proposed a login redirect. The law distinguishes the
 * FORBIDDEN blanket wall from the lawful intent-following destination:
 *
 * - `"viewer-is-anonymous"` — the redirect exists merely because the
 *   viewer lacks a WebFlix account (the J37 forbidden invariant).
 * - `"capability-requires-account"` — the user explicitly invoked an
 *   account-requiring capability (e.g. opened the sign-in form, chose
 *   "Connect a source", chose "Manage model providers"); landing on the
 *   sign-in destination IS the requested journey.
 * - `"provider-requires-own-authorization"` — what is actually missing is
 *   the provider's own authorization; a WebFlix login NEVER satisfies it.
 */
export type LoginRedirectReason =
  | "viewer-is-anonymous"
  | "capability-requires-account"
  | "provider-requires-own-authorization";

/** Every value of {@link LoginRedirectReason}. */
export const LOGIN_REDIRECT_REASONS: readonly LoginRedirectReason[] = [
  "viewer-is-anonymous",
  "capability-requires-account",
  "provider-requires-own-authorization",
] as const;

/** Runtime membership check against the reason union. */
export function isLoginRedirectReason(x: unknown): x is LoginRedirectReason {
  return (
    typeof x === "string" &&
    (LOGIN_REDIRECT_REASONS as readonly string[]).includes(x)
  );
}

/**
 * THE NO-LOGIN-WALL LAW (machine-checkable; the J37 acceptance core):
 * may a route lawfully redirect to login for `capability` under `reason`?
 *
 * - ANONYMOUS-class capabilities: NEVER — they are accountless by
 *   definition; any login redirect on them is drift ("no public-watch
 *   route may redirect to login merely because the viewer is anonymous"
 *   — and by extension for ANY reason, since no reason can make an
 *   accountless capability need an account).
 * - PROVIDER-AUTHORIZED-class capabilities: NEVER — the missing piece is
 *   the provider's own authorization; presenting a WebFlix login instead
 *   conflates the two auth classes (the independence law).
 * - WEBFLIX-ACCOUNT-class capabilities: lawful ONLY when the user
 *   explicitly invoked the account-requiring capability (reason
 *   `"capability-requires-account"`). A blanket
 *   viewer-is-anonymous redirect is still FORBIDDEN even here — the
 *   honest anonymous state is the typed in-place prerequisite, not a
 *   wall (the R22-A prerequisite pattern).
 */
export function isLawfulLoginRedirect(
  capability: AnonymousViewingCapabilityId,
  reason: LoginRedirectReason,
): boolean {
  const authClass = authClassOf(capability);
  switch (authClass) {
    case "anonymous":
      return false; // accountless by definition — any login redirect is drift
    case "provider-authorized":
      return false; // provider authorization is never satisfied by a WebFlix login
    case "webflix-account":
      return reason === "capability-requires-account"; // only the invoked action
  }
}

/**
 * The J37 forbidden-invariant check every public-watch route must pass:
 * an ANONYMOUS viewer on an ANONYMOUS-class (public-watch) capability may
 * NEVER be redirected to login. This is the sharp end of
 * {@link isLawfulLoginRedirect} — the check the journey evidence asserts.
 */
export function forbidsAnonymousLoginRedirect(
  capability: AnonymousViewingCapabilityId,
  viewer: ViewerSessionKind,
  reason: LoginRedirectReason,
): boolean {
  return (
    viewer === "anonymous" &&
    authClassOf(capability) === "anonymous" &&
    !isLawfulLoginRedirect(capability, reason)
  );
}
