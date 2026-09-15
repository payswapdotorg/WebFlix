/**
 * @wfx/app-web — the universal content card (WFX-051).
 *
 * The YouTube-like card grammar: deterministic placeholder art (fixture
 * placeholders in dev — NO provider branding), the title, the canonical
 * type badge, the duration, and the source-CAPABILITY indicator. The
 * indicator is capability-aware by law: it states WHAT THE SOURCE CAN DO
 * for this content (embeddable / web player / external handoff / native),
 * never the source's identity as the dominant signal.
 *
 * Server component: pure presentational projection of a `CardView`.
 */

import type { JSX } from "react";

import type { CardView } from "@/host/views";
import { formatDuration, placeholderArt, placeholderMonogram } from "@/components/ui/format";

/** The playback capability labels (presence = the source's declared truth). */
function playCapabilityLabel(capabilities: readonly string[]): string | null {
  if (capabilities.includes("playEmbed")) return "Embeddable";
  if (capabilities.includes("playBrowser")) return "Web player";
  if (capabilities.includes("playExternal")) return "Opens externally";
  if (capabilities.includes("playNative")) return "Native";
  return null;
}

/** Build the detail-page href for one card (stable source identity). */
export function detailHref(card: CardView): string {
  const params = new URLSearchParams({
    connector: card.connectorId,
    ref: card.externalRef,
    title: card.title,
  });
  return `/item?${params.toString()}`;
}

/** The fields a player href needs (a `CardView` satisfies this structurally). */
export interface PlayerTarget {
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly durationMs?: number;
}

/** Build the player-page href for one target (optionally with resume). */
export function playerHref(target: PlayerTarget, resumePositionMs?: number, fromQuery?: string): string {
  const params = new URLSearchParams({
    connector: target.connectorId,
    ref: target.externalRef,
    title: target.title,
    type: target.canonicalType,
  });
  if (target.durationMs !== undefined) params.set("duration", String(target.durationMs));
  if (resumePositionMs !== undefined && resumePositionMs > 0) {
    params.set("resume", String(resumePositionMs));
  }
  if (fromQuery !== undefined) params.set("from", fromQuery);
  return `/player?${params.toString()}`;
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
 * affordances (progress bar + resume position).
 */
export function ItemCard({
  card,
  variant = "wide",
  resume,
}: {
  readonly card: CardView;
  readonly variant?: "wide" | "short";
  readonly resume?: { readonly resumePositionMs: number; readonly completionRatio: number | null };
}): JSX.Element {
  const capLabel = playCapabilityLabel(card.capabilities);
  return (
    <a
      className="wfx-card"
      href={detailHref(card)}
      data-wfx-card={card.itemId}
      aria-label={`${card.title} (${card.canonicalType}${
        card.durationMs !== undefined ? `, ${formatDuration(card.durationMs)}` : ""
      }${capLabel !== null ? `, ${capLabel}` : ""})`}
    >
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
          {capLabel !== null ? (
            <span className="wfx-capchip" data-wfx-card-capability>
              {capLabel}
            </span>
          ) : (
            <span className="wfx-capchip">No playback declared</span>
          )}
          {resume !== undefined && resume.resumePositionMs > 0 ? (
            <span data-wfx-resume-position>Resume at {formatDuration(resume.resumePositionMs)}</span>
          ) : null}
          {card.availability === "unavailable" ? <span>Currently unavailable</span> : null}
        </p>
      </span>
    </a>
  );
}
