"use client";

/**
 * @wfx/app-web — the install affordance island (WFX-057, client).
 *
 * Renders the honest install surface in the AppShell (mounted only in
 * service mode — the production wiring; fixtures mode is dev-only content):
 *
 * - Chrome/Edge desktop + Android: the REAL `beforeinstallprompt` (stashed
 *   by the root layout's before-interactive capture script, or caught live
 *   after hydration) drives a subtle corner card with an "Install" button
 *   that calls the deferred `prompt()`. NO fake prompt is ever rendered.
 * - Safari iOS (never fires the event): the honest "Add to Home Screen"
 *   instruction sheet — small, dismissible, only when not already
 *   standalone.
 * - `appinstalled` → a brief confirmation, then the island hides.
 * - "Not now" is remembered in localStorage (never re-offered on this
 *   device); storage failures fail open (see pwa-logic.ts).
 * - Dismissing the NATIVE browser prompt hides the offer for this session
 *   only — an explicit "Not now" is what persists.
 *
 * A11y: the whole surface lives in one persistent `aria-live="polite"`
 * region (insertions are announced); every control is a real button on
 * the shell's `.wfx-btn` system (44px target, visible focus ring).
 *
 * SSR honesty: the initial render is EMPTY (standalone defaults true) —
 * nothing renders until the client has proven a real offer exists.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import {
  attachInstallListeners,
  detectIOSUserAgent,
  installSurfaceFor,
  isStandaloneDisplay,
  readInstallDismissed,
  writeInstallDismissed,
  type InstallPhase,
} from "./pwa-logic";

/** The browser's deferred install prompt (the standard PWA event shape). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/** The window carrying the root layout's captured `beforeinstallprompt`. */
type WindowWithCapture = Window & { __wfxBip?: BeforeInstallPromptEvent | null };

/** Everything the island tracks (all initially "no honest offer"). */
interface InstallUiState {
  readonly standalone: boolean;
  readonly isIOS: boolean;
  readonly promptAvailable: boolean;
  readonly dismissed: boolean;
  readonly installed: boolean;
}

const INITIAL_STATE: InstallUiState = {
  standalone: true,
  isIOS: false,
  promptAvailable: false,
  dismissed: false,
  installed: false,
};

/** How long the `appinstalled` confirmation stays visible before hiding. */
const INSTALLED_CONFIRM_MS = 8000;

export function InstallPrompt(): JSX.Element {
  const [state, setState] = useState<InstallUiState>(INITIAL_STATE);
  const promptEventRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Mount: read the real environment (display mode, UA hints, memory) —
    // never during SSR. The initial state renders nothing.
    const standalone = isStandaloneDisplay(
      { matches: (query: string): boolean => window.matchMedia(query).matches },
      (navigator as Navigator & { standalone?: boolean }).standalone,
    );
    const isIOS = detectIOSUserAgent(navigator.userAgent, navigator.maxTouchPoints ?? 0);
    const dismissed = readInstallDismissed(window.localStorage);
    setState((previous) => ({ ...previous, standalone, isIOS, dismissed }));

    // The capture script may already hold the event (it fires before
    // hydration on some loads) — claim it if so.
    const captured = (window as WindowWithCapture).__wfxBip ?? null;
    if (captured !== null) {
      promptEventRef.current = captured;
      setState((previous) => ({ ...previous, promptAvailable: true }));
    }

    // And keep listening for events that fire after hydration.
    const detach = attachInstallListeners(window, {
      onBeforeInstallPrompt: (event) => {
        const promptEvent = event as BeforeInstallPromptEvent;
        promptEventRef.current = promptEvent;
        setState((previous) => ({ ...previous, promptAvailable: true }));
      },
      onAppInstalled: () => {
        setState((previous) => ({ ...previous, installed: true }));
      },
    });
    return detach;
  }, []);

  // `appinstalled` → confirm + hide (the confirmation disappears after a
  // beat; the offer never returns — the app IS installed).
  useEffect(() => {
    if (!state.installed) return;
    const timer = window.setTimeout(() => {
      setState((previous) => ({ ...previous, installed: false, dismissed: true }));
    }, INSTALLED_CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [state.installed]);

  const phase: InstallPhase = installSurfaceFor(state);

  const onInstall = useCallback(() => {
    const promptEvent = promptEventRef.current;
    if (promptEvent === null) return;
    // The deferred prompt is single-use: consume it, then let the outcome
    // (and `appinstalled`) speak. The offer hides while the native dialog
    // is up — no double affordance.
    promptEventRef.current = null;
    setState((previous) => ({ ...previous, promptAvailable: false }));
    void promptEvent.prompt().then(
      (choice) => {
        if (choice.outcome === "dismissed") {
          // The user declined the NATIVE prompt — hide for this session
          // only (an explicit "Not now" on our card is what persists).
          setState((previous) => ({ ...previous, dismissed: true }));
        }
        // "accepted" → the `appinstalled` event confirms + swaps the note.
      },
      () => {
        // prompt() failed (already consumed / not allowed) — fall back to
        // silence; the omnibox install affordance remains the browser's.
        setState((previous) => ({ ...previous, promptAvailable: false }));
      },
    );
  }, []);

  const onDismiss = useCallback(() => {
    writeInstallDismissed(window.localStorage);
    setState((previous) => ({ ...previous, dismissed: true }));
  }, []);

  return (
    <div className="wfx-pwa-region" aria-live="polite" data-wfx-install>
      {phase === "offer" ? <InstallOfferCard onInstall={onInstall} onDismiss={onDismiss} /> : null}
      {phase === "instructions" ? <IosInstructionsCard onDismiss={onDismiss} /> : null}
      {phase === "installed" ? <InstalledCard /> : null}
    </div>
  );
}

/** The Chrome/Edge/Android offer: the real deferred prompt, one click away. */
export function InstallOfferCard({
  onInstall,
  onDismiss,
}: {
  readonly onInstall: () => void;
  readonly onDismiss: () => void;
}): JSX.Element {
  return (
    <div className="wfx-pwa-card" data-wfx-install-offer>
      <p className="wfx-pwa-card__title">Install WebFlix</p>
      <p className="wfx-pwa-card__detail">
        Add WebFlix to this device — it opens in its own window, right from your home screen or
        desktop, like an app.
      </p>
      <div className="wfx-pwa-card__actions">
        <button className="wfx-btn wfx-btn--primary wfx-btn--sm" type="button" onClick={onInstall}>
          Install
        </button>
        <button className="wfx-btn wfx-btn--ghost wfx-btn--sm" type="button" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}

/** The honest iOS instruction sheet (Safari's Add to Home Screen). */
export function IosInstructionsCard({
  onDismiss,
}: {
  readonly onDismiss: () => void;
}): JSX.Element {
  return (
    <div className="wfx-pwa-card" data-wfx-install-ios>
      <p className="wfx-pwa-card__title">Install WebFlix on this device</p>
      <ol className="wfx-pwa-card__steps">
        <li>
          Tap the <strong>Share</strong> button in Safari&apos;s toolbar.
        </li>
        <li>
          Choose <strong>Add to Home Screen</strong>.
        </li>
      </ol>
      <p className="wfx-pwa-card__detail">WebFlix then works like an app, in its own window.</p>
      <div className="wfx-pwa-card__actions">
        <button className="wfx-btn wfx-btn--ghost wfx-btn--sm" type="button" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}

/** The `appinstalled` confirmation (shown briefly, then the island hides). */
export function InstalledCard(): JSX.Element {
  return (
    <div className="wfx-pwa-card wfx-pwa-card--ok" data-wfx-install-installed>
      <p className="wfx-pwa-card__title">WebFlix installed</p>
      <p className="wfx-pwa-card__detail">
        Find it on your home screen or desktop — it opens in its own window.
      </p>
    </div>
  );
}
