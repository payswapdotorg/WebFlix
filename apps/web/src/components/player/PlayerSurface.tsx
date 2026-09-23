/**
 * @wfx/app-web — the player surface (R07 + R09 + R24-E).
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
 * R24-E — THE STREAMED PLAYER SHELL (the startup architecture law):
 * the surface renders the SHELL (the stage + the chrome + the title/meta
 * + the actions + the Where-to-watch row + the session truths) from the
 * resolved media path, and the NONESSENTIAL enrichments (the AI tray,
 * the live-captions route, the intelligence artifacts, the up-next rail)
 * stream in behind it under Suspense — the shell's flush NEVER waits on
 * the deferred lane (the enrichment promise is passed UNAWAITED to the
 * sections; each renders its honest pending state until it resolves).
 * The runtime's playback phase renders truthfully throughout (no fake
 * progress), and the boot marker + the stage observer record the real
 * startup path's markers (the R24-E telemetry).
 */

import { Suspense, type JSX } from "react";

import type { PlayerEnrichments, PlayerShellView } from "@/host/view-models";
import { ActionButtons } from "@/components/player/ActionButtons";
import { PlayerChrome, type ChromeChapter, type ChromeTranscriptFeatures, type ChromeTranscriptSegment, fulfilledTranscriptFeatures, fulfilledTranslateFeatures } from "@/components/player/PlayerChrome";
import { EmbedStage } from "@/components/player/EmbedStage";
import { UpNextRail, type UpNextCard } from "@/components/player/UpNextRail";
import { ShareControl } from "@/components/player/ShareControl";
import { WatchlistSave } from "@/components/player/WatchlistSave";
import { WatchStateReporter } from "@/components/player/WatchStateReporter";
import { PlaybackDiagnostics } from "@/components/player/PlaybackDiagnostics";
import { PlaybackTelemetryObserver } from "@/components/player/PlaybackTelemetryObserver";
import { PlayerBootMarker } from "@/components/player/PlayerBootMarker";
import { TorrentPlaybackStage, TorrentAcquisitionLifecycle } from "@/components/player/TorrentPlaybackStage";
import { WhereToWatch } from "@/components/item/WhereToWatch";
import { AiActionTray } from "@/components/discovery/AiActionTray";
import { IntelligenceSurface } from "@/components/item/IntelligenceSurface";
import { LiveCaptionsSurface } from "@/components/player/LiveCaptionsSurface";
import { TranslateExperience } from "@/components/player/TranslateExperience";
import { realtimeStageReadiness } from "@/host/realtime/realtime-route";
import { FeedbackControls } from "@/components/discovery/FeedbackControls";
import { Icon } from "@/components/shell/Icon";
import { ErrorState } from "@/components/ui/StateViews";
import { formatPosition } from "@/components/ui/format";
import { itemDetailHref, playerHref } from "@/app/routing";

/** The mode's user sentence (the R21-C label vocabulary — one source). */
function modeSentenceOf(mode: PlayerShellView["surfaceMode"]): string {
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
function torrentSentenceOf(view: PlayerShellView): string {
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

/** The realization label the telemetry binds to the trace. */
function realizationLabelOf(view: PlayerShellView): string {
  return view.torrent !== null ? "authorized-peer-copy" : view.surfaceMode;
}

/** The up-next rail's serialized cards (from the enrichment's related projection). */
function relatedCardsOf(related: PlayerEnrichments["related"]): readonly UpNextCard[] {
  return related.map((card) => ({
    itemId: card.itemId,
    connectorId: card.connectorId,
    externalRef: card.externalRef,
    title: card.title,
    canonicalType: card.canonicalType,
    ...(card.durationMs !== undefined ? { durationMs: card.durationMs } : {}),
    // R26-W2 — the rail cards carry the REAL SOURCE ARTWORK (the same
    // typed fallback floor when the row carried none).
    ...(card.artwork !== undefined ? { artwork: card.artwork } : {}),
    href: itemDetailHref({
      itemId: card.itemId,
      connectorId: card.connectorId,
      externalRef: card.externalRef,
      title: card.title,
      canonicalType: card.canonicalType,
      ...(card.durationMs !== undefined ? { durationMs: card.durationMs } : {}),
    }),
  }));
}

/** The chrome's transcript-derived features (from the enrichment's intelligence artifact). */
function chromeFeaturesOf(enrichments: PlayerEnrichments): ChromeTranscriptFeatures {
  const chapters: readonly ChromeChapter[] = (enrichments.intelligence.chapters ?? [])
    .filter((chapter) => chapter.title !== null)
    .map((chapter) => ({
      title: chapter.title as string,
      startMs: chapter.startMs,
    }));
  const transcript: readonly ChromeTranscriptSegment[] = (enrichments.intelligence.transcript ?? []).map((segment) => ({
    startMs: segment.startMs,
    endMs: segment.endMs,
    ...(segment.speakerLabel !== null ? { speaker: segment.speakerLabel } : {}),
    text: segment.text,
  }));
  return { chapters, transcript };
}

/** The resolved-or-streaming enrichment input (the dual honest shape). */
type EnrichmentInput = PlayerEnrichments | Promise<PlayerEnrichments>;

/**
 * The attention-policy autoplay sentence (the policy derivation — the
 * same seam the Personalize control renders, never a second policy).
 */
function autoplaySentenceOf(view: PlayerShellView): string {
  if (view.attentionMode === "mindful") {
    return "Autoplay stays off in Mindful mode — the next thing never starts on its own.";
  }
  if (view.attentionMode === "immersive") {
    return "Immersive mode lets the next thing start when this one ends, if autoplay is on.";
  }
  if (view.attentionMode === "custom") {
    return "Your custom attention policy governs autoplay — this toggle is your session choice on top of it.";
  }
  return "Balanced mode lets the next thing start when this one ends, if autoplay is on.";
}

/**
 * The honest PENDING state of a streamed enrichment section (the
 * design language's law: skeletons mirror the final layout — the
 * section's shell renders, the content arrives).
 */
function EnrichmentPending({ label }: { readonly label: string }): JSX.Element {
  return (
    <section className="wfx-player__enrichment-pending" data-wfx-enrichment-pending={label} aria-busy="true">
      <p className="wfx-player__trace">{label}…</p>
    </section>
  );
}

/** A streamed async section: awaits the enrichment (the promise path) and renders its panel. */
async function AiTraySection({ enrichments }: { readonly enrichments: Promise<PlayerEnrichments> }): Promise<JSX.Element> {
  const resolved = await enrichments;
  return <AiActionTray view={resolved.aiTray} surface="player" />;
}

/** A streamed async section: the live-captions route surface. */
async function LiveCaptionsSection({
  enrichments,
  mode,
}: {
  readonly enrichments: Promise<PlayerEnrichments>;
  readonly mode: PlayerShellView["mode"];
}): Promise<JSX.Element> {
  const resolved = await enrichments;
  return <LiveCaptionsSurface view={resolved.liveAsr} mode={mode} />;
}

/** A streamed async section: the intelligence surface (transcript/chapters/moments). */
async function IntelligenceSection({
  enrichments,
  target,
}: {
  readonly enrichments: Promise<PlayerEnrichments>;
  readonly target: Parameters<typeof IntelligenceSurface>[0]["target"];
}): Promise<JSX.Element> {
  const resolved = await enrichments;
  return <IntelligenceSurface view={resolved.intelligence} target={target} />;
}

/** A streamed async section: the up-next rail (the related projection + the shell's queue). */
async function UpNextSection({
  enrichments,
  view,
  autoplayPolicySentence,
}: {
  readonly enrichments: Promise<PlayerEnrichments>;
  readonly view: PlayerShellView;
  readonly autoplayPolicySentence: string;
}): Promise<JSX.Element> {
  const resolved = await enrichments;
  return (
    <UpNextRail
      currentItemId={view.itemId}
      sourceId={view.connectorId}
      related={relatedCardsOf(resolved.related)}
      initialQueue={view.queue.entries}
      initialAutoplay={view.queue.autoplay}
      autoplayPolicySentence={autoplayPolicySentence}
    />
  );
}

/**
 * The AI-tray panel: the composed input renders DIRECTLY (the resolved
 * panels — the static/composed render path); the streaming promise
 * renders the async section under Suspense (the page's split).
 */
function AiTrayPanel({ enrichments }: { readonly enrichments: EnrichmentInput }): JSX.Element {
  return enrichments instanceof Promise ? (
    <Suspense fallback={<EnrichmentPending label="AI actions" />}>
      <AiTraySection enrichments={enrichments} />
    </Suspense>
  ) : (
    <AiActionTray view={enrichments.aiTray} surface="player" />
  );
}

/** The realtime translation panel (the same composed/streaming split). */
function RealtimeTranslatePanel({
  enrichments,
  identity,
  stage,
}: {
  readonly enrichments: EnrichmentInput;
  readonly identity: Parameters<typeof TranslateExperience>[0]["identity"];
  readonly stage: Parameters<typeof realtimeStageReadiness>[1];
}): JSX.Element {
  const stageContext = stage;
  const routeOf = (resolved: PlayerEnrichments): Parameters<typeof TranslateExperience>[0]["route"] => ({
    ...resolved.realtime,
    readiness: realtimeStageReadiness(resolved.realtime, stageContext),
  });
  return enrichments instanceof Promise ? (
    <Suspense fallback={<EnrichmentPending label="Translate" />}>
      <RealtimeTranslateSection enrichments={enrichments} identity={identity} stage={stageContext} routeOf={routeOf} />
    </Suspense>
  ) : (
    <TranslateExperience route={routeOf(enrichments)} identity={identity} />
  );
}

/** A streamed async section: the realtime translate island. */
async function RealtimeTranslateSection({
  enrichments,
  identity,
  stage,
  routeOf,
}: {
  readonly enrichments: Promise<PlayerEnrichments>;
  readonly identity: Parameters<typeof TranslateExperience>[0]["identity"];
  readonly stage: Parameters<typeof realtimeStageReadiness>[1];
  readonly routeOf: (resolved: PlayerEnrichments) => Parameters<typeof TranslateExperience>[0]["route"];
}): Promise<JSX.Element> {
  const resolved = await enrichments;
  void stage;
  return <TranslateExperience route={routeOf(resolved)} identity={identity} />;
}

/** The live-captions panel (the same composed/streaming split). */
function LiveCaptionsPanel({
  enrichments,
  mode,
}: {
  readonly enrichments: EnrichmentInput;
  readonly mode: PlayerShellView["mode"];
}): JSX.Element {
  return enrichments instanceof Promise ? (
    <Suspense fallback={<EnrichmentPending label="Live captions" />}>
      <LiveCaptionsSection enrichments={enrichments} mode={mode} />
    </Suspense>
  ) : (
    <LiveCaptionsSurface view={enrichments.liveAsr} mode={mode} />
  );
}

/** The intelligence panel (the same composed/streaming split). */
function IntelligencePanel({
  enrichments,
  target,
}: {
  readonly enrichments: EnrichmentInput;
  readonly target: Parameters<typeof IntelligenceSurface>[0]["target"];
}): JSX.Element {
  return enrichments instanceof Promise ? (
    <Suspense fallback={<EnrichmentPending label="Transcript and chapters" />}>
      <IntelligenceSection enrichments={enrichments} target={target} />
    </Suspense>
  ) : (
    <IntelligenceSurface view={enrichments.intelligence} target={target} />
  );
}

/** The up-next rail panel (the same composed/streaming split). */
function UpNextPanel({
  enrichments,
  view,
  autoplayPolicySentence,
}: {
  readonly enrichments: EnrichmentInput;
  readonly view: PlayerShellView;
  readonly autoplayPolicySentence: string;
}): JSX.Element {
  return enrichments instanceof Promise ? (
    <Suspense fallback={<EnrichmentPending label="Up next" />}>
      <UpNextSection enrichments={enrichments} view={view} autoplayPolicySentence={autoplayPolicySentence} />
    </Suspense>
  ) : (
    <UpNextRail
      currentItemId={view.itemId}
      related={relatedCardsOf(enrichments.related)}
      initialQueue={view.queue.entries}
      initialAutoplay={view.queue.autoplay}
      autoplayPolicySentence={autoplayPolicySentence}
    />
  );
}

/** The resolved stage — one branch per Media Surface mode. */
function Stage({ view }: { readonly view: PlayerShellView }): JSX.Element {
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
    // R09 + R26-W2: the embed rung CONTAINED EXACTLY LIKE THE BROWSER RUNG —
    // the same sandbox tokens (opaque origin: no allow-same-origin, no
    // storage-access grant), the provider's own embeddable player running
    // isolated in this WebFlix-owned surface — now rendered through the
    // EMBED STAGE, which binds the provider's own documented embed control
    // channel (client-side realization control: the chrome's transport
    // commands reach the provider's real player; the provider's own state
    // broadcasts are the only evidence that advances the visible phase —
    // the first frame is real, never fabricated). A provider without a
    // live control answer keeps the honest pre-R26 behavior unchanged.
    const containedUrl =
      view.browserSurface !== null ? view.browserSurface.url : (view.surfaceUrl ?? "");
    return (
      <EmbedStage
        url={containedUrl}
        title={view.title}
        attestation={view.embedAttestation}
        containedSurfaceId={view.browserSurface !== null ? view.browserSurface.id : null}
        itemId={view.itemId}
        playbackSessionId={view.sessionId}
      />
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

/**
 * The player surface — the streamed shell + the deferred enrichment
 * sections. `view` is the SHELL (the media path's own fields — awaited
 * before the first flush); `enrichments` is the deferred lane (the
 * promise the page started AFTER the media path resolved, or the
 * resolved object for the composed render) — passed UNAWAITED into the
 * Suspense sections (each streams in when ready; the shell's flush
 * never waits on them).
 */
export function PlayerSurface({
  view,
  enrichments,
}: {
  readonly view: PlayerShellView;
  readonly enrichments: EnrichmentInput;
}): JSX.Element {
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
  const autoplaySentence = autoplaySentenceOf(view);
  const shareHref = `/item?id=${encodeURIComponent(view.itemId)}&connector=${encodeURIComponent(view.connectorId)}&ref=${encodeURIComponent(view.externalRef)}&title=${encodeURIComponent(view.title)}&type=${encodeURIComponent(view.canonicalType)}`;
  // The chrome's transcript-derived features: the sync-fulfilled usable
  // (composed render — React's use() fast path, no suspension) or the
  // STREAMED promise (the deferred artifact — the chrome's marks/overlay
  // layers suspend locally; the transport bar never suspends: the
  // stable-chrome law).
  const transcriptFeatures =
    enrichments instanceof Promise
      ? enrichments
          .then((resolved) => chromeFeaturesOf(resolved))
          .catch(() => null)
      : fulfilledTranscriptFeatures(chromeFeaturesOf(enrichments));
  // R25-W2 — the chrome's TRANSLATE features (the same discipline): the
  // composed stage truth (the realization gate applied — R25-E) either
  // sync-fulfilled (the composed render) or streamed (the page's split;
  // the row suspends locally inside the settings panel).
  const stageForReadiness = {
    webflixOwnsStage,
    surfaceMode: view.surfaceMode,
    transcriptAvailable: true,
  };
  const translateFeatures =
    enrichments instanceof Promise
      ? enrichments
          .then((resolved) => ({
            ...resolved.realtime,
            readiness: realtimeStageReadiness(resolved.realtime, {
              ...stageForReadiness,
              transcriptAvailable: (resolved.intelligence.transcript ?? []).length > 0,
            }),
          }))
          .catch(() => null)
      : fulfilledTranslateFeatures({
          ...enrichments.realtime,
          readiness: realtimeStageReadiness(enrichments.realtime, {
            ...stageForReadiness,
            transcriptAvailable: (enrichments.intelligence.transcript ?? []).length > 0,
          }),
        });

  if (view.failure !== null) {
    // R21-E — the playback RECOVERY path: the typed failure renders with
    // the NEXT supported way to watch as the primary action (the matrix's
    // "Try the next way to watch"), and the Where-to-watch row names every
    // remaining option. Never a dead end. The boot marker + observer still
    // record the honest startup-failed trace (the R24-E observation).
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
        {/* R24-E — the honest startup-failure trace records too (the
            boot marker reads the failed phase; the observer flushes). */}
        <PlaybackTelemetryObserver />
        <PlayerBootMarker itemId={view.itemId} realization={realizationLabelOf(view)} />
      </div>
    );
  }
  return (
    <div className="wfx-player" data-wfx-surface="player" data-wfx-player-state={view.phase}>
      <div className="wfx-player__layout">
        <div className="wfx-player__main">
          {/* R24-W2 — the stage WRAPPER (the chrome's fullscreen target +
              the player shell the loading/recovery states preserve) + the
              R24-E stage observer (the real startup path's markers). */}
          {/* R27-W2 - the stage WRAPPER (the chrome's fullscreen target +
              the player shell the loading/recovery states preserve). The
              chrome renders INSIDE the wrapper, overlaying the stage's
              bottom edge - the measured 996x560 16:9 INCLUDING the
              control bar (the letterbox is the STAGE element's own
              overflow-hidden; the settings popup escapes the wrapper
              freely). */}
          <div className="wfx-player__stagewrap" data-wfx-player-stagewrap>
            <Stage view={view} />
            <PlaybackTelemetryObserver />
            {/* R27-W2 - THE WEBFLIX PLAYER CHROME: YouTube's control-bar
                anatomy (red #f03 progress with the white scrubber dot,
                play/next/volume+hover-slider/time/captions/settings/
                miniplayer/theater/fullscreen, ~3s idle fade + mousemove
                reveal) wired to the runtime's real commands through
                /api/playback. The honest per-rung truths render inside
                (volume where WebFlix owns the stage; the realization-
                exposed sentences otherwise). R24-E: the chrome renders IN
                THE SHELL (stable during init); the transcript-derived
                features stream in through their own local suspensions. */}
            <PlayerChrome
            sessionId={view.sessionId}
            initialPhase={view.phase}
            initialPositionMs={view.resumePositionMs}
            initialBufferedMs={0}
            durationMs={view.durationMs}
            transcriptFeatures={transcriptFeatures}
            translateFeatures={translateFeatures}
            webflixOwnsStage={webflixOwnsStage}
            surfaceMode={view.surfaceMode}
            qualityTruth={qualityTruth}
            autoplaySentence={autoplaySentence}
            sessionIntent={view.sessionIntent}
            embedControl={view.surfaceMode === "embed" && view.failure === null}
            nextHref={
              view.queue.entries.length > 0 && view.queue.entries[0] !== undefined
                ? playerHref({
                    itemId: view.queue.entries[0]!.itemId,
                    connectorId: view.queue.entries[0]!.connectorId,
                    externalRef: view.queue.entries[0]!.externalRef,
                    title: view.queue.entries[0]!.title,
                    canonicalType: view.queue.entries[0]!.canonicalType,
                    ...(view.queue.entries[0]!.durationMs !== undefined
                      ? { durationMs: view.queue.entries[0]!.durationMs }
                      : {}),
                  })
                : null
            }
          />
          </div>
          <div className="wfx-player__meta">
            <h1 className="wfx-player__title" data-wfx-player-title>
              {view.title}
            </h1>
            {/* R27-W2 - THE WATCH HEAD (the measured anatomy): the OWNER row
                LEFT (40px avatar + the honest source identity + meta) and
                the ACTIONS row RIGHT (40px pills - the R24-W2 action
                vocabulary: provider like/save, the WebFlix watchlist save,
                share, and the watch-state report). */}
            <div className="wfx-watchhead">
              <div className="wfx-owner">
                <span className="wfx-owner__avatar" aria-hidden="true">
                  {view.connectorId.length > 0 ? view.connectorId[0]!.toUpperCase() : "W"}
                </span>
                <span>
                  <p className="wfx-owner__name">{view.connectorId.length > 0 ? view.connectorId : "WebFlix"}</p>
                  <p className="wfx-owner__meta" data-wfx-player-mode-label>
                    {view.torrent !== null ? (
                      <>Authorized peer copy · {torrentSentenceOf(view)}</>
                    ) : (
                      <>Playing via {view.surfaceMode} · {modeSentenceOf(view.surfaceMode)}</>
                    )}
                  </p>
                </span>
              </div>
              <div className="wfx-actions">
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
                {/* R24-W2 - the WebFlix-native watchlist save (the durable
                    canonical write, independent of provider capability) +
                    the share control (the canonical link + the source
                    link) + the honest watch-state report. */}
                <WatchlistSave
                  itemId={view.itemId}
                  title={view.title}
                  connectorId={view.connectorId}
                  externalRef={view.externalRef}
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
            </div>
            {/* R27-W2 - THE DESCRIPTION PANEL (the measured anatomy:
                surface #272727, radius 12, 14/20, collapsed 2-line + the
                ...more expander). The honest playback truths live here -
                the description of THIS way of watching. */}
            <details className="wfx-desc" data-wfx-player-description>
              <summary className="wfx-desc__summary">
                <p className="wfx-desc__collapsed">
                  {view.torrent !== null ? (
                    <>{torrentSentenceOf(view)} - {view.phase}.</>
                  ) : (
                    <>Playing via {view.surfaceMode} - {modeSentenceOf(view.surfaceMode)} ({view.phase}).</>
                  )}
                  {view.resumePositionMs > 0 ? (
                    <> Resumed at {formatPosition(view.resumePositionMs)}.</>
                  ) : null}
                </p>
                <span className="wfx-desc__more">…more</span>
              </summary>
              <div className="wfx-desc__body">
                <p className="wfx-player__trace" data-wfx-player-phase>
                  Playback phase: {view.phase} (the runtime reports evidence-backed phases only - no fake
                  progress).
                </p>
                {view.resumePositionMs > 0 ? (
                  <p className="wfx-player__trace" data-wfx-player-resume>
                    Resumed at {formatPosition(view.resumePositionMs)}
                  </p>
                ) : null}
                <p className="wfx-player__trace" data-wfx-player-progress-scope={view.progressScope.scope}>
                  {view.progressScope.sentence}
                  {view.progressScope.offersSignInUpgrade ? (
                    <>{" "}<a href="/settings?section=general" data-wfx-player-progress-signin>Sign in (optional)</a></>
                  ) : null}
                </p>
                {view.providerAuthorization !== null ? (
                  <p className="wfx-player__trace" data-wfx-player-provider-auth={view.providerAuthorization.connectorId}>
                    {view.providerAuthorization.sentence}{" "}
                    <a href={view.providerAuthorization.reconnectHref} data-wfx-player-provider-reconnect>
                      Reconnect {view.providerAuthorization.connectorId}
                    </a>
                  </p>
                ) : null}
              </div>
            </details>
            {/* R21-E — the player's capability surfaces: the switch row (the
                active realization understandable + the alternates), the
                session-scoped feedback controls, and the engineering truth
                behind ONE progressive disclosure. R24-E: the
                Where-to-watch row is STARTUP-CRITICAL (the taxonomy's own
                classification — it renders in the shell). */}
            <WhereToWatch view={view.whereToWatch} variant="player" />
            <FeedbackControls target={view.itemId} sourceId={view.connectorId} surface="player" />
            {/* R24-E — THE STREAMED ENRICHMENT SECTIONS (the deferred
                lane): the AI action tray, the live-captions route, and the
                intelligence artifacts render under Suspense as the
                enrichment resolves (the composed input renders them
                directly) — honest pending states, never a blocked shell,
                never a blank section. */}
            <AiTrayPanel enrichments={enrichments} />
            <LiveCaptionsPanel enrichments={enrichments} mode={view.mode} />
            {/* R25-W2 — THE TRANSLATE EXPERIENCE island (the live bilingual
                surface + the translated-speech cluster + the graceful
                fallback + the anonymous truth — the deferred lane, never a
                blocked shell). */}
            <RealtimeTranslatePanel
              enrichments={enrichments}
              identity={{
                itemId: view.itemId,
                connectorId: view.connectorId,
                externalRef: view.externalRef,
                playbackSessionId: view.sessionId,
                webflixOwnsStage,
              }}
              stage={stageForReadiness}
            />
            <IntelligencePanel
              enrichments={enrichments}
              target={{
                itemId: view.itemId,
                connectorId: view.connectorId,
                externalRef: view.externalRef,
                title: view.title,
                canonicalType: view.canonicalType,
              }}
            />
            {view.torrent !== null ? <TorrentAcquisitionLifecycle view={view} /> : null}
            <PlaybackDiagnostics view={view} />
          </div>
        </div>
        {/* R24-W2 — THE UP-NEXT RAIL: the next thing to watch (queue-first,
            the related projection otherwise) + the session queue panel +
            the attention-policy-derived autoplay toggle + the save-queue
            action — the familiar adjacent-content grammar. R24-E: the
            rail is startup-ADJACENT (the taxonomy's classification) — it
            STREAMS in behind the shell (the queue state rides the shell's
            own session truth; the related projection is the deferred
            recommendation work). */}
        <UpNextPanel enrichments={enrichments} view={view} autoplayPolicySentence={autoplaySentence} />
      </div>
      {/* R24-E — the parse-time boot marker (the inline script at the
          shell's end: navigation-start + player-surface-visible + the
          phase truth). */}
      <PlayerBootMarker itemId={view.itemId} realization={realizationLabelOf(view)} />
    </div>
  );
}
