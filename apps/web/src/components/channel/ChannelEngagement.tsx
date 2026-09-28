"use client";

/**
 * @wfx/app-web — R36 — THE CHANNEL ENGAGEMENT ISLAND (the Subscribe
 * pill + the bell menu on the channel page).
 *
 * THE ONE-STORE LAW: the channel page's Subscribe pill writes the SAME
 * Subscriptions library list the watch page's pill, the shorts channel
 * row, the rail subscriptions, and the subscriptions feed use (the
 * FROZEN name — one truth, never a second store). WebFlix's
 * subscriptions are canonical-ITEM-keyed, so the channel's pill writes
 * the channel's REPRESENTATIVE item (the first item of the channel's
 * own feed order — a real, honest choice) and the channel's subscribed
 * truth is the CONNECTOR-scoped read of the same list (the derivation
 * in `host/channel-views.ts`). Unsubscribing removes the channel's
 * subscribed entries — every typed outcome renders verbatim (rollback
 * on failure — never fake success).
 *
 * THE BELL LAW (the survey's row 19, honestly bound): the bell offers
 * All / Personalized / None as a PERSISTED per-channel preference
 * record (the browser's own local record — the same honest local
 * transport the reactions store uses). It records the user's choice;
 * the notification DELIVERY surface is a later wave — the menu says so
 * honestly (the frozen vocabulary: no notification source is connected
 * on this host, nothing is ever fabricated), never a dead imitation.
 * The bell renders only in the subscribed state (the corpus grammar:
 * the bell appears once subscribed).
 */

import { useCallback, useEffect, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";
import { SUBSCRIPTIONS_LIST } from "@/components/player/subscription-list";

/** The subscribe write's item identity (the channel's representative). */
export interface ChannelSubscribeTarget {
  readonly itemId: string;
  readonly title: string;
  readonly connectorId: string;
  readonly externalRef: string;
}

/** The bell preference vocabulary (the persisted per-channel record). */
export type BellPreference = "all" | "personalized" | "none";

/** The local store's key (the browser's own record — the honest local transport). */
const BELL_STORE_KEY = "wfx-channel-bells-v1";

/** The honest delivery note (the notification-source truth — the R30-B vocabulary). */
const BELL_DELIVERY_NOTE =
  "No notification source is connected on this host yet — your preference is recorded and will bind when delivery lands. WebFlix never fabricates notifications.";

/** Read the persisted per-channel preference (null = no choice recorded yet). */
function readBellPreference(connectorId: string): BellPreference | null {
  try {
    const raw = window.localStorage.getItem(BELL_STORE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[connectorId];
    return value === "all" || value === "personalized" || value === "none" ? value : null;
  } catch {
    return null;
  }
}

/** Persist the per-channel preference (the user's own choice, locally). */
function writeBellPreference(connectorId: string, preference: BellPreference): void {
  try {
    const raw = window.localStorage.getItem(BELL_STORE_KEY);
    const parsed = raw !== null ? (JSON.parse(raw) as Record<string, unknown>) : {};
    parsed[connectorId] = preference;
    window.localStorage.setItem(BELL_STORE_KEY, JSON.stringify(parsed));
  } catch {
    // The record could not persist (quota/security) — the in-view choice
    // still renders; the honest degradation, never a fabricated record.
  }
}

/** The typed subscribe outcome the pill renders verbatim. */
interface SubscribeOutcome {
  readonly ok: boolean;
  readonly detail: string;
}

/** The channel page's engagement cluster: the Subscribe pill + the bell. */
export function ChannelEngagement({
  channelName,
  representative,
  initiallySubscribed,
  subscribedItemIds,
}: {
  /** The channel's honest display name (the R33-C seam's own value). */
  readonly channelName: string;
  /** The channel's representative item (the subscribe write's identity). */
  readonly representative: ChannelSubscribeTarget | null;
  /** The connector-scoped subscribed truth at render. */
  readonly initiallySubscribed: boolean;
  /** The channel's subscribed entries' ids (the unsubscribe write's targets). */
  readonly subscribedItemIds: readonly string[];
}): JSX.Element {
  const [subscribed, setSubscribed] = useState(initiallySubscribed);
  const [outcome, setOutcome] = useState<SubscribeOutcome | null>(null);
  const [pending, setPending] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [bellPreference, setBellPreference] = useState<BellPreference | null>(null);

  // The persisted per-channel preference (the browser's own record).
  useEffect(() => {
    setBellPreference(readBellPreference(representative?.connectorId ?? ""));
  }, [representative?.connectorId]);

  // Close the bell menu on Escape + outside pointer (the dialog family's law).
  useEffect(() => {
    if (!bellOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setBellOpen(false);
    };
    const onPointer = (event: MouseEvent): void => {
      if (!(event.target instanceof Node)) return;
      const root = document.querySelector("[data-wfx-channel-bell]");
      if (root !== null && !root.contains(event.target)) setBellOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [bellOpen]);

  /** The subscribe write (the SAME /api/library seam every subscribe surface uses). */
  const subscribe = useCallback(async (): Promise<void> => {
    if (representative === null) {
      setOutcome({
        ok: false,
        detail:
          "This channel surfaces no item this session — nothing to key the subscription to (WebFlix does not fabricate one).",
      });
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "save",
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
        setSubscribed(true);
        setOutcome({
          ok: true,
          detail: `Subscribed — saved to your ${SUBSCRIPTIONS_LIST} list in Library.`,
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
  }, [representative]);

  /** The unsubscribe write: removes the channel's subscribed entries (every one). */
  const unsubscribe = useCallback(async (): Promise<void> => {
    const targets =
      subscribedItemIds.length > 0
        ? subscribedItemIds
        : representative !== null
          ? [representative.itemId]
          : [];
    if (targets.length === 0) {
      setOutcome({ ok: false, detail: "No stored subscription entry is known for this channel — nothing to remove." });
      return;
    }
    setPending(true);
    try {
      const results = await Promise.all(
        targets.map(async (itemId) => {
          const response = await fetch("/api/library", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ op: "remove", itemId }),
          });
          const result = (await response.json().catch(() => null)) as { ok?: boolean } | null;
          return result !== null && result.ok === true;
        }),
      );
      if (results.every((ok) => ok)) {
        setSubscribed(false);
        setBellOpen(false);
        setOutcome({
          ok: true,
          detail: `Unsubscribed — removed from your ${SUBSCRIPTIONS_LIST} list.`,
        });
      } else {
        setOutcome({
          ok: false,
          detail: `${results.filter((ok) => !ok).length} of ${results.length} removals were refused — reload to see the stored truth (never a fake success).`,
        });
      }
    } catch {
      setOutcome({ ok: false, detail: "The unsubscribe could not reach the host — nothing was removed." });
    } finally {
      setPending(false);
    }
  }, [representative, subscribedItemIds]);

  const effectivePreference: BellPreference = bellPreference ?? "personalized";

  return (
    <div className="wfx-channeleng" data-wfx-channel-engagement>
      <button
        type="button"
        className={`wfx-subscribe${subscribed ? " wfx-subscribe--on" : ""}`}
        onClick={() => {
          void (subscribed ? unsubscribe() : subscribe());
        }}
        disabled={pending}
        aria-pressed={subscribed}
        aria-label={subscribed ? `Unsubscribe from ${channelName}` : `Subscribe to ${channelName}`}
        data-wfx-channel-subscribe
        data-wfx-channel-subscribe-state={subscribed ? "subscribed" : "idle"}
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
      {subscribed ? (
        <span className="wfx-channelbell" data-wfx-channel-bell>
          <button
            type="button"
            className="wfx-channelbell__button"
            onClick={() => {
              setBellOpen((open) => !open);
            }}
            aria-expanded={bellOpen}
            aria-haspopup="menu"
            aria-label={`Notification preference for ${channelName}: ${effectivePreference}`}
            data-wfx-channel-bell-button
            data-wfx-channel-bell-preference={effectivePreference}
            title={`Notifications: ${effectivePreference}`}
          >
            <Icon name="bell" size={20} />
          </button>
          {bellOpen ? (
            <div className="wfx-channelbell__menu" role="menu" aria-label="Notifications" data-wfx-channel-bell-menu>
              <p className="wfx-channelbell__title">Notifications</p>
              {(
                [
                  { value: "all", label: "All" },
                  { value: "personalized", label: "Personalized" },
                  { value: "none", label: "None" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={effectivePreference === option.value}
                  className={`wfx-channelbell__option${effectivePreference === option.value ? " wfx-channelbell__option--active" : ""}`}
                  onClick={() => {
                    setBellPreference(option.value);
                    writeBellPreference(representative?.connectorId ?? "", option.value);
                  }}
                  data-wfx-channel-bell-option={option.value}
                >
                  {option.label}
                  {bellPreference === null && option.value === "personalized" ? (
                    <span className="wfx-channelbell__default" title="The default until you choose">
                      (default)
                    </span>
                  ) : null}
                </button>
              ))}
              <p className="wfx-channelbell__note" data-wfx-channel-bell-note>
                {BELL_DELIVERY_NOTE}
              </p>
            </div>
          ) : null}
        </span>
      ) : null}
      {outcome !== null ? (
        <span
          className={`wfx-channeleng__note${outcome.ok ? "" : " wfx-channeleng__note--error"}`}
          role="status"
          data-wfx-channel-subscribe-status
        >
          {outcome.detail}
        </span>
      ) : null}
    </div>
  );
}
