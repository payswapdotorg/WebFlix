"use client";

/**
 * @wfx/app-web — THE SHORTS CHANNEL ROW (R32 — the G4 corpus join:
 * docs/parity-lab/r30/gap-captures/20260926-093102/G4-CORPUS.md
 * "THE CHANNEL ROW (bottom-left)").
 *
 * THE CAPTURED GRAMMAR, HONESTLY BACKED:
 * - the CHANNEL IDENTITY: the captured row renders the @handle
 *   ("@JackieMcReY"); WebFlix's truth is the SOURCES MODEL's own identity
 *   — the connector's displayName when the model carries one (the N29
 *   truth — the same field the watch page's channel row reads), else the
 *   connector id. NEVER a fabricated "@handle" form: WebFlix's sources
 *   carry display names, not handles (the honest-divergence ledger row).
 * - THE SUBSCRIBE PILL: 78×32-class (the captured rect), wired to the REAL
 *   subscribe seam — the SAME POST /api/library write the watch page's
 *   Subscribe pill, the rail subscriptions, and the subscriptions feed
 *   use (the durable "Subscriptions" named list; the runtime's one write
 *   path). Never a dead button: the click performs the real library write
 *   with the typed outcome rendered verbatim (rollback on failure — never
 *   fake success).
 * - THE COUNT/GEOMETRY ADAPTATION: the row renders at WebFlix's own
 *   shorts overlay scale; the pill's 78×32-class form is the row-local
 *   binding (height 32, radius 16, min-width 78 — the captured measures).
 *
 * THE STATE LAW (the shorts stack's own): the row is CONTROLLED by the
 * feed's session subscribed-record (the boot payload's library read +
 * this session's writes) — a swipe away and back re-renders the CURRENT
 * card's truth (unlike the watch page's one-item-per-load row, the feed's
 * current card changes in place; the feed owns the record so the pill
 * never renders a stale claim).
 */

import { useCallback, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";
import { SUBSCRIPTIONS_LIST } from "@/components/player/subscription-list";

/** The shorts channel row's serialized input (server-computed per render). */
export interface ShortsSubscribeRowProps {
  /** The source's display name (the sources model's own field), when known. */
  readonly channelName: string;
  /** The item's canonical identity (the subscribe write's input). */
  readonly itemId: string;
  /** The item's own title (the write's library row). */
  readonly title: string;
  /** The source identity (the durable join key). */
  readonly connectorId: string;
  readonly externalRef: string;
  /** The session's CURRENT subscribed truth for THIS item (controlled). */
  readonly subscribed: boolean;
  /** Report a settled write (the feed updates its session record). */
  readonly onSubscribedChange: (next: boolean) => void;
}

/** The typed subscribe outcome the row renders verbatim. */
interface SubscribeOutcome {
  readonly ok: boolean;
  readonly detail: string;
}

/** The shorts channel row: the source identity + the Subscribe pill. */
export function ShortsSubscribeRow(props: ShortsSubscribeRowProps): JSX.Element {
  const [outcome, setOutcome] = useState<SubscribeOutcome | null>(null);
  const [pending, setPending] = useState(false);

  /** The subscribe/unsubscribe write (the same /api/library seam the watch page's pill uses). */
  const write = useCallback(async (): Promise<void> => {
    setPending(true);
    try {
      const response = await fetch("/api/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: props.subscribed ? "remove" : "save",
          itemId: props.itemId,
          title: props.title,
          connectorId: props.connectorId,
          externalRef: props.externalRef,
          listName: SUBSCRIPTIONS_LIST,
        }),
      });
      const result = (await response.json().catch(() => null)) as
        | { ok?: boolean; kind?: string; detail?: string; error?: string }
        | null;
      if (result !== null && result.ok === true) {
        props.onSubscribedChange(!props.subscribed);
        setOutcome({
          ok: true,
          detail: props.subscribed
            ? "Unsubscribed — removed from your Subscriptions list."
            : "Subscribed — saved to your Subscriptions list in Library.",
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
  }, [props]);

  return (
    <div className="wfx-shortschannel" data-wfx-shorts-channel>
      {/* The identity truth: the sources model's own display name (the
          honest fallback: the connector id) — never a fabricated @handle. */}
      <p className="wfx-shortschannel__name" data-wfx-shorts-channel-name>
        {props.channelName}
      </p>
      {/* THE SUBSCRIBE PILL (G4-CORPUS.md "THE CHANNEL ROW": the 78x32
          pill) — the REAL subscribe seam, the same write the watch page's
          pill performs (never a dead imitation). */}
      <button
        type="button"
        className={`wfx-subscribe wfx-subscribe--shorts${props.subscribed ? " wfx-subscribe--on" : ""}`}
        onClick={() => {
          void write();
        }}
        disabled={pending}
        aria-pressed={props.subscribed}
        aria-label={props.subscribed ? `Unsubscribe from ${props.channelName}` : `Subscribe to ${props.channelName}`}
        data-wfx-shorts-subscribe
        data-wfx-shorts-subscribe-state={props.subscribed ? "subscribed" : "idle"}
      >
        {props.subscribed ? (
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
          className={`wfx-shortschannel__note${outcome.ok ? "" : " wfx-shortschannel__note--error"}`}
          role="status"
          data-wfx-shorts-subscribe-status
        >
          {outcome.detail}
        </span>
      ) : null}
    </div>
  );
}
