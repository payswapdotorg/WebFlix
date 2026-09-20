"use client";

/**
 * @wfx/app-web — the AI action tray (R21-E, client).
 *
 * The contextual AI-actions surface on the item decision hub and the
 * player: the frozen five-action vocabulary (Transcribe, Subtitles,
 * Translate, Dub, Commentary), each carrying its MODEL-CLASS truth (the
 * R21-C model-controls read rendered server-side — discoverable before
 * any hydration) and its input truth for THIS title (a precondition is
 * NAMED, never a dead button).
 *
 * Writes go through `/api/transform` (the runtime's model-controls seam
 * — never a second owner). The honest answer is the typed operation:
 * explicit states only (queued / running / succeeded / failed /
 * cancelled), progress only when the transport reports it — NEVER
 * fabricated progress. Recovery is built in: cancel while queued or
 * running, retry after a failure, clear a result once it is not needed.
 *
 * Progressive disclosure (two laws at once): the tray is a native
 * `<details>` — quiet until invoked, keyboard-operable for free, its
 * content server-rendered. The Model & AI management path is one link
 * away. Local-model execution carries its honest Desktop truth.
 */

import { useCallback, useState, type JSX } from "react";

import type { AiTrayView } from "@/host/decision-views";

/** The tray's typed view of one submitted operation (the route's answer). */
interface OperationState {
  readonly id: string;
  readonly kind: string;
  readonly state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  readonly progress: number | null;
  readonly errorDetail: string | null;
}

/** The translation language vocabulary (the tray's compact choice). */
const LANGUAGES: readonly { readonly code: string; readonly label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "ja", label: "Japanese" },
];

/** The commentary style vocabulary (the fabric's frozen set). */
const COMMENTARY_STYLES: readonly { readonly value: string; readonly label: string }[] = [
  { value: "insightful", label: "Insightful" },
  { value: "casual", label: "Casual" },
  { value: "critical", label: "Critical" },
];

/** The state sentence of one operation (user vocabulary — never a raw code). */
function operationSentence(operation: OperationState): string {
  switch (operation.state) {
    case "queued":
      return "Queued — the operation starts when your model chain picks it up.";
    case "running":
      return `Running${operation.progress !== null ? ` — ${Math.round(operation.progress * 100)}%` : ""}.`;
    case "succeeded":
      return "Done — the result is ready and clearable.";
    case "cancelled":
      return "Cancelled — nothing is running.";
    case "failed":
      return `Failed${operation.errorDetail !== null ? ` — ${operation.errorDetail}` : ""}`;
  }
}

export function AiActionTray({
  view,
  surface,
}: {
  /** The tray's view (the model-controls truth + the target identity). */
  readonly view: AiTrayView;
  /** The surface the tray renders on (aria + analytics vocabulary). */
  readonly surface: "item" | "player";
}): JSX.Element {
  const [pending, setPending] = useState<string | null>(null);
  const [operation, setOperation] = useState<OperationState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [language, setLanguage] = useState("es");
  const [style, setStyle] = useState("insightful");

  const post = useCallback(
    async (body: Record<string, unknown>, label: string) => {
      setPending(label);
      setFailure(null);
      try {
        const response = await fetch("/api/transform", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
          setFailure(errorBody?.error ?? "the action could not be submitted");
        } else {
          setOperation((await response.json()) as OperationState);
        }
      } catch (thrown) {
        setFailure(thrown instanceof Error ? thrown.message : "the action could not be submitted");
      } finally {
        setPending(null);
      }
    },
    [],
  );

  const target = {
    connectorId: view.target.connectorId,
    externalRef: view.target.externalRef,
    title: view.target.title,
    ...(view.target.durationMs !== undefined ? { durationMs: view.target.durationMs } : {}),
  };

  return (
    <details className="wfx-disc__tray" data-wfx-ai-tray data-wfx-ai-tray-surface={surface}>
      <summary className="wfx-disc__tray-toggle" data-wfx-ai-tray-toggle>
        <span className="wfx-disc__tray-summary">
          AI actions
          <span className="wfx-disc__tray-mark" data-wfx-ai-tray-vocabulary>
            transcribe · subtitles · translate · dub · commentary
          </span>
        </span>
      </summary>
      <div className="wfx-disc__tray-panel" data-wfx-ai-tray-panel>
        <p className="wfx-disc__phint" data-wfx-ai-tray-desktop-truth>
          {view.desktopTruth}
        </p>
        <ul className="wfx-disc__tray-actions" data-wfx-ai-tray-actions>
          {view.actions.map((action) => (
            <li key={action.kind} className="wfx-disc__tray-action" data-wfx-ai-action={action.kind}>
              <div className="wfx-disc__tray-actionhead">
                <span className="wfx-disc__tray-actionlabel" data-wfx-ai-action-label>
                  {action.label}
                </span>
                <span className="wfx-disc__tray-actionmodel" data-wfx-ai-action-model>
                  {action.modelSentence}
                </span>
              </div>
              <p className="wfx-disc__phint" data-wfx-ai-action-description>
                {action.description}
              </p>
              {action.runnable ? (
                <form
                  className="wfx-disc__tray-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const input =
                      action.kind === "translation"
                        ? { targetLanguage: language }
                        : action.kind === "commentary"
                          ? { style }
                          : {};
                    void post({ kind: action.kind, target, input }, action.kind);
                  }}
                >
                  {action.kind === "translation" ? (
                    <label className="wfx-disc__tray-field">
                      <span className="sr-only">Translate into</span>
                      <select
                        className="wfx-disc__select"
                        value={language}
                        aria-label="Translate into"
                        data-wfx-ai-language
                        onChange={(event) => {
                          setLanguage(event.target.value);
                        }}
                      >
                        {LANGUAGES.map((entry) => (
                          <option key={entry.code} value={entry.code}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {action.kind === "commentary" ? (
                    <label className="wfx-disc__tray-field">
                      <span className="sr-only">Commentary style</span>
                      <select
                        className="wfx-disc__select"
                        value={style}
                        aria-label="Commentary style"
                        data-wfx-ai-style
                        onChange={(event) => {
                          setStyle(event.target.value);
                        }}
                      >
                        {COMMENTARY_STYLES.map((entry) => (
                          <option key={entry.value} value={entry.value}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <button
                    type="submit"
                    className="wfx-btn wfx-btn--sm"
                    disabled={pending !== null}
                    data-wfx-ai-submit={action.kind}
                  >
                    Run {action.label.toLowerCase()}
                  </button>
                </form>
              ) : (
                <p className="wfx-disc__tray-precondition" data-wfx-ai-precondition={action.kind}>
                  {action.precondition}
                </p>
              )}
            </li>
          ))}
        </ul>
        {operation !== null ? (
          <div
            className="wfx-disc__tray-operation"
            data-wfx-ai-operation={operation.id}
            data-wfx-ai-operation-state={operation.state}
            role="status"
          >
            <p className="wfx-disc__tray-operationline" data-wfx-ai-operation-sentence>
              {operation.kind}: {operationSentence(operation)}
            </p>
            <div className="wfx-disc__tray-operationactions">
              {operation.state === "queued" || operation.state === "running" ? (
                <button
                  type="button"
                  className="wfx-disc__linkbtn"
                  disabled={pending !== null}
                  data-wfx-ai-cancel
                  onClick={() => {
                    void post({ kind: "cancel", operationId: operation.id }, "cancel");
                  }}
                >
                  Cancel
                </button>
              ) : null}
              {operation.state === "failed" || operation.state === "cancelled" ? (
                <button
                  type="button"
                  className="wfx-disc__linkbtn"
                  disabled={pending !== null}
                  data-wfx-ai-retry
                  onClick={() => {
                    setOperation(null);
                  }}
                >
                  Dismiss
                </button>
              ) : null}
              {operation.state === "succeeded" ? (
                <button
                  type="button"
                  className="wfx-disc__linkbtn"
                  disabled={pending !== null}
                  data-wfx-ai-clear-result
                  onClick={() => {
                    void post({ kind: "clear-result", operationId: operation.id }, "clear");
                  }}
                >
                  Clear result
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {failure !== null ? (
          <p className="wfx-disc__failure" data-wfx-ai-tray-failure role="alert">
            {failure}
          </p>
        ) : null}
        <a className="wfx-disc__link" href={view.manageHref} data-wfx-ai-tray-manage>
          Model &amp; AI settings
        </a>
      </div>
    </details>
  );
}
