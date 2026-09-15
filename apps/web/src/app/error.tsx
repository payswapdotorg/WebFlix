/**
 * @wfx/app-web — the route error boundary (WFX-050).
 *
 * The loud-failure surface: when the home route throws (most importantly
 * the typed `HostConfigError` from a misconfigured environment), this
 * boundary renders a visible failure page. The request answers HTTP 500;
 * the typed detail — which environment variables are missing or invalid —
 * is in the SERVER LOG (`vercel logs`, WFX-056) and, when the runtime
 * exposes it, in `error.message` below.
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
    <main
      style={{
        maxWidth: "48rem",
        margin: "0 auto",
        padding: "4rem 1.25rem",
        fontFamily:
          "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        color: "#e7e5e4",
      }}
    >
      <h1 style={{ fontSize: "1.5rem", color: "#f87171" }}>WebFlix web host failed to boot</h1>
      <p style={{ color: "#a8a29e" }}>
        The home surface could not be served. This is a loud, typed failure — never a silent
        fallback to fixture content.
      </p>
      {error.message ? (
        <pre
          data-wfx-host-error
          style={{
            padding: "1rem",
            borderRadius: "0.5rem",
            background: "#1c1917",
            border: "1px solid #57534e",
            whiteSpace: "pre-wrap",
            fontSize: "0.85rem",
          }}
        >
          {error.message}
        </pre>
      ) : null}
      {error.digest ? (
        <p style={{ fontSize: "0.75rem", color: "#78716c" }}>digest: {error.digest}</p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        style={{
          marginTop: "1.5rem",
          padding: "0.5rem 1rem",
          borderRadius: "0.4rem",
          border: "1px solid #78716c",
          background: "#292524",
          color: "#e7e5e4",
          cursor: "pointer",
        }}
      >
        Retry
      </button>
    </main>
  );
}
