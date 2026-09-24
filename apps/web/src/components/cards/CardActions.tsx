"use client";

/**
 * @wfx/app-web — the card action kebab (R28-B: the corpus card grammar —
 * share-dialog.md's "Card 'More actions' button (40×40)" + the R28-B
 * background mandate: the always-visible quiet action ROW is the raised-
 * gray field C's pixel survey measured at 11.7% vs YouTube's <5%).
 *
 * THE YOUTUBE CARD GRAMMAR: the card is a clean link (title/channel/meta);
 * its actions live behind the 3-dot "More actions" button — the measured
 * menu: Add to queue, Save to playlist, Share (+ WebFlix's own Details —
 * the /item deep surface — and NO fabricated Download entry: the honest
 * vocabulary only, never a dead imitation).
 *
 * The native `details`/`summary` disclosure keeps the menu in the DOM
 * (SSR markup carries the same data-wfx-* contract the surfaces' tests
 * read), keyboard-operable for free, and closed by default.
 */

import { useCallback, useState, type JSX } from "react";

import { itemDetailHref } from "@/app/href";
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
  /** The card's canonical link (the item hub href — the share fallback target). */
  readonly href: string;
  /** Whether the item is already in the watchlist (the runtime's truth). */
  readonly initiallySaved?: boolean;
}

/** The add-to-queue control (the session queue's entry point — cards + the item hub). */
export function AddToQueueControl({ target, variant = "row" }: {
  readonly target: CardActionTarget;
  /** The trigger's form: the kebab's menu row, or the standalone row. */
  readonly variant?: "row" | "menu";
}): JSX.Element {
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

  const menu = variant === "menu";
  return (
    <span className={menu ? "wfx-kebab__menuwrap" : "wfx-card__actionwrap"} data-wfx-queue-add={menu ? "menu" : undefined}>
      <button
        type="button"
        className={menu ? "wfx-kebab__item" : "wfx-card__actionbtn"}
        onClick={() => {
          void add();
        }}
        aria-label={`Add ${target.title} to the queue`}
        aria-pressed={added}
        data-wfx-queue-add-btn
        data-wfx-queue-added={added ? "true" : "false"}
        title={outcome ?? (added ? "In your session queue" : "Add to the session queue")}
      >
        <Icon name={added ? "check" : "skip"} size={menu ? 20 : 16} />
        <span>{menu ? (added ? "Added to queue" : "Add to queue") : added ? "Queued" : "Queue"}</span>
      </button>
      {outcome !== null ? (
        <span className="wfx-card__actionstatus" role="status">
          {outcome}
        </span>
      ) : null}
    </span>
  );
}

/** The card's "More actions" kebab (the corpus menu: queue / save / share / details). */
export function CardActions({ target }: { readonly target: CardActionTarget }): JSX.Element {
  // The /item detail surface as the DEEP path (the card's primary
  // action is the player; Details is the menu's honest link).
  const detailHref = itemDetailHref({
    itemId: target.itemId,
    connectorId: target.connectorId,
    externalRef: target.externalRef,
    title: target.title,
    canonicalType: target.canonicalType,
    ...(target.durationMs !== undefined ? { durationMs: target.durationMs } : {}),
  });
  return (
    <details className="wfx-kebab" data-wfx-card-actions>
      <summary
        className="wfx-kebab__btn"
        aria-label={`Actions for ${target.title}`}
        title="More actions"
        data-wfx-card-kebab
      >
        <Icon name="more" size={20} />
      </summary>
      <div className="wfx-kebab__menu" data-wfx-card-menu>
        <AddToQueueControl target={target} variant="menu" />
        <WatchlistSave
          itemId={target.itemId}
          title={target.title}
          connectorId={target.connectorId}
          externalRef={target.externalRef}
          initiallySaved={target.initiallySaved === true}
          variant="menu"
        />
        <div className="wfx-kebab__share">
          <ShareControl
            canonicalHref={target.href}
            title={target.title}
            {...(target.connectorId.length > 0 ? { sourceId: target.connectorId } : {})}
            connectorId={target.connectorId}
            externalRef={target.externalRef}
            variant="menu"
          />
        </div>
        <a className="wfx-kebab__item wfx-kebab__item--link" href={detailHref} data-wfx-card-details>
          <Icon name="info" size={20} />
          <span>Details</span>
        </a>
      </div>
    </details>
  );
}
