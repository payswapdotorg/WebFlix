/**
 * R32 — THE SHORTS ACTION RAIL (the G4 corpus join:
 * docs/parity-lab/r30/gap-captures/20260926-093102/G4-CORPUS.md).
 *
 * Proves the fourth-gap surface's honest binding over the fixtures-boot
 * composition (the same machinery the battery runs):
 *
 * - THE RAIL's captured grammar: the right vertical column (48px, the
 *   48x48 buttons at the 78px pitch, the count slot under the icon, the
 *   24px icon), the Share cell in its captured "Share" TEXT form, the
 *   count-slot law (like/save carry NO like-count datum — the icon-only
 *   form; never a fabricated "176K"/"512"/"12");
 * - THE TYPED ABSENCES: like/save render no control in the real boot (the
 *   runtime's search hits carry no capability claim — the frozen tree's
 *   law), and comments/remix render no control at all (WebFlix has no
 *   comments surface and no remix analog — the honest absence);
 * - THE LIKE machinery: a like/save-capable card renders the cells through
 *   the frozen tree, and the EXISTING actionStates seam carries the
 *   optimistic + receipt-truth + rollback laws (the exported reducer,
 *   driven directly);
 * - THE CHANNEL ROW: the sources model's own display name (never a
 *   fabricated @handle) + the Subscribe pill (78x32-class) bound to the
 *   REAL subscribe seam (POST /api/library — the same write the watch
 *   page's pill performs), with the boot-payload truth read through the
 *   same library folds and the reload-durability law (the stored
 *   source-identity join survives a fresh process);
 * - THE RAIL's 5TH ELEMENT: the monogram avatar (the rail subscriptions'
 *   24x24 pattern), NO link (WebFlix has no channel destination);
 * - THE PINNED CONTROLS: the R24-W2 parity controls and the real
 *   queue navigation stay byte-identical (the seam law).
 *
 * Determinism: fixture transport, controlled env (restored), no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

import { resetWebHostProcessState } from "../src/host/testing";
import { resetWebRuntimeHostForTests } from "../src/host/web-host";
import { resetItemJoinForTests } from "../src/host/view-models";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { loadShortsPayload } from "../src/host/shorts";
import type { ShortsBootPayload } from "../src/host/shorts";
import { ShortsFeed, shortsSessionReducer } from "../src/components/shorts/ShortsFeed";
import { createShortFeedPresenter } from "@wfx/experience";
import { SUBSCRIPTIONS_LIST } from "../src/components/player/subscription-list";
import { POST as postLibrary } from "../src/app/api/library/route";
import { POST as postActions } from "../src/app/api/actions/route";
import { withEnv } from "./fake-web";

// ---------------------------------------------------------------------------
// Helpers (the shorts-parity/subscribe-reload-durability conventions)
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

/** Render the feed for one payload (the SSR composition the route serves). */
function renderFeed(payload: ShortsBootPayload): string {
  return renderToStaticMarkup(
    createElement(ShortsFeed, { payload: payload as Parameters<typeof ShortsFeed>[0]["payload"] }),
  );
}

/** The fixture source's own display name (the sources model's field). */
const FIXTURE_SOURCE_NAME = "Fake Source (TEST FIXTURE — never production)";

beforeEach(() => {
  resetWebHostProcessState();
});

// ---------------------------------------------------------------------------
// THE RAIL — the captured grammar + the honest absences
// ---------------------------------------------------------------------------

describe("R32 — the shorts action rail (the G4 corpus join)", () => {
  it("renders the captured column grammar: the 48px rail, the Share cell with its captured 'Share' text label, the count-slot law", async () => {
    const host = await bootHost();
    const payload = await loadShortsPayload(host);
    const markup = renderFeed(payload);

    // The rail column (the G4 container — the right vertical column).
    expect(markup).toContain("data-wfx-shortrail");
    // The captured Share form: the "Share" TEXT label (no count — the
    // corpus's own no-count form for share).
    expect(markup).toContain('data-wfx-shorts-action="share"');
    expect(markup).toContain('data-wfx-shortrail-count="share"');
    expect(markup).toContain(">Share</span>");
    // THE COUNT-SLOT LAW: exactly ONE count slot renders (share's); the
    // like/save slots carry no datum — icon-only, never a fabricated
    // "176K"/"512"/"12" (the corpus numbers are YouTube's own truth).
    expect((markup.match(/data-wfx-shortrail-count=/g) ?? []).length).toBe(1);
    expect(markup).not.toContain("176K");
  });

  it("renders the typed absences honestly: like/save no control in the real boot; comments/remix no control at all", async () => {
    const host = await bootHost();
    const payload = await loadShortsPayload(host);
    const markup = renderFeed(payload);

    // The real boot's cards carry no like/save capability claim (the
    // runtime's search hits — host/shorts.ts's honest capabilities: []) —
    // the frozen tree omits the controls (never a greyed-out lie).
    expect(markup).not.toContain('data-wfx-shorts-action="like"');
    expect(markup).not.toContain('data-wfx-shorts-action="save"');
    // The product-truth absences ride the rail as typed data: WebFlix has
    // NO comments surface and NO remix analog (omitted — the honest
    // absence, never a dead imitation).
    expect(markup).toContain('data-wfx-shortrail-absent="comments remix"');
    expect(markup).not.toContain('data-wfx-shorts-action="comment"');
    expect(markup).not.toContain('data-wfx-shorts-action="remix"');
  });

  it("a like/save-capable card renders the cells icon-only through the frozen tree (the count slot carries no datum)", async () => {
    const host = await bootHost();
    const payload = await loadShortsPayload(host);
    // The synthetic capability truth: the realization DECLARES like/save
    // (the frozen tree's own gate — the control renders when the source
    // claims the capability; the a11y stays the tree's verbatim label).
    const card = payload.page.cards[0];
    if (card === undefined) throw new Error("the fixture shorts page carried no cards");
    const likeCapable: ShortsBootPayload = {
      ...payload,
      page: {
        ...payload.page,
        cards: [
          {
            ...card,
            candidate: {
              ...card.candidate,
              realization: { ...card.candidate.realization, capabilities: ["like", "save"] },
            },
          },
          ...payload.page.cards.slice(1),
        ],
      },
    };
    const markup = renderFeed(likeCapable);

    expect(markup).toContain('data-wfx-shorts-action="like"');
    expect(markup).toContain('data-wfx-shorts-action="save"');
    // The tree's a11y label, verbatim (the frozen wiring contract; the
    // static-markup apostrophe escape is renderToStaticMarkup's own).
    expect(markup).toContain("Like &#x27;Neon Rain&#x27; on its source");
    // The toggle state rides the like/save buttons (the captured toggle
    // form — share carries none, the captured plain button).
    expect(markup).toMatch(/aria-pressed="false" data-wfx-shorts-action="like"/);
    expect(markup).toMatch(/aria-pressed="false" data-wfx-shorts-action="save"/);
  });

  it("the actionStates seam carries the like laws (optimistic + receipt-truth + rollback — the existing reducer)", async () => {
    const host = await bootHost();
    const payload = await loadShortsPayload(host);
    const presenter = createShortFeedPresenter();
    const initial = {
      view: presenter.initial(payload.page, {
        userId: payload.userId,
        sessionId: payload.sessionId,
        prefetchAhead: payload.prefetchAhead,
      }),
      policy: payload.policy,
      userId: payload.userId,
      sessionId: payload.sessionId,
      swipesSinceRerank: 0,
      lastRerankAtMs: 0,
      skippedItemIds: [],
      events: [],
      rerankNotes: [],
      rerankBusy: false,
      actionStates: {},
      emitError: null,
    };
    const current = initial.view.current;
    expect(current).not.toBeNull();
    const key = `action:like:${current!.item.id}`;

    // Optimistic: the begin marks the control pending + optimistic.
    const begun = shortsSessionReducer(initial, { kind: "action-begin", key });
    expect(begun.actionStates[key]?.optimistic).toBe(true);
    expect(begun.actionStates[key]?.pending).toBe(true);

    // Receipt-truth: a confirmed receipt settles the control (and mirrors
    // the engagement event — the accumulated decision input).
    const confirmed = shortsSessionReducer(begun, {
      kind: "action-receipt",
      key,
      status: "confirmed",
      event: null,
    });
    expect(confirmed.actionStates[key]?.optimistic).toBe(false);
    expect(confirmed.actionStates[key]?.settled).toBe("confirmed");
    expect(confirmed.actionStates[key]?.pending).toBe(false);

    // Rollback: an unsupported receipt NEVER fakes success (the frozen
    // law — the control rolls back with the typed failure text).
    const rolled = shortsSessionReducer(begun, {
      kind: "action-receipt",
      key,
      status: "unsupported",
      event: null,
    });
    expect(rolled.actionStates[key]?.optimistic).toBe(false);
    expect(rolled.actionStates[key]?.failure).toContain("does not support that action");
  });

  it("the real /api/actions receipt maps to the rail's vocabulary (the like dispatch the fireAction performs)", async () => {
    await bootHost();
    const response = await post(postActions, {
      type: "like",
      connectorId: "fake-source",
      externalRef: "fake:short-1",
      itemId: "wfxitm_probefullyr32",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status?: string };
    // The receipt vocabulary the reducer settles on (the fixture source
    // declares no like capability — the honest typed answer, whatever it
    // is, is one of the four, and the reducer renders it verbatim).
    expect(body.status !== undefined).toBe(true);
    expect(["confirmed", "local-only", "unsupported", "failed"]).toContain(body.status ?? "");
  });
});

// ---------------------------------------------------------------------------
// THE CHANNEL ROW — the identity truth + the REAL subscribe seam
// ---------------------------------------------------------------------------

describe("R32 — the shorts channel row (the G4 channel row, honestly backed)", () => {
  it("renders the sources model's own display name (never a fabricated @handle) + the idle pill", async () => {
    const host = await bootHost();
    const payload = await loadShortsPayload(host);
    // The payload's channel identity truth: the N29 sources-model read.
    expect(payload.sourceNames["fake-source"]).toBe(FIXTURE_SOURCE_NAME);

    const markup = renderFeed(payload);
    expect(markup).toContain('data-wfx-shorts-channel-name');
    expect(markup).toContain(FIXTURE_SOURCE_NAME);
    // The pill: the captured 78x32-class form + the honest aria (the
    // identity law — WebFlix's sources carry display names, not handles).
    expect(markup).toContain('data-wfx-shorts-subscribe-state="idle"');
    expect(markup).toContain(`aria-label="Subscribe to ${FIXTURE_SOURCE_NAME}"`);
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).not.toContain("@JackieMcReY");
  });

  it("the Subscribe pill round-trips through the REAL seam: the boot payload reads the stored truth back as SUBSCRIBED", async () => {
    const host = await bootHost();
    const payload = await loadShortsPayload(host);
    const current = payload.page.cards[0];
    if (current === undefined) throw new Error("the fixture shorts page carried no cards");

    // The exact write the pill performs (the same /api/library body the
    // watch page's Subscribe pill sends).
    const saved = await post(postLibrary, {
      op: "save",
      itemId: current.candidate.itemId,
      title: String(current.candidate.features["canonicalTitle"] ?? current.candidate.itemId),
      connectorId: current.candidate.realization.connectorId,
      externalRef: current.candidate.realization.externalRef,
      listName: SUBSCRIPTIONS_LIST,
    });
    const savedBody = (await saved.json()) as { ok: boolean; entry?: { listName: string } };
    expect(savedBody.ok).toBe(true);
    expect(savedBody.entry?.listName).toBe(SUBSCRIPTIONS_LIST);

    // The payload's subscribed truth re-reads the seam (the dual law:
    // the stored source identity + the hydrated local fold).
    const payloadAfter = await loadShortsPayload(host);
    expect(
      payloadAfter.subscriptions.sourceKeys.some(
        (key) =>
          key.connectorId === current.candidate.realization.connectorId &&
          key.externalRef === current.candidate.realization.externalRef,
      ),
    ).toBe(true);
    expect(payloadAfter.subscriptions.itemIds).toContain(current.candidate.itemId);

    // The pill renders the SUBSCRIBED truth (never an idle lie on a
    // re-read of a real subscription).
    const markupAfter = renderFeed(payloadAfter);
    expect(markupAfter).toContain('data-wfx-shorts-subscribe-state="subscribed"');
    expect(markupAfter).toContain(`aria-label="Unsubscribe from ${FIXTURE_SOURCE_NAME}"`);
    expect(markupAfter).toContain(">Subscribed</span>");

    // Cleanup (the store left clean — the sweep's law).
    const removed = await post(postLibrary, {
      op: "remove",
      itemId: current.candidate.itemId,
      title: String(current.candidate.features["canonicalTitle"] ?? current.candidate.itemId),
      connectorId: current.candidate.realization.connectorId,
      externalRef: current.candidate.realization.externalRef,
      listName: SUBSCRIPTIONS_LIST,
    });
    expect(((await removed.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("the reload-durability law: a fresh process's payload still answers subscribed (the stored source-identity join)", async () => {
    const hostA = await bootHost();
    const payloadA = await loadShortsPayload(hostA);
    const current = payloadA.page.cards[0];
    if (current === undefined) throw new Error("the fixture shorts page carried no cards");
    await post(postLibrary, {
      op: "save",
      itemId: current.candidate.itemId,
      title: String(current.candidate.features["canonicalTitle"] ?? current.candidate.itemId),
      connectorId: current.candidate.realization.connectorId,
      externalRef: current.candidate.realization.externalRef,
      listName: SUBSCRIPTIONS_LIST,
    });

    // THE RELOAD: a fresh process's runtime (the stored truth survives —
    // the granular resets, the subscribe-reload-durability law).
    resetWebRuntimeHostForTests();
    resetItemJoinForTests();
    const hostB = await bootHost();
    const payloadB = await loadShortsPayload(hostB);

    // The stored source-identity join answers across the fresh process.
    expect(
      payloadB.subscriptions.sourceKeys.some(
        (key) =>
          key.connectorId === current.candidate.realization.connectorId &&
          key.externalRef === current.candidate.realization.externalRef,
      ),
    ).toBe(true);
    const markupB = renderFeed(payloadB);
    expect(markupB).toContain('data-wfx-shorts-subscribe-state="subscribed"');

    // Cleanup (leave the store clean).
    await post(postLibrary, {
      op: "remove",
      itemId: current.candidate.itemId,
      title: String(current.candidate.features["canonicalTitle"] ?? current.candidate.itemId),
      connectorId: current.candidate.realization.connectorId,
      externalRef: current.candidate.realization.externalRef,
      listName: SUBSCRIPTIONS_LIST,
    });
  });

  it("the rail's 5th element: the monogram avatar (the channel identity's own first mark) renders with NO link", async () => {
    const host = await bootHost();
    const payload = await loadShortsPayload(host);
    const markup = renderFeed(payload);

    // The monogram law (the rail subscriptions' 24x24 pattern): the
    // channel name's own first mark.
    expect(markup).toMatch(/data-wfx-shortrail-avatar[^>]*>F</);
    // NO LINK: WebFlix has no channel destination (the honest absence —
    // the avatar is a span, never an anchor).
    expect(markup).not.toMatch(/<a[^>]*data-wfx-shortrail-avatar/);
  });

  it("the title truth: the item's own overlay title renders; the nav + the pinned R24-W2 controls stay", async () => {
    const host = await bootHost();
    const payload = await loadShortsPayload(host);
    const markup = renderFeed(payload);

    // THE TITLE: the item's own (the corpus's h1 slot — WebFlix's
    // overlay title, the established anatomy; no hashtags: the model
    // carries none, none are fabricated).
    expect(markup).toContain('<h2 class="wfx-shortcard__title">Neon Rain</h2>');
    expect(markup).not.toContain("#marvel");

    // PREV/NEXT: the real queue navigation (the existing form — the
    // seam law: no corpus rebuild of the nav).
    expect(markup).toContain('data-wfx-shorts-next');
    expect(markup).toContain('data-wfx-shorts-back');

    // THE PINNED CONTROLS: the R24-W2 parity row stays byte-identical.
    expect(markup).toContain("data-wfx-shorts-speed");
    expect(markup).toContain("data-wfx-shorts-clearscreen-toggle");
    expect(markup).toContain("data-wfx-shorts-feedback-toggle");
    expect(markup).toContain('data-wfx-shorts-clearscreen="false"');
  });
});

// ---------------------------------------------------------------------------
// THE GEOMETRY — the captured grammar in the stylesheet
// ---------------------------------------------------------------------------

describe("R32 — the rail's captured geometry (the stylesheet grammar)", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

  it("carries the captured rail grammar: the 48px column, the 48x48 buttons at the 78px pitch, the 24px monogram avatar", () => {
    // The G4 measures (g4-rail-extras.json / G4-CORPUS.md "THE ACTION
    // RAIL"): container 48px wide; buttons 48x48 at a 78px pitch; the
    // avatar (the monogram law) at 24x24.
    expect(css).toMatch(/\.wfx-shortrail \{[^}]*width: 48px;/s);
    expect(css).toMatch(/\.wfx-shortrail__cell \{[^}]*height: 78px;/s);
    expect(css).toMatch(/\.wfx-shortrail__btn \{[^}]*width: 48px;[^}]*height: 48px;/s);
    expect(css).toMatch(/\.wfx-shortrail__avatar \{[^}]*width: 24px;[^}]*height: 24px;/s);
  });

  it("carries the captured 78x32 subscribe pill class + the clear-screen law extends to the rail", () => {
    expect(css).toMatch(/\.wfx-subscribe--shorts \{[^}]*height: 32px;[^}]*min-width: 78px;/s);
    // The R24-W2 distraction-free presentation hides the rail with the
    // overlay chrome (the pinned control's law, extended to the joined
    // surface — the rail is overlay chrome).
    expect(css).toMatch(/\.wfx-shorts__viewport--clear \.wfx-shortcard__overlay,\s*\.wfx-shorts__viewport--clear \.wfx-shortrail,/);
  });
});
