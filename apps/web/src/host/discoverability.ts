/**
 * @wfx/app-web — the R21-D discovery view models.
 *
 * The pure + host-read projections behind the CONTEXTUAL DISCOVERY LAYER
 * (the R21 plan's orientation surfaces): the feed-mode control (For you /
 * Following / Your imported feed / Blend — the R21-A store), the
 * Personalize control (attention mode + exploration + session intent),
 * and the Home source strip. Every label derives from the FROZEN
 * vocabularies (`FEED_MODE_LABELS`, `ATTENTION_MODES`) — a surface never
 * invents its own mode wording (the R21-A law).
 *
 * LAWS (mirrored from the R21-A contract + the frozen UX law):
 *
 * - THE ADAPTER REPORTS AVAILABILITY TRUTH (feed-mode law 2): whether
 *   Following / BYOF / Blend can be honored derives from REAL data (the
 *   imported-feed view's relationships), never a guess. The truth is
 *   REPORTED to the runtime's store (`feedMode.setAvailability`) so the
 *   control and the store cannot diverge.
 * - UNAVAILABLE IS DISCOVERABLE, NOT HIDDEN: an unavailable mode carries
 *   its plain-language reason + its recovery next-action (the matrix's
 *   feed-mode recovery path: "Bring your feed").
 * - NO STALE COMPLETION COPY: every string here is present-tense product
 *   truth (the R21-A `isStaleCompletionCopy` sweep covers this file).
 * - THE SESSION INTENT IS SESSION-SCOPED: the Personalize control submits
 *   `scope: "session"` intents (cleared when the session ends — they never
 *   reach the server by the IntentStore law) and the attention-mode
 *   policy (write-through where the transport implements it). A recent
 *   watch is one signal, never permanent identity.
 */

import type {
  AttentionMode,
} from "@wfx/client-runtime";
import type { RecommendationPolicyView, RecordedIntent } from "@wfx/client-runtime";
import {
  FEED_MODES,
  FEED_MODE_LABELS,
  effectiveFeedModeAvailability,
} from "@wfx/client-runtime";
import type { FeedMode, FeedModeAvailability } from "@wfx/client-runtime";
import type { SourceInfo, SourcesModel } from "@wfx/client-runtime";

import type { WebRuntimeHost } from "./web-host";
import type { ByofFeedView } from "./byof/byof-view";
import { loadByofFeedView, byofHostBinding } from "./byof/byof-host";

// ---------------------------------------------------------------------------
// The feed-mode control view
// ---------------------------------------------------------------------------

/** The relationships the Following mode honors (the follow family). */
const FOLLOWING_RELATIONSHIPS: readonly string[] = ["follow", "subscription"];

/** One feed-mode choice the control renders. */
export interface FeedModeOptionView {
  readonly id: FeedMode;
  /** The frozen label (FEED_MODE_LABELS — never re-worded). */
  readonly label: string;
  readonly available: boolean;
  /** Why the mode cannot be honored right now (unavailable modes only). */
  readonly reason: string | null;
  /** The recovery next-action's control label (unavailable modes only). */
  readonly recoveryAction: string | null;
  /** Where the recovery action goes (the existing IA — never a new route). */
  readonly recoveryHref: string | null;
}

/** The feed-mode control's view (the current mode + every choice). */
export interface FeedModeView {
  readonly mode: FeedMode;
  readonly options: readonly FeedModeOptionView[];
  /** The Settings management destination (the existing IA). */
  readonly manageHref: string;
}

/** Where the sources/import management lives (the existing IA). */
const SOURCES_SETTINGS_HREF = "/settings?section=sources";

/**
 * Derive the adapter's feed-mode availability truth from the imported-feed
 * view (PURE): Following needs a follow/subscription relationship; the
 * imported-feed mode needs an import that still owns records; Blend needs
 * either. An unavailable feed view (`state: "unavailable"`) answers the
 * honest nothing-available truth — never a guessed yes.
 */
export function feedModeAvailabilityOf(feed: ByofFeedView | null): FeedModeAvailability {
  if (feed === null || feed.state !== "ready") {
    return { following: false, byof: false };
  }
  const following = feed.followingCount > 0;
  const byof = feed.imports.some(
    (entry) => entry.groups.some((group) => group.records.length > 0),
  );
  return { following, byof };
}

/** The plain-language unavailable reason of one mode (the frozen wording). */
function feedModeReason(mode: FeedMode, availability: FeedModeAvailability): string | null {
  if (effectiveFeedModeAvailability(availability)[mode]) return null;
  if (mode === "following") {
    return "Following needs someone you follow first — a followed creator or a subscription imported with your feed.";
  }
  if (mode === "byof") {
    return "This mode shows a feed you brought from another app — none is imported yet.";
  }
  return "Blend mixes your follows or an imported feed with WebFlix discovery — connect one first.";
}

/** The recovery next-action of one unavailable mode (the existing IA). */
function feedModeRecovery(mode: FeedMode): { action: string; href: string } | null {
  if (mode === "foryou") return null;
  return {
    action: mode === "following" ? "Bring your feed" : "Bring your feed",
    href: SOURCES_SETTINGS_HREF,
  };
}

/** Project the feed-mode control's view (pure; labels from the frozen table). */
export function feedModeViewOf(mode: FeedMode, availability: FeedModeAvailability): FeedModeView {
  const effective = effectiveFeedModeAvailability(availability);
  return {
    mode,
    options: FEED_MODES.map((id) => {
      const available = effective[id];
      const reason = feedModeReason(id, availability);
      const recovery = available ? null : feedModeRecovery(id);
      return {
        id,
        label: FEED_MODE_LABELS[id],
        available,
        reason,
        ...(recovery !== null ? { recoveryAction: recovery.action } : { recoveryAction: null }),
        ...(recovery !== null ? { recoveryHref: recovery.href } : { recoveryHref: null }),
      };
    }),
    manageHref: SOURCES_SETTINGS_HREF,
  };
}

/**
 * Load the feed-mode control's view from the runtime store + the REAL
 * imported-feed truth (the availability report the adapter owes the
 * store — law: never guessed). The store's current selection is never
 * silently reverted by a truth change (the R21-A report-only law).
 */
export async function loadFeedModeView(host: WebRuntimeHost): Promise<FeedModeView> {
  let feed: ByofFeedView | null = null;
  try {
    feed = await loadByofFeedView(byofHostBinding(host));
  } catch {
    // The imported-feed read failed: the honest availability answer is
    // "cannot honor Following/imported right now" — never a guessed yes.
    feed = null;
  }
  const availability = feedModeAvailabilityOf(feed);
  host.runtime.feedMode.setAvailability(availability);
  return feedModeViewOf(host.runtime.feedMode.get(), availability);
}

// ---------------------------------------------------------------------------
// The Personalize control view (intent + attention + exploration)
// ---------------------------------------------------------------------------

/** The user-facing attention-mode vocabulary (frozen semantics, one wording). */
const ATTENTION_MODE_INFO: Readonly<
  Record<AttentionMode, { readonly label: string; readonly description: string }>
> = {
  mindful: {
    label: "Mindful",
    description: "Check in regularly — the feed re-ranks sooner and nudges you toward variety.",
  },
  balanced: {
    label: "Balanced",
    description: "The default: a steady mix of what you watch and fresh exploration.",
  },
  immersive: {
    label: "Immersive",
    description: "Stay in the flow — no re-rank interruptions while you watch.",
  },
  custom: {
    label: "Custom",
    description: "You set the exploration dial yourself — the feed follows your setting.",
  },
};

/** One attention-mode choice. */
export interface AttentionModeView {
  readonly id: AttentionMode;
  readonly label: string;
  readonly description: string;
  readonly selected: boolean;
}

/** One active session intent. */
export interface ActiveIntentView {
  readonly objective: string;
  readonly scope: string;
  /** Plain-language expiry ("ends with this session" / "until <time>"). */
  readonly expiryLabel: string;
}

/** The Personalize control's view. */
export interface PersonalizeView {
  /** The active attention mode (the runtime's policy view — never a second one). */
  readonly attentionMode: AttentionMode;
  readonly attentionModes: readonly AttentionModeView[];
  /** The policy dials in [0,1] (the runtime's view). */
  readonly exploration: number;
  readonly novelty: number;
  readonly socialInfluence: number;
  readonly updatedAt: string;
  /** The active session intents (the runtime's expiry-filtered set). */
  readonly intents: readonly ActiveIntentView[];
  /** The Settings management destination (the existing IA). */
  readonly manageHref: string;
}

/** The Settings recommendation management href (the existing IA — general section). */
const RECOMMENDATION_SETTINGS_HREF = "/settings?section=general";

/** Project one recorded intent's expiry into plain language (pure). */
export function intentExpiryLabel(intent: RecordedIntent): string {
  if (intent.scope === "session" || intent.scope === "momentary") {
    return "ends with this session";
  }
  if (intent.expiresAt !== undefined) {
    const at = Date.parse(intent.expiresAt);
    if (Number.isFinite(at)) {
      return `until ${new Date(at).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" })}`;
    }
  }
  return "saved to your profile";
}

/** Project the Personalize view from the runtime's policy + intent set (pure). */
export function personalizeViewOf(
  policy: RecommendationPolicyView,
  intents: readonly RecordedIntent[],
): PersonalizeView {
  return {
    attentionMode: policy.attentionMode,
    attentionModes: (["mindful", "balanced", "immersive", "custom"] as const satisfies readonly AttentionMode[]).map(
      (id) => ({
        id,
        label: ATTENTION_MODE_INFO[id].label,
        description: ATTENTION_MODE_INFO[id].description,
        selected: policy.attentionMode === id,
      }),
    ),
    exploration: policy.exploration,
    novelty: policy.novelty,
    socialInfluence: policy.socialInfluence,
    updatedAt: policy.updatedAt,
    intents: intents
      .filter((intent) => intent.scope === "session" || intent.scope === "momentary" || intent.scope === "temporary")
      .map((intent) => ({
        objective: intent.objective,
        scope: intent.scope,
        expiryLabel: intentExpiryLabel(intent),
      })),
    manageHref: RECOMMENDATION_SETTINGS_HREF,
  };
}

/** Load the Personalize control's view from the runtime (policy + intents). */
export function loadPersonalizeView(host: WebRuntimeHost): PersonalizeView {
  return personalizeViewOf(host.runtime.intents.policy(), host.runtime.intents.intents());
}

// ---------------------------------------------------------------------------
// The Home source strip view
// ---------------------------------------------------------------------------

/** The auth-state chip vocabulary (the settings surface's frozen wording). */
const AUTH_STATE_LABELS: Readonly<Record<string, string>> = {
  signedIn: "Connected",
  signedOut: "Not connected",
  expired: "Sign-in expired",
  authorizing: "Connecting…",
  failed: "Connection failed",
};

/** One source chip of the strip. */
export interface SourceStripEntry {
  readonly connectorId: string;
  readonly displayName: string;
  readonly authState: string;
  readonly authLabel: string;
  /** The typed recovery action's label ("" when none is needed). */
  readonly recoveryLabel: string;
}

/** The Home source strip's view. */
export interface SourceStripView {
  readonly state: "ready" | "error";
  readonly sources: readonly SourceStripEntry[];
  /** Where source management lives (the existing IA). */
  readonly manageHref: string;
  /** The error detail (error state only — the typed failure, verbatim). */
  readonly errorDetail?: string;
}

/** Project the source strip from the runtime's sources model (pure). */
export function sourceStripViewOf(model: SourcesModel): SourceStripView {
  if (model.status.state === "error") {
    return {
      state: "error",
      sources: [],
      manageHref: SOURCES_SETTINGS_HREF,
      ...(model.status.error?.detail !== undefined
        ? { errorDetail: model.status.error.detail }
        : {}),
    };
  }
  const recoveryLabelOf = (source: SourceInfo): string => {
    if (source.authState === "expired") return "Reconnect";
    if (source.authState === "signedOut") return "Connect";
    if (source.authState === "failed") return "Retry connection";
    return "";
  };
  return {
    state: "ready",
    sources: model.sources.map((source) => ({
      connectorId: source.connectorId,
      displayName: source.displayName,
      authState: source.authState,
      authLabel: AUTH_STATE_LABELS[source.authState] ?? source.authState,
      recoveryLabel: recoveryLabelOf(source),
    })),
    manageHref: SOURCES_SETTINGS_HREF,
  };
}

/** Load the Home source strip's view (the runtime's honest sources read). */
export async function loadSourceStripView(host: WebRuntimeHost): Promise<SourceStripView> {
  return sourceStripViewOf(await host.runtime.sources.refresh());
}

// ---------------------------------------------------------------------------
// The Home orientation bundle (the discovery header + the mode's feed)
// ---------------------------------------------------------------------------

/** One imported-feed record rendered as a compact Home feed card. */
export interface ImportedFeedCardView {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
  readonly relationship: string;
  /** The source's own position in its feed (source-native order truth). */
  readonly sourceOrder: number;
}

/** The imported-feed section the BYOF/Following/Blend modes render. */
export interface ImportedFeedSectionView {
  /** The frozen mode label (never re-worded — FEED_MODE_LABELS). */
  readonly label: string;
  /** The one-sentence order truth (source-native, never WebFlix-ranked). */
  readonly orderSentence: string;
  readonly cards: readonly ImportedFeedCardView[];
  /** The freshness/provenance sentence (live/snapshot/stale — named). */
  readonly freshnessSentence: string;
  /** Where the feed's detailed management lives (the existing IA). */
  readonly manageHref: string;
}

/** The Home discovery bundle: the controls + the mode-honored feed sections. */
export interface DiscoveryBundle {
  readonly feedMode: FeedModeView;
  readonly personalize: PersonalizeView;
  readonly sourceStrip: SourceStripView;
  /**
   * The imported-feed section the current mode renders (BYOF/Following/
   * Blend when available); null on For-you or when nothing is imported.
   */
  readonly importedSection: ImportedFeedSectionView | null;
  /** Whether the seeded discovery rows render alongside (For-you/Blend). */
  readonly discoveryRowsRender: boolean;
}

/** The follow-family records of the imported feed (the Following subset). */
function followingCardsOf(feed: ByofFeedView): ImportedFeedCardView[] {
  const cards: ImportedFeedCardView[] = [];
  for (const entry of feed.imports) {
    for (const group of entry.groups) {
      if (!FOLLOWING_RELATIONSHIPS.includes(group.relationship)) continue;
      for (const record of group.records) {
        cards.push({
          itemId: record.entertainmentItemId,
          connectorId: entry.import.connectorId,
          externalRef: record.externalRef,
          title: record.title,
          relationship: group.relationship,
          sourceOrder: record.sourceOrder,
        });
      }
    }
  }
  return cards;
}

/** Every imported record in the store's source-native read order. */
function importedCardsOf(feed: ByofFeedView): ImportedFeedCardView[] {
  const cards: ImportedFeedCardView[] = [];
  for (const entry of feed.imports) {
    for (const group of entry.groups) {
      for (const record of group.records) {
        cards.push({
          itemId: record.entertainmentItemId,
          connectorId: entry.import.connectorId,
          externalRef: record.externalRef,
          title: record.title,
          relationship: group.relationship,
          sourceOrder: record.sourceOrder,
        });
      }
    }
  }
  cards.sort((a, b) => a.sourceOrder - b.sourceOrder);
  return cards;
}

/** The imported feed's freshness sentence (the first import's truth). */
function freshnessSentenceOf(feed: ByofFeedView): string {
  const first = feed.imports[0];
  if (first === undefined) return "";
  const name = first.import.displayName;
  const state = first.import.syncState;
  if (state === "live") {
    return `Live — synced from ${name}.`;
  }
  if (state === "snapshot") {
    return `Snapshot imported from ${name}${
      first.import.lastSyncedAt !== undefined
        ? ` — last synced ${first.import.lastSyncedAt}`
        : ""
    }.`;
  }
  if (state === "stale") {
    return `This capture from ${name} went stale — refresh it from Settings to bring it current.`;
  }
  return `Imported from ${name}.`;
}

/** Project the imported-feed section for one mode (pure). */
export function importedSectionViewOf(
  mode: FeedMode,
  feed: ByofFeedView | null,
): ImportedFeedSectionView | null {
  if (mode === "foryou") return null; // the seeded discovery rows own the For-you feed
  if (feed === null || feed.state !== "ready") return null;
  const cards = mode === "following" ? followingCardsOf(feed) : importedCardsOf(feed);
  if (cards.length === 0) return null;
  return {
    // The section's label names WHAT it renders (the imported records /
    // the follows) — the home root's data-wfx-feed-mode names the MODE.
    label: mode === "following" ? FEED_MODE_LABELS.following : FEED_MODE_LABELS.byof,
    orderSentence:
      mode === "following"
        ? "The people and channels you follow, in their own feed order."
        : "Your feed in its own order, exactly as the source lists it — never re-ranked by WebFlix.",
    cards,
    freshnessSentence: freshnessSentenceOf(feed),
    manageHref: "/library",
  };
}

/**
 * Load the whole Home discovery bundle: the feed-mode truth (reported to
 * the store), the Personalize view, the source strip, and the imported
 * section the CURRENT mode honors. The seeded discovery rows render on
 * For-you always, and alongside the imported section on Blend.
 */
export async function loadDiscoveryBundle(host: WebRuntimeHost): Promise<DiscoveryBundle> {
  const feedMode = await loadFeedModeView(host);
  const personalize = loadPersonalizeView(host);
  const sourceStrip = await loadSourceStripView(host);
  let feed: ByofFeedView | null = null;
  try {
    feed = await loadByofFeedView(byofHostBinding(host));
  } catch {
    feed = null;
  }
  const mode = feedMode.mode;
  const importedSection =
    mode === "byof" || mode === "following" || mode === "hybrid"
      ? importedSectionViewOf(mode, feed)
      : null;
  return {
    feedMode,
    personalize,
    sourceStrip,
    importedSection,
    discoveryRowsRender: mode === "foryou" || mode === "hybrid",
  };
}
