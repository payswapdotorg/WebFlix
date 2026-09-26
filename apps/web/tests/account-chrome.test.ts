/**
 * R30-B — THE ACCOUNT CHROME tests (bun:test).
 *
 * The corpus-pending family's binding grammar, proven against WebFlix's
 * real account model (docs/parity-lab/r30/lead-captures/CORPUS.md §1–§4,
 * every row cited):
 *
 * - §1 THE BELL'S TWO GRAMMAR LAYERS (bell-grammar.ts): the badge caps
 *   at "9+" while the true count rides the document title — the
 *   captured window read badge "9+" + title "(167) YouTube". The honest
 *   binding: WebFlix's notification truth is 0 unread (no notification
 *   source), so BOTH layers stay unpainted — never a fabricated "9+".
 * - §2 THE BELL PANEL: the corpus anatomy (the "Notifications" header +
 *   gear + collapse arrow) renders the honest-empty row — the
 *   capability-placement row's own frozen empty state; no rows ever
 *   (no source — never fabricated notifications).
 * - §3 THE ACCOUNT MENU: the corpus 14-row grammar mapped to WebFlix's
 *   REAL surfaces only — the header (the name + the email identity
 *   line), the real rows (Switch account / Sign out / Your data /
 *   Appearance state / Display language state / Keyboard shortcuts /
 *   Settings), and the absence note naming the unbacked rows.
 * - §4 THE RAIL SUBSCRIPTIONS: the flat list of the REAL stored
 *   Subscriptions entries (the same seam the Subscribe pill writes —
 *   POST /api/library with the frozen list name), the 24x24 monogram
 *   avatar, the 204x40 entry, the row's own player destination; an
 *   unjoined entry renders UNLINKED (never a fabricated link).
 * - THE SIGNED-IN SHELL: the corpus logged-in end cluster (the bell +
 *   the avatar squircle trigger; the sign-in pill is the LOGGED-OUT
 *   variant), the rail's Subscriptions section, no rail promo, the You
 *   group's Playlists row; the signed-out shell keeps the R29-verified
 *   chrome (no bell, the pill + session menu, the promo).
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
import type { AccountChromeView } from "../src/host/account-chrome";
import { loadSearchView } from "../src/host/view-models";
import type { RequestSessionView } from "../src/host/request-session-view";
import { bellBadgeText, documentTitleWithCount } from "../src/components/shell/bell-grammar";
import { BellPanelContent, MastheadBell } from "../src/components/shell/MastheadBell";
import { AccountMenuPanel, displayLanguageLabel } from "../src/components/shell/AccountMenu";
import { RailSubscriptions } from "../src/components/shell/RailSubscriptions";
import { AppShell } from "../src/components/shell/AppShell";
import { POST as postLibrary } from "../src/app/api/library/route";
import { withEnv } from "./fake-web";

// ---------------------------------------------------------------------------
// Helpers (the adapter-surfaces house style)
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

/** The signed-in request session view, composed from the REAL fixture
 * persona (the same widening `request-session-view.ts` performs on the
 * cookie's answer — the account fields the corpus menu needs). */
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

/** The honest signed-out request session view (never a fake profile). */
const SIGNED_OUT_VIEW: RequestSessionView = { signedIn: false };

/** Subscribe one fixture item through the REAL seam (the ChannelRow's
 * own write: POST /api/library with the frozen Subscriptions list name). */
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

beforeEach(() => {
  resetWebHostProcessState();
  resetFixtureAuthStateForTests();
});

// ---------------------------------------------------------------------------
// §1 — THE BELL'S TWO GRAMMAR LAYERS (the badge cap + the title count)
// ---------------------------------------------------------------------------

describe("R30-B — §1 the bell's two grammar layers (CORPUS: the badge caps at 9+ while the title count read 167)", () => {
  it("the badge layer: 1–9 paints the count, 10+ caps at '9+', the honest zero paints NOTHING", () => {
    // The honest zero: no badge (an unread count of nothing is nothing —
    // never a "0" badge, never a fabricated count).
    expect(bellBadgeText(0)).toBeNull();
    expect(bellBadgeText(-1)).toBeNull();
    expect(bellBadgeText(Number.NaN)).toBeNull();
    // 1–9: the count verbatim.
    expect(bellBadgeText(1)).toBe("1");
    expect(bellBadgeText(9)).toBe("9");
    // 10 and above: the "9+" cap (the corpus's captured badge state).
    expect(bellBadgeText(10)).toBe("9+");
    // The captured window's own pair: badge "9+" over the truth 167.
    expect(bellBadgeText(167)).toBe("9+");
  });

  it("the title layer: the TRUE count rides the document title as the '(N) ' prefix — never capped", () => {
    // The honest zero keeps the base title byte-identical.
    expect(documentTitleWithCount(0, "WebFlix")).toBe("WebFlix");
    // 1 rides verbatim.
    expect(documentTitleWithCount(1, "WebFlix")).toBe("(1) WebFlix");
    // The captured window's own pair: the title carried the TRUE 167
    // ("(167) YouTube") while the badge capped at "9+".
    expect(documentTitleWithCount(167, "WebFlix")).toBe("(167) WebFlix");
  });

  it("the bell button renders the 40x40 shell with NO badge for the honest zero (never a fabricated '9+')", () => {
    const truth = { unread: 0, emptyState: "No notifications yet", sourceNote: "no source" };
    const markup = renderToStaticMarkup(createElement(MastheadBell, { truth }));
    // The corpus §1 shell: the 40x40 icon-button family + the toggle marks.
    expect(markup).toContain("data-wfx-bell-button");
    expect(markup).toContain('aria-label="Notifications"');
    expect(markup).toContain('class="wfx-topbar__guide wfx-bell__button"');
    // The honest zero: no badge element paints.
    expect(markup).not.toContain("data-wfx-bell-badge");
    expect(markup).not.toContain("9+");
    // The closed initial state renders no panel (the island's open state
    // is the browser-level truth — the gear's own pattern).
    expect(markup).not.toContain("data-wfx-bell-panel");
  });
});

// ---------------------------------------------------------------------------
// §2 — THE BELL PANEL (the honest-empty row — no notification source)
// ---------------------------------------------------------------------------

describe("R30-B — §2 the bell panel (the corpus anatomy + the honest-empty row)", () => {
  it("the panel renders the 'Notifications' header + the gear + the collapse arrow + the honest-empty row", () => {
    const truth = {
      unread: 0,
      emptyState: "No notifications yet — follow sources to get them",
      sourceNote: "No notification source is connected on this host.",
    };
    const markup = renderToStaticMarkup(
      createElement(BellPanelContent, { truth, onClose: () => {} }),
    );
    // The corpus §2 header grammar.
    expect(markup).toContain("data-wfx-bell-panel");
    expect(markup).toContain("Notifications");
    expect(markup).toContain("data-wfx-bell-gear");
    expect(markup).toContain("data-wfx-bell-collapse");
    // The honest-empty row: the capability-placement row's own frozen
    // empty state, verbatim (never fabricated rows).
    expect(markup).toContain("No notifications yet — follow sources to get them");
    expect(markup).toContain("No unread notifications.");
    // The row anatomy NEVER renders without rows (no unread dot, no
    // kebab, no fabricated thumbnail).
    expect(markup).not.toContain("data-wfx-bell-row");
    // The unread truth rides as data (the two layers' datum).
    expect(markup).toContain('data-wfx-bell-unread="0"');
  });
});

// ---------------------------------------------------------------------------
// §3 — THE ACCOUNT MENU (the 14-row grammar, real rows only)
// ---------------------------------------------------------------------------

describe("R30-B — §3 the account menu (the corpus 14-row grammar over WebFlix's real surfaces)", () => {
  const baseProps = {
    profileName: "Dev profile",
    identityEmail: "dev@webflix.local",
    profiles: [
      { id: "wfxprof_devprofile", displayName: "Dev profile" },
      { id: "wfxprof_kidsprofile", displayName: "Kids profile" },
    ],
    activeProfileId: "wfxprof_devprofile",
    locale: "en",
  };

  it("the header: the avatar squircle chip + the bold name + the email identity line (the real datum)", () => {
    const markup = renderToStaticMarkup(
      createElement(AccountMenuPanel, {
        ...baseProps,
        themeState: "device",
        onOpenSwitch: () => {},
        onOpenAppearance: () => {},
        onOpenShortcuts: () => {},
        onSignOut: () => {},
      }),
    );
    expect(markup).toContain("data-wfx-account-panel");
    expect(markup).toContain("data-wfx-account-head");
    expect(markup).toContain("data-wfx-account-name");
    expect(markup).toContain("Dev profile");
    // The identity line: the account's email (WebFlix's real identity
    // datum — the corpus handle slot's honest stand-in).
    expect(markup).toContain("data-wfx-account-identity");
    expect(markup).toContain("dev@webflix.local");
    // The squircle avatar class (the corpus rendered shape).
    expect(markup).toContain("wfx-account__avatar");
  });

  it("the REAL rows render: Switch account · Sign out · Your data · Appearance state · Display language state · Keyboard shortcuts · Settings", () => {
    const markup = renderToStaticMarkup(
      createElement(AccountMenuPanel, {
        ...baseProps,
        themeState: "device",
        onOpenSwitch: () => {},
        onOpenAppearance: () => {},
        onOpenShortcuts: () => {},
        onSignOut: () => {},
      }),
    );
    // Rows 2, 3 (the real identity writes).
    expect(markup).toContain('data-wfx-account-item="switch-account"');
    expect(markup).toContain("Switch account");
    expect(markup).toContain('data-wfx-account-item="sign-out"');
    expect(markup).toContain("Sign out");
    // Row 6 (the real session/data surface — the product name swapped
    // per the identity law).
    expect(markup).toContain('data-wfx-account-item="your-data"');
    expect(markup).toContain("Your data in WebFlix");
    // Row 7: the state-bearing Appearance label — the corpus's own
    // captured state ("Appearance: Device theme" — WebFlix's default
    // boot law: no stored choice follows the OS preference).
    expect(markup).toContain('data-wfx-account-item="appearance"');
    expect(markup).toContain("Appearance: Device theme");
    // Row 8: the state-bearing Display language label (the real locale).
    expect(markup).toContain('data-wfx-account-item="language"');
    expect(markup).toContain("Display language: English");
    // Row 11 (the real shared key sheet) + row 12 (the real settings).
    expect(markup).toContain('data-wfx-account-item="shortcuts"');
    expect(markup).toContain("Keyboard shortcuts");
    expect(markup).toContain('data-wfx-account-item="settings"');
    expect(markup).toContain("Settings");
    // The state rows are real STATE displays (the persisted theme
    // states render their own labels — never a fabricated picker).
    const darkMarkup = renderToStaticMarkup(
      createElement(AccountMenuPanel, {
        ...baseProps,
        themeState: "dark",
        onOpenSwitch: () => {},
        onOpenAppearance: () => {},
        onOpenShortcuts: () => {},
        onSignOut: () => {},
      }),
    );
    expect(darkMarkup).toContain("Appearance: Dark theme");
  });

  it("the absence note names the unbacked rows honestly (never a dead imitation)", () => {
    const markup = renderToStaticMarkup(
      createElement(AccountMenuPanel, {
        ...baseProps,
        themeState: "device",
        onOpenSwitch: () => {},
        onOpenAppearance: () => {},
        onOpenShortcuts: () => {},
        onSignOut: () => {},
      }),
    );
    expect(markup).toContain("data-wfx-account-absent");
    for (const absent of [
      "Google Account",
      "YouTube Studio",
      "Purchases and memberships",
      "Restricted Mode",
      "Location",
      "Help",
      "Send feedback",
      "View your channel",
    ]) {
      // Named in the note — never rendered as a row.
      expect(markup).toContain(absent);
      expect(markup).not.toContain(`data-wfx-account-item="${absent.toLowerCase().replace(/ /g, "-")}"`);
    }
    // No fabricated handle (the corpus's "@spartacus_payswap" class —
    // the identity line is the account's REAL email, nothing else: the
    // only @-text in the panel is the identity line's own email).
    const atTexts = markup.match(/@[\w.-]+/g) ?? [];
    expect(atTexts).toEqual(["@webflix.local"]);
    expect(markup).not.toContain("@spartacus");
  });

  it("the Display language label maps the real locale (the platform's own display names)", () => {
    expect(displayLanguageLabel("en")).toBe("Display language: English");
    expect(displayLanguageLabel("en-US")).toBe("Display language: English");
    expect(displayLanguageLabel("fr")).toBe("Display language: French");
    // An unknown code renders verbatim (never a fabricated name).
    expect(displayLanguageLabel("zz")).toBe("Display language: zz");
  });
});

// ---------------------------------------------------------------------------
// §4 — THE RAIL SUBSCRIPTIONS (the stored truth, the flat list)
// ---------------------------------------------------------------------------

describe("R30-B — §4 the rail subscriptions (the corpus flat list over the stored truth)", () => {
  it("the view composes: the request session truth, the real locale, the honest notification truth, and the stored Subscriptions entries", async () => {
    const host = await bootHost();
    // The real page flow first: the search view populates the item join
    // (the surfaces' own law — the join learns from the views).
    await loadSearchView(host, "Deep Field Diary", {});
    const sessionView = signedInSessionViewOfPersona();
    await subscribeFixtureItem(host, {
      itemId: (
        await host.runtime.search({ query: "Deep Field Diary" })
      ).hits.find((entry) => entry.result.title === "Deep Field Diary")!.canonicalItemId,
      title: "Deep Field Diary",
      connectorId: "fake-source",
      externalRef: "fake:video-1",
    });
    const view = await accountChromeViewOf(host, sessionView);
    expect(view.session.signedIn).toBe(true);
    expect(view.session.profileName).toBe("Dev profile");
    expect(view.session.account?.email).toBe("dev@webflix.local");
    // The real locale (the session context's law).
    expect(view.locale).toBe("en");
    // The honest notification truth: 0 unread (no notification source).
    expect(view.notifications.unread).toBe(0);
    expect(view.notifications.emptyState).toBe("No notifications yet — follow sources to get them");
    // The rail subscriptions: the stored Subscriptions-list entry,
    // JOINED (the search view's join) — the same seam the pill wrote.
    expect(view.railSubscriptions.length).toBe(1);
    const entry = view.railSubscriptions[0]!;
    expect(entry.title).toBe("Deep Field Diary");
    expect(entry.joined).not.toBeNull();
    expect(entry.joined?.connectorId).toBe("fake-source");
  });

  it("the section markup: the 24x24 monogram avatar + the 204x40 entry + the row's own player destination", async () => {
    const host = await bootHost();
    await loadSearchView(host, "Deep Field Diary", {});
    const sessionView = signedInSessionViewOfPersona();
    const itemId = (
      await host.runtime.search({ query: "Deep Field Diary" })
    ).hits.find((entry) => entry.result.title === "Deep Field Diary")!.canonicalItemId;
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
    expect(markup).toContain("data-wfx-rail-subscriptions");
    expect(markup).toContain("Subscriptions");
    expect(markup).toContain("data-wfx-rail-subscriptions-list");
    // The corpus §4 avatar grammar: 24x24 (the CSS class carries the
    // measure; the R28 pending avatar measure now closed).
    expect(markup).toContain("wfx-railsub__avatar");
    // The entry: the 204x40 row class + the real player destination.
    expect(markup).toContain("wfx-railsub__row");
    expect(markup).toContain(`data-wfx-rail-subscription-link="${itemId}"`);
    expect(markup).toContain("Deep Field Diary");
    expect(markup).not.toContain("data-wfx-rail-subscriptions-empty");
  });

  it("an empty Subscriptions list renders the honest empty note (never a fabricated row)", async () => {
    const host = await bootHost();
    const view = await accountChromeViewOf(host, SIGNED_OUT_VIEW);
    expect(view.railSubscriptions).toEqual([]);
    const markup = renderToStaticMarkup(
      createElement(RailSubscriptions, { entries: view.railSubscriptions }),
    );
    expect(markup).toContain("data-wfx-rail-subscriptions-empty");
    expect(markup).toContain("No subscriptions yet — subscribe from any watch page.");
  });

  it("an entry this process never joined renders UNLINKED (never a fabricated link)", async () => {
    // The composition's honest law: a stored subscription whose source
    // identity never joined this process (no view ever loaded it).
    const host = await bootHost();
    const sessionView = signedInSessionViewOfPersona();
    const itemId = (
      await host.runtime.search({ query: "Deep Field Diary" })
    ).hits.find((entry) => entry.result.title === "Deep Field Diary")!.canonicalItemId;
    await subscribeFixtureItem(host, {
      itemId,
      title: "Deep Field Diary",
      connectorId: "fake-source",
      externalRef: "fake:video-1",
    });
    // NOTE: NO view loader ran — the join map is empty for this item.
    const view = await accountChromeViewOf(host, sessionView);
    expect(view.railSubscriptions.length).toBe(1);
    expect(view.railSubscriptions[0]!.joined).toBeNull();
    const markup = renderToStaticMarkup(
      createElement(RailSubscriptions, { entries: view.railSubscriptions }),
    );
    expect(markup).toContain("data-wfx-rail-subscription-unlinked");
    expect(markup).not.toContain("data-wfx-rail-subscription-link");
  });
});

// ---------------------------------------------------------------------------
// THE SIGNED-IN SHELL (the corpus logged-in chrome joins the existing shell)
// ---------------------------------------------------------------------------

describe("R30-B — the signed-in shell (the corpus logged-in end cluster + the rail)", () => {
  async function signedInView(): Promise<{ host: WebRuntimeHost; view: AccountChromeView }> {
    const host = await bootHost();
    await loadSearchView(host, "Deep Field Diary", {});
    const sessionView = signedInSessionViewOfPersona();
    const itemId = (
      await host.runtime.search({ query: "Deep Field Diary" })
    ).hits.find((entry) => entry.result.title === "Deep Field Diary")!.canonicalItemId;
    await subscribeFixtureItem(host, {
      itemId,
      title: "Deep Field Diary",
      connectorId: "fake-source",
      externalRef: "fake:video-1",
    });
    const view = await accountChromeViewOf(host, sessionView);
    return { host, view };
  }

  it("the corpus logged-in cluster: the bell + the account-menu avatar render; the sign-in pill is GONE", async () => {
    const { host, view } = await signedInView();
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        account: view,
        children: createElement("p", null, "content"),
      }),
    );
    // §1: the bell + the avatar trigger (the squircle chip).
    expect(markup).toContain("data-wfx-bell-button");
    expect(markup).toContain("data-wfx-account-trigger");
    expect(markup).toContain("wfx-account__triggeravatar");
    // The logged-out variants are GONE (the corpus logged-in end
    // cluster carries no sign-in pill, no session menu).
    expect(markup).not.toContain("data-wfx-signin");
    expect(markup).not.toContain("data-wfx-session-label");
    expect(markup).not.toContain("data-wfx-session-signin");
    // §4: the rail's Subscriptions section + the You group's Playlists row.
    expect(markup).toContain("data-wfx-rail-subscriptions");
    expect(markup).toContain("Deep Field Diary");
    expect(markup).not.toContain("data-wfx-rail-signin");
    const playlistsRows = markup.match(/href="\/library"[^>]*>/g) ?? [];
    expect(playlistsRows.length).toBeGreaterThan(0);
    expect(markup).toContain("<span>Playlists</span>");
  });

  it("the signed-out shell keeps the R29-verified chrome byte-identical (no account prop: the pill + session menu + promo)", async () => {
    const host = await bootHost();
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement("p", null, "content"),
      }),
    );
    // The R29-verified logged-out chrome.
    expect(markup).toContain("data-wfx-signin");
    expect(markup).toContain("data-wfx-session-label");
    expect(markup).toContain("data-wfx-rail-signin");
    // No corpus logged-in chrome (the account prop absent).
    expect(markup).not.toContain("data-wfx-bell-button");
    expect(markup).not.toContain("data-wfx-account-trigger");
    expect(markup).not.toContain("data-wfx-rail-subscriptions");
  });

  it("a signed-out account view also keeps the logged-out chrome (the request truth is the switch)", async () => {
    const host = await bootHost();
    const view = await accountChromeViewOf(host, SIGNED_OUT_VIEW);
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        account: view,
        children: createElement("p", null, "content"),
      }),
    );
    expect(markup).toContain("data-wfx-signin");
    expect(markup).not.toContain("data-wfx-bell-button");
    expect(markup).not.toContain("data-wfx-account-trigger");
  });
});
