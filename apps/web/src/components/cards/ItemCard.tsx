/**
 * @wfx/app-web — the universal content card (R07; R28-B one-click play;
 * R36 the channel link-in).
 *
 * The card grammar over the RUNTIME's canonical-joined search hits: the
 * title, the canonical type badge, the duration, and the placeholder art.
 * The card deliberately carries NO capability or availability claim — the
 * search hit truthfully does not know either; the player surface answers
 * with the real capability truth (the UI honesty law: never a claim the
 * source did not make).
 *
 * R28-B — ONE-CLICK PLAY (the operator's #1 functional complaint: "you
 * have to click 3 times before a video plays"). The card's PRIMARY action
 * is the PLAYER href (card click → playback starts — the click is the
 * user gesture; the embed autoplays muted with an unmute affordance). The
 * /item detail surface survives as the DEEP surface — the card's quiet
 * action row carries a Details link, never the primary path.
 *
 * R36 — THE CHANNEL LINK-IN (the stretched-link law, YouTube's own DOM
 * grammar): the card's CHANNEL SLOT is now its own real link to the
 * channel page (`/channel/<handle>` — the handle law in `@/app/href`).
 * HTML forbids nested anchors, so the card adopts the corpus's own
 * pattern: the card VISUAL becomes a plain element and ONE play anchor
 * stretches over the whole lockup (an ::after overlay — the exact
 * `ytd-video-renderer` stretched-link technique), with the channel link
 * layered ABOVE it (z-index) so its clicks answer the channel, and every
 * other click answers the player. The play anchor keeps the card's
 * `data-wfx-card` + aria-label grammar VERBATIM (exactly ONE
 * `a[data-wfx-card]` per card — the journeys' finder + count
 * assertions hold), and the R33-C display-name seam is unchanged (the
 * link is additive). An item WITHOUT a joined source identity (the
 * per-process join missed it) renders UNLINKED — the honest state, never
 * a fabricated link.
 *
 * Server component: pure presentational projection of a `CardView`.
 */

import type { JSX } from "react";

import type { CardView } from "@/host/view-models";
import { channelHrefOf, playerHref } from "@/app/routing";
import { formatPosition, placeholderArt, placeholderMonogram } from "@/components/ui/format";
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
 * R36 — THE STRETCHED PLAY LINK: one anchor, the card's own href +
 * `data-wfx-card` + aria-label grammar, stretched over the lockup
 * through its ::after overlay (the CSS seam). The channel link (a
 * sibling above it) keeps its own clicks; every other click plays.
 */
function StretchPlayLink({
  playHref,
  card,
  label,
  variant,
}: {
  readonly playHref: string;
  readonly card: CardView;
  readonly label: string;
  readonly variant: "wide" | "short" | "result";
}): JSX.Element {
  return (
    <a
      className={`wfx-stretchlink${variant === "result" ? " wfx-stretchlink--result" : ""}`}
      href={playHref}
      data-wfx-card={card.itemId}
      aria-label={label}
      data-wfx-card-variant={variant}
    />
  );
}

/**
 * One content card. `variant="short"` renders the 9:16 vertical thumb of
 * the shorts rail (the no-channel-row grammar — the corpus shorts lockup
 * — UNCHANGED, its own single-anchor form). `resume` (optional) renders
 * the continue-watching affordances (progress bar + resume position).
 * `availability` (optional, R21-E) renders the compact where-to-watch
 * summary the search surface derives from the REAL resolve answer. An
 * item WITHOUT a joined source identity (the per-process join missed it)
 * renders UNLINKED — the honest state, never a fabricated link.
 *
 * R24-W2 — `actions` (optional, the surface's server-side context) adds
 * the QUIET ACTION ROW under the link (add to queue / save / share — the
 * same vocabulary the item hub and player carry), the policy-gated
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
  sourceName,
}: {
  readonly card: CardView;
  readonly variant?: "wide" | "short" | "result";
  readonly resume?: { readonly resumePositionMs: number; readonly completionRatio: number | null };
  readonly linked?: boolean;
  /** The compact availability summary (R21-E — the search surface's). */
  readonly availability?: string;
  /** R24-W2 — the cards' action context (queue/save/share + the preview policy). */
  readonly actions?: CardActionContextInput;
  /** R33-C (N29) — the sources model's displayName for card.connectorId (the honest channel identity; connector id fallback). */
  readonly sourceName?: string;
}): JSX.Element {
  // R33-C (N29) — the channel-slot identity: the sources model's own
  // displayName when the map carried one, else the connector id (the
  // honest fallback — the sources-model identity law).
  const channelName = sourceName !== undefined && sourceName.length > 0 ? sourceName : card.connectorId;
  const playHref = playerHref(
    {
      itemId: card.itemId,
      connectorId: card.connectorId,
      externalRef: card.externalRef,
      title: card.title,
      canonicalType: card.canonicalType,
      ...(card.durationMs !== undefined ? { durationMs: card.durationMs } : {}),
    },
    resume !== undefined && resume.resumePositionMs > 0 ? resume.resumePositionMs : undefined,
  );
  const label = `${card.title} (${card.canonicalType}${
    card.durationMs !== undefined ? `, ${formatPosition(card.durationMs)}` : ""
  })`;
  // R36 — the channel slot's own real destination (the handle law): the
  // channel page for this card's source identity. Rendered as a link
  // ONLY when the card itself is linked (an unlinked card carries no
  // fabricated link — the cards' own law).
  const channelHref = linked && card.connectorId.length > 0 ? channelHrefOf(card.connectorId) : null;
  // R27-W2 — the REAL-CATEGORY filter truth (the chip bar's seam): the
  // card names its canonical type + starts filter-active (the CSS hides
  // the non-matching when a topic chip is selected). R36: the marks ride
  // the LOCKUP (the filter hides the whole card — visual + stretch).
  const filterAttrs = {
    "data-wfx-card-type": card.canonicalType,
    "data-wfx-card-active": "true",
  };

  // R27-W2 — the SEARCH RESULT variant: the captured row grammar
  // (search-card-grammar.json) — thumbnail 360×202 left, 16px gap, the
  // meta column right (title 18/400/26 2-line, channel, meta, badges).
  if (variant === "result") {
    const resultCard = (
      <>
        {/* R36 — the lockup: the row VISUAL (a plain element now) + the
            stretched play anchor above the channel link. */}
        <span className="wfx-result" data-wfx-result-visual>
          <span className="wfx-result__thumb">
            <span className="wfx-card__art" aria-hidden="true">
              <span>{placeholderMonogram(card.title)}</span>
            </span>
            {card.artwork !== undefined ? (
              <ArtworkImage artwork={card.artwork} className="wfx-card__img" />
            ) : null}
            {card.durationMs !== undefined ? (
              <span className="wfx-card__badges">
                {/* R29-B (N19) — the corpus corner badge: 12/500 #fff on
                    rgba(0,0,0,0.6), r4, pad 1px 4px, 8px inset, the
                    m:ss / h:mm:ss format ("0:45" / "2:50:41"). */}
                <span className="wfx-badge wfx-badge--duration">{formatPosition(card.durationMs)}</span>
              </span>
            ) : null}
          </span>
          <span className="wfx-result__meta">
            <p className="wfx-result__title" data-wfx-card-title>
              {card.title}
            </p>
            <p className="wfx-result__metainfo">
              {availability !== undefined ? (
                <span data-wfx-card-availability>{availability}</span>
              ) : null}
            </p>
            {/* R29-B (N3) — the corpus channel row: the 24×24 avatar (the
                honest monogram — this host's sources carry no channel
                photos) + the 12px/400 channel name. R36 — the row is its
                own real LINK to the channel page (the stretched play
                anchor overlays the row; this link layers above it). */}
            <p className="wfx-result__channel">
              {linked && card.connectorId.length > 0 ? (
                <a
                  className="wfx-result__channellink"
                  href={channelHref!}
                  data-wfx-card-source
                  data-wfx-card-channel={card.connectorId}
                  aria-label={`Open the channel ${channelName}`}
                >
                  <span className="wfx-result__avatar" aria-hidden="true">
                    {channelName.length > 0 ? channelName[0]!.toUpperCase() : "W"}
                  </span>
                  From {channelName}
                </a>
              ) : (
                <span>Source unknown in this session</span>
              )}
            </p>
            {/* R29-B (N19) — the type badge is GONE from the visible row
                (the corpus search row carries no type label; the type
                stays in the aria-label + the filter seam + the detail
                surface's own meta). */}
          </span>
        </span>
        <StretchPlayLink playHref={playHref} card={card} label={label} variant="result" />
      </>
    );
    const lockup = (
      <span className="wfx-cardlock" {...filterAttrs}>
        {resultCard}
      </span>
    );
    const withActions = actions !== undefined ? (
      <>
        {lockup}
        <CardActions
          target={{
            itemId: card.itemId,
            connectorId: card.connectorId,
            externalRef: card.externalRef,
            title: card.title,
            canonicalType: card.canonicalType,
            ...(card.durationMs !== undefined ? { durationMs: card.durationMs } : {}),
            href: playHref,
            initiallySaved: actions.savedItemIds.includes(card.itemId),
          }}
        />
      </>
    ) : (
      lockup
    );
    return (
      <span className="wfx-cardwrap" data-wfx-cardwrap={card.itemId}>
        {actions !== undefined ? (
          <CardPreview
            itemId={card.itemId}
            title={card.title}
            attentionMode={actions.attentionMode}
            previewable={false}
            connectorId={card.connectorId}
            externalRef={card.externalRef}
            playHref={playHref}
            cardId={card.itemId}
          >
            {withActions}
          </CardPreview>
        ) : (
          withActions
        )}
      </span>
    );
  }

  // THE SHORTS VARIANT — the corpus shorts lockup (title below the
  // thumb, NOTHING else): UNCHANGED single-anchor form (no channel row,
  // no stretched link — the R33-C byte-law's own grammar).
  const shortsBody = (
    <>
      <span className="wfx-card__thumb wfx-card__thumb--vertical" style={{ background: placeholderArt(card.itemId) }}>
        <span className="wfx-card__art" aria-hidden="true">
          <span>{placeholderMonogram(card.title)}</span>
        </span>
        {card.artwork !== undefined ? (
          <ArtworkImage artwork={card.artwork} className="wfx-card__img" />
        ) : null}
      </span>
      <span className="wfx-card__body">
        <p className="wfx-card__title" data-wfx-card-title>
          {card.title}
        </p>
      </span>
    </>
  );

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
        {/* R29-B (N19) — THE CORPUS CORNER BADGE: the duration badge
            alone, bottom-right at the 8px inset (12/500 #fff on
            rgba(0,0,0,0.6), r4, pad 1px 4px, the m:ss / h:mm:ss
            format). The visible TYPE badge is gone (the corpus card
            carries no type label; the canonical type stays in the
            aria-label + the chip-filter seam + the detail surface). The
            SHORTS variant carries NO badge (the corpus shorts shelf —
            never a duration on a short). */}
        {variant !== "short" && card.durationMs !== undefined ? (
          <span className="wfx-card__badges">
            <span className="wfx-badge wfx-badge--duration">{formatPosition(card.durationMs)}</span>
          </span>
        ) : null}
        {resume !== undefined ? <Progress ratio={resume.completionRatio} /> : null}
      </span>
      <span className="wfx-card__body">
        <p className="wfx-card__title" data-wfx-card-title>
          {card.title}
        </p>
        {/* R29-B (N20) — the SHORTS SHELF card grammar: the title below
            the thumb, NOTHING else (the corpus lockup: no channel row,
            no meta — the shelf's own engagement model). */}
        {variant !== "short" ? (
          <>
            {/* R27-W2 — the channel row (the corpus: 14/400 secondary, hover
                primary): the card's honest source identity. R36 — the row
                is its own real LINK to the channel page (the additive
                link-in; the R33-C display-name seam unchanged). */}
            <p className="wfx-card__channel">
              {linked && card.connectorId.length > 0 ? (
                <a
                  className="wfx-card__channellink"
                  href={channelHref!}
                  data-wfx-card-source
                  data-wfx-card-channel={card.connectorId}
                  aria-label={`Open the channel ${channelName}`}
                >
                  From {channelName}
                </a>
              ) : (
                <span>Source unknown in this session</span>
              )}
            </p>
            <p className="wfx-card__meta">
              {linked && availability !== undefined ? (
                <span data-wfx-card-availability>{availability}</span>
              ) : null}
              {resume !== undefined && resume.resumePositionMs > 0 ? (
                <span data-wfx-resume-position>Resume at {formatPosition(resume.resumePositionMs)}</span>
              ) : null}
            </p>
          </>
        ) : null}
      </span>
    </>
  );

  // The shorts variant keeps its own single-anchor form (the pinned
  // grammar — no channel row, no stretched link).
  if (variant === "short") {
    return (
      <span className="wfx-cardwrap" data-wfx-cardwrap={card.itemId}>
        <a className="wfx-card" href={playHref} data-wfx-card={card.itemId} aria-label={label} {...filterAttrs}>
          {shortsBody}
        </a>
        {actions !== undefined ? (
          <CardActions
            target={{
              itemId: card.itemId,
              connectorId: card.connectorId,
              externalRef: card.externalRef,
              title: card.title,
              canonicalType: card.canonicalType,
              ...(card.durationMs !== undefined ? { durationMs: card.durationMs } : {}),
              href: playHref,
              initiallySaved: actions.savedItemIds.includes(card.itemId),
            }}
          />
        ) : null}
      </span>
    );
  }

  // R36 — the UNLINKED variant: the honest unlinked card (a plain
  // element, no fabricated links — the channel slot names the truth).
  if (!linked) {
    return (
      <span className="wfx-cardwrap" data-wfx-cardwrap={card.itemId}>
        <span className="wfx-card" data-wfx-card={card.itemId} aria-label={`${label} (unlinked)`} {...filterAttrs}>
          {body}
        </span>
        {actions !== undefined ? (
          <CardActions
            target={{
              itemId: card.itemId,
              connectorId: card.connectorId,
              externalRef: card.externalRef,
              title: card.title,
              canonicalType: card.canonicalType,
              ...(card.durationMs !== undefined ? { durationMs: card.durationMs } : {}),
              href: playHref,
              initiallySaved: actions.savedItemIds.includes(card.itemId),
            }}
          />
        ) : null}
      </span>
    );
  }

  // R36 — THE LINKED WIDE CARD (the stretched-link law): the card visual
  // (a plain element) + the ONE stretched play anchor over the lockup +
  // the channel link layered above it. R24-W2 — the action context keeps
  // the quiet action row below the lockup, and the policy-gated preview
  // mount wraps the whole lockup (hover/focus). R28-B — the hover
  // preview trigger rides the mount (the corpus: home feed + search rows
  // + channel grids preview; the SHORTS variant never does — a different
  // engagement model, documented in A's sheet).
  const wideLockup = (
    <span className="wfx-cardlock" {...filterAttrs}>
      <span className="wfx-card" data-wfx-card-visual>
        {body}
      </span>
      <StretchPlayLink playHref={playHref} card={card} label={label} variant="wide" />
    </span>
  );
  if (actions !== undefined) {
    const composedCard = (
      <>
        {wideLockup}
        <CardActions
          target={{
            itemId: card.itemId,
            connectorId: card.connectorId,
            externalRef: card.externalRef,
            title: card.title,
            canonicalType: card.canonicalType,
            ...(card.durationMs !== undefined ? { durationMs: card.durationMs } : {}),
            href: playHref,
            initiallySaved: actions.savedItemIds.includes(card.itemId),
          }}
        />
      </>
    );
    return (
      <span className="wfx-cardwrap" data-wfx-cardwrap={card.itemId}>
        <CardPreview
          itemId={card.itemId}
          title={card.title}
          attentionMode={actions.attentionMode}
          previewable={false}
          connectorId={card.connectorId}
          externalRef={card.externalRef}
          playHref={playHref}
          cardId={card.itemId}
        >
          {composedCard}
        </CardPreview>
      </span>
    );
  }
  return (
    <span className="wfx-cardwrap" data-wfx-cardwrap={card.itemId}>
      {wideLockup}
    </span>
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
