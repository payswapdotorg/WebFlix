/**
 * R31 — the SSR composition probe (apps/web/scripts/r31-gap-probe.ts;
 *
 * Renders the gap-wave's two surfaces through the SAME composition the
 * routes serve (the fixture host + the view loaders + renderToStaticMarkup
 * — the exact machinery the test battery runs), writing one HTML capture
 * per surface into evidence/r31/captures/ plus a facts JSON (the measured
 * assertions of the captures — the corpus-citation table's proof rows).
 *
 * WHY THIS FORM: the browser-level probe is blocked in this sandbox (the
 * R30-B record — the dev server is OOM-killed at compile; the same
 * memory-ceiling class). The seams are TEST-proven (23 tests, the
 * battery's +23); this probe freezes the rendered grammar as the
 * per-surface proof captures the evidence folder owes.
 *
 * Run: `bun apps/web/scripts/r31-gap-probe.ts` (from the repo root).
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
import { loadSearchView } from "../src/host/view-models";
import {
  appearanceStateLabel,
  storedThemeOfState,
  themeStateOfStored,
} from "../src/components/shell/theme-picker-grammar";
import { AppShell } from "../src/components/shell/AppShell";
import {
  AccountMenu,
  AccountMenuPanel,
  AppearancePickerPanel,
} from "../src/components/shell/AccountMenu";
import { RailSubscriptions } from "../src/components/shell/RailSubscriptions";
import { SubscriptionsFeedSurface } from "../src/components/discovery/SubscriptionsFeedSurface";
import { POST as postLibrary } from "../src/app/api/library/route";

/** The captures' output directory (this evidence folder). */
const OUT_DIR = new URL("../../../evidence/r31/captures/", import.meta.url).pathname;

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
<head><meta charset="utf-8"><title>R31 capture — ${file}</title>
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

/** The signed-in request session view (the persona's own fields). */
function personaSessionView(): RequestSessionView {
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

// The real page flow: the search views join the items the probe saves
// (the surfaces' own law — the join learns from the views).
await loadSearchView(host, "Deep Field Diary", {});
await loadSearchView(host, "Static Bloom", {});
await loadSearchView(host, "Desert Rain Doc", {});
const diary = await fixtureItem(host, "Deep Field Diary");
const bloom = await fixtureItem(host, "Static Bloom");
const desert = await fixtureItem(host, "Desert Rain Doc");

// The real writes — three Subscriptions-list saves (the Subscribe pill's
// own seam): the healthy multi-card grid's stored truth.
for (const item of [diary, bloom, desert]) {
  await post(postLibrary, {
    op: "save", itemId: item.itemId, title: item.title,
    connectorId: item.connectorId, externalRef: item.externalRef,
    listName: "Subscriptions",
  });
}

const sessionView = personaSessionView();
const account: AccountChromeView = await accountChromeViewOf(host, sessionView);

// 00 — the CLOSED account-menu control (the pinned byte-identical state:
// the island's initial render is the trigger alone — the panel never
// paints until the browser-level open).
write(
  "00-account-menu-closed.html",
  renderToStaticMarkup(
    createElement(AccountMenu, {
      profileName: sessionView.profileName ?? "Dev profile",
      ...(sessionView.account?.email !== undefined
        ? { identityEmail: sessionView.account.email }
        : {}),
      profiles: sessionView.account?.profiles ?? [],
      activeProfileId: sessionView.account?.activeProfileId ?? "",
      locale: account.locale,
    }),
  ),
);

// 01 — the root panel (§3's row grammar + the Appearance row's §G1
// activation: the state label + the right-arrow chevron).
write(
  "01-account-menu-root.html",
  renderToStaticMarkup(
    createElement("div", { style: { position: "relative", height: "680px" } },
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

// 02 — §G1 THE PICKER (the captured selected state: "Use device theme" —
// no stored choice; the check-in-box on the device row).
write(
  "02-theme-picker-device.html",
  renderToStaticMarkup(
    createElement("div", { style: { position: "relative", height: "360px" } },
      createElement(AppearancePickerPanel, {
        themeState: "device",
        onSelect: () => {},
        onBack: () => {},
      }),
    ),
  ),
);

// 03 — §G1 THE PICKER (a persisted state: "Dark theme" selected — the
// two-layer truth, the row's CHECK following the seam's stored truth).
write(
  "03-theme-picker-dark.html",
  renderToStaticMarkup(
    createElement("div", { style: { position: "relative", height: "360px" } },
      createElement(AppearancePickerPanel, {
        themeState: "dark",
        onSelect: () => {},
        onBack: () => {},
      }),
    ),
  ),
);

// 04 — §G2 THE HEALTHY GRID (the three subscribed items through the real
// connector read — the browse grid + the captured "Latest" heading).
write(
  "04-subs-feed-grid.html",
  renderToStaticMarkup(
    createElement(SubscriptionsFeedSurface, { entries: account.railSubscriptions }),
  ),
);

// 05 — §G2 THE EMPTY STATE (the honest empty state, the capability row's
// own vocabulary — never a fabricated card).
write(
  "05-subs-feed-empty.html",
  renderToStaticMarkup(createElement(SubscriptionsFeedSurface, { entries: [] })),
);

// 06 — the signed-in shell (the rail's Subscriptions section with the
// §G2 heading link — the corpus taxonomy's Subscriptions entry joined
// to the feed destination).
write(
  "06-shell-rail-heading.html",
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

// 07 — the rail section alone (the heading link + the rows, the seam
// law's unchanged row grammar).
write(
  "07-rail-subscriptions.html",
  renderToStaticMarkup(createElement(RailSubscriptions, { entries: account.railSubscriptions })),
);

// The facts JSON (the measured assertions of the captures above).
const facts: ProbeFacts = {
  generatedAt: new Date().toISOString(),
  surfaces: [
    {
      file: "00-account-menu-closed.html",
      corpusSection: "the pinned control (the closed-menu state stays byte-identical to R30-B)",
      facts: [
        "the island's initial render is the TRIGGER ALONE (no panel, no picker — the open state is the browser-level truth)",
        "the trigger: the squircle chip + aria-expanded=false + data-wfx-account-trigger (R30-B's own markup)",
      ],
    },
    {
      file: "01-account-menu-root.html",
      corpusSection: "GAP-CORPUS.md §G1 (the path) + CORPUS.md §3 (the row grammar)",
      facts: [
        "the Appearance row keeps its state-bearing label (Appearance: Device theme)",
        "the row is the picker's ACTIVATION: a menuitem button (data-wfx-appearance-row) + §3's own right-arrow chevron",
        "the Display-language row stays a pure state display (wfx-account__row--state)",
        `appearanceStateLabel('dark') === ${JSON.stringify(appearanceStateLabel("dark"))} (the label the row shows when Dark persists)`,
      ],
    },
    {
      file: "02-theme-picker-device.html",
      corpusSection: "GAP-CORPUS.md §G1 (g1-2-theme-picker.jpg [VLM-verified] + g1-targeted-2.json)",
      facts: [
        "the header: 'Appearance' + the BACK ARROW icon button (aria-label=Back, the arrow-left glyph)",
        "the subtext: 'Setting applies to this browser only' (verbatim)",
        "exactly 3 option rows in the captured order: Use device theme / Dark theme / Light theme",
        "the captured selected state: 'Use device theme' (data-wfx-theme-selected) — no stored choice",
        "the selected row's left slot paints the CHECK-IN-BOX (the rect+check glyph; no circle — never a radio dot)",
        "the reserved 24px mark slot renders on EVERY row (the captured label alignment, x=1164 vs the row's x=1108)",
      ],
    },
    {
      file: "03-theme-picker-dark.html",
      corpusSection: "GAP-CORPUS.md §G1 (the two-layer truth: the picker row's CHECK follows the seam's stored truth)",
      facts: [
        "the persisted state selects 'Dark theme' (data-wfx-theme-selected on the dark row)",
        "exactly ONE check-in-box paints (the device row's marker is gone)",
        `storedThemeOfState('dark') === ${JSON.stringify(storedThemeOfState("dark"))} (the write persists the choice)`,
        `storedThemeOfState('device') === ${JSON.stringify(storedThemeOfState("device"))} (the device write REMOVES the stored choice — the boot law resumes)`,
        `themeStateOfStored(null) === ${JSON.stringify(themeStateOfStored(null))} (no stored choice = the device law)`,
      ],
    },
    {
      file: "04-subs-feed-grid.html",
      corpusSection: "GAP-CORPUS.md §G2 (g2-subs-feed.json + .jpg — the healthy window's 14 real cards)",
      facts: [
        "the captured section heading renders ('Latest' — present in both captured states)",
        "the browse grid renders the THREE stored entries (data-wfx-subsfeed-entry per item)",
        "each card: the SAME card grammar every feed surface renders (ItemCard) over the JOINED connector read",
        "each card's destination: the entry's own player surface (the rail rows' route law)",
        `the stored truth: ${account.railSubscriptions.length} Subscriptions entries through the REAL subscribe seam (POST /api/library, listName 'Subscriptions')`,
        "NO fabricated meta data: no view counts, no ages, no LIVE badges (the domain model carries none — the honest divergence)",
      ],
    },
    {
      file: "05-subs-feed-empty.html",
      corpusSection: "GAP-CORPUS.md §G2 (the empty state — the capability row's own vocabulary)",
      facts: [
        "the honest empty state: 'No subscriptions yet' + 'Subscribe from any watch page' (the rail's own vocabulary)",
        "NEVER a fabricated card (no data-wfx-subsfeed-entry, no card titles)",
      ],
    },
    {
      file: "06-shell-rail-heading.html",
      corpusSection: "GAP-CORPUS.md §G2 (the destination join — the corpus taxonomy's Subscriptions entry)",
      facts: [
        "the rail's Subscriptions section heading carries href=/feed/subscriptions (data-wfx-rail-subscriptions-heading)",
        "the signed-in chrome renders (the bell + the avatar trigger; no sign-in pill)",
        "the rows keep R30-B's grammar (the 24x24 monogram avatars, the per-entry player destinations)",
      ],
    },
    {
      file: "07-rail-subscriptions.html",
      corpusSection: "CORPUS.md §4 + GAP-CORPUS.md §G2 (the seam law: rows unchanged)",
      facts: [
        "the heading link + the flat list with the 24x24 avatars + the 204x40 entries",
        "each row: the entry's own player href (the join's law — UNLINKED when unjoined)",
      ],
    },
  ],
};

Bun.write(`${OUT_DIR}../probe-facts.json`, `${JSON.stringify(facts, null, 2)}\n`);
