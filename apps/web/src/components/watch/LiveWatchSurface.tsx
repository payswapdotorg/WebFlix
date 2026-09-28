/**
 * @wfx/app-web — R37 — THE LIVE WATCH SURFACE (the watch page's live
 * mode — the stage + the chat column composition).
 *
 * THE COMPOSITION (the task packet's owned extension point): the watch
 * page renders THIS surface when its item params name an item whose
 * connector metadata declares a live designation; the DEFAULT watch
 * surface (the browse) stays byte-compatible for non-live visits.
 *
 * THE HONEST STAGE GRAMMAR (what the grammar states, is true):
 * - A LIVE item presents the red-dot LIVE badge + the source-reported
 *   viewer count, and THE NO-SCRUB TRUTH: a live edge is not scrubbable
 *   — no seek bar renders; the sentence states why. The stage itself is
 *   the contained provider embed (the presentation law — the opaque-
 *   origin sandbox for the non-YouTube family; the fixture embed URL
 *   never resolves in the dev boot, the same deterministic truth every
 *   player surface carries; the stage honestly stays `unbound`).
 * - An ARCHIVED live VOD presents the "was live" badge + the duration +
 *   THE REPLAY TRUTH: the chat replays from the committed log, timed to
 *   the playback position (never a live stream).
 * - The channel row (the R36 grammar) links the source's channel page —
 *   the composability the task packet names (the /live rail's items
 *   belong to a source; the channel page composes with the live lane).
 */

import type { JSX } from "react";

import { OPAQUE_ORIGIN_SANDBOX, presentationSrcOf } from "@/components/player/embed-presentation";
import { EmptyState, ErrorState } from "@/components/ui/StateViews";
import { formatPosition } from "@/components/ui/format";
import { LiveBadge, LiveViewerCount, WasLiveBadge } from "@/components/live/LiveBadge";
import { LiveChat } from "@/components/live/LiveChat";
import { ChatReplay } from "@/components/watch/ChatReplay";
import type { LiveWatchView } from "@/components/live/live-views";
import "../live/live.css";

/** The contained stage (the presentation law's iframe — the honest unbound truth). */
function LiveStage({
  embedUrl,
  title,
}: {
  readonly embedUrl: string;
  readonly title: string;
}): JSX.Element {
  if (embedUrl.length === 0) {
    return (
      <div className="wfx-livewatch__frame" data-wfx-live-stage="no-realization">
        <EmptyState
          title="No contained way to watch this live stream"
          detail="This item declares no embed realization — WebFlix does not fabricate a stage."
        />
      </div>
    );
  }
  return (
    <div className="wfx-livewatch__frame" data-wfx-live-stage="unbound">
      <iframe
        src={presentationSrcOf(embedUrl)}
        title={title}
        sandbox={OPAQUE_ORIGIN_SANDBOX}
        referrerPolicy="strict-origin-when-cross-origin"
        allow="autoplay; encrypted-media; picture-in-picture"
        data-wfx-live-embed
      />
    </div>
  );
}

/** The live watch surface (the view's every kind renders honestly). */
export function LiveWatchSurface({ view }: { readonly view: LiveWatchView }): JSX.Element {
  // The honest not-found state (the /item law: never a fabricated page).
  if (view.kind === "not-found") {
    return (
      <div data-wfx-surface="watch" data-wfx-watch data-wfx-livewatch data-wfx-livewatch-state="not-found">
        <h1 className="wfx-page-title" data-wfx-watch-title>
          Watch
        </h1>
        <EmptyState
          title="No live watch page for this item"
          detail={view.note}
          action={
            <a className="wfx-btn" href="/live">
              Browse live
            </a>
          }
        />
      </div>
    );
  }

  // The honest not-live state (the no-dead-end law: the player link).
  if (view.kind === "not-live") {
    const retry =
      view.playerHref !== null ? (
        <a className="wfx-btn wfx-btn--primary" href={view.playerHref} data-wfx-livewatch-player-link>
          Watch in the player
        </a>
      ) : null;
    return (
      <div data-wfx-surface="watch" data-wfx-watch data-wfx-livewatch data-wfx-livewatch-state="not-live">
        <h1 className="wfx-page-title" data-wfx-watch-title>
          Watch
        </h1>
        <ErrorState
          title="This item is not live"
          detail={`${view.note}${view.playerHref !== null ? " The player is one click away." : ""}`}
          {...(retry !== null ? { retry } : {})}
        />
      </div>
    );
  }

  // THE LIVE MODE (the stage + the current chat over the WS seam).
  if (view.kind === "live") {
    return (
      <div data-wfx-surface="watch" data-wfx-watch data-wfx-livewatch data-wfx-livewatch-state="live">
        <h1 className="wfx-page-title" data-wfx-watch-title>
          Watch
        </h1>
        <p className="wfx-page-subtitle">A live broadcast — the chat joins the stream.</p>
        <div className="wfx-livewatch">
          <div className="wfx-livewatch__stage">
            <LiveStage embedUrl={view.embedUrl} title={view.title} />
            <div className="wfx-livewatch__chrome">
              <LiveBadge />
              <LiveViewerCount count={view.viewerCount} />
              <span className="wfx-livedone" data-wfx-live-started>
                {view.startedAt !== null ? `Started ${new Date(view.startedAt).toLocaleString("en-US")}` : "Live now"}
              </span>
            </div>
            {/* THE NO-SCRUB TRUTH: the grammar states what is true — no
                seek bar renders on a live edge, and the sentence says why. */}
            <p className="wfx-livewatch__noscrub" data-wfx-live-noscrub>
              You are watching the live edge — seeking is unavailable on a live stream.
            </p>
            <h2 className="wfx-livewatch__title" data-wfx-livewatch-title>
              {view.title}
            </h2>
            <p className="wfx-livewatch__channel">
              <a className="wfx-livewatch__channellink" href={view.channelHref} data-wfx-livewatch-channel>
                {view.channelName}
              </a>
            </p>
            {view.fixturesBadge !== null ? (
              <p className="wfx-livechat__double" data-wfx-live-disclosure>
                This boot serves {view.fixturesBadge}.
              </p>
            ) : null}
          </div>
          <aside className="wfx-livewatch__chat">
            <LiveChat
              externalRef={view.externalRef}
              bridgeUrl={view.chatBridge.running ? view.chatBridge.wsUrl : ""}
              doubleBadge={
                view.chatBridge.provider?.detail ??
                "the deterministic dev live-chat double (the fixtures' scripted chat)"
              }
              initialViewerCount={view.viewerCount.kind === "declared" ? view.viewerCount.value : null}
            />
          </aside>
        </div>
      </div>
    );
  }

  // THE ARCHIVED LIVE VOD (the replay mode — the committed log + the playhead).
  return (
    <div data-wfx-surface="watch" data-wfx-watch data-wfx-livewatch data-wfx-livewatch-state="archived-live-vod">
      <h1 className="wfx-page-title" data-wfx-watch-title>
        Watch
      </h1>
      <p className="wfx-page-subtitle">An archived live broadcast — the chat replays with the video.</p>
      <div className="wfx-livewatch">
        <div className="wfx-livewatch__stage">
          <LiveStage embedUrl={view.embedUrl} title={view.title} />
          <div className="wfx-livewatch__chrome">
            <WasLiveBadge />
            {view.durationMs !== null ? (
              <span className="wfx-livedone" data-wfx-archive-duration>
                {formatPosition(view.durationMs)}
              </span>
            ) : null}
            <span className="wfx-livedone" data-wfx-live-archived-facts>
              {view.startedAt !== null ? `Live ${new Date(view.startedAt).toLocaleDateString("en-US")}` : "An ended broadcast"}
              {view.endedAt !== null ? ` — ended ${new Date(view.endedAt).toLocaleTimeString("en-US")}` : ""}
            </span>
          </div>
          {/* THE REPLAY TRUTH: the archived VOD scrubs like any video —
              and the chat follows the position (the replay control is
              the surface's own honest clock, the stage truth above). */}
          <p className="wfx-livewatch__noscrub" data-wfx-archive-replay-note>
            This broadcast ended — the video scrubs, and the chat replay follows the position.
          </p>
          <h2 className="wfx-livewatch__title" data-wfx-livewatch-title>
            {view.title}
          </h2>
          <p className="wfx-livewatch__channel">
            <a className="wfx-livewatch__channellink" href={view.channelHref} data-wfx-livewatch-channel>
              {view.channelName}
            </a>
          </p>
          {view.fixturesBadge !== null ? (
            <p className="wfx-livechat__double" data-wfx-live-disclosure>
              This boot serves {view.fixturesBadge}.
            </p>
          ) : null}
        </div>
        <aside className="wfx-livewatch__chat">
          {view.chatLog !== null && view.durationMs !== null ? (
            <ChatReplay log={view.chatLog} durationMs={view.durationMs} />
          ) : (
            <div className="wfx-livechat" data-wfx-chatreplay data-wfx-chatreplay-state="absent">
              <div className="wfx-livechat__head">
                <p className="wfx-livechat__title" data-wfx-chatreplay-title>
                  Chat replay
                </p>
              </div>
              <p className="wfx-livechat__state" data-wfx-chatreplay-absent>
                {view.chatLogState?.note ??
                  "The archived chat log for this broadcast could not be read — nothing replays rather than a partial log."}
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
