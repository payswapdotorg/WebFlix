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
  const scrubRef = useRef<HTMLDivElement | null>(null);

  const duration = props.durationMs ?? null;
  const playing = phase === "playing";
  const terminal = phase === "stopped" || phase === "failed" || phase === "unresolvable";

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
      try {
        const response = await fetch("/api/playback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: props.sessionId,
            command: kind,
            ...(kind === "seek" && positionMs !== undefined ? { positionMs } : {}),
          }),
        });
        const outcome = (await response.json()) as { ok?: boolean; detail?: string; kind?: string };
        setCommand({
          ok: outcome.ok === true,
          detail:
            outcome.ok === true
              ? null
              : `${outcome.kind ?? "failed"}: ${outcome.detail ?? "the command was refused"}`,
        });
        if (outcome.ok === true) {
          // Refetch the truthful state (the only progress source).
          const stateResponse = await fetch(`/api/playback?sessionId=${encodeURIComponent(props.sessionId)}`);
          const stateBody = (await stateResponse.json()) as {
            ok?: boolean;
            state?: { phase: string; positionMs: number; bufferedMs: number };
          };
          if (stateBody.ok === true && stateBody.state !== undefined) {
            setPhase(stateBody.state.phase);
            setPositionMs(stateBody.state.positionMs);
            setBufferedMs(stateBody.state.bufferedMs);
            // R24-E — the confirmation at the visible effect: the state
            // rendered is the effect the metric measures.
            if (kind === "seek") {
              recordPlaybackMarker("seek-confirmed", `position ${stateBody.state.positionMs}ms accepted`);
            } else {
              recordPlaybackMarker("control-confirmed", `${kind} → phase ${stateBody.state.phase}`);
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
    [props.sessionId],
  );

  /** Seek to an absolute position (the scrub bar + the keyboard grammar). */
  const seekTo = useCallback(
    (targetMs: number): void => {
      const bounded = Math.max(0, duration !== null ? Math.min(targetMs, duration) : targetMs);
      void issue("seek", bounded);
    },
    [duration, issue],
  );

  /** Toggle play/pause through the real command. */
  const togglePlay = useCallback((): void => {
    void issue(playing || phase === "degraded" ? "pause" : "play");
  }, [issue, phase, playing]);

  /** Apply the volume/mute truth to the stage's own media element (if any). */
  const applyStageVolume = useCallback((nextVolume: number, nextMuted: boolean): void => {
    const stage = document.querySelector<HTMLElement>("[data-wfx-player-stagewrap]");
    const media = stage?.querySelectorAll("video, audio");
    if (media !== undefined && media !== null) {
      for (const element of Array.from(media)) {
        const mediaElement = element as HTMLMediaElement;
        mediaElement.volume = nextVolume;
        mediaElement.muted = nextMuted;
      }
    }
  }, []);

  /** Toggle mute (WebFlix-owned stages only — the honest cluster). */
  const toggleMute = useCallback((): void => {
    if (!props.webflixOwnsStage) return;
    const next = !muted;
    setMuted(next);
    applyStageVolume(volume, next);
  }, [applyStageVolume, muted, props.webflixOwnsStage, volume]);

  /** Step the volume (the keyboard grammar's up/down). */
  const stepVolume = useCallback(
    (direction: 1 | -1): void => {
      if (!props.webflixOwnsStage) return;
      const next = Math.min(1, Math.max(0, volume + direction * 0.1));
      setVolume(next);
      setMuted(false);
      applyStageVolume(next, false);
    },
    [applyStageVolume, props.webflixOwnsStage, volume],
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

  /** The miniplayer truth (Document PiP where the browser exposes it). */
  const pipAvailable = typeof document !== "undefined" && "documentPictureInPicture" in document;
  const toggleMiniplayer = useCallback((): void => {
    const pipWindow = (document as Document & { documentPictureInPicture?: { window: Window | null } })
      .documentPictureInPicture?.window;
    if (pipWindow !== undefined && pipWindow !== null) {
      pipWindow.close();
      return;
    }
    const api = (document as Document & {
      documentPictureInPicture?: { requestWindow: (options: { width: number; height: number }) => Promise<Window> };
    }).documentPictureInPicture;
    if (api === undefined) {
      setCommand({ ok: false, detail: "this browser does not expose picture-in-picture" });
      return;
    }
    void api
      .requestWindow({ width: 480, height: 270 })
      .then(() => {
        setCommand({ ok: true, detail: null });
      })
      .catch(() => {
        setCommand({ ok: false, detail: "the platform refused the picture-in-picture window" });
      });
  }, []);

  /** Set the session rate (applied where WebFlix owns the media path). */
  const setPlaybackRate = useCallback(
    (nextRate: number): void => {
      setRate(nextRate);
      const stage = document.querySelector<HTMLElement>("[data-wfx-player-stagewrap]");
      const media = stage?.querySelectorAll("video, audio");
      if (media !== undefined && media !== null) {
        for (const element of Array.from(media)) {
          (element as HTMLMediaElement).playbackRate = nextRate;
        }
      }
    },
    [],
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
      switch (key) {
        case " ":
        case "k":
          if (!terminal) togglePlay();
          break;
        case "j":
          if (!terminal) seekTo(positionMs - BIG_SEEK_MS);
          break;
        case "l":
          if (!terminal) seekTo(positionMs + BIG_SEEK_MS);
          break;
        case "arrowleft":
          if (!terminal) seekTo(positionMs - SMALL_SEEK_MS);
          break;
        case "arrowright":
          if (!terminal) seekTo(positionMs + SMALL_SEEK_MS);
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
          // T toggles the keyboard sheet's own disclosure (the native
          // details element — found from the DOM, no shadow state).
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
    positionMs,
    seekTo,
    stepVolume,
    terminal,
    toggleFullscreen,
    toggleMute,
    togglePlay,
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

  /** The scrub bar's position ratio (honest — from the truthful position). */
  const ratio = duration !== null && duration > 0 ? Math.min(1, Math.max(0, positionMs / duration)) : 0;
  const bufferedRatio =
    duration !== null && duration > 0 ? Math.min(1, Math.max(0, bufferedMs / duration)) : 0;

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
    <div className="wfx-chrome" data-wfx-chrome data-wfx-chrome-phase={phase}>
      {/* THE SCRUB BAR (direct manipulation + chapter marks + honest buffered) */}
      <div
        className="wfx-chrome__scrub"
        ref={scrubRef}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={duration !== null ? Math.round(duration / 1000) : 0}
        aria-valuenow={Math.round(positionMs / 1000)}
        aria-valuetext={`${formatReadout(positionMs)} of ${duration !== null ? formatReadout(duration) : "unknown length"}`}
        data-wfx-chrome-seek
        onPointerDown={(event) => {
          if (terminal) return;
          seekFromEvent(event.clientX);
        }}
        onKeyDown={(event) => {
          if (terminal) return;
          if (event.key === "ArrowLeft") seekTo(positionMs - SMALL_SEEK_MS);
          if (event.key === "ArrowRight") seekTo(positionMs + SMALL_SEEK_MS);
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
        <span className="wfx-chrome__readout" aria-hidden="true">
          <span data-wfx-chrome-position>{formatReadout(positionMs)}</span>
          {" / "}
          <span data-wfx-chrome-duration>{duration !== null ? formatReadout(duration) : "—"}</span>
        </span>
      </div>

      {/* THE TRANSPORT BAR (the familiar clusters) */}
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
            <Icon name={playing ? "pause" : "play"} size={20} />
          </button>
          {props.webflixOwnsStage ? (
            <div className="wfx-chrome__volume" data-wfx-chrome-volume>
              <button
                type="button"
                className="wfx-chrome__btn"
                onClick={toggleMute}
                aria-label={muted ? "Unmute (m)" : "Mute (m)"}
                data-wfx-chrome-mute
              >
                <Icon name={muted ? "mute" : "volume"} size={20} />
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
        </div>

        <div className="wfx-chrome__cluster">
          <span className="wfx-chrome__phase" data-wfx-chrome-phase-label>
            {phase}
          </span>
          {command !== null && command.detail !== null ? (
            <span className="wfx-chrome__status" role="status" data-wfx-chrome-command-status>
              {command.detail}
            </span>
          ) : null}
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
          {/* THE SETTINGS CLUSTER (a native disclosure — the honest
              per-rung truths render in the markup, closed by default,
              keyboard-operable for free). */}
          <details className="wfx-chrome__settings" data-wfx-chrome-settings>
            <summary className="wfx-chrome__btn" aria-label="Playback settings" data-wfx-chrome-settings-toggle>
              <Icon name="settings" size={20} />
            </summary>
            <div className="wfx-chrome__settingspanel" data-wfx-chrome-settings-panel>
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
                    : "This way of watching carries its own speed control — the choice applies wherever WebFlix owns the playback."}
                </span>
              </div>
              <div className="wfx-chrome__settingsrow" data-wfx-chrome-quality>
                <span>Quality</span>
                <span className="wfx-chrome__settingstruth">{props.qualityTruth}</span>
              </div>
              {/* R25-W2 — THE TRANSLATE ROW (the plan's "Translate → [target
                  language]" control, in the settings cluster's own grammar).
                  A LOCAL suspension — the settings panel streams the row
                  when the realtime route view resolves; the transport bar
                  never suspends. */}
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
              {!props.webflixOwnsStage ? (
                <div className="wfx-chrome__settingsrow" data-wfx-chrome-volume-truth>
                  <span>Volume</span>
                  <span className="wfx-chrome__settingstruth">
                    This way of watching carries its own volume control — the provider&apos;s player inside the
                    contained surface answers it.
                  </span>
                </div>
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
            <Icon name={fullscreenOn ? "fullscreenExit" : "fullscreen"} size={20} />
          </button>
          {props.webflixOwnsStage || pipAvailable ? (
            <button
              type="button"
              className="wfx-chrome__btn"
              onClick={toggleMiniplayer}
              aria-label="Miniplayer (picture-in-picture)"
              data-wfx-chrome-miniplayer
            >
              <Icon name="miniplayer" size={20} />
            </button>
          ) : null}
        </div>
      </div>

      {/* THE KEYBOARD GRAMMAR SHEET (the honest, visible map — a native
          disclosure: closed by default, keyboard-operable, the T key's
          own target). */}
      <details className="wfx-chrome__keys" data-wfx-chrome-keyboard-sheet>
        <summary className="wfx-chrome__keysbtn" data-wfx-chrome-keyboard>
          Keyboard shortcuts
        </summary>
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
            <dt>0–9</dt>
            <dd>Jump to 0%–90%</dd>
          </div>
          <div>
            <dt>M</dt>
            <dd>Mute{props.webflixOwnsStage ? "" : " (WebFlix-owned stages)"}</dd>
          </div>
          <div>
            <dt>F</dt>
            <dd>Fullscreen</dd>
          </div>
          <div>
            <dt>C</dt>
            <dd>Captions</dd>
          </div>
          <div>
            <dt>T</dt>
            <dd>This shortcut sheet</dd>
          </div>
        </dl>
      </details>

      {/* THE CAPTION OVERLAY (R25-W2's dispatcher: the LIVE bilingual
          overlay while a translation session runs; the transcript
          artifact overlay otherwise — the R24 law unchanged; the
          visibility is the C toggle's own state). */}
      <CaptionOverlayDispatcher
        features={props.transcriptFeatures}
        captionsOn={captionsOn}
        positionMs={positionMs}
        onToggle={() => {
          setCaptionsOn((current) => !current);
        }}
      />
    </div>
  );
}
