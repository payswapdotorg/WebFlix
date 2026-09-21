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
import { PlayerChrome, type ChromeChapter, type ChromeTranscriptSegment } from "@/components/player/PlayerChrome";
import { UpNextRail, type UpNextCard } from "@/components/player/UpNextRail";
import { ShareControl } from "@/components/player/ShareControl";
import { WatchlistSave } from "@/components/player/WatchlistSave";
import { WatchStateReporter } from "@/components/player/WatchStateReporter";
import { PlaybackDiagnostics } from "@/components/player/PlaybackDiagnostics";
import { TorrentPlaybackStage, TorrentAcquisitionLifecycle } from "@/components/player/TorrentPlaybackStage";
import { WhereToWatch } from "@/components/item/WhereToWatch";
import { AiActionTray } from "@/components/discovery/AiActionTray";
import { IntelligenceSurface } from "@/components/item/IntelligenceSurface";
import { LiveCaptionsSurface } from "@/components/player/LiveCaptionsSurface";
import { FeedbackControls } from "@/components/discovery/FeedbackControls";
import { Icon } from "@/components/shell/Icon";
import { ErrorState } from "@/components/ui/StateViews";
import { formatPosition } from "@/components/ui/format";
import { itemDetailHref } from "@/app/routing";

/** The mode's user sentence (the R21-C label vocabulary — one source). */
function modeSentenceOf(mode: PlayerView["surfaceMode"]): string {
  switch (mode) {
    case "embed":
      return "plays inside WebFlix (the provider's contained embed)";
    case "browser":
      return "plays in a contained window";
    case "external":
      return "opens on the source, with your return context kept";
    case "native":
      return "plays natively in the Desktop app";
  }
}

/** The realization sentence for the peer-copy render (R23-E). */
function torrentSentenceOf(view: PlayerView): string {
  const torrent = view.torrent;
  if (torrent === null) return "";
  if (torrent.rungKind === "satisfies-browser-rung") {
    return "playing your authorized peer copy through WebRTC-capable peers — it plays like any other way of watching";
  }
  if (torrent.rungKind === "desktop-next-step") {
    return "this peer copy needs the Desktop app's native player";
  }
  return "this peer copy is not authorized";
}

/** The resolved stage — one branch per Media Surface mode. */
function Stage({ view }: { readonly view: PlayerView }): JSX.Element {
  // R23-E — the authorized peer copy (the first-class torrent
  // realization): the torrent stage owns this render when the view plays
  // through the peer copy (the browser rung / the honest Desktop next
  // step / the typed refusal).
  if (view.torrent !== null) {
    return <TorrentPlaybackStage view={view} />;
  }
  if (view.failure !== null) {
    return (
      <div className="wfx-player__handoff" data-wfx-player-mode="failed">
        <Icon name="skip" size={28} />
        <p data-wfx-player-failure data-wfx-player-failure-kind={view.failure.kind}>
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
  // R24-W2 — the chrome's serialized inputs: the chapters/transcript
  // from the item's derived intelligence (one source of truth), the
  // per-rung capability truths, and the autoplay policy derivation.
  const chapters: readonly ChromeChapter[] = (view.intelligence.chapters ?? [])
    .filter((chapter) => chapter.title !== null)
    .map((chapter) => ({
      title: chapter.title as string,
      startMs: chapter.startMs,
    }));
  const transcript: readonly ChromeTranscriptSegment[] = (view.intelligence.transcript ?? []).map((segment) => ({
    startMs: segment.startMs,
    endMs: segment.endMs,
    ...(segment.speakerLabel !== null ? { speaker: segment.speakerLabel } : {}),
    text: segment.text,
  }));
  const webflixOwnsStage =
    view.torrent !== null && view.torrent.rungKind === "satisfies-browser-rung";
  const qualityTruth =
    view.torrent !== null
      ? view.torrent.rungKind === "satisfies-browser-rung"
        ? "For a peer copy, the file you chose IS the quality decision — made where you chose what to watch."
        : "This way of watching carries its own quality truth."
      : view.surfaceMode === "external"
        ? "The source's own player carries quality for this way of watching."
        : "This way of watching carries its own quality selection — the provider's player answers it.";
  const autoplaySentence =
    view.attentionMode === "mindful"
      ? "Autoplay stays off in Mindful mode — the next thing never starts on its own."
      : view.attentionMode === "immersive"
        ? "Immersive mode lets the next thing start when this one ends, if autoplay is on."
        : view.attentionMode === "custom"
          ? "Your custom attention policy governs autoplay — this toggle is your session choice on top of it."
          : "Balanced mode lets the next thing start when this one ends, if autoplay is on.";
  // R24-W2 — the Up-next rail's serialized cards (the related projection
  // with their item-hub hrefs — the same navigation every card uses).
  const relatedCards: readonly UpNextCard[] = view.related.map((card) => ({
    itemId: card.itemId,
    connectorId: card.connectorId,
    externalRef: card.externalRef,
    title: card.title,
    canonicalType: card.canonicalType,
    ...(card.durationMs !== undefined ? { durationMs: card.durationMs } : {}),
    href: itemDetailHref({
      itemId: card.itemId,
      connectorId: card.connectorId,
      externalRef: card.externalRef,
      title: card.title,
      canonicalType: card.canonicalType,
      ...(card.durationMs !== undefined ? { durationMs: card.durationMs } : {}),
    }),
  }));
  const shareHref = `/item?id=${encodeURIComponent(view.itemId)}&connector=${encodeURIComponent(view.connectorId)}&ref=${encodeURIComponent(view.externalRef)}&title=${encodeURIComponent(view.title)}&type=${encodeURIComponent(view.canonicalType)}`;

  if (view.failure !== null) {
    // R21-E — the playback RECOVERY path: the typed failure renders with
    // the NEXT supported way to watch as the primary action (the matrix's
    // "Try the next way to watch"), and the Where-to-watch row names every
    // remaining option. Never a dead end.
    const nextWay = view.whereToWatch.options.find(
      (option) => option.usable && option.switchHref !== undefined,
    );
    return (
      <div className="wfx-player" data-wfx-surface="player" data-wfx-player-state="failed">
        <h1 className="wfx-player__title" data-wfx-player-title>
          {view.title}
        </h1>
        <ErrorState
          title="Playback could not start"
          detail={`${view.failure.kind}: ${view.failure.detail}`}
          retry={
            nextWay !== undefined && nextWay.switchHref !== undefined ? (
              <a
                className="wfx-btn wfx-btn--primary"
                href={nextWay.switchHref}
                data-wfx-player-recovery
              >
                <Icon name="play" size={18} />
                Try the next way to watch ({nextWay.modeLabel.toLowerCase()})
              </a>
            ) : (
              <a
                className="wfx-btn"
                href={`/item?id=${encodeURIComponent(view.itemId)}&connector=${encodeURIComponent(view.connectorId)}&ref=${encodeURIComponent(view.externalRef)}&title=${encodeURIComponent(view.title)}&type=${encodeURIComponent(view.canonicalType)}`}
              >
                View details
              </a>
            )
          }
        />
        {/* R23 web-A — the typed PROVIDER-authorization truth: when the
            source's OWN authorization is the missing piece, the reconnect
            path is the SOURCE's (Settings → Sources) — distinct from any
            WebFlix-account requirement; no playback failure may ever route
            to a WebFlix login. */}
        {view.providerAuthorization !== null ? (
          <p className="wfx-player__trace" data-wfx-player-provider-auth={view.providerAuthorization.connectorId}>
            {view.providerAuthorization.sentence}{" "}
            <a href={view.providerAuthorization.reconnectHref} data-wfx-player-provider-reconnect>
              Reconnect {view.providerAuthorization.connectorId}
            </a>
          </p>
        ) : null}
        <WhereToWatch view={view.whereToWatch} variant="player" />
        {view.skippedForCapability.map((skipped) => (
          <p key={skipped.mode} className="wfx-player__trace" data-wfx-player-skipped={skipped.mode}>
            Skipped {skipped.mode}: {skipped.reason}
          </p>
        ))}
        <PlaybackDiagnostics view={view} />
      </div>
    );
  }
  return (
    <div className="wfx-player" data-wfx-surface="player" data-wfx-player-state={view.phase}>
      <div className="wfx-player__layout">
        <div className="wfx-player__main">
          {/* R24-W2 — the stage WRAPPER (the chrome's fullscreen target +
              the player shell the loading/recovery states preserve). */}
          <div className="wfx-player__stagewrap" data-wfx-player-stagewrap>
            <Stage view={view} />
          </div>
          {/* R24-W2 — THE WEBFLIX PLAYER CHROME: the familiar transport bar
              (play/pause + Space/K, the scrub bar + J/L/arrows/0-9, the
              settings cluster, fullscreen + F/Escape, the captions overlay +
              C) wired to the runtime's real commands through /api/playback.
              The honest per-rung truths render inside (volume where WebFlix
              owns the stage; the realization-exposed sentences otherwise). */}
          <PlayerChrome
            sessionId={view.sessionId}
            initialPhase={view.phase}
            initialPositionMs={view.resumePositionMs}
            initialBufferedMs={0}
            durationMs={view.intelligence.transcript !== undefined && view.intelligence.transcript.length > 0
              ? view.intelligence.transcript[view.intelligence.transcript.length - 1]!.endMs
              : null}
            chapters={chapters}
            transcript={transcript}
            webflixOwnsStage={webflixOwnsStage}
            surfaceMode={view.surfaceMode}
            qualityTruth={qualityTruth}
            autoplaySentence={autoplaySentence}
          />
          <div className="wfx-player__meta">
            <h1 className="wfx-player__title" data-wfx-player-title>
              {view.title}
            </h1>
            <p className="wfx-detail__meta">
              <span className="wfx-badge wfx-badge--type">{view.canonicalType}</span>
              <span data-wfx-player-mode-label>
                {view.torrent !== null ? (
                  <>Authorized peer copy · {torrentSentenceOf(view)} — {view.phase}</>
                ) : (
                  <>Playing via {view.surfaceMode} · {modeSentenceOf(view.surfaceMode)} — {view.phase}</>
                )}
              </span>
              {view.resumePositionMs > 0 ? (
                <span data-wfx-player-resume>Resumed at {formatPosition(view.resumePositionMs)}</span>
              ) : null}
            </p>
            {/* R23 web-A — the session-scoped progress truth (anonymous
                sessions keep the place session-local; sign-in is the optional
                upgrade, never a playback prerequisite). */}
            <p className="wfx-player__trace" data-wfx-player-progress-scope={view.progressScope.scope}>
              {view.progressScope.sentence}
              {view.progressScope.offersSignInUpgrade ? (
                <>{" "}<a href="/settings?section=general" data-wfx-player-progress-signin>Sign in (optional)</a></>
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
              {/* R24-W2 — the WebFlix-native watchlist save (the durable
                  canonical write, independent of provider capability) +
                  the share control (the canonical link + the source link). */}
              <WatchlistSave
                itemId={view.itemId}
                title={view.title}
                initiallySaved={view.watchlistSaved}
                offerPlaylist
              />
              <ShareControl
                canonicalHref={shareHref}
                title={view.title}
                sourceId={view.connectorId}
                {...(view.surfaceUrl !== null ? { sourceUrl: view.surfaceUrl } : {})}
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
            {/* R21-E — the player's capability surfaces: the switch row (the
                active realization understandable + the alternates), the AI
                action tray, the feedback controls, and the engineering truth
                behind ONE progressive disclosure. */}
            <WhereToWatch view={view.whereToWatch} variant="player" />
            <AiActionTray view={view.aiTray} surface="player" />
            {/* R23-G — the live captions surface: the legal-audio gate + the
                R2T2 route truth (progressively disclosed on the player). */}
            <LiveCaptionsSurface view={view.liveAsr} mode={view.mode} />
            {/* R23 (J39) — the transcript/chapters/moment navigation (the same
                intelligence surface as the item hub — the parity law). */}
            <IntelligenceSurface
              view={view.intelligence}
              target={{
                itemId: view.itemId,
                connectorId: view.connectorId,
                externalRef: view.externalRef,
                title: view.title,
                canonicalType: view.canonicalType,
              }}
            />
            <FeedbackControls target={view.itemId} sourceId={view.connectorId} surface="player" />
            {view.torrent !== null ? <TorrentAcquisitionLifecycle view={view} /> : null}
            <PlaybackDiagnostics view={view} />
          </div>
        </div>
        {/* R24-W2 — THE UP-NEXT RAIL: the next thing to watch (queue-first,
            the related projection otherwise) + the session queue panel +
            the attention-policy-derived autoplay toggle + the save-queue
            action — the familiar adjacent-content grammar. */}
        <UpNextRail
          currentItemId={view.itemId}
          related={relatedCards}
          initialQueue={view.queue.entries}
          initialAutoplay={view.queue.autoplay}
          autoplayPolicySentence={autoplaySentence}
        />
      </div>
    </div>
  );
}
