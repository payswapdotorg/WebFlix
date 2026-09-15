/**
 * @wfx/app-web — the route error boundary (WFX-050; WFX-051 restyle).
 *
 * The loud-failure surface: when a route throws (most importantly the typed
 * `HostConfigError` from a misconfigured environment), this boundary renders
 * a visible failure page. The request answers HTTP 500; the typed detail —
 * which environment variables are missing or invalid — is in the SERVER LOG
 * (`vercel logs`, WFX-056) and, when the runtime exposes it, in
 * `error.message` below.
 */

"use client";

import type { JSX } from "react";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  return (
    <main className="wfx-main">
      <div className="wfx-state wfx-state--error" data-wfx-error role="alert">
        <span className="wfx-state__title">WebFlix web host failed to boot</span>
        <p className="wfx-state__detail">
          This surface could not be served. A loud, typed failure — never a silent fallback to
          fixture content. The typed detail is in the server log.
        </p>
        {error.message ? (
          <pre data-wfx-host-error className="wfx-state__detail">
            {error.message}
          </pre>
        ) : null}
        {error.digest ? (
          <p className="wfx-state__detail">digest: {error.digest}</p>
        ) : null}
        <button className="wfx-btn wfx-btn--primary" type="button" onClick={reset}>
          Retry
        </button>
      </div>
    </main>
  );
}
