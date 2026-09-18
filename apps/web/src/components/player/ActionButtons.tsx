"use client";

/**
 * @wfx/app-web — the like/save action controls (WFX-051, client; R15/J10
 * surfacing).
 *
 * Optimistic UI with the honesty law: an optimistic state is shown the
 * instant the control fires, and is ROLLED BACK unless the source's
 * RECEIPT confirms it — a failed, unsupported, or transport-broken action
 * is never shown as success ("never fake success"). Receipt semantics are
 * the frozen `ActionReceipt` statuses, rendered verbatim:
 *
 * - `confirmed`   — the source confirmed (provider-confirmed): the
 *                   optimistic state stands, labeled as SYNCED.
 * - `local-only`  — recorded locally in WebFlix, external sync pending
 *                   (the R15 social sync boundary: the action IS
 *                   WebFlix-confirmed — the button reflects the local
 *                   truth — while the status line differentiates it from
 *                   provider confirmation, including the failed-with-retry
 *                   detail when the receipt carries one).
 * - `unsupported` — the source lacks the capability; rollback + message.
 * - `failed`      — the source declined; rollback + the source's detail.
 *
 * J10's differentiation law: WebFlix-confirmed (`local-only`) and
 * provider-confirmed (`confirmed`) render as DISTINCT states
 * (`data-wfx-action-state`), and `unsupported`/`failed` never render as
 * success (`data-wfx-action-state` + rollback).
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
  /** Which terminal non-success the last receipt carried (J10 marker). */
  failureKind: "unsupported" | "failed" | null;
  /** The last receipt detail for the pending-sync states (retry reasons). */
  pendingDetail: string | null;
  /** The provider's external id when provider-confirmed. */
  externalId: string | null;
  /** True while the request is in flight. */
  pending: boolean;
}

type ActionUiEvent =
  | { kind: "begin" }
  | {
      kind: "receipt";
      status: "confirmed" | "local-only" | "unsupported" | "failed";
      detail?: string;
      externalId?: string;
    }
  | { kind: "error"; message: string };

const IDLE: ActionUiState = {
  settled: "idle",
  optimistic: false,
  failure: null,
  failureKind: null,
  pendingDetail: null,
  externalId: null,
  pending: false,
};

function reducer(state: ActionUiState, event: ActionUiEvent): ActionUiState {
  switch (event.kind) {
    case "begin":
      return {
        ...state,
        optimistic: true,
        failure: null,
        failureKind: null,
        pendingDetail: null,
        pending: true,
      };
    case "receipt":
      if (event.status === "confirmed") {
        return {
          settled: "confirmed",
          optimistic: false,
          failure: null,
          failureKind: null,
          pendingDetail: null,
          externalId: event.externalId ?? null,
          pending: false,
        };
      }
      if (event.status === "local-only") {
        // WebFlix-confirmed: the action IS recorded locally; external sync
        // pends (the receipt detail carries the failed-with-retry reason
        // when the provider attempt failed and a retry is scheduled).
        return {
          settled: "local-only",
          optimistic: false,
          failure: null,
          failureKind: null,
          pendingDetail: event.detail ?? null,
          externalId: null,
          pending: false,
        };
      }
      // unsupported / failed ⇒ ROLLBACK (never fake success).
      return {
        ...state,
        optimistic: false,
        pending: false,
        pendingDetail: null,
        failureKind: event.status,
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
        const externalId = (body as { externalId?: unknown }).externalId;
        if (typeof status !== "string") {
          dispatch({ kind: "error", message: "The host answered without a receipt — not applied." });
          return;
        }
        dispatch({
          kind: "receipt",
          status: status as "confirmed" | "local-only" | "unsupported" | "failed",
          ...(typeof detail === "string" ? { detail } : {}),
          ...(typeof externalId === "string" ? { externalId } : {}),
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

  /** The J10 settled-state marker for one control. */
  const settledMarker = (
    state: ActionUiState,
    kind: "like" | "save",
  ): JSX.Element | null => {
    if (state.optimistic || state.pending) return null;
    if (state.settled === "confirmed") {
      return (
        <span
          className="wfx-actionbar__status wfx-actionbar__status--synced"
          data-wfx-action-state="confirmed-by-provider"
          data-wfx-action-kind={kind}
        >
          Synced with the source (provider-confirmed).
        </span>
      );
    }
    if (state.settled === "local-only") {
      return (
        <span
          className="wfx-actionbar__status wfx-actionbar__status--pending"
          data-wfx-action-state="confirmed-locally"
          data-wfx-action-kind={kind}
        >
          Recorded in WebFlix — external sync pending
          {state.pendingDetail !== null && state.pendingDetail.length > 0
            ? ` (${state.pendingDetail})`
            : " (the source has not confirmed yet)."}
        </span>
      );
    }
    return null;
  };

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
          {likeState.optimistic
            ? "Liked…"
            : likeState.settled === "confirmed"
              ? "Liked"
              : likeState.settled === "local-only"
                ? "Liked in WebFlix"
                : "Like"}
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
          {saveState.optimistic
            ? "Saving…"
            : saveState.settled === "confirmed"
              ? "Saved"
              : saveState.settled === "local-only"
                ? "Saved in WebFlix"
                : "Save"}
        </button>
      )}
      {likeState.failure !== null ? (
        <>
          <span
            className="wfx-actionbar__status wfx-actionbar__status--error"
            role="alert"
            data-wfx-action-failure="like"
            data-wfx-action-state={likeState.failureKind ?? "failed"}
          >
            {likeState.failure}
          </span>
          {like !== null && likeState.failureKind === "failed" ? (
            <button
              type="button"
              className="wfx-btn wfx-btn--sm"
              onClick={() => {
                void fire(like, likeDispatch);
              }}
              disabled={likeState.pending}
              data-wfx-action-retry="like"
            >
              Try again
            </button>
          ) : null}
        </>
      ) : null}
      {saveState.failure !== null ? (
        <>
          <span
            className="wfx-actionbar__status wfx-actionbar__status--error"
            role="alert"
            data-wfx-action-failure="save"
            data-wfx-action-state={saveState.failureKind ?? "failed"}
          >
            {saveState.failure}
          </span>
          {save !== null && saveState.failureKind === "failed" ? (
            <button
              type="button"
              className="wfx-btn wfx-btn--sm"
              onClick={() => {
                void fire(save, saveDispatch);
              }}
              disabled={saveState.pending}
              data-wfx-action-retry="save"
            >
              Try again
            </button>
          ) : null}
        </>
      ) : null}
      {settledMarker(likeState, "like")}
      {settledMarker(saveState, "save")}
    </div>
  );
}
