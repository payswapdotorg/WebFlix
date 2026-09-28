/**
 * @wfx/app-web — R38-B — THE STUDIO ANALYTICS COMPOSITION (the honest
 * panels' view models).
 *
 * THE HONEST-ANALYTICS LAW (the task packet, binding — the R28 law
 * extended): "analytics render ONLY what the real local transport
 * carries. Reach/engagement/audience panels show the LOCAL truth of the
 * user's own real actions (their own views, their own interactions —
 * the local wallet law), and every metric without honest backing
 * renders the TYPED ABSENCE state — never a fabricated chart, never a
 * seeded number, never a fake axis."
 *
 * THE BACKING MAP (every panel's truth — evidence/r38b/honesty.md):
 *
 * - REACH: impressions/views-by-others have NO transport on this host
 *   (the source declares no viewCount metadata — the fixtures catalog
 *   carries none; nothing counts impressions) ⇒ the TYPED ABSENCE with
 *   its frozen sentence. The one real reach datum is YOUR OWN VIEW —
 *   the session's watch-fold truth (position/completion).
 * - ENGAGEMENT: comments (the `wfx-comments-v1` count — the same count
 *   the watch surface renders), YOUR reaction (`wfx-reactions-v1`), and
 *   the library saves (the runtime's own read) ⇒ REAL values.
 * - AUDIENCE: the subscriber count is NEVER fabricated (the R36 law)
 *   ⇒ the typed absence + the user's OWN subscription truth; every
 *   demographic/geo metric has no transport ⇒ typed absence.
 *
 * PURE (no I/O): the client island feeds it the server truths (props)
 * + the local truths (loaded after mount) and renders the composed
 * panels — never a fabricated number can enter (the absent arms carry
 * only their sentences).
 */

import type { StudioItemSavesView, StudioChannelView } from "./studio-views";
import type { StudioItemSummary } from "./studio-views";

/** One panel datum: the real value, or the typed absence with its honest sentence. */
export type PanelDatum<T> =
  | { readonly kind: "real"; readonly value: T; readonly note: string | null }
  | { readonly kind: "absent"; readonly note: string };

/** The frozen honest-absence sentences (the surface renders these verbatim; J48 asserts them). */
export const ANALYTICS_ABSENCE_NOTES = {
  impressions:
    "No impression transport is connected on this host — WebFlix does not fabricate a reach number.",
  yourViewNone: "Not watched by you yet — your own viewing is the one reach truth this panel carries.",
  subscribers:
    "This source declares no subscriber count — WebFlix never fabricates one.",
  demographics:
    "No audience-insights transport is connected on this host — WebFlix does not fabricate demographics.",
  geography:
    "No geography transport is connected on this host — WebFlix does not fabricate a map.",
} as const;

/** The per-item local truths (the local wallet — loaded after mount, never fabricated). */
export interface LocalItemTruths {
  /** The item's comment count on this device's own record (the watch surface's own count). */
  readonly commentsCount: number;
  /** This browser's own reaction on the item (null = none recorded). */
  readonly yourReaction: "like" | "dislike" | null;
}

/** The engagement panel's view (every real value honestly sourced). */
export interface EngagementPanel {
  readonly comments: PanelDatum<number>;
  readonly yourReaction: PanelDatum<"like" | "dislike">;
  readonly saves: PanelDatum<readonly string[]>;
}

/** The reach panel's view. */
export interface ReachPanel {
  readonly impressions: PanelDatum<number>;
  readonly yourView: PanelDatum<{ readonly positionMs: number; readonly completionRatio: number | null }>;
}

/** The audience panel's view. */
export interface AudiencePanel {
  readonly subscribers: PanelDatum<never>;
  readonly youSubscribed: PanelDatum<boolean>;
  readonly demographics: PanelDatum<never>;
}

/** One video's analytics row (the per-video panels). */
export interface VideoAnalyticsRow {
  readonly item: StudioItemSummary;
  readonly reach: ReachPanel;
  readonly engagement: EngagementPanel;
}

/** The channel-level analytics view (the aggregates + the absences). */
export interface ChannelAnalyticsView {
  readonly channel: StudioChannelView;
  /** The channel's total comments across its items (a real sum of real counts — always real by construction). */
  readonly totalComments: { readonly value: number; readonly note: string };
  /** The channel's items with your own reaction recorded (a real count — always real by construction). */
  readonly yourReactions: { readonly value: number; readonly note: string };
  /** The channel's items saved in your library (a real count — always real by construction). */
  readonly yourSaves: { readonly value: number; readonly note: string };
  /** The channel's items you have watched (the watch-fold truth — always real by construction). */
  readonly yourViews: { readonly value: number; readonly note: string };
  readonly audience: AudiencePanel;
}

/** Compose one video's panels from the item + the local truths + the server saves. */
export function videoAnalyticsRowOf(
  item: StudioItemSummary,
  local: LocalItemTruths,
  saves: StudioItemSavesView | undefined,
): VideoAnalyticsRow {
  return {
    item,
    reach: {
      impressions: { kind: "absent", note: ANALYTICS_ABSENCE_NOTES.impressions },
      yourView:
        item.resume !== null
          ? {
              kind: "real",
              value: {
                positionMs: item.resume.positionMs,
                completionRatio: item.resume.completionRatio,
              },
              note: null,
            }
          : { kind: "absent", note: ANALYTICS_ABSENCE_NOTES.yourViewNone },
    },
    engagement: {
      comments: {
        kind: "real",
        value: local.commentsCount,
        note: "this device's own comment record — the same count the watch surface renders",
      },
      yourReaction:
        local.yourReaction !== null
          ? { kind: "real", value: local.yourReaction, note: "your own reaction, recorded on this device" }
          : {
              kind: "absent",
              note: "No reaction recorded by you on this device — your own actions are the one reaction truth this panel carries.",
            },
      saves:
        saves !== undefined && saves.listNames.length > 0
          ? {
              kind: "real",
              value: saves.listNames,
              note: "your own library's named lists carrying this item",
            }
          : {
              kind: "absent",
              note: "Not saved in your library — your own saves are the one save truth this panel carries.",
            },
    },
  };
}

/** Compose the channel-level analytics (the aggregates of the same real truths). */
export function channelAnalyticsOf(
  channel: StudioChannelView,
  locals: Readonly<Record<string, LocalItemTruths>>,
  saves: Readonly<Record<string, StudioItemSavesView>>,
): ChannelAnalyticsView {
  let totalComments = 0;
  let yourReactions = 0;
  let yourSaves = 0;
  let yourViews = 0;
  for (const item of channel.items) {
    const local = locals[item.itemId];
    if (local !== undefined) totalComments += local.commentsCount;
    if (local?.yourReaction != null) yourReactions += 1;
    if ((saves[item.itemId]?.listNames.length ?? 0) > 0) yourSaves += 1;
    if (item.resume !== null) yourViews += 1;
  }
  return {
    channel,
    totalComments: {
      value: totalComments,
      note: "the sum of this device's own comment records across the channel's items",
    },
    yourReactions: {
      value: yourReactions,
      note: "the channel's items with your own reaction recorded",
    },
    yourSaves: {
      value: yourSaves,
      note: "the channel's items saved in your own library",
    },
    yourViews: {
      value: yourViews,
      note: "the channel's items your session has watched (the watch-fold truth)",
    },
    audience: {
      subscribers: { kind: "absent", note: ANALYTICS_ABSENCE_NOTES.subscribers },
      youSubscribed: {
        kind: "real",
        value: channel.subscribed,
        note: "your own subscription truth (this device's library record)",
      },
      demographics: { kind: "absent", note: ANALYTICS_ABSENCE_NOTES.demographics },
    },
  };
}
