"use client";

/**
 * @wfx/app-web — the card action row (R24-W2, the R24-C placement law:
 * queue / watch-later / share "on cards, item detail and the player").
 *
 * THE QUIET CARD GRAMMAR: the card stays a clean link; the actions row
 * renders BELOW the link as small, quiet controls — Add to queue (the
 * session queue), Save (the WebFlix-native watchlist), Share (the
 * canonical link) — the same vocabulary the item hub and the player
 * carry, at the point of the content decision. One obvious primary
 * action (open the card); the actions row is subordinate and
 * progressively quiet (the design language's law).
 */

import { useCallback, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";
import { WatchlistSave } from "@/components/player/WatchlistSave";
import { ShareControl } from "@/components/player/ShareControl";

/** The action row's serialized card target (the card's own fields). */
export interface CardActionTarget {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly durationMs?: number;
  /** The card's canonical link (the item hub href — the share copy's target). */
  readonly href: string;
  /** Whether the item is already in the watchlist (the runtime's truth). */
  readonly initiallySaved?: boolean;
}

/** The add-to-queue control (the session queue's entry point — cards + the item hub). */
export function AddToQueueControl({ target }: { readonly target: CardActionTarget }): JSX.Element {
  const [added, setAdded] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const add = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "add",
          entry: {
            itemId: target.itemId,
            connectorId: target.connectorId,
            externalRef: target.externalRef,
            title: target.title,
            canonicalType: target.canonicalType,
            ...(target.durationMs !== undefined ? { durationMs: target.durationMs } : {}),
          },
        }),
      });
      const result = (await response.json()) as { ok?: boolean; detail?: string };
      if (result.ok === true) {
        setAdded(true);
        setOutcome(null);
      } else {
        setOutcome(result.detail ?? "the queue refused the add");
      }
    } catch {
      setOutcome("the add could not reach the host");
    }
  }, [target]);

  return (
    <span className="wfx-card__actionwrap" data-wfx-queue-add>
      <button
        type="button"
        className="wfx-card__actionbtn"
        onClick={() => {
          void add();
        }}
        aria-label={`Add ${target.title} to the queue`}
        aria-pressed={added}
        data-wfx-queue-add-btn
        data-wfx-queue-added={added ? "true" : "false"}
        title={outcome ?? (added ? "In your session queue" : "Add to the session queue")}
      >
        <Icon name={added ? "check" : "skip"} size={16} />
        <span className="wfx-card__actionlabel">{added ? "Queued" : "Queue"}</span>
      </button>
      {outcome !== null ? (
        <span className="wfx-card__actionstatus" role="status">
          {outcome}
        </span>
      ) : null}
    </span>
  );
}

/** The card action row: queue + watchlist save + share (the quiet row). */
export function CardActions({ target }: { readonly target: CardActionTarget }): JSX.Element {
  return (
    <div className="wfx-card__actions" data-wfx-card-actions>
      <AddToQueueControl target={target} />
      <WatchlistSave
        itemId={target.itemId}
        title={target.title}
        initiallySaved={target.initiallySaved === true}
        variant="compact"
      />
      <ShareControl
        canonicalHref={target.href}
        title={target.title}
        {...(target.connectorId.length > 0 ? { sourceId: target.connectorId } : {})}
      />
    </div>
  );
}
