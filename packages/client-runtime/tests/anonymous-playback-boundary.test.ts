/**
 * @wfx/client-runtime — R23-B anonymous-playback-boundary tests.
 *
 * The per-capability playback authorization contract, at the shared seam:
 * - THE INVARIANT: anonymous + public realization => playback may start
 *   (every mode; the provider's own authorization state never gates a
 *   public realization);
 * - THE FORBIDDEN INVARIANT: no playback authorization decision may EVER
 *   be answered with a WebFlix login redirect (public => nothing
 *   missing; provider gap => the provider's own sign-in, never a WebFlix
 *   login — for anonymous AND authenticated viewers alike);
 * - THE INDEPENDENCE LAW: the decision table structurally never consults
 *   the viewer — anonymous and authenticated queries produce IDENTICAL
 *   decisions;
 * - the per-capability mapping: every mode x access class consults
 *   exactly one R23-A matrix row (no global gate, no mode special case);
 * - the read-path guard: every primary surface is anonymously openable;
 * - the observed-source folds (access class + provider authorization);
 * - the session-scoped progress law: anonymous progress is never durable
 *   identity until authentication (scope typing + the refusal + the
 *   lawful post-authentication promotion).
 */

import { describe, expect, it } from "bun:test";

import type { PlaybackMode } from "@wfx/domain";

import {
  authorizePlaybackStart,
  isLoginRedirectLawfulForPlayback,
  isSessionScopedProgress,
  isViewerProgressScope,
  mayOpenSurfaceAnonymously,
  mayRepresentAsDurableIdentity,
  playbackCapabilityFor,
  progressScopeFor,
  promoteSessionProgressToDurable,
  providerAuthorizationFacts,
  providerAuthorizationOf,
  realizationAccessClass,
  sessionScopedProgress,
  VIEWER_PROGRESS_SCOPES,
  type PlaybackAuthorizationQuery,
  type SourceInfo,
} from "../src/index";

const ALL_MODES: readonly PlaybackMode[] = ["native", "embed", "browser", "external"];

/** A valid observed /sources row (R03 shape) for the source folds. */
function makeSource(overrides: Partial<SourceInfo> = {}): SourceInfo {
  return {
    connectorId: "acorn-tv",
    displayName: "Acorn TV",
    version: "1.0.0",
    authMode: "oauth",
    capabilities: {
      identity: false,
      catalogSearch: true,
      metadata: true,
      playNative: false,
      playEmbed: true,
      playBrowser: true,
      playExternal: true,
      availability: true,
      libraryRead: true,
      libraryWrite: true,
      like: true,
      save: true,
      follow: false,
      comment: false,
      download: false,
      transform: false,
    },
    authState: "signedOut",
    requiresAuthorization: true,
    connected: false,
    accountId: null,
    authorizedAt: null,
    lastStateChange: null,
    expiresAt: null,
    availabilityNotes: [],
    lastChecked: "2026-09-21T12:00:00.000Z",
    ...overrides,
  } as SourceInfo;
}

const PUBLIC_QUERY = (viewer: "anonymous" | "authenticated"): PlaybackAuthorizationQuery => ({
  viewer,
  realization: { mode: "embed", accessClass: "public", connectorId: "webflix-catalog" },
  providerAuthorized: false,
});

const PROVIDER_AUTHORIZED_QUERY = (
  viewer: "anonymous" | "authenticated",
): PlaybackAuthorizationQuery => ({
  viewer,
  realization: {
    mode: "embed",
    accessClass: "provider-authorization-required",
    connectorId: "acorn-tv",
  },
  providerAuthorized: true,
});

const PROVIDER_UNAUTHORIZED_QUERY = (
  viewer: "anonymous" | "authenticated",
): PlaybackAuthorizationQuery => ({
  viewer,
  realization: {
    mode: "embed",
    accessClass: "provider-authorization-required",
    connectorId: "acorn-tv",
  },
  providerAuthorized: false,
});

// ---------------------------------------------------------------------------
// The invariant: anonymous + public => playback may start
// ---------------------------------------------------------------------------

describe("R23-B — the anonymous + public => may-start invariant", () => {
  it("a public realization may start for an anonymous viewer in EVERY mode", () => {
    for (const mode of ALL_MODES) {
      const decision = authorizePlaybackStart({
        viewer: "anonymous",
        realization: { mode, accessClass: "public" },
        providerAuthorized: false,
      });
      expect(decision.kind).toBe("playback-may-start");
      if (decision.kind === "playback-may-start") {
        expect(decision.detail).toContain("public");
      }
    }
  });

  it("the provider's own authorization state NEVER gates a public realization", () => {
    for (const providerAuthorized of [false, true]) {
      const decision = authorizePlaybackStart({
        viewer: "anonymous",
        realization: { mode: "browser", accessClass: "public" },
        providerAuthorized,
      });
      expect(decision.kind).toBe("playback-may-start");
    }
  });

  it("an unattributed public realization (no connector) may start anonymously", () => {
    const decision = authorizePlaybackStart({
      viewer: "anonymous",
      realization: { mode: "external", accessClass: "public" },
      providerAuthorized: false,
    });
    expect(decision.kind).toBe("playback-may-start");
  });
});

// ---------------------------------------------------------------------------
// The forbidden invariant: no login redirect for playback authorization
// ---------------------------------------------------------------------------

describe("R23-B — the playback no-login-wall law", () => {
  it("NO playback decision may ever be answered with a WebFlix login redirect", () => {
    for (const viewer of ["anonymous", "authenticated"] as const) {
      for (const query of [
        PUBLIC_QUERY(viewer),
        PROVIDER_AUTHORIZED_QUERY(viewer),
        PROVIDER_UNAUTHORIZED_QUERY(viewer),
      ]) {
        expect(isLoginRedirectLawfulForPlayback(authorizePlaybackStart(query))).toBe(
          false,
        );
      }
    }
  });

  it("the provider-authorization gap names the PROVIDER, never a WebFlix login", () => {
    const decision = authorizePlaybackStart(PROVIDER_UNAUTHORIZED_QUERY("anonymous"));
    expect(decision.kind).toBe("provider-authorization-required");
    if (decision.kind === "provider-authorization-required") {
      expect(decision.action.kind).toBe("provider-authorization");
      expect(decision.action.label).toBe("Authorize with this source");
      expect(decision.action.detail).toContain("not a WebFlix account");
      expect(decision.connectorId).toBe("acorn-tv");
      // The honest missing piece is the source's own sign-in.
      expect(decision.detail).toContain("requires its own authorization");
    }
  });

  it("an unattributed provider-authorized realization names 'the source' honestly", () => {
    const decision = authorizePlaybackStart({
      viewer: "authenticated",
      realization: { mode: "native", accessClass: "provider-authorization-required" },
      providerAuthorized: false,
    });
    expect(decision.kind).toBe("provider-authorization-required");
    if (decision.kind === "provider-authorization-required") {
      expect(decision.connectorId).toBe("the source");
    }
  });
});

// ---------------------------------------------------------------------------
// The independence law: the decision never consults the viewer
// ---------------------------------------------------------------------------

describe("R23-B — provider authorization stays independent of the WebFlix account", () => {
  it("anonymous and authenticated queries produce IDENTICAL decisions (all three outcomes)", () => {
    for (const queryFactory of [
      PUBLIC_QUERY,
      PROVIDER_AUTHORIZED_QUERY,
      PROVIDER_UNAUTHORIZED_QUERY,
    ]) {
      const anonymousDecision = authorizePlaybackStart(queryFactory("anonymous"));
      const authenticatedDecision = authorizePlaybackStart(queryFactory("authenticated"));
      expect(authenticatedDecision).toEqual(anonymousDecision);
    }
  });

  it("an anonymous viewer WITH provider authorization may start (independence, direction 1)", () => {
    const decision = authorizePlaybackStart(PROVIDER_AUTHORIZED_QUERY("anonymous"));
    expect(decision.kind).toBe("playback-may-start");
  });

  it("an authenticated viewer WITHOUT provider authorization may NOT start (independence, direction 2)", () => {
    const decision = authorizePlaybackStart(PROVIDER_UNAUTHORIZED_QUERY("authenticated"));
    expect(decision.kind).toBe("provider-authorization-required");
  });
});

// ---------------------------------------------------------------------------
// The per-capability mapping (no global gate, no mode special case)
// ---------------------------------------------------------------------------

describe("R23-B — the per-capability mapping into the R23-A matrix", () => {
  it("public realizations consult the mode's own public-play row", () => {
    expect(playbackCapabilityFor("native", "public")).toBe(
      "play-public-native-compatible",
    );
    expect(playbackCapabilityFor("embed", "public")).toBe("play-public-embed");
    expect(playbackCapabilityFor("browser", "public")).toBe("play-public-browser");
    expect(playbackCapabilityFor("external", "public")).toBe("play-public-external");
  });

  it("provider-authorization-required realizations consult the provider row in EVERY mode", () => {
    for (const mode of ALL_MODES) {
      expect(playbackCapabilityFor(mode, "provider-authorization-required")).toBe(
        "play-provider-authorized-realization",
      );
    }
  });

  it("every decision carries the consulted capability row (auditable per-capability check)", () => {
    for (const mode of ALL_MODES) {
      const decision = authorizePlaybackStart({
        viewer: "anonymous",
        realization: { mode, accessClass: "public" },
        providerAuthorized: false,
      });
      if (decision.kind === "playback-may-start") {
        expect(decision.capability).toBe(playbackCapabilityFor(mode, "public"));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The read-path guard
// ---------------------------------------------------------------------------

describe("R23-B — the read-path surface guard", () => {
  it("every primary navigation surface is anonymously openable", () => {
    for (const surface of [
      "home",
      "watch",
      "shorts",
      "search",
      "library",
      "settings",
    ] as const) {
      expect(mayOpenSurfaceAnonymously(surface)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The observed-source folds
// ---------------------------------------------------------------------------

describe("R23-B — the observed-source folds", () => {
  it("realizationAccessClass derives from the connector's requiresAuthorization truth", () => {
    const sources = [
      makeSource({ connectorId: "acorn-tv", requiresAuthorization: true }),
      makeSource({ connectorId: "webflix-catalog", requiresAuthorization: false }),
    ];
    expect(
      realizationAccessClass({ connectorId: "acorn-tv" }, sources),
    ).toBe("provider-authorization-required");
    expect(
      realizationAccessClass({ connectorId: "webflix-catalog" }, sources),
    ).toBe("public");
    // Unattributed + unobserved connectors carry no provider-auth requirement.
    expect(realizationAccessClass({}, sources)).toBe("public");
    expect(realizationAccessClass({ connectorId: "unknown" }, sources)).toBe("public");
    expect(realizationAccessClass({ connectorId: "" }, sources)).toBe("public");
  });

  it("providerAuthorizationOf is active iff authState is signedIn", () => {
    for (const authState of ["signedOut", "authorizing", "expired", "failed"] as const) {
      expect(
        providerAuthorizationOf(
          "acorn-tv",
          [makeSource({ connectorId: "acorn-tv", authState })],
        ),
      ).toBe(false);
    }
    expect(
      providerAuthorizationOf(
        "acorn-tv",
        [makeSource({ connectorId: "acorn-tv", authState: "signedIn" })],
      ),
    ).toBe(true);
    // Unknown connectors are not authorized.
    expect(providerAuthorizationOf("unknown", [])).toBe(false);
  });

  it("providerAuthorizationFacts folds one fact per observed source", () => {
    const facts = providerAuthorizationFacts([
      makeSource({ connectorId: "acorn-tv", authState: "signedIn" }),
      makeSource({
        connectorId: "webflix-catalog",
        requiresAuthorization: false,
        authState: "signedIn",
      }),
      makeSource({ connectorId: "tubi", authState: "signedOut" }),
    ]);
    expect(facts).toEqual([
      { connectorId: "acorn-tv", authorized: true },
      { connectorId: "webflix-catalog", authorized: true },
      { connectorId: "tubi", authorized: false },
    ]);
  });

  it("the folds compose with the decision table end-to-end (observed truth -> decision)", () => {
    const sources = [makeSource({ connectorId: "acorn-tv", authState: "signedOut" })];
    const realization = { mode: "embed" as const, connectorId: "acorn-tv" };
    const decision = authorizePlaybackStart({
      viewer: "anonymous",
      realization: {
        mode: realization.mode,
        accessClass: realizationAccessClass(realization, sources),
        connectorId: realization.connectorId,
      },
      providerAuthorized: providerAuthorizationOf("acorn-tv", sources),
    });
    expect(decision.kind).toBe("provider-authorization-required");

    // The provider signs in — the same anonymous viewer may now start.
    const afterSignIn = [
      makeSource({ connectorId: "acorn-tv", authState: "signedIn" }),
    ];
    const decision2 = authorizePlaybackStart({
      viewer: "anonymous",
      realization: {
        mode: realization.mode,
        accessClass: realizationAccessClass(realization, afterSignIn),
        connectorId: realization.connectorId,
      },
      providerAuthorized: providerAuthorizationOf("acorn-tv", afterSignIn),
    });
    expect(decision2.kind).toBe("playback-may-start");
  });
});

// ---------------------------------------------------------------------------
// The session-scoped progress law
// ---------------------------------------------------------------------------

describe("R23-B — the session-scoped progress law", () => {
  it("the progress scope vocabulary is closed and total", () => {
    expect(VIEWER_PROGRESS_SCOPES).toEqual(["session-local", "durable-cross-device"]);
    expect(isViewerProgressScope("session-local")).toBe(true);
    expect(isViewerProgressScope("durable-cross-device")).toBe(true);
    expect(isViewerProgressScope("account")).toBe(false);
  });

  it("progressScopeFor: anonymous => session-local; authenticated => durable", () => {
    expect(progressScopeFor("anonymous")).toBe("session-local");
    expect(progressScopeFor("authenticated")).toBe("durable-cross-device");
  });

  it("mayRepresentAsDurableIdentity refuses while anonymous", () => {
    expect(mayRepresentAsDurableIdentity("anonymous")).toBe(false);
    expect(mayRepresentAsDurableIdentity("authenticated")).toBe(true);
  });

  it("the session-scoped progress record pins its scope (shape = law)", () => {
    const progress = sessionScopedProgress({
      sessionId: "wfxsess_anonymous01",
      itemId: "wfxitm_demo0001",
      positionMs: 120_000,
      updatedAt: "2026-09-21T12:00:00.000Z",
    });
    expect(progress.scope).toBe("session-local");
    expect(isSessionScopedProgress(progress)).toBe(true);
    // Guards reject the honest fakes: durable-scope impostors and
    // malformed records never become anonymous progress.
    expect(
      isSessionScopedProgress({ ...progress, scope: "durable-cross-device" }),
    ).toBe(false);
    expect(isSessionScopedProgress({ ...progress, positionMs: -1 })).toBe(false);
    expect(isSessionScopedProgress({ ...progress, sessionId: "" })).toBe(false);
    expect(isSessionScopedProgress(null)).toBe(false);
  });

  it("sessionScopedProgress validates honestly (typed constructor errors)", () => {
    expect(() =>
      sessionScopedProgress({
        sessionId: "",
        itemId: "wfxitm_demo0001",
        positionMs: 0,
        updatedAt: "2026-09-21T12:00:00.000Z",
      }),
    ).toThrow(/sessionId/);
    expect(() =>
      sessionScopedProgress({
        sessionId: "wfxsess_x",
        itemId: "",
        positionMs: 0,
        updatedAt: "2026-09-21T12:00:00.000Z",
      }),
    ).toThrow(/itemId/);
    expect(() =>
      sessionScopedProgress({
        sessionId: "wfxsess_x",
        itemId: "wfxitm_demo0001",
        positionMs: Number.NaN,
        updatedAt: "2026-09-21T12:00:00.000Z",
      }),
    ).toThrow(/positionMs/);
  });

  it("promotion REFUSES while anonymous (never durable identity)", () => {
    const progress = sessionScopedProgress({
      sessionId: "wfxsess_anonymous01",
      itemId: "wfxitm_demo0001",
      positionMs: 120_000,
      updatedAt: "2026-09-21T12:00:00.000Z",
    });
    const outcome = promoteSessionProgressToDurable(progress, "anonymous");
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") {
      expect(outcome.reason).toContain("session-scoped");
      expect(outcome.reason).toContain("only after authentication");
    }
  });

  it("promotion after authentication is the durable start command (resume position)", () => {
    const progress = sessionScopedProgress({
      sessionId: "wfxsess_anonymous01",
      itemId: "wfxitm_demo0001",
      positionMs: 120_000,
      updatedAt: "2026-09-21T12:00:00.000Z",
    });
    const outcome = promoteSessionProgressToDurable(progress, "authenticated");
    expect(outcome.kind).toBe("promoted");
    if (outcome.kind === "promoted") {
      expect(outcome.command).toEqual({
        kind: "start",
        itemId: "wfxitm_demo0001",
        positionMs: 120_000,
        playbackSessionId: "wfxsess_anonymous01",
      });
    }
  });
});
