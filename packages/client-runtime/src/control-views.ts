/**
 * @wfx/client-runtime — the contextual control view derivations (R21-C).
 *
 * PURE projections of the runtime's EXISTING shared semantics into
 * UI-ready view models — NO new recommendation algorithm, NO product
 * policy moved into adapters. This module makes visible what R05
 * (intent/policy), R09 (realization resolution), R14 (acquisition), and
 * R21-A (feed mode) already own:
 *
 * - `personalizeControlView` — the Personalize control's view: the
 *   active intents (with temporary-expiry truth), the attention mode,
 *   the policy dials, and the recommendation-feedback control
 *   descriptors — the Home/Watch/Shorts feed control renders exactly
 *   this.
 * - `feedModeChoiceView` — the feed-mode control's view: every mode with
 *   its availability truth + the recovery hint for the unavailable ones
 *   (discoverable, never hidden).
 * - `realizationChoiceView` — the "Where to watch" view: the active
 *   realization + the alternates with their capability truth (a skipped
 *   realization says WHY — the user's next action is named).
 *
 * The views are plain serializable data: adapters render them; they
 * never re-derive product semantics.
 */

import type { IntentOperations, RecordedIntent } from "./intent";
import type { RecommendationPolicyView, AttentionMode } from "./intent";
import type { FeedModeSetFailure } from "./feed-mode";
import { FEED_MODES, FEED_MODE_LABELS } from "./discoverability";
import type { FeedMode } from "./discoverability";
import { effectiveFeedModeAvailability, type FeedModeAvailability } from "./feed-mode";
import type { PlatformCapabilities } from "@wfx/platform-contracts";
import { canUsePlaybackMode } from "./playback";
import type { PlaybackMode } from "@wfx/domain";

// ---------------------------------------------------------------------------
// The Personalize control view (intent + attention + feedback)
// ---------------------------------------------------------------------------

/** One active intent in the control's view (user vocabulary). */
export interface IntentChipView {
  /** The intent's objective (plain language, as submitted). */
  readonly objective: string;
  /** The intent's scope in user vocabulary ("for a while", "tonight", …). */
  readonly scopeLabel: string;
  /** Present iff temporary: when the intent ends (ISO — the expiry truth). */
  readonly expiresAt?: string;
}

/** The frozen feedback-control vocabulary (the R05 controls, user words). */
export type FeedbackControlKind =
  | "more-like-this"
  | "not-interested"
  | "not-interested-source"
  | "already-watched";

/** One feedback control descriptor (the card/detail/Shorts affordances). */
export interface FeedbackControlView {
  readonly kind: FeedbackControlKind;
  /** The control's label (user vocabulary). */
  readonly label: string;
}

/** Every feedback control (fixed order — the surfaces render them all). */
export const FEEDBACK_CONTROLS: readonly FeedbackControlView[] = [
  { kind: "more-like-this", label: "More like this" },
  { kind: "not-interested", label: "Not interested" },
  { kind: "not-interested-source", label: "Don't recommend this source" },
  { kind: "already-watched", label: "I've already watched this" },
];

/** The Personalize control's view (the shared Home/Watch/Shorts control). */
export interface PersonalizeControlView {
  /** The active intents (expiry-filtered — the runtime's own law). */
  readonly intents: readonly IntentChipView[];
  /** The current attention mode (user vocabulary). */
  readonly attentionMode: AttentionMode;
  /** The attention mode's user label. */
  readonly attentionLabel: string;
  /** The policy dials ([0,1] — the exploration/novelty/social truth). */
  readonly dials: {
    readonly exploration: number;
    readonly novelty: number;
    readonly socialInfluence: number;
  };
  /** The feedback controls (immediate + reversible — the R05 law). */
  readonly feedbackControls: readonly FeedbackControlView[];
}

/**
 * The attention-mode labels in user words (the frozen vocabulary's one
 * derivation source — every surface renders THIS wording, never its own).
 */
export const ATTENTION_MODE_LABELS: Readonly<Record<AttentionMode, string>> = {
  mindful: "Mindful",
  balanced: "Balanced",
  immersive: "Immersive",
  custom: "Custom",
};

/** The scope vocabulary in user words (the frozen scopes, user labels). */
const INTENT_SCOPE_LABELS: Readonly<Record<string, string>> = {
  persistent: "for a while",
  temporary: "tonight",
  session: "this session",
  momentary: "right now",
  social: "from friends",
};

/**
 * Derive the Personalize control's view from the runtime's intent
 * operations (PURE — the projection of the R05 semantics).
 */
export function personalizeControlView(
  intents: IntentOperations,
): PersonalizeControlView {
  const active: readonly RecordedIntent[] = intents.intents();
  const policy: RecommendationPolicyView = intents.policy();
  return {
    intents: active.map((intent) => ({
      objective: intent.objective,
      scopeLabel: INTENT_SCOPE_LABELS[intent.scope] ?? intent.scope,
      ...(intent.expiresAt !== undefined ? { expiresAt: intent.expiresAt } : {}),
    })),
    attentionMode: policy.attentionMode,
    attentionLabel: ATTENTION_MODE_LABELS[policy.attentionMode],
    dials: {
      exploration: policy.exploration,
      novelty: policy.novelty,
      socialInfluence: policy.socialInfluence,
    },
    feedbackControls: FEEDBACK_CONTROLS,
  };
}

// ---------------------------------------------------------------------------
// The feed-mode choice view (the Home/Watch/Shorts mode control)
// ---------------------------------------------------------------------------

/** One feed-mode option in the control's view. */
export interface FeedModeOptionView {
  readonly mode: FeedMode;
  /** The mode's user label (the one derivation source). */
  readonly label: string;
  /** Whether the mode can be honored RIGHT NOW. */
  readonly available: boolean;
  /** Present iff unavailable: WHY (the honest explanation). */
  readonly unavailableDetail?: string;
  /** Present iff unavailable: the recovery next action (never a dead end). */
  readonly recoveryHint?: string;
}

/** The feed-mode control's view (every mode — discoverable, never hidden). */
export interface FeedModeChoiceView {
  /** The currently selected mode. */
  readonly selected: FeedMode;
  /** Every mode in frozen order with its availability truth. */
  readonly options: readonly FeedModeOptionView[];
}

/**
 * Derive the feed-mode control's view (PURE): the selected mode + every
 * mode's availability truth with the recovery hints for the unavailable
 * ones (the "unsupported is not undiscoverable" law).
 */
export function feedModeChoiceView(
  selected: FeedMode,
  availability: FeedModeAvailability,
): FeedModeChoiceView {
  const effective = effectiveFeedModeAvailability(availability);
  const options: FeedModeOptionView[] = FEED_MODES.map((mode) => {
    if (effective[mode]) {
      return { mode, label: FEED_MODE_LABELS[mode], available: true };
    }
    const refusal: FeedModeSetFailure = {
      kind: "unavailable",
      mode,
      detail:
        mode === "following"
          ? "the Following mode needs someone you follow first"
          : mode === "byof"
            ? "the imported-feed mode needs an imported feed first"
            : "the Blend mode needs a followed account or an imported feed first",
      recoveryHint:
        mode === "following"
          ? "Follow a creator from any title or connect a source with following."
          : mode === "byof"
            ? "Bring your feed to import your existing subscriptions."
            : "Bring your feed or follow a creator to blend relationships with discovery.",
    };
    return {
      mode,
      label: FEED_MODE_LABELS[mode],
      available: false,
      unavailableDetail: refusal.detail,
      recoveryHint: refusal.recoveryHint,
    };
  });
  return { selected, options };
}

// ---------------------------------------------------------------------------
// The realization-choice view ("Where to watch" — the R09 semantics)
// ---------------------------------------------------------------------------

/** The playback-mode vocabulary in user words (the frozen modes). */
const PLAYBACK_MODE_LABELS: Readonly<Record<PlaybackMode, string>> = {
  native: "Plays natively in the Desktop app",
  embed: "Plays inside WebFlix",
  browser: "Plays in a contained window",
  external: "Opens outside WebFlix",
};

/** One offered realization in the choice view. */
export interface RealizationOptionView {
  /** The realization's playback mode (user-labeled below). */
  readonly mode: PlaybackMode;
  /** The user-facing mode sentence. */
  readonly modeLabel: string;
  /** The source offering this realization (connectorId — the compact label). */
  readonly connectorId: string;
  /** Whether THIS platform can use this realization (capability truth). */
  readonly usable: boolean;
  /** Present iff unusable: WHY (the honest capability reason). */
  readonly unusableReason?: string;
}

/** The "Where to watch" view (item detail's decision hub + player switch). */
export interface RealizationChoiceView {
  /** The chosen realization's mode (absent when nothing resolved). */
  readonly activeMode: PlaybackMode | null;
  /** The active realization's user sentence. */
  readonly activeLabel: string;
  /** Every offered realization with its capability truth. */
  readonly options: readonly RealizationOptionView[];
}

/**
 * Derive the "Where to watch" view (PURE — the projection of the R09
 * resolution semantics): the active realization + the alternates with
 * their platform capability truth (an unusable mode names WHY and its
 * next step — never a dead end).
 */
export function realizationChoiceView(input: {
  /** The platform capability bundle (the truth source). */
  readonly capabilities: PlatformCapabilities;
  /** The offered realizations (the server's resolve answer). */
  readonly realizations: readonly { readonly mode: PlaybackMode; readonly connectorId: string }[];
  /** The active/chosen realization (null when none). */
  readonly active: { readonly mode: PlaybackMode; readonly connectorId: string } | null;
}): RealizationChoiceView {
  const options: RealizationOptionView[] = input.realizations.map((realization) => {
    if (canUsePlaybackMode(input.capabilities, realization.mode)) {
      return {
        mode: realization.mode,
        modeLabel: PLAYBACK_MODE_LABELS[realization.mode],
        connectorId: realization.connectorId,
        usable: true,
      };
    }
    return {
      mode: realization.mode,
      modeLabel: PLAYBACK_MODE_LABELS[realization.mode],
      connectorId: realization.connectorId,
      usable: false,
      unusableReason:
        realization.mode === "native"
          ? "Native playback runs in the Desktop app — this platform plays it another way."
          : "This platform cannot host that playback mode.",
    };
  });
  return {
    activeMode: input.active?.mode ?? null,
    activeLabel: input.active !== null ? PLAYBACK_MODE_LABELS[input.active.mode] : "No way to watch yet",
    options,
  };
}
