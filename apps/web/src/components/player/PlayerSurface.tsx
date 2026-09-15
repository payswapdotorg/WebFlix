/**
 * @wfx/app-web — the player surface (WFX-051).
 *
 * Renders the RESOLVED Media Surface mode of a started playback session —
 * the frozen precedence made visible:
 *
 * - `embed`   → the provider's player in an iframe (the fixture URLs are
 *               visible placeholders — no provider branding is faked);
 * - `browser` → the web-player panel with a visible open link (the web
 *               platform has NO contained in-app browser host — typed-absent
 *               in the 040 profile — so the honest surface is the visible
 *               handoff to the provider's web player, never a fake frame);
 * - `external`→ the external handoff: what leaves, where it goes, and a
 *               visible link — never fake playback, never a hidden handoff;
 * - `native`  → the typed honest note (unreachable on web by the device
 *               gate — the resolver rejects native; rendered defensively).
 *
 * The precedence trace (WHY this platform plays it this way) renders under
 * the stage — the audit is part of the product, not a debug log. Server
 * component; the interactive controls (watch-state reports, like/save) are
 * the client islands `WatchStateReporter` and `ActionButtons`.
 */

import type { JSX } from "react";

import type { PlayerView } from "@/host/views";
import type { ExperienceFailure } from "@/shared/runtime";
import { playerHref } from "@/components/cards/ItemCard";
import { ActionButtons } from "@/components/player/ActionButtons";
import { WatchStateReporter } from "@/components/player/WatchStateReporter";
import { Icon } from "@/components/shell/Icon";
import { ErrorState } from "@/components/ui/StateViews";
import { formatPosition, placeholderArt, placeholderMonogram } from "@/components/ui/format";

/** The typed failure copy of the Experience failure taxonomy (verbatim reasons). */
function failureDetail(failure: ExperienceFailure): string {
  switch (failure.reason) {
    case "unsupported":
      return `The source declares none of the playback capabilities this platform can use (${failure.detail}).`;
    case "unresolvable":
      return `No realizable playback mode on this platform: ${failure.detail}`;
    case "not-found":
      return `The playback session is unknown to this host: ${failure.detail}`;
    case "port-failed":
      return `The source transport failed: ${failure.detail}`;
  }
}

/** The resolved stage — one branch per Media Surface mode. */
function Stage({ view }: { readonly view: Extract<PlayerView, { kind: "playing" }> }): JSX.Element {
  if (view.surfaceMode === "embed" && view.surfaceUrl !== null) {
    return (
      <div className="wfx-player__stage" data-wfx-player-mode="embed">
        <iframe
          src={view.surfaceUrl}
          title={`Embedded playback: ${view.title}`}
          allow="fullscreen; picture-in-picture; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
          data-wfx-player-frame
        />
      </div>
    );
  }
  if (view.surfaceMode === "embed") {
    return (
      <div className="wfx-player__handoff" data-wfx-player-mode="embed-no-url">
        <Icon name="browser" size={28} />
        <p>
          The source declared embedded playback but provided no embed URL for this content. WebFlix
          does not fabricate a player around an absent URL.
        </p>
      </div>
    );
  }
  if (view.surfaceMode === "browser") {
    return (
      <div className="wfx-player__handoff" data-wfx-player-mode="browser">
        <Icon name="browser" size={28} />
        <p>
          This content plays in the source&apos;s own web player. The web platform has no contained
          in-app browser (an honest platform limitation), so the handoff is visible:
        </p>
        {view.surfaceUrl !== null ? (
          <a
            className="wfx-btn wfx-btn--primary"
            href={view.surfaceUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-wfx-player-open
          >
            <Icon name="external" size={18} />
            Open web player
          </a>
        ) : (
          <p>The source provided no web-player URL for this content.</p>
        )}
        {view.surfaceUrl !== null ? <code>{view.surfaceUrl}</code> : null}
      </div>
    );
  }
  if (view.surfaceMode === "external") {
    return (
      <div className="wfx-player__handoff" data-wfx-player-mode="external">
        <Icon name="external" size={28} />
        <p>
          This content opens on its source — the provider keeps the playback path. WebFlix never
          fakes in-app playback for content it cannot legally or technically host.
        </p>
        {view.surfaceUrl !== null ? (
          <a
            className="wfx-btn wfx-btn--primary"
            href={view.surfaceUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-wfx-player-open
          >
            <Icon name="external" size={18} />
            Open on the source
          </a>
        ) : (
          <p>
            The source named the handoff by reference only (<code>{view.externalRef}</code>) — no
            URL was provided.
          </p>
        )}
        {view.surfaceUrl !== null ? <code>{view.surfaceUrl}</code> : null}
      </div>
    );
  }
  // native — unreachable on the web platform (the device gate rejects it);
  // rendered as the typed honest note, never a crash.
  return (
    <div className="wfx-player__handoff" data-wfx-player-mode="native">
      <Icon name="play" size={28} />
      <p>
        Native playback is not available on the web platform — this device cannot realize the
        native media path (the precedence trace below records the rejection).
      </p>
    </div>
  );
}

/** One up-next queue list (shared by the playing and failed states). */
function QueueList({ view }: { readonly view: PlayerView }): JSX.Element | null {
  if (view.queue.length === 0) return null;
  return (
    <section className="wfx-queue" aria-label="Up next" data-wfx-queue>
      <h2>Up next</h2>
      <ul className="wfx-queue__list">
        {view.queue.map(({ card }) => (
          <li key={card.itemId}>
            <a className="wfx-queue__item" href={playerHref(card)}>
              <span className="wfx-queue__thumb" style={{ background: placeholderArt(card.itemId) }}>
                <span className="wfx-card__art">
                  <span>{placeholderMonogram(card.title)}</span>
                </span>
              </span>
              <span className="wfx-queue__body">
                <p className="wfx-queue__title">{card.title}</p>
                <p className="wfx-queue__meta">
                  {card.canonicalType}
                  {card.durationMs !== undefined ? ` · ${formatPosition(card.durationMs)}` : ""}
                </p>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The player surface. */
export function PlayerSurface({ view }: { readonly view: PlayerView }): JSX.Element {
  if (view.kind === "failed") {
    return (
      <div className="wfx-player" data-wfx-surface="player" data-wfx-player-state="failed">
        <h1 className="wfx-player__title" data-wfx-player-title>
          {view.title}
        </h1>
        <ErrorState
          title="Playback could not start"
          detail={failureDetail(view.failure)}
          retry={
            <a
              className="wfx-btn"
              href={`/item?connector=${encodeURIComponent(view.connectorId)}&ref=${encodeURIComponent(view.externalRef)}&title=${encodeURIComponent(view.title)}`}
            >
              View details
            </a>
          }
        />
        <QueueList view={view} />
      </div>
    );
  }
  return (
    <div className="wfx-player" data-wfx-surface="player" data-wfx-player-state="playing">
      <Stage view={view} />
      <div className="wfx-player__meta">
        <h1 className="wfx-player__title" data-wfx-player-title>
          {view.title}
        </h1>
        <p className="wfx-detail__meta">
          <span className="wfx-badge wfx-badge--type">{view.canonicalType}</span>
          <span data-wfx-player-mode-label>Playing via {view.surfaceMode}</span>
          {view.resumePositionMs > 0 ? (
            <span data-wfx-player-resume>Resumed at {formatPosition(view.resumePositionMs)}</span>
          ) : null}
        </p>
        <div className="wfx-actionbar">
          <ActionButtons
            like={
              view.canLike
                ? {
                    type: "like",
                    connectorId: view.connectorId,
                    externalRef: view.externalRef,
                    itemId: view.itemId,
                  }
                : null
            }
            save={
              view.canSave
                ? {
                    type: "save",
                    connectorId: view.connectorId,
                    externalRef: view.externalRef,
                    itemId: view.itemId,
                  }
                : null
            }
          />
          <WatchStateReporter
            report={{ itemId: view.itemId, type: "complete", playbackSessionId: view.sessionId }}
            resumePositionMs={view.resumePositionMs}
          />
        </div>
        <p className="wfx-player__trace" data-wfx-player-trace>
          Surface precedence: {view.precedenceTrace.join(" | ")}
        </p>
      </div>
      <QueueList view={view} />
    </div>
  );
}
