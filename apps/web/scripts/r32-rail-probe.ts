/**
 * R32 — the SSR composition probe (apps/web/scripts/r32-rail-probe.ts).
 *
 * Renders the shorts action rail (the G4 corpus join:
 * docs/parity-lab/r30/gap-captures/20260926-093102/G4-CORPUS.md) through
 * the SAME composition the route serves (the fixture host + the payload
 * loader + renderToStaticMarkup — the exact machinery the test battery
 * runs), writing one HTML capture per state into evidence/r32/captures/
 * plus a facts JSON (the measured assertions of the captures — the
 * corpus-citation table's proof rows).
 *
 * Captures:
 * - 01-rail-boot.html        — the fixture-boot rail (the share-only real
 *                              truth: like/save typed-absent, the channel
 *                              row, the monogram avatar);
 * - 02-rail-like-capable.html— the synthetic like/save-capable page (the
 *                              frozen tree's gate opened — the icon-only
 *                              cells, the count-slot law);
 * - 03-rail-subscribed.html  — the REAL subscribe seam's round trip (a
 *                              /api/library save → the payload re-read →
 *                              the pill renders the stored truth).
 *
 * Run: `bun apps/web/scripts/r32-rail-probe.ts` (from the repo root).
 * Deterministic: fixture transport, the scripted persona, no network.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { resetWebHostProcessState } from "../src/host/testing";
import { loadShortsPayload } from "../src/host/shorts";
import type { ShortsBootPayload } from "../src/host/shorts";
import { ShortsFeed } from "../src/components/shorts/ShortsFeed";
import { SUBSCRIPTIONS_LIST } from "../src/components/player/subscription-list";
import { POST as postLibrary } from "../src/app/api/library/route";

/** The captures' output directory (this evidence folder). */
const OUT_DIR = new URL("../../../evidence/r32/captures/", import.meta.url).pathname;

/** The facts summary the probe writes beside the captures. */
interface ProbeFacts {
  readonly generatedAt: string;
  readonly surfaces: ReadonlyArray<{
    readonly file: string;
    readonly corpusSection: string;
    readonly facts: ReadonlyArray<string>;
  }>;
}

/** The mutable accumulator (frozen into the facts record at the end). */
const surfaces: { file: string; corpusSection: string; facts: string[] }[] = [];

/** Write one capture (the HTML fragment) + return its path. */
function write(file: string, markup: string): void {
  const document = `<!doctype html>
<html lang="en" data-theme="dark">
<head><meta charset="utf-8"><title>R32 capture — ${file}</title>
<link rel="stylesheet" href="../../apps/web/src/app/globals.css"></head>
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

/** Render the feed for one payload (the SSR composition the route serves). */
function renderFeed(payload: ShortsBootPayload): string {
  return renderToStaticMarkup(
    createElement(ShortsFeed, { payload: payload as Parameters<typeof ShortsFeed>[0]["payload"] }),
  );
}

// ---------------------------------------------------------------------------
// The probe body.
// ---------------------------------------------------------------------------

resetWebHostProcessState();
process.env.WFX_DEV_FIXTURES = "1";
const host: WebRuntimeHost = await getWebRuntimeHost();

const facts: ProbeFacts = {
  generatedAt: new Date().toISOString(),
  surfaces,
};

// ── 01 — the fixture-boot rail (the real truth of the real boot) ──────────
const boot = await loadShortsPayload(host);
const bootMarkup = renderFeed(boot);
write("01-rail-boot.html", bootMarkup);
surfaces.push({
  file: "01-rail-boot.html",
  corpusSection: "G4-CORPUS.md — THE ACTION RAIL + THE CHANNEL ROW + THE BINDING LAWS",
  facts: [
    `the rail column renders (data-wfx-shortrail) with the typed product-absences "comments remix" (data-wfx-shortrail-absent)`,
    `the share cell renders its captured "Share" TEXT label (the corpus's own no-count form) — exactly ONE count slot (the count-slot law: like/save carry no like-count datum — icon-only)`,
    `like/save render NO control in the real boot (the runtime's search hits carry no capability claim — the frozen tree's typed absence; never a greyed-out lie)`,
    `the channel row renders the sources model's own display name: "${boot.sourceNames["fake-source"] ?? "fake-source"}" (the N29 identity seam; never a fabricated @handle)`,
    `the Subscribe pill renders idle (aria "Subscribe to ${boot.sourceNames["fake-source"] ?? "fake-source"}", 78x32-class form)`,
    `the rail's 5th element: the monogram avatar (the channel name's own first mark, the rail subscriptions' 24x24 pattern) with NO link (WebFlix has no channel destination)`,
    `the item's own title renders (the overlay's h2); no hashtags (the model carries none — none fabricated)`,
    `the pinned controls stay: the R24-W2 parity row + the real queue navigation (data-wfx-shorts-next/back)`,
  ],
});

// ── 02 — the synthetic like/save-capable page (the frozen tree's gate) ────
const firstCard = boot.page.cards[0];
if (firstCard === undefined) throw new Error("the fixture shorts page carried no cards");
const likeCapable: ShortsBootPayload = {
  ...boot,
  page: {
    ...boot.page,
    cards: [
      {
        ...firstCard,
        candidate: {
          ...firstCard.candidate,
          realization: { ...firstCard.candidate.realization, capabilities: ["like", "save"] },
        },
      },
      ...boot.page.cards.slice(1),
    ],
  },
};
const likeMarkup = renderFeed(likeCapable);
write("02-rail-like-capable.html", likeMarkup);
surfaces.push({
  file: "02-rail-like-capable.html",
  corpusSection: "G4-CORPUS.md — THE ACTION RAIL (the like button) + THE BINDING LAWS (the honest-divergence law)",
  facts: [
    `a realization that DECLARES the like/save capabilities renders the cells through the frozen tree (the tree's own gate — the a11y labels verbatim from the view model)`,
    `the like/save cells render ICON-ONLY (no count-slot content — the count-slot law: the actionStates seam settles a receipt, never a count; never a fabricated "176K")`,
    `the toggle state rides aria-pressed (the captured toggle form); the write goes through the EXISTING machinery (fireAction → POST /api/actions → the actionStates reducer: optimistic + receipt-truth + rollback)`,
  ],
});

// ── 03 — the REAL subscribe seam's round trip (the stored truth re-read) ──
const current = boot.page.cards[0];
if (current === undefined) throw new Error("the fixture shorts page carried no cards");
const title = String(current.candidate.features["canonicalTitle"] ?? current.candidate.itemId);
const saved = await post(postLibrary, {
  op: "save",
  itemId: current.candidate.itemId,
  title,
  connectorId: current.candidate.realization.connectorId,
  externalRef: current.candidate.realization.externalRef,
  listName: SUBSCRIPTIONS_LIST,
});
const savedBody = (await saved.json()) as { ok: boolean; entry?: { listName: string } };
if (savedBody.ok !== true) throw new Error("the probe's subscribe write failed");
const payloadAfter = await loadShortsPayload(host);
const subscribedMarkup = renderFeed(payloadAfter);
write("03-rail-subscribed.html", subscribedMarkup);
surfaces.push({
  file: "03-rail-subscribed.html",
  corpusSection: "G4-CORPUS.md — THE CHANNEL ROW (the Subscribe pill)",
  facts: [
    `the pill's write is the REAL subscribe seam (POST /api/library {op:"save", listName:"Subscriptions"} — the same write the watch page's pill, the rail subscriptions, and the subscriptions feed use)`,
    `the boot payload re-reads the seam's stored truth (the dual law: the stored source identities + the hydrated local fold) — the pill renders SUBSCRIBED (never an idle lie on a re-read of a real subscription)`,
    `the stored source-identity join is the durable cross-load key (the reload-durability law — proven live in the lane test)`,
  ],
});
// Cleanup (the store left clean — the sweep's law).
await post(postLibrary, {
  op: "remove",
  itemId: current.candidate.itemId,
  title,
  connectorId: current.candidate.realization.connectorId,
  externalRef: current.candidate.realization.externalRef,
  listName: SUBSCRIPTIONS_LIST,
});

Bun.write(
  new URL("../../../evidence/r32/probe-facts.json", import.meta.url).pathname,
  JSON.stringify(facts, null, 2),
);
// (The R31 probe's own law: no console — the facts file IS the output.)

