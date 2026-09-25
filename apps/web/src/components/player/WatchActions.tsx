"use client";

/**
 * @wfx/app-web — THE WATCH ACTION ROW (R29-B stage 1, the watch page's
 * second act — corpus docs/parity-lab/r28/youtube/watch-page-anatomy.md).
 *
 * THE YOUTUBE GRAMMAR, HONESTLY BACKED (the corpus's measured anatomy):
 *
 * - the LIKE/DISLIKE SPLIT PILL: a segmented control (36–40px pill,
 *   r18–20) — the like half (icon + the user's own count) | divider |
 *   the dislike half (icon only — YouTube never shows dislike counts).
 *   The like state is the USER'S OWN REAL ACTION on the honest local
 *   transport (`wfx-reactions-v1` — the R28 comments law: only real user
 *   actions counted, never fabricated counts; the count shows only what
 *   this browser actually did). When the source declares a like
 *   capability the click ALSO dispatches the provider action — the
 *   receipt names the sync truth (Synced / Recorded in WebFlix /
 *   unsupported — the J10 differentiation law), never a fabricated
 *   success;
 * - the SHARE PILL: the R28 unified share panel (ShareControl, the
 *   corpus dialog anatomy — unchanged);
 * - DOWNLOAD: honestly ABSENT (no download capability on the web
 *   adapter — never a fabricated entry);
 * - SAVE: the existing watchlist machinery (the WebFlix-native durable
 *   write through /api/library — offered regardless of provider
 *   capability);
 * - the OVERFLOW KEBAB "More actions": Add to queue / Save to playlist /
 *   Details — WebFlix's real vocabulary (the card kebab's own set).
 *
 * The row: w≈690 h42 at the wide band (the corpus geometry), the pills
 * 36px r18 on the raised surface.
 */

import { useCallback, useEffect, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";
import { readReaction, writeReaction } from "@/components/player/reactions-client";
import { ShareControl } from "@/components/player/ShareControl";
import { WatchlistSave } from "@/components/player/WatchlistSave";
import { WatchStateReporter } from "@/components/player/WatchStateReporter";

/** The provider like action's input (null ⇒ the source declares no like capability). */
export interface ProviderLikeInput {
  readonly connectorId: string;
  readonly externalRef: string;
  readonly itemId: string;
}

/** The kebab's queue-add outcome (rendered verbatim). */
interface QueueOutcome {
  readonly ok: boolean;
  readonly detail: string;
}

/** The action row's serialized input (server-computed per render). */
export interface WatchActionsProps {
  readonly itemId: string;
  readonly title: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly canonicalType: string;
  /** The canonical share href (the WebFlix link — the share panel's fallback). */
  readonly shareHref: string;
  /** The source's own URL when one exists (the share short-link derivation). */
  readonly sourceUrl?: string;
  /** The watchlist's initial truth (the runtime's own state at render). */
  readonly initiallySaved: boolean;
  /** The provider like action's input; null ⇒ the capability is absent (the pill stays local-only). */
  readonly providerLike: ProviderLikeInput | null;
  /** The watch-state report's input (the kebab's honest report rows). */
  readonly report: { readonly itemId: string; readonly playbackSessionId: string };
  /** The session's resume position (the report's offered position). */
  readonly resumePositionMs: number;
}

/** The provider receipt's honest sync note (the J10 vocabulary). */
interface SyncNote {
  readonly state: "synced" | "local-only" | "unsupported" | "failed" | "error";
  readonly detail: string;
}

/**
 * The watch action row — the split pill + Share + Save + the kebab.
 */
export function WatchActions(props: WatchActionsProps): JSX.Element {
  // The user's own reaction (the local record — the only count source).
  const [reaction, setReaction] = useState<"like" | "dislike" | null>(null);
  const [syncNote, setSyncNote] = useState<SyncNote | null>(null);
  const [queueOutcome, setQueueOutcome] = useState<QueueOutcome | null>(null);
  const [queueAdded, setQueueAdded] = useState(false);

  // Hydrate the local record at mount (the store is the browser's own).
  useEffect(() => {
    setReaction(readReaction(props.itemId));
  }, [props.itemId]);

  /** Fire the provider like dispatch (the real /api/actions path); record the receipt. */
  const dispatchProviderLike = useCallback(async (): Promise<void> => {
    if (props.providerLike === null) return;
    try {
      const response = await fetch("/api/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "like", ...props.providerLike }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || body === null || typeof body !== "object") {
        setSyncNote({
          state: "error",
          detail: `The like could not reach the source (${response.status}) — recorded in WebFlix only.`,
        });
        return;
      }
      const status = (body as { status?: unknown }).status;
      const detail = (body as { detail?: unknown }).detail;
      if (status === "confirmed") {
        setSyncNote({ state: "synced", detail: "Synced with the source (provider-confirmed)." });
      } else if (status === "local-only") {
        setSyncNote({
          state: "local-only",
          detail: "Recorded in WebFlix — external sync pending.",
        });
      } else if (status === "unsupported") {
        setSyncNote({
          state: "unsupported",
          detail: typeof detail === "string" && detail.length > 0 ? detail : "This source does not sync likes.",
        });
      } else {
        setSyncNote({
          state: "failed",
          detail: typeof detail === "string" && detail.length > 0 ? `The source declined: ${detail}` : "The source declined the like.",
        });
      }
    } catch {
      setSyncNote({
        state: "error",
        detail: "Network failure reaching the source — recorded in WebFlix only.",
      });
    }
  }, [props.providerLike]);

  /** Toggle the user's own reaction (the local record — the visible state). */
  const toggleReaction = useCallback(
    (kind: "like" | "dislike"): void => {
      const next = writeReaction(props.itemId, kind);
      setReaction(next);
      setSyncNote(null);
      if (next === "like") {
        void dispatchProviderLike();
      }
    },
    [dispatchProviderLike, props.itemId],
  );

  /** The kebab's Add-to-queue (the same /api/queue add the card kebab uses). */
  const addToQueue = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "add",
          entry: {
            itemId: props.itemId,
            connectorId: props.connectorId,
            externalRef: props.externalRef,
            title: props.title,
            canonicalType: props.canonicalType,
          },
        }),
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as { error?: string } | null;
        setQueueOutcome({ ok: false, detail: error?.error ?? `the host answered ${response.status}` });
        return;
      }
      setQueueAdded(true);
      setQueueOutcome({ ok: true, detail: "Added to the session queue." });
    } catch {
      setQueueOutcome({ ok: false, detail: "the add could not reach the host" });
    }
  }, [props.canonicalType, props.connectorId, props.externalRef, props.itemId, props.title]);

  const detailHref = `/item?id=${encodeURIComponent(props.itemId)}&connector=${encodeURIComponent(props.connectorId)}&ref=${encodeURIComponent(props.externalRef)}&title=${encodeURIComponent(props.title)}&type=${encodeURIComponent(props.canonicalType)}`;

  return (
    <div className="wfx-actions" data-wfx-watch-actions>
      {/* THE LIKE/DISLIKE SPLIT PILL (the corpus segmented control). */}
      <span className="wfx-actions__segmented" role="group" aria-label="Rate this video">
        <button
          type="button"
          className="wfx-actions__btn"
          onClick={() => {
            toggleReaction("like");
          }}
          aria-pressed={reaction === "like"}
          aria-label={reaction === "like" ? "Remove your like" : "Like this video"}
          data-wfx-action="like"
          data-wfx-reaction={reaction ?? "none"}
        >
          <Icon name="like" size={20} />
          {reaction === "like" ? <span data-wfx-like-count>1</span> : null}
          <span className="wfx-sr-only"> — the count is this browser&apos;s own record</span>
        </button>
        <span className="wfx-actions__divider" aria-hidden="true" />
        <button
          type="button"
          className="wfx-actions__btn"
          onClick={() => {
            toggleReaction("dislike");
          }}
          aria-pressed={reaction === "dislike"}
          aria-label={reaction === "dislike" ? "Remove your dislike" : "Dislike this video"}
          data-wfx-action="dislike"
        >
          <Icon name="dislike" size={20} />
        </button>
      </span>
      {/* THE SHARE PILL (the R28 unified share panel — the action row's own pill form). */}
      <ShareControl
        canonicalHref={props.shareHref}
        title={props.title}
        sourceId={props.connectorId}
        connectorId={props.connectorId}
        externalRef={props.externalRef}
        variant="row"
        {...(props.sourceUrl !== undefined ? { sourceUrl: props.sourceUrl } : {})}
      />
      {/* THE SAVE PILL (the WebFlix-native watchlist machinery — the
          playlist path + the typed status render in the row, the j40
          grammar preserved). */}
      <WatchlistSave
        itemId={props.itemId}
        title={props.title}
        connectorId={props.connectorId}
        externalRef={props.externalRef}
        initiallySaved={props.initiallySaved}
        variant="row"
      />
      {/* THE OVERFLOW KEBAB "More actions" (WebFlix's real vocabulary: the
          card kebab's own set + the player's honest watch-state reports). */}
      <details className="wfx-kebab wfx-kebab--watch" data-wfx-watch-kebab>
        <summary className="wfx-kebab__btn" aria-label="More actions" title="More actions" data-wfx-watch-kebab-summary>
          <Icon name="more" size={20} />
        </summary>
        <div className="wfx-kebab__menu" data-wfx-watch-kebab-menu>
          <button
            type="button"
            className="wfx-kebab__item"
            onClick={() => {
              void addToQueue();
            }}
            data-wfx-queue-add-btn
            data-wfx-queue-added={queueAdded ? "true" : "false"}
          >
            <Icon name="plus" size={20} />
            {queueAdded ? "Added to queue" : "Add to queue"}
          </button>
          <WatchlistSave
            itemId={props.itemId}
            title={props.title}
            connectorId={props.connectorId}
            externalRef={props.externalRef}
            initiallySaved={props.initiallySaved}
            variant="menu"
          />
          {/* The honest watch-state reports (the player's own explicit
              engagement truth — the kebab's rows, never a fake progress). */}
          <WatchStateReporter
            report={{ itemId: props.itemId, type: "complete", playbackSessionId: props.report.playbackSessionId }}
            resumePositionMs={props.resumePositionMs}
            variant="menu"
          />
          <a className="wfx-kebab__item wfx-kebab__item--link" href={detailHref} data-wfx-watch-details>
            <Icon name="info" size={20} />
            Details
          </a>
        </div>
      </details>
      {/* The honest sync/queue notes (typed, verbatim — never fabricated success). */}
      {syncNote !== null ? (
        <span
          className={`wfx-actions__note${syncNote.state === "synced" ? " wfx-actions__note--synced" : ""}${
            syncNote.state === "unsupported" || syncNote.state === "failed" || syncNote.state === "error" ? " wfx-actions__note--error" : ""
          }`}
          role="status"
          data-wfx-like-sync={syncNote.state}
        >
          {syncNote.detail}
        </span>
      ) : null}
      {queueOutcome !== null && !queueOutcome.ok ? (
        <span className="wfx-actions__note wfx-actions__note--error" role="status" data-wfx-queue-error>
          {queueOutcome.detail}
        </span>
      ) : null}
    </div>
  );
}
