"use client";

/**
 * @wfx/app-web — THE WATCH CHANNEL ROW (R29-B stage 1 — the corpus
 * watch-page-anatomy.md channel row, honestly backed).
 *
 * THE YOUTUBE GRAMMAR, HONESTLY BACKED:
 *
 * - the AVATAR (36–40px circular — the source's own monogram, the honest
 *   stand-in where the source carries no channel photo);
 * - the NAME (bold 14–16px): the source's own DISPLAY NAME when the
 *   runtime's sources model carries one (the N29 resolution — a real
 *   field, never a fabricated channel), else the connector id;
 * - the SUB-COUNT (12px secondary): honestly OMITTED — the source
 *   carries no subscriber count (never a fabricated number);
 * - the SUBSCRIBE PILL (h≈36 r18, the corpus red #f03-family on light /
 *   the #f1f1f1 variant on dark): wired to a REAL follow/save capability
 *   — the existing watchlist machinery's named-list write (the durable
 *   "Subscriptions" list, visible in Library → playlists). Never a dead
 *   button: the click performs the real library write with the typed
 *   outcome rendered verbatim (rollback on failure — never fake success).
 */

import { useCallback, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";

/** The channel row's serialized input (server-computed per render). */
export interface ChannelRowProps {
  /** The source's display name (the sources model's own field), when known. */
  readonly sourceName?: string;
  /** The connector id (the honest fallback identity). */
  readonly connectorId: string;
  /** The item's canonical identity (the subscribe write's input). */
  readonly itemId: string;
  readonly title: string;
  readonly externalRef: string;
  /** The initial subscribed truth (the runtime's own named-list state at render). */
  readonly initiallySubscribed: boolean;
  /** The honest meta line under the name (the way-of-watching truth). */
  readonly metaLine: string;
}

/** The named list the subscribe write targets (the Library's playlists section renders it). */
const SUBSCRIPTIONS_LIST = "Subscriptions";

/** The typed subscribe outcome the pill renders verbatim. */
interface SubscribeOutcome {
  readonly ok: boolean;
  readonly detail: string;
}

/** The watch channel row: avatar + name + the Subscribe pill. */
export function ChannelRow(props: ChannelRowProps): JSX.Element {
  const [subscribed, setSubscribed] = useState(props.initiallySubscribed);
  const [outcome, setOutcome] = useState<SubscribeOutcome | null>(null);
  const [pending, setPending] = useState(false);

  /** The subscribe/unsubscribe write (the same /api/library seam the watchlist uses). */
  const write = useCallback(async (): Promise<void> => {
    setPending(true);
    try {
      const response = await fetch("/api/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: subscribed ? "remove" : "save",
          itemId: props.itemId,
          title: props.title,
          connectorId: props.connectorId,
          externalRef: props.externalRef,
          listName: SUBSCRIPTIONS_LIST,
        }),
      });
      const result = (await response.json()) as { ok?: boolean; kind?: string; detail?: string };
      if (result.ok === true) {
        setSubscribed(!subscribed);
        setOutcome({
          ok: true,
          detail: subscribed
            ? "Unsubscribed — removed from your Subscriptions list."
            : "Subscribed — saved to your Subscriptions list in Library.",
        });
      } else {
        setOutcome({
          ok: false,
          detail: `${result.kind ?? "failed"}: ${result.detail ?? "the subscribe was refused"}`,
        });
      }
    } catch {
      setOutcome({ ok: false, detail: "The subscribe could not reach the host — nothing was written." });
    } finally {
      setPending(false);
    }
  }, [props.connectorId, props.externalRef, props.itemId, props.title, subscribed]);

  const name = props.sourceName !== undefined && props.sourceName.length > 0 ? props.sourceName : props.connectorId;
  return (
    <div className="wfx-channel" data-wfx-watch-channel>
      <span className="wfx-channel__avatar" aria-hidden="true">
        {name.length > 0 ? name[0]!.toUpperCase() : "W"}
      </span>
      <span className="wfx-channel__id">
        <p className="wfx-channel__name" data-wfx-watch-channel-name>
          {name}
        </p>
        {/* The honest sub-count: omitted (the source carries none —
            never a fabricated number). The meta line is the real
            way-of-watching truth (the journeys' mode-label contract). */}
        <p className="wfx-channel__meta" data-wfx-watch-channel-meta data-wfx-player-mode-label>
          {props.metaLine}
        </p>
      </span>
      <button
        type="button"
        className={`wfx-subscribe${subscribed ? " wfx-subscribe--on" : ""}`}
        onClick={() => {
          void write();
        }}
        disabled={pending}
        aria-pressed={subscribed}
        aria-label={subscribed ? `Unsubscribe from ${name}` : `Subscribe to ${name}`}
        data-wfx-subscribe
        data-wfx-subscribe-state={subscribed ? "subscribed" : "idle"}
      >
        {subscribed ? (
          <>
            <Icon name="check" size={18} />
            <span>Subscribed</span>
          </>
        ) : (
          <span>Subscribe</span>
        )}
      </button>
      {outcome !== null ? (
        <span
          className={`wfx-channel__note${outcome.ok ? "" : " wfx-channel__note--error"}`}
          role="status"
          data-wfx-subscribe-status
        >
          {outcome.detail}
        </span>
      ) : null}
    </div>
  );
}
