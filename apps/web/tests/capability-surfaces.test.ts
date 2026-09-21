/**
 * R21-E — the Web decision-hub tests (bun:test).
 *
 * Proves the item/player capability surfaces render + behave through the
 * REAL composition (the fixtures-mode host, the real runtime resolve,
 * the real model-controls store) — the laws the R21 plan freezes:
 *
 * - WHERE TO WATCH: every offered realization renders (canonical
 *   identity first, realizations second); the platform-unusable ways
 *   stay DISCOVERABLE with their honest reason + Desktop next step
 *   (never hidden, never a dead "not available"); the usable ways
 *   carry their switch path; the typed resolve error renders its own
 *   error state with the retry next-action.
 * - THE PLAYER SWITCH + RECOVERY: the mode preference is honored
 *   through the runtime's own realization seam; an unusable preference
 *   (native on Web) answers the TYPED capability failure whose primary
 *   action is the NEXT supported way ("Try the next way to watch") —
 *   never a dead end; the precedence trace + skipped rungs + embed
 *   attestation live behind ONE progressive disclosure.
 * - THE AI ACTION TRAY: the five frozen actions render with their
 *   model-class truth (the honest "Not configured" names the
 *   first-party default); the input preconditions are NAMED (subtitles/
 *   dubbing compose from a transcript — discoverable + explained);
 *   submissions answer the TYPED operation (explicit states only,
 *   never fabricated progress) with cancel/clear recovery paths.
 * - THE FEEDBACK CONTROLS: the frozen J15 vocabulary renders on the
 *   decision hub; a submit answers a REAL record (the fixtures
 *   persona); the records list renders with UNDO (the reversibility
 *   law — "you cannot undo what you cannot see"); typed 400s.
 * - THE SEARCH AVAILABILITY SUMMARY: result cards answer "where can I
 *   watch this?" from the REAL resolve answer (never a fabricated
 *   count; a failed read answers the honest absent summary).
 * - THE STALE-COPY LAW: the new surfaces carry ZERO stale completion
 *   copy (the machine sweep over the real markup).
 *
 * Determinism: fixture transport, controlled env (restored), no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { isStaleCompletionCopy } from "@wfx/client-runtime";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import { canonicalIdFor } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { loadDetailView, loadPlayerView, loadSearchView, cardAvailabilitySummary } from "../src/host/view-models";
import type { PlayerEnrichments, PlayerShellView, PlayerView } from "../src/host/view-models";
import {
  loadAiTrayView,
  loadWhereToWatchView,
  playerHrefWithMode,
} from "../src/host/decision-views";
import {
  resetFixtureFeedback,
  submitFixtureFeedback,
  listFixtureFeedback,
  undoFixtureFeedback,
  fixtureFeedbackProblems,
} from "../src/host/feedback-fixtures";
import { AppShell } from "../src/components/shell/AppShell";
import { ItemDetailSurface } from "../src/components/item/ItemDetailSurface";
import { PlayerSurface } from "../src/components/player/PlayerSurface";

/**
 * The surface's render props from a composed view (the shell fields +
 * the RESOLVED enrichments — the composed render path: the sections
 * render inline, no suspension, no streaming).
 */
function playerSurfaceRenderProps(
  view: PlayerView,
): {
  view: PlayerShellView;
  enrichments: PlayerEnrichments;
} {
  return {
    view,
    enrichments: {
      aiTray: view.aiTray,
      intelligence: view.intelligence,
      liveAsr: view.liveAsr,
      related: view.related,
    },
  };
}
import { WhereToWatch } from "../src/components/item/WhereToWatch";
import { AiActionTray } from "../src/components/discovery/AiActionTray";
import { FeedbackControls } from "../src/components/discovery/FeedbackControls";
import { GET as getTransform, POST as postTransform } from "../src/app/api/transform/route";
import {
  DELETE as deleteFeedback,
  GET as getFeedback,
  POST as postFeedback,
} from "../src/app/api/feedback/route";
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

/** GET a route handler (the real handler, no network). */
async function get(handler: (request: Request) => Promise<Response>, query: string): Promise<Response> {
  return handler(new Request(`http://localhost/api?${query}`));
}

/** DELETE a route handler (the real handler, no network). */
async function del(handler: (request: Request) => Promise<Response>, query: string): Promise<Response> {
  return handler(new Request(`http://localhost/api?${query}`, { method: "DELETE" }));
}

/** The multi-realization fixture item (Asteroid Drift — fake:movie-1). */
const DRIFT = {
  itemId: canonicalIdFor("fake-source", "fake:movie-1"),
  connectorId: "fake-source",
  externalRef: "fake:movie-1",
  title: "Asteroid Drift",
  canonicalType: "movie",
  durationMs: 7_200_000,
} as const;

beforeEach(() => {
  resetWebHostProcessState();
  resetFixtureFeedback();
});

// ---------------------------------------------------------------------------
// The Where-to-watch view (the realization choice)
// ---------------------------------------------------------------------------

describe("R21-E — the Where-to-watch view (the decision hub's realization choice)", () => {
  it("every offered way renders: 4 realizations, the platform truth per option", async () => {
    const host = await bootHost();
    const view = await loadWhereToWatchView(host, DRIFT);
    expect(view.status).toBe("ready");
    expect(view.options).toHaveLength(4); // native + embed + browser + external
    // The usable ways on Web: embed, browser, external (native is the
    // Desktop capability — the honest platform truth)... plus R23-E: the
    // authorized peer copy (browser-capable on this fixture item) counts
    // as a way to play — 4 total (3 provider + the peer copy).
    expect(view.usableCount).toBe(4);
    expect(view.peerCopy).not.toBeNull();
    expect(view.peerCopy?.label).toBe("Authorized peer copy");
    expect(view.peerCopy?.usable).toBe(true);
    expect(view.peerCopy?.switchHref).toContain("realization=torrent");
    const native = view.options.find((option) => option.mode === "native");
    expect(native).toBeDefined();
    expect(native!.usable).toBe(false);
    expect(native!.unusableReason).toContain("Desktop");
    expect(native!.switchHref).toBeUndefined(); // no switch path for the unusable
    // Every usable way carries its switch path with the mode preference.
    for (const option of view.options.filter((entry) => entry.usable)) {
      expect(option.switchHref).toContain(`/player?`);
      expect(option.switchHref).toContain(`mode=${option.mode}`);
    }
  });

  it("the active sentence names the precedence answer (embed — native skipped on Web)", async () => {
    const host = await bootHost();
    const view = await loadWhereToWatchView(host, DRIFT);
    expect(view.activeSentence).toContain("Plays inside WebFlix");
  });

  it("the switch href carries the full item identity + the mode preference", () => {
    const href = playerHrefWithMode({ ...DRIFT, mode: "browser" });
    const params = new URL(href, "http://localhost").searchParams;
    expect(params.get("id")).toBe(DRIFT.itemId);
    expect(params.get("connector")).toBe("fake-source");
    expect(params.get("ref")).toBe("fake:movie-1");
    expect(params.get("mode")).toBe("browser");
  });

  it("the surface renders the row: one identity, many ways, honest reasons", async () => {
    const host = await bootHost();
    const view = await loadWhereToWatchView(host, DRIFT);
    const markup = renderToStaticMarkup(createElement(WhereToWatch, { view }));
    expect(markup).toContain("data-wfx-where-to-watch");
    expect(markup).toContain("Where to watch");
    expect(markup).toContain("4 ways to play here");
    expect(markup).toContain("5 ways offered across your sources and copies");
    // The Desktop next step is the honest truth — never a dead "not available".
    expect(markup).toContain("Desktop app");
    expect(markup).toContain("data-wfx-watch-switch=\"browser\"");
    expect(markup).toContain("data-wfx-watch-switch=\"embed\"");
    expect(markup).toContain("data-wfx-watch-switch=\"external\"");
    // No stale completion copy in the rendered row.
    expect(isStaleCompletionCopy(markup)).toBe(false);
  });

  it("the typed resolve error renders its own error state with the retry next-action", () => {
    const view: import("../src/host/decision-views").WhereToWatchView = {
      viewer: "anonymous",
      peerCopy: null,
      status: "error",
      errorDetail: "fixture transport 'resolve' failed: TypeError: fetch failed",
      activeSentence: "The ways to watch could not be read right now.",
      options: [],
      usableCount: 0,
    };
    const markup = renderToStaticMarkup(createElement(WhereToWatch, { view }));
    expect(markup).toContain("data-wfx-where-to-watch-state=\"error\"");
    expect(markup).toContain("re-open this page");
  });
});

// ---------------------------------------------------------------------------
// The AI action tray
// ---------------------------------------------------------------------------

describe("R21-E — the AI action tray (the model-class + input truth)", () => {
  it("the five frozen actions render with their model-class truth", async () => {
    const host = await bootHost();
    const view = await loadAiTrayView(host, DRIFT);
    expect(view.actions.map((action) => action.label)).toEqual([
      "Transcribe",
      "Subtitles",
      "Translate",
      "Dub",
      "Commentary",
    ]);
    // The honest "Not configured" names the first-party default (never a
    // fabricated provider) over the fixtures persona's registry.
    for (const action of view.actions) {
      expect(action.modelSentence.length).toBeGreaterThan(0);
    }
    const transcribe = view.actions.find((action) => action.kind === "transcript")!;
    expect(transcribe.modelSentence).toContain("Not configured");
    expect(transcribe.modelSentence).toContain("WebFlix model");
    // The Desktop platform truth rides the tray.
    expect(view.desktopTruth).toContain("Desktop app");
  });

  it("the input preconditions are NAMED — discoverable + explained, never dead buttons", async () => {
    const host = await bootHost();
    const view = await loadAiTrayView(host, DRIFT);
    const subtitles = view.actions.find((action) => action.kind === "subtitle")!;
    expect(subtitles.runnable).toBe(false);
    expect(subtitles.precondition).toContain("transcript");
    const dubbing = view.actions.find((action) => action.kind === "dubbing")!;
    expect(dubbing.runnable).toBe(false);
    // The duration-satisfiable actions ARE runnable for this title.
    expect(view.actions.find((action) => action.kind === "transcript")!.runnable).toBe(true);
    expect(view.actions.find((action) => action.kind === "commentary")!.runnable).toBe(true);
    expect(view.actions.find((action) => action.kind === "translation")!.runnable).toBe(true);
  });

  it("a title without duration answers the honest transcript precondition", async () => {
    const host = await bootHost();
    const view = await loadAiTrayView(host, {
      connectorId: DRIFT.connectorId,
      externalRef: DRIFT.externalRef,
      title: DRIFT.title,
    });
    expect(view.actions.find((action) => action.kind === "transcript")!.runnable).toBe(false);
    expect(view.actions.find((action) => action.kind === "transcript")!.precondition).toContain(
      "duration",
    );
  });

  it("the tray renders in server HTML (no hydration gate on discoverability)", async () => {
    const host = await bootHost();
    const view = await loadAiTrayView(host, DRIFT);
    const markup = renderToStaticMarkup(createElement(AiActionTray, { view, surface: "item" }));
    for (const term of ["Transcribe", "Subtitles", "Translate", "Dub", "Commentary"]) {
      expect(markup).toContain(term);
    }
    expect(markup).toContain("data-wfx-ai-tray-vocabulary");
    expect(markup).toContain("transcribe · subtitles · translate · dub · commentary");
    expect(markup).toContain("Desktop app");
    expect(isStaleCompletionCopy(markup)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The transform route (the tray's typed transport)
// ---------------------------------------------------------------------------

describe("R21-E — the transform route (explicit states, never fabricated progress)", () => {
  it("a transcript submission answers the TYPED queued operation", async () => {
    await bootHost();
    const response = await post(postTransform, {
      kind: "transcript",
      target: DRIFT,
    });
    expect(response.status).toBe(200);
    const operation = (await response.json()) as {
      id: string;
      kind: string;
      state: string;
      progress: number | null;
    };
    expect(operation.kind).toBe("transcript");
    expect(operation.state).toBe("queued");
    expect(operation.progress).toBeNull(); // explicit states only — no fake progress
    // The read answers the same typed truth.
    const read = await get(getTransform, `operationId=${encodeURIComponent(operation.id)}`);
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as { state: string };
    expect(readBody.state).toBe("queued");
  });

  it("the recovery paths: cancel while queued; clear-result answers the typed 409", async () => {
    await bootHost();
    const submitted = await post(postTransform, { kind: "transcript", target: DRIFT });
    const operation = (await submitted.json()) as { id: string };
    const cancelled = await post(postTransform, {
      kind: "cancel",
      operationId: operation.id,
    });
    expect(cancelled.status).toBe(200);
    expect(((await cancelled.json()) as { state: string }).state).toBe("cancelled");
    // Clearing a non-succeeded operation answers the typed failure (never
    // a fabricated cleared state).
    const cleared = await post(postTransform, {
      kind: "clear-result",
      operationId: operation.id,
    });
    expect(cleared.status).toBe(409);
  });

  it("the preconditions answer the typed 400 naming the requirement", async () => {
    await bootHost();
    const subtitle = await post(postTransform, { kind: "subtitle", target: DRIFT });
    expect(subtitle.status).toBe(400);
    expect(((await subtitle.json()) as { error: string }).error).toContain("transcript");
    const translation = await post(postTransform, {
      kind: "translation",
      target: DRIFT,
      input: {},
    });
    expect(translation.status).toBe(400);
    expect(((await translation.json()) as { error: string }).error).toContain("targetLanguage");
    const badKind = await post(postTransform, { kind: "teleport", target: DRIFT });
    expect(badKind.status).toBe(400);
    expect(((await badKind.json()) as { error: string }).error).toContain("kind:");
  });

  it("a translation submission carries the title's text + the chosen language", async () => {
    await bootHost();
    const response = await post(postTransform, {
      kind: "translation",
      target: DRIFT,
      input: { targetLanguage: "es" },
    });
    expect(response.status).toBe(200);
    const operation = (await response.json()) as { kind: string; state: string };
    expect(operation.kind).toBe("translation");
    expect(operation.state).toBe("queued");
  });
});

// ---------------------------------------------------------------------------
// The feedback controls (the J15 vocabulary, reversible)
// ---------------------------------------------------------------------------

describe("R21-E — the feedback controls (record, list, undo — the reversibility law)", () => {
  it("the frozen J15 vocabulary renders on the decision hub (server HTML)", () => {
    const markup = renderToStaticMarkup(
      createElement(FeedbackControls, {
        target: DRIFT.itemId,
        sourceId: DRIFT.connectorId,
        surface: "item",
      }),
    );
    for (const label of [
      "More like this",
      "Not interested",
      "recommend this source", // SSR renders the apostrophe as &#x27;
      "already watched this",
    ]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("data-wfx-feedback-controls");
    expect(isStaleCompletionCopy(markup)).toBe(false);
  });

  it("the fixtures persona: submit → record; idempotent re-submit; undo is a REAL delete", () => {
    const first = submitFixtureFeedback({ kind: "more-like-this", target: DRIFT.itemId });
    expect(first.id).toContain("wfxfb_");
    const again = submitFixtureFeedback({ kind: "more-like-this", target: DRIFT.itemId });
    expect(again.id).toBe(first.id); // idempotent per (kind, target)
    expect(listFixtureFeedback(DRIFT.itemId)).toHaveLength(1);
    const undone = undoFixtureFeedback(first.id);
    expect(undone?.id).toBe(first.id);
    expect(listFixtureFeedback(DRIFT.itemId)).toHaveLength(0); // the REAL delete
    expect(undoFixtureFeedback(first.id)).toBeNull(); // the honest not-found
  });

  it("the typed validation mirrors the service route's law", () => {
    expect(fixtureFeedbackProblems({ kind: "love-it", target: DRIFT.itemId }).length).toBeGreaterThan(0);
    expect(fixtureFeedbackProblems({ kind: "not-interested", target: "" }).length).toBeGreaterThan(0);
    expect(fixtureFeedbackProblems({ kind: "not-interested", target: DRIFT.itemId })).toHaveLength(0);
  });

  it("the route: POST records (201), GET lists the target's controls, DELETE undoes", async () => {
    await bootHost();
    const empty = await get(getFeedback, `target=${encodeURIComponent(DRIFT.itemId)}`);
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { controls: unknown[] }).controls).toHaveLength(0);

    const submitted = await post(postFeedback, { kind: "not-interested", target: DRIFT.itemId });
    expect(submitted.status).toBe(201);
    const record = (await submitted.json()) as { id: string; kind: string };
    expect(record.kind).toBe("not-interested");

    const listed = await get(getFeedback, `target=${encodeURIComponent(DRIFT.itemId)}`);
    const controls = (await listed.json()) as { controls: { id: string; kind: string }[] };
    expect(controls.controls).toHaveLength(1); // "you cannot undo what you cannot see"
    expect(controls.controls[0]!.id).toBe(record.id);

    const undone = await del(deleteFeedback, `id=${encodeURIComponent(record.id)}`);
    expect(undone.status).toBe(200);
    const after = await get(getFeedback, `target=${encodeURIComponent(DRIFT.itemId)}`);
    expect(((await after.json()) as { controls: unknown[] }).controls).toHaveLength(0);

    // The honest 404 on a double undo; the typed 400 on garbage.
    const doubleUndo = await del(deleteFeedback, `id=${encodeURIComponent(record.id)}`);
    expect(doubleUndo.status).toBe(404);
    const bad = await post(postFeedback, { kind: "adore", target: DRIFT.itemId });
    expect(bad.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// The item decision hub (the composed surface)
// ---------------------------------------------------------------------------

describe("R21-E — the item decision hub (the composed surface)", () => {
  it("renders the composed hub: Where to watch + AI tray + feedback + the Desktop offline affordance", async () => {
    const host = await bootHost();
    const view = await loadDetailView(host, {
      connectorId: DRIFT.connectorId,
      externalRef: DRIFT.externalRef,
      itemId: DRIFT.itemId,
    });
    expect(view).not.toBeNull();
    expect(view!.whereToWatch.options).toHaveLength(4);
    expect(view!.aiTray.actions).toHaveLength(5);
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement(ItemDetailSurface, { view: view! }),
      }),
    );
    expect(markup).toContain("data-wfx-where-to-watch");
    expect(markup).toContain("data-wfx-ai-tray");
    expect(markup).toContain("data-wfx-feedback-controls");
    // The Desktop/offline affordance from Web (the matrix's next step).
    expect(markup).toContain("desktop app");
    // The raw connector capability truth is SECONDARY (progressive
    // disclosure — a <details>, never the primary surface).
    expect(markup).toContain("data-wfx-item-capabilities-disclosure");
    expect(markup).toContain("<details");
    // The canonical identity + availability summary stay first.
    expect(markup.indexOf("data-wfx-item-title")).toBeLessThan(markup.indexOf("data-wfx-where-to-watch"));
    expect(markup).toContain("data-wfx-item-availability");
    expect(isStaleCompletionCopy(markup)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The player (the switch + the recovery + the diagnostics disclosure)
// ---------------------------------------------------------------------------

describe("R21-E — the player (the switch, the recovery, the diagnostics)", () => {
  it("the mode preference is honored through the runtime's realization seam", async () => {
    const host = await bootHost();
    const view = await loadPlayerView(host, { ...DRIFT, preferredMode: "browser" });
    expect(view.failure).toBeNull();
    expect(view.surfaceMode).toBe("browser");
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement(PlayerSurface, playerSurfaceRenderProps(view)),
      }),
    );
    expect(markup).toContain("data-wfx-player-mode=\"browser\"");
    // The mode label names the mode word AND its user sentence.
    expect(markup).toContain("Playing via browser");
    expect(markup).toContain("contained window");
    // The switch row + the tray + the feedback controls ride the player.
    expect(markup).toContain("data-wfx-where-to-watch");
    expect(markup).toContain("data-wfx-ai-tray-surface=\"player\"");
    expect(markup).toContain("data-wfx-feedback-surface=\"player\"");
  });

  it("an unusable preference (native on Web) answers the TYPED failure with the next-way recovery", async () => {
    const host = await bootHost();
    const view = await loadPlayerView(host, { ...DRIFT, preferredMode: "native" });
    expect(view.failure).not.toBeNull();
    // The typed capability failure names the native limitation verbatim
    // (the runtime's own reason — never a generic error).
    expect(view.failure!.detail).toContain("native");
    expect(view.failure!.detail).toContain("nativeMedia");
    // The recovery path: the next supported way is the primary action.
    // R23-E: the peer copy counts as a way to play (3 provider + 1 peer).
    expect(view.whereToWatch.usableCount).toBe(4);
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement(PlayerSurface, playerSurfaceRenderProps(view)),
      }),
    );
    expect(markup).toContain("data-wfx-player-recovery");
    expect(markup).toContain("Try the next way to watch");
    // The native way stays DISCOVERABLE in the failure state (the honest
    // platform reason rides the Where-to-watch row — never hidden).
    expect(markup).toContain("data-wfx-watch-option=\"native\"");
    expect(markup).toContain("Desktop app");
    expect(isStaleCompletionCopy(markup)).toBe(false);
  });

  it("the precedence trace + attestation live behind ONE progressive disclosure", async () => {
    const host = await bootHost();
    const view = await loadPlayerView(host, { ...DRIFT });
    expect(view.precedenceTrace.length).toBeGreaterThan(0);
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement(PlayerSurface, playerSurfaceRenderProps(view)),
      }),
    );
    expect(markup).toContain("data-wfx-playback-diagnostics");
    expect(markup).toContain("<details"); // collapsed by default — the viewing experience stays primary
    // The diagnostics content still carries the trace (in the DOM, one
    // honest disclosure away).
    expect(markup).toContain("data-wfx-precedence-trace");
  });
});

// ---------------------------------------------------------------------------
// The search availability summary
// ---------------------------------------------------------------------------

describe("R21-E — the search availability summary (where can I watch this?)", () => {
  it("result cards carry the REAL resolve-derived summary", async () => {
    const host = await bootHost();
    const view = await loadSearchView(host, "a");
    expect(view.cards.length).toBeGreaterThan(0);
    const drift = view.cards.find((card) => card.title === "Asteroid Drift");
    expect(drift).toBeDefined();
    expect(view.availability.get(drift!.itemId)).toBe("3 ways to play here");
    // Every card carries SOME summary (the honest absent one where the
    // resolve failed or was capped).
    for (const card of view.cards) {
      expect(view.availability.has(card.itemId)).toBe(true);
    }
  });

  it("the summary derivation is pure + honest (zero usable = the honest sentence)", () => {
    expect(cardAvailabilitySummary(0, 2)).toBe("No way to play here yet");
    expect(cardAvailabilitySummary(1, 1)).toBe("1 way to play here");
    expect(cardAvailabilitySummary(1, 4)).toBe("1 way to play here — more on details");
    expect(cardAvailabilitySummary(3, 4)).toBe("3 ways to play here");
  });
});
