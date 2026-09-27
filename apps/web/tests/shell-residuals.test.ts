/**
 * R33-B — THE SHELL-RESIDUALS tests (bun:test).
 *
 * The shell-surface residual rows from
 * docs/parity-lab/r28/reconciliation/MATRIX.md, re-verified against the
 * current tree and closed or honestly recorded (every row cites its
 * corpus line + the code seam):
 *
 * - D6 — THE SUBSCRIPTIONS RAIL ENTRY: the corpus rail reads Home ·
 *   Shorts · Subscriptions · You (docs/parity-lab/reference/app-shell.md
 *   "Primary group: Home · Shorts · Subscriptions · You"; the logged-in
 *   taxonomy in docs/parity-lab/r30/lead-captures/CORPUS.md §4: [Home,
 *   Shorts] then the [Subscriptions: flat channel list] section). The
 *   SIGNED-OUT rail renders the Subscriptions ENTRY bound to the REAL
 *   R31 surface (/feed/subscriptions — the row's blocker is gone); the
 *   SIGNED-IN rail drops the entry (the R30-B/R31-verified SECTION
 *   carries the destination — never a duplicate, the D8 class). The
 *   long-form "Watch" browse surface holds NO rail slot in either state
 *   (the corpus rail carries no Watch-like entry).
 * - N33 (the fresh-sweep row, D6's mobile form) — THE BOTTOM NAV: the
 *   corpus bottom-nav grammar "Home · Shorts · Subscriptions · You"
 *   (app-shell.md "Bottom nav (mobile <792px)"), the honest You→Library
 *   mapping; the Subscriptions item binds to the REAL feed surface in
 *   BOTH states (the route answers the signed-out boot with its honest
 *   empty state).
 * - THE ACTIVE-RAIL LAW (D6): the /feed/subscriptions page's own path
 *   claim — the rail + bottom-nav Subscriptions entry paints
 *   aria-current="page" (the corpus active-item grammar; the CSS seam's
 *   own [aria-current] law).
 * - D8 — THE HISTORY DEDUPE (re-verified): exactly ONE History entry in
 *   the rail (R29-B's fix holds on the current tree — the matrix row's
 *   status is updated to record the landing).
 * - D3 — THE MIC (the honest-absence pin): the corpus carries the 40px
 *   mic (app-shell.md masthead center; CORPUS.md §1's logged-in
 *   in-bar measure), but WebFlix has NO voice-search transport (the
 *   search API is text-only; the ASR machinery is the R2T2 live-captions
 *   routing contract, never a search input) — the row stays the honest
 *   absence. This pin guards it: a future dead imitation FAILS here.
 * - D4 — THE BELL (re-verified): the signed-in masthead renders the
 *   R30-B bell bound to the REAL notification truth — the honest zero
 *   paints NO badge (CORPUS.md §1's two-layer grammar, bell-grammar.ts).
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
import { AppShell } from "../src/components/shell/AppShell";
import { POST as postLibrary } from "../src/app/api/library/route";
import { withEnv } from "./fake-web";

// ---------------------------------------------------------------------------
// Helpers (the account-chrome / subscriptions-feed house style)
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

/** The signed-out request session view (the honest anonymous truth). */
const SIGNED_OUT_VIEW: RequestSessionView = { signedIn: false };

/**
 * One nav anchor as rendered by the shell: its href, its label, and
 * whether it painted the active-item grammar (aria-current="page").
 */
interface NavAnchor {
  readonly href: string;
  readonly label: string;
  readonly current: boolean;
}

/**
 * Extract the ordered nav anchors from one chunk of static markup. The
 * shell's navlink anatomy is uniform (app-shell.md "Item anatomy: 48px
 * height row, 24px icon + 14px/400 label"): `<a class="wfx-navlink"
 * [aria-current="page"] href="…"><span class="wfx-navlink__icon">…</span>
 * <span>Label</span></a>` — the bare `<span>` is always the label.
 */
function navAnchorsOf(markup: string): NavAnchor[] {
  const anchors: NavAnchor[] = [];
  const pattern = /<a class="wfx-navlink"([^>]*)>(.*?)<span>([^<]+)<\/span><\/a>/gs;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markup)) !== null) {
    anchors.push({
      href: /href="([^"]*)"/.exec(match[1] ?? "")?.[1] ?? "",
      label: match[3] ?? "",
      current: (match[1] ?? "").includes('aria-current="page"'),
    });
  }
  return anchors;
}

/** Split a full shell render into its rail + bottom-nav chunks. */
function railAndBottomNavOf(markup: string): { rail: string; bottomNav: string } {
  const split = markup.indexOf('<nav class="wfx-bottomnav"');
  if (split === -1) throw new Error("the bottom nav landmark did not render");
  return { rail: markup.slice(0, split), bottomNav: markup.slice(split) };
}

/** The rail's PRIMARY group anchors (the first wfx-rail__group's own). */
function primaryGroupOf(railMarkup: string): NavAnchor[] {
  const start = railMarkup.indexOf('<div class="wfx-rail__group">');
  if (start === -1) throw new Error("the primary group did not render");
  const end = railMarkup.indexOf('<div class="wfx-rail__divider"', start);
  if (end === -1) throw new Error("the primary group's divider did not render");
  return navAnchorsOf(railMarkup.slice(start, end));
}

beforeEach(() => {
  resetWebHostProcessState();
  resetFixtureAuthStateForTests();
});

// ---------------------------------------------------------------------------
// D6 — the Subscriptions rail entry (the signed-out grammar)
// ---------------------------------------------------------------------------

describe("R33-B (D6) — the signed-out rail: Home · Shorts · Subscriptions · Library", () => {
  it("the primary group reads the corpus order with the Subscriptions entry in the You slot's neighborhood (app-shell.md's logged-out grammar)", async () => {
    const host = await bootHost();
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement("p", null, "content"),
      }),
    );
    const { rail } = railAndBottomNavOf(markup);
    expect(primaryGroupOf(rail).map((entry) => entry.label)).toEqual([
      "Home",
      "Shorts",
      "Subscriptions",
      "Library",
    ]);
  });

  it("the Subscriptions entry binds to the REAL R31 surface (/feed/subscriptions — the row's blocker is gone)", async () => {
    const host = await bootHost();
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement("p", null, "content"),
      }),
    );
    const { rail } = railAndBottomNavOf(markup);
    const entry = primaryGroupOf(rail).find((candidate) => candidate.label === "Subscriptions");
    expect(entry?.href).toBe("/feed/subscriptions");
  });

  it("the long-form Watch browse surface holds NO rail slot (the corpus rail carries no Watch-like entry — the D6 remap)", async () => {
    const host = await bootHost();
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement("p", null, "content"),
      }),
    );
    const { rail } = railAndBottomNavOf(markup);
    const labels = navAnchorsOf(rail).map((entry) => entry.label);
    expect(labels).not.toContain("Watch");
  });
});

// ---------------------------------------------------------------------------
// D6 — the signed-in rail (the logged-in taxonomy: the SECTION, not an entry)
// ---------------------------------------------------------------------------

describe("R33-B (D6) — the signed-in rail: the corpus logged-in taxonomy (CORPUS.md §4)", () => {
  async function signedInShell(
    withStoredSubscription: boolean,
  ): Promise<{ markup: string; host: WebRuntimeHost }> {
    const host = await bootHost();
    if (withStoredSubscription) {
      const response = await post(postLibrary, {
        op: "save",
        itemId: "wfxitm_fake-video-1",
        title: "Deep Field Diary",
        connectorId: "fake-source",
        externalRef: "fake:video-1",
        listName: "Subscriptions",
      });
      const body = (await response.json()) as { ok?: boolean };
      if (body.ok !== true) throw new Error("the subscribe write failed");
    }
    const account = await accountChromeViewOf(host, signedInSessionViewOfPersona());
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        account,
        children: createElement("p", null, "content"),
      }),
    );
    return { markup, host };
  }

  it("the primary group reads Home · Shorts · Library — NO Subscriptions ENTRY (the R30-B section carries the destination; an entry would duplicate it, the D8 class)", async () => {
    const { markup } = await signedInShell(true);
    const { rail } = railAndBottomNavOf(markup);
    expect(primaryGroupOf(rail).map((entry) => entry.label)).toEqual([
      "Home",
      "Shorts",
      "Library",
    ]);
    const labels = navAnchorsOf(rail).map((entry) => entry.label);
    expect(labels.filter((label) => label === "Subscriptions")).toEqual([]);
  });

  it("the Subscriptions SECTION renders (the R30-B/R31-verified surface — the heading link + the stored entry), byte-identical in its own block", async () => {
    const { markup } = await signedInShell(true);
    // R31 §G2 — the heading link carries the feed's destination.
    expect(markup).toContain('data-wfx-rail-subscriptions-heading');
    expect(markup).toContain('href="/feed/subscriptions"');
    // The stored entry renders (the flat list's own truth).
    expect(markup).toContain("Deep Field Diary");
    expect(markup).toContain("data-wfx-rail-subscriptions-list");
  });

  it("NO Watch entry in the signed-in rail either (the remap holds in both states)", async () => {
    const { markup } = await signedInShell(true);
    const { rail } = railAndBottomNavOf(markup);
    expect(navAnchorsOf(rail).map((entry) => entry.label)).not.toContain("Watch");
  });
});

// ---------------------------------------------------------------------------
// D6 — the active-rail law (the /feed/subscriptions page's own claim)
// ---------------------------------------------------------------------------

describe("R33-B (D6) — the active-rail law (the presentation route's aria-current)", () => {
  it("activeRailHref='/feed/subscriptions' paints aria-current on the rail + bottom-nav Subscriptions entry (the corpus active-item grammar)", async () => {
    const host = await bootHost();
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        activeRailHref: "/feed/subscriptions",
        children: createElement("p", null, "content"),
      }),
    );
    const { rail, bottomNav } = railAndBottomNavOf(markup);
    const railEntry = navAnchorsOf(rail).find((entry) => entry.label === "Subscriptions");
    expect(railEntry?.current).toBe(true);
    const bottomEntry = navAnchorsOf(bottomNav).find((entry) => entry.label === "Subscriptions");
    expect(bottomEntry?.current).toBe(true);
    // The other entries stay unpainted (exactly one active item per
    // landmark — the corpus grammar).
    expect(navAnchorsOf(rail).filter((entry) => entry.current).length).toBe(1);
    expect(navAnchorsOf(bottomNav).filter((entry) => entry.current).length).toBe(1);
  });

  it("without the claim no Subscriptions entry paints active (every SurfaceId route keeps its own `active` truth)", async () => {
    const host = await bootHost();
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        active: "home",
        session: host.session.state,
        children: createElement("p", null, "content"),
      }),
    );
    const { rail, bottomNav } = railAndBottomNavOf(markup);
    const railSubs = navAnchorsOf(rail).find((entry) => entry.label === "Subscriptions");
    expect(railSubs?.current).toBe(false);
    const bottomSubs = navAnchorsOf(bottomNav).find((entry) => entry.label === "Subscriptions");
    expect(bottomSubs?.current).toBe(false);
    // The home surface's own entry paints instead (the `active` prop law).
    const home = navAnchorsOf(rail).find((entry) => entry.label === "Home");
    expect(home?.current).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// N33 (the fresh-sweep row) — the bottom nav (D6's mobile form)
// ---------------------------------------------------------------------------

describe("R33-B (N33) — the bottom nav: Home · Shorts · Subscriptions · Library", () => {
  it("the corpus 4-item grammar with the honest You→Library mapping (app-shell.md's bottom-nav line)", async () => {
    const host = await bootHost();
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement("p", null, "content"),
      }),
    );
    const { bottomNav } = railAndBottomNavOf(markup);
    expect(navAnchorsOf(bottomNav).map((entry) => entry.label)).toEqual([
      "Home",
      "Shorts",
      "Subscriptions",
      "Library",
    ]);
  });

  it("the bottom-nav Subscriptions item binds to the REAL feed surface (the same href the section heading carries)", async () => {
    const host = await bootHost();
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement("p", null, "content"),
      }),
    );
    const { bottomNav } = railAndBottomNavOf(markup);
    const entry = navAnchorsOf(bottomNav).find((candidate) => candidate.label === "Subscriptions");
    expect(entry?.href).toBe("/feed/subscriptions");
  });

  it("the signed-in bottom nav carries the same grammar (the route answers both boots honestly)", async () => {
    const host = await bootHost();
    const account = await accountChromeViewOf(host, signedInSessionViewOfPersona());
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        account,
        children: createElement("p", null, "content"),
      }),
    );
    const { bottomNav } = railAndBottomNavOf(markup);
    expect(navAnchorsOf(bottomNav).map((entry) => entry.label)).toEqual([
      "Home",
      "Shorts",
      "Subscriptions",
      "Library",
    ]);
  });
});

// ---------------------------------------------------------------------------
// D8 — the History dedupe (the re-verified pin)
// ---------------------------------------------------------------------------

describe("R33-B (D8) — ONE History entry (R29-B's fix holds on the current tree)", () => {
  it("the rail carries exactly ONE History entry in the signed-out state (the corpus single-entry grammar, app-shell.md)", async () => {
    const host = await bootHost();
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement("p", null, "content"),
      }),
    );
    const { rail } = railAndBottomNavOf(markup);
    const history = navAnchorsOf(rail).filter((entry) => entry.label === "History");
    expect(history.length).toBe(1);
    expect(history[0]?.href).toBe("/library?section=history");
  });

  it("the rail carries exactly ONE History entry in the signed-in state too", async () => {
    const host = await bootHost();
    const account = await accountChromeViewOf(host, signedInSessionViewOfPersona());
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        account,
        children: createElement("p", null, "content"),
      }),
    );
    const { rail } = railAndBottomNavOf(markup);
    expect(navAnchorsOf(rail).filter((entry) => entry.label === "History").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// D3 — the mic (the honest-absence pin: no voice-search transport exists)
// ---------------------------------------------------------------------------

describe("R33-B (D3) — the mic stays the honest absence (no voice-search transport)", () => {
  it("no mic affordance renders in either chrome state (the honest-transport law: never a dead imitation)", async () => {
    const host = await bootHost();
    const signedOut = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement("p", null, "content"),
      }),
    );
    const account = await accountChromeViewOf(host, signedInSessionViewOfPersona());
    const signedIn = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        account,
        children: createElement("p", null, "content"),
      }),
    );
    for (const markup of [signedOut, signedIn]) {
      expect(markup).not.toContain("data-wfx-mic");
      expect(markup).not.toContain("Search by voice");
      expect(markup).not.toContain("voice search");
      expect(markup).not.toContain("VoiceSearch");
    }
  });
});

// ---------------------------------------------------------------------------
// D4 — the bell (the re-verified pin: bound to the real notification truth)
// ---------------------------------------------------------------------------

describe("R33-B (D4) — the bell renders bound to the real truth (R30-B's landing re-verified)", () => {
  it("the signed-in masthead carries the bell button with NO badge (the honest zero — CORPUS.md §1's two-layer grammar)", async () => {
    const host = await bootHost();
    const account = await accountChromeViewOf(host, signedInSessionViewOfPersona());
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        account,
        children: createElement("p", null, "content"),
      }),
    );
    expect(markup).toContain("data-wfx-bell-button");
    // The honest zero: no badge layer paints (bell-grammar.ts's law).
    expect(markup).not.toContain("data-wfx-bell-badge");
    // The truth is the typed datum, not a constant masquerading as one.
    expect(account.notifications.unread).toBe(0);
  });

  it("the signed-out masthead carries NO bell (the corpus logged-in cluster's own state switch)", async () => {
    const host = await bootHost();
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement("p", null, "content"),
      }),
    );
    expect(markup).not.toContain("data-wfx-bell-button");
  });

  it("a signed-OUT account view also carries no bell (the request truth is the switch — the R30-B seam)", async () => {
    const host = await bootHost();
    const account = await accountChromeViewOf(host, SIGNED_OUT_VIEW);
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        account,
        children: createElement("p", null, "content"),
      }),
    );
    expect(markup).not.toContain("data-wfx-bell-button");
  });
});
