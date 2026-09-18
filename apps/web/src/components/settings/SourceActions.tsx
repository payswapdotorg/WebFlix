"use client";

/**
 * @wfx/app-web — the source-card action controls (R17, client).
 *
 * The TYPED recovery actions of one source's authorization state (the
 * runtime-derived `sourceRecoveryAction` truth), posted to `/api/sources`.
 * NO optimistic state changes: the honest answer is the server's (the
 * runtime's next observed source state); a failure answers the typed
 * message verbatim (never a fake success). The clearly-labeled dev `expire`
 * control renders ONLY in fixtures mode (the J28 browser-validation drive —
 * the same law the acquisition dev advance follows).
 */

import { useCallback, useState, type JSX } from "react";

export function SourceActions({
  connectorId,
  action,
  mode,
}: {
  /** The source the actions target. */
  readonly connectorId: string;
  /** The typed recovery action the runtime derived for the current state. */
  readonly action: { readonly kind: string; readonly label: string };
  /** The host boot mode (the dev expire control renders in fixtures mode only). */
  readonly mode: "fixtures" | "service";
}): JSX.Element | null {
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const post = useCallback(
    async (actionKind: string) => {
      setPending(actionKind);
      setFailure(null);
      try {
        const response = await fetch("/api/sources", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ connectorId, action: actionKind }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setFailure(body?.error ?? "the action could not be completed");
        } else {
          // Re-render from the server's honest next state (no optimism).
          if (typeof window !== "undefined") window.location.reload();
        }
      } catch (thrown) {
        setFailure(thrown instanceof Error ? thrown.message : "the action could not be completed");
      } finally {
        setPending(null);
      }
    },
    [connectorId],
  );

  if (action.kind === "none") return null;

  return (
    <div className="wfx-acquisition__actions" data-wfx-source-actions>
      {action.kind === "reauthorize" || action.kind === "connect" || action.kind === "disconnect" ? (
        <button
          type="button"
          className="wfx-btn"
          data-wfx-source-action={action.kind}
          disabled={pending !== null}
          onClick={() => {
            void post(action.kind);
          }}
        >
          {action.label}
        </button>
      ) : null}
      {mode === "fixtures" ? (
        <button
          type="button"
          className="wfx-btn wfx-btn--dev"
          data-wfx-source-action="expire"
          title="Dev fixtures: expire the stored sign-in (the J28 credential-expiry drive)"
          disabled={pending !== null}
          onClick={() => {
            void post("expire");
          }}
        >
          Expire the stored sign-in (dev)
        </button>
      ) : null}
      {failure !== null ? (
        <p className="wfx-detail__meta" data-wfx-source-action-error role="alert">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
