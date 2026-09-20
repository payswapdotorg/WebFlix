/**
 * R23-W3 — the R23-A/B open-viewing surface tests (the Desktop anonymous
 * semantics: accountless public surfaces, the no-login-wall law, the
 * provider-auth vs WebFlix-account distinction, session-scoped progress).
 */

import { describe, expect, it } from "bun:test";

import { ANONYMOUS_VIEWING_MATRIX } from "@wfx/client-runtime";
import { bootR23, R23_ITEM } from "./r23-harness";
import { makeSource } from "./r22-fixtures";

describe("R23-W3 open-viewing — the anonymous session truth (R23-A)", () => {
  it("every public surface opens anonymously (home/watch/shorts/search/library/settings)", () => {
    const boot = bootR23(); // the default viewer is anonymous
    const view = boot.openViewing.viewingView();
    expect(view.viewer).toBe("anonymous");
    expect(view.progressScope).toBe("session-local"); // the invariant-4 law
    for (const surface of view.surfaces) {
      expect(surface.openAnonymously).toBe(true); // the frozen law — every primary surface
    }
    expect(view.surfaces.map((surface) => surface.surface)).toEqual([
      "home",
      "watch",
      "shorts",
      "search",
      "library",
      "settings",
    ]);
  });

  it("the matrix rows all resolve (anonymous-class rows open; account rows carry the typed prerequisite)", () => {
    const boot = bootR23();
    const view = boot.openViewing.viewingView();
    expect(view.rows).toHaveLength(ANONYMOUS_VIEWING_MATRIX.length);
    const accountRows = view.rows.filter((row) => row.entry.authClass === "webflix-account");
    expect(accountRows.length).toBeGreaterThan(0);
    for (const row of accountRows) {
      expect(row.access.kind).toBe("sign-in-prerequisite"); // the typed prerequisite, never a wall
    }
    const anonymousRows = view.rows.filter((row) => row.entry.authClass === "anonymous");
    for (const row of anonymousRows) {
      expect(row.access.kind).toBe("open");
    }
  });

  it("the authenticated viewer keeps accountless viewing (signing in never REMOVES it)", () => {
    const boot = bootR23({ viewer: "authenticated" });
    const view = boot.openViewing.viewingView();
    expect(view.viewer).toBe("authenticated");
    expect(view.progressScope).toBe("durable-cross-device");
    const anonymousRows = view.rows.filter((row) => row.entry.authClass === "anonymous");
    for (const row of anonymousRows) {
      expect(row.access.kind).toBe("open"); // J37's "login remains available but optional"
    }
    expect(view.accountNote).toContain("signed in");
  });
});

describe("R23-W3 open-viewing — the playback boundary (R23-B, the no-login-wall law)", () => {
  it("anonymous + public realization => playback MAY start (the required invariant)", () => {
    const boot = bootR23();
    const decision = boot.openViewing.playbackAuthorization({
      realization: { mode: "embed", connectorId: "youtube", accessClass: "public" },
    });
    expect(decision.kind).toBe("playback-may-start");
    if (decision.kind === "playback-may-start") {
      expect(decision.detail).toContain("no account");
    }
  });

  it("the authorized PEER COPY is a public realization (the R23-C access class)", () => {
    const boot = bootR23();
    const decision = boot.openViewing.playbackAuthorization({
      realization: { mode: "native", connectorId: "authorized-peer-copy", accessClass: "public" },
    });
    expect(decision.kind).toBe("playback-may-start"); // anonymous viewers may play the peer copy
  });

  it("a provider-authorization gap needs the PROVIDER's sign-in — never a WebFlix login", () => {
    const boot = bootR23();
    const decision = boot.openViewing.playbackAuthorization({
      realization: {
        mode: "embed",
        connectorId: "some-premium-source",
        accessClass: "provider-authorization-required",
      },
    });
    expect(decision.kind).toBe("provider-authorization-required");
    if (decision.kind === "provider-authorization-required") {
      expect(decision.connectorId).toBe("some-premium-source");
      expect(decision.action.kind).toBe("provider-authorization");
      expect(decision.action.detail).toContain("not a WebFlix account"); // the distinct-truths law
    }
  });

  it("the provider's own active authorization satisfies the gap (independent of any WebFlix account)", () => {
    const boot = bootR23();
    // Observe the provider's signed-in truth through the runtime's source store.
    boot.runtime.sources.observe(
      makeSource({
        connectorId: "some-premium-source",
        displayName: "Premium Source",
        authState: "signedIn",
        requiresAuthorization: true,
        connected: true,
        accountId: "acct-premium",
      }),
    );
    const decision = boot.openViewing.playbackAuthorization({
      realization: {
        mode: "embed",
        connectorId: "some-premium-source",
        accessClass: "provider-authorization-required",
      },
    });
    expect(decision.kind).toBe("playback-may-start");
    if (decision.kind === "playback-may-start") {
      expect(decision.detail).toContain("with or without a WebFlix account");
    }
  });

  it("the observed-source access-class derivation never guesses", () => {
    const boot = bootR23();
    boot.runtime.sources.observe(
      makeSource({
        connectorId: "public-source",
        displayName: "Public Source",
        authMode: "none",
        requiresAuthorization: false,
        authState: "signedOut",
      }),
    );
    expect(
      boot.openViewing.realizationAccess({ connectorId: "public-source" }),
    ).toBe("public");
    expect(
      boot.openViewing.realizationAccess({ connectorId: "never-observed" }),
    ).toBe("public"); // unobserved connectors carry no requirement (the observed-rows law)
  });
});

describe("R23-W3 open-viewing — the no-login-wall law (machine-checked)", () => {
  it("an anonymous viewer on a public-watch capability is NEVER redirected to login", () => {
    const boot = bootR23();
    // Every anonymous-class capability (the public-watch rows): the
    // viewer-is-anonymous redirect is FORBIDDEN for every reason.
    const publicRows = ANONYMOUS_VIEWING_MATRIX.filter((row) => row.authClass === "anonymous");
    expect(publicRows.length).toBeGreaterThan(4);
    for (const row of publicRows) {
      expect(
        boot.openViewing.loginRedirectLawful(row.capability, "viewer-is-anonymous"),
      ).toBe(false);
    }
  });

  it("a provider-authorization gap is never satisfied by a login redirect either", () => {
    const boot = bootR23();
    const providerRows = ANONYMOUS_VIEWING_MATRIX.filter(
      (row) => row.authClass === "provider-authorized",
    );
    expect(providerRows.length).toBeGreaterThan(0);
    for (const row of providerRows) {
      expect(
        boot.openViewing.loginRedirectLawful(row.capability, "provider-requires-own-authorization"),
      ).toBe(false);
    }
  });

  it("an invoked account capability MAY land on sign-in (the lawful intent-following destination)", () => {
    const boot = bootR23();
    const accountRows = ANONYMOUS_VIEWING_MATRIX.filter(
      (row) => row.authClass === "webflix-account",
    );
    for (const row of accountRows) {
      expect(
        boot.openViewing.loginRedirectLawful(row.capability, "capability-requires-account"),
      ).toBe(true); // the user asked for the account-requiring journey
      expect(
        boot.openViewing.loginRedirectLawful(row.capability, "viewer-is-anonymous"),
      ).toBe(false); // the blanket wall is still forbidden
    }
  });
});

describe("R23-W3 open-viewing — the session-scoped progress law (invariant 4)", () => {
  it("anonymous progress records stay session-local (the typed shape carries the law)", () => {
    const boot = bootR23();
    const progress = boot.openViewing.recordSessionProgress({
      itemId: R23_ITEM,
      positionMs: 74_000,
    });
    expect(progress.scope).toBe("session-local");
    expect(progress.itemId).toBe(R23_ITEM);
    expect(progress.positionMs).toBe(74_000);
    expect(progress.sessionId).toBe("wfx-desktop-r23-session");
  });

  it("the anonymous promotion REFUSES (progress is never durable identity before authentication)", () => {
    const boot = bootR23();
    const progress = boot.openViewing.recordSessionProgress({
      itemId: R23_ITEM,
      positionMs: 74_000,
    });
    const promotion = boot.openViewing.promoteProgress(progress);
    expect(promotion.kind).toBe("refused");
    if (promotion.kind === "refused") {
      expect(promotion.reason).toContain("session-scoped");
      expect(promotion.reason).toContain("only after authentication");
    }
  });

  it("the post-authentication promotion is the watch state's own start command (the lawful bridge)", () => {
    const boot = bootR23();
    const progress = boot.openViewing.recordSessionProgress({
      itemId: R23_ITEM,
      positionMs: 74_000,
    });
    // The viewer authenticates: the session truth flips.
    const authenticated = bootR23({ viewer: "authenticated" });
    // The progress record is session-scoped data — the promotion consults
    // the CURRENT viewer truth.
    const promotion = authenticated.openViewing.promoteProgress(progress);
    expect(promotion.kind).toBe("promoted");
    if (promotion.kind === "promoted") {
      expect(promotion.command.kind).toBe("start");
      expect(promotion.command.itemId).toBe(R23_ITEM);
      expect(promotion.command.positionMs).toBe(74_000);
    }
  });
});
