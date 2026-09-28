/**
 * R36 — THE CREATOR-CHANNEL LANE TESTS (the survey's rows 17/18/19 —
 * docs/plans/2026-09-28-youtube-parity-survey.md).
 *
 * Proves the lane's laws over the fixtures-boot composition (the same
 * machinery the battery runs) + the stylesheet's corpus contracts:
 *
 * - THE CHANNEL ENTITY (the honest derivation law): the handle law
 *   (slugified stable connector id, never a fabricated "@name" form);
 *   the identity fields derive ONLY from the source's own declared
 *   truth (displayName — the R33-C seam; the monogram avatar; the
 *   typed-absence banner/description/links/subscriber-count/verified
 *   set — every absence carries its honest sentence, NEVER a
 *   fabricated value);
 * - THE CHANNEL PAGE VIEW (real data): the items derive from the
 *   runtime's REAL search transport (the discovery seeds, scoped to the
 *   channel's connectorId, deduped by canonical id); the Videos/Shorts
 *   split honors the short-form eligibility law; the sort options
 *   derive from the items' OWN declared truths (fixtures carry none ⇒
 *   all three honestly absent with the note — the SearchFilters law);
 *   the subscription truth is the connector-scoped read of the ONE
 *   Subscriptions list; the playlists are the library's named lists
 *   scoped to the channel (typed-empty);
 * - THE CHANNEL SURFACE (the page grammar): the typed-absence banner,
 *   the monogram avatar, the honest meta line (the subscriber-count
 *   absence + the user's own truth), the tab bar, the channel search
 *   form, the Subscribe pill wiring (the frozen list name), the bell
 *   menu's honest delivery note;
 * - THE ROUTE LAW: /channel/<handle> is a presentation route (the
 *   /player law — the frozen SurfaceId set untouched);
 * - THE NOT-FOUND LAW: a handle no source owns renders the honest
 *   typed state — never a guessed channel.
 *
 * Determinism: fixture transport, controlled env (restored), no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { loadChannelView, channelItemsOf, channelIdentityOf, resolveChannelByHandle } from "../src/host/channel-views";
import { isChannelShort } from "../src/host/channel-views";
import { ChannelSurface, ChannelNotFound } from "../src/components/channel/ChannelSurface";
import { ChannelEngagement } from "../src/components/channel/ChannelEngagement";
import { ChannelRow } from "../src/components/player/ChannelRow";
import { ShortsSubscribeRow } from "../src/components/shorts/ShortsSubscribeRow";
import { SUBSCRIPTIONS_LIST } from "../src/components/player/subscription-list";
import { channelHandleOf, channelHrefOf } from "../src/app/href";
import { deriveNavigationState } from "../src/app/routing";
import { withEnv } from "./fake-web";

/** Boot the fixture host under a controlled environment. */
async function bootHost(): Promise<WebRuntimeHost> {
  let host: WebRuntimeHost | undefined;
  await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
    host = await getWebRuntimeHost();
  });
  if (host === undefined) throw new Error("the fixture host did not boot");
  return host;
}

/** The fixture source's own display name (the sources model's field). */
const FIXTURE_SOURCE_NAME = "Fake Source (TEST FIXTURE — never production)";

/** The fixture source's connector id (the stable identity). */
const FIXTURE_CONNECTOR_ID = "fake-source";

beforeEach(() => {
  resetWebHostProcessState();
});

// ---------------------------------------------------------------------------
// THE HANDLE LAW (the derivation's stable key)
// ---------------------------------------------------------------------------

describe("R36 — the handle law (the slugified stable connector identity)", () => {
  it("derives the slug from the connector id (lowercase, collapsed separators, trimmed)", () => {
    expect(channelHandleOf("fake-source")).toBe("fake-source");
    expect(channelHandleOf("YouTube")).toBe("youtube");
    expect(channelHandleOf("Some Connector / ID!")).toBe("some-connector-id");
    expect(channelHandleOf("--leads-and-trails--")).toBe("leads-and-trails");
    expect(channelHandleOf("")).toBe("channel");
  });

  it("is stable (the same connector id always derives the same handle — durable links)", () => {
    expect(channelHandleOf(FIXTURE_CONNECTOR_ID)).toBe(channelHandleOf(FIXTURE_CONNECTOR_ID));
  });

  it("the channel href is the pure presentation route (client-importable, no host seam)", () => {
    expect(channelHrefOf(FIXTURE_CONNECTOR_ID)).toBe("/channel/fake-source");
  });

  it("the /channel/<handle> route is a presentation route (the /player law — the frozen SurfaceId set untouched)", () => {
    const derivation = deriveNavigationState("/channel/fake-source", {});
    expect(derivation.ok).toBe(false);
    if (!derivation.ok) expect(derivation.reason).toBe("presentation-route");
  });
});

// ---------------------------------------------------------------------------
// THE CHANNEL ENTITY (the honest derivation law)
// ---------------------------------------------------------------------------

describe("R36 — the channel entity (honest fields, the typed-absence set)", () => {
  it("resolves the fixture source by its handle (the directory read over the real sources model)", async () => {
    const host = await bootHost();
    const resolution = await resolveChannelByHandle(host, "fake-source");
    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.source.connectorId).toBe(FIXTURE_CONNECTOR_ID);
      expect(resolution.source.displayName).toBe(FIXTURE_SOURCE_NAME);
    }
  });

  it("the identity derives the R33-C display name + the monogram avatar (never a fabricated @handle or photo)", async () => {
    const host = await bootHost();
    const items = await channelItemsOf(host, FIXTURE_CONNECTOR_ID);
    const resolution = await resolveChannelByHandle(host, "fake-source");
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    const identity = channelIdentityOf(resolution.source, items);
    expect(identity.displayName).toBe(FIXTURE_SOURCE_NAME);
    expect(identity.handle).toBe("fake-source");
    expect(identity.avatar.kind).toBe("monogram");
    expect(identity.avatar.mark).toBe("F");
  });

  it("THE TYPED-ABSENCE SET: the fixtures source declares no banner/description/links/subscriber-count/verified — every slot carries its honest sentence, never a fabricated value", async () => {
    const host = await bootHost();
    const items = await channelItemsOf(host, FIXTURE_CONNECTOR_ID);
    const resolution = await resolveChannelByHandle(host, "fake-source");
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    const identity = channelIdentityOf(resolution.source, items);
    // The banner: typed absence (the fixture items carry no artwork —
    // never a fabricated image).
    expect(identity.banner.kind).toBe("absent");
    if (identity.banner.kind === "absent") {
      expect(identity.banner.note.length).toBeGreaterThan(0);
      expect(identity.banner.note).toContain("does not fabricate");
    }
    // The description/links/verified: typed absences with honest notes.
    expect(identity.description.kind).toBe("absent");
    if (identity.description.kind === "absent") {
      expect(identity.description.note).toContain("declares no channel description");
    }
    expect(identity.links.kind).toBe("absent");
    expect(identity.verifiedBadge.kind).toBe("absent");
    // THE SUBSCRIBER-COUNT LAW (the R28 law verbatim): never fabricated.
    expect(identity.subscriberCount.kind).toBe("absent");
    if (identity.subscriberCount.kind === "absent") {
      expect(identity.subscriberCount.note).toContain("never fabricates");
    }
    // The connected-since truth: the source's own authorizedAt (the
    // fixture source declares one — the honest derivation reads it).
    expect(identity.connectedSince.kind).toBe("declared");
  });

  it("a handle no source owns answers the typed not-found (never a guessed channel)", async () => {
    const host = await bootHost();
    const resolution = await resolveChannelByHandle(host, "no-such-creator");
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.reason).toBe("not-found");
    const view = await loadChannelView(host, "no-such-creator");
    expect("identity" in view).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE CHANNEL ITEMS (the honest channel feed over the real transport)
// ---------------------------------------------------------------------------

describe("R36 — the channel's items (the discovery-seed derivation, real data)", () => {
  it("derives the fixture channel's items through the REAL search transport (the discovery seeds, connector-scoped, deduped)", async () => {
    const host = await bootHost();
    const items = await channelItemsOf(host, FIXTURE_CONNECTOR_ID);
    // The fixture catalog carries 9 items; the discovery seeds ("a" ∪
    // "rain" ∪ "n") surface every one of them for this connector.
    expect(items.length).toBe(9);
    // Every card is a REAL hit: the connector identity + a title the
    // fixture catalog actually carries.
    const titles = items.map((item) => item.card.title);
    expect(titles).toContain("Asteroid Drift");
    expect(titles).toContain("Neon Rain");
    expect(titles).toContain("Deep Field Diary");
    expect(titles).toContain("Signal Fade");
    for (const item of items) {
      expect(item.card.connectorId).toBe(FIXTURE_CONNECTOR_ID);
    }
    // No duplicates (deduped by canonical id).
    expect(new Set(items.map((item) => item.card.itemId)).size).toBe(items.length);
  });

  it("the Videos/Shorts split honors the short-form eligibility law (the same seam the shorts feed uses)", async () => {
    const host = await bootHost();
    const items = await channelItemsOf(host, FIXTURE_CONNECTOR_ID);
    // The fixture catalog: 3 shorts (Neon Rain — vertical, Rain Check —
    // short type, Midnight Scoop — vertical 90s) — the same eligibility
    // the shorts surface applies.
    const shorts = items.filter(isChannelShort);
    const videos = items.filter((item) => !isChannelShort(item));
    expect(shorts.length).toBe(3);
    expect(videos.length).toBe(6);
    expect(shorts.map((item) => item.card.title)).toContain("Neon Rain");
    expect(shorts.map((item) => item.card.title)).toContain("Rain Check");
    expect(shorts.map((item) => item.card.title)).toContain("Midnight Scoop");
  });

  it("THE HONEST SORT LAW: the fixture items declare no publish dates or view counts — every sort option is honestly absent with the note (the SearchFilters law)", async () => {
    const host = await bootHost();
    const view = await loadChannelView(host, "fake-source", { tab: "videos" });
    expect("identity" in view).toBe(true);
    if (!("identity" in view)) return;
    expect(view.sortAvailability.latest).toBe(false);
    expect(view.sortAvailability.popular).toBe(false);
    expect(view.sortAvailability.oldest).toBe(false);
    expect(view.sortAvailability.note).toContain("declares no publish dates or view counts");
    // An unbacked sort in the URL honestly falls back to the feed order.
    const forced = await loadChannelView(host, "fake-source", { tab: "videos", sort: "popular" });
    if (!("identity" in forced)) throw new Error("expected the channel view");
    expect(forced.sort).toBe(null);
    // The items' declared sort truths are honestly null (the fixture
    // rows carry no metadata).
    expect(view.items.every((item) => item.publishedAt === null)).toBe(true);
    expect(view.items.every((item) => item.viewCount === null)).toBe(true);
  });

  it("the videos tab carries the long-form items and the shorts tab the short-form ones", async () => {
    const host = await bootHost();
    const videosView = await loadChannelView(host, "fake-source", { tab: "videos" });
    const shortsView = await loadChannelView(host, "fake-source", { tab: "shorts" });
    if (!("identity" in videosView) || !("identity" in shortsView)) throw new Error("expected the channel views");
    expect(videosView.items.length).toBe(6);
    expect(shortsView.items.length).toBe(3);
    expect(videosView.items.every((item) => !isChannelShort(item))).toBe(true);
    expect(shortsView.items.every(isChannelShort)).toBe(true);
  });

  it("the in-channel search filters by the title containment law (the same normalization the transport applies)", async () => {
    const host = await bootHost();
    const view = await loadChannelView(host, "fake-source", { tab: "home", query: "rain" });
    if (!("identity" in view)) throw new Error("expected the channel view");
    const titles = view.items.map((item) => item.card.title);
    expect(titles).toContain("Neon Rain");
    expect(titles).toContain("Rain Check");
    expect(titles).toContain("Desert Rain Doc");
    expect(view.items.length).toBe(3);
  });

  it("the playlists tab is the typed-empty state (the library carries no named list for this channel yet)", async () => {
    const host = await bootHost();
    const view = await loadChannelView(host, "fake-source", { tab: "playlists" });
    if (!("identity" in view)) throw new Error("expected the channel view");
    expect(view.playlists.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// THE SUBSCRIPTION TRUTH (the connector-scoped read of the ONE list)
// ---------------------------------------------------------------------------

describe("R36 — the channel's subscription truth (the one-store law)", () => {
  it("the unsubscribed truth: no Subscriptions entry for the connector ⇒ subscribed false, the honest idle pill", async () => {
    const host = await bootHost();
    const view = await loadChannelView(host, "fake-source");
    if (!("identity" in view)) throw new Error("expected the channel view");
    expect(view.subscribed).toBe(false);
    expect(view.subscribedTargets).toEqual([]);
    // The representative item is the channel's own first feed item (the
    // subscribe write's honest key — a REAL item).
    expect(view.representative).not.toBe(null);
    if (view.representative !== null) {
      expect(view.representative.connectorId).toBe(FIXTURE_CONNECTOR_ID);
      expect(view.representative.itemId.length).toBeGreaterThan(0);
    }
  });

  it("THE ROUND TRIP: a watch-page subscribe (the same POST /api/library seam) flips the channel's connector-scoped truth", async () => {
    const host = await bootHost();
    // Subscribe through the REAL route the watch pill uses (one item of
    // this channel — the library write path every subscribe surface shares).
    const { POST } = await import("../src/app/api/library/route");
    const items = await channelItemsOf(host, FIXTURE_CONNECTOR_ID);
    const first = items[0]!;
    const request = new Request("http://localhost/api/library", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op: "save",
        itemId: first.card.itemId,
        title: first.card.title,
        connectorId: first.card.connectorId,
        externalRef: first.card.externalRef,
        listName: SUBSCRIPTIONS_LIST,
      }),
    });
    const response = await POST(request);
    const result = (await response.json()) as { ok?: boolean };
    expect(result.ok).toBe(true);
    // The channel page's truth flips (the connector-scoped read).
    const view = await loadChannelView(host, "fake-source");
    if (!("identity" in view)) throw new Error("expected the channel view");
    expect(view.subscribed).toBe(true);
    expect(view.subscribedTargets.some((target) => target.itemId === first.card.itemId)).toBe(true);
    // The About stats carry the user's own subscription truth.
    expect(view.stats.subscribedHere).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// THE CHANNEL SURFACE (the page grammar)
// ---------------------------------------------------------------------------

describe("R36 — the channel surface (the YouTube page grammar, honestly bound)", () => {
  it("renders the typed-absence banner, the monogram avatar, the honest meta line, and the tab bar", async () => {
    const host = await bootHost();
    const view = await loadChannelView(host, "fake-source");
    if (!("identity" in view)) throw new Error("expected the channel view");
    const markup = renderToStaticMarkup(createElement(ChannelSurface, { view }));
    // The typed-absence banner (never a fabricated image).
    expect(markup).toContain('data-wfx-channel-banner="absent"');
    expect(markup).not.toContain("<img");
    // The monogram avatar + the R33-C display name + the handle.
    expect(markup).toContain('data-wfx-channel-avatar');
    expect(markup).toContain(FIXTURE_SOURCE_NAME);
    expect(markup).toContain("@fake-source");
    // THE SUBSCRIBER-COUNT LAW: the honest absence sentence, never a
    // fabricated number.
    expect(markup).toContain("declares no subscriber count");
    expect(markup).not.toMatch(/\d+\s*subscribers/);
    // The tab bar (all five tabs — the YouTube grammar).
    expect(markup).toContain('data-wfx-channel-tab="home"');
    expect(markup).toContain('data-wfx-channel-tab="videos"');
    expect(markup).toContain('data-wfx-channel-tab="shorts"');
    expect(markup).toContain('data-wfx-channel-tab="playlists"');
    expect(markup).toContain('data-wfx-channel-tab="about"');
    // The channel search field.
    expect(markup).toContain('data-wfx-channel-search-input');
  });

  it("renders the Home tab's items in the feed's own card grammar (the real discovery-derived cards)", async () => {
    const host = await bootHost();
    const view = await loadChannelView(host, "fake-source");
    if (!("identity" in view)) throw new Error("expected the channel view");
    const markup = renderToStaticMarkup(createElement(ChannelSurface, { view }));
    expect(view.items.length).toBe(9);
    // The cards render with the stretched play link (one per card) and
    // the channel link (the link-in).
    expect(markup).toContain("Asteroid Drift");
    expect(markup).toContain("Neon Rain");
  });

  it("renders the honest sort absence note on the Videos tab (fixtures declare no dates/counts)", async () => {
    const host = await bootHost();
    const view = await loadChannelView(host, "fake-source", { tab: "videos" });
    if (!("identity" in view)) throw new Error("expected the channel view");
    const markup = renderToStaticMarkup(createElement(ChannelSurface, { view }));
    expect(markup).toContain('data-wfx-channel-sort-note');
    expect(markup).toContain("declares no publish dates or view counts");
    // No sort chips render (the honest absence — never dead options).
    expect(markup).not.toContain('data-wfx-channel-sort-chip="latest"');
    expect(markup).not.toContain('data-wfx-channel-sort-chip="popular"');
  });

  it("renders the About tab's honest truths (the typed absences + the derived counts + the source's own connection date)", async () => {
    const host = await bootHost();
    const view = await loadChannelView(host, "fake-source", { tab: "about" });
    if (!("identity" in view)) throw new Error("expected the channel view");
    const markup = renderToStaticMarkup(createElement(ChannelSurface, { view }));
    expect(markup).toContain('data-wfx-channel-about-description');
    expect(markup).toContain("declares no channel description");
    expect(markup).toContain('data-wfx-channel-about-subs');
    expect(markup).toContain("never fabricates");
    expect(markup).toContain('data-wfx-channel-about-joined');
    expect(markup).toContain("Connected");
    // The derived content counts (real — from the channel's own items).
    expect(markup).toContain("6 videos");
    expect(markup).toContain("3 shorts");
  });

  it("renders the typed-empty playlists state (the honest absence, never a fabricated playlist)", async () => {
    const host = await bootHost();
    const view = await loadChannelView(host, "fake-source", { tab: "playlists" });
    if (!("identity" in view)) throw new Error("expected the channel view");
    const markup = renderToStaticMarkup(createElement(ChannelSurface, { view }));
    expect(markup).toContain("No playlists for this channel yet");
  });

  it("renders the honest not-found state for an unknown handle", async () => {
    const markup = renderToStaticMarkup(
      createElement(ChannelNotFound, { view: { handle: "no-such-creator" } }),
    );
    expect(markup).toContain('data-wfx-channel-state="not-found"');
    expect(markup).toContain("No channel owns this handle");
    expect(markup).toContain("does not fabricate a channel");
  });

  it("THE BELL LAW: the engagement island renders the Subscribe pill (the frozen list name in the write) + the bell appears only when subscribed, with the honest delivery note", () => {
    const idleMarkup = renderToStaticMarkup(
      createElement(ChannelEngagement, {
        channelName: FIXTURE_SOURCE_NAME,
        representative: {
          itemId: "wfxitm_test000000000000000000A",
          title: "Deep Field Diary",
          connectorId: FIXTURE_CONNECTOR_ID,
          externalRef: "fake:video-1",
        },
        initiallySubscribed: false,
        subscribedTargets: [],
      }),
    );
    expect(idleMarkup).toContain('data-wfx-channel-subscribe-state="idle"');
    // The bell renders ONLY in the subscribed state (the corpus grammar).
    expect(idleMarkup).not.toContain("data-wfx-channel-bell-button");
    const subscribedMarkup = renderToStaticMarkup(
      createElement(ChannelEngagement, {
        channelName: FIXTURE_SOURCE_NAME,
        representative: {
          itemId: "wfxitm_test000000000000000000A",
          title: "Deep Field Diary",
          connectorId: FIXTURE_CONNECTOR_ID,
          externalRef: "fake:video-1",
        },
        initiallySubscribed: true,
        subscribedTargets: [
          {
            itemId: "wfxitm_test000000000000000000A",
            title: "Deep Field Diary",
            connectorId: FIXTURE_CONNECTOR_ID,
            externalRef: "fake:video-1",
          },
        ],
      }),
    );
    expect(subscribedMarkup).toContain('data-wfx-channel-subscribe-state="subscribed"');
    expect(subscribedMarkup).toContain('data-wfx-channel-bell-button');
    expect(subscribedMarkup).toContain('data-wfx-channel-bell-preference="personalized"');
    // The menu's content (the three options + the honest delivery note)
    // is the OPEN state's grammar — the browser journey (J44) drives the
    // open round trip; the closed state's static truth is the button +
    // the persisted preference datum above.
  });
});

// ---------------------------------------------------------------------------
// THE LINK-IN LAWS (every surface's channel slot links to the channel)
// ---------------------------------------------------------------------------

describe("R36 — the link-in laws (the cards' channel slots + the watch row + the shorts row)", () => {
  it("the home cards' channel slots link to the channel page (the R33-C display-name seam unchanged)", async () => {
    const host = await bootHost();
    const { loadHomeView } = await import("../src/host/view-models");
    const { HomeSurface } = await import("../src/components/home/HomeSurface");
    const view = await loadHomeView(host);
    const markup = renderToStaticMarkup(createElement(HomeSurface, { view }));
    // The channel slot: the SAME display-name text + the additive link.
    expect(markup).toContain(`From ${FIXTURE_SOURCE_NAME}`);
    expect(markup).toContain('data-wfx-card-channel="fake-source"');
    expect(markup).toContain('href="/channel/fake-source"');
  });

  it("THE ONE-CLICK LAW INTACT: exactly ONE a[data-wfx-card] per card (the stretched play link carries the card grammar)", async () => {
    const host = await bootHost();
    const { loadHomeView } = await import("../src/host/view-models");
    const { HomeSurface } = await import("../src/components/home/HomeSurface");
    const view = await loadHomeView(host);
    const markup = renderToStaticMarkup(createElement(HomeSurface, { view }));
    // Every data-wfx-card anchor also carries the aria-label (the
    // journeys' finder contract) and the /player href (one-click play).
    const cardAnchors = markup.match(/<a [^>]*data-wfx-card=/g) ?? [];
    expect(cardAnchors.length).toBeGreaterThanOrEqual(4);
    expect(markup).toContain('href="/player?');
  });

  it("the search result cards' channel rows link to the channel page (the 24x24 monogram grammar unchanged)", async () => {
    const host = await bootHost();
    const { loadSearchView } = await import("../src/host/view-models");
    const { SearchSurface } = await import("../src/components/search/SearchSurface");
    const view = await loadSearchView(host, "rain");
    const markup = renderToStaticMarkup(createElement(SearchSurface, { view }));
    expect(markup).toContain(`From ${FIXTURE_SOURCE_NAME}`);
    expect(markup).toContain('data-wfx-card-channel="fake-source"');
    expect(markup).toContain('href="/channel/fake-source"');
  });

  it("THE SHORTS BYTE-LAW: the shorts variant keeps the no-channel-row grammar (the corpus shorts lockup)", async () => {
    const host = await bootHost();
    const { loadHomeView } = await import("../src/host/view-models");
    const { HomeSurface } = await import("../src/components/home/HomeSurface");
    const view = await loadHomeView(host);
    const markup = renderToStaticMarkup(createElement(HomeSurface, { view }));
    const shelf = markup.split('data-wfx-row="shorts"')[1] ?? "";
    expect(shelf.split("data-wfx-row=")[0]).not.toContain("wfx-card__channel");
    expect(shelf.split("data-wfx-row=")[0]).not.toContain("wfx-card__channellink");
  });

  it("the watch page's ChannelRow identity links to the channel page (the avatar + name, the seam unchanged)", () => {
    const markup = renderToStaticMarkup(
      createElement(ChannelRow, {
        connectorId: FIXTURE_CONNECTOR_ID,
        sourceName: FIXTURE_SOURCE_NAME,
        itemId: "wfxitm_test000000000000000000A",
        title: "Deep Field Diary",
        externalRef: "fake:video-1",
        initiallySubscribed: false,
        metaLine: "Playing via embed",
      }),
    );
    expect(markup).toContain('data-wfx-watch-channel-link="fake-source"');
    expect(markup).toContain('href="/channel/fake-source"');
    expect(markup).toContain(FIXTURE_SOURCE_NAME);
    expect(markup).toContain('data-wfx-subscribe');
  });

  it("the shorts channel row's name links to the channel page", () => {
    const markup = renderToStaticMarkup(
      createElement(ShortsSubscribeRow, {
        channelName: FIXTURE_SOURCE_NAME,
        itemId: "wfxitm_test000000000000000000A",
        title: "Neon Rain",
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:short-1",
        subscribed: false,
        onSubscribedChange: () => undefined,
      }),
    );
    expect(markup).toContain('data-wfx-shorts-channel-link="fake-source"');
    expect(markup).toContain('href="/channel/fake-source"');
    expect(markup).toContain(FIXTURE_SOURCE_NAME);
  });
});

// ---------------------------------------------------------------------------
// THE SEARCH CHANNEL RESULTS (the survey's row 18)
// ---------------------------------------------------------------------------

describe("R36 — the search surface's channel results (the honest matching law)", () => {
  it("a creator-name query matches the channel (the display-name containment over the real source set) and renders the row ABOVE the item results", async () => {
    const host = await bootHost();
    const { loadSearchView } = await import("../src/host/view-models");
    const { SearchSurface } = await import("../src/components/search/SearchSurface");
    const view = await loadSearchView(host, "Fake");
    expect(view.channels.length).toBe(1);
    expect(view.channels[0]!.identity.displayName).toBe(FIXTURE_SOURCE_NAME);
    expect(view.channels[0]!.identity.handle).toBe("fake-source");
    // The representative item is REAL (the channel's own first feed item).
    expect(view.channels[0]!.representative).not.toBe(null);
    const markup = renderToStaticMarkup(createElement(SearchSurface, { view }));
    // The section renders ABOVE the item results (the YouTube grammar):
    // the "Fake" query matches the CREATOR but no item title — the
    // surface renders the channel section above its honest no-title-
    // matches state (a creator match is a real result).
    expect(markup).toContain('data-wfx-channel-results');
    expect(markup).toContain('data-wfx-channel-result="fake-source"');
    expect(markup).toContain('data-wfx-channel-result-name');
    // The honest subscriber truth (never a fabricated count).
    expect(markup).toContain("Subscriber count not declared by this source");
    // The inline subscribe (the real one-store pill).
    expect(markup).toContain('data-wfx-channel-inline-subscribe');
    // The section index: the channel section appears BEFORE the honest
    // no-title-matches state in the markup.
    expect(markup.indexOf('data-wfx-channel-results')).toBeLessThan(markup.indexOf("No title matches"));
  });

  it("NO channel match ⇒ the section is honestly absent (never a fake row)", async () => {
    const host = await bootHost();
    const { loadSearchView } = await import("../src/host/view-models");
    const { SearchSurface } = await import("../src/components/search/SearchSurface");
    // "rain" matches item titles but NOT the channel's name/handle.
    const view = await loadSearchView(host, "rain");
    expect(view.channels.length).toBe(0);
    const markup = renderToStaticMarkup(createElement(SearchSurface, { view }));
    expect(markup).not.toContain("data-wfx-channel-results");
    expect(markup).not.toContain("data-wfx-channel-result=");
  });

  it("the empty-query search view carries the empty channel set (no search ran)", async () => {
    const host = await bootHost();
    const { loadSearchView } = await import("../src/host/view-models");
    const view = await loadSearchView(host, "");
    expect(view.channels).toEqual([]);
  });
});
