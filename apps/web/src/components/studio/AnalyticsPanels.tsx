"use client";

/**
 * @wfx/app-web — R38-B — THE STUDIO ANALYTICS PANELS (the reach/
 * engagement/audience panels — per video + channel).
 *
 * THE HONEST-ANALYTICS LAW (the task packet, binding): analytics render
 * ONLY what the real local transport carries; every metric without
 * honest backing renders the TYPED ABSENCE state with its frozen
 * sentence — never a fabricated chart, never a seeded number, never a
 * fake axis.
 *
 * THE BACKING MAP (composed through studio-analytics.ts — the pure law):
 * - REACH: impressions = TYPED ABSENCE (no impression transport on this
 *   host; the source declares no view counts). Your own view = the
 *   session's watch-fold truth (server props — real).
 * - ENGAGEMENT: comments = this device's own comment record count (the
 *   same count the watch surface renders — loaded after mount); your
 *   reaction = this browser's own reactions record (the same store the
 *   watch page's split pill reads); saves = your library's named lists
 *   (server props — the runtime's own read).
 * - AUDIENCE: the subscriber count = the R36 typed absence (never
 *   fabricated) + your own subscription truth; demographics/geography =
 *   typed absences.
 *
 * No chart renders without real data — the absence cards carry their
 * sentences (the SearchFilters law: an option without real backing is
 * absent, never dead).
 */

import { useCallback, useEffect, useMemo, useState, type JSX } from "react";

import type { StudioItemSavesView, StudioChannelView, StudioItemSummary } from "@/host/studio-store/studio-views";
import { readCommentsOf } from "@/host/studio-store/studio-comments";
import {
  ANALYTICS_ABSENCE_NOTES,
  channelAnalyticsOf,
  videoAnalyticsRowOf,
  type ChannelAnalyticsView,
  type LocalItemTruths,
  type VideoAnalyticsRow,
} from "@/host/studio-store/studio-analytics";
import { readReaction } from "@/components/player/reactions-client";

/** The analytics island. */
export function AnalyticsPanels({
  channel,
  saves,
}: {
  /** The managed channel's studio view (the server truth). */
  readonly channel: StudioChannelView;
  /** The per-item library saves (the server truth — the runtime's own read). */
  readonly saves: Readonly<Record<string, StudioItemSavesView>>;
}): JSX.Element {
  // The local truths (comments + your reactions) load after mount — the
  // hydration law: the initial render matches the server, never a
  // fabricated pre-mount number.
  const [locals, setLocals] = useState<Record<string, LocalItemTruths> | null>(null);

  useEffect(() => {
    const next: Record<string, LocalItemTruths> = {};
    for (const item of channel.items) {
      next[item.itemId] = {
        commentsCount: readCommentsOf(item.itemId).length,
        yourReaction: readReaction(item.itemId),
      };
    }
    setLocals(next);
  }, [channel.items]);

  const channelPanel = useMemo<ChannelAnalyticsView>(
    () => channelAnalyticsOf(channel, locals ?? {}, saves),
    [channel, locals, saves],
  );

  const rows = useMemo<VideoAnalyticsRow[]>(
    () =>
      channel.items.map((item: StudioItemSummary) =>
        videoAnalyticsRowOf(item, locals?.[item.itemId] ?? { commentsCount: 0, yourReaction: null }, saves[item.itemId]),
      ),
    [channel.items, locals, saves],
  );

  /** One absence card (the typed state with its frozen sentence). */
  const AbsenceCard = useCallback(
    ({ metric, note }: { readonly metric: string; readonly note: string }): JSX.Element => (
      <div className="wfx-queue__item" data-wfx-analytics-absent={metric} style={{ display: "grid", gap: "4px" }}>
        <span className="wfx-card__meta" data-wfx-analytics-metric={metric}>
          {metric === "impressions"
            ? "Impressions"
            : metric === "subscribers"
              ? "Subscribers"
              : metric === "demographics"
                ? "Audience insights"
                : metric === "geography"
                  ? "Geography"
                  : metric}
        </span>
        <span className="wfx-row__reason" data-wfx-analytics-note={metric}>
          {note}
        </span>
      </div>
    ),
    [],
  );

  return (
    <section className="wfx-channel__section" aria-label="Channel analytics" data-wfx-studio-analytics>
      {/* THE CHANNEL PANELS (the aggregates + the absences — every slot honest). */}
      <div className="wfx-detail__section" data-wfx-studio-analytics-channel>
        <h2>Channel</h2>
        <ul className="wfx-queue__list" style={{ listStyle: "none", padding: 0, display: "grid", gap: "10px" }}>
          <li className="wfx-queue__item" data-wfx-analytics-real="yourViews" style={{ display: "grid", gap: "4px" }}>
            <span className="wfx-card__meta">Videos watched by you</span>
            <span className="wfx-card__title" data-wfx-analytics-value="yourViews">
              {channelPanel.yourViews.value}
            </span>
            <span className="wfx-row__reason">{channelPanel.yourViews.note}</span>
          </li>
          <li className="wfx-queue__item" data-wfx-analytics-real="totalComments" style={{ display: "grid", gap: "4px" }}>
            <span className="wfx-card__meta">Comments on this device&apos;s record</span>
            <span className="wfx-card__title" data-wfx-analytics-value="totalComments">
              {locals === null ? "…" : channelPanel.totalComments.value}
            </span>
            <span className="wfx-row__reason">{channelPanel.totalComments.note}</span>
          </li>
          <li className="wfx-queue__item" data-wfx-analytics-real="yourReactions" style={{ display: "grid", gap: "4px" }}>
            <span className="wfx-card__meta">Videos with your own reaction</span>
            <span className="wfx-card__title" data-wfx-analytics-value="yourReactions">
              {locals === null ? "…" : channelPanel.yourReactions.value}
            </span>
            <span className="wfx-row__reason">{channelPanel.yourReactions.note}</span>
          </li>
          <li className="wfx-queue__item" data-wfx-analytics-real="yourSaves" style={{ display: "grid", gap: "4px" }}>
            <span className="wfx-card__meta">Videos saved in your library</span>
            <span className="wfx-card__title" data-wfx-analytics-value="yourSaves">
              {channelPanel.yourSaves.value}
            </span>
            <span className="wfx-row__reason">{channelPanel.yourSaves.note}</span>
          </li>
          <li>
            <AbsenceCard metric="impressions" note={ANALYTICS_ABSENCE_NOTES.impressions} />
          </li>
          <li>
            <AbsenceCard metric="subscribers" note={ANALYTICS_ABSENCE_NOTES.subscribers} />
          </li>
          <li className="wfx-queue__item" data-wfx-analytics-real="youSubscribed" style={{ display: "grid", gap: "4px" }}>
            <span className="wfx-card__meta">Your own subscription truth</span>
            <span className="wfx-card__title" data-wfx-analytics-value="youSubscribed">
              {channelPanel.audience.youSubscribed.kind === "real" && channelPanel.audience.youSubscribed.value
                ? "You are subscribed"
                : "You are not subscribed"}
            </span>
            <span className="wfx-row__reason">{channelPanel.audience.youSubscribed.note}</span>
          </li>
          <li>
            <AbsenceCard metric="demographics" note={ANALYTICS_ABSENCE_NOTES.demographics} />
          </li>
        </ul>
        {locals === null ? (
          <p className="wfx-row__reason" data-wfx-studio-local-pending>
            Reading this device&apos;s own engagement records (comments, reactions)…
          </p>
        ) : null}
      </div>

      {/* THE PER-VIDEO PANELS (each row: reach + engagement + the absences). */}
      <div className="wfx-detail__section" data-wfx-studio-analytics-videos>
        <h2>Per video</h2>
        <ul className="wfx-queue__list" style={{ listStyle: "none", padding: 0 }}>
          {rows.map((row) => {
            const commentsCount = row.engagement.comments.kind === "real" ? row.engagement.comments.value : 0;
            return (
            <li
              key={row.item.itemId}
              className="wfx-queue__item"
              data-wfx-analytics-row={row.item.itemId}
              style={{ display: "grid", gap: "8px", padding: "12px 0", borderBottom: "1px solid var(--wfx-border, #ccc)" }}
            >
              <span className="wfx-card__title" data-wfx-analytics-row-title={row.item.itemId}>
                {row.item.title}
              </span>
              {/* REACH: the impressions absence + your own view truth. */}
              <span className="wfx-card__meta" data-wfx-analytics-reach={row.item.itemId}>
                Reach:{" "}
                <span data-wfx-analytics-note-impressions>
                  {row.reach.impressions.kind === "absent" ? "impressions not declared by any transport" : ""}
                </span>
                {" · "}
                {row.reach.yourView.kind === "real" ? (
                  <span data-wfx-analytics-row-yourview={row.item.itemId}>
                    watched by you
                    {row.reach.yourView.value.completionRatio !== null
                      ? ` (${Math.round(row.reach.yourView.value.completionRatio * 100)}% complete)`
                      : ""}
                  </span>
                ) : (
                  <span data-wfx-analytics-row-yourview={row.item.itemId}>not watched by you yet</span>
                )}
              </span>
              {/* ENGAGEMENT: the real local counts. */}
              <span className="wfx-card__meta" data-wfx-analytics-engagement={row.item.itemId}>
                Engagement:{" "}
                <span data-wfx-analytics-row-comments={row.item.itemId}>
                  {locals === null
                    ? "reading this device's record…"
                    : `${commentsCount} comment${commentsCount === 1 ? "" : "s"}`}
                </span>
                {" · "}
                <span data-wfx-analytics-row-reaction={row.item.itemId}>
                  {row.engagement.yourReaction.kind === "real"
                    ? `you ${row.engagement.yourReaction.value}d this`
                    : "no reaction recorded by you"}
                </span>
                {" · "}
                <span data-wfx-analytics-row-saves={row.item.itemId}>
                  {row.engagement.saves.kind === "real"
                    ? `saved in ${row.engagement.saves.value.join(", ")}`
                    : "not saved in your library"}
                </span>
              </span>
              {/* AUDIENCE: the absence sentence (per video). */}
              <span className="wfx-row__reason" data-wfx-analytics-note="subscribers">
                {ANALYTICS_ABSENCE_NOTES.subscribers}
              </span>
            </li>
            );
          })}
        </ul>
      </div>

      {/* The honest transport label. */}
      <p className="wfx-row__reason" data-wfx-studio-analytics-footnote>
        Analytics render only what the real local transport carries: your own views (the
        session&apos;s watch fold), your own comments and reactions (this device&apos;s records),
        and your own library saves. Every other metric renders its typed absence — never a
        fabricated chart, never a seeded number.
      </p>
    </section>
  );
}
