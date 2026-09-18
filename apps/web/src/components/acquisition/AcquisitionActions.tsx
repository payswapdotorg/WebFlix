"use client";

/**
 * @wfx/app-web — the acquisition typed-action controls (R14, client).
 *
 * The TYPED actions of the current acquisition view, posted to
 * `/api/acquisition`. NO optimistic lifecycle changes: the honest answer
 * is the server's (the store's next view after the action); a failure
 * answers the typed message verbatim (never a fake success). The web
 * transport serves the fixtures-mode drive in dev and the honest
 * "runs in the desktop app" answer in service mode — the same capability
 * truth the panel renders.
 *
 * The `advance` control renders ONLY in fixtures mode (the loud dev badge
 * world): it steps the scripted download one lifecycle step — the
 * browser-validation drive for J21-J26.
 */

import { useCallback, useState, type JSX } from "react";

import type { AcquisitionAction, AcquisitionStatusView } from "@wfx/client-runtime";

/** The action button labels (user vocabulary — no protocol terms). */
const ACTION_LABELS: Readonly<Record<AcquisitionAction["kind"], string>> = {
  acquire: "Make available offline",
  pause: "Pause download",
  resume: "Resume download — keep saved progress",
  retry: "Try again",
  restart: "Start over — discard saved progress",
  dismiss: "Dismiss",
  "play-offline": "Play offline copy",
  "reverify-offline": "Re-check the offline copy",
};

export function AcquisitionActions({
  view,
  mode,
  sourceRef,
}: {
  readonly view: AcquisitionStatusView;
  readonly mode: "fixtures" | "service";
  /** The item's stable source ref (the dev drive's cross-module key). */
  readonly sourceRef?: string | undefined;
}): JSX.Element | null {
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const post = useCallback(
    async (action: string) => {
      setPending(action);
      setFailure(null);
      try {
        const response = await fetch("/api/acquisition", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            itemId: view.itemId,
            action,
            ...(sourceRef !== undefined ? { ref: sourceRef } : {}),
          }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setFailure(body?.error ?? "the action could not be completed");
        } else {
          // Re-render from the server's honest next view (no optimism): a
          // plain reload works in every environment — no router context
          // is assumed (the honest minimum this island needs).
          if (typeof window !== "undefined") window.location.reload();
        }
      } catch (thrown) {
        setFailure(thrown instanceof Error ? thrown.message : "the action could not be completed");
      } finally {
        setPending(null);
      }
    },
    [view.itemId, sourceRef],
  );

  if (view.actions.length === 0 && mode !== "fixtures") return null;

  return (
    <div className="wfx-acquisition__actions" data-wfx-acquisition-actions>
      {view.actions.map((action) => (
        <button
          key={action.kind}
          type="button"
          className="wfx-btn"
          data-wfx-acquisition-action={action.kind}
          disabled={pending !== null}
          onClick={() => {
            void post(action.kind);
          }}
        >
          {ACTION_LABELS[action.kind]}
        </button>
      ))}
      {mode === "fixtures" ? (
        <button
          type="button"
          className="wfx-btn wfx-btn--dev"
          data-wfx-acquisition-action="advance"
          title="Dev fixtures: step the scripted download one lifecycle step"
          disabled={pending !== null}
          onClick={() => {
            void post("advance");
          }}
        >
          Advance scripted download (dev)
        </button>
      ) : null}
      {failure !== null ? (
        <p className="wfx-detail__meta" data-wfx-acquisition-action-error role="alert">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
