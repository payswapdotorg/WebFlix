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

/** The target shape a card link needs (a `CardView` satisfies this). */
export type CardTarget = CardView;

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
 * affordances (progress bar + resume position). An item WITHOUT a joined
 * source identity (the per-process join missed it) renders UNLINKED —
 * the honest state, never a fabricated link.
 */
export function ItemCard({
  card,
  variant = "wide",
  resume,
  linked = true,
}: {
  readonly card: CardView;
  readonly variant?: "wide" | "short";
  readonly resume?: { readonly resumePositionMs: number; readonly completionRatio: number | null };
  readonly linked?: boolean;
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
        <span className="wfx-card__art">
          <span>{placeholderMonogram(card.title)}</span>
        </span>
        <span className="wfx-card__badges">
          <span className="wfx-badge wfx-badge--type">{card.canonicalType}</span>
          {card.durationMs !== undefined ? (
            <span className="wfx-badge wfx-badge--duration">{formatDuration(card.durationMs)}</span>
          ) : null}
        </span>
        {resume !== undefined ? <Progress ratio={resume.completionRatio} /> : null}
      </span>
      <span>
        <p className="wfx-card__title" data-wfx-card-title>
          {card.title}
        </p>
        <p className="wfx-card__meta">
          {linked ? (
            <span className="wfx-capchip" data-wfx-card-capability>
              Playback options on details
            </span>
          ) : (
            <span className="wfx-capchip">Source unknown in this session</span>
          )}
          {resume !== undefined && resume.resumePositionMs > 0 ? (
            <span data-wfx-resume-position>Resume at {formatDuration(resume.resumePositionMs)}</span>
          ) : null}
        </p>
      </span>
    </>
  );
  if (!linked) {
    return (
      <span className="wfx-card" data-wfx-card={card.itemId} aria-label={`${label} (unlinked)`}>
        {body}
      </span>
    );
  }
  return (
    <a className="wfx-card" href={href} data-wfx-card={card.itemId} aria-label={label}>
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
