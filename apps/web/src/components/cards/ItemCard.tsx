/**
 * @wfx/app-web — the universal content card (R07).
 *
 * The card grammar over the RUNTIME's canonical-joined search hits: the
 * title, the canonical type badge, the duration, and the placeholder art.
 * The card deliberately carries NO capability or availability claim — the
 * search hit truthfully does not know either; capability truth renders on
 * the DETAIL surface, where the source's real metadata answers (the UI
 * honesty law: never a claim the source did not make).
 *
 * Server component: pure presentational projection of a `CardView`.
 */

import type { JSX } from "react";

import type { CardView } from "@/host/view-models";
import { itemDetailHref, playerHref } from "@/app/routing";
import { formatDuration, placeholderArt, placeholderMonogram } from "@/components/ui/format";
import { ArtworkImage } from "@/components/cards/ArtworkImage";
import { CardActions } from "@/components/cards/CardActions";
import { CardPreview } from "@/components/cards/CardPreview";

/** The target shape a card link needs (a `CardView` satisfies this). */
export type CardTarget = CardView;

/** The cards' action context (R24-W2 — the surface's server-side read). */
export interface CardActionContextInput {
  readonly attentionMode: "mindful" | "balanced" | "immersive" | "custom";
  readonly savedItemIds: readonly string[];
}

/** The continue-watching progress bar (ratio null ⇒ not rendered). */
function Progress({ ratio }: { readonly ratio: number | null }): JSX.Element | null {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  const pct = Math.min(Math.max(ratio, 0), 1) * 100;
  return (
    <span className="wfx-progress" data-wfx-progress aria-hidden="true">
      <span className="wfx-progress__fill" style={{ width: `${pct}%` }} />
    </span>
  );
}

/**
 * One content card. `variant="short"` renders the 9:16 vertical thumb of
 * the shorts rail. `resume` (optional) renders the continue-watching
 * affordances (progress bar + resume position). `availability` (optional,
 * R21-E) renders the compact where-to-watch summary the search surface
 * derives from the REAL resolve answer. An item WITHOUT a joined
 * source identity (the per-process join missed it) renders UNLINKED —
 * the honest state, never a fabricated link.
 *
 * R24-W2 — `actions` (optional, the surface's server-side context) adds
 * the QUIET ACTION ROW under the link (add to queue / save / share —
 * the same vocabulary the item hub and player carry), the policy-gated
 * preview mount (hover/focus, the attention mode's derivation), and the
 * source chip (the canonical source identity — the card grammar's own).
 */
export function ItemCard({
  card,
  variant = "wide",
  resume,
  linked = true,
  availability,
  actions,
}: {
  readonly card: CardView;
  readonly variant?: "wide" | "short";
  readonly resume?: { readonly resumePositionMs: number; readonly completionRatio: number | null };
  readonly linked?: boolean;
  /** The compact availability summary (R21-E — the search surface's). */
  readonly availability?: string;
  /** R24-W2 — the cards' action context (queue/save/share + the preview policy). */
  readonly actions?: CardActionContextInput;
}): JSX.Element {
  const href = itemDetailHref({
    itemId: card.itemId,
    connectorId: card.connectorId,
    externalRef: card.externalRef,
    title: card.title,
    canonicalType: card.canonicalType,
    ...(card.durationMs !== undefined ? { durationMs: card.durationMs } : {}),
  });
  const label = `${card.title} (${card.canonicalType}${
    card.durationMs !== undefined ? `, ${formatDuration(card.durationMs)}` : ""
  })`;
  const body = (
    <>
      <span
        className={`wfx-card__thumb${variant === "short" ? " wfx-card__thumb--vertical" : ""}`}
        style={{ background: placeholderArt(card.itemId) }}
      >
        {/* The typed placeholder fallback — ALWAYS present beneath the real
            artwork (a failed artwork load falls back to it; absent artwork
            simply keeps it — the real-artwork law's honest floor). */}
        <span className="wfx-card__art" aria-hidden="true">
          <span>{placeholderMonogram(card.title)}</span>
        </span>
        {/* R26-W2 — the REAL SOURCE ARTWORK (the connector-authorized URL);
            decorative inside the link (the link's label carries the title). */}
        {card.artwork !== undefined ? (
          <ArtworkImage artwork={card.artwork} className="wfx-card__img" />
        ) : null}
        <span className="wfx-card__badges">
          <span className="wfx-badge wfx-badge--type">{card.canonicalType}</span>
          {card.durationMs !== undefined ? (
            <span className="wfx-badge wfx-badge--duration">{formatDuration(card.durationMs)}</span>
          ) : null}
        </span>
        {resume !== undefined ? <Progress ratio={resume.completionRatio} /> : null}
      </span>
      <span className="wfx-card__body">
        <p className="wfx-card__title" data-wfx-card-title>
          {card.title}
        </p>
        {/* R27-W2 — the channel row (the corpus: 14/400 secondary, hover
            primary): the card's honest source identity. */}
        <p className="wfx-card__channel">
          {linked && card.connectorId.length > 0 ? (
            <span data-wfx-card-source>From {card.connectorId}</span>
          ) : (
            <span>Source unknown in this session</span>
          )}
        </p>
        <p className="wfx-card__meta">
          {linked ? (
            availability !== undefined ? (
              <span data-wfx-card-availability>{availability}</span>
            ) : (
              <span data-wfx-card-capability>Playback options on details</span>
            )
          ) : null}
          {resume !== undefined && resume.resumePositionMs > 0 ? (
            <span data-wfx-resume-position>Resume at {formatDuration(resume.resumePositionMs)}</span>
          ) : null}
        </p>
      </span>
    </>
  );
  // R27-W2 — the REAL-CATEGORY filter truth (the chip bar's seam): the
  // card names its canonical type + starts filter-active (the CSS hides
  // the non-matching when a topic chip is selected).
  const filterAttrs = {
    "data-wfx-card-type": card.canonicalType,
    "data-wfx-card-active": "true",
  };
  if (!linked) {
    return (
      <span className="wfx-card" data-wfx-card={card.itemId} aria-label={`${label} (unlinked)`} {...filterAttrs}>
        {body}
      </span>
    );
  }
  // R24-W2 — the card with its action context: the LINK stays the card
  // (one obvious primary action), the quiet action row renders BELOW it,
  // and the policy-gated preview mount wraps the link (hover/focus).
  if (actions !== undefined) {
    return (
      <span className="wfx-cardwrap" data-wfx-cardwrap={card.itemId}>
        <CardPreview
          itemId={card.itemId}
          title={card.title}
          attentionMode={actions.attentionMode}
          previewable={false}
        />
        <a className="wfx-card" href={href} data-wfx-card={card.itemId} aria-label={label} {...filterAttrs}>
          {body}
        </a>
        <CardActions
          target={{
            itemId: card.itemId,
            connectorId: card.connectorId,
            externalRef: card.externalRef,
            title: card.title,
            canonicalType: card.canonicalType,
            ...(card.durationMs !== undefined ? { durationMs: card.durationMs } : {}),
            href,
            initiallySaved: actions.savedItemIds.includes(card.itemId),
          }}
        />
      </span>
    );
  }
  return (
    <a className="wfx-card" href={href} data-wfx-card={card.itemId} aria-label={label} {...filterAttrs}>
      {body}
    </a>
  );
}

/** The play href for one card target (optionally with a resume position). */
export function cardPlayerHref(target: CardTarget, resumePositionMs?: number): string {
  return playerHref(
    {
      itemId: target.itemId,
      connectorId: target.connectorId,
      externalRef: target.externalRef,
      title: target.title,
      canonicalType: target.canonicalType,
      ...(target.durationMs !== undefined ? { durationMs: target.durationMs } : {}),
    },
    resumePositionMs,
  );
}
