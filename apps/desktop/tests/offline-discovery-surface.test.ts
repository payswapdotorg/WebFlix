/**
 * R21-H — the Desktop offline/feed discovery tests (the moment-of-use lane).
 *
 * The R21-H surface proven over the REAL seams: the R14 acquisition source
 * (the scripted engine facade — the full lifecycle J21→J26 the way the
 * composition root drives it), the R20-G feed surface (the FeedPort double
 * + the simulated shell's native file dialog), and the composition root
 * itself (`createDesktopApp`, bound and unbound variants). The lane's five
 * discoverability requirements, each with its truth laws:
 *
 * - OFFLINE ACQUISITION REACHABLE FROM CONTENT — the item affordance offers
 *   "Make available offline" with the shared action labels, the honest
 *   lifecycle headline/detail per state, and the actionable acquire path
 *   (the composition root's recipe; typed verdicts when unbound/not-wired);
 * - ACQUISITION STATE VISIBLE DURING/AFTER PLAYBACK — the player view's
 *   honest headline, the measured runway truth, the retry next action, and
 *   the Library next step;
 * - VERIFIED OFFLINE ASSETS EASY TO FIND IN LIBRARY — the Offline section's
 *   ready/in-progress/failed grouping + the calm empty state with its next
 *   action + the honest unbound verdict;
 * - BACKGROUND COMPLETION UNOBTRUSIVE — the preparing/completing/paused
 *   work only (never terminal states, never the active playback);
 * - BYOF FILE/EXPORT FLOWS DISCOVERABLE — the dialog capability truth, the
 *   file methods, the frozen matrix's entry points, and the feed-mode
 *   connection (label + availability + the import next-action);
 *
 * Plus THE COPY LAWS: no stale completion copy (the J35 sweep) and no
 * protocol terminology in the default views (the R14 leak law), and the
 * SHARED ACTION-LABEL PARITY with the Web acquisition controls (the same
 * wording — one vocabulary across adapters, machine-pinned).
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { containsAcquisitionProtocolTerminology, isStaleCompletionCopy } from "@wfx/client-runtime";

import {
  DESKTOP_ACQUISITION_ACTION_LABELS,
  offlineDiscoveryCopyStrings,
} from "../src/surface/offline-discovery-surface";
import {
  bootDesktopApp,
  bootOfflineDiscovery,
  engineStatus,
  engineTruth,
  offlineEntry,
  HARNESS_ITEM,
  HARNESS_ITEM_2,
  HARNESS_PROFILE,
} from "./discoverability-harness";
import { testExportArtifact } from "./feed-port-double";

/** Bind one item's session on the source (the composition root's bind flow). */
function bindItem(
  harness: ReturnType<typeof bootOfflineDiscovery>,
  itemId: string,
  sessionId: string,
): void {
  harness.source.bindSession(sessionId, {
    profileKey: HARNESS_PROFILE,
    canonicalItemId: itemId,
    title: "Authorized Archive Feature",
  });
}

describe("R21-H — offline acquisition reachable from content", () => {
  it("a bound engine + unknown item: the affordance offers Make available offline with the shared label", () => {
    const harness = bootOfflineDiscovery();
    const affordance = harness.offlineDiscovery.makeAvailableOffline(HARNESS_ITEM);
    expect(affordance.capability.kind).toBe("usable");
    expect(affordance.status).toBeNull();
    expect(affordance.headline).toBe("Make available offline");
    expect(affordance.detail).toContain("native engine");
    expect(affordance.actions).toHaveLength(1);
    expect(affordance.actions[0]?.action.kind).toBe("acquire");
    expect(affordance.actions[0]?.label).toBe("Make available offline");
    // The moment-of-use platform note names the Desktop power.
    expect(affordance.platformNote).toContain("finishing while you watch");
  });

  it("executeAcquire runs the composition root's recipe end-to-end and the view reflects the fresh lifecycle", async () => {
    const harness = bootOfflineDiscovery({
      acquire: async (itemId) => {
        // The composition root's real flow, scripted: ingest + session +
        // bind + the engine's first honest status.
        harness.engine.script(
          "s-r21h-1",
          engineStatus({ sessionId: "s-r21h-1", state: "discovering-metadata" }),
          "idle",
          engineTruth(),
        );
        bindItem(harness, itemId, "s-r21h-1");
        return { ok: true, value: { sessionId: "s-r21h-1" } };
      },
    });
    const started = await harness.offlineDiscovery.executeAcquire(HARNESS_ITEM);
    expect(started.ok).toBe(true);
    harness.source.refresh();
    const affordance = harness.offlineDiscovery.makeAvailableOffline(HARNESS_ITEM);
    expect(affordance.status?.state).toBe("preparing");
    expect(affordance.headline).toBe("Preparing");
    expect(affordance.actions.map((action) => action.label)).toEqual(["Pause download"]);
  });

  it("the unbound engine block: the offer stays DISCOVERABLE with the typed verdict + recovery (never stale copy)", () => {
    const { app } = bootDesktopApp({ withAcquisition: false, withFeed: true });
    const affordance = app.offlineDiscovery.makeAvailableOffline(HARNESS_ITEM);
    expect(affordance.capability.kind).toBe("unbound");
    expect(affordance.headline).toBe("Make available offline"); // the capability is discoverable
    expect(affordance.detail).toContain("not bound in this build");
    expect(affordance.actions).toEqual([]); // never a fake action on an unbound engine
    expect(isStaleCompletionCopy(affordance.detail)).toBe(false);
    app.dispose();
  });

  it("executeAcquire answers the TYPED verdicts: unbound, not-wired, recipe-failed", async () => {
    const unbound = bootDesktopApp({ withAcquisition: false, withFeed: true });
    const unboundResult = await unbound.app.offlineDiscovery.executeAcquire(HARNESS_ITEM);
    expect(unboundResult.ok).toBe(false);
    if (!unboundResult.ok) {
      expect(unboundResult.code).toBe("unbound");
      expect(unboundResult.detail).toContain("not bound in this build");
    }
    unbound.app.dispose();

    const notWired = bootOfflineDiscovery(); // bound engine, no recipe
    const notWiredResult = await notWired.offlineDiscovery.executeAcquire(HARNESS_ITEM);
    expect(notWiredResult.ok).toBe(false);
    if (!notWiredResult.ok) {
      expect(notWiredResult.code).toBe("not-wired");
      expect(notWiredResult.detail).toContain("no start recipe");
    }

    const failing = bootOfflineDiscovery({
      acquire: async () => ({ ok: false, error: { code: "PROVENANCE_REJECTED", detail: "no authorized source for this title" } }),
    });
    const failed = await failing.offlineDiscovery.executeAcquire(HARNESS_ITEM);
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.code).toBe("recipe-failed");
      expect(failed.detail).toContain("authorized source");
    }
  });

  it("the full lifecycle affordance: available → preparing → completing → ready-offline (J21→J26)", () => {
    const harness = bootOfflineDiscovery();
    // Available: a binding whose session the engine does not know (the
    // stopped-session truth — the source drops it honestly, the base facts
    // answer the plain offer).
    bindItem(harness, HARNESS_ITEM, "s-r21h-0");
    harness.source.refresh();
    const available = harness.offlineDiscovery.makeAvailableOffline(HARNESS_ITEM);
    expect(available.status?.state).toBe("available");
    expect(available.headline).toBe("Make available offline");
    expect(available.actions.map((action) => action.action.kind)).toEqual(["acquire"]);

    // Preparing: a FRESH bound session the engine is already serving (the
    // composition root binds at session creation — the engine knows it).
    bindItem(harness, HARNESS_ITEM, "s-r21h-1");
    harness.engine.script(
      "s-r21h-1",
      engineStatus({ sessionId: "s-r21h-1", state: "discovering-metadata" }),
      "idle",
      engineTruth(),
    );
    harness.source.refresh();
    const preparing = harness.offlineDiscovery.makeAvailableOffline(HARNESS_ITEM);
    expect(preparing.headline).toBe("Preparing");
    expect(preparing.actions[0]?.label).toBe("Pause download");

    // Completing (the plain download path).
    harness.engine.script(
      "s-r21h-1",
      engineStatus({
        sessionId: "s-r21h-1",
        state: "downloading",
        progress: { selectedPieces: 6, verifiedSelectedPieces: 2, selectedBytes: 98_304, verifiedSelectedBytes: 32_768, fraction: 2 / 6 },
      }),
      "idle",
      engineTruth(),
    );
    harness.source.refresh();
    const completing = harness.offlineDiscovery.makeAvailableOffline(HARNESS_ITEM);
    expect(completing.headline).toBe("Completing");
    expect(completing.detail).toContain("Finishing the offline copy");
    expect(completing.libraryNextStep).toContain("Library");

    // Ready offline (the earned exposure — J26).
    harness.engine.scriptOfflineReady([
      offlineEntry({ key: `canonical:${HARNESS_PROFILE}::${HARNESS_ITEM}`, sessionId: "s-r21h-1", canonicalItemId: HARNESS_ITEM }),
    ]);
    harness.source.refresh();
    const ready = harness.offlineDiscovery.makeAvailableOffline(HARNESS_ITEM);
    expect(ready.headline).toBe("Ready offline");
    expect(ready.actions.map((action) => action.label)).toEqual([
      "Play offline copy",
      "Re-check the offline copy",
    ]);
    expect(ready.libraryNextStep).toContain("Library, under Offline");
  });

  it("a recoverable failure surfaces the shared retry label with its recovery note", () => {
    const harness = bootOfflineDiscovery();
    bindItem(harness, HARNESS_ITEM, "s-r21h-1");
    harness.engine.script(
      "s-r21h-1",
      engineStatus({
        sessionId: "s-r21h-1",
        state: "failed",
        failure: { reason: "corruption-detected", detail: "a piece hash mismatched" },
      }),
      "idle",
      engineTruth(),
    );
    harness.source.refresh();
    const failed = harness.offlineDiscovery.makeAvailableOffline(HARNESS_ITEM);
    expect(failed.headline).toBe("Couldn't finish");
    expect(failed.actions.map((action) => action.label)).toContain("Try again");
    expect(failed.actions.map((action) => action.label)).toContain("Dismiss");
    expect(failed.platformNote).toContain("Retrying keeps what already downloaded");
  });
});

describe("R21-H — acquisition state visible during/after playback", () => {
  it("no acquisition: the honest source truth (never a fake offline claim)", () => {
    const harness = bootOfflineDiscovery();
    const view = harness.offlineDiscovery.playerOfflineStatus(HARNESS_ITEM);
    expect(view.status).toBeNull();
    expect(view.headline).toBe("Playing through the current source — nothing is being downloaded.");
    expect(view.offlinePlaybackReady).toBe(false);
    expect(view.runwaySeconds).toBeNull();
  });

  it("playing with a measured runway: the honest 'can playback continue' truth", () => {
    const harness = bootOfflineDiscovery();
    bindItem(harness, HARNESS_ITEM, "s-r21h-1");
    harness.engine.script(
      "s-r21h-1",
      engineStatus({
        sessionId: "s-r21h-1",
        state: "downloading",
        progress: { selectedPieces: 6, verifiedSelectedPieces: 3, selectedBytes: 98_304, verifiedSelectedBytes: 49_152, fraction: 0.5 },
      }),
      "steady",
      engineTruth({ schedulerState: "steady", runway: { bytes: 1_048_576, seconds: 120 } }),
    );
    harness.source.refresh();
    const view = harness.offlineDiscovery.playerOfflineStatus(HARNESS_ITEM);
    expect(view.status?.state).toBe("playing");
    expect(view.offlinePlaybackReady).toBe(true);
    expect(view.runwaySeconds).toBe(120);
    expect(view.headline).toContain("Playing");
    expect(view.libraryNextStep).toContain("When it finishes");
  });

  it("ready-offline: the Library next step (after playback, the asset is findable)", () => {
    const harness = bootOfflineDiscovery();
    bindItem(harness, HARNESS_ITEM, "s-r21h-1");
    harness.engine.scriptOfflineReady([
      offlineEntry({ key: `canonical:${HARNESS_PROFILE}::${HARNESS_ITEM}`, sessionId: "s-r21h-1", canonicalItemId: HARNESS_ITEM }),
    ]);
    harness.source.refresh();
    const view = harness.offlineDiscovery.playerOfflineStatus(HARNESS_ITEM);
    expect(view.offlinePlaybackReady).toBe(true);
    expect(view.headline).toContain("Ready offline");
    expect(view.libraryNextStep).toBe("Find it any time in Library, under Offline.");
  });

  it("a failed playback-time acquisition offers the labeled retry next action", () => {
    const harness = bootOfflineDiscovery();
    bindItem(harness, HARNESS_ITEM, "s-r21h-1");
    harness.engine.script(
      "s-r21h-1",
      engineStatus({
        sessionId: "s-r21h-1",
        state: "failed",
        failure: { reason: "corruption-detected", detail: "a piece hash mismatched" },
      }),
      "idle",
      engineTruth(),
    );
    harness.source.refresh();
    const view = harness.offlineDiscovery.playerOfflineStatus(HARNESS_ITEM);
    expect(view.nextAction?.label).toBe("Try again");
    expect(view.offlinePlaybackReady).toBe(false);
  });
});

describe("R21-H — verified offline assets easy to find in Library", () => {
  it("the Offline section groups ready/in-progress/failed with their recovery paths", () => {
    const harness = bootOfflineDiscovery();
    // Item 1: ready offline. Item 2: completing.
    bindItem(harness, HARNESS_ITEM, "s-r21h-1");
    bindItem(harness, HARNESS_ITEM_2, "s-r21h-2");
    harness.engine.scriptOfflineReady([
      offlineEntry({ key: `canonical:${HARNESS_PROFILE}::${HARNESS_ITEM}`, sessionId: "s-r21h-1", canonicalItemId: HARNESS_ITEM }),
    ]);
    harness.engine.script(
      "s-r21h-2",
      engineStatus({
        sessionId: "s-r21h-2",
        state: "downloading",
        progress: { selectedPieces: 6, verifiedSelectedPieces: 2, selectedBytes: 98_304, verifiedSelectedBytes: 32_768, fraction: 2 / 6 },
      }),
      "idle",
      engineTruth({ sessionId: "s-r21h-2" }),
    );
    harness.source.refresh();
    const section = harness.offlineDiscovery.libraryOfflineSection();
    expect(section.capability.kind).toBe("usable");
    expect(section.readyOffline.map((view) => view.itemId)).toEqual([HARNESS_ITEM]);
    expect(section.readyOffline[0]?.actions.map((action) => action.kind)).toContain("play-offline");
    expect(section.inProgress.map((view) => view.itemId)).toEqual([HARNESS_ITEM_2]);
    expect(section.failed).toEqual([]);
    expect(section.emptyState).toBeNull();
  });

  it("the calm empty state carries the next useful action (never a bare nothing-here)", () => {
    const harness = bootOfflineDiscovery();
    const section = harness.offlineDiscovery.libraryOfflineSection();
    expect(section.readyOffline).toEqual([]);
    expect(section.emptyState).not.toBeNull();
    expect(section.emptyState?.headline).toBe("Nothing here yet");
    expect(section.emptyState?.detail).toContain("without a connection");
    expect(section.emptyState?.actionLabel).toBe("Open any title and choose Make available offline");
  });

  it("the unbound engine block answers the honest capability verdict section", () => {
    const { app } = bootDesktopApp({ withAcquisition: false, withFeed: true });
    const section = app.offlineDiscovery.libraryOfflineSection();
    expect(section.capability.kind).toBe("unbound");
    expect(section.emptyState?.headline).toBe("Downloads are not wired in this build");
    expect(section.emptyState?.detail).toContain("not bound in this build");
    expect(isStaleCompletionCopy(section.emptyState?.detail ?? "")).toBe(false);
    app.dispose();
  });
});

describe("R21-H — background completion, unobtrusive", () => {
  it("the background surface carries preparing/completing/paused work ONLY", () => {
    const harness = bootOfflineDiscovery();
    // Item 1: ready-offline (terminal — NOT background). Item 2: completing.
    // Item 3: actively playing (NOT background). Item 4: preparing.
    bindItem(harness, HARNESS_ITEM, "s-r21h-1");
    bindItem(harness, HARNESS_ITEM_2, "s-r21h-2");
    bindItem(harness, "wfxitm_0000000000000000000000R21P", "s-r21h-3");
    bindItem(harness, "wfxitm_0000000000000000000000R21Q", "s-r21h-4");
    harness.engine.scriptOfflineReady([
      offlineEntry({ key: `canonical:${HARNESS_PROFILE}::${HARNESS_ITEM}`, sessionId: "s-r21h-1", canonicalItemId: HARNESS_ITEM }),
    ]);
    harness.engine.script(
      "s-r21h-2",
      engineStatus({
        sessionId: "s-r21h-2",
        state: "downloading",
        progress: { selectedPieces: 6, verifiedSelectedPieces: 2, selectedBytes: 98_304, verifiedSelectedBytes: 32_768, fraction: 2 / 6 },
      }),
      "idle",
      engineTruth({ sessionId: "s-r21h-2" }),
    );
    harness.engine.script(
      "s-r21h-3",
      engineStatus({
        sessionId: "s-r21h-3",
        state: "downloading",
        progress: { selectedPieces: 6, verifiedSelectedPieces: 3, selectedBytes: 98_304, verifiedSelectedBytes: 49_152, fraction: 0.5 },
      }),
      "steady",
      engineTruth({ sessionId: "s-r21h-3", schedulerState: "steady", runway: { bytes: 1_048_576, seconds: 90 } }),
    );
    harness.engine.script(
      "s-r21h-4",
      engineStatus({ sessionId: "s-r21h-4", state: "discovering-metadata" }),
      "idle",
      engineTruth({ sessionId: "s-r21h-4" }),
    );
    harness.source.refresh();
    const background = harness.offlineDiscovery.backgroundCompletion();
    const ids = background.map((view) => view.itemId).sort();
    expect(ids).toEqual([HARNESS_ITEM_2, "wfxitm_0000000000000000000000R21Q"].sort());
    expect(background.every((view) => view.state === "completing" || view.state === "preparing")).toBe(true);
  });

  it("a paused in-progress acquisition is background work (the honest modifier)", () => {
    const harness = bootOfflineDiscovery();
    bindItem(harness, HARNESS_ITEM, "s-r21h-1");
    harness.engine.script(
      "s-r21h-1",
      engineStatus({
        sessionId: "s-r21h-1",
        state: "seeding-paused",
        progress: { selectedPieces: 6, verifiedSelectedPieces: 4, selectedBytes: 98_304, verifiedSelectedBytes: 65_536, fraction: 4 / 6 },
      }),
      "idle",
      engineTruth({ sessionId: "s-r21h-1" }),
    );
    harness.source.refresh();
    const background = harness.offlineDiscovery.backgroundCompletion();
    expect(background.map((view) => view.itemId)).toEqual([HARNESS_ITEM]);
    expect(background[0]?.paused).toBe(true);
    expect(background[0]?.actions.map((action) => action.kind)).toContain("resume");
  });
});

describe("R21-H — BYOF file/export flows discoverable (the R20 seam)", () => {
  it("the bound feed + dialog shell: the full import discovery with the matrix's entry points", async () => {
    const harness = bootOfflineDiscovery();
    const discovery = await harness.offlineDiscovery.feedImportDiscovery();
    expect(discovery.capability.kind).toBe("usable");
    expect(discovery.fileImport?.supported).toBe(true);
    if (discovery.fileImport?.supported) {
      expect(discovery.fileImport.kind).toBe("native-dialog");
    }
    expect(discovery.fileMethods).toEqual(["official-export", "user-file"]);
    // The frozen matrix's entry points (Home's CTA + Settings' import entry).
    expect(discovery.entryPoints).toHaveLength(2);
    expect(discovery.entryPoints.some((entry) => entry.surface === "home" && entry.control.includes("Bring your feed"))).toBe(true);
    expect(discovery.entryPoints.some((entry) => entry.surface === "settings" && entry.control.includes("import entry"))).toBe(true);
    expect(discovery.importPathHint).toContain("preview");
    // The feed-mode connection: the shared label + the unavailable truth + next action.
    expect(discovery.feedModeLabel).toBe("Your imported feed");
    expect(discovery.feedModeAvailable).toBe(false);
    expect(discovery.nextAction).toContain("Bring your feed");
  });

  it("after a real import the discovery reflects the available mode (no next action needed)", async () => {
    const harness = bootOfflineDiscovery();
    const artifact = testExportArtifact({
      continuousSync: false,
      sourceRef: "PL_r21h",
      items: [{ externalRef: "vid-1", relationship: "playlist", sourceOrder: 0, title: "First" }],
    });
    harness.shell.scriptFile("/home/user/exports/feed.json", artifact);
    harness.shell.nextFilePickOutcome = { picked: true, path: "/home/user/exports/feed.json" };
    const staged = await harness.feed.importFromFile({ connectorId: "test-source", method: "official-export" });
    expect(staged.outcome).toBe("preview");
    if (staged.outcome === "preview") {
      await harness.feed.confirmImport(staged.preview.importId);
    }
    // The host reports the fresh availability truth (the R21-G control's law).
    harness.runtime.feedMode.setAvailability({ following: false, byof: true });
    const discovery = await harness.offlineDiscovery.feedImportDiscovery();
    expect(discovery.feedModeAvailable).toBe(true);
    expect(discovery.nextAction).toBeNull();
  });

  it("a dialog-less shell answers the typed unsupported verdict with the service recovery", async () => {
    const { app } = bootDesktopApp({ withAcquisition: true, withFeed: true, fileDialogPresent: false });
    const discovery = await app.offlineDiscovery.feedImportDiscovery();
    expect(discovery.capability.kind).toBe("usable");
    expect(discovery.fileImport?.supported).toBe(false);
    expect(discovery.fileMethods).toEqual([]);
    expect(discovery.nextAction).toContain("import flow instead");
    app.dispose();
  });

  it("the unbound feed block answers the typed verdict with its recovery hint", async () => {
    const harness = bootOfflineDiscovery({ withFeed: false });
    const discovery = await harness.offlineDiscovery.feedImportDiscovery();
    expect(discovery.capability.kind).toBe("unbound");
    expect(discovery.fileImport).toBeNull();
    expect(discovery.nextAction).toContain("import wiring is absent");
    expect(isStaleCompletionCopy(discovery.nextAction ?? "")).toBe(false);
  });
});

describe("R21-H — the copy laws (stale-copy + protocol-free + label parity)", () => {
  it("every projected string is free of stale completion wording (the J35 sweep)", () => {
    const harness = bootOfflineDiscovery();
    for (const text of offlineDiscoveryCopyStrings(harness.offlineDiscovery)) {
      expect(isStaleCompletionCopy(text)).toBe(false);
    }
    const unbound = bootDesktopApp({ withAcquisition: false, withFeed: false });
    for (const text of offlineDiscoveryCopyStrings(unbound.app.offlineDiscovery)) {
      expect(isStaleCompletionCopy(text)).toBe(false);
    }
    unbound.app.dispose();
  });

  it("every default-view string is protocol-free (the R14 leak law)", () => {
    const harness = bootOfflineDiscovery();
    bindItem(harness, HARNESS_ITEM, "s-r21h-1");
    bindItem(harness, HARNESS_ITEM_2, "s-r21h-2");
    harness.engine.scriptOfflineReady([
      offlineEntry({ key: `canonical:${HARNESS_PROFILE}::${HARNESS_ITEM}`, sessionId: "s-r21h-1", canonicalItemId: HARNESS_ITEM }),
    ]);
    harness.engine.script(
      "s-r21h-2",
      engineStatus({
        sessionId: "s-r21h-2",
        state: "downloading",
        progress: { selectedPieces: 6, verifiedSelectedPieces: 2, selectedBytes: 98_304, verifiedSelectedBytes: 32_768, fraction: 2 / 6 },
      }),
      "idle",
      engineTruth({ sessionId: "s-r21h-2" }),
    );
    harness.source.refresh();
    for (const text of offlineDiscoveryCopyStrings(harness.offlineDiscovery)) {
      expect(containsAcquisitionProtocolTerminology(text)).toBe(false);
    }
  });

  it("the action labels are the SHARED user vocabulary — the Web controls' exact wording (parity pinned)", () => {
    // The parity law: Web/Desktop share semantics AND the control wording.
    // The Web acquisition controls' ACTION_LABELS are extracted from the
    // committed source and compared label-for-label; a rewording on either
    // side fails here loudly so the vocabulary is resynchronized.
    const webSourcePath = join(
      import.meta.dir,
      "../../web/src/components/acquisition/AcquisitionActions.tsx",
    );
    const webSource = readFileSync(webSourcePath, "utf8");
    const expected: Readonly<Record<string, string>> = {
      acquire: "Make available offline",
      pause: "Pause download",
      resume: "Resume download — keep saved progress",
      retry: "Try again",
      restart: "Start over — discard saved progress",
      dismiss: "Dismiss",
      "play-offline": "Play offline copy",
      "reverify-offline": "Re-check the offline copy",
    };
    for (const [kind, label] of Object.entries(expected)) {
      // Keys may be quoted in the source literal ("play-offline" carries a
      // dash) — the pattern accepts both forms.
      const pattern = new RegExp(`"?${kind}"?:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
      const match = webSource.match(pattern);
      expect(match).not.toBeNull();
      if (match !== null) {
        expect(match[1]).toBe(label);
      }
      expect(DESKTOP_ACQUISITION_ACTION_LABELS[kind as keyof typeof DESKTOP_ACQUISITION_ACTION_LABELS]).toBe(label);
    }
  });
});

describe("R21-H — the composition root binding", () => {
  it("createDesktopApp binds the offline discovery surface with the optional acquire recipe", async () => {
    let recipeCalls = 0;
    const { app } = bootDesktopApp({
      withAcquisition: true,
      withFeed: true,
      acquire: async () => {
        recipeCalls += 1;
        return { ok: true, value: { sessionId: "s-app-1" } };
      },
    });
    const affordance = app.offlineDiscovery.makeAvailableOffline(HARNESS_ITEM);
    expect(affordance.capability.kind).toBe("usable");
    expect(affordance.headline).toBe("Make available offline");
    const started = await app.offlineDiscovery.executeAcquire(HARNESS_ITEM);
    expect(started.ok).toBe(true);
    expect(recipeCalls).toBe(1);
    app.dispose();
  });

  it("the unbound composition still binds the surface (the honest verdicts, never a missing surface)", () => {
    const { app } = bootDesktopApp({ withAcquisition: false, withFeed: false });
    expect(app.offlineDiscovery.makeAvailableOffline(HARNESS_ITEM).capability.kind).toBe("unbound");
    expect(app.offlineDiscovery.libraryOfflineSection().capability.kind).toBe("unbound");
    app.dispose();
  });
});
