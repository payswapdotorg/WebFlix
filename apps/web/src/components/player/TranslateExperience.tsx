"use client";

/**
 * @wfx/app-web — the R25 TRANSLATE EXPERIENCE island (R25-G: the
 * player's live bilingual translation surface).
 *
 * THE PLAYER-LOCAL GRAMMAR (§R25-G): the Translate CONTROL lives in the
 * player chrome's settings cluster (the R24 disclosure grammar — see
 * PlayerChrome's translate row); THIS island is the live surface it
 * drives: the aligned bilingual transcript, the translated-speech
 * cluster (original audio / translated speech + the ducking truth),
 * the session's honest truths (the provider identity, the reported
 * envelope, the shared cost policy, the usage), the anonymous truth
 * (§R25-J — the optional sign-in, never a gate), and the GRACEFUL
 * FALLBACK surface (§R25-L: a terminal failure names what remains —
 * original captions and playback, untouched).
 *
 * THE ALIGNMENT LAW: the bilingual view PRESERVES source/translation
 * alignment — each row carries the source segment and its translation
 * (the speaker labels are the live diarization's simple, contextual
 * Speaker 1 / Speaker 2 — §R25-G); the original transcript artifact's
 * own surface below keeps its named labels, never replaced.
 *
 * THE HONEST DOUBLE BADGE: in the fixtures boot the source stream is
 * the deterministic scripted double (loudly labeled — the same law as
 * the live-captions surface); a registered Model-Fabric provider
 * serves the live lane in service mode.
 */

import { useEffect, useSyncExternalStore, type JSX } from "react";

import type { RealtimeRouteView } from "@/host/realtime/realtime-route";
import { realtimeRestrictedAlternativesSentence } from "@/host/realtime/realtime-route";
import {
  createRealtimeSessionController,
  getActiveRealtimeSessionController,
  getActiveRealtimePhase,
  idleRealtimePhaseSnapshot,
  setActiveRealtimeSessionController,
  subscribeActiveRealtimePhase,
} from "@/components/player/realtime-session-client";

/** The identity the surface binds the session to. */
export interface TranslateExperienceIdentity {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly playbackSessionId: string;
  readonly webflixOwnsStage: boolean;
}

/**
 * The Translate experience island. Server-renderable (the initial
 * truth renders pre-hydration: the gates, the provider truth, the
 * anonymous sentence); the live session mounts after hydration.
 */
export function TranslateExperience({
  route,
  identity,
}: {
  /** The composed realtime route view (the stage-level restriction applied). */
  readonly route: RealtimeRouteView;
  readonly identity: TranslateExperienceIdentity;
}): JSX.Element {
  // The controller is created INSIDE the effect (the React StrictMode
  // double-effect's first controller is disposed by its own cleanup; the
  // second becomes the surface's active one — the proxy store notifies
  // the re-render when the binding lands). Every action resolves the
  // ACTIVE controller at call time — never a stale render-time capture.
  useEffect(() => {
    const controller = createRealtimeSessionController();
    controller.bind({
      itemId: identity.itemId,
      connectorId: identity.connectorId,
      externalRef: identity.externalRef,
      playbackSessionId: identity.playbackSessionId,
      webflixOwnsStage: identity.webflixOwnsStage,
      bridgeUrl: route.readiness.kind === "ready" ? route.readiness.bridgeUrl : "",
      targetLanguages: route.targetLanguages,
    });
    setActiveRealtimeSessionController(controller);
    return () => {
      if (getActiveRealtimeSessionController() === controller) {
        setActiveRealtimeSessionController(null);
      }
      controller.dispose();
    };
  }, [identity.itemId, identity.connectorId, identity.externalRef, identity.playbackSessionId, identity.webflixOwnsStage, route.readiness.kind, route.targetLanguages]);

  const phase = useSyncExternalStore(subscribeActiveRealtimePhase, getActiveRealtimePhase, idleRealtimePhaseSnapshot);
  const controllerAction = (): ReturnType<typeof getActiveRealtimeSessionController> =>
    getActiveRealtimeSessionController();

  const state = phase.phase;
  const languageLabel = (code: string): string =>
    route.targetLanguages.find((language) => language.code === code)?.label ?? code;

  return (
    <section
      className="wfx-translate"
      data-wfx-translate-experience
      data-wfx-realtime-state={state}
      aria-label="Realtime translation"
    >
      <h2 className="wfx-translate__title">Translate</h2>

      {/* THE HONEST GATES (the route view's truths, rendered server-side too). */}
      {route.readiness.kind !== "ready" ? (
        <div data-wfx-translate-gate={route.readiness.kind}>
          <p className="wfx-translate__reason">{route.readiness.detail}</p>
          {route.readiness.kind === "restricted-realization" ? (
            <p className="wfx-translate__reason" data-wfx-translate-alternatives>
              {realtimeRestrictedAlternativesSentence(route.readiness)}
            </p>
          ) : null}
        </div>
      ) : route.route !== null && route.route.kind === "no-realtime-provider-registered" ? (
        <div data-wfx-translate-gate="no-realtime-provider-registered">
          <p className="wfx-translate__reason">{route.route.detail}</p>
          <p className="wfx-translate__reason" data-wfx-translate-provider-recovery>{route.route.recovery}</p>
          <a className="wfx-btn wfx-btn--sm" href="/settings?section=model" data-wfx-translate-manage>
            Model &amp; AI settings
          </a>
        </div>
      ) : null}

      {/* THE LIVE SURFACE (the aligned bilingual view — never a replacement of the transcript artifact). */}
      {state === "live" ? (
        <div className="wfx-translate__live" data-wfx-translate-live>
          <p className="wfx-translate__meta" data-wfx-translate-status>
            Translating to {languageLabel(phase.targetLanguage)}
            {phase.recovering ? " — reconnecting the session…" : ""}
            {phase.lastRecoverable !== null && !phase.recovering
              ? ` — ${phase.lastRecoverable.detail}`
              : ""}
          </p>
          {/* The fixtures double badge (the loud dev truth — the live-captions law). */}
          {phase.sourceStream === "scripted-dev-double" ? (
            <p className="wfx-translate__reason" data-wfx-translate-double-note>
              Dev fixtures drive this stream deterministically (the scripted source double — the loud dev
              badge covers it); a registered Model-Fabric realtime provider serves the live lane in service
              mode.
            </p>
          ) : null}
          {/* The audio cluster (§R25-G: translated speech / original audio + the ducking truth). */}
          <div className="wfx-translate__audio" data-wfx-translate-audio-cluster>
            <span className="wfx-translate__audiolabel">Speech</span>
            <div className="wfx-chrome__speedsteps" role="group" aria-label="Translated speech">
              <button
                type="button"
                className={`wfx-chrome__stepbtn${!phase.audio.enabled ? " wfx-chrome__stepbtn--active" : ""}`}
                onClick={() => controllerAction()?.setTranslatedSpeech(false)}
                aria-pressed={!phase.audio.enabled}
                data-wfx-translate-audio="original"
              >
                Original audio
              </button>
              <button
                type="button"
                className={`wfx-chrome__stepbtn${phase.audio.enabled ? " wfx-chrome__stepbtn--active" : ""}`}
                onClick={() => controllerAction()?.setTranslatedSpeech(true)}
                aria-pressed={phase.audio.enabled}
                data-wfx-translate-audio="translated"
              >
                Translated speech
              </button>
            </div>
            <span className="wfx-chrome__settingstruth" data-wfx-translate-audio-truth>
              {phase.audio.enabled
                ? identity.webflixOwnsStage
                  ? "Translated speech plays; the original audio ducks while it speaks (WebFlix owns this stage's audio)."
                  : "Translated speech plays alongside the provider's own audio (this way of watching keeps its own volume control)."
                : "The original audio plays; translated speech is off (text-only is the cost-cheap default)."}
            </span>
            {phase.audio.enabled ? (
              <span className="wfx-translate__meta" data-wfx-translate-audio-chunks>
                {phase.audio.chunks} chunk{phase.audio.chunks === 1 ? "" : "s"} received
                {phase.audio.playing ? " — playing" : ""}
              </span>
            ) : null}
          </div>
          {/* The aligned bilingual transcript (the source/translation alignment law). */}
          <div className="wfx-translate__segments" data-wfx-bilingual-transcript>
            {phase.segments.map((segment) => (
              <div
                key={segment.segmentId}
                className="wfx-translate__segment"
                data-wfx-bilingual-segment={segment.segmentId}
                data-wfx-bilingual-final={segment.translationFinal ? "true" : "false"}
              >
                {segment.speakerLabel !== null ? (
                  <span
                    className="wfx-translate__speaker"
                    data-wfx-bilingual-speaker={segment.speakerLabel}
                    data-wfx-bilingual-speaker-changed={segment.speakerChanged ? "true" : "false"}
                  >
                    {segment.speakerLabel}:
                  </span>
                ) : null}
                <p className="wfx-translate__source" data-wfx-bilingual-source>
                  {segment.sourceText}
                  {segment.sourceFinal ? "" : " …"}
                </p>
                {segment.translationText.length > 0 ? (
                  <p className="wfx-translate__translation" data-wfx-bilingual-translation>
                    {segment.translationText}
                    {segment.translationFinal ? "" : " …"}
                  </p>
                ) : (
                  <p className="wfx-translate__pending" data-wfx-bilingual-translation-pending>
                    translating…
                  </p>
                )}
              </div>
            ))}
          </div>
          {/* The session's honest truths (the provider + the shared policy + the usage). */}
          <details className="wfx-translate__truths" data-wfx-translate-truths>
            <summary data-wfx-translate-truths-toggle>Session truths</summary>
            <p className="wfx-translate__meta" data-wfx-translate-provider>
              Provider: {phase.provider !== null ? `${phase.provider.id} (${phase.provider.detail})` : "the registered realtime provider"}
              {phase.reportedAverageLagMs !== null
                ? ` — reported average lag ≈ ${phase.reportedAverageLagMs} ms (rendered, never promised)`
                : ""}
            </p>
            {phase.policy !== null ? (
              <p className="wfx-translate__meta" data-wfx-translate-policy>
                {phase.policy.modalityReason}. Session limit {Math.round(phase.policy.maxSessionDurationMs / 1000)}s
                ({phase.policy.durationBasis}).
              </p>
            ) : null}
            <p className="wfx-translate__meta" data-wfx-translate-usage>
              Usage so far: {phase.usage.inputAudioTokens} input-audio / {phase.usage.textOutputTokens} text-output /
              {" "}{phase.usage.outputAudioTokens} output-audio tokens.
            </p>
          </details>
        </div>
      ) : null}

      {/* THE GRACEFUL FALLBACK SURFACE (§R25-L: translation failure never stops base playback). */}
      {state === "failed" ? (
        <div className="wfx-translate__failed" data-wfx-translate-failed data-wfx-translate-error-kind={phase.errorKind}>
          <p className="wfx-translate__reason" data-wfx-translate-failure-detail>
            Translation stopped ({phase.errorKind}): {phase.detail}
          </p>
          <p className="wfx-translate__reason" data-wfx-translate-fallback>
            {phase.recovery} Playback and the original captions are unaffected — the transcript below keeps its
            own truth.
          </p>
          <div className="wfx-translate__actions">
            <button
              type="button"
              className="wfx-btn wfx-btn--sm"
              onClick={() => controllerAction()?.reset()}
              data-wfx-translate-retry-dismiss
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {state === "stopped" ? (
        <p className="wfx-translate__meta" data-wfx-translate-stopped>
          Translation ended ({phase.reason}) — original captions remain available.
        </p>
      ) : null}

      {/* THE ANONYMOUS TRUTH (§R25-J — the optional sign-in, never a gate). */}
      {route.anonymous.accountless ? (
        <p className="wfx-translate__reason" data-wfx-translate-anonymous>
          {route.anonymous.signInSentence}{" "}
          <a href={route.anonymous.signInHref} data-wfx-translate-signin>
            Sign in (optional)
          </a>
        </p>
      ) : null}
    </section>
  );
}
