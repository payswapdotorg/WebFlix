/**
 * @wfx/app-desktop — the Desktop offline/feed discovery surface (R21-H).
 *
 * THE Desktop "extra powers at the moment they become useful" projection
 * (the R21 plan's Desktop section + the lane's five discoverability
 * requirements), composed over the EXISTING proven seams — ZERO new
 * product policy:
 *
 * - OFFLINE ACQUISITION REACHABLE FROM CONTENT —
 *   {@link DesktopOfflineDiscoverySurface.makeAvailableOffline} projects
 *   the item surface's "Make available offline" affordance: the typed
 *   lifecycle view (the R14 runtime mapper's honest states), the typed
 *   actions with their SHARED user labels (the same wording the Web
 *   acquisition controls render — one vocabulary, no drift), the honest
 *   capability standing (an unbound engine block answers the typed
 *   verdict with its recovery hint — never stale "arrives later" copy),
 *   and the actionable acquire path (the composition root's recipe, the
 *   `AcquisitionRetryRecipe` precedent).
 *
 * - ACQUISITION STATE VISIBLE DURING/AFTER PLAYBACK —
 *   {@link DesktopOfflineDiscoverySurface.playerOfflineStatus} projects
 *   the player's offline truth: the honest lifecycle sentence, the
 *   measured runway truth ("can playback continue without a
 *   connection"), and the next step per state (retry, resume, or the
 *   Library path).
 *
 * - VERIFIED OFFLINE ASSETS EASY TO FIND IN LIBRARY —
 *   {@link DesktopOfflineDiscoverySurface.libraryOfflineSection} projects
 *   the Library's Offline section: the earned `Ready offline` assets
 *   (one per canonical item), the in-progress downloads, the failed ones
 *   with their recovery paths, and the CALM empty state with its next
 *   action (the design language: headline -> sentence -> one useful
 *   action — never a bare "nothing here").
 *
 * - BACKGROUND COMPLETION, UNOBTRUSIVE —
 *   {@link DesktopOfflineDiscoverySurface.backgroundCompletion} projects
 *   the compact status surface: the acquisitions working while the user
 *   is elsewhere (preparing/completing + the paused in-progress ones),
 *   each with its honest label + measured progress.
 *
 * - BYOF FILE/EXPORT FLOWS DISCOVERABLE (the R20 seam) —
 *   {@link DesktopOfflineDiscoverySurface.feedImportDiscovery} projects
 *   the import discovery: the shell's native file-dialog capability
 *   truth, the file methods it serves (official-export / user-file), the
 *   frozen matrix's entry points (Home's Bring-your-feed CTA + Settings'
 *   import entry), and the feed-mode connection (the imported mode's
 *   label + its availability truth + the import next-action when absent).
 *
 * TRUTH LAWS KEPT HERE (the lane's frozen UX law):
 * - every state's view carries a RECOVERY/next-action path;
 * - unsupported is not undiscoverable: the unbound verdicts name the
 *   honest build truth AND the next action (typed, never a dead end);
 * - the default views are PROTOCOL-FREE (the R14 leak law — the
 *   diagnostics stay behind the acquisition surface's gated projection);
 * - no stale completion copy (the J35 sweep covers every string here);
 * - the action labels are the SHARED user vocabulary (the Web acquisition
 *   controls' exact wording — one vocabulary across adapters).
 */

import type { ClientRuntime, AcquisitionStatusView, AcquisitionAction } from "@wfx/client-runtime";
import { capabilitiesForJ34Task } from "@wfx/client-runtime";
import type { ContextualEntry } from "@wfx/client-runtime";
import { FEED_MODE_LABELS } from "@wfx/client-runtime";
import type { PlatformCapabilities } from "@wfx/platform-contracts";
import type { FeedImportMethod } from "@wfx/domain";

import type { DesktopAcquisitionSurface } from "./acquisition-surface";
import type { DesktopFeedSurface } from "./feed-surface";
import type { DesktopCapabilityStanding } from "./discoverability-surface";
import { desktopAcquisitionStanding, desktopFeedStanding } from "./discoverability-surface";
import { FILE_FEED_IMPORT_METHODS } from "../platform/feed-import";
import type { DesktopFileImportCapability } from "../platform/feed-import";

// ---------------------------------------------------------------------------
// The typed action labels (the SHARED user vocabulary)
// ---------------------------------------------------------------------------

/**
 * The acquisition actions' user labels — the SAME wording the Web
 * acquisition controls render (`apps/web` `AcquisitionActions`): one
 * vocabulary across the adapters, pinned by the parity tests. The TYPED
 * action union is the runtime's frozen contract; only the label wording
 * lives at the adapters, and it must not drift.
 */
export const DESKTOP_ACQUISITION_ACTION_LABELS: Readonly<Record<AcquisitionAction["kind"], string>> = {
  acquire: "Make available offline",
  pause: "Pause download",
  resume: "Resume download — keep saved progress",
  retry: "Try again",
  restart: "Start over — discard saved progress",
  dismiss: "Dismiss",
  "play-offline": "Play offline copy",
  "reverify-offline": "Re-check the offline copy",
};

/** One typed acquisition action with its shared user label. */
export interface DesktopAcquisitionActionView {
  readonly action: AcquisitionAction;
  readonly label: string;
}

/**
 * The typed acquisition-START recipe (the composition root's wiring: the
 * authorized ingestion + session + `bindSession` flow — the
 * `AcquisitionRetryRecipe` precedent). Absent ⇒ the honest typed refusal
 * naming the unwired start (never a fake start, never a silent no-op).
 */
export type DesktopAcquireRecipe = (
  itemId: string,
) => Promise<
  | { readonly ok: true; readonly value: { readonly sessionId: string } }
  | { readonly ok: false; readonly error: { readonly code: string; readonly detail: string } }
>;

// ---------------------------------------------------------------------------
// The from-content affordance (item detail's offline decision)
// ---------------------------------------------------------------------------

/** The item surface's "Make available offline" affordance view. */
export interface DesktopOfflineAffordanceView {
  /** The canonical item the affordance addresses. */
  readonly itemId: string;
  /** The composition's honest standing (the typed unbound verdict when applicable). */
  readonly capability: DesktopCapabilityStanding;
  /** The item's acquisition lifecycle view (null when nothing is known). */
  readonly status: AcquisitionStatusView | null;
  /** The affordance's headline (the offer, or the current lifecycle label). */
  readonly headline: string;
  /** The honest detail sentence (the lifecycle truth or the unbound verdict). */
  readonly detail: string;
  /** The typed actions with their shared user labels (empty iff unbound). */
  readonly actions: readonly DesktopAcquisitionActionView[];
  /** The moment-of-use platform note (the Desktop power this state enables). */
  readonly platformNote: string;
  /** The Library next step (present from ready-offline onward). */
  readonly libraryNextStep: string | null;
}

// ---------------------------------------------------------------------------
// The during/after-playback view (the player's offline truth)
// ---------------------------------------------------------------------------

/** The player surface's offline/acquisition truth for one item. */
export interface DesktopPlayerOfflineView {
  readonly itemId: string;
  /** The item's acquisition lifecycle view (null when nothing is known). */
  readonly status: AcquisitionStatusView | null;
  /** The one-sentence headline (the honest lifecycle or source truth). */
  readonly headline: string;
  /** The honest "can playback continue without a connection" truth. */
  readonly offlinePlaybackReady: boolean;
  /**
   * The measured runway ahead (seconds; null when not applicable) — the
   * honest buffered-ahead truth, a pass-through of the lifecycle view.
   */
  readonly runwaySeconds: number | null;
  /** The next action when the state offers one (labeled, shared vocabulary). */
  readonly nextAction: DesktopAcquisitionActionView | null;
  /** The Library next step (present from ready-offline onward). */
  readonly libraryNextStep: string | null;
}

// ---------------------------------------------------------------------------
// The Library Offline section
// ---------------------------------------------------------------------------

/** The Library's Offline section view (the earned assets, front and center). */
export interface DesktopLibraryOfflineSection {
  /** The verified offline assets (the earned `Ready offline` — one per canonical item). */
  readonly readyOffline: readonly AcquisitionStatusView[];
  /** The in-progress downloads (Preparing / Buffering / Playing / Completing). */
  readonly inProgress: readonly AcquisitionStatusView[];
  /** The failed downloads with their recovery paths. */
  readonly failed: readonly AcquisitionStatusView[];
  /**
   * The calm empty state (present when there is nothing to show): a
   * headline, one honest sentence, and the next useful action — never a
   * bare "nothing here", and never a fake section.
   */
  readonly emptyState: {
    readonly headline: string;
    readonly detail: string;
    readonly actionLabel: string | null;
  } | null;
  /** The composition's honest standing (the typed unbound verdict when applicable). */
  readonly capability: DesktopCapabilityStanding;
}

// ---------------------------------------------------------------------------
// The BYOF file/import discovery (the R20 seam, at the moment of use)
// ---------------------------------------------------------------------------

/** The BYOF import discovery view (where importing is found + what it can do). */
export interface DesktopFeedImportDiscoveryView {
  /** The composition's honest standing for the feed capability. */
  readonly capability: DesktopCapabilityStanding;
  /**
   * The shell's native file-dialog capability truth (null iff the feed
   * block is unbound — no dialog question is asked then).
   */
  readonly fileImport: DesktopFileImportCapability | null;
  /** The file methods the native dialog serves (the frozen file subset). */
  readonly fileMethods: readonly FeedImportMethod[];
  /** The frozen matrix's entry points (Home's CTA + Settings' import entry). */
  readonly entryPoints: readonly ContextualEntry[];
  /** How the flow works (one honest sentence — the preview-before-commit truth). */
  readonly importPathHint: string;
  /** The imported feed-mode label (the shared vocabulary's one derivation). */
  readonly feedModeLabel: string;
  /** Whether the imported-feed mode is available right now (the runtime's truth). */
  readonly feedModeAvailable: boolean;
  /** Present when a next action exists (unsupported dialog or no import yet). */
  readonly nextAction: string | null;
}

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

/** Options for {@link createOfflineDiscoverySurface}. */
export interface DesktopOfflineDiscoveryOptions {
  /** The shared client runtime (the acquisition store's views are the truth source). */
  readonly runtime: ClientRuntime;
  /** The truthful Desktop capability bundle (the platform-truth source). */
  readonly capabilities: PlatformCapabilities;
  /** The R14 acquisition surface (bound flag + the lifecycle views + retry/restart). */
  readonly acquisition: DesktopAcquisitionSurface;
  /** The R20-G feed surface (the import capability + the feed-mode reads). */
  readonly feed: DesktopFeedSurface;
  /**
   * The typed acquisition-START recipe (the composition root's wiring —
   * the authorized ingestion + session + bind flow). OPTIONAL (the R14
   * retry-recipe precedent): absent ⇒ `executeAcquire` answers the honest
   * typed refusal; present ⇒ the from-content affordance is actionable
   * end-to-end.
   */
  readonly acquire?: DesktopAcquireRecipe;
}

/** The Desktop offline/feed discovery surface (the R21-H projection). */
export interface DesktopOfflineDiscoverySurface {
  /** The from-content affordance: item detail's "Make available offline" decision. */
  makeAvailableOffline(itemId: string): DesktopOfflineAffordanceView;
  /**
   * Execute the ACQUIRE action through the composition root's recipe (the
   * typed verdicts: no engine block / no start recipe / the recipe's own
   * failure — never a fabricated start).
   */
  executeAcquire(itemId: string): Promise<
    | { readonly ok: true; readonly value: { readonly sessionId: string } }
    | { readonly ok: false; readonly code: "unbound" | "not-wired" | "recipe-failed"; readonly detail: string }
  >;
  /** The during/after-playback offline truth for one item. */
  playerOfflineStatus(itemId: string): DesktopPlayerOfflineView;
  /** The Library's Offline section. */
  libraryOfflineSection(): DesktopLibraryOfflineSection;
  /** The unobtrusive background-completion status (preparing/completing/paused work). */
  backgroundCompletion(): readonly AcquisitionStatusView[];
  /** The BYOF file/import discovery (async — the shell's dialog capability query). */
  feedImportDiscovery(): Promise<DesktopFeedImportDiscoveryView>;
}

// ---------------------------------------------------------------------------
// The pure per-state derivations
// ---------------------------------------------------------------------------

/** The moment-of-use platform note (the Desktop power the current state enables). */
function platformNoteFor(status: AcquisitionStatusView | null): string {
  if (status === null) {
    return "Downloads run through this app's native engine and keep finishing while you watch something else.";
  }
  switch (status.state) {
    case "available":
      return "The download runs in the background — you can keep watching, and it finishes on its own.";
    case "preparing":
    case "buffering":
      return "Playback can start before the download finishes — WebFlix gets just enough ready first.";
    case "playing":
      return "You are watching while the rest downloads — the finished copy lands in Library, under Offline.";
    case "completing":
      return "The last pieces finish in the background — no need to keep this page open.";
    case "ready-offline":
      return "Watch it any time without a connection — from here or from Library, under Offline.";
    case "failed":
      return status.failure?.recoverable === true
        ? "Retrying keeps what already downloaded — only the missing parts are fetched again."
        : "This download cannot continue — the honest reason is stated above.";
  }
}

/** The Library next step (present from ready-offline onward). */
function libraryNextStepFor(status: AcquisitionStatusView | null): string | null {
  if (status !== null && status.state === "ready-offline") {
    return "Find it any time in Library, under Offline.";
  }
  if (status !== null && (status.state === "completing" || status.state === "playing")) {
    return "When it finishes, it appears in Library, under Offline.";
  }
  return null;
}

/**
 * The frozen matrix's `following-byof` contextual entries — the entry
 * points where the user finds the import (Home's Bring-your-feed CTA +
 * Settings' import entry). The SAME entries the discoverability surface
 * projects (never a forked set): read once from the frozen matrix
 * through the runtime's public surface.
 */
const FOLLOWING_BYOF_ENTRY_POINTS: readonly ContextualEntry[] = (() => {
  const row = capabilitiesForJ34Task("bring-own-feed").find(
    (candidate) => candidate.capability === "following-byof",
  );
  return row?.contextualEntries ?? [];
})();

// ---------------------------------------------------------------------------
// The copy sweep (the J35 + protocol-free laws over this surface's strings)
// ---------------------------------------------------------------------------

/**
 * Gather every user-facing copy string this surface can project (the J35
 * stale-copy sweep + the R14 protocol-leak sweep primitives; tests assert
 * every string passes `isStaleCompletionCopy` and every default-view
 * string passes the `containsAcquisitionProtocolTerminology` guard).
 */
export function offlineDiscoveryCopyStrings(
  surface: DesktopOfflineDiscoverySurface,
): readonly string[] {
  const strings: string[] = [];
  const section = surface.libraryOfflineSection();
  for (const view of [...section.readyOffline, ...section.inProgress, ...section.failed]) {
    strings.push(view.label, view.detail);
  }
  if (section.emptyState !== null) {
    strings.push(section.emptyState.headline, section.emptyState.detail);
    if (section.emptyState.actionLabel !== null) strings.push(section.emptyState.actionLabel);
  }
  for (const view of surface.backgroundCompletion()) {
    strings.push(view.label, view.detail);
  }
  for (const label of Object.values(DESKTOP_ACQUISITION_ACTION_LABELS)) {
    strings.push(label);
  }
  return strings;
}

// ---------------------------------------------------------------------------
// The binding
// ---------------------------------------------------------------------------

/**
 * Project the Desktop offline/feed discovery surface over the booted
 * runtime + the bound platform surfaces. Pure projection: the lifecycle
 * truths are the runtime's acquisition views; the labels are the shared
 * vocabulary; the standings derive from the bound flags (never guessed).
 */
export function createOfflineDiscoverySurface(
  options: DesktopOfflineDiscoveryOptions,
): DesktopOfflineDiscoverySurface {
  const { runtime, acquisition, feed, acquire } = options;

  const actionsOf = (status: AcquisitionStatusView | null): readonly DesktopAcquisitionActionView[] =>
    status === null
      ? []
      : status.actions.map((action) => ({
          action,
          label: DESKTOP_ACQUISITION_ACTION_LABELS[action.kind],
        }));

  return {
    makeAvailableOffline(itemId: string): DesktopOfflineAffordanceView {
      const capability = desktopAcquisitionStanding(acquisition);
      const status = acquisition.acquisitionView(itemId);
      if (capability.kind === "unbound") {
        // The honest unbound affordance: the offer is VISIBLE (the
        // capability is discoverable) with the typed build truth + the
        // recovery hint — never stale "arrives later" copy, never a dead end.
        return {
          itemId,
          capability,
          status: null,
          headline: "Make available offline",
          detail: capability.detail,
          actions: [],
          platformNote:
            "Offline downloads are this app's native capability — the Web app points Desktop-ward for it.",
          libraryNextStep: null,
        };
      }
      const headline =
        status === null || status.state === "available"
          ? DESKTOP_ACQUISITION_ACTION_LABELS.acquire
          : status.label;
      const detail =
        status === null
          ? "Download this title through the native engine and watch it without a connection."
          : status.detail;
      // The runtime mapper's own law (mapAcquisitionStatus precedence 5):
      // "NOTHING → available" with the acquire action. A null view (no
      // facts reported yet) carries the SAME typed offer — the affordance
      // is never empty on a bound engine.
      const actions =
        status === null
          ? [{ action: { kind: "acquire" } as AcquisitionAction, label: DESKTOP_ACQUISITION_ACTION_LABELS.acquire }]
          : actionsOf(status);
      return {
        itemId,
        capability,
        status,
        headline,
        detail,
        actions,
        platformNote: platformNoteFor(status),
        libraryNextStep: libraryNextStepFor(status),
      };
    },

    async executeAcquire(itemId: string) {
      if (!acquisition.bound) {
        return {
          ok: false,
          code: "unbound" as const,
          detail:
            "the native download engine is not bound in this build, so an offline download cannot start here",
        };
      }
      if (acquire === undefined) {
        return {
          ok: false,
          code: "not-wired" as const,
          detail:
            "the acquisition start is not wired in this composition — the download engine is bound, but no start recipe was provided at composition (the composition root's integration wiring)",
        };
      }
      const result = await acquire(itemId);
      if (!result.ok) {
        return { ok: false, code: "recipe-failed" as const, detail: result.error.detail };
      }
      return { ok: true, value: { sessionId: result.value.sessionId } };
    },

    playerOfflineStatus(itemId: string): DesktopPlayerOfflineView {
      const status = acquisition.acquisitionView(itemId);
      const headline =
        status === null
          ? "Playing through the current source — nothing is being downloaded."
          : `${status.label} — ${status.detail}`;
      const offlinePlaybackReady =
        status !== null && (status.state === "ready-offline" || (status.runwaySeconds ?? 0) > 0);
      const retryAction =
        status !== null && status.state === "failed"
          ? (status.actions.find((action) => action.kind === "retry" || action.kind === "resume") ?? null)
          : null;
      return {
        itemId,
        status,
        headline,
        offlinePlaybackReady,
        runwaySeconds: status?.runwaySeconds ?? null,
        nextAction:
          retryAction !== null
            ? { action: retryAction, label: DESKTOP_ACQUISITION_ACTION_LABELS[retryAction.kind] }
            : null,
        libraryNextStep: libraryNextStepFor(status),
      };
    },

    libraryOfflineSection(): DesktopLibraryOfflineSection {
      const capability = desktopAcquisitionStanding(acquisition);
      const views = acquisition.acquisitionViews();
      const readyOffline = views.filter((view) => view.state === "ready-offline");
      const inProgress = views.filter(
        (view) =>
          view.state === "preparing" ||
          view.state === "buffering" ||
          view.state === "playing" ||
          view.state === "completing",
      );
      const failed = views.filter((view) => view.state === "failed");
      const empty = readyOffline.length === 0 && inProgress.length === 0 && failed.length === 0;
      let emptyState: DesktopLibraryOfflineSection["emptyState"] = null;
      if (empty && capability.kind === "unbound") {
        emptyState = {
          headline: "Downloads are not wired in this build",
          detail: capability.detail,
          actionLabel: null,
        };
      } else if (empty) {
        emptyState = {
          headline: "Nothing here yet",
          detail:
            "Titles you make available offline appear here — verified, and ready to watch without a connection.",
          actionLabel: "Open any title and choose Make available offline",
        };
      }
      return { readyOffline, inProgress, failed, emptyState, capability };
    },

    backgroundCompletion(): readonly AcquisitionStatusView[] {
      // The unobtrusive surface: the work that continues while the user is
      // elsewhere — preparing/completing downloads and the paused
      // in-progress ones. Terminal states (ready-offline/failed/available)
      // and actively-playing items are NOT background work.
      return acquisition
        .acquisitionViews()
        .filter(
          (view) =>
            view.state === "preparing" ||
            view.state === "completing" ||
            ((view.state === "buffering" || view.state === "playing") && view.paused),
        );
    },

    async feedImportDiscovery(): Promise<DesktopFeedImportDiscoveryView> {
      const capability = desktopFeedStanding(feed);
      if (capability.kind === "unbound") {
        return {
          capability,
          fileImport: null,
          fileMethods: [],
          entryPoints: FOLLOWING_BYOF_ENTRY_POINTS,
          importPathHint:
            "Bring your feed imports your existing subscriptions in their own order — nothing changes until you confirm the preview.",
          feedModeLabel: FEED_MODE_LABELS.byof,
          feedModeAvailable: runtime.feedMode.availability().byof,
          nextAction: capability.recoveryHint,
        };
      }
      const fileImport = await feed.fileImportCapability();
      const supported = fileImport.supported;
      const byofAvailable = runtime.feedMode.availability().byof;
      let nextAction: string | null = null;
      if (!supported) {
        nextAction =
          "This device has no file dialog — import through the service's import flow instead (Settings, under Feeds).";
      } else if (!byofAvailable) {
        nextAction =
          "Bring your feed to light this mode up — pick an export file from a supported source.";
      }
      return {
        capability,
        fileImport,
        fileMethods: supported ? [...FILE_FEED_IMPORT_METHODS] : [],
        entryPoints: FOLLOWING_BYOF_ENTRY_POINTS,
        importPathHint:
          "Pick an export file from a supported source — WebFlix shows a preview before anything is imported, and the source's own order is kept.",
        feedModeLabel: FEED_MODE_LABELS.byof,
        feedModeAvailable: byofAvailable,
        nextAction,
      };
    },
  };
}
