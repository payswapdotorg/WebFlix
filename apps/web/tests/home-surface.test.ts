/**
 * WFX-051 home surface composition tests (bun:test).
 *
 * Proves the polished home surface end to end through the SHARED runtime —
 * the same `HomeSurface` + `AppShell` components the route serves, rendered
 * with `react-dom/server`:
 *
 * - fixtures mode (`WFX_DEV_FIXTURES=1`): hero + For you / Trending / Shorts
 *   rows render the deterministic fixture content through the frozen feed
 *   use-case, with capability-honest chips and canonical-type badges;
 * - the host's canonical-identity join: two separate boots (two "requests")
 *   agree on item identity — the correlation law continue-watching, search,
 *   and actions all depend on;
 * - continue watching: watch-state events through the ports (the real
 *   POST /api/events route handler) fold into the continue row, flip the
 *   hero to resume, and a `complete` report honestly removes the entry;
 * - an empty catalog renders the honest empty state, never fabricated cards.
 *
 * Deterministic: controlled env (restored), fixture ports, fixed clocks.
 * No network.
 */

import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { makeFixturePorts } from "@wfx/experience";

import { AppShell } from "../src/components/shell/AppShell";
import { HomeSurface } from "../src/components/home/HomeSurface";
import { bootWebClient } from "../src/main";
import { bootExperienceHost, EXPERIENCE_CONTEXT } from "../src/host/experience";
import { canonicalItemId } from "../src/host/canon";
import { recordedWatchEvents } from "../src/host/watch-state";
import { withWatchStateRecording } from "../src/host/watch-state";
import { loadHomeView, startPlayerView } from "../src/host/views";
import { POST as postEvent } from "../src/app/api/events/route";

/** Run an async `body` with a controlled environment, restoring the real one after. */
async function withEnv(overrides: Record<string, string>, body: () => Promise<void>): Promise<void> {
  const names = ["WFX_DEV_FIXTURES", "WFX_API_BASE", "NODE_ENV"];
  const saved = new Map<string, string | undefined>();
  for (const name of names) saved.set(name, process.env[name]);
  try {
    for (const name of names) delete process.env[name];
    for (const [name, value] of Object.entries(overrides)) process.env[name] = value;
    await body();
  } finally {
    for (const name of names) {
      const value = saved.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/** Render the full home page tree (shell + surface) to static markup. */
function renderHome(view: Awaited<ReturnType<typeof loadHomeView>>): string {
  return renderToStaticMarkup(
    createElement(AppShell, {
      mode: view.mode,
      active: "/",
      children: createElement(HomeSurface, { view }),
    }),
  );
}

/** POST one JSON body to the events route (the real handler, no network). */
async function postEventRoute(body: unknown): Promise<Response> {
  return postEvent(
    new Request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("WFX-051 home surface composition (through the shared runtime)", () => {
  it("fixtures mode: hero + For you / Trending / Shorts rows render fixture feed data", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const host = bootExperienceHost();
      expect(host.mode).toBe("fixtures");
      const view = await loadHomeView(host);

      expect(view.mode).toBe("fixtures");
      // Fresh session: no continue entries yet — the hero is a start hero
      // (this test file is the FIRST to touch the anonymous watch state).
      expect(view.continueEntries).toEqual([]);
      expect(view.hero).not.toBeNull();
      expect(view.hero?.kind).toBe("start");
      expect(view.hero?.card.title).toBe("Desert Rain Doc");

      // For you = the 050 seed query ("rain"), watch-form only.
      expect(view.forYou.map((card) => card.title)).toEqual(["Desert Rain Doc"]);

      // Trending = the broad seed query ("a"): every watch-form hit,
      // including the no-metadata fallback card (Static Bloom).
      expect(view.trending.map((card) => card.title)).toEqual([
        "Asteroid Drift",
        "Harbor Lights",
        "Deep Field Diary",
        "Static Bloom",
        "Desert Rain Doc",
      ]);
      const staticBloom = view.trending.find((card) => card.title === "Static Bloom");
      expect(staticBloom?.availability).toBe("unknown"); // honest fallback — never fabricated metadata

      // Shorts rail: the short-surface seed reaches the vertical shorts.
      expect(view.shorts.map((card) => card.title)).toEqual([
        "Neon Rain",
        "Midnight Scoop",
        "Rain Check",
      ]);

      // Joined canonical identities on every card.
      for (const card of [...view.forYou, ...view.trending, ...view.shorts]) {
        expect(card.itemId.startsWith("wfxitm_")).toBeTrue();
      }

      // The rendered page: hero, rows, capability chips, type badges, badge honesty.
      const markup = renderHome(view);
      expect(markup).toContain("WebFlix");
      expect(markup).toContain("dev fixtures");
      expect(markup).toContain("data-wfx-hero=\"start\"");
      expect(markup).toContain("Desert Rain Doc");
      expect(markup).toContain("data-wfx-row=\"for-you\"");
      expect(markup).toContain("data-wfx-row=\"trending-on-your-sources\"");
      expect(markup).toContain("data-wfx-row=\"shorts\"");
      expect(markup).toContain("Embeddable"); // capability chip — the source's declared truth
      expect(markup).toContain("2h 0m"); // Asteroid Drift duration (7_200_000ms)
      expect(markup).toContain("wfx-badge--type"); // canonical-type badge grammar
      expect(markup).toContain("href=\"/shorts\""); // the shorts rail enters the vertical feed
    });
  });

  it("the host identity join: two separate boots agree on canonical item ids", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      // Two boots = two requests (fresh ports + fresh runtime each time).
      const first = await loadHomeView(bootExperienceHost());
      const second = await loadHomeView(bootExperienceHost());
      // The frozen feed mints fresh ids per call; the HOST join makes them
      // stable — the correlation law events/actions/continue depend on.
      expect(first.forYou[0]?.itemId).toBe(second.forYou[0]?.itemId);
      expect(
        first.trending.map((card) => card.itemId),
      ).toEqual(second.trending.map((card) => card.itemId));
    });
  });

  it("an empty catalog renders the honest empty state — never fabricated cards", async () => {
    const client = bootWebClient({ ports: withWatchStateRecording(makeFixturePorts({ items: [] })) });
    const view = await loadHomeView({ mode: "fixtures", client });
    expect(view.hero).toBeNull();
    expect(view.forYou).toEqual([]);
    expect(view.trending).toEqual([]);
    expect(view.shorts).toEqual([]);
    const markup = renderToStaticMarkup(createElement(HomeSurface, { view }));
    expect(markup).toContain("No content yet");
    expect(markup).not.toContain("data-wfx-card=\"wfxitm_");
  });

  it("continue watching: port events fold into the resume row, then complete removes it", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const host = bootExperienceHost();
      // The joined canonical id of Desert Rain Doc (the identity actions and
      // events correlate on).
      const itemId = canonicalItemId({ connectorId: "fake-source", externalRef: "fake:video-3" });

      // 1. Play it through the player pipeline: a REAL session + "start" event.
      const player = await startPlayerView(host, {
        connectorId: "fake-source",
        externalRef: "fake:video-3",
        title: "Desert Rain Doc",
        canonicalType: "video",
        durationMs: 2_400_000,
        queue: [],
      });
      expect(player.kind).toBe("playing");
      // The start event flowed through the WRAPPED EventSink (recorded).
      const starts = recordedWatchEvents(EXPERIENCE_CONTEXT.userId).filter(
        (event) => event.type === "start" && event.itemId === itemId,
      );
      expect(starts).toHaveLength(1);

      // 2. A progress report through the REAL events route handler.
      const progress = await postEventRoute({
        itemId,
        type: "progress",
        payload: { positionMs: 900_000 },
      });
      expect(progress.status).toBe(200);

      // 3. The home view now carries the continue row and a resume hero.
      const view = await loadHomeView(host);
      expect(view.continueEntries).toHaveLength(1);
      expect(view.continueEntries[0]?.card.title).toBe("Desert Rain Doc");
      expect(view.continueEntries[0]?.resumePositionMs).toBe(900_000);
      expect(view.continueEntries[0]?.completionRatio).toBe(0.375);
      expect(view.continueEntries[0]?.affordance).toBe("resume");
      expect(view.hero?.kind).toBe("resume");
      expect(view.hero?.card.title).toBe("Desert Rain Doc");

      const markup = renderHome(view);
      expect(markup).toContain("data-wfx-hero=\"resume\"");
      expect(markup).toContain("data-wfx-row=\"continue\"");
      expect(markup).toContain("Resume at 15m 0s");
      expect(markup).toContain("width:37.5%"); // the progress bar

      // 4. "Mark as watched" (complete) honestly removes the entry.
      const complete = await postEventRoute({ itemId, type: "complete" });
      expect(complete.status).toBe(200);
      const after = await loadHomeView(host);
      expect(
        after.continueEntries.filter((entry) => entry.card.title === "Desert Rain Doc"),
      ).toEqual([]);
    });
  });
});
