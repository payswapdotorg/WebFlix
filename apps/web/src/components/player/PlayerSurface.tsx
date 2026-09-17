/**
 * @wfx/app-web — the player surface (R07 + R09).
 *
 * Renders the RUNTIME's resolved playback session — the frozen Media
 * Surface precedence made visible:
 *
 * - `embed`   → the provider's OFFICIAL embed player in a CONTAINED iframe
 *   (R09: the same sandbox discipline as the browser rung — opaque origin,
 *   cookie/storage isolation, provider-owned page stays opaque); the
 *   attestation line names whether the provider attested the embed
 *   (official) or the realization carries no marker (unofficial — named
 *   honestly, never fabricated);
 * - `browser` → the CONTAINED browser surface: the adapter's BrowserHostPort
 *   session (cookie-isolated, provider-owned) rendered as a sandboxed
 *   iframe — the R07 web realization of the contained rung (see
 *   `platform/browser-host.ts` for the security boundary);
 * - `external`→ the visible handoff (what leaves, where it goes) with the
 *   RETURN CONTEXT (R09/J09: the item + position kept at handoff, so the
 *   journey can return to the same place);
 * - `native`  → the honest unsupported note (the Web bundle truthfully
 *   declares `nativeMedia: "none"` — the runtime's capability filter
 *   names the limitation).
 *
 * The runtime's playback phase renders truthfully (buffering until the
 * surface reports evidence — no fake progress). The precedence trace
 * (present when the runtime resolved through the injected Media Surface
 * seam) renders under the stage — the answer NAMES what was chosen and
 * why. The interactive controls (watch-state reports, like/save) are the
 * client islands `WatchStateReporter` and `ActionButtons`. Server component.
 */

import type { JSX } from "react";

import type { PlayerView } from "@/host/view-models";
import { ActionButtons } from "@/components/player/ActionButtons";
import { WatchStateReporter } from "@/components/player/WatchStateReporter";
import { Icon } from "@/components/shell/Icon";
import { ErrorState } from "@/components/ui/StateViews";
import { formatPosition, placeholderArt, placeholderMonogram } from "@/components/ui/format";

/** The resolved stage — one branch per Media Surface mode. */
function Stage({ view }: { readonly view: PlayerView }): JSX.Element {
  if (view.failure !== null) {
    return (
      <div className="wfx-player__handoff" data-wfx-player-mode="failed">
        <Icon name="skip" size={28} />
        <p data-wfx-player-failure>
          Playback could not start ({view.failure.kind}): {view.failure.detail}
        </p>
      </div>
    );
  }
  if (view.surfaceMode === "embed" && (view.browserSurface !== null || view.surfaceUrl !== null)) {
    // R09: the embed rung CONTAINED EXACTLY LIKE THE BROWSER RUNG — the
    // same sandbox tokens (opaque origin: no allow-same-origin, no
    // storage-access grant), the provider's own embeddable player running
    // isolated in this WebFlix-owned surface.
    const containedUrl =
      view.browserSurface !== null ? view.browserSurface.url : (view.surfaceUrl ?? "");
    return (
      <div
        className="wfx-player__stage"
        data-wfx-player-mode="embed"
        data-wfx-embed-attestation={view.embedAttestation ?? "none"}
        {...(view.browserSurface !== null
          ? { "data-wfx-contained-surface": view.browserSurface.id }
          : {})}
      >
        <iframe
          src={containedUrl}
          title={`Embedded playback: ${view.title}`}
          sandbox="allow-scripts allow-forms allow-popups allow-presentation"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
          data-wfx-player-frame
        />
        <p className="wfx-player__trace" data-wfx-embed-note>
          {view.embedAttestation === "official"
            ? "Official provider embed — the provider exposed this player for embedding, contained and cookie-isolated by WebFlix."
            : "Embedded playback contained in a cookie-isolated surface — the realization carries no provider official-embed attestation, named honestly; WebFlix never injects into or inspects the provider page."}
        </p>
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
    if (view.browserSurface !== null) {
      // The contained surface: the adapter's BrowserHostPort session,
      // cookie-isolated (sandboxed opaque origin), provider-owned.
      return (
        <div className="wfx-player__stage" data-wfx-player-mode="browser" data-wfx-browser-surface={view.browserSurface.id}>
          <iframe
            src={view.browserSurface.url}
            title={`Contained web playback: ${view.title}`}
            sandbox="allow-scripts allow-forms allow-popups allow-presentation"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
            data-wfx-player-frame
          />
          <p className="wfx-player__trace" data-wfx-browser-surface-note>
            Contained, cookie-isolated surface — the provider keeps the playback path; WebFlix
            never injects into or inspects the provider page.
          </p>
        </div>
      );
    }
    if (view.surfaceUrl !== null) {
      return (
        <div className="wfx-player__handoff" data-wfx-player-mode="browser-fallback">
          <Icon name="browser" size={28} />
          <p>
            This content plays in the source&apos;s own web player. The contained surface could not
            open in this context, so the handoff is visible:
          </p>
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
          <code>{view.surfaceUrl}</code>
        </div>
      );
    }
    return (
      <div className="wfx-player__handoff" data-wfx-player-mode="browser-no-url">
        <Icon name="browser" size={28} />
        <p>The source provided no web-player URL for this content.</p>
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
          <>
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
            <code>{view.surfaceUrl}</code>
          </>
        ) : (
          <p>
            The source named the handoff by reference only (<code>{view.externalRef}</code>) — no
            URL was provided.
          </p>
        )}
        {view.externalReturn !== null ? (
          // R09/J09: the RETURN CONTEXT — the durable continuation kept at
          // handoff so the journey can return to the same place inside
          // WebFlix (the item + the position at handoff; the player route
          // consumes the resume parameter directly).
          <p className="wfx-player__trace" data-wfx-return-context>
            Return context kept — resume {view.title} at{" "}
            {formatPosition(view.externalReturn.positionMs)} when you come back:{" "}
            <a
              href={`/player?id=${encodeURIComponent(view.externalReturn.itemId)}&connector=${encodeURIComponent(view.externalReturn.connectorId)}&ref=${encodeURIComponent(view.externalReturn.externalRef)}&title=${encodeURIComponent(view.title)}&type=${encodeURIComponent(view.canonicalType)}&resume=${String(view.externalReturn.positionMs)}`}
              data-wfx-return-link
            >
              Back to this item
            </a>
          </p>
        ) : null}
      </div>
    );
  }
  // native — unreachable on the web platform (the runtime's capability
  // filter rejects it); rendered as the typed honest note, never a crash.
  return (
    <div className="wfx-player__handoff" data-wfx-player-mode="native">
      <Icon name="play" size={28} />
      <p>
        Native playback is not available on the web platform — this adapter truthfully declares no
        native media capability (authorized native acquisition is Desktop-only).
      </p>
    </div>
  );
}

/** The player surface. */
export function PlayerSurface({ view }: { readonly view: PlayerView }): JSX.Element {
  if (view.failure !== null) {
    return (
      <div className="wfx-player" data-wfx-surface="player" data-wfx-player-state="failed">
        <h1 className="wfx-player__title" data-wfx-player-title>
          {view.title}
        </h1>
        <ErrorState
          title="Playback could not start"
          detail={`${view.failure.kind}: ${view.failure.detail}`}
          retry={
            <a
              className="wfx-btn"
              href={`/item?id=${encodeURIComponent(view.itemId)}&connector=${encodeURIComponent(view.connectorId)}&ref=${encodeURIComponent(view.externalRef)}&title=${encodeURIComponent(view.title)}&type=${encodeURIComponent(view.canonicalType)}`}
            >
              View details
            </a>
          }
        />
        {view.skippedForCapability.map((skipped) => (
          <p key={skipped.mode} className="wfx-player__trace" data-wfx-player-skipped={skipped.mode}>
            Skipped {skipped.mode}: {skipped.reason}
          </p>
        ))}
      </div>
    );
  }
  return (
    <div className="wfx-player" data-wfx-surface="player" data-wfx-player-state={view.phase}>
      <Stage view={view} />
      <div className="wfx-player__meta">
        <h1 className="wfx-player__title" data-wfx-player-title>
          {view.title}
        </h1>
        <p className="wfx-detail__meta">
          <span className="wfx-badge wfx-badge--type">{view.canonicalType}</span>
          <span data-wfx-player-mode-label>
            Playing via {view.surfaceMode} — {view.phase}
          </span>
          {view.resumePositionMs > 0 ? (
            <span data-wfx-player-resume>Resumed at {formatPosition(view.resumePositionMs)}</span>
          ) : null}
        </p>
        <div className="wfx-actionbar">
          <ActionButtons
            like={
              view.realizationCapabilities.includes("like")
                ? {
                    type: "like",
                    connectorId: view.connectorId,
                    externalRef: view.externalRef,
                    itemId: view.itemId,
                  }
                : null
            }
            save={
              view.realizationCapabilities.includes("save")
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
        <p className="wfx-player__trace" data-wfx-player-phase>
          Playback phase: {view.phase} (the runtime reports evidence-backed phases only — no fake
          progress).
        </p>
        {view.precedenceTrace.length > 0 ? (
          // R09: the Media Surface precedence trace — one line per rung in
          // frozen precedence order; the answer NAMES what was chosen and
          // why (and which rungs were honestly unavailable/skipped).
          <div className="wfx-player__trace" data-wfx-precedence-trace>
            {view.precedenceTrace.map((line, index) => (
              <p key={index} data-wfx-precedence-line={index}>
                {line}
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <div
        className="wfx-queue__thumb"
        style={{ background: placeholderArt(view.itemId), display: "none" }}
        aria-hidden="true"
      >
        <span className="wfx-card__art">
          <span>{placeholderMonogram(view.title)}</span>
        </span>
      </div>
    </div>
  );
}
