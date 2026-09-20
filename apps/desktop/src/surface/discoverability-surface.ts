/**
 * @wfx/app-desktop — the Desktop discoverability surface (R21-G).
 *
 * THE Desktop binding of Worker 1's FROZEN R21-A seam
 * (`@wfx/client-runtime` `discoverability.ts` — the typed capability
 * discovery matrix + the shared control contracts, lead-ratified) and the
 * R21-C shared control view derivations (`control-views.ts`):
 *
 * - every accepted capability is DISCOVERABLE on the Desktop surface with
 *   its normal entry point, its contextual moments, its Settings
 *   management area, and its RECOVERY path — projected VERBATIM from the
 *   frozen matrix (the adapter never forks the shared semantics);
 * - the platform differences are the matrix's TYPED platform-truth notes
 *   ONLY (Desktop carries native playback, offline acquisition, local
 *   models, and file imports; the note names what the Web side renders
 *   instead) — a divergence WITHOUT a note is a parity defect, and
 *   {@link desktopCapabilityParityIssues} machine-checks the projection
 *   against the frozen matrix;
 * - the shared controls bind 1:1 to the runtime's own stores — the
 *   feed-mode control over `runtime.feedMode` (the R21-A presentation
 *   state), the Personalize control over `runtime.intents` (the R05
 *   semantics), the Where-to-watch view over the Desktop capability bundle
 *   (the R09 frozen precedence), and the AI action tray over
 *   `runtime.modelControls` (the R06 policy truth) — ZERO product policy
 *   lives here (the frozen layering law);
 * - NO STALE COMPLETION COPY: every string this surface can project is
 *   sweepable through `isStaleCompletionCopy` (the J35 law —
 *   {@link discoverabilityCopyStrings} gathers them for the tests and the
 *   lead's evidence);
 * - NO SECOND NAVIGATION SYSTEM: the projected surface references stay
 *   inside the frozen primary navigation vocabulary plus the two content
 *   surfaces (`item`, `player`) — the matrix's own closed set, re-verified
 *   by the parity check.
 *
 * WHAT THIS MODULE IS NOT: a navigation system, a dashboard, or a
 * platform-policy owner. It PROJECTS the frozen matrix + the shared
 * derivations with the Desktop composition's honest binding truths. The
 * `standing` of a capability (usable vs honestly unbound) is derived from
 * the REAL bound surfaces (the acquisition block's `bound` flag, the feed
 * block's `bound` flag) — never guessed, never a fixture fallback.
 */

import type { ClientRuntime } from "@wfx/client-runtime";
import type { PlatformCapabilities } from "@wfx/platform-contracts";
import {
  CAPABILITY_SURFACE_MATRIX,
  DISCOVERABLE_CAPABILITY_IDS,
  FEED_MODE_LABELS,
  isDiscoverableCapabilityId,
  isProductSurfaceId,
  isStaleCompletionCopy,
  capabilitiesForJ34Task,
  type ContextualEntry,
  type DiscoverableCapabilityId,
  type J34TaskId,
  type ManagementRef,
  type RecoveryPath,
  type SurfaceControlRef,
} from "@wfx/client-runtime";
import type { ModelTask, PlaybackMode } from "@wfx/domain";
import {
  feedModeChoiceView,
  personalizeControlView,
  realizationChoiceView,
  type FeedModeChoiceView,
  type PersonalizeControlView,
  type RealizationChoiceView,
} from "@wfx/client-runtime";
import type { FeedModeSetResult, FeedModeAvailability } from "@wfx/client-runtime";
import type { FeedMode } from "@wfx/client-runtime";
import type { ModelSectionStatus } from "@wfx/client-runtime";

import type { DesktopAcquisitionSurface } from "./acquisition-surface";
import type { DesktopFeedSurface } from "./feed-surface";

// ---------------------------------------------------------------------------
// The standing truth (the composition's honest capability verdict)
// ---------------------------------------------------------------------------

/**
 * How one capability stands on THIS Desktop composition. The shared
 * SEMANTICS never change — only the honest binding truth does (a
 * composition that did not bind the acquisition/feed block answers the
 * typed unbound verdict with its recovery hint, never a fake usable
 * state and never a dead "not available").
 */
export type DesktopCapabilityStanding =
  | { readonly kind: "usable" }
  | {
      readonly kind: "unbound";
      /** Which platform block this composition did not bind. */
      readonly block: "native-acquisition" | "byof-feed";
      /** The honest composition truth (plain language, never stale copy). */
      readonly detail: string;
      /** The recovery hint — the next action the surface offers. */
      readonly recoveryHint: string;
    };

/** The honest unbound verdict copy (the acquisition-surface precedent's wording law). */
const UNBOUND_ACQUISITION_DETAIL =
  "the native download engine is not bound in this build, so offline downloads cannot start here";
const UNBOUND_ACQUISITION_RECOVERY =
  "Watching and browsing work normally — this build's composition did not wire the download engine.";
const UNBOUND_FEED_DETAIL =
  "the feed import block is not bound in this build, so bringing your own feed is unavailable here";
const UNBOUND_FEED_RECOVERY =
  "For you, search, and your library work normally — the import wiring is absent in this composition.";

// ---------------------------------------------------------------------------
// The projected matrix rows (shared semantics + the Desktop truths)
// ---------------------------------------------------------------------------

/** The platform-truth projection of one matrix row (the typed difference). */
export interface DesktopPlatformTruthProjection {
  /** Whether the Desktop platform carries the extra capability truth. */
  readonly desktopCarries: boolean;
  /** The honest divergence reason (the matrix note's reason, verbatim). */
  readonly difference: string | null;
  /** What the OTHER platform renders (the matrix note's next step, verbatim). */
  readonly otherPlatformNextStep: string | null;
}

/** One capability row projected for the Desktop surface. */
export interface DesktopCapabilityView {
  /** The capability's stable id (the frozen matrix key). */
  readonly capability: DiscoverableCapabilityId;
  /** The user-facing product label (the matrix's, verbatim). */
  readonly productLabel: string;
  /** The PRIMARY discovery surface + control (the matrix's, verbatim). */
  readonly primaryDiscovery: SurfaceControlRef;
  /** The contextual entries (the matrix's, verbatim — non-empty by law). */
  readonly contextualEntries: readonly ContextualEntry[];
  /** The Settings management destination (the matrix's, verbatim). */
  readonly management: ManagementRef;
  /** The recovery / next-action path (the matrix's, verbatim). */
  readonly recovery: RecoveryPath;
  /** The J34 task this row's discoverability satisfies (the matrix's binding). */
  readonly j34Task: J34TaskId | null;
  /** The typed platform difference (the matrix note, projected). */
  readonly platformTruth: DesktopPlatformTruthProjection;
  /** The composition's honest standing (usable, or the typed unbound verdict). */
  readonly standing: DesktopCapabilityStanding;
}

/** One J34 discovery task bound to the Desktop surfaces that satisfy it. */
export interface DesktopJ34TaskView {
  /** The J34 task id (the frozen 12-task vocabulary). */
  readonly task: J34TaskId;
  /** The matrix rows whose discoverability satisfies this task. */
  readonly rows: readonly DesktopCapabilityView[];
}

/** One typed Web-vs-Desktop platform difference (the parity truth, Desktop side). */
export interface DesktopPlatformDifferenceView {
  /** The capability that honestly differs across platforms. */
  readonly capability: DiscoverableCapabilityId;
  /** The user-facing product label (the matrix's, verbatim). */
  readonly productLabel: string;
  /** The capability-truth reason (the matrix note's reason, verbatim). */
  readonly reason: string;
  /** What the Web platform renders instead (the matrix note's next step, verbatim). */
  readonly webNextStep: string;
  /** This Desktop composition's standing for the capability. */
  readonly standing: DesktopCapabilityStanding;
}

// ---------------------------------------------------------------------------
// The AI action tray (the matrix's model-policy / ai-transformations binding)
// ---------------------------------------------------------------------------

/**
 * One AI action the tray offers (the matrix's "AI media actions (subtitles,
 * translate, transcribe, dub, commentary)" vocabulary, bound to the frozen
 * `ModelTask` union each action runs).
 */
export interface DesktopAiActionSpec {
  /** The transform kind (the R06 `submitTransform` vocabulary). */
  readonly kind: string;
  /** The control's user label. */
  readonly label: string;
  /** The frozen model task this action runs. */
  readonly task: ModelTask;
  /** The one-sentence explanation (what the action does). */
  readonly detail: string;
}

/**
 * The Desktop AI action tray's frozen action vocabulary. The SAME actions
 * the Web tray offers (the matrix's ai-transformations row); the labels are
 * the shared user vocabulary, and the model-class truth per action derives
 * from the runtime's model-controls store (never fabricated here).
 */
export const DESKTOP_AI_ACTIONS: readonly DesktopAiActionSpec[] = [
  {
    kind: "subtitles",
    label: "Generate subtitles",
    task: "transcription",
    detail: "Read what is being said as subtitles on this title.",
  },
  {
    kind: "translate",
    label: "Translate subtitles",
    task: "translation",
    detail: "Translate this title's subtitles into your language.",
  },
  {
    kind: "transcribe",
    label: "Transcribe audio",
    task: "transcription",
    detail: "Turn the audio into a text transcript you can read or export.",
  },
  {
    kind: "dub",
    label: "Dub in another language",
    task: "dubbing",
    detail: "Listen to this title voiced in another language.",
  },
  {
    kind: "commentary",
    label: "AI commentary",
    task: "commentary",
    detail: "Play an AI commentary track alongside this title.",
  },
];

/** The frozen model tasks the tray refreshes (the distinct task set). */
export const AI_TRAY_TASKS: readonly ModelTask[] = [
  "transcription",
  "translation",
  "dubbing",
  "commentary",
];

/** One AI action projected with its honest model-class truth. */
export interface DesktopAiActionView {
  readonly kind: string;
  readonly label: string;
  readonly task: ModelTask;
  readonly detail: string;
  /**
   * Whether a model policy is set for the action's task (the R06 honest
   * null: an unset policy is `null`, never a fabricated default).
   */
  readonly configured: boolean;
  /**
   * Which model class will run (plain language): the chosen provider with
   * its local/cloud truth, or the honest "no model chosen yet".
   */
  readonly modelClassLabel: string;
  /** The chosen provider's local/cloud truth (from the registry, when known). */
  readonly providerPrivacy: "local" | "cloud" | null;
  /** Present iff unconfigured: the recovery next action. */
  readonly recoveryHint: string | null;
}

/** The AI action tray view (item + player surfaces' shared control). */
export interface DesktopAiActionTrayView {
  /** The tray's actions with their honest model-class truths. */
  readonly actions: readonly DesktopAiActionView[];
  /** The provider registry's honest status (the in-model degradation law). */
  readonly providersStatus: ModelSectionStatus;
  /** The management path (the matrix's model-policy management area). */
  readonly managementHint: string;
  /**
   * The platform truth for local models (the matrix's model-policy note,
   * verbatim reason — Desktop carries local-model execution; the Web side
   * renders the note's next step).
   */
  readonly localModelPlatformNote: string;
}

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

/** Options for {@link createDesktopDiscoverabilitySurface}. */
export interface DesktopDiscoverabilityOptions {
  /** The shared client runtime (the product-semantics owner). */
  readonly runtime: ClientRuntime;
  /** The truthful Desktop capability bundle (the platform-truth source). */
  readonly capabilities: PlatformCapabilities;
  /** The R14 acquisition surface (its `bound` flag is the standing truth). */
  readonly acquisition: DesktopAcquisitionSurface;
  /** The R20-G feed surface (its `bound` flag is the standing truth). */
  readonly feed: DesktopFeedSurface;
}

/** The Desktop discoverability surface (the R21-G projection). */
export interface DesktopDiscoverabilitySurface {
  /** Every capability row projected for Desktop (the frozen matrix order). */
  capabilityViews(): readonly DesktopCapabilityView[];
  /** One capability's projection (typed throw for an unknown id). */
  capabilityView(id: DiscoverableCapabilityId): DesktopCapabilityView;
  /** The J34 sweep: every task bound to the Desktop rows that satisfy it. */
  j34TaskViews(): readonly DesktopJ34TaskView[];
  /** The typed Web-vs-Desktop differences (every matrix row that carries a note). */
  platformDifferenceViews(): readonly DesktopPlatformDifferenceView[];
  /** The feed-mode control view (the shared R21-C derivation). */
  feedModeControl(): FeedModeChoiceView;
  /** Select a feed mode (the typed refusal carries its recovery hint). */
  setFeedMode(mode: FeedMode): FeedModeSetResult;
  /** Report fresh feed-mode availability truth (the adapter's data truth). */
  reportFeedModeAvailability(availability: FeedModeAvailability): void;
  /**
   * Derive + report the feed-mode availability truth from the bound feed
   * surface's real reads (the host-owned cadence call — no hidden timers).
   * An unbound feed block answers the honest "nothing imported / no
   * follows known" truth (both false) with the import next-action carried
   * by the control's own unavailable options.
   */
  refreshFeedModeAvailability(profileId: string): Promise<FeedModeAvailability>;
  /** The Personalize control view (the shared R21-C derivation). */
  personalizeControl(): PersonalizeControlView;
  /** The Where-to-watch view over the Desktop capability bundle (native usable). */
  realizationChoice(input: {
    readonly realizations: readonly { readonly mode: PlaybackMode; readonly connectorId: string }[];
    readonly active: { readonly mode: PlaybackMode; readonly connectorId: string } | null;
  }): RealizationChoiceView;
  /** The AI action tray's cache view (the last observed model-controls truth). */
  aiActionTray(): DesktopAiActionTrayView;
  /** Refresh the model-controls truth behind the tray, then answer the view. */
  refreshAiActionTray(): Promise<DesktopAiActionTrayView>;
}

// ---------------------------------------------------------------------------
// The pure derivations (parity laws + copy gathering)
// ---------------------------------------------------------------------------

/**
 * THE PARITY LAW (machine-checkable): verify a projection keeps the frozen
 * matrix's shared semantics VERBATIM — every row exactly once, the shared
 * fields identical, every referenced surface inside the frozen product
 * vocabulary, and the standing coherent (an unbound standing only for the
 * capabilities whose platform blocks this composition binds optionally).
 * Answers the issue list (EMPTY = parity held) — the tests and the lead's
 * J31/J34 evidence consume this.
 */
export function desktopCapabilityParityIssues(
  views: readonly DesktopCapabilityView[],
): readonly string[] {
  const issues: string[] = [];
  if (views.length !== CAPABILITY_SURFACE_MATRIX.length) {
    issues.push(
      `row count: projected ${views.length} rows, the frozen matrix carries ${CAPABILITY_SURFACE_MATRIX.length}`,
    );
  }
  for (const row of CAPABILITY_SURFACE_MATRIX) {
    const view = views.find((candidate) => candidate.capability === row.capability);
    if (view === undefined) {
      issues.push(`missing row: ${row.capability}`);
      continue;
    }
    if (view.productLabel !== row.productLabel) {
      issues.push(`${row.capability}: productLabel drifted from the frozen matrix`);
    }
    if (
      view.primaryDiscovery.surface !== row.primaryDiscovery.surface ||
      view.primaryDiscovery.control !== row.primaryDiscovery.control
    ) {
      issues.push(`${row.capability}: primaryDiscovery drifted from the frozen matrix`);
    }
    if (view.contextualEntries.length !== row.contextualEntries.length) {
      issues.push(`${row.capability}: contextualEntries count drifted`);
    } else {
      for (let index = 0; index < row.contextualEntries.length; index += 1) {
        const projected = view.contextualEntries[index];
        const frozen = row.contextualEntries[index];
        if (
          projected === undefined ||
          frozen === undefined ||
          projected.surface !== frozen.surface ||
          projected.control !== frozen.control ||
          projected.moment !== frozen.moment
        ) {
          issues.push(`${row.capability}: contextualEntries[${index}] drifted`);
        }
      }
    }
    if (
      view.management.surface !== row.management.surface ||
      view.management.area !== row.management.area
    ) {
      issues.push(`${row.capability}: management drifted from the frozen matrix`);
    }
    if (
      view.recovery.state !== row.recovery.state ||
      view.recovery.action !== row.recovery.action ||
      view.recovery.detail !== row.recovery.detail
    ) {
      issues.push(`${row.capability}: recovery drifted from the frozen matrix`);
    }
    if (view.j34Task !== row.j34Task) {
      issues.push(`${row.capability}: j34Task binding drifted from the frozen matrix`);
    }
    if (view.platformTruth.desktopCarries !== (row.platformTruth?.platform === "desktop")) {
      issues.push(`${row.capability}: platformTruth.desktopCarries drifted from the matrix note`);
    }
    if (view.platformTruth.difference !== (row.platformTruth?.reason ?? null)) {
      issues.push(`${row.capability}: platformTruth.difference drifted from the matrix note`);
    }
    if (view.platformTruth.otherPlatformNextStep !== (row.platformTruth?.nextStep ?? null)) {
      issues.push(
        `${row.capability}: platformTruth.otherPlatformNextStep drifted from the matrix note`,
      );
    }
    if (view.standing.kind === "unbound" && !STANDING_CAPABLE_OF_UNBOUND.has(row.capability)) {
      issues.push(
        `${row.capability}: an unbound standing is incoherent (this capability has no optionally-bound platform block)`,
      );
    }
  }
  for (const view of views) {
    if (!isDiscoverableCapabilityId(view.capability)) {
      issues.push(`unknown capability id in the projection: ${String(view.capability)}`);
    }
    for (const ref of [view.primaryDiscovery, ...view.contextualEntries.map((entry) => entry)]) {
      if (!isProductSurfaceId(ref.surface)) {
        issues.push(`${view.capability}: surface '${String(ref.surface)}' is outside the frozen product vocabulary`);
      }
    }
  }
  return issues;
}

/**
 * The capabilities whose standing HONESTLY depends on an optionally-bound
 * platform block (the R10/R14/R20 seam precedent) — every other capability
 * is shared-semantics server state and is always usable when booted.
 */
const STANDING_CAPABLE_OF_UNBOUND: ReadonlySet<DiscoverableCapabilityId> = new Set([
  "native-offline",
  "acquisition-recovery",
  "following-byof",
]);

/**
 * Gather EVERY user-facing copy string the surface can project (the J35
 * sweep primitive): the matrix-derived labels/controls/moments/recovery
 * paths, the platform-difference sentences, the standing verdicts, and the
 * AI tray vocabulary. Tests (and the lead's evidence) assert none of these
 * carries stale completion wording (`isStaleCompletionCopy`).
 */
export function discoverabilityCopyStrings(
  surface: DesktopDiscoverabilitySurface,
): readonly string[] {
  const strings: string[] = [];
  for (const view of surface.capabilityViews()) {
    strings.push(view.productLabel);
    strings.push(view.primaryDiscovery.control);
    for (const entry of view.contextualEntries) {
      strings.push(entry.control);
      strings.push(entry.moment);
    }
    strings.push(view.recovery.state, view.recovery.action, view.recovery.detail);
    if (view.platformTruth.difference !== null) strings.push(view.platformTruth.difference);
    if (view.platformTruth.otherPlatformNextStep !== null) {
      strings.push(view.platformTruth.otherPlatformNextStep);
    }
    if (view.standing.kind === "unbound") {
      strings.push(view.standing.detail, view.standing.recoveryHint);
    }
  }
  const tray = surface.aiActionTray();
  for (const action of tray.actions) {
    strings.push(action.label, action.detail, action.modelClassLabel);
    if (action.recoveryHint !== null) strings.push(action.recoveryHint);
  }
  strings.push(tray.managementHint, tray.localModelPlatformNote);
  const feedControl = surface.feedModeControl();
  for (const option of feedControl.options) {
    strings.push(option.label);
    if (!option.available) {
      if (option.unavailableDetail !== undefined) strings.push(option.unavailableDetail);
      if (option.recoveryHint !== undefined) strings.push(option.recoveryHint);
    }
  }
  return strings;
}

// ---------------------------------------------------------------------------
// The standing derivations (shared with the R21-H offline/feed discovery)
// ---------------------------------------------------------------------------

/**
 * The honest standing of the native-acquisition capabilities for THIS
 * composition (usable iff the acquisition block is bound — never guessed).
 * Shared with the R21-H offline-discovery surface (one derivation source).
 */
export function desktopAcquisitionStanding(
  acquisition: DesktopAcquisitionSurface,
): DesktopCapabilityStanding {
  return acquisition.bound
    ? { kind: "usable" }
    : {
        kind: "unbound",
        block: "native-acquisition",
        detail: UNBOUND_ACQUISITION_DETAIL,
        recoveryHint: UNBOUND_ACQUISITION_RECOVERY,
      };
}

/**
 * The honest standing of the BYOF feed capability for THIS composition
 * (usable iff the feed block is bound). One derivation source.
 */
export function desktopFeedStanding(feed: DesktopFeedSurface): DesktopCapabilityStanding {
  return feed.bound
    ? { kind: "usable" }
    : {
        kind: "unbound",
        block: "byof-feed",
        detail: UNBOUND_FEED_DETAIL,
        recoveryHint: UNBOUND_FEED_RECOVERY,
      };
}

// ---------------------------------------------------------------------------
// The binding
// ---------------------------------------------------------------------------

/** The composition's standing derivation (pure — the bound flags are the truth). */
function standingFor(
  capability: DiscoverableCapabilityId,
  acquisition: DesktopAcquisitionSurface,
  feed: DesktopFeedSurface,
): DesktopCapabilityStanding {
  if (capability === "native-offline" || capability === "acquisition-recovery") {
    return desktopAcquisitionStanding(acquisition);
  }
  if (capability === "following-byof") {
    return desktopFeedStanding(feed);
  }
  return { kind: "usable" };
}

/** The model-class sentence for one AI action (pure — from the store's truth). */
function aiActionModelClass(
  runtime: ClientRuntime,
  spec: DesktopAiActionSpec,
): DesktopAiActionView {
  const policyModel = runtime.modelControls.policy(spec.task);
  const providersModel = runtime.modelControls.providers();
  const policy = policyModel.policy;
  if (policy === null) {
    return {
      kind: spec.kind,
      label: spec.label,
      task: spec.task,
      detail: spec.detail,
      configured: false,
      modelClassLabel: "no model chosen yet",
      providerPrivacy: null,
      recoveryHint: "Choose a model for this action in Settings, under Model & AI.",
    };
  }
  const preferred =
    policy.preferredProvider ??
    (policy.fallbackProviders.length > 0 ? policy.fallbackProviders[0] : undefined);
  const providerRow =
    preferred !== undefined
      ? providersModel.providers.find((provider) => provider.id === preferred)
      : undefined;
  const privacy = providerRow?.privacy ?? null;
  const modelClassLabel =
    preferred !== undefined && privacy === "local"
      ? `runs on your chosen model (${preferred}) — on this device`
      : preferred !== undefined && privacy === "cloud"
        ? `runs on your chosen model (${preferred})`
        : preferred !== undefined
          ? `runs on your chosen model (${preferred})`
          : "runs on the service's default model";
  return {
    kind: spec.kind,
    label: spec.label,
    task: spec.task,
    detail: spec.detail,
    configured: true,
    modelClassLabel,
    providerPrivacy: privacy,
    recoveryHint: null,
  };
}

/** The tray view over the store's CURRENT truth (pure). */
function aiActionTrayView(runtime: ClientRuntime): DesktopAiActionTrayView {
  return {
    actions: DESKTOP_AI_ACTIONS.map((spec) => aiActionModelClass(runtime, spec)),
    providersStatus: runtime.modelControls.providers().status,
    managementHint: "Manage models, bring-your-own keys, and local models in Settings, under Model & AI.",
    localModelPlatformNote:
      "Local-model execution runs on this Desktop app; the Web app serves the same actions through its service providers.",
  };
}

/**
 * Project the Desktop discoverability surface over the booted runtime, the
 * truthful capability bundle, and the bound platform surfaces. Pure
 * projection: every control delegates to the runtime's own stores; the
 * standing verdicts derive from the bound flags (never guessed).
 */
export function createDesktopDiscoverabilitySurface(
  options: DesktopDiscoverabilityOptions,
): DesktopDiscoverabilitySurface {
  const { runtime, capabilities, acquisition, feed } = options;

  const views: readonly DesktopCapabilityView[] = CAPABILITY_SURFACE_MATRIX.map((row) => ({
    capability: row.capability,
    productLabel: row.productLabel,
    primaryDiscovery: row.primaryDiscovery,
    contextualEntries: row.contextualEntries,
    management: row.management,
    recovery: row.recovery,
    j34Task: row.j34Task,
    platformTruth: {
      desktopCarries: row.platformTruth?.platform === "desktop",
      difference: row.platformTruth?.reason ?? null,
      otherPlatformNextStep: row.platformTruth?.nextStep ?? null,
    },
    standing: standingFor(row.capability, acquisition, feed),
  }));

  const byCapability = new Map(views.map((view) => [view.capability, view]));

  // The frozen matrix's platform-truth rows, projected with the standing.
  const platformDifferences: readonly DesktopPlatformDifferenceView[] = CAPABILITY_SURFACE_MATRIX
    .filter((row) => row.platformTruth !== null)
    .map((row) => {
      const view = byCapability.get(row.capability);
      if (view === undefined) {
        throw new Error(`discoverability: no projected row for ${row.capability}`);
      }
      return {
        capability: row.capability,
        productLabel: row.productLabel,
        reason: row.platformTruth?.reason ?? "",
        webNextStep: row.platformTruth?.nextStep ?? "",
        standing: view.standing,
      };
    });

  // The J34 sweep: every task bound to its satisfying rows (the frozen
  // matrix's own binding — the adapter re-projects it with the standing).
  const j34Tasks: readonly DesktopJ34TaskView[] = (
    [
      "identity-profile",
      "connect-source",
      "bring-own-feed",
      "feed-mode-choice",
      "temporary-intent",
      "attention-mode",
      "recommendation-feedback",
      "model-controls",
      "ai-action-launch",
      "playback-realization",
      "desktop-offline-path",
      "library-sections",
    ] as const
  ).map((task) => ({
    task,
    rows: capabilitiesForJ34Task(task)
      .map((row) => byCapability.get(row.capability))
      .filter((view): view is DesktopCapabilityView => view !== undefined),
  }));

  return {
    capabilityViews: () => [...views],
    capabilityView(id) {
      if (!isDiscoverableCapabilityId(id)) {
        throw new Error(
          `capabilityView: unknown capability '${String(id)}' (the closed vocabulary is DISCOVERABLE_CAPABILITY_IDS)`,
        );
      }
      const view = byCapability.get(id);
      if (view === undefined) {
        throw new Error(`capabilityView: no projected row for '${id}'`);
      }
      return view;
    },
    j34TaskViews: () => j34Tasks.map((task) => ({ ...task, rows: [...task.rows] })),
    platformDifferenceViews: () =>
      platformDifferences.map((difference) => ({ ...difference })),
    feedModeControl: () =>
      feedModeChoiceView(runtime.feedMode.get(), runtime.feedMode.availability()),
    setFeedMode: (mode) => runtime.feedMode.set(mode),
    reportFeedModeAvailability: (availability) =>
      runtime.feedMode.setAvailability(availability),
    async refreshFeedModeAvailability(profileId) {
      if (!feed.bound) {
        // The honest unbound truth: nothing imported, no follows known —
        // the control's unavailable options carry the import next-action.
        const availability: FeedModeAvailability = { following: false, byof: false };
        runtime.feedMode.setAvailability(availability);
        return availability;
      }
      // The bound truth: real reads under the follow-graph and imported
      // modes (the R20 port's own vocabulary — the runtime control's
      // "foryou" IS the port's "webflix" mode; byof/following/hybrid map
      // one-to-one). Any read failure answers the honest empty truth —
      // never a guessed availability.
      let following = false;
      let byof = false;
      try {
        const followRecords = await feed.feedView({ profileId, mode: "following" });
        following = followRecords.ok ? followRecords.view.records.length > 0 : false;
      } catch {
        following = false;
      }
      try {
        const byofRecords = await feed.feedView({ profileId, mode: "byof" });
        byof = byofRecords.ok ? byofRecords.view.records.length > 0 : false;
      } catch {
        byof = false;
      }
      const availability: FeedModeAvailability = { following, byof };
      runtime.feedMode.setAvailability(availability);
      return availability;
    },
    personalizeControl: () => personalizeControlView(runtime.intents),
    realizationChoice: (input) =>
      realizationChoiceView({
        capabilities,
        realizations: input.realizations,
        active: input.active,
      }),
    aiActionTray: () => aiActionTrayView(runtime),
    async refreshAiActionTray() {
      await runtime.modelControls.refreshProviders();
      await Promise.all(AI_TRAY_TASKS.map((task) => runtime.modelControls.refreshPolicy(task)));
      return aiActionTrayView(runtime);
    },
  };
}

// ---------------------------------------------------------------------------
// The machine-checkable copy law (re-exported for the evidence consumers)
// ---------------------------------------------------------------------------

/**
 * Does one projected copy string carry stale completion wording? The
 * Desktop surface's own sweep primitive — delegates to the frozen R21-A
 * law (`isStaleCompletionCopy`) so the Web and Desktop sweeps can never
 * diverge in their definition.
 */
export function isStaleDesktopDiscoverabilityCopy(text: string): boolean {
  return isStaleCompletionCopy(text);
}

/** Re-export for the tests + the lead's evidence sweeps (one import site). */
export { DISCOVERABLE_CAPABILITY_IDS, FEED_MODE_LABELS };
