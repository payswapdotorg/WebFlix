/**
 * @wfx/client-runtime — R23-A anonymous-viewing capability-matrix tests.
 *
 * The frozen anonymous-viewing contract, at the shared seam:
 * - the THREE-WAY typed distinction: anonymous read/play (no WebFlix
 *   account), authenticated mutation/sync (durable identity /
 *   authorization boundary), provider-authenticated playback (the
 *   provider's OWN authorization, independent of any WebFlix account);
 * - the frozen matrix rows cover EXACTLY the plan's anonymous read/play
 *   list and authentication-remains-available list;
 * - per-capability access resolution: anonymous-class rows are open for
 *   EVERY viewer (signing in never removes accountless viewing);
 *   account-class rows carry the typed sign-in prerequisite (never a
 *   wall, never a dead end); provider-authorized rows are decided by the
 *   provider's own authorization truth ALONE;
 * - the machine-checkable NO-LOGIN-WALL law (J37's forbidden invariant:
 *   no public-watch route may redirect to login merely because the
 *   viewer is anonymous) and the provider-independence law (a WebFlix
 *   login never satisfies provider authorization).
 */

import { describe, expect, it } from "bun:test";

import {
  ANONYMOUS_VIEWING_CAPABILITY_IDS,
  ANONYMOUS_VIEWING_MATRIX,
  LOGIN_REDIRECT_REASONS,
  REALIZATION_ACCESS_CLASSES,
  VIEWER_AUTH_CLASSES,
  VIEWER_SESSION_KINDS,
  anonymousViewingCapabilities,
  anonymousViewingView,
  authClassOf,
  capabilitiesOfAuthClass,
  forbidsAnonymousLoginRedirect,
  isAnonymousViewingCapability,
  isLawfulLoginRedirect,
  isLoginRedirectReason,
  isProviderAuthorized,
  isRealizationAccessClass,
  isViewerAuthClass,
  isViewerSessionKind,
  matrixEntryOf,
  resolveCapabilityAccess,
  type AnonymousViewingCapabilityId,
  type AnonymousViewingSession,
} from "../src/index";

/** Sorted plain-string view of a capability list (type-safe comparison). */
const sorted = (xs: readonly (AnonymousViewingCapabilityId | string)[]): string[] =>
  [...xs].sort();

/** The plan's anonymous read/play list (the J37 verification set). */
const PLAN_ANONYMOUS_LIST: readonly AnonymousViewingCapabilityId[] = [
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
];

/** The plan's authentication-remains-available list. */
const PLAN_ACCOUNT_LIST: readonly AnonymousViewingCapabilityId[] = [
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
];

const ANONYMOUS_SESSION: AnonymousViewingSession = { viewer: "anonymous" };
const AUTHENTICATED_SESSION: AnonymousViewingSession = {
  viewer: "authenticated",
};

const PROVIDER_AUTHORIZED_SESSION: AnonymousViewingSession = {
  viewer: "anonymous",
  providerAuthorizations: [{ connectorId: "acorn-tv", authorized: true }],
};

const PROVIDER_UNAUTHORIZED_SESSION: AnonymousViewingSession = {
  viewer: "authenticated",
  providerAuthorizations: [{ connectorId: "acorn-tv", authorized: false }],
};

// ---------------------------------------------------------------------------
// The vocabularies
// ---------------------------------------------------------------------------

describe("R23-A — the typed vocabularies", () => {
  it("the three auth classes are exactly the plan's distinction", () => {
    expect(VIEWER_AUTH_CLASSES).toEqual([
      "anonymous",
      "webflix-account",
      "provider-authorized",
    ]);
    for (const value of VIEWER_AUTH_CLASSES) {
      expect(isViewerAuthClass(value)).toBe(true);
    }
    expect(isViewerAuthClass("public")).toBe(false);
    expect(isViewerAuthClass("")).toBe(false);
    expect(isViewerAuthClass(7)).toBe(false);
  });

  it("the viewer session kinds are anonymous | authenticated", () => {
    expect(VIEWER_SESSION_KINDS).toEqual(["anonymous", "authenticated"]);
    expect(isViewerSessionKind("anonymous")).toBe(true);
    expect(isViewerSessionKind("authenticated")).toBe(true);
    expect(isViewerSessionKind("guest")).toBe(false);
    expect(isViewerSessionKind(null)).toBe(false);
  });

  it("the realization access classes are public | provider-authorization-required", () => {
    expect(REALIZATION_ACCESS_CLASSES).toEqual([
      "public",
      "provider-authorization-required",
    ]);
    expect(isRealizationAccessClass("public")).toBe(true);
    expect(isRealizationAccessClass("provider-authorization-required")).toBe(true);
    expect(isRealizationAccessClass("entitled")).toBe(false);
  });

  it("the login-redirect reason vocabulary is closed", () => {
    expect(LOGIN_REDIRECT_REASONS).toEqual([
      "viewer-is-anonymous",
      "capability-requires-account",
      "provider-requires-own-authorization",
    ]);
    for (const reason of LOGIN_REDIRECT_REASONS) {
      expect(isLoginRedirectReason(reason)).toBe(true);
    }
    expect(isLoginRedirectReason("session-expired")).toBe(false);
  });

  it("the capability guard rejects unknown ids and accepts every matrix id", () => {
    for (const id of ANONYMOUS_VIEWING_CAPABILITY_IDS) {
      expect(isAnonymousViewingCapability(id)).toBe(true);
    }
    expect(isAnonymousViewingCapability("offline-copy")).toBe(false);
    expect(isAnonymousViewingCapability("torrent-playback-mode")).toBe(false);
    expect(isAnonymousViewingCapability(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The frozen matrix
// ---------------------------------------------------------------------------

describe("R23-A — the frozen capability matrix", () => {
  it("covers EXACTLY the plan's anonymous read/play + account lists (+ the provider row)", () => {
    const matrixIds = ANONYMOUS_VIEWING_MATRIX.map((row) => row.capability);
    expect(sorted(matrixIds)).toEqual(
      sorted([
        ...PLAN_ANONYMOUS_LIST,
        "play-provider-authorized-realization",
        ...PLAN_ACCOUNT_LIST,
      ]),
    );
    expect(ANONYMOUS_VIEWING_MATRIX).toHaveLength(
      PLAN_ANONYMOUS_LIST.length + PLAN_ACCOUNT_LIST.length + 1,
    );
  });

  it("the anonymous read/play list is authClass anonymous (the J37 set)", () => {
    expect(sorted(anonymousViewingCapabilities())).toEqual(
      sorted(PLAN_ANONYMOUS_LIST),
    );
    for (const capability of anonymousViewingCapabilities()) {
      expect(authClassOf(capability)).toBe("anonymous");
    }
  });

  it("the authentication-remains-available list is authClass webflix-account", () => {
    expect(sorted(capabilitiesOfAuthClass("webflix-account"))).toEqual(
      sorted(PLAN_ACCOUNT_LIST),
    );
    for (const id of PLAN_ACCOUNT_LIST) {
      expect(authClassOf(id)).toBe("webflix-account");
    }
  });

  it("exactly one row is provider-authorized (the third auth class)", () => {
    expect(capabilitiesOfAuthClass("provider-authorized")).toEqual([
      "play-provider-authorized-realization",
    ]);
  });

  it("every row carries non-empty label + detail (the one derivation source)", () => {
    for (const row of ANONYMOUS_VIEWING_MATRIX) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.detail.length).toBeGreaterThan(0);
      expect(matrixEntryOf(row.capability)).toBe(row);
    }
  });

  it("matrixEntryOf throws on drift (unknown capability)", () => {
    expect(() => matrixEntryOf("not-a-capability" as never)).toThrow(
      /matrix drift/,
    );
  });
});

// ---------------------------------------------------------------------------
// Per-capability access resolution
// ---------------------------------------------------------------------------

describe("R23-A — per-capability access resolution", () => {
  it("anonymous-class capabilities are OPEN for an anonymous viewer (the J37 core)", () => {
    for (const capability of anonymousViewingCapabilities()) {
      const access = resolveCapabilityAccess(capability, ANONYMOUS_SESSION);
      expect(access.kind).toBe("open");
      if (access.kind === "open") {
        expect(access.detail.length).toBeGreaterThan(0);
      }
    }
  });

  it("anonymous-class capabilities stay OPEN for an authenticated viewer (login never removes accountless viewing)", () => {
    for (const capability of anonymousViewingCapabilities()) {
      expect(
        resolveCapabilityAccess(capability, AUTHENTICATED_SESSION).kind,
      ).toBe("open");
    }
  });

  it("account-class capabilities carry the typed sign-in prerequisite when anonymous", () => {
    for (const id of PLAN_ACCOUNT_LIST) {
      const access = resolveCapabilityAccess(id, ANONYMOUS_SESSION);
      expect(access.kind).toBe("sign-in-prerequisite");
      if (access.kind === "sign-in-prerequisite") {
        expect(access.action.kind).toBe("webflix-sign-in");
        expect(access.action.label).toBe("Sign in / Create a profile");
        expect(access.action.detail).toContain("optional");
        expect(access.detail).toContain("without an account");
      }
    }
  });

  it("account-class capabilities open when authenticated", () => {
    for (const id of PLAN_ACCOUNT_LIST) {
      expect(resolveCapabilityAccess(id, AUTHENTICATED_SESSION).kind).toBe(
        "open",
      );
    }
  });

  it("provider authorization is INDEPENDENT of the WebFlix account (both directions)", () => {
    // Anonymous viewer + provider authorized => OPEN (independence law).
    const anonymousAuthorized = resolveCapabilityAccess(
      "play-provider-authorized-realization",
      PROVIDER_AUTHORIZED_SESSION,
    );
    expect(anonymousAuthorized.kind).toBe("open");

    // Authenticated viewer + provider NOT authorized => the honest missing
    // piece is the PROVIDER's authorization, never a WebFlix sign-in.
    const authenticatedUnauthorized = resolveCapabilityAccess(
      "play-provider-authorized-realization",
      PROVIDER_UNAUTHORIZED_SESSION,
    );
    expect(authenticatedUnauthorized.kind).toBe(
      "provider-authorization-prerequisite",
    );
    if (authenticatedUnauthorized.kind === "provider-authorization-prerequisite") {
      expect(authenticatedUnauthorized.action.kind).toBe(
        "provider-authorization",
      );
      expect(authenticatedUnauthorized.connectorId).toBe("acorn-tv");
      expect(authenticatedAuthorizedNotLogin(authenticatedUnauthorized)).toBe(
        true,
      );
    }
  });

  it("an anonymous session with no provider facts reports the provider prerequisite honestly", () => {
    const access = resolveCapabilityAccess(
      "play-provider-authorized-realization",
      ANONYMOUS_SESSION,
    );
    expect(access.kind).toBe("provider-authorization-prerequisite");
    if (access.kind === "provider-authorization-prerequisite") {
      // The prerequisite is the provider's own authorization — NEVER a
      // WebFlix sign-in prompt (the conflation the plan forbids).
      expect(access.action.kind).toBe("provider-authorization");
      expect(access.action.detail).toContain("not a WebFlix account");
    }
  });

  it("isProviderAuthorized keys on the connector fact alone", () => {
    expect(isProviderAuthorized(PROVIDER_AUTHORIZED_SESSION, "acorn-tv")).toBe(
      true,
    );
    expect(isProviderAuthorized(PROVIDER_AUTHORIZED_SESSION, "youtube")).toBe(
      false,
    );
    expect(isProviderAuthorized(ANONYMOUS_SESSION, "acorn-tv")).toBe(false);
    expect(
      isProviderAuthorized(PROVIDER_UNAUTHORIZED_SESSION, "acorn-tv"),
    ).toBe(false);
  });
});

/** The honest provider prerequisite never mentions a WebFlix login. */
function authenticatedAuthorizedNotLogin(access: {
  action: { kind: string; label: string; detail: string };
}): boolean {
  return (
    access.action.kind === "provider-authorization" &&
    !access.action.label.toLowerCase().includes("webflix")
  );
}

// ---------------------------------------------------------------------------
// The full view
// ---------------------------------------------------------------------------

describe("R23-A — the full matrix read model", () => {
  it("renders every matrix row with its access resolution (matrix order)", () => {
    const view = anonymousViewingView(ANONYMOUS_SESSION);
    expect(view.viewer).toBe("anonymous");
    expect(view.rows).toHaveLength(ANONYMOUS_VIEWING_MATRIX.length);
    expect(sorted(view.rows.map((row) => row.entry.capability))).toEqual(
      sorted(ANONYMOUS_VIEWING_CAPABILITY_IDS),
    );
    for (const row of view.rows) {
      expect(row.access).toBeDefined();
    }
  });

  it("the anonymous view has zero walls: anonymous rows open, account rows typed prerequisite", () => {
    const view = anonymousViewingView(ANONYMOUS_SESSION);
    const openRows = view.rows.filter((row) => row.access.kind === "open");
    expect(sorted(openRows.map((row) => row.entry.capability))).toEqual(
      sorted(PLAN_ANONYMOUS_LIST),
    );
    const signInRows = view.rows.filter(
      (row) => row.access.kind === "sign-in-prerequisite",
    );
    expect(sorted(signInRows.map((row) => row.entry.capability))).toEqual(
      sorted(PLAN_ACCOUNT_LIST),
    );
  });
});

// ---------------------------------------------------------------------------
// The no-login-wall law (J37's forbidden invariant)
// ---------------------------------------------------------------------------

describe("R23-A — the machine-checkable no-login-wall law", () => {
  it("anonymous-class capabilities may NEVER redirect to login (any reason)", () => {
    for (const capability of anonymousViewingCapabilities()) {
      for (const reason of LOGIN_REDIRECT_REASONS) {
        expect(isLawfulLoginRedirect(capability, reason)).toBe(false);
      }
    }
  });

  it("provider-authorization gaps may NEVER be answered with a WebFlix login", () => {
    expect(
      isLawfulLoginRedirect(
        "play-provider-authorized-realization",
        "provider-requires-own-authorization",
      ),
    ).toBe(false);
    expect(
      isLawfulLoginRedirect(
        "play-provider-authorized-realization",
        "viewer-is-anonymous",
      ),
    ).toBe(false);
    expect(
      isLawfulLoginRedirect(
        "play-provider-authorized-realization",
        "capability-requires-account",
      ),
    ).toBe(false);
  });

  it("account-class capabilities allow the login destination ONLY for the invoked action", () => {
    // The lawful case: the user explicitly invoked the account capability
    // (opened the sign-in form, chose Connect a source, chose BYOM).
    expect(isLawfulLoginRedirect("source-connection", "capability-requires-account")).toBe(
      true,
    );
    expect(isLawfulLoginRedirect("byom-management", "capability-requires-account")).toBe(
      true,
    );
    // The forbidden case: a blanket wall merely because the viewer is
    // anonymous — the honest state is the typed in-place prerequisite.
    expect(isLawfulLoginRedirect("source-connection", "viewer-is-anonymous")).toBe(
      false,
    );
    expect(
      isLawfulLoginRedirect("durable-history", "provider-requires-own-authorization"),
    ).toBe(false);
  });

  it("the J37 forbidden invariant: anonymous viewer + public-watch capability + login redirect", () => {
    // The sharp end — what the journey evidence asserts for every
    // public-watch route: the redirect is FORBIDDEN.
    expect(
      forbidsAnonymousLoginRedirect("open-watch", "anonymous", "viewer-is-anonymous"),
    ).toBe(true);
    expect(
      forbidsAnonymousLoginRedirect("play-public-embed", "anonymous", "viewer-is-anonymous"),
    ).toBe(true);
    expect(
      forbidsAnonymousLoginRedirect(
        "watch-continuously-anonymous-session",
        "anonymous",
        "capability-requires-account",
      ),
    ).toBe(true);
    // An authenticated viewer is not covered by the invariant (there is
    // nothing anonymous to be walled).
    expect(
      forbidsAnonymousLoginRedirect("open-watch", "authenticated", "viewer-is-anonymous"),
    ).toBe(false);
    // An account capability is not a public-watch route.
    expect(
      forbidsAnonymousLoginRedirect("source-connection", "anonymous", "viewer-is-anonymous"),
    ).toBe(false);
  });
});
