"use client";

/**
 * @wfx/app-web — the BYOF flow actions (R20-D, client).
 *
 * The typed POST controls of the Bring Your Own Feed flow, wired to
 * `/api/byof` with the SAME law the R17 source actions follow: NO
 * optimistic state changes — the honest answer is the server's typed
 * result. A SUCCESS navigates or renders the server's own report inline;
 * a FAILURE renders the typed message verbatim with its RECOVERY ACTION
 * (an authorization failure always offers its connect path — never a
 * silent empty state, never a fake success).
 *
 * Controls (one clear primary action per step — the design language):
 * - the source card: `Import your feed` (primary) + the connect truth;
 * - the preview: `Confirm import` (primary) + `Not now` (secondary);
 * - the import: `Sync now` (when the route can sync), `Disconnect import`
 *   (non-destructive undo), and `Delete imported records` — the SEPARATE
 *   EXPLICIT destructive action, armed with a two-step confirmation so it
 *   can never fire as a side effect of another intent.
 */

import { useCallback, useState, type JSX } from "react";

/** One typed BYOF failure as the route answers it. */
interface RouteFailure {
  readonly kind: string;
  readonly detail: string;
}

/** The typed outcome of one POST. */
type PostOutcome =
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly failure: RouteFailure };

/** POST one BYOF action (the typed channel — never a thrown generic). */
async function postByof(body: Record<string, unknown>): Promise<PostOutcome> {
  try {
    const response = await fetch("/api/byof", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const failure =
        typeof parsed === "object" && parsed !== null
          ? (parsed as { failure?: { kind?: unknown; detail?: unknown } }).failure
          : undefined;
      return {
        ok: false,
        failure: {
          kind: typeof failure?.kind === "string" ? failure.kind : "transport",
          detail:
            typeof failure?.detail === "string"
              ? failure.detail
              : "the action could not be completed",
        },
      };
    }
    return { ok: true, body: (parsed ?? {}) as Record<string, unknown> };
  } catch (thrown) {
    return {
      ok: false,
      failure: {
        kind: "transport",
        detail: thrown instanceof Error ? thrown.message : "the action could not be completed",
      },
    };
  }
}

/** The inline failure block (the clear, actionable authorization-failure path). */
function FailureBlock({
  failure,
  onRetry,
}: {
  readonly failure: RouteFailure;
  readonly onRetry: () => void;
}): JSX.Element {
  return (
    <div className="wfx-byof__failure" data-wfx-byof-action-error data-wfx-byof-failure-kind={failure.kind} role="alert">
      <p className="wfx-byof__failure-title">
        {failure.kind === "unauthorized"
          ? "This source isn't connected"
          : failure.kind === "unsupported"
            ? "This import isn't available here"
            : "The action could not be completed"}
      </p>
      <p className="wfx-byof__failure-detail">{failure.detail}</p>
      {failure.kind === "unauthorized" ? (
        <p className="wfx-byof__failure-detail" data-wfx-byof-failure-recovery>
          Connect the source first, then bring your feed — your authorization is what lets WebFlix
          read the feed you already have.
        </p>
      ) : null}
      <button type="button" className="wfx-byof-btn" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The source-card actions (choose source → connect/import)
// ---------------------------------------------------------------------------

/** The source card's actions: the import entry + the connect truth. */
export function ByofSourceActions({
  connectorId,
  displayName,
  connected,
  mode,
}: {
  /** The importable source the actions target. */
  readonly connectorId: string;
  /** The source's plain display name (copy uses it). */
  readonly displayName: string;
  /** The feed-route authorization truth. */
  readonly connected: boolean;
  /** The host boot mode (the connect drive renders in fixtures mode only). */
  readonly mode: "fixtures" | "service";
}): JSX.Element {
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<RouteFailure | null>(null);

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<PostOutcome> => {
      setPending(typeof body.action === "string" ? body.action : null);
      setFailure(null);
      const outcome = await postByof(body);
      if (!outcome.ok) setFailure(outcome.failure);
      setPending(null);
      return outcome;
    },
    [],
  );

  const importFeed = useCallback(() => {
    void (async () => {
      const outcome = await post({ action: "preview", connectorId });
      if (outcome.ok) {
        const importId = typeof outcome.body.importId === "string" ? outcome.body.importId : "";
        if (importId.length > 0 && typeof window !== "undefined") {
          window.location.assign(`/settings?section=sources&byof=preview&import=${encodeURIComponent(importId)}`);
        }
      }
    })();
  }, [connectorId, post]);

  const connect = useCallback(() => {
    void (async () => {
      const outcome = await post({ action: "connect" });
      if (outcome.ok && typeof window !== "undefined") window.location.reload();
    })();
  }, [post]);

  return (
    <div className="wfx-byof__actions" data-wfx-byof-source-actions>
      {connected ? (
        <p className="wfx-byof__auth-truth" data-wfx-byof-source-auth="connected">
          Connected — WebFlix can read the feed you already have here.
        </p>
      ) : mode === "fixtures" ? (
        <p className="wfx-byof__auth-truth" data-wfx-byof-source-auth="not-connected">
          Not connected — authorize {displayName} to bring your feed. (In this dev-fixture boot the
          connect step is the scripted stand-in for the source&apos;s own sign-in.)
        </p>
      ) : (
        <p className="wfx-byof__auth-truth" data-wfx-byof-source-auth="not-connected">
          Not connected — authorize {displayName} through its own sign-in to bring your feed.
        </p>
      )}
      <div className="wfx-byof__actions-row">
        <button
          type="button"
          className="wfx-byof-btn wfx-byof-btn--primary"
          data-wfx-byof-action="preview"
          disabled={pending !== null}
          onClick={importFeed}
        >
          Import your feed from {displayName}
        </button>
        {!connected && mode === "fixtures" ? (
          <button
            type="button"
            className="wfx-byof-btn"
            data-wfx-byof-action="connect"
            disabled={pending !== null}
            onClick={connect}
          >
            Connect {displayName}
          </button>
        ) : null}
      </div>
      {failure !== null ? <FailureBlock failure={failure} onRetry={importFeed} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The preview actions (confirm / not now)
// ---------------------------------------------------------------------------

/** The staged preview's actions: confirm (primary) + discard (secondary). */
export function ByofPreviewActions({
  importId,
}: {
  /** The staged preview to confirm or discard. */
  readonly importId: string;
}): JSX.Element {
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<RouteFailure | null>(null);

  const confirm = useCallback(() => {
    void (async () => {
      setPending("confirm");
      setFailure(null);
      const outcome = await postByof({ action: "confirm", importId });
      setPending(null);
      if (outcome.ok) {
        // The feed appears: navigate to the Library (a fresh server render
        // of the imported feed — never an optimistic patch).
        if (typeof window !== "undefined") window.location.assign("/library?byof=imported");
      } else {
        setFailure(outcome.failure);
      }
    })();
  }, [importId]);

  const discard = useCallback(() => {
    void (async () => {
      setPending("discard-preview");
      setFailure(null);
      const outcome = await postByof({ action: "discard-preview", importId });
      setPending(null);
      if (outcome.ok) {
        if (typeof window !== "undefined") window.location.assign("/settings?section=sources");
      } else {
        setFailure(outcome.failure);
      }
    })();
  }, [importId]);

  return (
    <div className="wfx-byof__actions" data-wfx-byof-preview-actions>
      <div className="wfx-byof__actions-row">
        <button
          type="button"
          className="wfx-byof-btn wfx-byof-btn--primary"
          data-wfx-byof-action="confirm"
          disabled={pending !== null}
          onClick={confirm}
        >
          Confirm import
        </button>
        <button
          type="button"
          className="wfx-byof-btn"
          data-wfx-byof-action="discard-preview"
          disabled={pending !== null}
          onClick={discard}
        >
          Not now
        </button>
      </div>
      {failure !== null ? (
        <FailureBlock failure={failure} onRetry={confirm} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The import actions (sync / disconnect / delete)
// ---------------------------------------------------------------------------

/** One confirmed import's actions: sync, the non-destructive disconnect, the explicit delete. */
export function ByofImportActions({
  importId,
  itemCount,
  canSync,
}: {
  /** The confirmed import the actions target. */
  readonly importId: string;
  /** The import's live record count (the delete arm states exactly what is deleted). */
  readonly itemCount: number;
  /** Whether the import's route supports sync (the honest button truth). */
  readonly canSync: boolean;
}): JSX.Element {
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<RouteFailure | null>(null);
  const [result, setResult] = useState<JSX.Element | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);

  const run = useCallback(
    async (
      action: string,
      onOkay: (body: Record<string, unknown>) => JSX.Element | null,
    ): Promise<void> => {
      setPending(action);
      setFailure(null);
      setResult(null);
      const outcome = await postByof({ action, importId });
      setPending(null);
      if (!outcome.ok) {
        setFailure(outcome.failure);
        return;
      }
      const rendered = onOkay(outcome.body);
      if (rendered !== null) setResult(rendered);
    },
    [importId],
  );

  const sync = useCallback(() => {
    void run("sync", (body) => {
      const report = (body.report ?? {}) as {
        added?: unknown; updated?: unknown; removed?: unknown; kept?: unknown; syncState?: unknown;
      };
      const added = typeof report.added === "number" ? report.added : 0;
      const updated = typeof report.updated === "number" ? report.updated : 0;
      const removed = typeof report.removed === "number" ? report.removed : 0;
      const kept = typeof report.kept === "number" ? report.kept : 0;
      const state = typeof report.syncState === "string" ? report.syncState : "";
      // The SERVER'S OWN reconciliation report, rendered verbatim — the
      // honest counts of what this sync changed (never fabricated).
      return (
        <div
          className="wfx-byof__result"
          data-wfx-byof-action-result="sync"
          data-wfx-byof-sync-state={state}
        >
          <p className="wfx-byof__result-title">Synced — here is exactly what changed:</p>
          <p className="wfx-byof__result-detail">
            {added} added · {updated} updated · {removed} removed · {kept} unchanged. The feed
            below re-renders on your next visit.
          </p>
          <a className="wfx-byof-btn" href="/library">
            See your imported feed
          </a>
        </div>
      );
    });
  }, [run]);

  const disconnect = useCallback(() => {
    void run("disconnect", () => (
      <div className="wfx-byof__result" data-wfx-byof-action-result="disconnected">
        <p className="wfx-byof__result-title">Import disconnected.</p>
        <p className="wfx-byof__result-detail" data-wfx-byof-retained-truth>
          Your {itemCount} imported records are retained with their provenance — you will still see
          them in your Library. WebFlix stopped syncing this feed; deleting the records is a
          separate, explicit action.
        </p>
        <a className="wfx-byof-btn" href="/library">
          See your imported feed
        </a>
      </div>
    ));
  }, [itemCount, run]);

  const deleteRecords = useCallback(() => {
    void run("delete-records", (body) => {
      const removed = typeof body.removed === "number" ? body.removed : 0;
      return (
        <div className="wfx-byof__result" data-wfx-byof-action-result="deleted">
          <p className="wfx-byof__result-title">Deleted {removed} imported records.</p>
          <p className="wfx-byof__result-detail">
            The imported records are permanently removed. Your WebFlix watchlist and history were
            never touched by this import.
          </p>
          <a className="wfx-byof-btn" href="/library">
            See your Library
          </a>
        </div>
      );
    });
  }, [run]);

  return (
    <div className="wfx-byof__actions" data-wfx-byof-import-actions>
      <div className="wfx-byof__actions-row">
        {canSync ? (
          <button
            type="button"
            className="wfx-byof-btn wfx-byof-btn--primary"
            data-wfx-byof-action="sync"
            disabled={pending !== null}
            onClick={sync}
          >
            Sync now
          </button>
        ) : null}
        <button
          type="button"
          className="wfx-byof-btn"
          data-wfx-byof-action="disconnect"
          disabled={pending !== null}
          onClick={disconnect}
          title="Stops syncing this import. Your imported records are kept — deletion is a separate, explicit action."
        >
          Disconnect import
        </button>
        {deleteArmed ? (
          <button
            type="button"
            className="wfx-byof-btn wfx-byof-btn--danger"
            data-wfx-byof-action="delete-records"
            data-wfx-byof-delete-armed="true"
            disabled={pending !== null}
            onClick={() => {
              setDeleteArmed(false);
              deleteRecords();
            }}
          >
            Really delete {itemCount} imported records
          </button>
        ) : (
          <button
            type="button"
            className="wfx-byof-btn wfx-byof-btn--danger-outline"
            data-wfx-byof-action="delete-records"
            disabled={pending !== null}
            onClick={() => {
              setDeleteArmed(true);
            }}
            title="The explicit destructive action — removes the imported records. Your WebFlix library and history are separate and untouched."
          >
            Delete imported records…
          </button>
        )}
      </div>
      {result !== null ? result : null}
      {failure !== null ? (
        <FailureBlock failure={failure} onRetry={() => {
          void run("sync", () => null);
        }} />
      ) : null}
    </div>
  );
}
