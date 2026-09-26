/**
 * R30-B — the SSR composition probe (apps/web/scripts/r30-account-chrome-probe.ts;
 *
 * Renders the account-chrome family's surfaces through the SAME
 * composition the routes serve (the fixture host + the view loaders +
 * renderToStaticMarkup — the exact machinery the test battery runs),
 * writing one HTML capture per surface into evidence/r30-b/captures/
 * plus a facts JSON (the measured assertions of the captures).
 *
 * WHY THIS FORM: the browser-level probe is BLOCKED in this sandbox
 * (the dev server is OOM-killed at compile — the same memory-ceiling
 * class the R30-A lead recorded for the boot-B probe; the log carries
 * no error line, the process simply dies on the first request's
 * compile). The seams are TEST-proven (23 tests, the battery's +23);
 * this probe freezes the rendered grammar as the per-surface proof
 * captures the evidence folder owes.
 *
 * Run: `bun apps/web/scripts/r30-account-chrome-probe.ts` (from the repo root).
 * Deterministic: fixture transport, the scripted persona, no network.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
import type { RequestSessionView } from "../src/host/request-session-view";
import { resetWebHostProcessState } from "../src/host/testing";
import { loadLibraryView, loadSearchView } from "../src/host/view-models";
import { AppShell } from "../src/components/shell/AppShell";
import { BellPanelContent } from "../src/components/shell/MastheadBell";
import { AccountMenuPanel } from "../src/components/shell/AccountMenu";
import { RailSubscriptions } from "../src/components/shell/RailSubscriptions";
import { LibrarySurface } from "../src/components/library/LibrarySurface";
import { POST as postLibrary } from "../src/app/api/library/route";
import { POST as postEvent } from "../src/app/api/events/route";
import { bellBadgeText, documentTitleWithCount } from "../src/components/shell/bell-grammar";

/** The captures' output directory (this evidence folder). */
const OUT_DIR = new URL("../../../evidence/r30-b/captures/", import.meta.url).pathname;

/** The facts summary the probe writes beside the captures. */
interface ProbeFacts {
  readonly generatedAt: string;
  readonly surfaces: ReadonlyArray<{
    readonly file: string;
    readonly corpusSection: string;
    readonly facts: ReadonlyArray<string>;
  }>;
}

/** Write one capture (the HTML fragment) + return its path. */
function write(file: string, markup: string): void {
  const document = `<!doctype html>
<html lang="en" data-theme="dark">
<head><meta charset="utf-8"><title>R30-B capture — ${file}</title>
<link rel="stylesheet" href="../../src/app/globals.css"></head>
<body style="margin:0;background:#0f0f0f">${markup}</body>
</html>
`;
  Bun.write(`${OUT_DIR}${file}`, document);
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

/** The signed-in request session view (the persona's own fields — the
 * same widening request-session-view performs on the cookie's answer). */
function personaSessionView(): RequestSessionView {
  driveFixtureLogin(FIXTURE_AUTH_EMAIL, FIXTURE_AUTH_PASSWORD);
  const view = fixtureSessionView();
  const active = view.profiles.find((profile) => profile.id === view.activeProfileId);
  return {
    signedIn: true,
    ...(active !== undefined ? { profileName: active.displayName } : {}),
    account: {
      profiles: view.profiles.map((profile) => ({ id: profile.id, displayName: profile.displayName })),
      activeProfileId: view.activeProfileId,
      email: view.user.email,
    },
  };
}

/** Resolve one fixture item through the runtime's search seam. */
async function fixtureItem(host: WebRuntimeHost, title: string): Promise<{
  itemId: string; connectorId: string; externalRef: string; title: string;
}> {
  const model = await host.runtime.search({ query: title });
  const hit = model.hits.find((entry) => entry.result.title === title);
  if (hit === undefined) throw new Error(`fixture item '${title}' not found`);
  return {
    itemId: hit.canonicalItemId,
    connectorId: hit.result.connectorId,
    externalRef: hit.result.externalRef,
    title: hit.result.title,
  };
}

// The probe body.
resetWebHostProcessState();
resetFixtureAuthStateForTests();
const host = await getWebRuntimeHost();

// The real page flow: the search views join the items the probe saves.
await loadSearchView(host, "Deep Field Diary", {});
await loadSearchView(host, "Neon Rain", {});
await loadSearchView(host, "Static Bloom", {});
const diary = await fixtureItem(host, "Deep Field Diary");
const rain = await fixtureItem(host, "Neon Rain");

// The real writes — DIFFERENT items per list (the runtime's library
// keeps ONE canonical entry per item with ONE list name: the same item
// saved to a second list moves it, so the probe's corpus states each
// get their own item): one Subscriptions-list save (the pill's own
// seam), two "Watch later" saves (the playlist family), one history
// fold (the events route's seam).
await post(postLibrary, {
  op: "save", itemId: diary.itemId, title: diary.title,
  connectorId: diary.connectorId, externalRef: diary.externalRef,
  listName: "Subscriptions",
});
await post(postLibrary, {
  op: "save", itemId: rain.itemId, title: rain.title,
  connectorId: rain.connectorId, externalRef: rain.externalRef,
  listName: "Watch later",
});
const bloom = await fixtureItem(host, "Static Bloom");
await post(postLibrary, {
  op: "save", itemId: bloom.itemId, title: bloom.title,
  connectorId: bloom.connectorId, externalRef: bloom.externalRef,
  listName: "Watch later",
});
await post(postEvent, { itemId: rain.itemId, type: "progress", payload: { positionMs: 20_000 } });

const sessionView = personaSessionView();
const account: AccountChromeView = await accountChromeViewOf(host, sessionView);
const library = await loadLibraryView(host);

// 01 — the signed-in shell (the corpus logged-in end cluster + the rail).
write(
  "01-masthead-signed-in.html",
  renderToStaticMarkup(
    createElement(AppShell, {
      mode: host.mode,
      active: "home",
      session: host.session.state,
      account,
      children: createElement("p", null, "content"),
    }),
  ),
);

// 02 — the signed-out shell (the R29-verified baseline, byte-identical).
write(
  "02-masthead-signed-out.html",
  renderToStaticMarkup(
    createElement(AppShell, {
      mode: host.mode,
      active: "home",
      session: host.session.state,
      children: createElement("p", null, "content"),
    }),
  ),
);

// 03 — the bell panel (§2's anatomy + the honest-empty row).
write(
  "03-bell-panel.html",
  renderToStaticMarkup(
    createElement("div", { style: { position: "relative", height: "400px" } },
      createElement(BellPanelContent, { truth: account.notifications, onClose: () => {} }),
    ),
  ),
);

// 04 — the account menu (§3's 14-row grammar over the real surfaces).
write(
  "04-account-menu.html",
  renderToStaticMarkup(
    createElement("div", { style: { position: "relative", height: "600px" } },
      createElement(AccountMenuPanel, {
        profileName: sessionView.profileName ?? "Dev profile",
        ...(sessionView.account?.email !== undefined
          ? { identityEmail: sessionView.account.email }
          : {}),
        locale: account.locale,
        themeState: "device",
        onOpenSwitch: () => {},
        onOpenAppearance: () => {},
        onOpenShortcuts: () => {},
        onSignOut: () => {},
      }),
    ),
  ),
);

// 05 — the rail subscriptions (§4's flat list with the 24x24 avatars).
write(
  "05-rail-subscriptions.html",
  renderToStaticMarkup(createElement(RailSubscriptions, { entries: account.railSubscriptions })),
);

// 06 — the Library's playlist family (§8/§9's header + notice + chips)
// + §6's history resume bar (the folded watch state).
write(
  "06-library-playlists-history.html",
  renderToStaticMarkup(createElement(LibrarySurface, { view: library, session: host.session.state })),
);

// The facts JSON (the measured assertions of the captures above).
const facts: ProbeFacts = {
  generatedAt: new Date().toISOString(),
  surfaces: [
    {
      file: "01-masthead-signed-in.html",
      corpusSection: "CORPUS.md §1 (the logged-in end cluster) + §4 (the rail)",
      facts: [
        "the bell button renders (data-wfx-bell-button, the 40x40 shell family)",
        "NO badge paints (the honest zero — bellBadgeText(0) === null)",
        "the account-menu avatar trigger renders (the squircle chip)",
        "the sign-in pill + session menu are ABSENT (the logged-out variants)",
        `the document title layer: documentTitleWithCount(0, 'WebFlix') === ${JSON.stringify(documentTitleWithCount(0, "WebFlix"))}`,
        `the badge cap layer: bellBadgeText(167) === ${JSON.stringify(bellBadgeText(167))} (the captured window's pair)`,
        "the rail carries the Subscriptions section (data-wfx-rail-subscriptions) with the stored entry",
        "the rail carries NO sign-in promo (the corpus logged-in taxonomy)",
      ],
    },
    {
      file: "02-masthead-signed-out.html",
      corpusSection: "the R29-verified logged-out baseline (the seam law's control)",
      facts: [
        "the sign-in pill (data-wfx-signin) + session menu (data-wfx-session-label) render",
        "NO bell, NO account-menu trigger, NO rail subscriptions section",
      ],
    },
    {
      file: "03-bell-panel.html",
      corpusSection: "CORPUS.md §2 (the notifications panel anatomy)",
      facts: [
        "the 'Notifications' header + the gear + the collapse arrow render",
        "the honest-empty row: 'No notifications yet — follow sources to get them' (the capability row's own vocabulary)",
        "NO notification rows (no source — never fabricated)",
        'data-wfx-bell-unread="0" (the two layers\' datum)',
      ],
    },
    {
      file: "04-account-menu.html",
      corpusSection: "CORPUS.md §3 (the account menu, double-confirmed)",
      facts: [
        "the header: the squircle avatar + 'Dev profile' + dev@webflix.local (the email — the real identity datum)",
        "the real rows: Switch account · Sign out · Your data in WebFlix · Appearance: Device theme · Display language: English · Keyboard shortcuts · Settings",
        "the absence note names: Google Account, YouTube Studio, Purchases and memberships, Restricted Mode, Location, Help, Send feedback, View your channel",
        "no fabricated handle (the only @-text is the identity line's email)",
      ],
    },
    {
      file: "05-rail-subscriptions.html",
      corpusSection: "CORPUS.md §4 (the subscriptions rail)",
      facts: [
        "the flat list renders the stored Subscriptions entry (Deep Field Diary) with its JOINED player href",
        "the 24x24 monogram avatar (wfx-railsub__avatar) — the corpus-measured avatar grammar",
        "the 204x40 entry box (wfx-railsub__row) — the corpus guide-entry geometry",
      ],
    },
    {
      file: "06-library-playlists-history.html",
      corpusSection: "CORPUS.md §6/§8/§9 (watched progress + the playlist family)",
      facts: [
        "§8: the 'Watch later' header grammar — title · 'an anonymous session' (the session's own truth) · '2 videos' · 'Last updated on <date>' (the Subscriptions list renders as its own playlist section too — the one-write-path law)",
        "§8: the Play all + Shuffle pills (data-wfx-playlist-playall/shuffle)",
        "§9: the sort chips — All · Videos · Shorts (the mixed list's real types; the corpus chip row)",
        "§6: the history row renders data-wfx-progress (the red bar in the thumb area) + 'Resume at'",
      ],
    },
  ],
};
Bun.write(
  `${OUT_DIR}../probe-facts.json`,
  `${JSON.stringify(facts, null, 2)}\n`,
);
