"use client";

/**
 * @wfx/app-web — R36 — THE INLINE CHANNEL SUBSCRIBE (the search
 * surface's channel-result row).
 *
 * The SAME one-store law as the channel page's pill (the frozen
 * Subscriptions list; the channel's REPRESENTATIVE item as the write's
 * key): one truth, one write path (POST /api/library), the typed
 * outcome rendered verbatim. Where the channel surfaces no item this
 * session, the pill renders its honest unavailable form (a link to the
 * channel page — where the real subscribe always exists) — never a
 * dead imitation.
 */

import { useCallback, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";
import { SUBSCRIPTIONS_LIST } from "@/components/player/subscription-list";
import type { ChannelSubscribeTarget } from "@/components/channel/ChannelEngagement";

/** The typed outcome the pill renders verbatim. */
interface SubscribeOutcome {
  readonly ok: boolean;
  readonly detail: string;
}

/** The inline Subscribe pill on a search channel-result row. */
export function ChannelInlineSubscribe({
  channelName,
  channelHref,
  representative,
  initiallySubscribed,
}: {
  /** The channel's honest display name. */
  readonly channelName: string;
  /** The channel page's href (the honest fallback destination). */
  readonly channelHref: string;
  /** The channel's representative item (the write's identity). */
  readonly representative: ChannelSubscribeTarget | null;
  /** The connector-scoped subscribed truth at render. */
  readonly initiallySubscribed: boolean;
}): JSX.Element {
  const [subscribed, setSubscribed] = useState(initiallySubscribed);
  const [outcome, setOutcome] = useState<SubscribeOutcome | null>(null);
  const [pending, setPending] = useState(false);

  const write = useCallback(async (): Promise<void> => {
    if (representative === null) {
      setOutcome({
        ok: false,
        detail: "This channel surfaces no item this session — open the channel to subscribe (never a fabricated key).",
      });
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: subscribed ? "remove" : "save",
          itemId: representative.itemId,
          title: representative.title,
          connectorId: representative.connectorId,
          externalRef: representative.externalRef,
          listName: SUBSCRIPTIONS_LIST,
        }),
      });
      const result = (await response.json().catch(() => null)) as
        | { ok?: boolean; kind?: string; detail?: string; error?: string }
        | null;
      if (result !== null && result.ok === true) {
        setSubscribed(!subscribed);
        setOutcome({
          ok: true,
          detail: subscribed
            ? `Unsubscribed — removed from your ${SUBSCRIPTIONS_LIST} list.`
            : `Subscribed — saved to your ${SUBSCRIPTIONS_LIST} list in Library.`,
        });
      } else {
        setOutcome({
          ok: false,
          detail:
            result !== null && (result.kind !== undefined || result.error !== undefined)
              ? `${result.kind ?? result.error}: ${result.detail ?? "the subscribe was refused"}`
              : `The subscribe was not written (${response.status}) — nothing changed.`,
        });
      }
    } catch {
      setOutcome({ ok: false, detail: "The subscribe could not reach the host — nothing was written." });
    } finally {
      setPending(false);
    }
  }, [representative, subscribed]);

  if (representative === null && !subscribed) {
    // The honest unavailable form: the channel page carries the real
    // subscribe — never a dead pill (the honest-absence law).
    return (
      <a
        className="wfx-subscribe wfx-subscribe--unavailable"
        href={channelHref}
        data-wfx-channel-inline-subscribe="unavailable"
        title="This channel surfaces no item this session — open the channel to subscribe"
      >
        <span>Subscribe</span>
      </a>
    );
  }
  return (
    <span className="wfx-channelinline" data-wfx-channel-inline-subscribe={subscribed ? "subscribed" : "idle"}>
      <button
        type="button"
        className={`wfx-subscribe${subscribed ? " wfx-subscribe--on" : ""}`}
        onClick={() => {
          void write();
        }}
        disabled={pending}
        aria-pressed={subscribed}
        aria-label={subscribed ? `Unsubscribe from ${channelName}` : `Subscribe to ${channelName}`}
        data-wfx-channel-subscribe
        data-wfx-channel-subscribe-state={subscribed ? "subscribed" : "idle"}
      >
        {subscribed ? (
          <>
            <Icon name="check" size={16} />
            <span>Subscribed</span>
          </>
        ) : (
          <span>Subscribe</span>
        )}
      </button>
      {outcome !== null ? (
        <span
          className={`wfx-channelinline__note${outcome.ok ? "" : " wfx-channelinline__note--error"}`}
          role="status"
          data-wfx-channel-subscribe-status
        >
          {outcome.detail}
        </span>
      ) : null}
    </span>
  );
}
