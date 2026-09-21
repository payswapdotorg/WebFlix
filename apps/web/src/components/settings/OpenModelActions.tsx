"use client";

/**
 * @wfx/app-web — the open-model registration actions (R23-J, the Model &
 * AI surface's open-model section).
 *
 * The typed register/unregister drive over `POST /api/model/open-models`
 * (the fixtures persona's file-backed registration truth). The page
 * reloads on success — the registry read renders the honest next state
 * (no optimistic state, the same law as the acquisition actions).
 */

import type { JSX } from "react";
import { useState } from "react";

export function OpenModelActions({
  providerId,
  registered,
}: {
  readonly providerId: string;
  readonly registered: boolean;
}): JSX.Element {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const drive = async (action: "register" | "unregister"): Promise<void> => {
    setPending(true);
    setFailure(null);
    try {
      const response = await fetch("/api/model/open-models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId, action }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { detail?: string };
        setFailure(payload.detail ?? "The registration drive refused — retry.");
        setPending(false);
        return;
      }
      window.location.reload();
    } catch {
      setFailure("The registration drive could not be reached — retry.");
      setPending(false);
    }
  };

  return (
    <span className="wfx-openmodel__actions" data-wfx-openmodel-actions={providerId}>
      {registered ? (
        <button
          type="button"
          className="wfx-btn wfx-btn--sm"
          disabled={pending}
          data-wfx-openmodel-action="unregister"
          onClick={() => void drive("unregister")}
        >
          {pending ? "Removing…" : "Remove registration"}
        </button>
      ) : (
        <button
          type="button"
          className="wfx-btn wfx-btn--sm"
          disabled={pending}
          data-wfx-openmodel-action="register"
          onClick={() => void drive("register")}
        >
          {pending ? "Registering…" : "Register for live speech"}
        </button>
      )}
      {failure !== null ? (
        <span className="wfx-row__reason" data-wfx-openmodel-failure>
          {failure}
        </span>
      ) : null}
    </span>
  );
}
