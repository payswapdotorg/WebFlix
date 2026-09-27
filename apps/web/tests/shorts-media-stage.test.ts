/**
 * R33-A — THE SHORTS MEDIA STAGE (the operator's #1: "the shorts are
 * still bad" — the R32 divergence ledger row 8's gap, closed with the
 * REAL machinery).
 *
 * Proves the stage's honest binding over the fixtures-boot composition
 * (the same machinery the battery runs):
 *
 * - THE JOIN (the seam law): the current card grows the stage (the
 *   resolving marker — the resolve happens at view time, honestly after
 *   the mount); the next card carries the resolve-only prefetch marker;
 *   the pinned R32 rail + channel row + title + nav + the R24-W2 parity
 *   controls stay byte-identical (the pinned suites' own assertions
 *   re-proven on this lane's markup);
 * - THE RESOLVE SEAM (the real-media law): the REAL /api/preview route
 *   answers the fixture short's playable realization (previewable + the
 *   provider's embed URL), and answers the honest no-embed truth for a
 *   browser-only item (never a fabricated stage);
 * - THE HONEST FALLBACK: the pure state machine settles the unavailable
 *   state with the honest reason and NO embed (the card keeps its
 *   placeholder-art + title form — never a fake player, never a spinner);
 * - THE EVIDENCE LAW (R26-W2): only provider-reported deliveries advance
 *   the state (the idle truth carries live=false + phase "unstarted";
 *   infoDelivery shapes fold phase/mute/duration/position; nothing else
 *   moves them);
 * - THE PREFETCH LAW: the per-item resolve cache carries the prefetch
 *   window (ONE read per item — the second resolve answers from the
 *   cache; only the ACTIVE card ever mounts, per the component's own
 *   projection);
 * - THE SESSION LAW (the watch surface's own seam):
 *   `resolveShortsPlaybackSession` resolves the fixture short's EMBED
 *   realization through the runtime's frozen path, records the intent in
 *   the playback bridge (the SAME record the player page writes — the
 *   bridge answers it back), and the session's commands execute through
 *   the REAL /api/playback route; the no-embed item answers the typed
 *   failure (never a fabricated session id); the thin /api/shorts-session
 *   route validates its body and carries the typed outcome verbatim;
 * - THE k/m GRAMMAR (the chrome law's WebFlix bindings): the watch
 *   surface's key derivation with the typing guard;
 * - THE PINNED-CONTROLS COLLISION LAW (the lead's REQUIRE-CHANGES fix):
 *   the player's top-chrome zone is the player's own — the pinned rows
 *   (the discovery chips / the position pill / the R24-W2 parity
 *   controls) clear the unmute affordance's zone geometrically (the pill
 *   is trapped inside the card's z=2 stacking context, so a z-index can
 *   never win it; raising the card would steal the chips' clicks) —
 *   probed from the stylesheet's own numbers, desktop + mobile.
 *
 * Determinism: fixture transport, controlled env (restored), no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { loadShortsPayload } from "../src/host/shorts";
import {
  resolveShortsPlaybackSession,
  type ShortsBootPayload,
} from "../src/host/shorts";
import { bridgedIntentOf } from "../src/host/playback-bridge";
import { ShortsFeed } from "../src/components/shorts/ShortsFeed";
import { ShortsMediaStage } from "../src/components/shorts/ShortsMediaStage";
import {
  applyShortsStageEvidence,
  resetShortsStageResolveCacheForTests,
  resolveShortsStageMedia,
  settleShortsStageResolve,
  settleShortsStageUnbound,
  shouldReportShortsStageProgress,
  shortsStageKeyCommandOf,
  SHORTS_STAGE_IDLE,
} from "../src/components/shorts/shorts-stage-client";
import { GET as getPreview } from "../src/app/api/preview/route";
import { POST as postShortsSession } from "../src/app/api/shorts-session/route";
import { POST as postPlayback } from "../src/app/api/playback/route";
import { withEnv } from "./fake-web";

// ---------------------------------------------------------------------------
// Helpers (the shorts-rail-parity conventions)
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

/** Render the feed for one payload (the SSR composition the route serves). */
function renderFeed(payload: ShortsBootPayload): string {
  return renderToStaticMarkup(
    createElement(ShortsFeed, { payload: payload as Parameters<typeof ShortsFeed>[0]["payload"] }),
  );
}

/** GET one route handler (the real handler, no network). */
async function get(handler: (request: Request) => Promise<Response>, url: string): Promise<Response> {
  return handler(new Request(url, { method: "GET" }));
}

/** POST one JSON body to a route handler (the real handler, no network). */
async function post(
  handler: (request: Request) => Promise<Response>,
  body: unknown,
): Promise<Response> {
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
  resetShortsStageResolveCacheForTests();
});

// ---------------------------------------------------------------------------
// THE JOIN — the seam law (the card grows the stage; the pinned chrome stays)
// ---------------------------------------------------------------------------

describe("R33-A — the media stage join (the seam law)", () => {
  it("the current card carries the ACTIVE stage (the resolving truth — the resolve fires at view time) + the next card the prefetch marker; no iframe renders in SSR (honest)", async () => {
    const host = await bootHost();
    const payload = await loadShortsPayload(host);
    const markup = renderFeed(payload);

    // THE CURRENT CARD's stage: the resolving truth (the server render
    // cannot resolve — the read happens at view time, on the client; the
    // marker is honest, never a fake embed).
    expect(markup).toContain('data-wfx-shorts-media="stage"');
    expect(markup).toContain('data-wfx-shortstage-state="resolving"');
    // THE NEXT CARD's stage: the resolve-only prefetch form (the prefetch
    // law — the cache warms, nothing mounts).
    expect(markup).toContain('data-wfx-shorts-media="prefetch"');
    expect(markup).toContain('data-wfx-shortstage-prefetch="true"');
    // Exactly ONE active stage + ONE prefetch marker (never the whole
    // stack — the perf law).
    expect((markup.match(/data-wfx-shortstage-prefetch="true"/g) ?? []).length).toBe(1);
    expect((markup.match(/data-wfx-shorts-media="stage"/g) ?? []).length).toBe(1);
    // NO IFRAME in the server render: the resolve has not answered — the
    // stage never fabricates an embed (the real-media law).
    expect(markup).not.toContain("data-wfx-shortstage-frame");
  });

  it("the pinned R32 rail + channel row + title + nav stay byte-identical (the pinned suites' own assertions, re-proven)", async () => {
    const host = await bootHost();
    const payload = await loadShortsPayload(host);
    const markup = renderFeed(payload);

    // THE R32 RAIL (the shorts-rail-parity suite's own pinned assertions).
    expect(markup).toContain("data-wfx-shortrail");
    expect(markup).toContain('data-wfx-shortrail-absent="comments remix"');
    expect(markup).toContain('data-wfx-shorts-action="share"');
    expect((markup.match(/data-wfx-shortrail-count=/g) ?? []).length).toBe(1);
    expect(markup).not.toContain("176K");
    // THE CHANNEL ROW + the subscribe pill (the R32 identity laws).
    expect(markup).toContain('data-wfx-shorts-channel-name');
    expect(markup).toContain('data-wfx-shorts-subscribe-state="idle"');
    expect(markup).toMatch(/data-wfx-shortrail-avatar[^>]*>F</);
    // THE TITLE (the item's own).
    expect(markup).toContain('<h2 class="wfx-shortcard__title">Neon Rain</h2>');
    // THE REAL QUEUE NAVIGATION + the R24-W2 parity controls (pinned).
    expect(markup).toContain("data-wfx-shorts-next");
    expect(markup).toContain("data-wfx-shorts-back");
    expect(markup).toContain("data-wfx-shorts-speed");
    expect(markup).toContain("data-wfx-shorts-clearscreen-toggle");
    expect(markup).toContain("data-wfx-shorts-feedback-toggle");
    expect(markup).toContain('data-wfx-shorts-clearscreen="false"');
  });

  it("the component's server pass renders the resolving truth even with a warm resolve cache (the mount seam is the client's — the server never fabricates a staged embed)", async () => {
    // Warm the per-item cache (the client seam the mount effect reads) —
    // the SERVER pass still renders the resolving truth: the resolve
    // fires in the client's mount effect, never at render time (the
    // real-media law: no evidence, no embed — SSR never stages).
    await resolveShortsStageMedia(
      { connectorId: "fake-source", externalRef: "fake:short-1" },
      async () =>
        new Response(
          JSON.stringify({ ok: true, previewable: true, url: "https://www.youtube.com/embed/3uyGhtARP4M" }),
          { status: 200 },
        ),
    );
    const markup = renderToStaticMarkup(
      createElement(ShortsMediaStage, {
        itemId: "wfxitm_teststage0000000000000001",
        connectorId: "fake-source",
        externalRef: "fake:short-1",
        title: "Neon Rain",
        active: true,
      }),
    );
    expect(markup).toContain('data-wfx-shortstage-state="resolving"');
    expect(markup).not.toContain("data-wfx-shortstage-frame");
  });
});

// ---------------------------------------------------------------------------
// THE RESOLVE SEAM — the real-media law
// ---------------------------------------------------------------------------

describe("R33-A — the resolve seam (the same cached read the hover preview uses)", () => {
  it("the REAL /api/preview route answers the fixture short's playable realization (previewable + the provider's own embed URL)", async () => {
    await bootHost();
    const response = await get(
      getPreview,
      "http://localhost/api/preview?connectorId=fake-source&ref=fake:short-1",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { previewable?: boolean; url?: string };
    expect(body.previewable).toBe(true);
    // The fixture catalog's own embed realization (packages/experience's
    // fixtures.ts — the provider's real URL for this item).
    expect(body.url).toBe("https://fixture.invalid/embed/fake:short-1");
  });

  it("the honest no-embed truth: a browser-only item answers previewable false with the typed reason (never a fabricated stage)", async () => {
    await bootHost();
    // "Static Bloom" (fake:video-2) carries ONLY a browser realization —
    // the fixture catalog's own no-embed truth.
    const response = await get(
      getPreview,
      "http://localhost/api/preview?connectorId=fake-source&ref=fake:video-2",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { previewable?: boolean; reason?: string };
    expect(body.previewable).toBe(false);
    expect(body.reason).toContain("no-previewable-media");
  });

  it("the per-item resolve cache: ONE read per item (the second resolve answers from the cache — the prefetch window's carrier)", async () => {
    let reads = 0;
    const fetchImpl = async (): Promise<Response> => {
      reads += 1;
      return new Response(
        JSON.stringify({ ok: true, previewable: true, url: "https://fixture.invalid/embed/fake:short-1" }),
        { status: 200 },
      );
    };
    const first = await resolveShortsStageMedia({ connectorId: "fake-source", externalRef: "fake:short-9" }, fetchImpl);
    const second = await resolveShortsStageMedia({ connectorId: "fake-source", externalRef: "fake:short-9" }, fetchImpl);
    expect(reads).toBe(1);
    expect(first.previewable).toBe(true);
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// THE HONEST FALLBACK + THE EVIDENCE LAW (the pure state machine)
// ---------------------------------------------------------------------------

describe("R33-A — the honest fallback + the evidence folds (the pure state machine)", () => {
  it("an unavailable resolve settles the typed absence with the honest reason — and never an embed", () => {
    const settled = settleShortsStageResolve(SHORTS_STAGE_IDLE, {
      previewable: false,
      reason: "no-previewable-media: this source provides no embed realization for the item",
    });
    expect(settled.status).toBe("unavailable");
    expect(settled.url).toBeNull();
    expect(settled.reason).toContain("no-previewable-media");
    // The stage renders no visible element in this state (the honest
    // fallback law — asserted through the component's non-staged branch).
  });

  it("a previewable resolve settles the staged truth with the provider's own URL", () => {
    const settled = settleShortsStageResolve(SHORTS_STAGE_IDLE, {
      previewable: true,
      url: "https://www.youtube.com/embed/3uyGhtARP4M",
    });
    expect(settled.status).toBe("staged");
    expect(settled.url).toBe("https://www.youtube.com/embed/3uyGhtARP4M");
    expect(settled.reason).toBeNull();
  });

  it("THE EVIDENCE LAW: the idle truth carries live=false + phase 'unstarted' (no evidence, no advancement)", () => {
    expect(SHORTS_STAGE_IDLE.live).toBe(false);
    expect(SHORTS_STAGE_IDLE.phase).toBe("unstarted");
    expect(SHORTS_STAGE_IDLE.muted).toBeNull();
    expect(SHORTS_STAGE_IDLE.positionMs).toBe(0);
  });

  it("provider-reported deliveries fold the phase/mute/duration/position truths (the only state mover)", () => {
    // initialDelivery: the provider's own first broadcast (the YouTube
    // widget protocol's shape — embed-session-client's documented forms).
    let state = applyShortsStageEvidence(SHORTS_STAGE_IDLE, {
      playerState: 1,
      currentTime: 2.5,
      duration: 45,
      muted: true,
      playbackRate: 1,
    });
    expect(state.live).toBe(true);
    expect(state.phase).toBe("playing");
    expect(state.positionMs).toBe(2500);
    expect(state.durationMs).toBe(45_000);
    expect(state.muted).toBe(true);
    // onStateChange: paused (2) — the provider's own pause report.
    state = applyShortsStageEvidence(state, { playerState: 2 });
    expect(state.phase).toBe("paused");
    // ended (0) — the provider's own ended signal.
    state = applyShortsStageEvidence(state, { playerState: 0 });
    expect(state.phase).toBe("ended");
    // Non-numeric garbage never advances the truth (shape-guarded folds).
    const before = state;
    state = applyShortsStageEvidence(state, { playerState: "bogus", currentTime: -1 });
    expect(state.phase).toBe(before.phase);
    expect(state.positionMs).toBe(before.positionMs);
  });

  it("the honest unbound fold: a provider that never answers keeps live=false (disclosed, never simulated)", () => {
    const unbound = settleShortsStageUnbound(applyShortsStageEvidence(SHORTS_STAGE_IDLE, {}));
    expect(unbound.live).toBe(false);
  });

  it("the progress-report throttle (the embed-session-client's law): only playing/paused positions, only changed, only past the window", () => {
    const base = { ...SHORTS_STAGE_IDLE, live: true };
    // unstarted ⇒ never
    expect(shouldReportShortsStageProgress(0, -1, base, 10_000)).toBe(false);
    // playing + changed + past the window ⇒ yes
    const playing = { ...base, phase: "playing" as const, positionMs: 6_000 };
    expect(shouldReportShortsStageProgress(0, -1, playing, 10_000)).toBe(true);
    // inside the window ⇒ no
    expect(shouldReportShortsStageProgress(6_000, -1, playing, 9_000)).toBe(false);
    // unchanged position ⇒ no
    expect(shouldReportShortsStageProgress(0, 6_000, playing, 10_000)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE SESSION LAW — the watch surface's own seam
// ---------------------------------------------------------------------------

describe("R33-A — the shorts playback session (the SAME seam the watch surface uses)", () => {
  it("resolves the fixture short's EMBED realization through the runtime's frozen path + records the intent in the playback bridge", async () => {
    const host = await bootHost();
    const payload = await loadShortsPayload(host);
    const card = payload.page.cards[0];
    if (card === undefined) throw new Error("the fixture shorts page carried no cards");
    const itemId = card.candidate.itemId;

    const outcome = await resolveShortsPlaybackSession(host, {
      itemId,
      connectorId: card.candidate.realization.connectorId,
      externalRef: card.candidate.realization.externalRef,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.sessionId.length).toBeGreaterThan(0);

    // THE BRIDGE RECORD (the SAME record the player page writes — the
    // /api/playback route's dev-split + multi-instance law): the bridge
    // answers the intent back.
    const intent = bridgedIntentOf(outcome.sessionId);
    expect(intent).not.toBeNull();
    expect(intent?.itemId).toBe(itemId);
    expect(intent?.externalRef).toBe(card.candidate.realization.externalRef);
    expect(intent?.preferredMode).toBe("embed");

    // The session's commands execute through the REAL /api/playback route
    // (the same transport the stage's folds use — the watch chrome's own).
    const response = await post(postPlayback, {
      sessionId: outcome.sessionId,
      command: "pause",
      intent: {
        itemId,
        externalRef: card.candidate.realization.externalRef,
        connectorId: card.candidate.realization.connectorId,
        preferredMode: "embed",
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok?: boolean; state?: { phase: string } };
    expect(body.ok).toBe(true);
  });

  it("the honest typed failure: a no-embed item answers ok=false with the no-embed-realization kind (never a fabricated session id)", async () => {
    const host = await bootHost();
    const outcome = await resolveShortsPlaybackSession(host, {
      itemId: "wfxitm_noembedtest000000000000001",
      connectorId: "fake-source",
      externalRef: "fake:video-2", // browser-only — the fixture's own no-embed truth
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.kind).toBe("no-embed-realization");
  });

  it("the thin /api/shorts-session route: the typed outcome verbatim + the honest 400 for a malformed body", async () => {
    const host = await bootHost();
    const payload = await loadShortsPayload(host);
    const card = payload.page.cards[0];
    if (card === undefined) throw new Error("the fixture shorts page carried no cards");

    const response = await post(postShortsSession, {
      itemId: card.candidate.itemId,
      connectorId: card.candidate.realization.connectorId,
      externalRef: card.candidate.realization.externalRef,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok?: boolean; sessionId?: string };
    expect(body.ok).toBe(true);
    expect(typeof body.sessionId).toBe("string");

    const malformed = await post(postShortsSession, { itemId: "wfxitm_x" });
    expect(malformed.status).toBe(400);
    const malformedBody = (await malformed.json()) as { error?: string };
    expect(malformedBody.error).toContain("expected");
  });
});

// ---------------------------------------------------------------------------
// THE k/m GRAMMAR — the chrome law's WebFlix bindings
// ---------------------------------------------------------------------------

describe("R33-A — the watch surface's k/m key derivation (the chrome law's WebFlix bindings)", () => {
  it("k toggles play, m toggles mute, other keys answer null (the PlayerChrome grammar)", () => {
    expect(shortsStageKeyCommandOf({ key: "k", target: null })).toBe("toggle-play");
    expect(shortsStageKeyCommandOf({ key: "K", target: null })).toBe("toggle-play");
    expect(shortsStageKeyCommandOf({ key: "m", target: null })).toBe("toggle-mute");
    expect(shortsStageKeyCommandOf({ key: "ArrowUp", target: null })).toBeNull();
    expect(shortsStageKeyCommandOf({ key: " ", target: null })).toBeNull();
  });

  it("the typing guard: INPUT/TEXTAREA/SELECT/contentEditable targets answer null (the watch surface's law)", () => {
    expect(shortsStageKeyCommandOf({ key: "k", target: { tagName: "INPUT" } })).toBeNull();
    expect(shortsStageKeyCommandOf({ key: "m", target: { tagName: "TEXTAREA" } })).toBeNull();
    expect(shortsStageKeyCommandOf({ key: "k", target: { tagName: "SELECT" } })).toBeNull();
    expect(shortsStageKeyCommandOf({ key: "k", target: { isContentEditable: true } })).toBeNull();
    // The feed's own surface (the viewport region) is not a typing target.
    expect(shortsStageKeyCommandOf({ key: "k", target: { tagName: "DIV" } })).toBe("toggle-play");
  });
});

// ---------------------------------------------------------------------------
// THE GEOMETRY — the stage's stylesheet grammar
// ---------------------------------------------------------------------------

describe("R33-A — the stage's stylesheet grammar (the full-bleed form + the mobile law)", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

  it("the stage fills the card full-bleed; the staged form carries the stage-black field; the frame re-arms pointer events (the chrome law)", () => {
    expect(css).toMatch(/\.wfx-shortstage \{[^}]*position: absolute;[^}]*inset: 0;/s);
    expect(css).toMatch(/\.wfx-shortstage\[data-wfx-shortstage-state="staged"\] \{[^}]*background: var\(--wfx-stage-black\);/s);
    expect(css).toMatch(/\.wfx-shortstage__frame \{[^}]*pointer-events: auto;/s);
  });

  it("the unmute affordance carries the watch surface's family form + the mobile 44px law", () => {
    expect(css).toMatch(/\.wfx-shortstage__unmute \{[^}]*min-height: 36px;/s);
    expect(css).toMatch(/\.wfx-shortstage__unmute \{[^}]*border-radius: 999px;/s);
    // The mobile block (the rail's own 791px breakpoint): the unmute pill
    // grows to the 44px touch-target law.
    expect(css).toMatch(
      /@media \(max-width: 791px\) \{[\s\S]*?\.wfx-shortstage__unmute \{[^}]*min-height: 44px;/,
    );
  });
});

// ---------------------------------------------------------------------------
// THE PINNED-CONTROLS COLLISION LAW (the lead's REQUIRE-CHANGES fix) —
// G4-CORPUS.md's top player chrome ("y=80, 48×48 each") is the PLAYER'S
// OWN; the pinned WebFlix rows never sit over the player's chrome
// affordances. The defect this law closes (the lead's user-level probe on
// the settled service-boot feed, 1440×900, the discovery chips present):
// the unmute pill (205×36 at the card's top-left, 642..847 × 68..104) was
// covered across its ENTIRE rect — the "Blend" chip + the discovery band
// (z=6) over its left fifth, the R24-W2 controls row + its source chip
// (z=12) over the rest; elementFromPoint at the pill's center resolved to
// the source-chip span, so a real user could not click unmute. The pill
// lives inside the card's z=2 stacking context (the frozen current/next
// swipe layering), so no z-index can win it back, and raising the card
// would steal the chips' clicks — the corpus-true fix is GEOMETRIC
// CLEARANCE: every pinned row sits below the chrome zone (the corpus
// chrome height 48px + its own 8px inter-control gap — the 56px
// origin-to-origin pitch, Pause @366 → Mute @422). The full-bleed
// adaptation (the approved WFX-051 form) has no band above the card (the
// card's top = the shell's top), so the honest clear is below.
// ---------------------------------------------------------------------------

describe("R33-A — the pinned-controls collision law (the player's top-chrome zone is the player's own)", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const PX_PER_REM = 16;
  /** The corpus's own inter-chrome gap (the 56px origin pitch − the 48px control). */
  const CHROME_GAP_PX = 8;

  /** The unmute pill's own anchor + family measure, parsed from the stage's rule. */
  const unmute = css.match(
    /\.wfx-shortstage__unmute \{[^}]*?left: (\d+)px;\s*[^}]*?top: (\d+)px;[^}]*?min-height: (\d+)px;/s,
  );

  /** A pinned row's `top: calc(Arem + Brem)` resolved to px (null = the rule moved away). */
  const rowTopPx = (selector: string): number | null => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = css.match(
      new RegExp(`${escaped} \\{[^}]*?top: calc\\((\\d+(?:\\.\\d+)?)rem \\+ (\\d+(?:\\.\\d+)?)rem\\)`),
    );
    return match === null ? null : (Number(match[1]) + Number(match[2])) * PX_PER_REM;
  };

  it("the desktop form: the pill keeps the corpus's top-left anchor and every pinned row clears the chrome zone (the collision law, computed from the stylesheet's own numbers)", () => {
    // THE PILL'S ANCHOR NEVER MOVES (the lead's DON'T): the corpus's
    // top-left anchor, the 12px inset grammar.
    expect(unmute).not.toBeNull();
    expect(Number(unmute![1])).toBe(12); // left
    expect(Number(unmute![2])).toBe(12); // top
    const chromeZoneBottom = Number(unmute![2]) + Number(unmute![3]); // 12 + 36

    // THE CARD'S OWN STACKING TRUTH (why the fix is geometric): the
    // current card's frozen z=2 context traps the pill under the pinned
    // rows' z=6/z=12 — the rows must clear the zone, not out-stack it.
    expect(css).toMatch(/\.wfx-shortcard--current \{[^}]*?z-index: 2;/s);

    // THE PILL'S CLICK LAYER (the defect's second half — the lead's
    // user-level pass): the stage root is pointer-events:none (the inert
    // marker forms never block the card), so every interactive child
    // re-arms — the unmute pill is a real button; without this it
    // inherits none and elementFromPoint falls through it to whatever
    // sits below (the frame — or, pre-fix, the chips/controls covers).
    expect(css).toMatch(/\.wfx-shortstage__unmute \{[^}]*?pointer-events: auto;/s);

    // THE COLLISION LAW: every pinned row's band starts at or beyond the
    // chrome zone's bottom + the corpus's own 8px gap (the settled live
    // geometry: the pill 68..104 page-y, the rows' band from 124 — a
    // 20px clear; elementFromPoint across the pill's rect answers the pill).
    for (const selector of [".wfx-shorts__discovery", ".wfx-shorts__position", ".wfx-shorts__controls"]) {
      const top = rowTopPx(selector);
      expect(top, `${selector}'s top calc`).not.toBeNull();
      expect(top!).toBeGreaterThanOrEqual(chromeZoneBottom + CHROME_GAP_PX);
    }
  });

  it("the mobile form: the rows clear the 44px chrome zone (the 791px law) and the band stays below the shifted position pill (the 767px law)", () => {
    // The mobile chrome zone: the same 12px anchor + the 44px touch-target pill.
    const mobilePill = css.match(
      /@media \(max-width: 791px\) \{[\s\S]*?\.wfx-shortstage__unmute \{[^}]*?min-height: (\d+)px;/,
    );
    expect(mobilePill).not.toBeNull();
    const mobileZoneBottom = Number(unmute![2]) + Number(mobilePill![1]); // 12 + 44 = 56

    // The position pill + the controls row clear the mobile chrome zone
    // (12 + 44 + the 8px gap = 64px = 0.75rem + 3.25rem).
    const rows791 = css.match(
      /@media \(max-width: 791px\) \{[\s\S]*?\.wfx-shorts__position,\s*\.wfx-shorts__controls \{[^}]*?top: calc\((\d+(?:\.\d+)?)rem \+ (\d+(?:\.\d+)?)rem\);/,
    );
    expect(rows791).not.toBeNull();
    const rows791Top = (Number(rows791![1]) + Number(rows791![2])) * PX_PER_REM;
    expect(rows791Top).toBeGreaterThanOrEqual(mobileZoneBottom + CHROME_GAP_PX);

    // The discovery band clears the mobile chrome zone too AND keeps its
    // own narrow-screen law (below the position pill: the pill's 64px top
    // + its 28px height = 92 → the band's 96px clears it). Anchored to the
    // band's OWN 767px block (the LAST one — an earlier 767px block owns
    // other rules, and the base band rule sits between the two blocks).
    const mobile767 = css.slice(css.lastIndexOf("@media (max-width: 767px) {"));
    const band767 = mobile767.match(
      /\.wfx-shorts__discovery \{[^}]*?top: calc\((\d+(?:\.\d+)?)rem \+ (\d+(?:\.\d+)?)rem\);/,
    );
    expect(band767).not.toBeNull();
    const band767Top = (Number(band767![1]) + Number(band767![2])) * PX_PER_REM;
    expect(band767Top).toBeGreaterThanOrEqual(mobileZoneBottom + CHROME_GAP_PX);
    expect(band767Top).toBeGreaterThanOrEqual(rows791Top + 28); // below the position pill
  });
});
