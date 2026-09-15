"use client";

/**
 * @wfx/app-web — the service-worker bridge + update affordance (WFX-057, client).
 *
 * Two jobs, one island:
 *
 * 1. REGISTRATION (the law lives in pwa-logic.ts `shouldRegisterServiceWorker`):
 *    `/sw.js` registers ONLY in production builds booted in service mode —
 *    `next dev` never registers (NODE_ENV guard), fixtures mode never
 *    registers (the `enabled` prop is AppShell's service-mode signal —
 *    WFX_DEV_FIXTURES content is dev-only and never a PWA surface).
 *    Registration failure is logged and swallowed: the PWA surface is an
 *    enhancement and must never break the page.
 *
 * 2. THE VISIBLE-UPDATE LAW: when a new worker is WAITING, a small
 *    non-blocking "Update available — Reload" affordance appears
 *    (role=status, aria-live=polite, 44px button). Only the user's click
 *    posts `WFX_SKIP_WAITING` to the worker, and only the resulting
 *    `controllerchange` reloads the page — never a silent reload.
 */

import { useEffect, useRef, useState, type JSX } from "react";

import { shouldRegisterServiceWorker } from "./pwa-logic";

export function UpdatePrompt({ enabled }: { readonly enabled: boolean }): JSX.Element | null {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const reloadOnControllerChange = useRef(false);

  useEffect(() => {
    if (
      !shouldRegisterServiceWorker({
        enabled,
        serviceWorkerSupported: "serviceWorker" in navigator,
        nodeEnv: process.env.NODE_ENV,
      })
    ) {
      return;
    }

    let cancelled = false;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        if (cancelled) return;
        // An update may already be waiting (installed before this load).
        if (registration.waiting && navigator.serviceWorker.controller) {
          setWaiting(registration.waiting);
        }
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (installing === null) return;
          installing.addEventListener("statechange", () => {
            // "installed" while a controller exists = an update is waiting
            // (on a FIRST install there is no controller yet — no prompt).
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              setWaiting(installing);
            }
          });
        });
      })
      .catch((error: unknown) => {
        // Enhancement unavailable — logged to the browser console (the one
        // place a client-side enhancement failure is observable), never a
        // page crash. The app itself never depends on the worker.
        // eslint-disable-next-line no-console
        console.warn("[webflix] service worker registration failed:", error);
      });

    const onControllerChange = (): void => {
      // Reload ONLY when the user approved the update (the visible law).
      if (reloadOnControllerChange.current) window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, [enabled]);

  const applyUpdate = (): void => {
    if (waiting === null) return;
    reloadOnControllerChange.current = true;
    waiting.postMessage({ type: "WFX_SKIP_WAITING" });
  };

  if (waiting === null) return null;
  return (
    <div className="wfx-pwa-region wfx-pwa-region--update" role="status" aria-live="polite" data-wfx-update>
      <div className="wfx-pwa-card wfx-pwa-card--update">
        <p className="wfx-pwa-card__title">Update available</p>
        <p className="wfx-pwa-card__detail">A new version of WebFlix is ready.</p>
        <div className="wfx-pwa-card__actions">
          <button className="wfx-btn wfx-btn--primary wfx-btn--sm" type="button" onClick={applyUpdate}>
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
