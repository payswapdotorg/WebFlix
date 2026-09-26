/**
 * R31 §G2 — THE SUBSCRIPTIONS-FEED GRID tests (bun:test).
 *
 * The healthy subs-feed grid, now captured (GAP-CORPUS.md §2,
 * docs/parity-lab/r30/gap-captures/20260926-052954/g2-subs-feed.json +
 * .jpg — the healthy window's 14 real cards in the two-column browse
 * grid), proven against WebFlix's REAL stored truth:
 *
 * - THE DATA TRUTH: the grid renders the SAME fold the rail's
 *   Subscriptions section and the Library's Subscriptions list render
 *   (the R30-A hydrate seam — entries subscribed through the REAL
 *   POST /api/library write, read back through accountChromeViewOf).
 * - THE GRID GRAMMAR: the captured "Latest" heading + the browse card
 *   grid; each card follows the rail rows' own route law (the entry's
 *   JOINED player surface through playerHref).
 * - THE UNLINKED LAW: an entry this process never joined renders the
 *   honest unlinked cell — never a fabricated link.
 * - THE EMPTY STATE: no subscriptions stored = the honest empty state
 *   in the capability row's own vocabulary — never a fabricated card.
 * - THE ROUTE: /feed/subscriptions is a PRESENTATION ROUTE (the
 *   /player law — the runtime's frozen SurfaceId set is untouched; the
 *   deep-link sync keeps the current navigation state).
 * - THE RAIL SEAM: the rail's Subscriptions section heading carries
 *   the feed's destination (the corpus taxonomy's Subscriptions entry —
 *   the Playlists-row precedent's own join).
 *
 * Determinism: fixture transport (the persona's library state starts
 * pristine), controlled env (restored), no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import {
  FIXTURE_AUTH_EMAIL,
  FIXTURE_AUTH_PASSWORD,
  driveFixtureLogin,
  resetFixtureAuthStateForTests,
  fixtureSessionView,
} from "../src/host/auth-fixtures";
import { accountChromeViewOf } from "../src/host/account-chrome";
import type { RequestSessionView } from "../src/host/request-session-view";
import { loadSearchView } from "../src/host/view-models";
import { SubscriptionsFeedSurface } from "../src/components/discovery/SubscriptionsFeedSurface";
import { RailSubscriptions } from "../src/components/shell/RailSubscriptions";
import { AppShell } from "../src/components/shell/AppShell";
import { POST as postLibrary } from "../src/app/api/library/route";
import { deriveNavigationState, syncNavigationToRoute } from "../src/app/routing";
import { withEnv } from "./fake-web";

// ---------------------------------------------------------------------------
// Helpers (the account-chrome house style)
// ---------------------------------------------------------------------------

/** Boot the fixture host under a controlled environment. */
async function bootHost(): Promise<WebRuntimeHost> {
  let host: WebRuntimeHost | undefined;
  await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
    host = await getWebRuntimeHost();
  });
  if (host === undefined) throw new Error("the fixture host did not boot");
  return host;
}

/** POST one JSON body to a route handler (the real handler, no network). */
async function post(handler: (request: Request) => Promise<Response>, body: unknown): Promise<Response> {
  return handler(
    new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** The signed-in request session view (the persona's own fields). */
function signedInSessionViewOfPersona(): RequestSessionView {
  driveFixtureLogin(FIXTURE_AUTH_EMAIL, FIXTURE_AUTH_PASSWORD);
  const view = fixtureSessionView();
  const active = view.profiles.find((profile) => profile.id === view.activeProfileId);
  return {
    signedIn: true,
    ...(active !== undefined ? { profileName: active.displayName } : {}),
    account: {
      profiles: view.profiles.map((profile) => ({
        id: profile.id,
        displayName: profile.displayName,
      })),
      activeProfileId: view.activeProfileId,
      email: view.user.email,
    },
  };
}

/**
 * Subscribe one fixture item through the REAL seam (the Subscribe pill's
 * own write: POST /api/library with the frozen Subscriptions list name),
 * optionally JOINING it first through the search view (the surfaces'
 * own law — the join learns from the views).
 */
async function subscribeFixtureItem(
  host: WebRuntimeHost,
  fields: { readonly itemId: string; readonly title: string; readonly connectorId: string; readonly externalRef: string },
): Promise<void> {
  const response = await post(postLibrary, {
    op: "save",
    itemId: fields.itemId,
    title: fields.title,
    connectorId: fields.connectorId,
    externalRef: fields.externalRef,
    listName: "Subscriptions",
  });
  const body = (await response.json()) as { ok?: boolean; entry?: { listName?: string } };
  if (body.ok !== true) throw new Error(`the subscribe write failed: ${JSON.stringify(body)}`);
  if (body.entry?.listName !== "Subscriptions") {
    throw new Error("the subscribe write did not land in the Subscriptions list");
  }
}

/** Resolve one fixture item's canonical id through the runtime's search seam. */
async function fixtureItemId(host: WebRuntimeHost, title: string): Promise<string> {
  const model = await host.runtime.search({ query: title });
  const hit = model.hits.find((entry) => entry.result.title === title);
  if (hit === undefined) throw new Error(`fixture item '${title}' not found`);
  return hit.canonicalItemId;
}

beforeEach(() => {
  resetWebHostProcessState();
  resetFixtureAuthStateForTests();
});

// ---------------------------------------------------------------------------
// The grid — the stored truth through the REAL subscribe seam
// ---------------------------------------------------------------------------

describe("R31 §G2 the subscriptions-feed grid (GAP-CORPUS: the healthy window's browse grid over the stored truth)", () => {
  it("the grid renders the SAME stored truth the rail lists (the hydrate seam's fold — never a new source)", async () => {
    const host = await bootHost();
    // The real page flow: the search view populates the item join, then
    // the Subscribe pill's own write files the item.
    await loadSearchView(host, "Deep Field Diary", {});
    const sessionView = signedInSessionViewOfPersona();
    const itemId = await fixtureItemId(host, "Deep Field Diary");
    await subscribeFixtureItem(host, {
      itemId,
      title: "Deep Field Diary",
      connectorId: "fake-source",
      externalRef: "fake:video-1",
    });
    const view = await accountChromeViewOf(host, sessionView);
    expect(view.railSubscriptions.length).toBe(1);
    // The grid surface takes the view's own entries — the SAME array the
    // rail renders (structural: one truth, two surfaces).
    const markup = renderToStaticMarkup(
      createElement(SubscriptionsFeedSurface, { entries: view.railSubscriptions }),
    );
    expect(markup).toContain("data-wfx-subsfeed");
    expect(markup).toContain("data-wfx-subsfeed-grid");
    expect(markup).toContain(`data-wfx-subsfeed-entry="${itemId}"`);
    expect(markup).toContain("Deep Field Diary");
    // The captured section heading ("Latest" — present in both captured
    // states: the healthy grid + the R30 degraded window).
    expect(markup).toContain("data-wfx-subsfeed-heading");
    expect(markup).toContain("Latest");
  });

  it("the card grammar: the joined connector read (title + the card's own source identity) + the rail rows' route law (the player destination)", async () => {
    const host = await bootHost();
    await loadSearchView(host, "Deep Field Diary", {});
    const sessionView = signedInSessionViewOfPersona();
    const itemId = await fixtureItemId(host, "Deep Field Diary");
    await subscribeFixtureItem(host, {
      itemId,
      title: "Deep Field Diary",
      connectorId: "fake-source",
      externalRef: "fake:video-1",
    });
    const view = await accountChromeViewOf(host, sessionView);
    const markup = renderToStaticMarkup(
      createElement(SubscriptionsFeedSurface, { entries: view.railSubscriptions }),
    );
    // The card: the SAME card grammar every feed surface renders (the
    // seam law — ItemCard, never a new card family).
    expect(markup).toContain("wfx-card__title");
    expect(markup).toContain("From fake-source");
    // The route law: the card's destination is the entry's own player
    // surface — the SAME law the rail's rows follow (playerHref).
    const escapedId = itemId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const cardHref = markup.match(new RegExp(`href="/player\\?[^"]*id=${escapedId}[^"]*"`));
    expect(cardHref).not.toBeNull();
    // The rail's own row for the same entry carries the same destination
    // (one law, two surfaces).
    const railMarkup = renderToStaticMarkup(
      createElement(RailSubscriptions, { entries: view.railSubscriptions }),
    );
    expect(railMarkup).toContain(`data-wfx-rail-subscription-link="${itemId}"`);
    const railHref = railMarkup.match(/href="(\/player\?[^"]*)"/);
    expect(railHref).not.toBeNull();
    expect(cardHref![0]!.startsWith('href="/player?')).toBe(true);
  });

  it("the captured multi-card grid: every stored entry lists (the healthy window's 14-card grammar over WebFlix's real store)", async () => {
    const host = await bootHost();
    // Join + subscribe THREE real fixture items through the same seams.
    await loadSearchView(host, "Deep Field Diary", {});
    await loadSearchView(host, "Static Bloom", {});
    await loadSearchView(host, "Desert Rain Doc", {});
    const sessionView = signedInSessionViewOfPersona();
    for (const fields of [
      { title: "Deep Field Diary", externalRef: "fake:video-1" },
      { title: "Static Bloom", externalRef: "fake:video-2" },
      { title: "Desert Rain Doc", externalRef: "fake:video-3" },
    ]) {
      await subscribeFixtureItem(host, {
        itemId: await fixtureItemId(host, fields.title),
        title: fields.title,
        connectorId: "fake-source",
        externalRef: fields.externalRef,
      });
    }
    const view = await accountChromeViewOf(host, sessionView);
    expect(view.railSubscriptions.length).toBe(3);
    const markup = renderToStaticMarkup(
      createElement(SubscriptionsFeedSurface, { entries: view.railSubscriptions }),
    );
    const cells = markup.match(/data-wfx-subsfeed-entry="/g) ?? [];
    expect(cells.length).toBe(3);
    for (const title of ["Deep Field Diary", "Static Bloom", "Desert Rain Doc"]) {
      expect(markup).toContain(title);
    }
    // The grid never fabricates the captured meta line's absent data:
    // no view counts, no ages (the domain model carries neither).
    expect(markup).not.toMatch(/\d+[KM]?\s+\d+[hdm]/);
    expect(markup).not.toContain("watching");
    expect(markup).not.toContain("LIVE");
  });

  it("an entry this process never joined renders the honest UNLINKED cell (never a fabricated link)", async () => {
    const host = await bootHost();
    const sessionView = signedInSessionViewOfPersona();
    const itemId = await fixtureItemId(host, "Deep Field Diary");
    // NOTE: NO view loader ran — the join map is empty for this item.
    await subscribeFixtureItem(host, {
      itemId,
      title: "Deep Field Diary",
      connectorId: "fake-source",
      externalRef: "fake:video-1",
    });
    const view = await accountChromeViewOf(host, sessionView);
    expect(view.railSubscriptions[0]!.joined).toBeNull();
    const markup = renderToStaticMarkup(
      createElement(SubscriptionsFeedSurface, { entries: view.railSubscriptions }),
    );
    expect(markup).toContain(`data-wfx-subsfeed-unlinked="${itemId}"`);
    expect(markup).toContain("Source unknown in this session");
    expect(markup).not.toContain("href=\"/player?");
  });

  it("the empty state: no subscriptions stored = the honest empty state in the capability row's own vocabulary", async () => {
    const host = await bootHost();
    const view = await accountChromeViewOf(host, signedInSessionViewOfPersona());
    expect(view.railSubscriptions).toEqual([]);
    const markup = renderToStaticMarkup(
      createElement(SubscriptionsFeedSurface, { entries: view.railSubscriptions }),
    );
    expect(markup).toContain("data-wfx-empty");
    expect(markup).toContain("No subscriptions yet");
    expect(markup).toContain("Subscribe from any watch page");
    // Never a fabricated card.
    expect(markup).not.toContain("data-wfx-subsfeed-entry");
    expect(markup).not.toContain("wfx-card__title");
  });
});

// ---------------------------------------------------------------------------
// The route — the presentation-route law (the /player precedent)
// ---------------------------------------------------------------------------

describe("R31 §G2 the feed route (the presentation-route class — the frozen SurfaceId set untouched)", () => {
  it("/feed/subscriptions derives as a presentation route (never a new navigation state)", () => {
    expect(deriveNavigationState("/feed/subscriptions", {})).toMatchObject({
      ok: false,
      reason: "presentation-route",
    });
  });

  it("the deep-link sync keeps the current navigation state on the feed route (the /player law)", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const host = await getWebRuntimeHost();
      host.runtime.navigation.navigate({ surface: "watch" });
      const { state, invalidReason } = syncNavigationToRoute(host.runtime, "/feed/subscriptions", {});
      expect(invalidReason).toBeNull();
      expect(state).toEqual({ surface: "watch" });
    });
  });
});

// ---------------------------------------------------------------------------
// The rail seam — the heading carries the feed's destination
// ---------------------------------------------------------------------------

describe("R31 §G2 the rail seam (the corpus taxonomy's Subscriptions entry → the feed destination)", () => {
  it("the section heading carries /feed/subscriptions (the captured corpus URL — the Playlists-row precedent's join)", async () => {
    const host = await bootHost();
    await loadSearchView(host, "Deep Field Diary", {});
    const sessionView = signedInSessionViewOfPersona();
    const itemId = await fixtureItemId(host, "Deep Field Diary");
    await subscribeFixtureItem(host, {
      itemId,
      title: "Deep Field Diary",
      connectorId: "fake-source",
      externalRef: "fake:video-1",
    });
    const view = await accountChromeViewOf(host, sessionView);
    const markup = renderToStaticMarkup(
      createElement(RailSubscriptions, { entries: view.railSubscriptions }),
    );
    // The heading link: the taxonomy join, one element.
    expect(markup).toContain('href="/feed/subscriptions"');
    expect(markup).toContain("data-wfx-rail-subscriptions-heading");
    expect(markup).toContain(">Subscriptions</a>");
    // The rows are UNCHANGED (the seam law): the 24x24 monogram avatar +
    // the entry's own player destination still render per R30-B.
    expect(markup).toContain("wfx-railsub__avatar");
    expect(markup).toContain(`data-wfx-rail-subscription-link="${itemId}"`);
  });

  it("the signed-in shell renders the heading link inside the rail (the feed joins the real navigation)", async () => {
    const host = await bootHost();
    await loadSearchView(host, "Deep Field Diary", {});
    const sessionView = signedInSessionViewOfPersona();
    const itemId = await fixtureItemId(host, "Deep Field Diary");
    await subscribeFixtureItem(host, {
      itemId,
      title: "Deep Field Diary",
      connectorId: "fake-source",
      externalRef: "fake:video-1",
    });
    const view = await accountChromeViewOf(host, sessionView);
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        account: view,
        children: createElement("p", null, "content"),
      }),
    );
    expect(markup).toContain('href="/feed/subscriptions"');
    expect(markup).toContain("data-wfx-rail-subscriptions-heading");
    // The signed-out shell stays byte-identical (the pinned control):
    // the section renders ONLY in the signed-in chrome.
    const signedOut = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement("p", null, "content"),
      }),
    );
    expect(signedOut).not.toContain("data-wfx-rail-subscriptions-heading");
    expect(signedOut).not.toContain('href="/feed/subscriptions"');
  });
});
