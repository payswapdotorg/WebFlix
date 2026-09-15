"use client";

/**
 * @wfx/app-web — the like/save action controls (WFX-051, client).
 *
 * Optimistic UI with the honesty law: an optimistic state is shown the
 * instant the control fires, and is ROLLED BACK unless the source's
 * RECEIPT confirms it — a failed, unsupported, or transport-broken action
 * is never shown as success ("never fake success"). Receipt semantics are
 * the frozen `ActionReceipt` statuses, rendered verbatim:
 *
 * - `confirmed`   — the source confirmed; the optimistic state stands.
 * - `local-only`  — recorded locally in WebFlix, sync pending (the social
 *                   sync boundary: local state ≠ confirmed external sync).
 * - `unsupported` — the source lacks the capability; rollback + message.
 * - `failed`      — the source declined; rollback + the source's detail.
 *
 * Capability honesty BEFORE the click: a control whose capability the
 * card does not declare is rendered as the typed-absent note (never a
 * greyed-out lie that implies provider support).
 */

import { useCallback, useReducer, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";

/** The action input (mirrors the server route's body). */
export interface ActionInput {
  readonly type: "like" | "save";
  readonly connectorId: string;
  readonly externalRef: string;
  readonly itemId: string;
}

/** The per-action UI state (one reducer slot per action type). */
interface ActionUiState {
  /** The honest settled state (source truth). */
  settled: "idle" | "confirmed" | "local-only";
  /** The optimistic in-flight state (rolled back on failure). */
  optimistic: boolean;
  /** The last failure message (null when the last receipt was not a failure). */
  failure: string | null;
  /** True while the request is in flight. */
  pending: boolean;
}

type ActionUiEvent =
  | { kind: "begin" }
  | { kind: "receipt"; status: "confirmed" | "local-only" | "unsupported" | "failed"; detail?: string }
  | { kind: "error"; message: string };

const IDLE: ActionUiState = { settled: "idle", optimistic: false, failure: null, pending: false };

function reducer(state: ActionUiState, event: ActionUiEvent): ActionUiState {
  switch (event.kind) {
    case "begin":
      return { ...state, optimistic: true, failure: null, pending: true };
    case "receipt":
      if (event.status === "confirmed" || event.status === "local-only") {
        return { settled: event.status, optimistic: false, failure: null, pending: false };
      }
      // unsupported / failed ⇒ ROLLBACK (never fake success).
      return {
        ...state,
        optimistic: false,
        pending: false,
        failure:
          event.status === "unsupported"
            ? "This source does not support that action."
            : event.detail !== undefined && event.detail.length > 0
              ? `The source declined: ${event.detail}`
              : "The source declined the action.",
      };
    case "error":
      return { ...state, optimistic: false, pending: false, failure: event.message };
  }
}

/** One like/save control pair bound to one piece of content. */
export function ActionButtons({
  like,
  save,
}: {
  /** The like action input; null ⇒ the capability is absent (typed-absent note). */
  readonly like: ActionInput | null;
  /** The save action input; null ⇒ the capability is absent (typed-absent note). */
  readonly save: ActionInput | null;
}): JSX.Element {
  const [likeState, likeDispatch] = useReducer(reducer, IDLE);
  const [saveState, saveDispatch] = useReducer(reducer, IDLE);

  const fire = useCallback(
    async (input: ActionInput, dispatch: (event: ActionUiEvent) => void): Promise<void> => {
      dispatch({ kind: "begin" });
      try {
        const response = await fetch("/api/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok || body === null || typeof body !== "object") {
          dispatch({
            kind: "error",
            message: `The action could not reach the host (${response.status}). Your change was not applied.`,
          });
          return;
        }
        const status = (body as { status?: unknown }).status;
        const detail = (body as { detail?: unknown }).detail;
        if (typeof status !== "string") {
          dispatch({ kind: "error", message: "The host answered without a receipt — not applied." });
          return;
        }
        dispatch({
          kind: "receipt",
          status: status as "confirmed" | "local-only" | "unsupported" | "failed",
          ...(typeof detail === "string" ? { detail } : {}),
        });
      } catch {
        dispatch({
          kind: "error",
          message: "Network failure — the action was not applied. Try again.",
        });
      }
    },
    [],
  );

  return (
    <div className="wfx-actionbar" data-wfx-actions>
      {like === null ? (
        <span className="wfx-actionbar__status" data-wfx-action-absent="like">
          Like: not available on this source
        </span>
      ) : (
        <button
          type="button"
          className={`wfx-btn wfx-btn--sm${likeState.optimistic || likeState.settled !== "idle" ? " wfx-btn--primary" : ""}`}
          onClick={() => {
            void fire(like, likeDispatch);
          }}
          disabled={likeState.pending}
          aria-pressed={likeState.optimistic || likeState.settled !== "idle"}
          data-wfx-action="like"
        >
          <Icon name="like" size={18} />
          {likeState.optimistic ? "Liked…" : likeState.settled === "confirmed" ? "Liked" : "Like"}
        </button>
      )}
      {save === null ? (
        <span className="wfx-actionbar__status" data-wfx-action-absent="save">
          Save: not available on this source
        </span>
      ) : (
        <button
          type="button"
          className={`wfx-btn wfx-btn--sm${saveState.optimistic || saveState.settled !== "idle" ? " wfx-btn--primary" : ""}`}
          onClick={() => {
            void fire(save, saveDispatch);
          }}
          disabled={saveState.pending}
          aria-pressed={saveState.optimistic || saveState.settled !== "idle"}
          data-wfx-action="save"
        >
          <Icon name="save" size={18} />
          {saveState.optimistic ? "Saving…" : saveState.settled === "confirmed" ? "Saved" : "Save"}
        </button>
      )}
      {likeState.failure !== null ? (
        <span className="wfx-actionbar__status wfx-actionbar__status--error" role="alert" data-wfx-action-failure="like">
          {likeState.failure}
        </span>
      ) : null}
      {saveState.failure !== null ? (
        <span className="wfx-actionbar__status wfx-actionbar__status--error" role="alert" data-wfx-action-failure="save">
          {saveState.failure}
        </span>
      ) : null}
      {likeState.settled === "local-only" || saveState.settled === "local-only" ? (
        <span className="wfx-actionbar__status wfx-actionbar__status--pending">
          Recorded in WebFlix — external sync pending (the source has not confirmed yet).
        </span>
      ) : null}
    </div>
  );
}
