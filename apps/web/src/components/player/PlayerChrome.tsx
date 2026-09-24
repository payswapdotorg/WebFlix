"use client";

/**
 * @wfx/app-web — the WebFlix player chrome (R24-W2, the R24-C
 * Watch/player control rows: play-pause / seek-scrub / volume-mute /
 * fullscreen / miniplayer / playback-speed / quality / captions).
 *
 * THE FAMILIAR CONTROL GRAMMAR, HONESTLY BACKED. The transport bar
 * carries the controls a mature video product's viewer already knows,
 * in the familiar placement — and every control's BACKING is the truth
 * of what it operates on HERE:
 *
 * - `runtime-command` — the shared PlaybackController executes it
 *   through /api/playback (play/pause/seek: the same typed transport
 *   every way of watching uses; the session's phase/position render
 *   truthfully — acceptance IS position evidence, never a ticker);
 * - `platform-affordance` — the web platform's own mechanism (the
 *   stage wrapper's Fullscreen API transitions; Document
 *   Picture-in-Picture where the browser exposes it);
 * - `realization-exposed` — the realization itself carries the control
 *   (the provider's own player inside the contained surface owns
 *   volume/speed/quality there — the honest sentence, never a
 *   fabricated WebFlix control over provider media);
 * - `view-state` — the WebFlix-owned presentation states (the caption
 *   overlay over the shared transcript artifact; the session rate
 *   preference applied wherever WebFlix owns the media path).
 *
 * THE HONESTY LAWS (frozen):
 * - no fake progress: the position renders the session's truthful
 *   positionMs (resume + accepted seeks); the buffered bar renders the
 *   session's bufferedMs (0 when unknown); the phase renders the
 *   runtime's phase — nothing ticks, nothing fabricates;
 * - no dead buttons: every control either executes or discloses its
 *   honest backing (the settings cluster carries the per-rung truth
 *   rows; a refused command renders its typed failure);
 * - the keyboard grammar is the familiar one: Space/K play-pause,
 *   J/L ±10s, ←/→ ±5s, 0-9 the percent jumps, M mute, F fullscreen,
 *   C captions, T transcript.
 */

import { Suspense, useCallback, useEffect, useRef, useState, use, useSyncExternalStore, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";
// R24-E — the startup/interaction telemetry recorder (the seek/control
// marker pairs wrap the REAL command round trips).
import { recordPlaybackMarker } from "@/host/playback-telemetry";
// R26-W2 — the provider embed control contract (the client-side
// realization control store the EmbedStage binds).
import {
  getActiveEmbedSessionController,
  getActiveEmbedControl,
  idleEmbedControlSnapshot,
  subscribeActiveEmbedControl,
  type EmbedControlState,
} from "@/components/player/embed-session-client";
// R26-W2 — the client-carried playback intent (the multi-instance law's
// serializable shape — sent with every command so a cold invocation
// re-resolves the SAME session).
import type { ClientPlaybackIntent } from "@/host/playback-bridge";
// R25-W2 — the realtime translation session client (the shared
// controller the chrome's Translate row and the experience island
// both bind to) + the route view's truths.
import {
  getActiveRealtimeSessionController,
  getActiveRealtimePhase,
  idleRealtimePhaseSnapshot,
  subscribeActiveRealtimePhase,
} from "@/components/player/realtime-session-client";
import type { RealtimeRouteView } from "@/host/realtime/realtime-route";
import { realtimeRestrictedAlternativesSentence } from "@/host/realtime/realtime-route";

/** One chapter mark on the scrub bar (the intelligence artifact's chapter). */
export interface ChromeChapter {
  readonly title: string;
  readonly startMs: number;
}

/** One transcript segment (the caption overlay's source artifact). */
export interface ChromeTranscriptSegment {
  readonly startMs: number;
  readonly endMs: number;
  readonly speaker?: string;
  readonly text: string;
}

/** The scrub bar's chapter-mark / caption-overlay inputs (the transcript-derived features — R24-E's deferred lane). */
export interface ChromeTranscriptFeatures {
  readonly chapters: readonly ChromeChapter[];
  readonly transcript: readonly ChromeTranscriptSegment[];
}

/**
 * The features' USABLE shape: the streaming promise OR React's
 * sync-fulfilled promise (a promise with the `status: "fulfilled"` +
 * `value` fields attached — React's `use()` FAST PATH returns it
 * synchronously, so the composed render's layers never suspend).
 */
export type ChromeTranscriptFeaturesUsable = Promise<ChromeTranscriptFeatures | null>;

/**
 * Build React's sync-fulfilled usable for the translate features (the
 * same `use()` fast path — the composed render never suspends).
 */
export function fulfilledTranslateFeatures(
  route: RealtimeRouteView | null,
): ChromeTranslateFeaturesUsable {
  const promise = Promise.resolve(route) as ChromeTranslateFeaturesUsable & {
    status?: "fulfilled";
    value?: RealtimeRouteView | null;
  };
  promise.status = "fulfilled";
  promise.value = route;
  return promise;
}

/**
 * Build React's sync-fulfilled usable (the `use()` fast path — the
 * promise carries the fulfilled status/value fields React reads
 * synchronously; the composed/test render never suspends).
 */
export function fulfilledTranscriptFeatures(
  features: ChromeTranscriptFeatures | null,
): ChromeTranscriptFeaturesUsable {
  const promise = Promise.resolve(features) as ChromeTranscriptFeaturesUsable & {
    status?: "fulfilled";
    value?: ChromeTranscriptFeatures | null;
  };
  promise.status = "fulfilled";
  promise.value = features;
  return promise;
}

/** The chrome's translate-features usable (the same streaming-promise discipline as the transcript features). */
export type ChromeTranslateFeaturesUsable = Promise<RealtimeRouteView | null>;

/** The language label derivation (the row's rendering). */
function languageLabelOf(route: RealtimeRouteView, code: string): string {
  return route.targetLanguages.find((language) => language.code === code)?.label ?? code;
}

/** The chrome's serialized view input (server-computed per render). */
export interface PlayerChromeProps {
  readonly sessionId: string;
  /** The runtime's truthful phase at render time. */
  readonly initialPhase: string;
  readonly initialPositionMs: number;
  readonly initialBufferedMs: number;
  /** The known duration (ms); null when unknown — the scrub bar stays honest. */
  readonly durationMs: number | null;
  /**
   * R24-E — the transcript-derived features (the chapters + the caption
   * source). The intelligence artifact is the DEFERRED lane: the shell
   * passes either the sync-resolved usable (the composed render) or the
   * streaming PROMISE (the page's split — the features arrive behind the
   * shell and the marks/overlay layers suspend locally, NEVER the
   * transport bar: the chrome stays stable during init while the
   * nonessential artifact streams in).
   */
  readonly transcriptFeatures: ChromeTranscriptFeaturesUsable;
  /**
   * R25-W2 — the realtime translation route view (the composed stage
   * truth). Optional (the row renders only when provided — the surface
   * always passes it; direct-render tests may omit). The same streaming
   * discipline as the transcript features: a LOCAL suspension inside
   * the settings panel, never the transport bar.
   */
  readonly translateFeatures?: ChromeTranslateFeaturesUsable;
  /**
   * Whether WebFlix owns THIS stage's media path (the authorized peer
   * copy's browser rung) — the volume/mute cluster and the media-rate
   * application render only where they truthfully operate.
   */
  readonly webflixOwnsStage: boolean;
  /** The realization mode ("embed" | "browser" | "external" | "native"). */
  readonly surfaceMode: string;
  /** The per-realization quality truth sentence (settings cluster row). */
  readonly qualityTruth: string;
  /** The attention-policy sentence that governs autoplay (rendered in settings). */
  readonly autoplaySentence: string;
  /**
   * R26-W2 — the page's playback intent (the exact resolve input the
   * shell used), carried with every /api/playback command so a cold
   * serverless invocation re-resolves the SAME session through the frozen
   * path (the production multi-instance law). Null where no runtime
   * session backs the surface.
   */
  readonly sessionIntent: ClientPlaybackIntent | null;
  /**
   * R26-W2 — whether the stage binds the provider's own embed control
   * contract (the EmbedStage's family check): the transport commands then
   * dispatch to the provider's real player, and the provider's own state
   * broadcasts are the only evidence that advances the visible phase.
   */
  readonly embedControl: boolean;
  /**
   * R27-W2 — the NEXT control's real destination (the session queue
   * head's player href); null renders no next control (the corpus: next
   * only when queued — never a dead button).
   */
  readonly nextHref?: string | null;
  /**
   * R29-B (N25) — THE COMPACT MINIPLAYER FORM: the dock's 400×225
   * chrome — the theater + next controls stay absent (the mini's own
   * control set), the miniplayer control becomes EXPAND (back to the
   * full player surface), and the live position writes to the dock's
   * sessionStorage entry (the same-origin persistence seam — the honest
   * cross-navigation continuation).
   */
  readonly compact?: boolean;
}

/** The familiar speed steps (the settings cluster's vocabulary). */
const SPEED_STEPS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** The keyboard grammar's seek deltas. */
const BIG_SEEK_MS = 10_000;
const SMALL_SEEK_MS = 5_000;

/** Format a position/duration readout (mm:ss / h:mm:ss). */
function formatReadout(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const two = (n: number): string => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

/** The typed command outcome the chrome renders verbatim. */
interface CommandStatus {
  readonly ok: boolean;
  readonly detail: string | null;
}

/**
 * The transcript-derived CHAPTER MARKS layer (the suspended features:
 * the marks render when the intelligence artifact streams in — the
 * transport bar itself NEVER suspends, R24-E's stable-chrome law).
 */
function ChapterMarksLayer({
  features,
  duration,
}: {
  readonly features: ChromeTranscriptFeaturesUsable;
  readonly duration: number | null;
}): JSX.Element | null {
  const resolved = use<ChromeTranscriptFeatures | null>(features);
  if (resolved === null || duration === null || duration <= 0) return null;
  const marks = resolved.chapters
    .filter((chapter) => chapter.startMs > 0 && chapter.startMs < duration)
    .map((chapter) => ({
      title: chapter.title,
      left: `${(chapter.startMs / duration) * 100}%`,
    }));
  if (marks.length === 0) return null;
  return (
    <>
      {marks.map((mark) => (
        <span key={mark.left} className="wfx-chrome__chaptermark" style={{ left: mark.left }} title={mark.title} />
      ))}
    </>
  );
}

/**
 * The CAPTIONS layer (the suspended features): the captions CONTROL
 * (in the transport bar) and the position-synced OVERLAY (at the stage
 * root) — two PARTS of one features-derived truth. The control's
 * PRESENCE derives from the RESOLVED features (a transcript exists or
 * not) — inside the boundary, never from the parent's
 * promise-status-dependent conditional (the stable-hydration law: the
 * same resolved truth answers at SSR and at hydration). The overlay
 * renders the current segment when captions are on — no ticker, no
 * fabricated text.
 */
function CaptionsLayer({
  features,
  part,
  captionsOn,
  positionMs,
  onToggle,
}: {
  readonly features: ChromeTranscriptFeaturesUsable;
  readonly part: "control" | "overlay";
  readonly captionsOn: boolean;
  readonly positionMs: number;
  readonly onToggle: () => void;
}): JSX.Element | null {
  const resolved = use<ChromeTranscriptFeatures | null>(features);
  if (resolved === null || resolved.transcript.length === 0) return null;
  if (part === "control") {
    return (
      <button
        type="button"
        className={`wfx-chrome__btn${captionsOn ? " wfx-chrome__btn--active" : ""}`}
        onClick={onToggle}
        aria-label={captionsOn ? "Turn captions off (c)" : "Turn captions on (c)"}
        aria-pressed={captionsOn}
        data-wfx-chrome-captions
      >
        <Icon name="captions" size={20} />
      </button>
    );
  }
  if (!captionsOn) return null;
  const segment =
    resolved.transcript.find(
      (candidate) => positionMs >= candidate.startMs && positionMs < candidate.endMs,
    ) ?? null;
  if (segment === null) return null;
  return (
    <div className="wfx-chrome__caption" data-wfx-caption-line aria-live="polite">
      {segment.speaker !== undefined && segment.speaker.length > 0 ? (
        <span className="wfx-chrome__captionspeaker">{segment.speaker}: </span>
      ) : null}
      {segment.text}
    </div>
  );
}

/**
 * R25-W2 — THE TRANSLATE ROW (the settings cluster's language control,
 * §R25-G's "Translate → [target language]" in the R24 disclosure
 * grammar). The row renders the route view's gate truths + the target
 * language buttons (one click starts the session); a live session
 * renders the subtitle-mode buttons (translated / original + translated
 * / original) + the stop control. The row rides the suspended features
 * layer (a LOCAL suspension inside the settings panel — the transport
 * bar never suspends) and binds the surface's shared session
 * controller (the experience island's — one controller, two views).
 */
function TranslateRowLayer({
  features,
  onSessionStarted,
}: {
  readonly features: ChromeTranslateFeaturesUsable;
  readonly onSessionStarted: () => void;
}): JSX.Element | null {
  const route = use<RealtimeRouteView | null>(features);
  // The ACTIVE-phase proxy store (resolved at read time — the island
  // binds the controller after this row's first render; the store
  // re-renders when the binding lands).
  const phase = useSyncExternalStore(subscribeActiveRealtimePhase, getActiveRealtimePhase, idleRealtimePhaseSnapshot);
  const startWith = (code: string): void => {
    // The controller resolves at CLICK time (never a stale capture).
    getActiveRealtimeSessionController()?.start(code);
    onSessionStarted();
  };
  if (route === null) return null;
  const ready = route.readiness.kind === "ready" && route.route !== null && route.route.kind === "registered-provider";
  const state = phase.phase;
  return (
    <div className="wfx-chrome__settingsrow" data-wfx-translate-row data-wfx-translate-row-state={
    state === "live" ? "live" : state === "connecting" ? "connecting" : state === "failed" ? "failed" : state === "stopped" ? "stopped" : ready ? "ready" : route.readiness.kind
    }>
      <span>Translate</span>
      {route.readiness.kind !== "ready" ? (
        <>
          <span className="wfx-chrome__settingstruth" data-wfx-translate-gate={route.readiness.kind}>
            {route.readiness.detail}
          </span>
          {route.readiness.kind === "restricted-realization" ? (
            <span className="wfx-chrome__settingstruth" data-wfx-translate-alternatives>
              {realtimeRestrictedAlternativesSentence(route.readiness)}
            </span>
          ) : null}
        </>
      ) : route.route !== null && route.route.kind === "no-realtime-provider-registered" ? (
        <>
          <span className="wfx-chrome__settingstruth" data-wfx-translate-gate="no-realtime-provider-registered">
            {route.route.detail}
          </span>
          <span className="wfx-chrome__settingstruth">{route.route.recovery}</span>
        </>
      ) : state === "live" ? (
        <>
          <div className="wfx-chrome__speedsteps" role="group" aria-label="Captions language">
            <span className="wfx-chrome__stepbtn wfx-chrome__stepbtn--active" data-wfx-translate-active-target>
              → {languageLabelOf(route, phase.targetLanguage)}
            </span>
            <button
              type="button"
              className="wfx-chrome__stepbtn"
              onClick={() => {
                getActiveRealtimeSessionController()?.stop();
              }}
              data-wfx-translate-stop
            >
              Stop
            </button>
          </div>
          <div className="wfx-chrome__speedsteps" role="group" aria-label="Subtitle mode">
            {(["translated", "bilingual", "source"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`wfx-chrome__stepbtn${phase.subtitleMode === mode ? " wfx-chrome__stepbtn--active" : ""}`}
                onClick={() => {
                  getActiveRealtimeSessionController()?.setSubtitleMode(mode);
                }}
                aria-pressed={phase.subtitleMode === mode}
                data-wfx-translate-mode={mode}
              >
                {mode === "translated" ? "Translated" : mode === "bilingual" ? "Original + translated" : "Original"}
              </button>
            ))}
          </div>
          <span className="wfx-chrome__settingstruth" data-wfx-translate-status>
            {phase.recovering
              ? "reconnecting the session…"
              : phase.lastRecoverable !== null
                ? phase.lastRecoverable.detail
                : "the live bilingual view renders below the player; the transcript below keeps its own truth"}
          </span>
        </>
      ) : state === "connecting" ? (
        <span className="wfx-chrome__settingstruth" data-wfx-translate-status>starting the translation…</span>
      ) : state === "failed" ? (
        <>
          <span className="wfx-chrome__settingstruth" data-wfx-translate-failure-detail>
            Translation stopped ({phase.errorKind}) — original captions remain available.
          </span>
          <div className="wfx-chrome__speedsteps" role="group" aria-label="Translation retry">
            {route.targetLanguages.map((language) => (
              <button
                key={language.code}
                type="button"
                className="wfx-chrome__stepbtn"
                onClick={() => {
                  startWith(language.code);
                }}
                data-wfx-translate-target={language.code}
              >
                → {language.label}
              </button>
            ))}
          </div>
        </>
      ) : ready ? (
        <>
          <div className="wfx-chrome__speedsteps" role="group" aria-label="Translate to a language">
            {route.targetLanguages.map((language) => (
              <button
                key={language.code}
                type="button"
                className="wfx-chrome__stepbtn"
                onClick={() => {
                  startWith(language.code);
                }}
                data-wfx-translate-target={language.code}
              >
                → {language.label}
              </button>
            ))}
          </div>
          <span className="wfx-chrome__settingstruth" data-wfx-translate-truth>
            Live translation over the WebFlix bridge — no account needed; the cost policy governs the session.
          </span>
        </>
      ) : (
        <span className="wfx-chrome__settingstruth" data-wfx-translate-gate="no-languages">
          No translation directions are registered.
        </span>
      )}
    </div>
  );
}

/**
 * R25-W2 — THE CAPTION OVERLAY DISPATCHER: while a live translation
 * session runs with subtitle mode translated/bilingual, the overlay
 * renders the LIVE stream's current segment (the translated line + the
 * source line under it) — the live stream's own timing, like live TV
 * captions. The original artifact overlay (position-synced) renders
 * otherwise — the R24 law unchanged. The dispatcher is FULLY
 * SUBSCRIBED to the session phase (the switch itself re-renders on
 * every phase change, never a stale dual render).
 */
function CaptionOverlayDispatcher({
  features,
  captionsOn,
  positionMs,
  onToggle,
}: {
  readonly features: ChromeTranscriptFeaturesUsable;
  readonly captionsOn: boolean;
  readonly positionMs: number;
  readonly onToggle: () => void;
}): JSX.Element | null {
  const phase = useSyncExternalStore(subscribeActiveRealtimePhase, getActiveRealtimePhase, idleRealtimePhaseSnapshot);
  if (!captionsOn) return null;
  // The LIVE bilingual overlay (the translated line + the source line
  // when the mode is bilingual).
  if (phase.phase === "live" && phase.subtitleMode !== "source") {
    const segments = [...phase.segments].filter(
      (segment) => segment.translationText.length > 0 || segment.sourceText.length > 0,
    );
    if (segments.length === 0) return null;
    const current = segments[segments.length - 1]!;
    return (
      <div className="wfx-chrome__caption" data-wfx-caption-line data-wfx-caption-live="true" aria-live="polite">
        {phase.subtitleMode === "bilingual" ? (
          <span className="wfx-chrome__captionsource" data-wfx-caption-source>
            {current.speakerLabel !== null ? `${current.speakerLabel}: ` : ""}
            {current.sourceText}
          </span>
        ) : null}
        <span className="wfx-chrome__captiontranslation" data-wfx-caption-translation>
          {current.translationText.length > 0 ? current.translationText : "…"}
        </span>
      </div>
    );
  }
  // The artifact overlay (the transcript artifact, position-synced — the
  // R24 law; a LOCAL suspension).
  return (
    <Suspense fallback={null}>
      <CaptionsLayer
        features={features}
        part="overlay"
        captionsOn={captionsOn}
        positionMs={positionMs}
        onToggle={onToggle}
      />
    </Suspense>
  );
}

/**
 * The WebFlix player chrome — the transport bar + the settings cluster
 * + the caption overlay + the keyboard grammar, wired to the runtime's
 * real commands.
 */
export function PlayerChrome(props: PlayerChromeProps): JSX.Element {
  const [phase, setPhase] = useState<string>(props.initialPhase);
  const [positionMs, setPositionMs] = useState<number>(props.initialPositionMs);
  const [bufferedMs, setBufferedMs] = useState<number>(props.initialBufferedMs);
  const [command, setCommand] = useState<CommandStatus | null>(null);
  const [muted, setMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  const [rate, setRate] = useState<number>(1);
  const [captionsOn, setCaptionsOn] = useState<boolean>(false);
  const [fullscreenOn, setFullscreenOn] = useState<boolean>(false);
  // R27-W2 — THEATER (the t key's truth: the stage goes full-bleed) +
  // the IDLE FADE (controls fade on ~3s idle, reveal on mousemove —
  // the corpus motion law; focus-within and open menus hold them up).
  const [theaterOn, setTheaterOn] = useState<boolean>(false);
  const [chromeIdle, setChromeIdle] = useState<boolean>(false);
  const [settingsLevel, setSettingsLevel] = useState<1 | 2>(1);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubRef = useRef<HTMLDivElement | null>(null);

  /** Reveal the controls + restart the ~3s idle countdown (the corpus law). */
  const revealControls = useCallback((): void => {
    setChromeIdle(false);
    if (idleTimer.current !== null) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      setChromeIdle(true);
    }, 3000);
  }, []);

  useEffect(() => {
    const onMove = (): void => {
      revealControls();
    };
    window.addEventListener("mousemove", onMove);
    revealControls();
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (idleTimer.current !== null) clearTimeout(idleTimer.current);
    };
  }, [revealControls]);

  /** THEATER: toggle the full-bleed stage (the t key — the corpus grammar). */
  const toggleTheater = useCallback((): void => {
    const stage = document.querySelector<HTMLElement>("[data-wfx-player-stagewrap]");
    const playerRoot = document.querySelector<HTMLElement>("[data-wfx-surface='player']");
    setTheaterOn((current) => {
      const next = !current;
      if (stage !== null) {
        stage.classList.toggle("wfx-player__stagewrap--theater", next);
        stage.dataset.wfxTheater = next ? "true" : "false";
      }
      if (playerRoot !== null) {
        playerRoot.classList.toggle("wfx-player--theater", next);
      }
      return next;
    });
  }, []);

  // R26-W2 — THE PROVIDER EMBED CONTROL CONTRACT's evidence store: when the
  // stage bound the provider's own embed player API (the EmbedStage) and
  // the provider ANSWERED (live), the realization's own broadcasts are the
  // ONLY evidence that advances the visible phase/position/duration — the
  // server session's snapshot remains the honest fallback otherwise
  // (never a fabricated live state: a provider that never answered keeps
  // `live: false` and the pre-R26 truthful behavior).
  const embedControlState = useSyncExternalStore(
    subscribeActiveEmbedControl,
    getActiveEmbedControl,
    idleEmbedControlSnapshot,
  );
  const embedLive = props.embedControl && embedControlState.live;

  /** Map the provider's own player state onto the runtime's phase vocabulary (evidence only). */
  const embedPhaseOf = (state: EmbedControlState): string => {
    switch (state.phase) {
      case "playing":
        return "playing";
      case "paused":
        return "paused";
      case "ended":
        return "stopped";
      case "buffering":
      case "unstarted":
      default:
        return "buffering";
    }
  };

  // The visible truths: the realization's own evidence when live, the
  // session's otherwise (the server-path states — identical to pre-R26).
  const visiblePhase = embedLive ? embedPhaseOf(embedControlState) : phase;
  const visiblePositionMs = embedLive ? embedControlState.positionMs : positionMs;
  const duration =
    embedLive && embedControlState.durationMs !== null
      ? embedControlState.durationMs
      : (props.durationMs ?? null);
  const playing = visiblePhase === "playing";
  const terminal = visiblePhase === "stopped" || visiblePhase === "failed" || visiblePhase === "unresolvable";

  /** Issue one typed command through the real route; render its truth. */
  const issue = useCallback(
    async (kind: "play" | "pause" | "seek" | "stop", positionMs?: number): Promise<void> => {
      if (props.sessionId === "none" || props.sessionId === "") {
        setCommand({ ok: false, detail: "no playback session on this surface" });
        return;
      }
      // R24-E — the seek/control marker pairs wrap the real round trip:
      // the request at invocation, the confirmation at the VISIBLE effect
      // (the accepted state read — the only progress truth).
      if (kind === "seek") {
        recordPlaybackMarker("seek-requested", `seek → ${positionMs ?? 0}ms`);
      } else {
        recordPlaybackMarker("control-invoked", kind);
      }
      // R26-W2 — the PROVIDER EMBED realization control: dispatch the
      // command to the provider's own player FIRST (the real player — the
      // provider's documented embed control channel), then record the
      // session command through /api/playback (the same typed transport
      // every way of watching uses). The provider's own state broadcasts
      // (the evidence store) advance the visible phase — the command's
      // result never fabricates one.
      if (props.embedControl) {
        const providerController = getActiveEmbedSessionController();
        if (providerController !== null) {
          if (kind === "play") providerController.play();
          else if (kind === "pause") providerController.pause();
          else if (kind === "seek" && positionMs !== undefined) providerController.seek(positionMs);
        }
      }
      try {
        const response = await fetch("/api/playback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: props.sessionId,
            command: kind,
            ...(kind === "seek" && positionMs !== undefined ? { positionMs } : {}),
            // R26-W2 — the client-carried intent (the multi-instance law):
            // a cold invocation re-resolves the SAME session through the
            // frozen path instead of answering the typed not-found.
            ...(props.sessionIntent !== null ? { intent: props.sessionIntent } : {}),
          }),
        });
        const outcome = (await response.json()) as {
          ok?: boolean;
          detail?: string;
          kind?: string;
          state?: { phase: string; positionMs: number; bufferedMs: number };
        };
        setCommand({
          ok: outcome.ok === true,
          detail:
            outcome.ok === true
              ? null
              : `${outcome.kind ?? "failed"}: ${outcome.detail ?? "the command was refused"}`,
        });
        if (outcome.ok === true) {
          // R26-W2 — the POST response carries the post-command state
          // snapshot (one round trip). Where the provider's embed evidence
          // is live, the evidence store overrides the display anyway (the
          // realization's own truth); these setters keep the session-path
          // display truthful otherwise.
          if (outcome.state !== undefined) {
            setPhase(outcome.state.phase);
            setPositionMs(outcome.state.positionMs);
            setBufferedMs(outcome.state.bufferedMs);
            // R24-E — the confirmation at the visible effect: the state
            // rendered is the effect the metric measures.
            if (kind === "seek") {
              recordPlaybackMarker("seek-confirmed", `position ${outcome.state.positionMs}ms accepted`);
            } else {
              recordPlaybackMarker("control-confirmed", `${kind} → phase ${outcome.state.phase}`);
            }
          } else if (kind === "seek" && positionMs !== undefined) {
            // Seek acceptance IS position evidence (the runtime's law) —
            // optimistic truth even if the state read failed.
            setPositionMs(positionMs);
          }
        }
      } catch {
        setCommand({ ok: false, detail: "the command could not reach the host" });
      }
    },
    [props.embedControl, props.sessionId, props.sessionIntent],
  );

  /** Seek to an absolute position (the scrub bar + the keyboard grammar). */
  const seekTo = useCallback(
    (targetMs: number): void => {
      const bounded = Math.max(0, duration !== null ? Math.min(targetMs, duration) : targetMs);
      void issue("seek", bounded);
    },
    [duration, issue],
  );

  /** Toggle play/pause through the real command (the visible phase's truth). */
  const togglePlay = useCallback((): void => {
    void issue(playing || visiblePhase === "degraded" ? "pause" : "play");
  }, [issue, playing, visiblePhase]);

  /**
   * Apply the volume/mute truth to the stage's own media element (the
   * WebFlix-owned stages) — or to the provider's own player through its
   * embed control API (the R26-W2 realization-exposed binding).
   */
  const applyStageVolume = useCallback(
    (nextVolume: number, nextMuted: boolean): void => {
      if (props.embedControl) {
        // R26-W2 — the provider's own player carries the control; WebFlix's
        // chrome binds the provider's documented embed API (never a
        // fabricated WebFlix control over provider media).
        const providerController = getActiveEmbedSessionController();
        if (providerController !== null && getActiveEmbedControl().live) {
          providerController.setVolume(nextVolume);
          providerController.setMuted(nextMuted);
          return;
        }
      }
      const stage = document.querySelector<HTMLElement>("[data-wfx-player-stagewrap]");
      const media = stage?.querySelectorAll("video, audio");
      if (media !== undefined && media !== null) {
        for (const element of Array.from(media)) {
          const mediaElement = element as HTMLMediaElement;
          mediaElement.volume = nextVolume;
          mediaElement.muted = nextMuted;
        }
      }
    },
    [props.embedControl],
  );

  /** Toggle mute (where the volume control truthfully operates — the honest cluster). */
  const toggleMute = useCallback((): void => {
    if (!props.webflixOwnsStage && !embedLive) return;
    const next = !muted;
    setMuted(next);
    applyStageVolume(volume, next);
  }, [applyStageVolume, embedLive, muted, props.webflixOwnsStage, volume]);

  /** Step the volume (the keyboard grammar's up/down). */
  const stepVolume = useCallback(
    (direction: 1 | -1): void => {
      if (!props.webflixOwnsStage && !embedLive) return;
      const next = Math.min(1, Math.max(0, volume + direction * 0.1));
      setVolume(next);
      setMuted(false);
      applyStageVolume(next, false);
    },
    [applyStageVolume, embedLive, props.webflixOwnsStage, volume],
  );

  /** Enter/leave fullscreen through the platform's own affordance. */
  const toggleFullscreen = useCallback((): void => {
    const stage = document.querySelector<HTMLElement>("[data-wfx-player-stagewrap]");
    if (stage === null) return;
    if (document.fullscreenElement === stage) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void stage.requestFullscreen().catch(() => {
        setCommand({ ok: false, detail: "the platform refused fullscreen for this stage" });
      });
    }
  }, []);

  /**
   * R29-B (N25) — THE IN-APP MINIPLAYER (the corpus grammar: "i" or the
   * miniplayer control docks the playback as a bottom-right floating
   * player, persistent across navigation). The pre-R29 Document-PiP
   * stand-in (the platform's own always-on-top window) is retired in
   * favor of the corpus's IN-APP dock — no platform window, no separate
   * document; the SAME /player route in its compact form.
   *
   * THE DOCK FLOW (the full player surface): store the dock state (the
   * player href + the title + the LIVE position) in sessionStorage —
   * the dock island on every page renders the compact stage from it,
   * and the same-origin compact player advances the stored position as
   * it plays — then navigate to the browse surface (the honest
   * "minimize": the item keeps playing in the corner; YouTube's own
   * behavior, the MPA's own mechanism — the iframe re-mounts per page,
   * resuming from the real position, never claimed otherwise).
   */
  const toggleMiniplayer = useCallback((): void => {
    if (props.compact === true) {
      // EXPAND: the compact form's own control — back to the full
      // player surface at the live position (the dock clears; the
      // parent window is the same-origin dock host).
      const url = new URL(window.location.href);
      url.searchParams.delete("miniplayer");
      if (visiblePositionMs > 0) url.searchParams.set("resume", String(Math.round(visiblePositionMs)));
      try {
        sessionStorage.removeItem("wfx-miniplayer");
      } catch {
        // The persistence seam is unavailable — the navigation still lands.
      }
      const dockHost = window.parent;
      if (dockHost !== null && dockHost !== window) {
        dockHost.location.assign(url.pathname + url.search);
      } else {
        window.location.assign(url.pathname + url.search);
      }
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("miniplayer");
    url.searchParams.delete("resume");
    if (visiblePositionMs > 0) url.searchParams.set("resume", String(Math.round(visiblePositionMs)));
    const title =
      document.querySelector<HTMLElement>("[data-wfx-player-title]")?.textContent ?? "Playback";
    try {
      sessionStorage.setItem(
        "wfx-miniplayer",
        JSON.stringify({
          href: url.pathname + url.search,
          title,
          positionMs: Math.round(visiblePositionMs),
        }),
      );
    } catch {
      // The persistence seam is unavailable — the dock cannot survive
      // navigation without it; the honest refusal (never a fake dock).
      setCommand({ ok: false, detail: "this browser context cannot keep a miniplayer" });
      return;
    }
    window.location.assign("/");
  }, [props.compact, visiblePositionMs]);

  /**
   * R29-B (N25) — THE COMPACT FORM'S POSITION PERSISTENCE: the dock's
   * compact player advances the stored dock position every ~3s (the
   * same-origin sessionStorage seam — the dock island and the compact
   * page share the tab's storage), so each navigation resumes from the
   * REAL position. Evidence-only: the position written is the same
   * visiblePositionMs the chrome renders.
   */
  useEffect(() => {
    if (props.compact !== true) return;
    const interval = setInterval(() => {
      try {
        const raw = sessionStorage.getItem("wfx-miniplayer");
        if (raw === null) return;
        const parsed = JSON.parse(raw) as { href?: unknown; title?: unknown; positionMs?: unknown };
        if (typeof parsed.href !== "string" || typeof parsed.title !== "string") return;
        sessionStorage.setItem(
          "wfx-miniplayer",
          JSON.stringify({
            href: parsed.href,
            title: parsed.title,
            positionMs: Math.round(visiblePositionMs),
          }),
        );
      } catch {
        // Best-effort persistence — the playback itself is unaffected.
      }
    }, 3000);
    return () => {
      clearInterval(interval);
    };
  }, [props.compact, visiblePositionMs]);

  /**
   * Set the session rate: applied to the WebFlix-owned stage's media, or
   * through the provider's own embed player API where that is the live
   * control surface (R26-W2 — the honest realization-exposed binding).
   */
  const setPlaybackRate = useCallback(
    (nextRate: number): void => {
      setRate(nextRate);
      if (props.embedControl) {
        const providerController = getActiveEmbedSessionController();
        if (providerController !== null && getActiveEmbedControl().live) {
          providerController.setRate(nextRate);
          return;
        }
      }
      const stage = document.querySelector<HTMLElement>("[data-wfx-player-stagewrap]");
      const media = stage?.querySelectorAll("video, audio");
      if (media !== undefined && media !== null) {
        for (const element of Array.from(media)) {
          (element as HTMLMediaElement).playbackRate = nextRate;
        }
      }
    },
    [props.embedControl],
  );

  /** THE KEYBOARD GRAMMAR (the familiar map, active when not typing). */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      let handled = true;
      // The keyboard grammar seeks from the VISIBLE position (the
      // realization's own evidence when the embed control is live).
      const from = visiblePositionMs;
      switch (key) {
        case " ":
        case "k":
          if (!terminal) togglePlay();
          break;
        case "j":
          if (!terminal) seekTo(from - BIG_SEEK_MS);
          break;
        case "l":
          if (!terminal) seekTo(from + BIG_SEEK_MS);
          break;
        case "arrowleft":
          if (!terminal) seekTo(from - SMALL_SEEK_MS);
          break;
        case "arrowright":
          if (!terminal) seekTo(from + SMALL_SEEK_MS);
          break;
        case "arrowup":
          stepVolume(1);
          break;
        case "arrowdown":
          stepVolume(-1);
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          toggleFullscreen();
          break;
        case "c":
          setCaptionsOn((current) => !current);
          break;
        case "t": {
          // R27-W2 — T is THEATER (the corpus keyboard grammar: "t
          // theater"); the shortcut sheet lives in the settings menu's
          // second level + the ? key. R29-B: the compact miniplayer form
          // carries no theater state (the mini's own control set).
          if (props.compact !== true) toggleTheater();
          break;
        }
        case "i": {
          // R29-B (N25) — I is THE IN-APP MINIPLAYER (the corpus keyboard
          // grammar: "i miniplayer" — the dock on the full surface, the
          // expand action in the compact form).
          toggleMiniplayer();
          break;
        }
        case "?": {
          const sheet = document.querySelector<HTMLDetailsElement>("[data-wfx-chrome-keyboard-sheet]");
          if (sheet !== null) sheet.open = !sheet.open;
          break;
        }
        default:
          if (/^[0-9]$/.test(key) && !terminal && duration !== null) {
            seekTo((Number(key) / 10) * duration);
          } else {
            handled = false;
          }
      }
      if (handled) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    duration,
    seekTo,
    stepVolume,
    terminal,
    toggleFullscreen,
    toggleMute,
    togglePlay,
    toggleTheater,
    visiblePositionMs,
  ]);

  /** Track the platform's fullscreen transitions (the honest state). */
  useEffect(() => {
    const onFullscreenChange = (): void => {
      setFullscreenOn(
        document.fullscreenElement !== null &&
          document.fullscreenElement === document.querySelector("[data-wfx-player-stagewrap]"),
      );
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  /** The scrub bar's position ratio (honest — from the truthful VISIBLE position). */
  const ratio =
    duration !== null && duration > 0 ? Math.min(1, Math.max(0, visiblePositionMs / duration)) : 0;
  // The buffered bar: the provider's OWN loaded-fraction evidence when the
  // embed control is live (videoLoadedFraction × duration — provider
  // reported, never estimated); the session's bufferedMs otherwise.
  const visibleBufferedMs =
    embedLive && embedControlState.loadedFraction !== null && duration !== null
      ? embedControlState.loadedFraction * duration
      : bufferedMs;
  const bufferedRatio =
    duration !== null && duration > 0 ? Math.min(1, Math.max(0, visibleBufferedMs / duration)) : 0;

  /** The scrub bar's seek-from-event (direct manipulation). */
  const seekFromEvent = useCallback(
    (clientX: number): void => {
      const scrub = scrubRef.current;
      if (scrub === null || duration === null || duration <= 0) return;
      const rect = scrub.getBoundingClientRect();
      const nextRatio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      seekTo(nextRatio * duration);
    },
    [duration, seekTo],
  );

  return (
    <div
      className="wfx-chrome"
      data-wfx-chrome
      data-wfx-chrome-phase={visiblePhase}
      data-wfx-chrome-idle={chromeIdle ? "true" : "false"}
      onMouseMove={revealControls}
    >
      {/* THE SCRUB BAR (direct manipulation + chapter marks + honest
          buffered) — the red #f03 progress with the white 12px scrubber
          dot, hover-expanded (the corpus motion law). */}
      <div
        className="wfx-chrome__scrub"
        ref={scrubRef}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={duration !== null ? Math.round(duration / 1000) : 0}
        aria-valuenow={Math.round(visiblePositionMs / 1000)}
        aria-valuetext={`${formatReadout(visiblePositionMs)} of ${duration !== null ? formatReadout(duration) : "unknown length"}`}
        data-wfx-chrome-seek
        onPointerDown={(event) => {
          if (terminal) return;
          revealControls();
          seekFromEvent(event.clientX);
        }}
        onKeyDown={(event) => {
          if (terminal) return;
          if (event.key === "ArrowLeft") seekTo(visiblePositionMs - SMALL_SEEK_MS);
          if (event.key === "ArrowRight") seekTo(visiblePositionMs + SMALL_SEEK_MS);
          if (event.key === "Home") seekTo(0);
          if (event.key === "End" && duration !== null) seekTo(duration);
        }}
      >
        <span className="wfx-chrome__track" aria-hidden="true">
          {bufferedRatio > 0 ? (
            <span className="wfx-chrome__buffered" style={{ width: `${bufferedRatio * 100}%` }} />
          ) : null}
          <span className="wfx-chrome__played" style={{ width: `${ratio * 100}%` }} />
          {/* R24-E — the chapter marks ride the streamed features layer
              (a LOCAL suspension — the transport bar never suspends). */}
          <Suspense fallback={null}>
            <ChapterMarksLayer features={props.transcriptFeatures} duration={duration} />
          </Suspense>
          <span className="wfx-chrome__thumb" style={{ left: `${ratio * 100}%` }} />
        </span>
      </div>

      {/* THE TRANSPORT BAR (the corpus order: play · next · volume ·
          time · spacer · captions · settings · miniplayer · theater ·
          fullscreen). */}
      <div className="wfx-chrome__bar" data-wfx-chrome-bar>
        <div className="wfx-chrome__cluster">
          <button
            type="button"
            className="wfx-chrome__btn"
            onClick={togglePlay}
            disabled={terminal}
            aria-label={playing ? "Pause (k)" : "Play (k)"}
            data-wfx-chrome-play
            data-wfx-chrome-playing={playing ? "true" : "false"}
          >
            <Icon name={playing ? "pause" : "play"} size={22} />
          </button>
          {/* R27-W2 — THE NEXT CONTROL (the corpus: next when queued —
              the session queue head's real player href; never a dead
              button). */}
          {props.compact !== true &&
          props.nextHref !== undefined &&
          props.nextHref !== null &&
          props.nextHref.length > 0 ? (
            <a
              className="wfx-chrome__btn"
              href={props.nextHref}
              aria-label="Next (the session queue head)"
              data-wfx-chrome-next
            >
              <Icon name="skip" size={22} />
            </a>
          ) : null}
          {props.webflixOwnsStage || embedLive ? (
            <div className="wfx-chrome__volume" data-wfx-chrome-volume>
              <button
                type="button"
                className="wfx-chrome__btn"
                onClick={toggleMute}
                aria-label={muted ? "Unmute (m)" : "Mute (m)"}
                data-wfx-chrome-mute
              >
                <Icon name={muted ? "mute" : "volume"} size={22} />
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                aria-label="Volume"
                data-wfx-chrome-volumeslider
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setVolume(next);
                  setMuted(false);
                  applyStageVolume(next, false);
                }}
              />
            </div>
          ) : null}
          {/* THE TIME READOUT (the corpus: `0:00 / 7:45` in the bar). */}
          <span className="wfx-chrome__readout" aria-hidden="true">
            <span data-wfx-chrome-position>{formatReadout(visiblePositionMs)}</span>
            {" / "}
            <span data-wfx-chrome-duration>{duration !== null ? formatReadout(duration) : "—"}</span>
          </span>
        </div>

        <div className="wfx-chrome__cluster">
          {command !== null && command.detail !== null ? (
            <span className="wfx-chrome__status" role="status" data-wfx-chrome-command-status>
              {command.detail}
            </span>
          ) : null}
          <span className="wfx-chrome__phase" data-wfx-chrome-phase-label>
            {visiblePhase}
          </span>
        </div>

        <div className="wfx-chrome__cluster">
          {/* R24-E — the captions CONTROL rides the suspended features
              layer (the presence derives from the RESOLVED transcript
              truth inside the boundary — the stable-hydration law; the
              transport bar itself never suspends). */}
          <Suspense fallback={null}>
            <CaptionsLayer
              features={props.transcriptFeatures}
              part="control"
              captionsOn={captionsOn}
              positionMs={positionMs}
              onToggle={() => {
                setCaptionsOn((current) => !current);
              }}
            />
          </Suspense>
          {/* THE SETTINGS CLUSTER — YouTube's popup-menu anatomy with the
              TWO-LEVEL navigation (level 2: the shortcuts sheet + the
              playback stats; a back-arrow header returns). The frozen
              R24 rows (speed steps, quality truth, the translate
              languages, autoplay, volume truth) render at LEVEL 1 — the
              golden-journey contract (J40/J43 walk them on open). */}
          <details
            className="wfx-chrome__settings"
            data-wfx-chrome-settings
            onToggle={(event) => {
              revealControls();
              if (!(event.target as HTMLDetailsElement).open) {
                setSettingsLevel(1);
              }
            }}
          >
            <summary className="wfx-chrome__btn" aria-label="Playback settings" data-wfx-chrome-settings-toggle>
              <Icon name="settings" size={22} />
            </summary>
            <div className="wfx-chrome__settingspanel" data-wfx-chrome-settings-panel>
              {settingsLevel === 2 ? (
                <button
                  type="button"
                  className="wfx-chrome__backrow"
                  onClick={() => {
                    setSettingsLevel(1);
                  }}
                  data-wfx-chrome-settings-back
                >
                  <span className="wfx-chrome__backicon">
                    <Icon name="arrowLeft" size={20} />
                  </span>
                  <span>Settings</span>
                </button>
              ) : null}
              {settingsLevel === 1 ? (
                <>
                  <p className="wfx-chrome__settingshead">Playback settings</p>
                  <div className="wfx-chrome__settingsrow" data-wfx-chrome-speed>
                    <span>Speed</span>
                    <div className="wfx-chrome__speedsteps" role="group" aria-label="Playback speed">
                      {SPEED_STEPS.map((step) => (
                        <button
                          key={step}
                          type="button"
                          className={`wfx-chrome__stepbtn${rate === step ? " wfx-chrome__stepbtn--active" : ""}`}
                          onClick={() => {
                            setPlaybackRate(step);
                          }}
                          aria-pressed={rate === step}
                          data-wfx-chrome-speed-step={step}
                        >
                          {step === 1 ? "Normal" : `${step}×`}
                        </button>
                      ))}
                    </div>
                    <span className="wfx-chrome__settingstruth">
                      {props.webflixOwnsStage
                        ? "Applies to this WebFlix stage's playback."
                        : embedLive
                          ? "Applies to this provider embed's own player — carried through the provider's embed controls."
                          : "This way of watching carries its own speed control — the choice applies wherever WebFlix owns the playback."}
                    </span>
                  </div>
                  <div className="wfx-chrome__settingsrow" data-wfx-chrome-quality>
                    <span>Quality</span>
                    <span className="wfx-chrome__settingstruth">{props.qualityTruth}</span>
                  </div>
                </>
              ) : (
                <>
                  <p className="wfx-chrome__settingshead">Shortcuts</p>
                  <div className="wfx-chrome__keysdl">
                    <div>
                      <dt>Space / K</dt>
                      <dd>Play or pause</dd>
                    </div>
                    <div>
                      <dt>J / L</dt>
                      <dd>Back or forward 10 seconds</dd>
                    </div>
                    <div>
                      <dt>← / →</dt>
                      <dd>Back or forward 5 seconds</dd>
                    </div>
                    <div>
                      <dt>↑ / ↓</dt>
                      <dd>Volume up or down</dd>
                    </div>
                    <div>
                      <dt>0–9</dt>
                      <dd>Jump to 0%–90%</dd>
                    </div>
                    <div>
                      <dt>M</dt>
                      <dd>Mute{props.webflixOwnsStage || embedLive ? "" : " (WebFlix-owned stages)"}</dd>
                    </div>
                    <div>
                      <dt>F</dt>
                      <dd>Fullscreen</dd>
                    </div>
                    <div>
                      <dt>T</dt>
                      <dd>Theater view</dd>
                    </div>
                    <div>
                      <dt>I</dt>
                      <dd>Miniplayer</dd>
                    </div>
                    <div>
                      <dt>C</dt>
                      <dd>Captions</dd>
                    </div>
                    <div>
                      <dt>?</dt>
                      <dd>This shortcut sheet</dd>
                    </div>
                  </div>
                </>
              )}
              {settingsLevel === 1 ? (
                <>
                  {/* R25-W2 — THE TRANSLATE ROW (the plan's "Translate →
                      [target language]" control, in the settings cluster's
                      own grammar). A LOCAL suspension — the settings panel
                      streams the row when the realtime route view resolves;
                      the transport bar never suspends. */}
                  {props.translateFeatures !== undefined ? (
                    <Suspense fallback={<div className="wfx-chrome__settingsrow" data-wfx-translate-row data-wfx-translate-row-state="pending" />}>
                      <TranslateRowLayer features={props.translateFeatures} onSessionStarted={() => {
                        setCaptionsOn(true);
                      }} />
                    </Suspense>
                  ) : null}
                  <div className="wfx-chrome__settingsrow" data-wfx-chrome-autoplay-truth>
                    <span>Autoplay</span>
                    <span className="wfx-chrome__settingstruth">{props.autoplaySentence}</span>
                  </div>
                  {!props.webflixOwnsStage && !embedLive ? (
                    <div className="wfx-chrome__settingsrow" data-wfx-chrome-volume-truth>
                      <span>Volume</span>
                      <span className="wfx-chrome__settingstruth">
                        This way of watching carries its own volume control — the provider&apos;s player inside the
                        contained surface answers it.
                      </span>
                    </div>
                  ) : null}
                  {/* The level-2 destinations (YouTube's submenu rows). */}
                  <button
                    type="button"
                    className="wfx-chrome__menurow"
                    onClick={() => {
                      setSettingsLevel(2);
                    }}
                    data-wfx-chrome-settings-shortcuts
                  >
                    <span>Keyboard shortcuts</span>
                    <span aria-hidden="true">›</span>
                  </button>
                  <details className="wfx-chrome__keys" data-wfx-chrome-keyboard-sheet>
                    <summary data-wfx-chrome-keyboard>Keyboard shortcuts</summary>
                    <dl>
                      <div>
                        <dt>Space / K</dt>
                        <dd>Play or pause</dd>
                      </div>
                      <div>
                        <dt>J / L</dt>
                        <dd>Back or forward 10 seconds</dd>
                      </div>
                      <div>
                        <dt>← / →</dt>
                        <dd>Back or forward 5 seconds</dd>
                      </div>
                      <div>
                        <dt>↑ / ↓</dt>
                        <dd>Volume up or down</dd>
                      </div>
                      <div>
                        <dt>0–9</dt>
                        <dd>Jump to 0%–90%</dd>
                      </div>
                      <div>
                        <dt>M</dt>
                        <dd>Mute{props.webflixOwnsStage || embedLive ? "" : " (WebFlix-owned stages)"}</dd>
                      </div>
                      <div>
                        <dt>F</dt>
                        <dd>Fullscreen</dd>
                      </div>
                      <div>
                        <dt>T</dt>
                        <dd>Theater view</dd>
                      </div>
                      <div>
                        <dt>I</dt>
                        <dd>Miniplayer</dd>
                      </div>
                      <div>
                        <dt>C</dt>
                        <dd>Captions</dd>
                      </div>
                      <div>
                        <dt>?</dt>
                        <dd>This shortcut sheet</dd>
                      </div>
                    </dl>
                  </details>
                </>
              ) : null}
            </div>
          </details>
          <button
            type="button"
            className="wfx-chrome__btn"
            onClick={toggleFullscreen}
            aria-label={fullscreenOn ? "Exit fullscreen (f)" : "Fullscreen (f)"}
            data-wfx-chrome-fullscreen
          >
            <Icon name={fullscreenOn ? "fullscreenExit" : "fullscreen"} size={22} />
          </button>
          {/* R27-W2 — THE THEATER CONTROL (the t key's own button — the
              corpus bar's right cluster). R29-B (N25): absent in the
              compact miniplayer form (the mini's own control set); the
              t key follows the same law. */}
          {props.compact !== true ? (
            <button
              type="button"
              className="wfx-chrome__btn"
              onClick={toggleTheater}
              aria-label={theaterOn ? "Exit theater view (t)" : "Theater view (t)"}
              aria-pressed={theaterOn}
              data-wfx-chrome-theater
            >
              <Icon name="theater" size={22} />
            </button>
          ) : null}
          {/* R29-B (N25) — THE MINIPLAYER CONTROL (the i key's own
              button — the corpus bar's right cluster): docks the
              playback into the persistent in-app dock (the full
              surface) or expands back to the full player (the compact
              form). No platform API needed — the in-app dock is
              WebFlix's own surface. */}
          <button
            type="button"
            className="wfx-chrome__btn"
            onClick={toggleMiniplayer}
            aria-label={props.compact === true ? "Expand (i)" : "Miniplayer (i)"}
            data-wfx-chrome-miniplayer
            data-wfx-miniplayer-action={props.compact === true ? "expand" : "dock"}
          >
            <Icon name={props.compact === true ? "fullscreen" : "miniplayer"} size={22} />
          </button>
        </div>
      </div>

      {/* THE CAPTION OVERLAY (R25-W2's dispatcher: the LIVE bilingual
          overlay while a translation session runs; the transcript
          artifact overlay otherwise — the R24 law unchanged; the
          visibility is the C toggle's own state). */}
      <CaptionOverlayDispatcher
        features={props.transcriptFeatures}
        captionsOn={captionsOn}
        positionMs={visiblePositionMs}
        onToggle={() => {
          setCaptionsOn((current) => !current);
        }}
      />
    </div>
  );
}
