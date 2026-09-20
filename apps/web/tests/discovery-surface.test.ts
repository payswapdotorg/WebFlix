/**
 * R21-D — the Web discovery-layer tests (bun:test).
 *
 * Proves the contextual discovery controls render + behave through the
 * REAL composition (the fixtures-mode host, the real runtime stores, the
 * real BYOF composition) — the laws the R21 plan freezes:
 *
 * - THE FEED-MODE CONTROL: all four frozen modes render with the FROZEN
 *   labels (never re-worded); unavailable modes are DISCOVERABLE, not
 *   hidden (reason + recovery action); the typed refusal carries the
 *   recovery hint (409, never a silent success); the availability truth
 *   derives from REAL imported-feed data and is REPORTED to the store.
 * - THE PERSONALIZE CONTROL: a session intent sets through the runtime's
 *   own seam (session-scoped — never persisted as long-term preference),
 *   is visible, and is clearable (the recovery path); the attention-mode
 *   switch lands in the runtime's policy view (both transports implement
 *   the write-through); the exploration dial writes [0,1].
 * - THE SOURCE STRIP + SESSION MENU: the Home orientation zone renders
 *   the connect/bring-feed CTAs into the EXISTING IA; the session menu
 *   carries the sign-in/profile path (the honest signed-out state).
 * - THE MODE-HONORED HOME: switching to the imported-feed mode (after a
 *   REAL import through the shared composition) renders the imported
 *   records in source-native order with the order sentence — never
 *   mislabeled as WebFlix-ranked.
 * - THE STALE-COPY LAW: the rendered surfaces carry ZERO stale
 *   completion copy (the machine sweep `isStaleCompletionCopy` over the
 *   real markup — the J35 primitive).
 *
 * Determinism: fixture transport, controlled env (restored), PGlite BYOF
 * runtime pristine via dev-reset, no network.
 */

import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FEED_MODE_LABELS,
  isStaleCompletionCopy,
} from "@wfx/client-runtime";
import type { RecordedIntent, RecommendationPolicyView } from "@wfx/client-runtime";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { loadHomeView } from "../src/host/view-models";
import {
  feedModeAvailabilityOf,
  feedModeViewOf,
  importedSectionViewOf,
  intentExpiryLabel,
  loadDiscoveryBundle,
  loadFeedModeView,
  loadPersonalizeView,
  personalizeViewOf,
  sourceStripViewOf,
} from "../src/host/discoverability";
import { getByofFixturesRuntime } from "../src/host/byof/byof-fixtures";
import type { ByofFixturesRuntime } from "../src/host/byof/byof-fixtures";
import type { ByofFeedView } from "../src/host/byof/byof-view";
import { AppShell } from "../src/components/shell/AppShell";
import { HomeSurface } from "../src/components/home/HomeSurface";
import { WatchBrowseSurface } from "../src/components/watch/WatchBrowseSurface";
import { SettingsSurface } from "../src/components/settings/SettingsSurface";
import { SourceStrip } from "../src/components/discovery/SourceStrip";
import { FeedModeControl } from "../src/components/discovery/FeedModeControl";
import { PersonalizeControl } from "../src/components/discovery/PersonalizeControl";
import { GET as getFeedMode, POST as postFeedMode } from "../src/app/api/feed-mode/route";
import { GET as getPersonalize, POST as postPersonalize } from "../src/app/api/personalize/route";
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

/** A ready imported-feed view factory (the shape the derivations consume). */
function feedViewOf(overrides?: Partial<ByofFeedView>): ByofFeedView {
  return {
    state: "ready",
    imports: [
      {
        import: {
          importId: "wfximp_test1",
          connectorId: "youtube",
          displayName: "YouTube",
          method: "subscriptions",
          status: "confirmed",
          syncState: "snapshot",
          disconnectedByUser: false,
          continuousSync: true,
          itemCount: 2,
          capturedAt: "2026-09-20T00:00:00.000Z",
          importedAt: "2026-09-20T00:01:00.000Z",
        },
        groups: [
          {
            relationship: "subscription",
            records: [
              {
                externalRef: "yt:vid-2",
                title: "Second in the source feed",
                sourceOrder: 2,
                entertainmentItemId: "wfxitm_0000000000000000000002",
                capturedAt: "2026-09-20T00:00:00.000Z",
                relationship: "subscription",
              },
              {
                externalRef: "yt:vid-1",
                title: "First in the source feed",
                sourceOrder: 1,
                entertainmentItemId: "wfxitm_0000000000000000000001",
                capturedAt: "2026-09-20T00:00:00.000Z",
                relationship: "subscription",
              },
            ],
          },
          {
            relationship: "like",
            records: [
              {
                externalRef: "yt:vid-3",
                title: "A liked record",
                sourceOrder: 3,
                entertainmentItemId: "wfxitm_0000000000000000000003",
                capturedAt: "2026-09-20T00:00:00.000Z",
                relationship: "like",
              },
            ],
          },
        ],
      },
    ],
    followingCount: 2,
    relationshipCounts: { subscription: 2, like: 1 },
    ...overrides,
  } as ByofFeedView;
}

/** The BYOF fixtures runtime (the REAL shared composition). */
let byof: ByofFixturesRuntime;

beforeAll(async () => {
  byof = await getByofFixturesRuntime();
});

beforeEach(async () => {
  await byof.drive("dev-reset");
  resetWebHostProcessState();
});

// ---------------------------------------------------------------------------
// The pure derivations (the frozen vocabularies + the availability law)
// ---------------------------------------------------------------------------

describe("R21-D feed-mode derivations", () => {
  it("renders all four frozen modes with the frozen labels (never re-worded)", () => {
    const view = feedModeViewOf("foryou", { following: false, byof: false });
    expect(view.mode).toBe("foryou");
    expect(view.options.map((option) => option.id)).toEqual(["foryou", "following", "byof", "hybrid"]);
    for (const option of view.options) {
      expect(option.label).toBe(FEED_MODE_LABELS[option.id]);
    }
  });

  it("an unavailable mode is discoverable: reason + recovery action, never hidden", () => {
    const view = feedModeViewOf("foryou", { following: false, byof: false });
    const byof = view.options.find((option) => option.id === "byof");
    expect(byof).toBeDefined();
    expect(byof!.available).toBe(false);
    expect(byof!.reason).toContain("brought from another app");
    expect(byof!.recoveryAction).toBe("Bring your feed");
    expect(byof!.recoveryHref).toBe("/settings?section=sources");
    // For-you is always available (the default orientation law).
    const foryou = view.options.find((option) => option.id === "foryou");
    expect(foryou!.available).toBe(true);
    expect(foryou!.reason).toBeNull();
  });

  it("availability derives from real imported-feed data (never a guess)", () => {
    // No feed view at all (the transport failed / service unavailable).
    expect(feedModeAvailabilityOf(null)).toEqual({ following: false, byof: false });
    // An unavailable feed view is the honest nothing truth.
    expect(feedModeAvailabilityOf({ state: "unavailable" } as ByofFeedView)).toEqual({
      following: false,
      byof: false,
    });
    // A ready feed with records: byof true; following mirrors the follow count.
    const truth = feedModeAvailabilityOf(feedViewOf());
    expect(truth).toEqual({ following: true, byof: true });
    // A feed with records but no follow-family relationships: following false.
    const noFollowing = feedViewOf({ followingCount: 0 });
    expect(feedModeAvailabilityOf(noFollowing).following).toBe(false);
    expect(feedModeAvailabilityOf(noFollowing).byof).toBe(true);
  });

  it("the imported section honors the mode: source-native order, follow subset, honest null", () => {
    const feed = feedViewOf();
    // BYOF mode: EVERY record, in the source's own order (sourceOrder 1,2,3).
    const byof = importedSectionViewOf("byof", feed);
    expect(byof).not.toBeNull();
    expect(byof!.cards.map((card) => card.sourceOrder)).toEqual([1, 2, 3]);
    expect(byof!.label).toBe(FEED_MODE_LABELS.byof);
    expect(byof!.orderSentence).toContain("never re-ranked by WebFlix");
    expect(byof!.freshnessSentence).toContain("Snapshot");
    // FOLLOWING mode: only the follow-family records (the subscription subset).
    const following = importedSectionViewOf("following", feed);
    expect(following!.cards.map((card) => card.relationship)).toEqual(["subscription", "subscription"]);
    expect(following!.label).toBe(FEED_MODE_LABELS.following);
    // FOR-YOU mode renders no imported section (the seeded discovery rows own it).
    expect(importedSectionViewOf("foryou", feed)).toBeNull();
    // An empty feed answers the honest null (no fabricated section).
    expect(importedSectionViewOf("byof", { state: "ready", imports: [], followingCount: 0, relationshipCounts: {} } as ByofFeedView)).toBeNull();
  });
});

describe("R21-D personalize derivations", () => {
  const policy: RecommendationPolicyView = {
    attentionMode: "balanced",
    exploration: 0.5,
    novelty: 0.5,
    socialInfluence: 0.5,
    updatedAt: "2026-09-20T00:00:00.000Z",
  };

  it("projects the four attention modes with the selected one marked", () => {
    const view = personalizeViewOf(policy, []);
    expect(view.attentionModes.map((mode) => mode.id)).toEqual([
      "mindful",
      "balanced",
      "immersive",
      "custom",
    ]);
    expect(view.attentionModes.find((mode) => mode.selected)?.id).toBe("balanced");
    for (const mode of view.attentionModes) {
      expect(mode.label.length).toBeGreaterThan(0);
      expect(mode.description.length).toBeGreaterThan(0);
    }
  });

  it("session intents project with the session expiry label (the temporary truth)", () => {
    const sessionIntent: RecordedIntent = {
      id: "wfxint_1",
      scope: "session",
      objective: "cozy documentaries",
      weight: 1,
      confidence: 1,
      provenance: "explicit",
      submittedAt: "2026-09-20T00:00:00.000Z",
    };
    expect(intentExpiryLabel(sessionIntent)).toBe("ends with this session");
    const view = personalizeViewOf(policy, [sessionIntent]);
    expect(view.intents).toHaveLength(1);
    expect(view.intents[0]!.objective).toBe("cozy documentaries");
    expect(view.intents[0]!.expiryLabel).toBe("ends with this session");
  });

  it("a temporary intent's expiry renders as its own deadline (not session-scoped)", () => {
    const temporary: RecordedIntent = {
      id: "wfxint_2",
      scope: "temporary",
      objective: "surprise me",
      weight: 1,
      confidence: 1,
      expiresAt: "2026-09-20T23:59:00.000Z",
      provenance: "explicit",
      submittedAt: "2026-09-20T00:00:00.000Z",
    };
    expect(intentExpiryLabel(temporary)).toMatch(/^until /);
  });
});

// ---------------------------------------------------------------------------
// The API routes (the typed transports)
// ---------------------------------------------------------------------------

describe("R21-D the feed-mode route", () => {
  it("GET answers the current mode + the adapter-reported availability", async () => {
    const host = await bootHost();
    void host;
    const response = await getFeedMode(new Request("http://localhost/api/feed-mode"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { mode: string; options: { id: string; available: boolean }[] };
    expect(body.mode).toBe("foryou");
    // The pristine session: only For-you is available (the honest truth).
    const available = body.options.filter((option) => option.available).map((option) => option.id);
    expect(available).toEqual(["foryou"]);
  });

  it("POST refuses an unavailable mode with the typed 409 + recovery hint", async () => {
    await bootHost();
    const response = await post(postFeedMode, { mode: "byof" });
    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      failure: { recoveryHint: string; kind: string; mode: string };
    };
    expect(body.failure.kind).toBe("unavailable");
    expect(body.failure.mode).toBe("byof");
    expect(body.failure.recoveryHint).toContain("Bring your feed");
  });

  it("POST rejects a non-vocabulary mode with the typed 400", async () => {
    await bootHost();
    const response = await post(postFeedMode, { mode: "watch-later-queue" });
    expect(response.status).toBe(400);
  });

  it("after a REAL import the mode is honored (availability reported, set succeeds)", async () => {
    // The J33 spine over the REAL shared composition.
    await byof.drive("connect");
    const preview = await byof.startPreview({ connectorId: "youtube" });
    if (!preview.ok) throw new Error(`preview failed: ${preview.failure.detail}`);
    const confirmed = await byof.confirm(preview.value.importId);
    if (!confirmed.ok) throw new Error(`confirm failed: ${confirmed.failure.detail}`);

    const host = await bootHost();
    const view = await loadFeedModeView(host);
    const byofOption = view.options.find((option) => option.id === "byof");
    expect(byofOption!.available).toBe(true); // the adapter reported the real truth
    const response = await post(postFeedMode, { mode: "byof" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { mode: string };
    expect(body.mode).toBe("byof");
  });
});

describe("R21-D the personalize route", () => {
  it("a session intent sets through the runtime seam and is visible + clearable", async () => {
    const host = await bootHost();
    // Set: the typed 200 + the honest next view.
    const set = await post(postPersonalize, { kind: "intent", objective: "cozy documentaries tonight" });
    expect(set.status).toBe(200);
    const afterSet = (await set.json()) as { intents: { objective: string }[] };
    expect(afterSet.intents.some((intent) => intent.objective === "cozy documentaries tonight")).toBe(true);
    // The runtime's own read sees the session intent.
    expect(
      host.runtime.intents.intents().some((intent) => intent.objective === "cozy documentaries tonight"),
    ).toBe(true);
    // GET answers the same truth (one law, two reads).
    const read = await getPersonalize(new Request("http://localhost/api/personalize"));
    const afterRead = (await read.json()) as { intents: { objective: string; expiryLabel: string }[] };
    expect(afterRead.intents[0]!.expiryLabel).toBe("ends with this session");
    // Clear: the recovery path (the runtime's end-session law).
    const clear = await post(postPersonalize, { kind: "clear-intent" });
    expect(clear.status).toBe(200);
    const afterClear = (await clear.json()) as { intents: unknown[] };
    expect(afterClear.intents).toHaveLength(0);
  });

  it("an empty objective answers the typed 400 (never a silent no-op)", async () => {
    await bootHost();
    const response = await post(postPersonalize, { kind: "intent", objective: "   " });
    expect(response.status).toBe(400);
  });

  it("an attention-mode switch lands in the runtime's policy view", async () => {
    const host = await bootHost();
    const response = await post(postPersonalize, { kind: "attention", attentionMode: "mindful" });
    expect(response.status).toBe(200);
    expect(host.runtime.intents.policy().attentionMode).toBe("mindful");
    // Restore the balanced default (test determinism).
    await post(postPersonalize, { kind: "attention", attentionMode: "balanced" });
    expect(host.runtime.intents.policy().attentionMode).toBe("balanced");
  });

  it("a non-vocabulary attention mode answers the typed 400", async () => {
    await bootHost();
    const response = await post(postPersonalize, { kind: "attention", attentionMode: "hypnotized" });
    expect(response.status).toBe(400);
  });

  it("the exploration dial writes [0,1] and retains the current attention mode", async () => {
    const host = await bootHost();
    const response = await post(postPersonalize, { kind: "exploration", value: 0.8 });
    expect(response.status).toBe(200);
    const policy = host.runtime.intents.policy();
    expect(policy.exploration).toBe(0.8);
    expect(policy.attentionMode).toBe("balanced"); // unset fields are retained
    // Out-of-range values answer the typed 400.
    const bad = await post(postPersonalize, { kind: "exploration", value: 1.5 });
    expect(bad.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// The surface composition (the discovery layer renders on every lane)
// ---------------------------------------------------------------------------

describe("R21-D the discovery surfaces", () => {
  it("Home renders the orientation zone: feed modes, Personalize, source strip CTAs", async () => {
    const host = await bootHost();
    const [view, discovery] = await Promise.all([
      (async () => loadHomeView(host))(),
      loadDiscoveryBundle(host),
    ]);
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement(HomeSurface, { view, discovery }),
      }),
    );
    // The feed-mode control: all four frozen modes with the frozen labels.
    for (const mode of ["foryou", "following", "byof", "hybrid"] as const) {
      expect(markup).toContain(`data-wfx-feed-mode-option="${mode}"`);
    }
    expect(markup).toContain(FEED_MODE_LABELS.byof);
    // The pristine truth: byof/following/hybrid render unavailable (never hidden).
    expect(markup).toContain('data-wfx-feed-mode-available="false"');
    // The Personalize control + its attention modes.
    expect(markup).toContain("data-wfx-personalize-control");
    expect(markup).toContain('data-wfx-attention-mode="mindful"');
    expect(markup).toContain('data-wfx-attention-mode="balanced"');
    expect(markup).toContain('data-wfx-attention-mode="immersive"');
    expect(markup).toContain('data-wfx-attention-mode="custom"');
    // The source strip's CTAs point into the EXISTING IA.
    expect(markup).toContain('data-wfx-source-connect-cta');
    expect(markup).toContain('data-wfx-byof-cta');
    expect(markup).toContain("Connect a source");
    expect(markup).toContain("Bring your feed");
    // The session menu's sign-in path.
    expect(markup).toContain("data-wfx-session-signin");
  });

  it("Watch renders the compact discovery controls (session changes in context)", async () => {
    const host = await bootHost();
    const [view, discovery] = await Promise.all([
      (async () => {
        const { loadWatchBrowseView } = await import("../src/host/view-models");
        return loadWatchBrowseView(host);
      })(),
      loadDiscoveryBundle(host),
    ]);
    const markup = renderToStaticMarkup(
      createElement(WatchBrowseSurface, { view, discovery }),
    );
    expect(markup).toContain('data-wfx-discovery-surface="watch"');
    expect(markup).toContain("data-wfx-feed-mode-control");
    expect(markup).toContain("data-wfx-personalize-control");
  });

  it("Settings general holds the profile + recommendation management areas", async () => {
    const host = await bootHost();
    const personalize = loadPersonalizeView(host);
    const markup = renderToStaticMarkup(
      createElement(SettingsSurface, {
        capabilities: host.capabilities,
        session: host.session.state,
        mode: host.mode,
        section: "general",
        personalize,
      }),
    );
    // The profile & identity area (the detailed management, honest states).
    expect(markup).toContain('data-wfx-settings-profile');
    expect(markup).toContain("Profile &amp; identity");
    // The recommendation & intent area names the contextual entries.
    expect(markup).toContain('data-wfx-settings-recommendation');
    expect(markup).toContain("data-wfx-attention-mode-label");
    expect(markup).toContain("no session intent set");
    expect(markup).toContain('data-wfx-recommendation-entry');
  });

  it("the source strip renders the authorization truth chips with recovery links", async () => {
    const host = await bootHost();
    const view = await loadDiscoveryBundle(host);
    const markup = renderToStaticMarkup(createElement(SourceStrip, { view: view.sourceStrip }));
    // The fixtures boot's scripted source renders its authorization truth.
    expect(markup).toContain("data-wfx-source-chip");
    expect(markup).toContain("data-wfx-source-chip-label");
  });

  it("the source strip's error state carries the typed detail (never a fake empty)", () => {
    const markup = renderToStaticMarkup(
      createElement(SourceStrip, {
        view: sourceStripViewOf({
          status: { state: "error", error: { kind: "unavailable", detail: "the source read failed" } },
          sources: [],
        }),
      }),
    );
    expect(markup).toContain("data-wfx-source-strip-error");
    expect(markup).toContain("the source read failed");
  });

  it("an imported feed honors the mode on Home: source-native order, distinctly labeled", async () => {
    // The J33 spine over the REAL shared composition.
    await byof.drive("connect");
    const preview = await byof.startPreview({ connectorId: "youtube" });
    if (!preview.ok) throw new Error(`preview failed: ${preview.failure.detail}`);
    const confirmed = await byof.confirm(preview.value.importId);
    if (!confirmed.ok) throw new Error(`confirm failed: ${confirmed.failure.detail}`);

    const host = await bootHost();
    const set = await post(postFeedMode, { mode: "byof" });
    expect(set.status).toBe(200);
    const [view, discovery] = await Promise.all([
      (async () => loadHomeView(host))(),
      loadDiscoveryBundle(host),
    ]);
    expect(discovery.feedMode.mode).toBe("byof");
    expect(discovery.importedSection).not.toBeNull();
    expect(discovery.discoveryRowsRender).toBe(false); // BYOF mode owns the feed
    const markup = renderToStaticMarkup(
      createElement(HomeSurface, { view, discovery }),
    );
    expect(markup).toContain('data-wfx-imported-feed');
    expect(markup).toContain("data-wfx-imported-order-note");
    expect(markup).toContain("never re-ranked by WebFlix");
    expect(markup).toContain("data-wfx-imported-card");
    expect(markup).toContain('data-wfx-feed-mode="byof"');
  });

  it("the stale-copy law: the rendered surfaces carry ZERO stale completion copy", async () => {
    const host = await bootHost();
    const [homeView, discovery] = await Promise.all([
      (async () => loadHomeView(host))(),
      loadDiscoveryBundle(host),
    ]);
    const { loadWatchBrowseView } = await import("../src/host/view-models");
    const watchView = await loadWatchBrowseView(host);
    const surfaces = [
      renderToStaticMarkup(
        createElement(AppShell, {
          mode: host.mode,
          session: host.session.state,
          children: createElement(HomeSurface, { view: homeView, discovery }),
        }),
      ),
      renderToStaticMarkup(
        createElement(AppShell, {
          mode: host.mode,
          session: host.session.state,
          children: createElement(WatchBrowseSurface, { view: watchView, discovery }),
        }),
      ),
      renderToStaticMarkup(
        createElement(SettingsSurface, {
          capabilities: host.capabilities,
          session: host.session.state,
          mode: host.mode,
          section: "sources",
        }),
      ),
      renderToStaticMarkup(
        createElement(SettingsSurface, {
          capabilities: host.capabilities,
          session: host.session.state,
          mode: host.mode,
          section: "model",
        }),
      ),
      renderToStaticMarkup(
        createElement(SettingsSurface, {
          capabilities: host.capabilities,
          session: host.session.state,
          mode: host.mode,
          section: "general",
        }),
      ),
    ];
    // The J35 sweep primitive over the REAL markup (both visible text and
    // the copy source — the machine-checkable law).
    for (const markup of surfaces) {
      const text = markup.replace(/<[^>]+>/g, " ");
      expect(isStaleCompletionCopy(text)).toBe(false);
      expect(isStaleCompletionCopy(markup)).toBe(false);
    }
    // The known defect strings are gone at the copy source.
    expect(surfaces.join(" ")).not.toContain("seeded until personal ranking");
    expect(surfaces.join(" ")).not.toContain("arrive with the identity lane");
    expect(surfaces.join(" ")).not.toContain("arrives with the source-management lane");
    expect(surfaces.join(" ")).not.toContain("Model controls arrive with the model lane");
  });
});

// ---------------------------------------------------------------------------
// The client islands (the frozen-label render + the typed states)
// ---------------------------------------------------------------------------

describe("R21-D the discovery islands", () => {
  it("the feed-mode island renders every option with its availability truth", () => {
    const view = feedModeViewOf("foryou", { following: false, byof: false });
    const markup = renderToStaticMarkup(
      createElement(FeedModeControl, { view }),
    );
    expect(markup).toContain('data-wfx-feed-mode-selected="foryou"');
    expect(markup).toContain('data-wfx-feed-mode-current="true"');
    expect(markup).toContain('data-wfx-feed-mode-available="false"');
    expect(markup).toContain("What your feed shows");
  });

  it("the personalize island renders the toggle with the current mode + intent mark", () => {
    const policy: RecommendationPolicyView = {
      attentionMode: "balanced",
      exploration: 0.5,
      novelty: 0.5,
      socialInfluence: 0.5,
      updatedAt: "2026-09-20T00:00:00.000Z",
    };
    const withIntent = personalizeViewOf(policy, [
      {
        id: "wfxint_1",
        scope: "session",
        objective: "cozy documentaries",
        weight: 1,
        confidence: 1,
        provenance: "explicit",
        submittedAt: "2026-09-20T00:00:00.000Z",
      },
    ]);
    const markup = renderToStaticMarkup(
      createElement(PersonalizeControl, { view: withIntent, surface: "home" }),
    );
    expect(markup).toContain("Personalize · Balanced");
    expect(markup).toContain("data-wfx-personalize-intent-mark");
    expect(markup).toContain('data-wfx-personalize-surface="home"');
  });
});
