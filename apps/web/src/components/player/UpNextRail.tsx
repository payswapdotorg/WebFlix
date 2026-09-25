"use client";

/**
 * @wfx/app-web — THE UP-NEXT RAIL, THE CORPUS SECONDARY COLUMN (R24-W2 →
 * R29-B N22 — the measured `ytd-compact-video-renderer` grammar).
 *
 * THE CORPUS ANATOMY (watch-page-anatomy.md): the section head "Up next"
 * with the AUTOPLAY paper-switch (`tp-yt-paper-toggle-button` — A/B
 * position states) at the head; the compact rows below — thumb 168×94
 * left, title (14px/500, 2-line clamp) + channel + meta right, 4px gaps
 * between rows; hover a row → the preview singleton (the same dwell-
 * gated system the cards use). One click on a row → the player (the
 * R28 one-click law).
 *
 * HONESTLY BACKED (the R24-W2 laws, unchanged): the QUEUE HEAD leads
 * when a session queue exists (the session-scoped store through
 * /api/queue: ordering only, never a hidden profile write), else the
 * RELATED projection (the trending pool minus this item). The autoplay
 * toggle DERIVES from the attention policy's vocabulary (never a raw
 * always-on switch — the policy sentence names the truth). The related
 * chips (All · From source · Related) are a REAL filter over the
 * projection; the queue panel's save action writes each entry through
 * the runtime's own library save with a list name (the Library's
 * playlists section renders the lists). Every mutation renders the
 * store's typed result verbatim; the queue is session-scoped (anonymous
 * viewers queue freely — no login wall).
 */

import { useCallback, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";
import { formatDuration, placeholderArt, placeholderMonogram } from "@/components/ui/format";
import { ArtworkImage } from "@/components/cards/ArtworkImage";
import { CardPreview } from "@/components/cards/CardPreview";
// The PURE href builder (client-safe — `@/app/routing` pulls the web-host
// seam's node:fs dev bridge, which client chunking contexts refuse).
import { playerHref } from "@/app/href";
import type { ArtworkView } from "@/host/view-models";

/** One rail card (the same card grammar as discovery — serialized server-side). */
export interface UpNextCard {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly durationMs?: number;
  /** The card's link (the one-click play href — the player autoplay target). */
  readonly href: string;
  /** R26-W2 — the card's REAL SOURCE ARTWORK when the content row carried one. */
  readonly artwork?: ArtworkView;
}

/** The rail's serialized view input (server-computed per render). */
export interface UpNextRailProps {
  /** The playing item's id (excluded from the related projection). */
  readonly currentItemId: string;
  /** The related/up-next projection (the trending pool minus this item). */
  readonly related: readonly UpNextCard[];
  /** R27-W2 — the playing item's source id (the related chips' real filter). */
  readonly sourceId?: string;
  /** The session queue's initial entries (the store's honest state). */
  readonly initialQueue: readonly {
    readonly itemId: string;
    readonly connectorId: string;
    readonly externalRef: string;
    readonly title: string;
    readonly canonicalType: string;
    readonly durationMs?: number;
  }[];
  /** The autoplay choice's initial state. */
  readonly initialAutoplay: boolean;
  /** The attention-policy sentence that governs autoplay (the derivation truth). */
  readonly autoplayPolicySentence: string;
  /** R29-B — the session's attention mode (the preview dwell policy). */
  readonly attentionMode: "mindful" | "balanced" | "immersive" | "custom";
}

/** The typed queue mutation outcome the panel renders verbatim. */
interface QueueOutcome {
  readonly ok: boolean;
  readonly detail: string | null;
}

/**
 * One compact row (the corpus renderer): 168×94 thumb left + the title
 * (14/500, 2-line clamp) + channel + meta right — wrapped in the
 * dwell-gated preview trigger (the same singleton the cards drive).
 */
function CompactRow({
  card,
  attentionMode,
  badge,
}: {
  readonly card: UpNextCard;
  readonly attentionMode: UpNextRailProps["attentionMode"];
  /** The honest provenance badge (the queue head's own). */
  readonly badge?: string;
}): JSX.Element {
  return (
    <CardPreview
      itemId={card.itemId}
      title={card.title}
      attentionMode={attentionMode}
      previewable={false}
      connectorId={card.connectorId}
      externalRef={card.externalRef}
      playHref={card.href}
      cardId={card.itemId}
    >
      <a className="wfx-upnext__link" href={card.href} aria-label={`Play next: ${card.title}`}>
        <span className="wfx-card__thumb wfx-card__thumb--rail" style={{ background: placeholderArt(card.itemId) }}>
          <span className="wfx-card__art" aria-hidden="true">
            <span>{placeholderMonogram(card.title)}</span>
          </span>
          {card.artwork !== undefined ? <ArtworkImage artwork={card.artwork} className="wfx-card__img" /> : null}
          {card.durationMs !== undefined ? (
            <span className="wfx-badge wfx-badge--duration">{formatDuration(card.durationMs)}</span>
          ) : null}
        </span>
        <span className="wfx-upnext__rowbody">
          <strong className="wfx-upnext__itemtitle">{card.title}</strong>
          <span className="wfx-upnext__itemmeta">
            {card.connectorId.length > 0 ? `From ${card.connectorId}` : card.canonicalType}
          </span>
          {badge !== undefined ? <span className="wfx-capchip">{badge}</span> : null}
        </span>
      </a>
    </CardPreview>
  );
}

/**
 * The Up-next rail: the corpus section head (Autoplay paper-switch) +
 * the compact rows (queue-first, related otherwise) + the related chips
 * (a real filter) + the session queue panel + the save-queue action.
 */
export function UpNextRail(props: UpNextRailProps): JSX.Element {
  const [queue, setQueue] = useState(props.initialQueue);
  const [autoplay, setAutoplay] = useState(props.initialAutoplay);
  const [outcome, setOutcome] = useState<QueueOutcome | null>(null);
  const [savedList, setSavedList] = useState<string | null>(null);
  // R27-W2 — the related chips' real filter state ("all" | "from-source"
  // | "related" — a REAL filter over the projection, never decorative).
  const [relatedFilter, setRelatedFilter] = useState<"all" | "from-source" | "related">("all");
  const relatedCards =
    relatedFilter === "all"
      ? props.related
      : relatedFilter === "from-source"
        ? props.related.filter((card) => card.connectorId === (props.sourceId ?? ""))
        : props.related.filter((card) => card.connectorId !== (props.sourceId ?? ""));

  /** POST one typed queue mutation; render the store's result. */
  const mutate = useCallback(async (body: Record<string, unknown>): Promise<QueueOutcome | null> => {
    try {
      const response = await fetch("/api/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        setOutcome({ ok: false, detail: error.error ?? `the host answered ${response.status}` });
        return null;
      }
      const result = (await response.json()) as {
        ok?: boolean;
        detail?: string;
        state?: { entries: typeof queue; autoplay: boolean };
        listName?: string;
        saved?: number;
      };
      if (result.state !== undefined) {
        setQueue(result.state.entries);
        setAutoplay(result.state.autoplay);
      }
      setOutcome(
        result.ok === false
          ? { ok: false, detail: result.detail ?? "the queue refused the action" }
          : { ok: true, detail: null },
      );
      return result as QueueOutcome;
    } catch {
      setOutcome({ ok: false, detail: "the action could not reach the host" });
      return null;
    }
  }, []);

  /** The queue head as a real card (the one-click play target — full identity). */
  const queueHead: UpNextCard | null =
    queue.length > 0 && queue[0] !== undefined
      ? {
          itemId: queue[0].itemId,
          connectorId: queue[0].connectorId,
          externalRef: queue[0].externalRef,
          title: queue[0].title,
          canonicalType: queue[0].canonicalType,
          ...(queue[0].durationMs !== undefined ? { durationMs: queue[0].durationMs } : {}),
          href: playerHref({
            itemId: queue[0].itemId,
            connectorId: queue[0].connectorId,
            externalRef: queue[0].externalRef,
            title: queue[0].title,
            canonicalType: queue[0].canonicalType,
            ...(queue[0].durationMs !== undefined ? { durationMs: queue[0].durationMs } : {}),
          }),
        }
      : null;
  const hasRows = queueHead !== null || relatedCards.length > 0;

  return (
    <aside className="wfx-upnext" aria-label="Up next and queue" data-wfx-up-next>
      {/* THE SECTION HEAD (the corpus grammar): "Up next" + the AUTOPLAY
          paper-switch — the toggle derives from the attention policy
          (never a raw always-on switch; the sentence names the truth). */}
      <div className="wfx-upnext__head">
        <h2 className="wfx-upnext__title">Up next</h2>
        <span className="wfx-upnext__autoplay" data-wfx-autoplay-row>
          <span className="wfx-upnext__autoplaylabel">Autoplay</span>
          <button
            type="button"
            role="switch"
            aria-checked={autoplay}
            aria-label="Autoplay"
            className={`wfx-switch${autoplay ? " wfx-switch--on" : ""}`}
            onClick={() => {
              void mutate({ action: "autoplay", enabled: !autoplay });
            }}
            data-wfx-autoplay-toggle
          >
            <span className="wfx-switch__knob" aria-hidden="true" />
          </button>
        </span>
      </div>
      <p className="wfx-upnext__policy" data-wfx-autoplay-policy>
        {props.autoplayPolicySentence}
      </p>

      {/* THE COMPACT ROWS (the corpus renderer list): the queue head
          first (its own provenance badge), the related projection after
          — 4px gaps, hover → the preview singleton, click → the player. */}
      {hasRows ? (
        <>
          {props.related.length > 0 ? (
            <div className="wfx-upnext__chips" role="group" aria-label="Filter related">
              <button
                type="button"
                className={`wfx-upnext__chip${relatedFilter === "all" ? " wfx-upnext__chip--active" : ""}`}
                onClick={() => {
                  setRelatedFilter("all");
                }}
                aria-pressed={relatedFilter === "all"}
                data-wfx-related-chip="all"
              >
                All
              </button>
              {props.sourceId !== undefined && props.sourceId.length > 0 ? (
                <button
                  type="button"
                  className={`wfx-upnext__chip${relatedFilter === "from-source" ? " wfx-upnext__chip--active" : ""}`}
                  onClick={() => {
                    setRelatedFilter("from-source");
                  }}
                  aria-pressed={relatedFilter === "from-source"}
                  data-wfx-related-chip="from-source"
                >
                  From {props.sourceId}
                </button>
              ) : null}
              <button
                type="button"
                className={`wfx-upnext__chip${relatedFilter === "related" ? " wfx-upnext__chip--active" : ""}`}
                onClick={() => {
                  setRelatedFilter("related");
                }}
                aria-pressed={relatedFilter === "related"}
                data-wfx-related-chip="related"
              >
                Related
              </button>
            </div>
          ) : null}
          <ul className="wfx-upnext__relatedlist" data-wfx-up-next-related>
            {queueHead !== null ? (
              <li data-wfx-up-next-card>
                <CompactRow card={queueHead} attentionMode={props.attentionMode} badge="From your queue" />
              </li>
            ) : null}
            {relatedCards.map((card) => (
              <li key={card.itemId}>
                <CompactRow card={card} attentionMode={props.attentionMode} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="wfx-upnext__empty">Nothing queued and nothing related yet — keep watching.</p>
      )}

      {/* THE SESSION QUEUE PANEL */}
      <div className="wfx-upnext__queue" data-wfx-queue-list>
        <h3 className="wfx-upnext__queuetitle">Queue</h3>
        {queue.length === 0 ? (
          <p className="wfx-upnext__empty" data-wfx-queue-empty>
            Your session queue is empty — add cards from anywhere you browse.
          </p>
        ) : (
          <ol className="wfx-upnext__queuelist">
            {queue.map((entry, index) => (
              <li key={entry.itemId} className="wfx-upnext__queueitem" data-wfx-queue-item={entry.itemId}>
                <span className="wfx-upnext__queueposition">{index + 1}</span>
                <span className="wfx-upnext__queuemeta">
                  <strong>{entry.title}</strong>
                  <span className="wfx-capchip">{entry.canonicalType}</span>
                </span>
                <span className="wfx-upnext__queueactions">
                  <button
                    type="button"
                    className="wfx-chrome__btn"
                    aria-label={`Move ${entry.title} up in the queue`}
                    onClick={() => {
                      void mutate({ action: "move", itemId: entry.itemId, direction: "up" });
                    }}
                  >
                    <Icon name="arrowUp" size={16} />
                  </button>
                  <button
                    type="button"
                    className="wfx-chrome__btn"
                    aria-label={`Move ${entry.title} down in the queue`}
                    onClick={() => {
                      void mutate({ action: "move", itemId: entry.itemId, direction: "down" });
                    }}
                  >
                    <Icon name="arrowDown" size={16} />
                  </button>
                  <button
                    type="button"
                    className="wfx-chrome__btn"
                    aria-label={`Remove ${entry.title} from the queue`}
                    onClick={() => {
                      void mutate({ action: "remove", itemId: entry.itemId });
                    }}
                  >
                    <Icon name="skip" size={16} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}
        {queue.length > 0 ? (
          <div className="wfx-upnext__queuefoot">
            <button
              type="button"
              className="wfx-btn wfx-btn--sm"
              onClick={() => {
                void mutate({ action: "save-playlist" }).then((result) => {
                  if (result !== null && result.ok) {
                    setSavedList("Queue");
                  }
                });
              }}
              data-wfx-queue-save
            >
              <Icon name="save" size={16} />
              Save queue to a playlist
            </button>
            <button
              type="button"
              className="wfx-btn wfx-btn--sm wfx-btn--ghost"
              onClick={() => {
                void mutate({ action: "clear" });
              }}
              data-wfx-queue-clear
            >
              Clear
            </button>
            {savedList !== null ? (
              <span className="wfx-upnext__saved" role="status" data-wfx-queue-saved>
                Saved to your Library playlist “{savedList}”.
              </span>
            ) : null}
          </div>
        ) : null}
        {outcome !== null && outcome.ok === false && outcome.detail !== undefined ? (
          <p className="wfx-upnext__error" role="status" data-wfx-queue-error>
            {outcome.detail}
          </p>
        ) : null}
      </div>
    </aside>
  );
}
