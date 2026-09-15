/**
 * WFX-051 player surface composition tests (bun:test).
 *
 * Proves the watch surface resolves the REAL Media Surface mode through
 * the shared runtime (port resolve → WFX-025 device gate → WFX-005 session
 * + "start" event) and renders it honestly:
 *
 * - embed → the iframe with the resolved URL (fixture placeholder URLs —
 *   no provider branding faked);
 * - browser → the visible web-player handoff (the web platform has no
 *   contained in-app browser — an honest platform limitation);
 * - external → the visible external handoff, URL shown, never fake playback;
 * - unresolvable / unsupported → the typed Experience failure taxonomy,
 *   rendered as the actionable error state — never a fabricated player;
 * - resume → the requested position lands in the started session;
 * - the "start" event flows through the WRAPPED EventSink (the watch-state
 *   seam continue-watching reads);
 * - the up-next queue comes from a REAL feed load, minus the playing item.
 *
 * Deterministic: fixture ports, controlled env. No network.
 */

import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { makeFixturePorts } from "@wfx/experience";

import { AppShell } from "../src/components/shell/AppShell";
import { PlayerSurface } from "../src/components/player/PlayerSurface";
import { bootWebClient } from "../src/main";
import { bootExperienceHost, EXPERIENCE_CONTEXT } from "../src/host/experience";
import { recordedWatchEvents } from "../src/host/watch-state";
import { withWatchStateRecording } from "../src/host/watch-state";
import { loadCardViews, startPlayerView, type PlayerView } from "../src/host/views";
import type { FakeCatalogItem } from "@wfx/experience";

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

/** The common player input for one fixture item. */
function input(overrides: Partial<Parameters<typeof startPlayerView>[1]> = {}) {
  return {
    connectorId: "fake-source",
    externalRef: "fake:video-3",
    title: "Desert Rain Doc",
    canonicalType: "video",
    durationMs: 2_400_000,
    queue: [],
    ...overrides,
  };
}

/** Render the full player page tree (shell + surface). */
function renderPlayer(view: PlayerView): string {
  return renderToStaticMarkup(
    createElement(AppShell, {
      mode: view.mode,
      children: createElement(PlayerSurface, { view }),
    }),
  );
}

/** An external-handoff-only catalog item (no embed/browser realization). */
const EXTERNAL_ONLY_ITEM: FakeCatalogItem = {
  externalRef: "fake:ext-1",
  title: "Orbit Handoff",
  canonicalType: "video",
  durationMs: 900_000,
  orientation: "horizontal",
  availability: "available",
  itemCapabilities: ["playExternal"],
  realizations: [
    {
      mode: "external",
      connectorId: "fake-source",
      externalRef: "fake:ext-1",
      url: "https://fixture.invalid/open/fake:ext-1",
      capabilities: ["playExternal"],
    },
  ],
};

describe("WFX-051 player surface (the resolved Media Surface mode)", () => {
  it("embed: a real session starts and the provider player renders in an iframe", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const host = bootExperienceHost();
      const view = await startPlayerView(host, input());
      expect(view.kind).toBe("playing");
      if (view.kind !== "playing") return;
      // The device gate: web rejects native, embed is the first realizable mode.
      expect(view.surfaceMode).toBe("embed");
      expect(view.surfaceUrl).toBe("https://fixture.invalid/embed/fake:video-3");
      expect(view.sessionId.startsWith("wfxpses_")).toBeTrue();
      expect(view.resumePositionMs).toBe(0);
      expect(view.precedenceTrace.length).toBeGreaterThan(0);
      // Connector-level like/save truth drives the controls.
      expect(view.canLike).toBeTrue();
      expect(view.canSave).toBeTrue();

      const markup = renderPlayer(view);
      expect(markup).toContain("data-wfx-player-mode=\"embed\"");
      expect(markup).toContain("<iframe");
      expect(markup).toContain("src=\"https://fixture.invalid/embed/fake:video-3\"");
      expect(markup).toContain("Playing via embed");
      expect(markup).toContain("Surface precedence:");
    });
  });

  it("browser: the web-player handoff is visible — the honest platform limitation", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const host = bootExperienceHost();
      const view = await startPlayerView(
        host,
        input({
          externalRef: "fake:video-1",
          title: "Deep Field Diary",
          durationMs: 1_800_000,
        }),
      );
      expect(view.kind).toBe("playing");
      if (view.kind !== "playing") return;
      expect(view.surfaceMode).toBe("browser");
      expect(view.surfaceUrl).toBe("https://fixture.invalid/watch/fake:video-1");

      const markup = renderPlayer(view);
      expect(markup).toContain("data-wfx-player-mode=\"browser\"");
      expect(markup).toContain("Open web player");
      // The handoff URL is VISIBLE — never hidden.
      expect(markup).toContain("https://fixture.invalid/watch/fake:video-1");
      expect(markup).not.toContain("<iframe");
    });
  });

  it("external: the handoff to the source is visible, never fake playback", async () => {
    const client = bootWebClient({
      ports: withWatchStateRecording(makeFixturePorts({ items: [EXTERNAL_ONLY_ITEM] })),
    });
    const view = await startPlayerView({ mode: "fixtures", client }, {
      connectorId: "fake-source",
      externalRef: "fake:ext-1",
      title: "Orbit Handoff",
      canonicalType: "video",
      durationMs: 900_000,
      queue: [],
    });
    expect(view.kind).toBe("playing");
    if (view.kind !== "playing") return;
    expect(view.surfaceMode).toBe("external");
    expect(view.surfaceUrl).toBe("https://fixture.invalid/open/fake:ext-1");

    const markup = renderPlayer(view);
    expect(markup).toContain("data-wfx-player-mode=\"external\"");
    expect(markup).toContain("Open on the source");
    expect(markup).toContain("opens on its source");
    expect(markup).not.toContain("<iframe");
  });

  it("unresolvable: an unknown ref renders the typed failure state — no fabricated player", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const host = bootExperienceHost();
      const view = await startPlayerView(host, input({ externalRef: "fake:missing" }));
      expect(view.kind).toBe("failed");
      if (view.kind !== "failed") return;
      expect(view.failure.reason).toBe("unresolvable");
      const markup = renderPlayer(view);
      expect(markup).toContain("data-wfx-player-state=\"failed\"");
      expect(markup).toContain("Playback could not start");
      expect(markup).not.toContain("<iframe");
    });
  });

  it("unsupported: a connector with no play capability is the typed unsupported result", async () => {
    const client = bootWebClient({
      ports: withWatchStateRecording(
        makeFixturePorts({ capabilities: ["catalogSearch", "metadata", "like", "save"] }),
      ),
    });
    const view = await startPlayerView({ mode: "fixtures", client }, input());
    expect(view.kind).toBe("failed");
    if (view.kind !== "failed") return;
    expect(view.failure.reason).toBe("unsupported");
    expect(view.failure).toHaveProperty("capability");
    const markup = renderPlayer(view);
    expect(markup).toContain("declares none of the playback capabilities");
  });

  it("resume: the requested position lands in the started session and the markup", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const host = bootExperienceHost();
      const view = await startPlayerView(host, input({ resumePositionMs: 900_000 }));
      expect(view.kind).toBe("playing");
      if (view.kind !== "playing") return;
      expect(view.resumePositionMs).toBe(900_000);
      const markup = renderPlayer(view);
      expect(markup).toContain("Resumed at 15:00");
    });
  });

  it("the start event flows through the wrapped EventSink (watch-state evidence)", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const host = bootExperienceHost();
      const view = await startPlayerView(host, input());
      expect(view.kind).toBe("playing");
      const events = recordedWatchEvents(EXPERIENCE_CONTEXT.userId);
      const startEvent = events[events.length - 1];
      expect(startEvent?.type).toBe("start");
      expect(startEvent?.itemId.startsWith("wfxitm_")).toBeTrue();
      expect(startEvent?.payload).toHaveProperty("playbackSessionId");
    });
  });

  it("the up-next queue comes from a real feed load, minus the playing item", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const host = bootExperienceHost();
      const queue = await loadCardViews(host, "watch", "a");
      expect(queue.length).toBe(5); // the trending pool is a real feed answer
      const view = await startPlayerView(host, input({ queue }));
      expect(view.kind).toBe("playing");
      if (view.kind !== "playing") return;
      const titles = view.queue.map((entry) => entry.card.title);
      expect(titles).not.toContain("Desert Rain Doc"); // the playing item never queues itself
      expect(titles).toContain("Asteroid Drift");
      expect(titles).toContain("Static Bloom");
      const markup = renderPlayer(view);
      expect(markup).toContain("data-wfx-queue");
      expect(markup).toContain("Up next");
    });
  });
});
