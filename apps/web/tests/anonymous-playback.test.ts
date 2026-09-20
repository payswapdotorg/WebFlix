/**
 * R23 web-A anonymous playback tests (bun:test).
 *
 * The anonymous viewing law wired END-TO-END on the booted web host
 * (the real composition root over the fixture transport, deterministic,
 * no network) — consuming Worker 1's frozen R23-A/B contracts verbatim:
 *
 * - THE NO-LOGIN-WALL LAW (J37's forbidden invariant): no public-watch
 *   path routes an anonymous viewer to a login — the typed boundary
 *   structurally cannot answer a WebFlix-login redirect for playback
 *   (`forbidsAnonymousLoginRedirect`), and the rendered player carries
 *   the session-scoped progress truth with sign-in offered as the
 *   OPTIONAL upgrade (never a wall, never a precondition).
 * - THE TYPED ACCESS TRUTH: every Where-to-watch option carries its
 *   access sentence — PUBLIC realizations play for everyone; a
 *   provider's OWN sign-in requirement renders as the source's truth,
 *   distinct from any WebFlix-account requirement.
 * - THE PROVIDER-AUTH FAILURE TRUTH: when playback fails on the
 *   source's authorization, the player's typed failure names the
 *   SOURCE's reconnect path (Settings → Sources) — the sentence
 *   explicitly distinguishes it from a WebFlix account.
 * - THE SESSION-SCOPED PROGRESS LAW: anonymous progress is
 *   session-local (`progressScopeFor`), honestly rendered, and the
 *   post-authentication promotion (`promoteSessionProgressToDurable`)
 *   answers the durable `start` command — the one lawful durable write.
 * - THE EMPTY-QUERY FIX (J05's known defect): an empty search query
 *   answers the typed empty state instead of throwing into the error
 *   boundary.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  authorizePlaybackStart,
  forbidsAnonymousLoginRedirect,
  progressScopeFor,
} from "@wfx/client-runtime";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { loadDetailView, loadPlayerView, loadSearchView } from "../src/host/view-models";
import {
  progressScopeTruthOf,
  promoteAnonymousProgress,
  realizationAccessTruth,
  viewerKindOf,
} from "../src/host/anonymous-truth";
import { anonymousSessionState } from "../src/host/session";
import { ItemDetailSurface } from "../src/components/item/ItemDetailSurface";
import { AppShell } from "../src/components/shell/AppShell";
import { withEnv } from "./fake-web";

beforeEach(() => {
  resetWebHostProcessState();
});

/** Boot the fixture host under a controlled environment. */
async function bootHost(): Promise<WebRuntimeHost> {
  let host: WebRuntimeHost | undefined;
  await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
    host = await getWebRuntimeHost();
  });
  if (host === undefined) throw new Error("the fixture host did not boot");
  return host;
}

/** The full detail markup for one view (the real component tree). */
function detailMarkup(host: WebRuntimeHost, view: Parameters<typeof ItemDetailSurface>[0]["view"]): string {
  return renderToStaticMarkup(
    createElement(AppShell, {
      mode: host.mode,
      session: host.session.state,
      children: createElement(ItemDetailSurface, { view }),
    }),
  );
}

/** Find one item's joined identity through the runtime's search. */
async function itemByTitle(host: WebRuntimeHost, title: string) {
  const model = await host.runtime.search({ query: title });
  const hit = model.hits.find((entry) => entry.result.title === title);
  if (hit === undefined) throw new Error(`no fixture hit for '${title}'`);
  return { itemId: hit.canonicalItemId, result: hit.result };
}

// ---------------------------------------------------------------------------
// The no-login-wall law (the frozen boundary, consumed)
// ---------------------------------------------------------------------------

describe("R23 web-A — the no-login-wall law (J37's forbidden invariant)", () => {
  it("the shared boundary structurally forbids a blanket anonymous login redirect", () => {
    // A public-play capability + an anonymous viewer + a redirect whose
    // ONLY reason is the viewer's anonymity = the forbidden wall.
    expect(
      forbidsAnonymousLoginRedirect("play-public-embed", "anonymous", "viewer-is-anonymous"),
    ).toBe(true);
    // The intent-following destination (the viewer explicitly invoked a
    // capability that needs an account) stays lawful.
    expect(
      forbidsAnonymousLoginRedirect("durable-history", "anonymous", "capability-requires-account"),
    ).toBe(false);
  });

  it("anonymous + public realization => playback may start (the required invariant)", () => {
    const decision = authorizePlaybackStart({
      viewer: "anonymous",
      realization: { mode: "embed", accessClass: "public", connectorId: "fake-source" },
      providerAuthorized: false,
    });
    expect(decision.kind).toBe("playback-may-start");
  });

  it("the decision types carry no login outcome (a provider gap names the provider, never a WebFlix login)", () => {
    const decision = authorizePlaybackStart({
      viewer: "anonymous",
      realization: {
        mode: "embed",
        accessClass: "provider-authorization-required",
        connectorId: "fake-source",
      },
      providerAuthorized: false,
    });
    expect(decision.kind).toBe("provider-authorization-required");
  });
});

// ---------------------------------------------------------------------------
// The typed access truth on the Where-to-watch surface
// ---------------------------------------------------------------------------

describe("R23 web-A — the typed access truth renders on the Where-to-watch row", () => {
  it("every offered option carries an access sentence (public plays for everyone)", async () => {
    const host = await bootHost();
    const { itemId, result } = await itemByTitle(host, "Asteroid Drift");
    const view = await loadDetailView(host, {
      connectorId: result.connectorId,
      externalRef: result.externalRef,
      itemId,
    });
    if (view === null) throw new Error("the detail view did not load");
    expect(view.whereToWatch.viewer).toBe("anonymous");
    expect(view.whereToWatch.options.length).toBeGreaterThan(0);
    for (const option of view.whereToWatch.options) {
      expect(option.accessSentence.length).toBeGreaterThan(0);
    }
    const markup = detailMarkup(host, view);
    // The fixture source's OWN sign-in is active (its seeded persona is
    // signed in), so its provider-gated realizations render the
    // provider-AUTHORIZED chip — playback works without a WebFlix
    // account (the R23-A independence law, visible).
    expect(markup).toContain('data-wfx-watch-access="provider-authorized"');
    // No option renders the missing-sign-in state (the source asks for
    // its own sign-in and it IS active — never a WebFlix-account ask).
    expect(markup).not.toContain('data-wfx-watch-access="provider-sign-in-needed"');
  });

  it("a provider-gated realization renders the SOURCE's requirement, never a WebFlix account", () => {
    // The R23-B fold over a sources read whose connector is NOT signed in.
    const truth = realizationAccessTruth({
      viewer: "anonymous",
      mode: "embed",
      connectorId: "gated-source",
      sources: [
        {
          connectorId: "gated-source",
          displayName: "Gated",
          version: "1",
          authMode: "oauth",
          capabilities: {} as never,
          authState: "signedOut",
          requiresAuthorization: true,
          connected: false,
          accountId: null,
          authorizedAt: null,
          lastStateChange: "2026-09-20T12:00:00.000Z",
          expiresAt: null,
          availabilityNotes: [],
          lastChecked: "2026-09-20T12:00:00.000Z",
        },
      ],
    });
    expect(truth.playbackDecision.kind).toBe("provider-authorization-required");
    expect(truth.sentence).toContain("gated-source's own sign-in");
    expect(truth.sentence).toContain("not a WebFlix account");
  });
});

// ---------------------------------------------------------------------------
// The session-scoped progress truth + the promotion
// ---------------------------------------------------------------------------

describe("R23 web-A — the session-scoped progress law and the lawful promotion", () => {
  it("anonymous progress is session-local; the player renders the truth with the optional upgrade", async () => {
    const host = await bootHost();
    const { itemId, result } = await itemByTitle(host, "Asteroid Drift");
    const view = await loadPlayerView(host, {
      itemId,
      connectorId: result.connectorId,
      externalRef: result.externalRef,
      title: result.title,
      canonicalType: "video",
      preferredMode: "embed",
    });
    expect(view.progressScope.scope).toBe("session-local");
    expect(view.progressScope.offersSignInUpgrade).toBe(true);
    expect(view.progressScope.sentence).toContain("kept for this session");
    const PlayerSurface = (await import("../src/components/player/PlayerSurface")).PlayerSurface;
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement(PlayerSurface, { view }),
      }),
    );
    expect(markup).toContain('data-wfx-player-progress-scope="session-local"');
    expect(markup).toContain("Sign in (optional)");
  });

  it("progressScopeFor keeps the shared vocabulary (anonymous session-local, authenticated durable)", () => {
    expect(progressScopeFor("anonymous")).toBe("session-local");
    expect(progressScopeFor("authenticated")).toBe("durable-cross-device");
    expect(progressScopeTruthOf("anonymous").scope).toBe("session-local");
    expect(progressScopeTruthOf("authenticated").offersSignInUpgrade).toBe(false);
  });

  it("the post-authentication promotion answers the durable start command (the one lawful write)", () => {
    const outcome = promoteAnonymousProgress({
      sessionId: "wfxsess_anon",
      itemId: "wfxitm_0001",
      positionMs: 42_000,
      updatedAt: "2026-09-20T12:00:00.000Z",
    });
    expect(outcome.kind).toBe("promoted");
    if (outcome.kind !== "promoted") return;
    expect(outcome.command.kind).toBe("start");
    expect(outcome.command.itemId).toBe("wfxitm_0001");
    expect(outcome.command.positionMs).toBe(42_000);
  });

  it("the anonymous session menu names the accountless truth (login optional, honestly session-scoped)", () => {
    const state = anonymousSessionState("process-lifetime");
    expect(state.label).toBe("Signed out");
    expect(state.description).toContain("anonymous session");
    expect(state.description).toContain("no account is needed to watch public content");
    expect(viewerKindOf(state)).toBe("anonymous");
  });
});

// ---------------------------------------------------------------------------
// The J05 empty-query fix
// ---------------------------------------------------------------------------

describe("R23 web-A — the empty search query answers the typed empty state (J05 defect fixed)", () => {
  it("an empty query never reaches the runtime (no throw, the honest empty state)", async () => {
    const host = await bootHost();
    const view = await loadSearchView(host, "");
    expect(view.query).toBe("");
    expect(view.cards).toEqual([]);
    expect(view.status.state).toBe("ready");
    const SearchSurface = (await import("../src/components/search/SearchSurface")).SearchSurface;
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement(SearchSurface, { view }),
      }),
    );
    expect(markup).toContain('data-wfx-search-state="empty-query"');
  });

  it("a whitespace-only query is the same typed empty state", async () => {
    const host = await bootHost();
    const view = await loadSearchView(host, "   ");
    expect(view.query).toBe("");
    expect(view.cards).toEqual([]);
  });
});
