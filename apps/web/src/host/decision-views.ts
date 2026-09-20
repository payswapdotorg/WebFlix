/**
 * @wfx/app-web — the R21-E decision-hub view models (item/player).
 *
 * The pure + host-read projections behind the ITEM DETAIL and PLAYER
 * capability surfaces (the R21 plan's "decision hub"): the Where-to-watch
 * realization choice (the R09 resolution semantics through the R21-C
 * `realizationChoiceView` seam), and the AI action tray's view (the R06
 * model-controls read models + the frozen transform vocabulary).
 *
 * LAWS (the frozen UX law + the R21-A matrix, verbatim):
 *
 * - CANONICAL IDENTITY FIRST, REALIZATIONS SECOND: the Where-to-watch
 *   view is the same title's play paths — one identity, many sources;
 *   an unusable mode names WHY (the platform truth) and its next step
 *   ("Plays natively in the Desktop app"), never a dead "not available".
 * - EVERY OFFERED REALIZATION STAYS DISCOVERABLE: the alternates render
 *   with their switch path (the player route's mode preference) even
 *   when the platform cannot host them — discoverable + explanation.
 * - THE TRAY NAMES THE MODEL CLASS: each AI action carries the policy
 *   truth of the model that will run it (the honest "Not configured"
 *   names the first-party default — never a fabricated provider).
 * - NO STALE COMPLETION COPY (the R21-A sweep covers this file).
 * - Engineering diagnostics stay progressive disclosure — these views
 *   carry PRODUCT sentences; connector ids ride only as compact labels.
 */

import { realizationChoiceView } from "@wfx/client-runtime";
import type {
  RealizationAccessClass,
  RealizationChoiceView,
  ViewerSessionKind,
} from "@wfx/client-runtime";
import type { PlaybackMode } from "@wfx/domain";
import { PLAYBACK_MODE_PRECEDENCE } from "@wfx/client-runtime";
import { canUsePlaybackMode } from "@wfx/client-runtime";
import type { ModelTask } from "@wfx/domain";

import type { WebRuntimeHost } from "./web-host";
import { realizationAccessTruth, viewerKindOf } from "./anonymous-truth";

/** The viewer kind of a surface's session binding (the R23-A fold). */
function viewerKindOfSession(state: { readonly signedIn: boolean }) {
  return viewerKindOf(state);
}

// ---------------------------------------------------------------------------
// The Where-to-watch view (the realization choice — R09 semantics)
// ---------------------------------------------------------------------------

/** One offered way to watch (the product projection of one realization). */
export interface WatchOptionView {
  /** The playback mode (the frozen vocabulary — never re-worded). */
  readonly mode: PlaybackMode;
  /** The mode's user sentence (the R21-C label — one derivation source). */
  readonly modeLabel: string;
  /** The source offering this way (the compact connector label). */
  readonly connectorId: string;
  /** Whether THIS platform can host this way (capability truth). */
  readonly usable: boolean;
  /** Present iff unusable: the honest platform reason. */
  readonly unusableReason?: string;
  /**
   * R23 web-A — the typed access truth (the R23-A/B boundary): the
   * access class + the one-sentence user truth distinguishing PUBLIC
   * realizations (play for everyone) from the PROVIDER's OWN sign-in
   * requirement (never a WebFlix-account requirement).
   */
  readonly accessClass: RealizationAccessClass;
  readonly accessSentence: string;
  /** The rendered chip state (public / the source's sign-in active / needed). */
  readonly accessState: "public" | "provider-authorized" | "provider-sign-in-needed";
  /**
   * The switch path: the player link that prefers this mode (present for
   * usable options — the "switch source" recovery the matrix binds).
   */
  readonly switchHref?: string;
}

/** The Where-to-watch view (the item decision hub + the player switch row). */
export interface WhereToWatchView {
  /** The typed read status (an error renders the typed state, never a fake row). */
  readonly status: "ready" | "error";
  /** The error detail (error state only — verbatim, with its next action). */
  readonly errorDetail?: string;
  /** The user sentence for the way WebFlix will play this title. */
  readonly activeSentence: string;
  /** Every offered way to watch (frozen precedence order, secondary data first). */
  readonly options: readonly WatchOptionView[];
  /** How many ways this platform can play the title right now. */
  readonly usableCount: number;
  /** R23 web-A — the viewer the view resolved for (the session's own truth). */
  readonly viewer: ViewerSessionKind;
}

/**
 * Build the player href that prefers one mode (the realization switch
 * seam — the route accepts `mode` and resolves that realization).
 */
export function playerHrefWithMode(input: {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly durationMs?: number;
  readonly mode?: PlaybackMode;
  readonly resumePositionMs?: number;
}): string {
  const params = new URLSearchParams({
    id: input.itemId,
    connector: input.connectorId,
    ref: input.externalRef,
    title: input.title,
    type: input.canonicalType,
  });
  if (input.durationMs !== undefined) params.set("duration", String(input.durationMs));
  if (input.mode !== undefined) params.set("mode", input.mode);
  if (input.resumePositionMs !== undefined && input.resumePositionMs > 0) {
    params.set("resume", String(input.resumePositionMs));
  }
  return `/player?${params.toString()}`;
}

/** Derive the active sentence (the platform's precedence answer, pure). */
function activeSentenceOf(choice: RealizationChoiceView, usableCount: number): string {
  if (choice.activeMode !== null && usableCount > 0) {
    return `${choice.activeLabel} when you press play.`;
  }
  return "No way to watch on this platform yet — the ways that exist are named below.";
}

/**
 * Load the Where-to-watch view: the runtime's typed resolve read projected
 * through the R21-C `realizationChoiceView` seam. An error read answers the
 * TYPED error state with its next action (re-check from the detail page) —
 * never a fabricated row.
 */
export async function loadWhereToWatchView(
  host: WebRuntimeHost,
  input: {
    readonly itemId: string;
    readonly connectorId: string;
    readonly externalRef: string;
    readonly title: string;
    readonly canonicalType: string;
    readonly durationMs?: number;
  },
): Promise<WhereToWatchView> {
  // R23 web-A: the sources read (the provider-authorization truth the
  // per-option access sentences fold) + the viewer of THIS surface's
  // session binding. A failed sources read degrades to the honest empty
  // fact list — the access sentences render the source's requirement
  // truthfully without a fabricated authorization state.
  const sourcesModel = await host.runtime.sources.refresh().catch(() => null);
  const sources =
    sourcesModel !== null && sourcesModel.status.state === "ready"
      ? sourcesModel.sources
      : [];
  const viewer = viewerKindOfSession(host.session.state);
  const result = await host.serverPort.resolve(input.externalRef);
  if (!result.ok) {
    return {
      status: "error",
      errorDetail: result.failure.detail,
      activeSentence: "The ways to watch could not be read right now.",
      options: [],
      usableCount: 0,
      viewer,
    };
  }
  const realizations = result.value;
  // The platform's own precedence answer (the same order the runtime's
  // resolver applies — the preview of what pressing Play will choose).
  let active: { mode: PlaybackMode; connectorId: string } | null = null;
  for (const mode of PLAYBACK_MODE_PRECEDENCE) {
    const match = realizations.find((realization) => realization.mode === mode);
    if (match !== undefined && canUsePlaybackMode(host.capabilities, mode)) {
      active = { mode: match.mode, connectorId: match.connectorId };
      break;
    }
  }
  const choice = realizationChoiceView({
    capabilities: host.capabilities,
    realizations: realizations.map((realization) => ({
      mode: realization.mode,
      connectorId: realization.connectorId,
    })),
    active,
  });
  const options: WatchOptionView[] = choice.options.map((option) => {
    const access = realizationAccessTruth({
      viewer,
      mode: option.mode,
      connectorId: option.connectorId,
      sources,
    });
    const accessState: WatchOptionView["accessState"] =
      access.accessClass === "public"
        ? "public"
        : access.playbackDecision.kind === "playback-may-start"
          ? "provider-authorized"
          : "provider-sign-in-needed";
    return {
      mode: option.mode,
      modeLabel: option.modeLabel,
      connectorId: option.connectorId,
      usable: option.usable,
      ...(option.unusableReason !== undefined ? { unusableReason: option.unusableReason } : {}),
      accessClass: access.accessClass,
      accessSentence: access.sentence,
      accessState,
      ...(option.usable
        ? {
            switchHref: playerHrefWithMode({
              itemId: input.itemId,
              connectorId: input.connectorId,
              externalRef: input.externalRef,
              title: input.title,
              canonicalType: input.canonicalType,
              ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
              mode: option.mode,
            }),
          }
        : {}),
    };
  });
  return {
    status: "ready",
    activeSentence: activeSentenceOf(choice, options.filter((option) => option.usable).length),
    options,
    usableCount: options.filter((option) => option.usable).length,
    viewer,
  };
}

// ---------------------------------------------------------------------------
// The AI action tray view (the R06 model-controls projection)
// ---------------------------------------------------------------------------

/** One AI action the tray offers (the frozen product vocabulary). */
export interface AiActionView {
  /** The tray action's label (user vocabulary). */
  readonly label: string;
  /** The transform kind the action submits (the closed wire vocabulary). */
  readonly kind: string;
  /** The one-sentence description of what the action produces. */
  readonly description: string;
  /** The model task the action runs (the policy vocabulary). */
  readonly modelTask: ModelTask;
  /**
   * The model-class truth: which model will run it (the policy sentence —
   * "Not configured" names the first-party default, never a fabricated
   * provider).
   */
  readonly modelSentence: string;
  /** Whether the action's input can be satisfied for THIS title. */
  readonly runnable: boolean;
  /** Present iff not runnable: the honest precondition (named, never hidden). */
  readonly precondition?: string;
}

/** The AI action tray's view. */
export interface AiTrayView {
  /** Every action (fixed order — the tray renders the whole vocabulary). */
  readonly actions: readonly AiActionView[];
  /** The Desktop platform truth (local-model execution). */
  readonly desktopTruth: string;
  /** Where the model policy's detailed management lives (the existing IA). */
  readonly manageHref: string;
  /** The item's target identity (the tray's submissions carry it). */
  readonly target: {
    readonly connectorId: string;
    readonly externalRef: string;
    readonly title: string;
    readonly durationMs?: number;
  };
}

/** The one tray action descriptor (the frozen vocabulary — fixed order). */
const TRAY_ACTIONS: readonly {
  readonly label: string;
  readonly kind: string;
  readonly description: string;
  readonly modelTask: ModelTask;
}[] = [
  {
    label: "Transcribe",
    kind: "transcript",
    description: "A timed transcript of this title — every line with its moment.",
    modelTask: "transcription",
  },
  {
    label: "Subtitles",
    kind: "subtitle",
    description: "Translated subtitles composed from a transcript.",
    modelTask: "translation",
  },
  {
    label: "Translate",
    kind: "translation",
    description: "Translate this title's name and description into another language.",
    modelTask: "translation",
  },
  {
    label: "Dub",
    kind: "dubbing",
    description: "A dubbing track spec for this title in another language and voice.",
    modelTask: "dubbing",
  },
  {
    label: "Commentary",
    kind: "commentary",
    description: "An AI commentary track that talks with what you're watching.",
    modelTask: "commentary",
  },
];

/** The model-class sentence of one task's policy (the honest read). */
function modelSentenceOf(
  policy: { readonly status: { readonly state: string }; readonly policy: { readonly preferredProvider?: string; readonly fallbackProviders: readonly string[] } | null },
  providers: readonly { readonly id: string }[],
): string {
  if (policy.policy !== null) {
    const preferred = policy.policy.preferredProvider;
    if (preferred !== undefined && preferred.length > 0) {
      return `Runs through ${preferred} (your policy's preferred provider).`;
    }
    if (policy.policy.fallbackProviders.length > 0) {
      return `Runs through the fallback chain (${policy.policy.fallbackProviders.join(", ")}).`;
    }
  }
  const firstParty = providers.find((provider) => provider.id.includes("first-party"));
  if (firstParty !== undefined) {
    return `Not configured — the WebFlix model (${firstParty.id}) runs it.`;
  }
  return "Not configured — the WebFlix model runs it.";
}

/**
 * Load the AI action tray's view: the five frozen actions with each one's
 * model-class truth (the R21-C model-controls read models — the runtime's
 * own cache, refreshed here) and each one's input truth for THIS title.
 */
export async function loadAiTrayView(
  host: WebRuntimeHost,
  target: {
    readonly connectorId: string;
    readonly externalRef: string;
    readonly title: string;
    readonly durationMs?: number;
  },
): Promise<AiTrayView> {
  // The policy + registry reads (typed; failures degrade to the honest
  // "could not read" sentence — the tray still names the vocabulary).
  const [providers, ...policies] = await Promise.all([
    host.runtime.modelControls.refreshProviders(),
    ...TRAY_ACTIONS.map((action) => host.runtime.modelControls.refreshPolicy(action.modelTask)),
  ]);
  const policyByTask = new Map(policies.map((model) => [model.task, model]));
  const providerRows = providers.status.state === "ready" ? providers.providers : [];
  const durationKnown = target.durationMs !== undefined && target.durationMs > 0;
  const actions: AiActionView[] = TRAY_ACTIONS.map((action) => {
    const policy = policyByTask.get(action.modelTask);
    const modelSentence =
      policy === undefined
        ? "Model policy could not be read — retry from Model & AI settings."
        : modelSentenceOf(policy, providerRows);
    // The input truth: transcript/commentary need the title's duration;
    // subtitle/dubbing compose from transcript SEGMENTS (the honest
    // precondition — the capability is discovered, the requirement named).
    let runnable = true;
    let precondition: string | undefined;
    if (action.kind === "transcript" || action.kind === "commentary") {
      if (!durationKnown) {
        runnable = false;
        precondition = "Needs the title's duration — this source did not declare one.";
      }
    } else if (action.kind === "subtitle" || action.kind === "dubbing") {
      runnable = false;
      precondition = "Composes from a transcript — transcribe this title first.";
    }
    return {
      label: action.label,
      kind: action.kind,
      description: action.description,
      modelTask: action.modelTask,
      modelSentence,
      runnable,
      ...(precondition !== undefined ? { precondition } : {}),
    };
  });
  return {
    actions,
    desktopTruth:
      "Local-model execution runs in the Desktop app — on Web the same actions run through your service providers.",
    manageHref: "/settings?section=model",
    target,
  };
}
