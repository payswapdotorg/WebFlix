"use client";

/**
 * @wfx/app-web — the BYOF action controls (R20-D, client).
 *
 * The typed actions of the Bring-Your-Feed flow, posted to `/api/feed`:
 * the wizard's connect/confirm/discard, the import management verbs
 * (sync / disconnect / reconnect / the SEPARATE explicit delete-records),
 * and the clearly-labeled dev `revise-source` drive (fixtures mode only —
 * the same law the acquisition `advance` and source `expire` follow).
 *
 * NO optimistic state changes: the honest answer is the server's (the
 * typed result envelope); a failure answers the typed message verbatim
 * with its recovery path (an authorization failure points at the source's
 * reconnect flow in Settings — never a silent empty state).
 */

import { useCallback, useState, type JSX } from "react";

/** One wired import method (the chooser's truth). */
export interface ByofMethodOption {
  readonly method: string;
  readonly note: string;
  readonly continuousSync: boolean;
}

/** One POSTable action button's shape. */
export interface ByofActionSpec {
  readonly action: string;
  readonly label: string;
  readonly title?: string;
  readonly primary?: boolean;
  readonly dev?: boolean;
  readonly confirm?: string;
  readonly destructive?: boolean;
  readonly importId?: string;
}

/**
 * The BYOF action controls. `mode` selects the shape:
 * - `choose` — the wizard's source/method choice + the connect action;
 * - `preview` — the confirm/discard pair of the staged preview;
 * - `import` — one import row's management verbs (importId-addressed).
 */
export function ByofActions({
  shape,
  connectorId,
  methods,
  actions,
  mode,
}: {
  readonly shape: "choose" | "preview" | "import";
  /** The source the wizard targets (the choose shape). */
  readonly connectorId?: string;
  /** The source's honest method truth (the choose shape). */
  readonly methods?: readonly ByofMethodOption[];
  /** The import-addressed actions (the preview/import shapes). */
  readonly actions: readonly ByofActionSpec[];
  /** The host boot mode (the dev drive renders in fixtures mode only). */
  readonly mode: "fixtures" | "service";
  /** The import the preview/import shapes address. */
  readonly importId?: string;
}): JSX.Element | null {
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ readonly kind: string; readonly detail: string } | null>(null);
  const [chosenMethod, setChosenMethod] = useState<string>(methods?.[0]?.method ?? "api");

  const post = useCallback(
    async (spec: ByofActionSpec, method?: string) => {
      setPending(spec.action);
      setFailure(null);
      const confirmed =
        spec.confirm === undefined ||
        window.confirm(spec.confirm);
      if (!confirmed) {
        setPending(null);
        return;
      }
      try {
        const body: Record<string, unknown> = { action: spec.action };
        if (spec.importId !== undefined) body.importId = spec.importId;
        if (method !== undefined) body.method = method;
        if (shape === "choose" && connectorId !== undefined) body.connectorId = connectorId;
        const response = await fetch("/api/feed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const parsed = (await response.json().catch(() => null)) as
            | { kind?: string; detail?: string; error?: string }
            | null;
          const kind = parsed?.kind ?? "error";
          const detail = parsed?.detail ?? parsed?.error ?? "the action could not be completed";
          if (kind === "unauthorized") {
            // The honest FAILURE FOLD landed server-side (the import row is
            // reauthorization-required with its records retained): reload
            // so the surface renders the folded truth + its recovery path
            // (never the stale pre-failure view).
            if (typeof window !== "undefined") window.location.reload();
            return;
          }
          setFailure({ kind, detail });
        } else {
          // Re-render from the server's honest next state (no optimism).
          if (typeof window !== "undefined") window.location.reload();
        }
      } catch (thrown) {
        setFailure({
          kind: "error",
          detail: thrown instanceof Error ? thrown.message : "the action could not be completed",
        });
      } finally {
        setPending(null);
      }
    },
    [connectorId, shape],
  );

  if (actions.length === 0 && shape !== "choose") return null;

  return (
    <div className="wfx-acquisition__actions" data-wfx-byof-actions data-wfx-byof-actions-shape={shape}>
      {shape === "choose" && methods !== undefined && methods.length > 0 ? (
        <fieldset
          className="wfx-byof-methods"
          data-wfx-byof-methods
          style={{ border: "1px solid var(--wfx-border)", borderRadius: "var(--wfx-radius)", padding: "0.75rem 1rem 1rem", margin: "0 0 0.75rem" }}
        >
          <legend className="wfx-card__meta" style={{ padding: "0 0.375rem" }}>
            How should WebFlix read this feed?
          </legend>
          {methods.map((option) => (
            <label
              key={option.method}
              className="wfx-byof-method"
              data-wfx-byof-method={option.method}
              data-wfx-byof-method-continuous={option.continuousSync ? "true" : "false"}
              style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", padding: "0.375rem 0", cursor: "pointer" }}
            >
              <input
                type="radio"
                name="byof-method"
                value={option.method}
                checked={chosenMethod === option.method}
                onChange={() => {
                  setChosenMethod(option.method);
                }}
                style={{ marginTop: "0.25rem" }}
              />
              <span>
                <span className="wfx-card__meta" style={{ display: "block" }}>
                  <strong>{option.method === "api" ? "Authorized connection" : "Official export file"}</strong>
                  {option.continuousSync ? " · can keep syncing" : " · one-time snapshot"}
                </span>
                <span className="wfx-row__reason" style={{ display: "block" }}>
                  {option.note}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {actions.map((spec) => (
        <button
          key={spec.action}
          type="button"
          className={`wfx-btn${spec.primary === true ? " wfx-btn--primary" : ""}${spec.destructive === true ? " wfx-btn--ghost" : ""}`}
          data-wfx-byof-action={spec.action}
          {...(spec.importId !== undefined ? { "data-wfx-byof-import": spec.importId } : {})}
          {...(spec.dev === true ? { "data-wfx-byof-action-dev": "true" } : {})}
          {...(spec.title !== undefined ? { title: spec.title } : {})}
          disabled={pending !== null}
          onClick={() => {
            void post(spec, shape === "choose" ? chosenMethod : undefined);
          }}
        >
          {spec.label}
        </button>
      ))}

      {mode === "fixtures" && shape === "choose" ? (
        <button
          type="button"
          className="wfx-btn wfx-btn--dev"
          data-wfx-byof-action="revise-source"
          data-wfx-byof-action-dev="true"
          title="Dev fixtures: the source changes (a sync then has something honest to reconcile — the J33 sync drive)"
          disabled={pending !== null}
          onClick={() => {
            void post({ action: "revise-source", label: "Dev: the source changed" });
          }}
        >
          Dev: the source changed
        </button>
      ) : null}

      {failure !== null ? (
        <p className="wfx-row__reason" data-wfx-byof-action-error role="alert" style={{ color: "var(--wfx-text)" }}>
          {failure.detail}
          {failure.kind === "unauthorized" ? " — reconnect the source in Settings, then import again." : ""}
        </p>
      ) : null}
    </div>
  );
}
