"use client";

/**
 * @wfx/app-web — the SHORTS MEDIA STAGE (R33-A: the operator's #1, "the
 * shorts are still bad"): the REAL provider embed, full-bleed, inside the
 * shorts card stack.
 *
 * THE CORPUS FORM this stage joins (G4-CORPUS.md "THE PLAYER":
 * "Vertical 716×716, autoplaying (readyState 4, paused false, blob src)"
 * within the 1440×900 capture — the player IS the surface): the stage
 * fills the shorts viewport at WebFlix's own 420px-scale card (the
 * established WFX-051 form — the adaptation recorded in the lane's
 * divergence ledger), the R32 rail hugging its right edge, the channel
 * row bottom-left over the stage (the existing card chrome — the seam
 * law keeps them byte-identical; the stage joins as the card's FIRST
 * child so the DOM order stacks it under the monogram/overlay/rail with
 * ZERO changes to their rules).
 *
 * THE FROZEN LAWS, honored here (each cited at its use):
 *
 * - THE REAL-MEDIA LAW: the stage binds to the item's REAL playback
 *   realization ONLY — the same resolve seam the hover preview uses
 *   (`GET /api/preview`, per-item cached). An item with no available
 *   realization keeps the honest current card form (the placeholder-art +
 *   title truth — this stage renders no visible element, a typed-absence
 *   data attribute carrying it; NEVER a fake player, NEVER a spinner).
 *   Autoplay is MUTED (the shared presentation law's `autoplay=1&mute=1`)
 *   with the unmute affordance (the watch surface's EmbedStage pattern:
 *   "Sound off — tap to unmute", evidence-gated on the provider's own
 *   muted report).
 *
 * - THE EVIDENCE LAW (R26-W2): only provider-reported state advances the
 *   visible truth. The phase/mute/position truths render from the
 *   provider's own broadcasts (the documented widget channel —
 *   shorts-stage-client.ts's binding); a provider that never answers
 *   settles the honest unbound state (`data-wfx-shortstage-live="false"`),
 *   disclosed, never simulated. NO progress ticking: the stage never
 *   fabricates a percentage.
 *
 * - THE CHROME LAW: the corpus's top chrome (pause k / mute m / CC /
 *   more / fullscreen f — g4-rail-extras.json) maps to the PROVIDER'S OWN
 *   embed controls (the frame stays clickable — no WebFlix click layer
 *   over it) + WebFlix's existing chrome bindings: the watch surface's k/m
 *   keyboard grammar (PlayerChrome.tsx — "k" toggles play/pause, "m"
 *   toggles mute, the typing guard included) driving the provider's
 *   documented channel, with the runtime command recorded through
 *   /api/playback exactly as the watch surface's chrome records its own.
 *   CC / more / fullscreen carry no WebFlix-side analog on this surface —
 *   the provider's own in-frame controls answer (typed divergence rows).
 *
 * - THE TAP LAW: the corpus's tap behavior ("tap the playing video ⇒
 *   pause") is the PROVIDER'S OWN in-frame tap — the click reaches the
 *   provider's player (its own channel), and the resulting state
 *   broadcast advances this stage's visible truth through the documented
 *   channel. The stage never blocks the provider's own controls with an
 *   overlay (a click layer would make the chrome law's mapping a lie).
 *
 * - THE PREFETCH LAW: only the ACTIVE card (the current one) mounts an
 *   embed — ONE live stage (the hover preview's singleton discipline).
 *   The next card's stage runs in its `prefetch` form: the resolve read
 *   warms the per-item cache (the existing prefetch window's carrier) and
 *   NOTHING mounts. Never the whole stack.
 *
 * - THE SESSION LAW: the surface's PLAYS record through the SAME session
 *   seam the watch surface uses — at the first provider-reported PLAYING
 *   evidence the stage mints the playback session (`POST
 *   /api/shorts-session` — host/shorts.ts's resolveShortsPlaybackSession:
 *   resolvePlayback + prepare + the playback bridge's record), issues the
 *   runtime play command (`POST /api/playback` — the client-carried intent
 *   path), and folds the provider's own progress (throttled) / complete /
 *   final-position reports through `POST /api/events` (the closed
 *   vocabulary). Resume truth and watch state stay coherent across
 *   surfaces; the feed's own engagement seams (skip/like/save) are
 *   untouched — the stage never fabricates engagement.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import {
  applyShortsStageEvidence,
  bindShortsStageSession,
  mintShortsStageSession,
  recordShortsStageCommand,
  reportShortsStageWatchState,
  resolveShortsStageMedia,
  settleShortsStageResolve,
  settleShortsStageUnbound,
  shouldReportShortsStageProgress,
  shortsStageKeyCommandOf,
  SHORTS_STAGE_IDLE,
  type ShortsStageState,
} from "@/components/shorts/shorts-stage-client";
// THE SHARED PRESENTATION LAW (embed-presentation.ts, verbatim): the
// nocookie host + enablejsapi + the muted-autoplay pair + the containment
// sandbox postures — the same law the player's EmbedStage and the hover
// preview mount under.
import {
  CONTROL_BOUND_SANDBOX,
  OPAQUE_ORIGIN_SANDBOX,
  presentationSrcOf,
  providerFamilyOf,
} from "@/components/player/embed-presentation";

/** The stage's serialized input (the card's own realization identity). */
export interface ShortsMediaStageProps {
  /** The canonical item id (the watch-state reports' binding). */
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  /** The card's overlay title (the iframe's accessible name). */
  readonly title: string;
  /**
   * THE PREFETCH LAW: `true` (the default) mounts the real embed — only
   * the CURRENT card passes true; the next card's resolve-only form passes
   * false (the cache warms, nothing mounts).
   */
  readonly active?: boolean;
}

/**
 * The shorts media stage — the card's real playback surface. Renders NO
 * visible element until the provider's embed is REAL (the resolve
 * answered); the card's placeholder-art + title form stays the honest
 * fallback (the typed-absence states carry data attributes only).
 */
export function ShortsMediaStage({
  itemId,
  connectorId,
  externalRef,
  title,
  active = true,
}: ShortsMediaStageProps): JSX.Element {
  const [state, setState] = useState<ShortsStageState>(SHORTS_STAGE_IDLE);
  // The latest state mirror (the evidence folds + the session decisions
  // read the folded truth without racing React's batching).
  const stateRef = useRef<ShortsStageState>(SHORTS_STAGE_IDLE);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const controllerRef = useRef<ReturnType<typeof bindShortsStageSession> | null>(null);

  // THE SESSION FOLD'S GUARDS (the watch surface's own laws):
  const sessionIdRef = useRef<string | null>(null);
  const sessionMintFailedRef = useRef(false);
  const lastReportAtRef = useRef(0);
  const lastReportedPositionMsRef = useRef(-1);
  const completeSentRef = useRef(false);

  const commit = useCallback((next: ShortsStageState): void => {
    stateRef.current = next;
    setState(next);
  }, []);

  // THE RESOLVE SEAM (the hover-preview law): one cached read per item at
  // view time; the honest ladder settles staged / unavailable.
  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      const answer = await resolveShortsStageMedia({ connectorId, externalRef });
      if (cancelled) return;
      commit(settleShortsStageResolve(stateRef.current, answer));
    })();
    return () => {
      cancelled = true;
    };
  }, [commit, connectorId, externalRef]);

  // THE PROVIDER CONTROL CONTRACT (the documented widget channel — the
  // evidence law): bind for the staged + active stage's life; the
  // provider's own broadcasts are the ONLY state mover.
  useEffect(() => {
    if (!active || state.status !== "staged" || state.url === null) return;
    const frame = frameRef.current;
    if (frame === null) return;
    const provider = providerFamilyOf(state.url);
    const bound = bindShortsStageSession({
      iframe: frame,
      provider,
      onEvidence: (info) => {
        commit(applyShortsStageEvidence(stateRef.current, info));
      },
      onUnbound: () => {
        commit(settleShortsStageUnbound(stateRef.current));
      },
    });
    controllerRef.current = bound;
    return () => {
      controllerRef.current = null;
      bound.unbind();
    };
  }, [active, commit, state.status, state.url]);

  // THE SESSION + WATCH-STATE FOLDS (the watch surface's own seam): the
  // first provider-reported PLAYING evidence mints the session and issues
  // the runtime play command; the provider's progress (throttled) +
  // complete + the final position fold through /api/events (the closed
  // vocabulary). Pure side-effect folds over the evidence — never a
  // ticker, never a fabricated position.
  useEffect(() => {
    if (!active) return;
    if (state.live && state.phase === "playing" && sessionIdRef.current === null && !sessionMintFailedRef.current) {
      sessionMintFailedRef.current = true; // one attempt per stage life (an honest failure never retries into a loop)
      void (async (): Promise<void> => {
        const sessionId = await mintShortsStageSession({ itemId, connectorId, externalRef });
        if (sessionId === null) return; // honest: the plays record nothing without the session
        sessionIdRef.current = sessionId;
        sessionMintFailedRef.current = false;
        // The runtime play command (the watch surface's issue() order: the
        // provider already plays — the provider's own autoplay — and the
        // runtime session now records the play through the same transport).
        await recordShortsStageCommand({
          sessionId,
          command: "play",
          intent: { itemId, externalRef, connectorId },
        });
      })();
    }
    if (sessionIdRef.current !== null) {
      const sessionId = sessionIdRef.current;
      if (state.phase === "ended" && !completeSentRef.current) {
        // The provider's own ended signal → the complete report (once).
        completeSentRef.current = true;
        void reportShortsStageWatchState({
          itemId,
          sessionId,
          type: "complete",
          positionMs: state.durationMs ?? state.positionMs,
        });
      } else if (
        shouldReportShortsStageProgress(
          lastReportAtRef.current,
          lastReportedPositionMsRef.current,
          state,
          Date.now(),
        )
      ) {
        lastReportAtRef.current = Date.now();
        lastReportedPositionMsRef.current = state.positionMs;
        void reportShortsStageWatchState({
          itemId,
          sessionId,
          type: "progress",
          positionMs: state.positionMs,
        });
      }
    }
  }, [active, connectorId, externalRef, itemId, state]);

  // THE FINAL FOLD AT UNMOUNT (the resume truth — the embed-session-
  // client's unbind law): the last provider-reported position records once
  // when the card leaves the view (the swipe's own skip event is the
  // feed's separate, untouched seam).
  useEffect(() => {
    return () => {
      const sessionId = sessionIdRef.current;
      const snapshot = stateRef.current;
      if (sessionId !== null && snapshot.positionMs > 0 && snapshot.phase !== "ended") {
        void reportShortsStageWatchState({
          itemId,
          sessionId,
          type: "progress",
          positionMs: snapshot.positionMs,
        });
      }
    };
  }, [itemId]);

  // THE WATCH SURFACE'S k/m GRAMMAR (the chrome law's WebFlix bindings):
  // "k" toggles play/pause and "m" toggles mute through the provider's
  // documented channel (the typing guard included — PlayerChrome.tsx's
  // law); a WebFlix-issued command records with the runtime through the
  // same /api/playback transport the watch chrome uses.
  useEffect(() => {
    if (!active || !state.live) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const command = shortsStageKeyCommandOf(event);
      if (command === null) return;
      event.preventDefault();
      const controller = controllerRef.current?.controller;
      const snapshot = stateRef.current;
      if (command === "toggle-play" && controller !== undefined) {
        const nextCommand = snapshot.phase === "playing" ? "pause" : "play";
        if (nextCommand === "pause") controller.pause();
        else controller.play();
        const sessionId = sessionIdRef.current;
        if (sessionId !== null) {
          void recordShortsStageCommand({
            sessionId,
            command: nextCommand,
            intent: { itemId, externalRef, connectorId },
          });
        }
      } else if (command === "toggle-mute" && controller !== undefined && snapshot.muted !== null) {
        controller.setMuted(!snapshot.muted);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [active, connectorId, externalRef, itemId, state.live]);

  // THE PREFETCH FORM (the prefetch law): the resolve read warmed the
  // cache; nothing mounts, nothing binds — the marker is inert.
  if (!active) {
    return (
      <div
        aria-hidden="true"
        data-wfx-shortstage
        data-wfx-shortstage-state={state.status}
        data-wfx-shortstage-item={itemId}
        data-wfx-shortstage-prefetch="true"
      />
    );
  }

  // THE HONEST FALLBACK (the real-media law): no available realization ⇒
  // the card's current form stands (the placeholder-art + title truth —
  // the stage renders no visible element; the typed absence carries the
  // honest reason as data).
  if (state.status !== "staged" || state.url === null) {
    return (
      <div
        aria-hidden="true"
        data-wfx-shortstage
        data-wfx-shortstage-state={state.status}
        data-wfx-shortstage-item={itemId}
        {...(state.reason !== null ? { "data-wfx-shortstage-reason": state.reason } : {})}
      />
    );
  }

  const provider = providerFamilyOf(state.url);
  const src = presentationSrcOf(state.url);

  return (
    <div
      className="wfx-shortstage"
      data-wfx-shortstage
      data-wfx-shortstage-state="staged"
      data-wfx-shortstage-item={itemId}
      data-wfx-shortstage-provider={provider}
      data-wfx-shortstage-live={state.live ? "true" : "false"}
      data-wfx-shortstage-phase={state.phase}
      data-wfx-shortstage-muted={state.muted === null ? "unknown" : state.muted ? "true" : "false"}
      role="region"
      aria-label={`Short playback: ${title}`}
    >
      {/* The real provider embed (the shared presentation law VERBATIM):
          the provider's own privacy-enhanced host + enablejsapi + the
          muted-autoplay pair, in the containment-law sandbox posture. The
          frame stays clickable — the provider's own controls are this
          surface's chrome (the chrome law), and the corpus's tap behavior
          is the provider's own in-frame tap. */}
      <iframe
        ref={frameRef}
        className="wfx-shortstage__frame"
        src={src}
        title={`Embedded short: ${title}`}
        sandbox={provider === "youtube" ? CONTROL_BOUND_SANDBOX : OPAQUE_ORIGIN_SANDBOX}
        referrerPolicy="strict-origin-when-cross-origin"
        allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
        data-wfx-shortstage-frame
      />
      <p className="wfx-sr-only" data-wfx-shortstage-note>
        {provider === "youtube"
          ? "The source's own embedded player, muted and contained — the sound turns on through the unmute control, and the provider's own controls stay live inside the frame."
          : "The source's own embedded player, contained — the provider's own controls stay live inside the frame."}
      </p>
      {/* THE UNMUTE AFFORDANCE (the watch surface's EmbedStage pattern,
          verbatim words): rendered only while the provider REPORTS
          muted=true (evidence-gated, never assumed) — the muted-autoplay
          law's honest sound path through the provider's own channel. */}
      {state.live && state.muted === true ? (
        <button
          type="button"
          className="wfx-shortstage__unmute"
          onClick={() => {
            controllerRef.current?.controller.setMuted(false);
          }}
          data-wfx-shortstage-unmute
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
            <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4Z" />
            <path d="m16 9.5 5 5m0-5-5 5" />
          </svg>
          Sound off — tap to unmute
        </button>
      ) : null}
    </div>
  );
}
