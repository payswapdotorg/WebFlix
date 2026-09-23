"use client";

/**
 * @wfx/app-web — the Up-next rail + the session queue (R24-W2, the
 * R24-C rows: up-next / queue / save-queue / autoplay).
 *
 * THE FAMILIAR ADJACENT-CONTENT GRAMMAR, HONESTLY BACKED: the rail
 * beside the player answers "what plays next?" the way a mature video
 * product does — the QUEUE HEAD when a session queue exists (the
 * session-scoped store through /api/queue: ordering only, never a
 * hidden profile write), else the RELATED projection (the same
 * trending-pool cards the item hub renders). The autoplay toggle on
 * the Up-next card DERIVES from the attention policy's vocabulary
 * (never a raw always-on switch), and the queue panel's save action
 * writes each entry through the runtime's own library save with a list
 * name (the save-queue pairing: one canonical write path, the Library's
 * playlists section renders the lists).
 *
 * Honesty laws: every mutation renders the store's typed result
 * verbatim (a refused action names its reason); the queue is
 * session-scoped (anonymous viewers queue freely — no login wall); the
 * autoplay sentence names the policy truth (the Personalize seam).
 */

import { useCallback, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";
import { formatDuration, placeholderArt, placeholderMonogram } from "@/components/ui/format";
import { ArtworkImage } from "@/components/cards/ArtworkImage";
import type { ArtworkView } from "@/host/view-models";

/** One rail card (the same card grammar as discovery — serialized server-side). */
export interface UpNextCard {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly durationMs?: number;
  /** The card's link (the item hub href — the same navigation every card uses). */
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
    readonly title: string;
    readonly canonicalType: string;
    readonly durationMs?: number;
  }[];
  /** The autoplay choice's initial state. */
  readonly initialAutoplay: boolean;
  /** The attention-policy sentence that governs autoplay (the derivation truth). */
  readonly autoplayPolicySentence: string;
}

/** The typed queue mutation outcome the panel renders verbatim. */
interface QueueOutcome {
  readonly ok: boolean;
  readonly detail: string | null;
}

/**
 * The Up-next rail: the next thing to watch (queue-first, related
 * otherwise) + the session queue panel + the autoplay toggle + the
 * save-queue action.
 */
export function UpNextRail(props: UpNextRailProps): JSX.Element {
  const [queue, setQueue] = useState(props.initialQueue);
  const [autoplay, setAutoplay] = useState(props.initialAutoplay);
  const [outcome, setOutcome] = useState<QueueOutcome | null>(null);
  const [savedList, setSavedList] = useState<string | null>(null);
  // R27-W2 — the related chips' real filter state ("all" | "from-source"
  // | "related" — the corpus chips row above the compact cards).
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

  /** The up-next card: the queue head, else the first related card. */
  const upNext: UpNextCard | null =
    queue.length > 0
      ? {
          itemId: queue[0]!.itemId,
          connectorId: "",
          externalRef: "",
          title: queue[0]!.title,
          canonicalType: queue[0]!.canonicalType,
          ...(queue[0]!.durationMs !== undefined ? { durationMs: queue[0]!.durationMs } : {}),
          href: "#queue-head",
        }
      : props.related[0] ?? null;

  return (
    <aside className="wfx-upnext" aria-label="Up next and queue" data-wfx-up-next>
      <h2 className="wfx-upnext__title">Up next</h2>

      {/* THE UP-NEXT CARD (queue-first, related otherwise) */}
      {upNext !== null ? (
        <div className="wfx-upnext__card" data-wfx-up-next-card>
          <a
            className="wfx-upnext__link"
            href={upNext.href}
            aria-label={`Play next: ${upNext.title}`}
            data-wfx-up-next-link
          >
            <span className="wfx-card__thumb wfx-card__thumb--rail" style={{ background: placeholderArt(upNext.itemId) }}>
              <span className="wfx-card__art" aria-hidden="true">
                <span>{placeholderMonogram(upNext.title)}</span>
              </span>
              {upNext.artwork !== undefined ? (
                <ArtworkImage artwork={upNext.artwork} className="wfx-card__img" />
              ) : null}
              {upNext.durationMs !== undefined ? (
                <span className="wfx-badge wfx-badge--duration">{formatDuration(upNext.durationMs)}</span>
              ) : null}
            </span>
            <span>
              <strong className="wfx-upnext__itemtitle">{upNext.title}</strong>
              <span className="wfx-capchip">
                {queue.length > 0 ? "From your queue" : "Related on your sources"}
              </span>
            </span>
          </a>
          {/* THE AUTOPLAY TOGGLE (attention-policy-derived — never raw) */}
          <label className="wfx-upnext__autoplay">
            <input
              type="checkbox"
              checked={autoplay}
              onChange={(event) => {
                void mutate({ action: "autoplay", enabled: event.target.checked });
              }}
              data-wfx-autoplay-toggle
            />
            <span>Autoplay</span>
          </label>
          <p className="wfx-upnext__policy" data-wfx-autoplay-policy>
            {props.autoplayPolicySentence}
          </p>
        </div>
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

      {/* THE RELATED RAIL (the adjacent-content projection — the same
          cards) with the corpus CHIPS ROW (All · From <source> · Related
          — a REAL filter over the projection, never decorative). */}
      {props.related.length > 0 ? (
        <div className="wfx-upnext__related" data-wfx-up-next-related>
          <h3 className="wfx-upnext__queuetitle">More to explore</h3>
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
          <ul className="wfx-upnext__relatedlist">
            {relatedCards.slice(0, 6).map((card) => (
              <li key={card.itemId}>
                <a className="wfx-upnext__link" href={card.href} aria-label={card.title}>
                  <span
                    className="wfx-card__thumb wfx-card__thumb--rail"
                    style={{ background: placeholderArt(card.itemId) }}
                  >
                    <span className="wfx-card__art" aria-hidden="true">
                      <span>{placeholderMonogram(card.title)}</span>
                    </span>
                    {card.artwork !== undefined ? (
                      <ArtworkImage artwork={card.artwork} className="wfx-card__img" />
                    ) : null}
                    {card.durationMs !== undefined ? (
                      <span className="wfx-badge wfx-badge--duration">{formatDuration(card.durationMs)}</span>
                    ) : null}
                  </span>
                  <span>
                    <strong className="wfx-upnext__itemtitle">{card.title}</strong>
                    <span className="wfx-upnext__itemmeta">
                      {card.connectorId.length > 0 ? `From ${card.connectorId}` : card.canonicalType}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
