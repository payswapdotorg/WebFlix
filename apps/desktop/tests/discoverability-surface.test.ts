/**
 * R21-G — the Desktop discoverability surface tests (the parity lane).
 *
 * The frozen R21-A matrix + the R21-C shared control derivations bound to
 * the REAL Desktop composition root (`createDesktopApp` over the
 * deterministic harness doubles), proving:
 *
 * - THE PARITY LAW: every matrix row projects VERBATIM (shared semantics
 *   never fork); `desktopCapabilityParityIssues` answers empty and FAILS
 *   when a projection drifts (the mutation probes prove the checker);
 * - THE STANDING TRUTH: the bound composition answers all 17 capabilities
 *   usable; the unbound acquisition/feed blocks answer the TYPED unbound
 *   verdicts with recovery hints — never a fake usable, never a dead end;
 * - THE PLATFORM-DIFFERENCE TRUTH: exactly the matrix's five noted rows
 *   project their typed differences (Desktop carries; the Web next step is
 *   verbatim) — differences without a note are parity defects;
 * - THE J34 SWEEP: all 12 discovery tasks bind to their Desktop rows;
 * - THE STALE-COPY LAW: every string the surface can project passes the
 *   frozen `isStaleCompletionCopy` sweep (the J35 machine check);
 * - THE SHARED CONTROLS: the feed-mode control (typed refusals with
 *   recovery hints, adapter-reported availability over the REAL feed
 *   surface), the Personalize control, the Where-to-watch view (native
 *   USABLE on the Desktop bundle — the platform difference made
 *   understandable per realization), and the AI action tray (the honest
 *   model-class truth per action over the real model-controls transport);
 * - THE NAVIGATION LAW: the projected surfaces stay inside the frozen
 *   primary-navigation + item/player vocabulary (no second navigation
 *   system — machine-checked).
 */

import { describe, expect, it } from "bun:test";

import {
  CAPABILITY_SURFACE_MATRIX,
  DISCOVERABLE_CAPABILITY_IDS,
  isStaleCompletionCopy,
  J34_TASKS,
  PRIMARY_NAVIGATION_SURFACES,
  PRODUCT_SURFACE_IDS,
  type DiscoverableCapabilityId,
} from "@wfx/client-runtime";

import {
  desktopCapabilityParityIssues,
  discoverabilityCopyStrings,
  DESKTOP_AI_ACTIONS,
  type DesktopCapabilityStanding,
} from "../src/surface/discoverability-surface";
import {
  bootDesktopApp,
  jsonResponse,
  HARNESS_PROFILE,
} from "./discoverability-harness";
import { testExportArtifact } from "./feed-port-double";

/** The scripted provider registry row (the R21-B desktop port's shape). */
const LOCAL_PROVIDER_ROW = {
  id: "wfx-first-party",
  privacy: "local",
  capabilities: ["transcription", "translation", "dubbing", "commentary", "summary"],
  byomBound: false,
  costs: { transcription: 0, translation: 0 },
  availability: "available",
};

const CLOUD_PROVIDER_ROW = {
  id: "openai-compatible",
  privacy: "cloud",
  capabilities: ["translation"],
  byomBound: true,
  costs: { translation: 4 },
  availability: "available",
};

function modelPolicyRow(task: string, preferred: string | undefined, fallbacks: string[]): unknown {
  return {
    task,
    ...(preferred !== undefined ? { preferredProvider: preferred } : {}),
    fallbackProviders: fallbacks,
    privacy: preferred === "wfx-first-party" ? "local-only" : "any-cloud",
  };
}

describe("R21-G — the parity law (the matrix projects VERBATIM)", () => {
  it("the fully-bound composition answers every matrix row with zero parity issues", () => {
    const { app } = bootDesktopApp({ withAcquisition: true, withFeed: true });
    const views = app.discoverability.capabilityViews();
    expect(views).toHaveLength(DISCOVERABLE_CAPABILITY_IDS.length);
    expect(desktopCapabilityParityIssues(views)).toEqual([]);
    app.dispose();
  });

  it("every unbound variant ALSO projects all rows (the unbound standing, never a dropped row)", () => {
    const unboundAcquisition = bootDesktopApp({ withAcquisition: false, withFeed: true });
    expect(unboundAcquisition.app.discoverability.capabilityViews()).toHaveLength(
      DISCOVERABLE_CAPABILITY_IDS.length,
    );
    expect(desktopCapabilityParityIssues(unboundAcquisition.app.discoverability.capabilityViews())).toEqual([]);
    unboundAcquisition.app.dispose();

    const unboundFeed = bootDesktopApp({ withAcquisition: true, withFeed: false });
    expect(desktopCapabilityParityIssues(unboundFeed.app.discoverability.capabilityViews())).toEqual([]);
    unboundFeed.app.dispose();
  });

  it("the parity checker FAILS a drifted projection (the mutation probes)", () => {
    const { app } = bootDesktopApp({ withAcquisition: true, withFeed: true });
    const views = app.discoverability.capabilityViews();
    app.dispose();

    // Probe 1: a dropped row.
    const dropped = views.slice(1);
    expect(desktopCapabilityParityIssues(dropped).some((issue) => issue.includes("row count"))).toBe(true);
    expect(desktopCapabilityParityIssues(dropped).some((issue) => issue.includes("missing row"))).toBe(true);

    // Probe 2: a forked product label (product drift).
    const forkedLabel = views.map((view) =>
      view.capability === "identity-session" ? { ...view, productLabel: "Accounts++" } : view,
    );
    expect(
      desktopCapabilityParityIssues(forkedLabel).some((issue) => issue.includes("productLabel drifted")),
    ).toBe(true);

    // Probe 3: a forked recovery path (a lost recovery path is a parity defect).
    const forkedRecovery = views.map((view) =>
      view.capability === "connected-sources"
        ? { ...view, recovery: { ...view.recovery, action: "nothing" } }
        : view,
    );
    expect(
      desktopCapabilityParityIssues(forkedRecovery).some((issue) => issue.includes("recovery drifted")),
    ).toBe(true);

    // Probe 4: an invented surface outside the frozen vocabulary (the
    // second-navigation-system law).
    const inventedSurface = views.map((view) =>
      view.capability === "feed-mode"
        ? {
            ...view,
            primaryDiscovery: { surface: "dashboard" as never, control: view.primaryDiscovery.control },
          }
        : view,
    );
    expect(
      desktopCapabilityParityIssues(inventedSurface).some((issue) =>
        issue.includes("outside the frozen product vocabulary"),
      ),
    ).toBe(true);

    // Probe 5: an incoherent unbound standing on a server-state capability.
    const incoherentStanding: DesktopCapabilityStanding = {
      kind: "unbound",
      block: "byof-feed",
      detail: "x",
      recoveryHint: "y",
    };
    const incoherent = views.map((view) =>
      view.capability === "library-continuity" ? { ...view, standing: incoherentStanding } : view,
    );
    expect(
      desktopCapabilityParityIssues(incoherent).some((issue) => issue.includes("incoherent")),
    ).toBe(true);
  });

  it("the navigation law: every referenced surface stays inside the frozen vocabulary", () => {
    const { app } = bootDesktopApp({ withAcquisition: true, withFeed: true });
    const views = app.discoverability.capabilityViews();
    for (const view of views) {
      expect([...PRODUCT_SURFACE_IDS]).toContain(view.primaryDiscovery.surface);
      for (const entry of view.contextualEntries) {
        expect([...PRODUCT_SURFACE_IDS]).toContain(entry.surface);
      }
      expect(view.management.surface).toBe("settings");
    }
    // The primary navigation vocabulary itself is the frozen six.
    expect([...PRIMARY_NAVIGATION_SURFACES]).toEqual([
      "home",
      "watch",
      "shorts",
      "search",
      "library",
      "settings",
    ]);
    app.dispose();
  });
});

describe("R21-G — the standing truth (bound vs honestly unbound)", () => {
  it("the fully-bound composition: ALL capabilities stand usable", () => {
    const { app } = bootDesktopApp({ withAcquisition: true, withFeed: true });
    for (const view of app.discoverability.capabilityViews()) {
      expect(view.standing.kind).toBe("usable");
    }
    app.dispose();
  });

  it("the unbound acquisition block: native-offline and acquisition-recovery answer the TYPED verdict", () => {
    const { app } = bootDesktopApp({ withAcquisition: false, withFeed: true });
    const offline = app.discoverability.capabilityView("native-offline");
    expect(offline.standing.kind).toBe("unbound");
    if (offline.standing.kind === "unbound") {
      expect(offline.standing.block).toBe("native-acquisition");
      expect(offline.standing.detail).toContain("not bound in this build");
      expect(offline.standing.recoveryHint.length).toBeGreaterThan(0);
    }
    const recovery = app.discoverability.capabilityView("acquisition-recovery");
    expect(recovery.standing.kind).toBe("unbound");
    // The shared semantics NEVER change with the standing (parity held).
    expect(desktopCapabilityParityIssues(app.discoverability.capabilityViews())).toEqual([]);
    app.dispose();
  });

  it("the unbound feed block: following-byof answers the TYPED verdict", () => {
    const { app } = bootDesktopApp({ withAcquisition: true, withFeed: false });
    const byof = app.discoverability.capabilityView("following-byof");
    expect(byof.standing.kind).toBe("unbound");
    if (byof.standing.kind === "unbound") {
      expect(byof.standing.block).toBe("byof-feed");
      expect(byof.standing.detail).toContain("not bound in this build");
    }
    app.dispose();
  });

  it("capabilityView throws the typed error for an unknown id", () => {
    const { app } = bootDesktopApp({ withAcquisition: true, withFeed: true });
    expect(() => app.discoverability.capabilityView("does-not-exist" as never)).toThrow(/unknown capability/);
    app.dispose();
  });
});

describe("R21-G — the platform-difference truth (typed, never drifted)", () => {
  it("exactly the matrix's noted rows project their differences, verbatim", () => {
    const { app } = bootDesktopApp({ withAcquisition: true, withFeed: true });
    const differences = app.discoverability.platformDifferenceViews();
    const notedRows = CAPABILITY_SURFACE_MATRIX.filter((row) => row.platformTruth !== null);
    expect(differences).toHaveLength(notedRows.length);
    expect(differences.map((difference) => difference.capability).sort()).toEqual(
      notedRows.map((row) => row.capability).sort(),
    );
    for (const difference of differences) {
      const row = CAPABILITY_SURFACE_MATRIX.find((candidate) => candidate.capability === difference.capability);
      expect(row).toBeDefined();
      expect(row?.platformTruth?.reason).toBe(difference.reason);
      expect(row?.platformTruth?.nextStep).toBe(difference.webNextStep);
      if (row !== undefined) expect(difference.productLabel).toBe(row.productLabel);
    }
    app.dispose();
  });

  it("the Desktop carries every noted difference (the five platform truths)", () => {
    const { app } = bootDesktopApp({ withAcquisition: true, withFeed: true });
    const differences = app.discoverability.platformDifferenceViews();
    const expected: DiscoverableCapabilityId[] = [
      "acquisition-recovery",
      "following-byof",
      "model-policy",
      "native-offline",
      "playback-fallback",
    ];
    expect(differences.map((difference) => difference.capability).sort()).toEqual([...expected].sort());
    // The native-offline difference carries the Web next step verbatim.
    const nativeOffline = differences.find((difference) => difference.capability === "native-offline");
    expect(nativeOffline?.webNextStep).toContain("Available offline in the Desktop app");
    expect(nativeOffline?.reason).toContain("requires the Desktop native-media engine");
    app.dispose();
  });

  it("every capability WITHOUT a note projects no difference (parity where truthful)", () => {
    const { app } = bootDesktopApp({ withAcquisition: true, withFeed: true });
    for (const view of app.discoverability.capabilityViews()) {
      const row = CAPABILITY_SURFACE_MATRIX.find((candidate) => candidate.capability === view.capability);
      if (row?.platformTruth === null) {
        expect(view.platformTruth.desktopCarries).toBe(false);
        expect(view.platformTruth.difference).toBeNull();
        expect(view.platformTruth.otherPlatformNextStep).toBeNull();
      } else {
        expect(view.platformTruth.desktopCarries).toBe(true);
      }
    }
    app.dispose();
  });
});

describe("R21-G — the J34 sweep (every discovery task binds to real Desktop rows)", () => {
  it("all 12 tasks are covered with their matrix rows + standings", () => {
    const { app } = bootDesktopApp({ withAcquisition: true, withFeed: true });
    const tasks = app.discoverability.j34TaskViews();
    expect(tasks.map((task) => task.task)).toEqual([...J34_TASKS]);
    for (const task of tasks) {
      expect(task.rows.length).toBeGreaterThanOrEqual(1);
      for (const row of task.rows) {
        expect(row.j34Task).toBe(task.task);
        expect(row.primaryDiscovery.surface).toBeTruthy();
        expect(row.contextualEntries.length).toBeGreaterThanOrEqual(1);
        expect(row.recovery.action.length).toBeGreaterThan(0);
      }
    }
    // The desktop-offline-path task binds the native-offline row (usable here).
    const offlineTask = tasks.find((task) => task.task === "desktop-offline-path");
    expect(offlineTask?.rows.some((row) => row.capability === "native-offline" && row.standing.kind === "usable")).toBe(true);
    app.dispose();
  });

  it("the sweep reflects the honest standing (unbound compositions never claim usability)", () => {
    const { app } = bootDesktopApp({ withAcquisition: false, withFeed: true });
    const offlineTask = app.discoverability.j34TaskViews().find((task) => task.task === "desktop-offline-path");
    const nativeOfflineRow = offlineTask?.rows.find((row) => row.capability === "native-offline");
    expect(nativeOfflineRow?.standing.kind).toBe("unbound");
    app.dispose();
  });
});

describe("R21-G — the stale-copy law (the J35 machine check over the Desktop surface)", () => {
  it("every copy string the surface can project is free of stale completion wording", () => {
    const bound = bootDesktopApp({ withAcquisition: true, withFeed: true });
    const strings = discoverabilityCopyStrings(bound.app.discoverability);
    expect(strings.length).toBeGreaterThan(50);
    for (const text of strings) {
      expect(isStaleCompletionCopy(text)).toBe(false);
    }
    bound.app.dispose();

    const unboundAcquisition = bootDesktopApp({ withAcquisition: false, withFeed: false });
    for (const text of discoverabilityCopyStrings(unboundAcquisition.app.discoverability)) {
      expect(isStaleCompletionCopy(text)).toBe(false);
    }
    unboundAcquisition.app.dispose();
  });
});

describe("R21-G — the feed-mode control (the shared R21-A/R21-C semantics)", () => {
  it("the default control: For you selected; unavailable modes carry explanations + recovery hints", () => {
    const { app } = bootDesktopApp({ withAcquisition: true, withFeed: true });
    const control = app.discoverability.feedModeControl();
    expect(control.selected).toBe("foryou");
    expect(control.options.map((option) => option.mode)).toEqual(["foryou", "following", "byof", "hybrid"]);
    const forYou = control.options.find((option) => option.mode === "foryou");
    expect(forYou?.available).toBe(true);
    const byof = control.options.find((option) => option.mode === "byof");
    expect(byof?.available).toBe(false);
    expect(byof?.unavailableDetail).toContain("imported feed first");
    expect(byof?.recoveryHint).toContain("Bring your feed");
    app.dispose();
  });

  it("setFeedMode answers the TYPED refusal with its recovery hint (never a silent no-op)", () => {
    const { app } = bootDesktopApp({ withAcquisition: true, withFeed: true });
    const refused = app.discoverability.setFeedMode("byof");
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.failure.kind).toBe("unavailable");
      expect(refused.failure.recoveryHint).toContain("Bring your feed");
    }
    // The selection never silently changed.
    expect(app.discoverability.feedModeControl().selected).toBe("foryou");
    app.dispose();
  });

  it("reported availability unlocks the mode (the adapter-reported truth, never guessed)", () => {
    const { app } = bootDesktopApp({ withAcquisition: true, withFeed: true });
    app.discoverability.reportFeedModeAvailability({ following: true, byof: false });
    const accepted = app.discoverability.setFeedMode("following");
    expect(accepted.ok).toBe(true);
    expect(app.discoverability.feedModeControl().selected).toBe("following");
    // Hybrid needs at least one non-default source: following alone unlocks it.
    const hybrid = app.discoverability.setFeedMode("hybrid");
    expect(hybrid.ok).toBe(true);
    app.dispose();
  });

  it("refreshFeedModeAvailability derives the truth from the REAL feed surface reads", async () => {
    const bound = bootDesktopApp({ withAcquisition: true, withFeed: true });
    // Before any import: both non-default truths are false.
    const before = await bound.app.discoverability.refreshFeedModeAvailability(HARNESS_PROFILE);
    expect(before).toEqual({ following: false, byof: false });
    expect(bound.app.discoverability.feedModeControl().selected).toBe("foryou");

    // Import a real feed through the R20 NATIVE FILE path (the dialog is
    // scripted on the simulated shell — the real R20-F flow), then the
    // imported-feed mode becomes available.
    const artifact = testExportArtifact({
      continuousSync: false,
      sourceRef: "PL_r21",
      items: [{ externalRef: "vid-1", relationship: "playlist", sourceOrder: 0, title: "First" }],
    });
    bound.shell.scriptFile("/home/user/exports/feed.json", artifact);
    bound.shell.nextFilePickOutcome = { picked: true, path: "/home/user/exports/feed.json" };
    const staged = await bound.app.feed.importFromFile({
      connectorId: "test-source",
      method: "official-export",
    });
    expect(staged.outcome).toBe("preview");
    if (staged.outcome === "preview") {
      await bound.app.feed.confirmImport(staged.preview.importId);
    }
    const after = await bound.app.discoverability.refreshFeedModeAvailability(HARNESS_PROFILE);
    expect(after.byof).toBe(true);
    expect(after.following).toBe(false);
    const setByof = bound.app.discoverability.setFeedMode("byof");
    expect(setByof.ok).toBe(true);
    bound.app.dispose();
  });

  it("the unbound feed block answers the honest empty truth (never a guessed availability)", async () => {
    const unbound = bootDesktopApp({ withAcquisition: true, withFeed: false });
    const availability = await unbound.app.discoverability.refreshFeedModeAvailability(HARNESS_PROFILE);
    expect(availability).toEqual({ following: false, byof: false });
    expect(unbound.app.discoverability.feedModeControl().options.find((option) => option.mode === "byof")?.available).toBe(false);
    unbound.app.dispose();
  });
});

describe("R21-G — the Personalize control (the shared R05 projection)", () => {
  it("the control renders the runtime's intent + attention + feedback vocabulary", () => {
    const { app } = bootDesktopApp({ withAcquisition: true, withFeed: true });
    const control = app.discoverability.personalizeControl();
    expect(control.attentionMode).toBe("balanced");
    expect(control.attentionLabel).toBe("Balanced");
    expect(control.dials.exploration).toBeGreaterThanOrEqual(0);
    expect(control.feedbackControls.map((feedback) => feedback.kind)).toEqual([
      "more-like-this",
      "not-interested",
      "not-interested-source",
      "already-watched",
    ]);
    app.dispose();
  });
});

describe("R21-G — the Where-to-watch view (native/browser differences understandable)", () => {
  it("the Desktop bundle makes NATIVE usable — every mode labeled in user sentences", () => {
    const { app } = bootDesktopApp({ withAcquisition: true, withFeed: true });
    const view = app.discoverability.realizationChoice({
      realizations: [
        { mode: "native", connectorId: "vault" },
        { mode: "embed", connectorId: "streamer" },
        { mode: "browser", connectorId: "streamer" },
        { mode: "external", connectorId: "streamer" },
      ],
      active: { mode: "native", connectorId: "vault" },
    });
    expect(view.activeMode).toBe("native");
    expect(view.activeLabel).toBe("Plays natively in the Desktop app");
    expect(view.options).toHaveLength(4);
    for (const option of view.options) {
      expect(option.usable).toBe(true); // the Desktop bundle hosts every mode
      expect(option.modeLabel.length).toBeGreaterThan(0);
    }
    expect(view.options.find((option) => option.mode === "native")?.modeLabel).toBe(
      "Plays natively in the Desktop app",
    );
    app.dispose();
  });

  it("the platform-difference row explains what the Web does with native realizations", () => {
    const { app } = bootDesktopApp({ withAcquisition: true, withFeed: true });
    const playback = app.discoverability.platformDifferenceViews().find(
      (difference) => difference.capability === "playback-fallback",
    );
    expect(playback?.reason).toContain("Native playback is a Desktop capability");
    expect(playback?.webNextStep).toContain("plays natively in the Desktop app");
    app.dispose();
  });
});

describe("R21-G — the AI action tray (the honest model-class truth)", () => {
  function scriptModelEndpoints(
    stub: ReturnType<typeof bootDesktopApp>["stub"],
    input: {
      providers: unknown[];
      policies: Record<string, unknown>;
    },
  ): void {
    stub.script(
      (url) => url.includes("/experience/model-providers"),
      () => jsonResponse(input.providers),
    );
    for (const [task, policy] of Object.entries(input.policies)) {
      stub.script(
        (url) => url.includes("/experience/model-policy") && url.includes(`task=${task}`),
        () => jsonResponse(policy),
      );
    }
  }

  it("the tray offers the five shared AI actions with their model-class truths", async () => {
    const { app, stub } = bootDesktopApp({ withAcquisition: true, withFeed: true });
    scriptModelEndpoints(stub, {
      providers: [LOCAL_PROVIDER_ROW, CLOUD_PROVIDER_ROW],
      policies: {
        transcription: modelPolicyRow("transcription", "wfx-first-party", ["wfx-first-party"]),
        translation: modelPolicyRow("translation", "openai-compatible", ["wfx-first-party"]),
      },
    });
    const tray = await app.discoverability.refreshAiActionTray();
    expect(tray.actions.map((action) => action.kind)).toEqual(DESKTOP_AI_ACTIONS.map((spec) => spec.kind));
    expect(tray.providersStatus.state).toBe("ready");

    // A configured local policy names the provider + its on-device truth.
    const subtitles = tray.actions.find((action) => action.kind === "subtitles");
    expect(subtitles?.configured).toBe(true);
    expect(subtitles?.modelClassLabel).toContain("wfx-first-party");
    expect(subtitles?.modelClassLabel).toContain("on this device");
    expect(subtitles?.providerPrivacy).toBe("local");
    expect(subtitles?.recoveryHint).toBeNull();

    // A configured cloud policy names the provider without the local claim.
    const translate = tray.actions.find((action) => action.kind === "translate");
    expect(translate?.configured).toBe(true);
    expect(translate?.modelClassLabel).toContain("openai-compatible");
    expect(translate?.providerPrivacy).toBe("cloud");
    expect(translate?.modelClassLabel).not.toContain("on this device");

    // An unconfigured task answers the HONEST null + the recovery path.
    const dub = tray.actions.find((action) => action.kind === "dub");
    expect(dub?.configured).toBe(false);
    expect(dub?.modelClassLabel).toBe("no model chosen yet");
    expect(dub?.recoveryHint).toContain("Model & AI");

    // The management + platform notes point at the real paths.
    expect(tray.managementHint).toContain("Model & AI");
    expect(tray.localModelPlatformNote).toContain("Desktop app");
    app.dispose();
  });

  it("the cache view before any refresh answers the honest unconfigured tray (never a fabricated default)", () => {
    const { app } = bootDesktopApp({ withAcquisition: true, withFeed: true });
    const tray = app.discoverability.aiActionTray();
    for (const action of tray.actions) {
      expect(action.configured).toBe(false);
      expect(action.modelClassLabel).toBe("no model chosen yet");
      expect(action.recoveryHint).toContain("Model & AI");
    }
    app.dispose();
  });

  it("a failing registry read keeps the tray honest (in-model degradation, never fake rows)", async () => {
    const { app, stub } = bootDesktopApp({ withAcquisition: true, withFeed: true });
    stub.script((url) => url.includes("/experience/model-providers"), () => jsonResponse({}, 500));
    stub.script(
      (url) => url.includes("/experience/model-policy"),
      () => jsonResponse(modelPolicyRow("transcription", "wfx-first-party", [])),
    );
    const tray = await app.discoverability.refreshAiActionTray();
    expect(tray.providersStatus.state).toBe("error");
    // The configured action still names its chosen model; the privacy stays
    // honestly unknown when the registry read failed.
    const subtitles = tray.actions.find((action) => action.kind === "subtitles");
    expect(subtitles?.configured).toBe(true);
    expect(subtitles?.modelClassLabel).toContain("wfx-first-party");
    expect(subtitles?.providerPrivacy).toBeNull();
    app.dispose();
  });
});

describe("R21-G — the composition root binding", () => {
  it("createDesktopApp binds the discoverability surface on every composition variant", () => {
    const bound = bootDesktopApp({ withAcquisition: true, withFeed: true });
    expect(bound.app.discoverability.capabilityViews()).toHaveLength(DISCOVERABLE_CAPABILITY_IDS.length);
    bound.app.dispose();

    const bare = bootDesktopApp({ withAcquisition: false, withFeed: false });
    expect(bare.app.discoverability.capabilityViews()).toHaveLength(DISCOVERABLE_CAPABILITY_IDS.length);
    expect(bare.app.discoverability.capabilityView("native-offline").standing.kind).toBe("unbound");
    bare.app.dispose();
  });

  it("the app-level surface answers the same views as the direct construction", () => {
    const { app } = bootDesktopApp({ withAcquisition: true, withFeed: true });
    expect(app.discoverability.feedModeControl().selected).toBe("foryou");
    expect(app.discoverability.aiActionTray().actions).toHaveLength(5);
    expect(app.discoverability.platformDifferenceViews()).toHaveLength(5);
    expect(app.discoverability.j34TaskViews()).toHaveLength(12);
    app.dispose();
  });
});
