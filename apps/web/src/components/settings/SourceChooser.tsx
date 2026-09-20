"use client";

/**
 * @wfx/app-web — the first-connect source chooser (R22-D, client island).
 *
 * THE LAW THIS COMPONENT KEEPS (docs/plans/
 * 2026-09-20-webflix-major-journey-hardening-plan.md — F2, the dead-end
 * killer): "Connect a source" may never terminate by returning the user
 * to the same empty state. The chooser renders Worker 1's R22-A
 * `SourceCatalogView` (the typed chooser read model) — every supported
 * connector the deployment wires, each with its honest state truth
 * (not-connected / connecting / connected / authorization-expired /
 * failed / unsupported), its user-vocabulary connection method, and its
 * typed action (connect / reauthorize / disconnect / none). The
 * anonymous session renders the typed sign-in prerequisite — never a
 * fabricated catalog, never an empty dead end.
 *
 * THE CONVERGENCE LAW (Home and Settings render the SAME shared source
 * state): this island fetches `/api/sources/catalog` — the SAME shared
 * runtime sources read the Settings page renders server-side. A connect
 * action POSTs to `/api/sources` (the existing typed-action route); the
 * honest answer is the server's next observed state (no optimism — the
 * page re-renders from the runtime's refreshed truth, exactly like the
 * existing `SourceActions` path).
 *
 * THE DESIGN LANGUAGE (docs/architecture/webflix-design-language.md):
 * one obvious primary action per entry (the connect / reauthorize /
 * disconnect control — SourceActions already renders the typed button
 * with its honest label); semantic state color paired with the state
 * label text (the catalog's `tone` is the styling hint, the
 * `stateLabel` is the truth); the prerequisite renders as the calm
 * empty-state pattern (icon → headline → one-sentence explanation → one
 * useful action — exactly the frozen pattern).
 */

import { useCallback, useEffect, useState, type JSX } from "react";

import type {
  ModelSectionStatus,
  SourceCatalogView,
} from "@wfx/client-runtime";

import { Icon } from "@/components/shell/Icon";
import { SourceActions } from "@/components/settings/SourceActions";

/** One chooser card: the connector's state truth + its typed action. */
function ChooserCard({
  entry,
  mode,
}: {
  readonly entry: SourceCatalogView["entries"][number];
  readonly mode: "fixtures" | "service";
}): JSX.Element {
  return (
    <li
      className="wfx-queue__item wfx-source-chooser__entry"
      data-wfx-source-chooser-entry={entry.connectorId}
      data-wfx-source-chooser-state={entry.state}
      data-wfx-source-chooser-tone={entry.tone}
    >
      <span className="wfx-card__meta">
        <span className="wfx-badge wfx-badge--type">{entry.displayName}</span>
        <span
          className={`wfx-capchip wfx-capchip--${entry.tone}`}
          data-wfx-source-chooser-state-label
        >
          {entry.stateLabel}
        </span>
      </span>
      <p className="wfx-row__reason" data-wfx-source-chooser-detail>
        {entry.stateDetail}
      </p>
      <p className="wfx-row__reason" data-wfx-source-chooser-method>
        <span className="wfx-badge wfx-badge--type">{entry.method.label}</span>
        <span>{entry.method.detail}</span>
      </p>
      {entry.capabilityHighlights.declared.length > 0 ? (
        <ul
          className="wfx-row__reason"
          data-wfx-source-chooser-capabilities
          style={{ listStyle: "none", padding: 0, display: "flex", flexWrap: "wrap", gap: "0.25rem" }}
        >
          {entry.capabilityHighlights.declared.map((capability) => (
            <li
              key={capability}
              className="wfx-capchip wfx-capchip--positive"
              data-wfx-source-chooser-capability={capability}
            >
              {capability}
            </li>
          ))}
        </ul>
      ) : null}
      {entry.state === "unsupported" && entry.unsupportedDetail !== null ? (
        <p className="wfx-row__reason" data-wfx-source-chooser-unsupported-detail>
          {entry.unsupportedDetail}
        </p>
      ) : null}
      {entry.state === "unsupported" && entry.recoveryHint !== null ? (
        <p className="wfx-row__reason" data-wfx-source-chooser-recovery-hint>
          {entry.recoveryHint}
        </p>
      ) : null}
      <SourceActions
        connectorId={entry.connectorId}
        action={{ kind: entry.action.kind, label: entry.action.label }}
        mode={mode}
      />
    </li>
  );
}

/** The anonymous prerequisite block (the sign-in-or-create-account affordance). */
function PrerequisiteBlock({
  prerequisite,
}: {
  readonly prerequisite: NonNullable<SourceCatalogView["prerequisite"]>;
}): JSX.Element {
  return (
    <div
      className="wfx-state wfx-source-chooser__prerequisite"
      data-wfx-source-chooser-prerequisite
    >
      <span className="wfx-state__icon">
        <Icon name="browser" />
      </span>
      <p className="wfx-state__title" data-wfx-source-chooser-prerequisite-label>
        {prerequisite.label}
      </p>
      <p className="wfx-state__detail" data-wfx-source-chooser-prerequisite-detail>
        {prerequisite.detail}
      </p>
      <div className="wfx-state__actions">
        <a
          className="wfx-btn wfx-btn--primary"
          href="/settings?section=general"
          data-wfx-source-chooser-signin
        >
          Sign in or create an account
        </a>
      </div>
    </div>
  );
}

/** The empty-catalog block (a deployment truth — never a stale "arrives later"). */
function EmptyCatalogBlock({ detail }: { readonly detail: string }): JSX.Element {
  return (
    <div
      className="wfx-state wfx-source-chooser__empty"
      data-wfx-source-chooser-empty
    >
      <span className="wfx-state__icon">
        <Icon name="browser" />
      </span>
      <p className="wfx-state__title">No connectors available</p>
      <p className="wfx-state__detail" data-wfx-source-chooser-empty-detail>
        {detail}
      </p>
    </div>
  );
}

/** The error block (the typed sources-read failure, verbatim). */
function ErrorBlock({
  status,
}: {
  readonly status: ModelSectionStatus;
}): JSX.Element {
  return (
    <div
      className="wfx-state wfx-source-chooser__error"
      data-wfx-source-chooser-error
    >
      <span className="wfx-state__icon">
        <Icon name="browser" />
      </span>
      <p className="wfx-state__title">Source catalog is unavailable right now</p>
      <p className="wfx-state__detail">
        {status.error?.detail ??
          "the source catalog read did not complete — try refreshing."}
      </p>
    </div>
  );
}

/**
 * The first-connect source chooser. Hydrates from the server-rendered
 * initial catalog (no loading flash on first paint — the page computes
 * the same R22-A `sourceCatalogView` derivation server-side), and lets
 * the user refresh on demand or trigger a connect / reauthorize /
 * disconnect flow through the existing `SourceActions` (which POSTs to
 * `/api/sources`).
 */
export function SourceChooser({
  mode,
  initialCatalog,
}: {
  /** The host boot mode (the chooser's actions match the existing SourceActions mode). */
  readonly mode: "fixtures" | "service";
  /**
   * The server-rendered initial catalog (the same R22-A derivation the
   * page produces from the runtime's sources read + the session's
   * authenticated truth — never a fabricated catalog). When absent the
   * chooser fetches its own catalog on mount (the loading state).
   */
  readonly initialCatalog?: SourceCatalogView;
}): JSX.Element {
  const [catalog, setCatalog] = useState<SourceCatalogView | null>(initialCatalog ?? null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/sources/catalog", { cache: "no-store" });
      if (!response.ok) {
        setError(`the catalog could not be loaded (HTTP ${response.status})`);
        return;
      }
      const body = (await response.json()) as { catalog?: SourceCatalogView };
      if (body.catalog === undefined) {
        setError("the catalog answer was malformed — no `catalog` field");
        return;
      }
      setCatalog(body.catalog);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "the catalog could not be loaded");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Hydrate from the server-rendered catalog if absent (no fetch needed
    // when the page already derived the view; refresh on demand only).
    if (catalog === null && error === null) {
      void refresh();
    }
  }, [catalog, error, refresh]);

  if (catalog === null && error === null) {
    return (
      <div
        className="wfx-source-chooser"
        data-wfx-source-chooser
        data-wfx-source-chooser-loading
        aria-busy="true"
      >
        <p className="wfx-row__reason">Loading the source catalog…</p>
      </div>
    );
  }

  if (catalog === null && error !== null) {
    return (
      <div className="wfx-source-chooser" data-wfx-source-chooser data-wfx-source-chooser-failed>
        <div className="wfx-state" data-wfx-source-chooser-error>
          <span className="wfx-state__icon">
            <Icon name="browser" />
          </span>
          <p className="wfx-state__title">Source catalog is unavailable right now</p>
          <p className="wfx-state__detail">{error}</p>
        </div>
        <button
          type="button"
          className="wfx-btn"
          data-wfx-source-chooser-refresh
          disabled={refreshing}
          onClick={() => {
            void refresh();
          }}
        >
          Try loading the catalog again
        </button>
      </div>
    );
  }

  // catalog is non-null here (the loading and failed states returned early).
  const view = catalog as SourceCatalogView;

  return (
    <div
      className="wfx-source-chooser"
      id="wfx-source-chooser"
      data-wfx-source-chooser
    >
      <div className="wfx-row__header" data-wfx-source-chooser-header>
        <h3 className="wfx-row__title">Connect a source</h3>
        <p className="wfx-row__reason">
          Choose a supported connector to browse its catalog in WebFlix. Each source states its
          authorization truth here — connect, reconnect, or disconnect.
        </p>
      </div>

      {view.status.state === "error" ? (
        <ErrorBlock status={view.status} />
      ) : view.prerequisite !== null ? (
        <PrerequisiteBlock prerequisite={view.prerequisite} />
      ) : view.entries.length === 0 ? (
        view.catalogEmptyDetail !== null ? (
          <EmptyCatalogBlock detail={view.catalogEmptyDetail} />
        ) : (
          <EmptyCatalogBlock detail="No connectors are available right now." />
        )
      ) : (
        <ul
          className="wfx-queue__list"
          style={{ listStyle: "none", padding: 0 }}
          data-wfx-source-chooser-list
        >
          {view.entries.map((entry) => (
            <ChooserCard key={entry.connectorId} entry={entry} mode={mode} />
          ))}
        </ul>
      )}

      <button
        type="button"
        className="wfx-btn wfx-btn--sm"
        data-wfx-source-chooser-refresh
        disabled={refreshing}
        onClick={() => {
          void refresh();
        }}
      >
        {refreshing ? "Refreshing…" : "Refresh the catalog"}
      </button>
    </div>
  );
}
