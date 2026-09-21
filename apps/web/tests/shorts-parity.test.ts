/**
 * R24-W2 — the Shorts parity controls + the cards' quiet action row +
 * the policy-gated preview tests (bun:test).
 *
 * Proves the R24-C Shorts rows' + the card placement rows' real backing
 * over the fixtures-boot composition:
 *
 * - THE SHORTS CARD's parity controls render (the speed select, the
 *   clear-screen toggle, the inline feedback entry, the source chip) —
 *   the same vocabulary the long-form surfaces carry;
 * - THE INLINE FEEDBACK submits through the SAME J15 seam (/api/feedback
 *   — the reversible record store), with the honest typed states;
 * - THE CARDS' QUIET ACTION ROW renders on the discovery/search rows
 *   (queue/save/share — the placement law's card entry points) with the
 *   source chip (the channel-profile-pages row);
 * - THE POLICY-GATED PREVIEW renders its mount with the attention
 *   mode's derivation sentence + the honest capability truth.
 *
 * Determinism: fixture transport, controlled env (restored), no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { resetWebHostProcessState, resetWebHostProcessState as _reset } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { loadHomeView, loadSearchView, cardActionContextOf } from "../src/host/view-models";
import { loadShortsPayload } from "../src/host/shorts";
import { ShortsFeed } from "../src/components/shorts/ShortsFeed";
import { HomeSurface } from "../src/components/home/HomeSurface";
import { SearchSurface } from "../src/components/search/SearchSurface";
import { CardPreview } from "../src/components/cards/CardPreview";
import { ItemCard } from "../src/components/cards/ItemCard";
import { POST as postFeedback, GET as getFeedback } from "../src/app/api/feedback/route";
import { withEnv } from "./fake-web";

// ---------------------------------------------------------------------------
// Helpers
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

beforeEach(() => {
  resetWebHostProcessState();
});

// ---------------------------------------------------------------------------
// The Shorts parity controls
// ---------------------------------------------------------------------------

describe("R24-W2 — the Shorts card's parity controls", () => {
  it("the speed select, the clear-screen toggle, the inline feedback entry, and the source chip render", async () => {
    const host = await bootHost();
    const payload = await loadShortsPayload(host);
    const markup = renderToStaticMarkup(
      createElement(ShortsFeed, { payload: payload as Parameters<typeof ShortsFeed>[0]["payload"] }),
    );
    expect(markup).toContain("data-wfx-shorts-speed");
    expect(markup).toContain("data-wfx-shorts-speed-select");
    expect(markup).toContain("data-wfx-shorts-clearscreen-toggle");
    expect(markup).toContain("data-wfx-shorts-feedback");
    expect(markup).toContain("data-wfx-shorts-feedback-toggle");
    expect(markup).toContain("data-wfx-shorts-source");
    // The clear-screen state rides the viewport's own data attribute.
    expect(markup).toContain('data-wfx-shorts-clearscreen="false"');
  });

  it("the inline feedback submits through the SAME J15 seam (the reversible record store)", async () => {
    const host = await bootHost();
    const payload = await loadShortsPayload(host);
    const current = payload.page.cards[0];
    expect(current).toBeDefined();
    const model = await host.runtime.search({ query: "Neon Rain" });
    const hit = model.hits.find((entry) => entry.result.title === "Neon Rain");
    expect(hit).toBeDefined();

    const submitted = await post(postFeedback, { kind: "not-interested", target: hit!.canonicalItemId });
    expect(submitted.status).toBe(201);

    // The record list answers the same seam (the J15 reversibility law
    // — the GET route's `controls` vocabulary).
    const list = await getFeedback(new Request("http://localhost/api/feedback"));
    const listBody = (await list.json()) as { controls?: { kind: string; target: string }[] };
    expect(listBody.controls?.some((record) => record.target === hit!.canonicalItemId)).toBe(true);
  });

  it("the inline feedback answers the typed 400 for an unknown kind (never a silent drop)", async () => {
    await bootHost();
    const bad = await post(postFeedback, { kind: "love-it", target: "wfxitm_x" });
    expect(bad.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// The cards' quiet action row + the source chip
// ---------------------------------------------------------------------------

describe("R24-W2 — the cards' quiet action row (the placement law's card entry points)", () => {
  it("the discovery rows render the action row (queue/save/share) + the source chip on cards", async () => {
    const host = await bootHost();
    const view = await loadHomeView(host);
    const markup = renderToStaticMarkup(createElement(HomeSurface, { view }));
    expect(markup).toContain("data-wfx-card-actions");
    expect(markup).toContain("data-wfx-queue-add-btn");
    expect(markup).toContain("data-wfx-watchlist-save");
    expect(markup).toContain("data-wfx-share");
    expect(markup).toContain("data-wfx-card-source");
  });

  it("the search results render the action row + the availability chip (the same card grammar)", async () => {
    const host = await bootHost();
    const view = await loadSearchView(host, "deep field");
    const markup = renderToStaticMarkup(createElement(SearchSurface, { view }));
    expect(markup).toContain("data-wfx-card-actions");
    expect(markup).toContain("data-wfx-card-availability");
    expect(markup).toContain("data-wfx-card-source");
  });

  it("the card action context derives from the runtime's own policy + watchlist reads (never a second policy)", async () => {
    const host = await bootHost();
    const context = cardActionContextOf(host);
    // The fixtures boot's default attention mode is balanced.
    expect(context.attentionMode).toBe("balanced");
    expect(Array.isArray(context.savedItemIds)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The policy-gated card preview
// ---------------------------------------------------------------------------

describe("R24-W2 — the policy-gated card preview (the inline-playback row)", () => {
  it("the preview mount renders with the policy derivation + the honest capability truth", () => {
    const markup = renderToStaticMarkup(
      createElement(CardPreview, {
        itemId: "wfxitm_test",
        title: "Deep Field Diary",
        attentionMode: "balanced",
        previewable: false,
      }),
    );
    expect(markup).toContain('data-wfx-preview-policy="balanced"');
    expect(markup).toContain("data-wfx-card-preview");
    // The honest capability truth rides the mount's data attribute (the
    // source provides no previewable media in this configuration).
    expect(markup).toContain('data-wfx-previewable="false"');
  });

  it("the mindful policy renders its own derivation (the preview-off truth)", () => {
    const markup = renderToStaticMarkup(
      createElement(CardPreview, {
        itemId: "wfxitm_test",
        title: "Deep Field Diary",
        attentionMode: "mindful",
        previewable: false,
      }),
    );
    expect(markup).toContain('data-wfx-preview-policy="mindful"');
  });

  it("the card WITH an action context renders the preview mount + the action row (the composed card)", () => {
    const markup = renderToStaticMarkup(
      createElement(ItemCard, {
        card: {
          itemId: "wfxitm_test",
          title: "Deep Field Diary",
          canonicalType: "video",
          durationMs: 1_800_000,
          connectorId: "fake-source",
          externalRef: "fake:video-1",
        },
        actions: { attentionMode: "balanced", savedItemIds: [] },
      }),
    );
    expect(markup).toContain("data-wfx-cardwrap");
    expect(markup).toContain("data-wfx-card-preview");
    expect(markup).toContain("data-wfx-card-actions");
    expect(markup).toContain("data-wfx-card-source");
  });
});
