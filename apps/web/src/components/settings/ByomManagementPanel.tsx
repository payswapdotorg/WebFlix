"use client";

/**
 * @wfx/app-web — the BYOM management panel (R22-F, client island).
 *
 * THE LAW THIS COMPONENT KEEPS (docs/plans/
 * 2026-09-20-webflix-major-journey-hardening-plan.md — F8): "BYOM is
 * complete only when a user can DISCOVER, CONFIGURE, VERIFY, and REMOVE
 * a provider through normal product surfaces, with secrets kept
 * server-side." This panel — extending Settings → Model & AI — is that
 * normal management surface, consuming Worker 1's R22-C BYOM management
 * view (the typed binding summary + supported task capabilities +
 * privacy mode + availability + add/bind + verify/usable + remove/unbind
 * + typed errors/recovery).
 *
 * THE SEPARATION (the F8 law): the contextual title/item/player AI tray
 * remains the place to USE AI. Settings → Model & AI remains the place
 * to MANAGE model providers/policies. This panel does not duplicate the
 * tray; it adds the normal management entry point the audit found missing.
 *
 * THE SECRET LAW (machine-checked): the provider key exists ONLY in the
 * bind command (its way IN, over the /api/model/byom/bind route); the
 * transport seals it server-side and answers the secret-free handle ONLY.
 * This panel NEVER renders the key, NEVER logs the key, NEVER retains
 * the key in component state after submission. The R22-C
 * `assertByomManagementSecretFree` is the belt-and-suspenders proof.
 *
 * THE TYPED FAILURE VOCABULARY (R22-C's closed kinds, mirrored from
 * the route's answers): invalid-input (per-field errors, the shared
 * pre-flight catches them before the round trip), unauthorized (sign
 * in again), network/unavailable/malformed (retry). Every important
 * failure has a recovery next action — never a dead end.
 *
 * THE DESIGN LANGUAGE: one obvious primary action per state — the
 * panel's single primary action is "Add your model provider" (the
 * R22-C `BYOM_ADD_ACTION`); the per-entry REMOVE action is a
 * subordinate outline/text control. Semantic state color paired with
 * the state label text (the entry's `tone` is the styling hint, the
 * `stateLabel` is the truth).
 *
 * NO HIDDEN TRANSPORT METHODS OR DIRECT URLS (the F8 law): the panel
 * uses the typed /api/model/byom/bind and /api/model/byom/unbind
 * routes — the same transport the runtime owns. No direct provider URLs
 * are constructed or exposed here.
 */

import { useCallback, useState, type JSX } from "react";

import type {
  ByomBindProblem,
  ByomManagementView,
  ByomProviderEntry,
} from "@wfx/client-runtime";
import { byomBindCommandProblems, byomManagementRecovery } from "@wfx/client-runtime";

/** One typed form failure with its recovery (the R22-C vocabulary). */
interface ByomFormFailure {
  /** The headline message (one honest sentence — never a raw protocol error). */
  readonly message: string;
  /** The recovery control's label (the frozen R22-C vocabulary). */
  readonly recoveryLabel: string;
  /** The recovery action's kind (drives the onClick). */
  readonly recoveryKind: "fix-and-retry" | "retry" | "sign-in-again" | "refresh-list";
  /** The per-field problems (invalid-input only — empty otherwise). */
  readonly fieldProblems: readonly ByomBindProblem[];
}

/** Parse the bind/unbind route's response body into the typed form failure. */
function parseByomFailure(
  operation: "bind" | "unbind",
  status: number,
  body: { error?: string; detail?: string; problems?: readonly ByomBindProblem[] } | null,
): ByomFormFailure {
  const error = body?.error ?? "";
  const detail = body?.detail ?? `the provider could not be ${operation === "bind" ? "added" : "removed"}`;
  const fieldProblems = body?.problems ?? [];

  // invalid-input: per-field problems (the shared pre-flight or the
  // service's 400 — the same honest field errors).
  if (status === 400 || error === "invalid-input") {
    const recovery = byomManagementRecovery(operation, { kind: "invalid-input", detail });
    return {
      message: detail,
      recoveryLabel: recovery.label,
      recoveryKind: recovery.kind,
      fieldProblems,
    };
  }

  // unauthorized: sign in again (BYOM bindings belong to the account).
  if (status === 401 || error === "unauthorized") {
    const recovery = byomManagementRecovery(operation, { kind: "unauthorized", detail });
    return {
      message: detail,
      recoveryLabel: recovery.label,
      recoveryKind: recovery.kind,
      fieldProblems: [],
    };
  }

  // network/unavailable/malformed: retry.
  const failureKind = status >= 500 ? "unavailable" : "malformed";
  const recovery = byomManagementRecovery(operation, { kind: failureKind, detail });
  return {
    message: detail,
    recoveryLabel: recovery.label,
    recoveryKind: recovery.kind,
    fieldProblems: [],
  };
}

/** One provider entry's row with its state truth, capabilities, and REMOVE action. */
function ProviderEntryRow({
  entry,
  pending,
  onRemove,
}: {
  readonly entry: ByomProviderEntry;
  readonly pending: boolean;
  readonly onRemove: (providerId: string) => void;
}): JSX.Element {
  return (
    <li
      className="wfx-queue__item"
      data-wfx-byom-entry={entry.providerId}
      data-wfx-byom-bound={entry.bound ? "true" : "false"}
      data-wfx-byom-tone={entry.tone}
    >
      <span className="wfx-card__meta">
        <span className="wfx-badge wfx-badge--type">{entry.providerId}</span>
        <span className={`wfx-capchip wfx-capchip--${entry.tone}`} data-wfx-byom-state-label>
          {entry.stateLabel}
        </span>
        <span data-wfx-byom-privacy>{entry.privacyLabel}</span>
      </span>
      <p className="wfx-row__reason" data-wfx-byom-state-detail>
        {entry.stateDetail}
      </p>
      {entry.capabilities.length > 0 ? (
        <ul
          className="wfx-row__reason"
          data-wfx-byom-capabilities
          style={{ listStyle: "none", padding: 0, display: "flex", flexWrap: "wrap", gap: "0.25rem" }}
        >
          {entry.capabilities.map((task) => {
            const usability = entry.taskUsability.find((row) => row.task === task);
            const usable = usability?.usable ?? false;
            return (
              <li
                key={task}
                className={`wfx-capchip ${usable ? "wfx-capchip--positive" : "wfx-capchip--attention"}`}
                data-wfx-byom-task={task}
                data-wfx-byom-task-usable={usable ? "true" : "false"}
                title={usability?.unusableReason ?? ""}
              >
                {task}
              </li>
            );
          })}
        </ul>
      ) : null}
      {entry.action.kind === "remove" ? (
        <button
          type="button"
          className="wfx-btn wfx-btn--sm"
          data-wfx-byom-action="remove"
          data-wfx-byom-remove={entry.providerId}
          disabled={pending}
          onClick={() => {
            onRemove(entry.providerId);
          }}
        >
          {entry.action.label}
        </button>
      ) : null}
    </li>
  );
}

/** The add-provider form (the single primary action — the F8 management entry point). */
function AddProviderForm({
  pending,
  failure,
  onSubmit,
}: {
  readonly pending: boolean;
  readonly failure: ByomFormFailure | null;
  readonly onSubmit: (fields: {
    readonly providerId: string;
    readonly endpointUrl: string;
    readonly key: string;
  }) => void;
}): JSX.Element {
  const [providerId, setProviderId] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [key, setKey] = useState("");

  return (
    <form
      className="wfx-session-form wfx-byom__form"
      data-wfx-byom-add-form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ providerId, endpointUrl, key });
      }}
    >
      <label className="wfx-session-form__label" htmlFor="wfx-byom-provider-id">
        Provider name
      </label>
      <input
        id="wfx-byom-provider-id"
        className="wfx-session-form__input"
        type="text"
        name="providerId"
        autoComplete="off"
        required
        value={providerId}
        onChange={(event) => {
          setProviderId(event.target.value);
        }}
        aria-invalid={failure?.fieldProblems.some((p) => p.field === "providerId") ?? false}
      />
      {failure?.fieldProblems.some((p) => p.field === "providerId") ? (
        <p className="wfx-detail__meta" data-wfx-byom-field-error="providerId" role="alert">
          {failure.fieldProblems.find((p) => p.field === "providerId")?.detail}
        </p>
      ) : null}

      <label className="wfx-session-form__label" htmlFor="wfx-byom-endpoint">
        Provider web address
      </label>
      <input
        id="wfx-byom-endpoint"
        className="wfx-session-form__input"
        type="url"
        name="endpointUrl"
        autoComplete="off"
        required
        placeholder="https://your-provider.example/v1"
        value={endpointUrl}
        onChange={(event) => {
          setEndpointUrl(event.target.value);
        }}
        aria-invalid={failure?.fieldProblems.some((p) => p.field === "endpointUrl") ?? false}
      />
      {failure?.fieldProblems.some((p) => p.field === "endpointUrl") ? (
        <p className="wfx-detail__meta" data-wfx-byom-field-error="endpointUrl" role="alert">
          {failure.fieldProblems.find((p) => p.field === "endpointUrl")?.detail}
        </p>
      ) : null}

      <label className="wfx-session-form__label" htmlFor="wfx-byom-key">
        Provider key (stored encrypted, never shown again)
      </label>
      <input
        id="wfx-byom-key"
        className="wfx-session-form__input"
        type="password"
        name="key"
        autoComplete="off"
        required
        value={key}
        onChange={(event) => {
          setKey(event.target.value);
        }}
        aria-invalid={failure?.fieldProblems.some((p) => p.field === "key") ?? false}
      />
      {failure?.fieldProblems.some((p) => p.field === "key") ? (
        <p className="wfx-detail__meta" data-wfx-byom-field-error="key" role="alert">
          {failure.fieldProblems.find((p) => p.field === "key")?.detail}
        </p>
      ) : (
        <p className="wfx-detail__meta" data-wfx-byom-key-hint>
          The key is stored encrypted and never shown again.
        </p>
      )}

      <button
        type="submit"
        className="wfx-btn wfx-btn--primary"
        data-wfx-byom-action="bind"
        disabled={pending}
      >
        Add your model provider
      </button>
    </form>
  );
}

/**
 * The BYOM management panel. Renders the R22-C `ByomManagementView`
 * (the typed binding summary + first-party context + per-task policies
 * truth) with the add form (the single primary action) and the per-entry
 * REMOVE action.
 */
export function ByomManagementPanel({
  view,
  authenticated,
}: {
  /** The server-rendered R22-C BYOM management view. */
  readonly view: ByomManagementView;
  /** Whether the session is authenticated (drives the form's availability). */
  readonly authenticated: boolean;
}): JSX.Element {
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<ByomFormFailure | null>(null);
  const [showAddForm, setShowAddForm] = useState<boolean>(false);

  const bind = useCallback(
    async (fields: { readonly providerId: string; readonly endpointUrl: string; readonly key: string }): Promise<void> => {
      // The shared R22-C pre-flight: the SAME rules the service enforces,
      // collected before the round trip (the convergence law).
      const problems = byomBindCommandProblems({
        providerId: fields.providerId,
        endpointUrl: fields.endpointUrl,
        key: fields.key,
      });
      if (problems.length > 0) {
        const recovery = byomManagementRecovery("bind", {
          kind: "invalid-input",
          detail: problems.map((p) => p.detail).join(" "),
        });
        setFailure({
          message: "Some fields need your attention.",
          recoveryLabel: recovery.label,
          recoveryKind: recovery.kind,
          fieldProblems: [...problems],
        });
        return;
      }
      setPending("bind");
      setFailure(null);
      try {
        const response = await fetch("/api/model/byom/bind", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            providerId: fields.providerId,
            endpointUrl: fields.endpointUrl,
            key: fields.key,
          }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: string;
            detail?: string;
            problems?: readonly ByomBindProblem[];
          } | null;
          setFailure(parseByomFailure("bind", response.status, body));
        } else {
          // The honest refresh: the page reloads to observe the new
          // binding through the runtime's refreshed provider registry.
          if (typeof window !== "undefined") window.location.reload();
        }
      } catch (thrown) {
        setFailure({
          message: thrown instanceof Error ? thrown.message : "the provider could not be added",
          recoveryLabel: "Try again",
          recoveryKind: "retry",
          fieldProblems: [],
        });
      } finally {
        setPending(null);
      }
    },
    [],
  );

  const unbind = useCallback(async (providerId: string): Promise<void> => {
    setPending(`unbind:${providerId}`);
    setFailure(null);
    try {
      const response = await fetch("/api/model/byom/unbind", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          detail?: string;
        } | null;
        setFailure(parseByomFailure("unbind", response.status, body));
      } else {
        // The honest refresh: the page reloads to observe the removal
        // through the runtime's refreshed provider registry.
        if (typeof window !== "undefined") window.location.reload();
      }
    } catch (thrown) {
      setFailure({
        message: thrown instanceof Error ? thrown.message : "the provider could not be removed",
        recoveryLabel: "Try again",
        recoveryKind: "retry",
        fieldProblems: [],
      });
    } finally {
      setPending(null);
    }
  }, []);

  return (
    <div
      className="wfx-byom-management"
      data-wfx-byom-management
      data-wfx-byom-authenticated={authenticated ? "true" : "false"}
    >
      <div className="wfx-row__header" data-wfx-byom-header>
        <h3 className="wfx-row__title">Your model providers</h3>
        <p className="wfx-row__reason" data-wfx-byom-intro>
          Bring your own model: paste your provider&apos;s web address and key — the key is stored
          encrypted and never shown again. The contextual AI tray (on every title and player) is
          where you USE AI; this is where you MANAGE which providers WebFlix may use.
        </p>
      </div>

      {/* The single primary action — the F8 management entry point. */}
      <button
        type="button"
        className="wfx-btn wfx-btn--primary"
        data-wfx-byom-action="add"
        disabled={pending !== null || !authenticated}
        onClick={() => {
          setShowAddForm((current) => !current);
        }}
        {...(!authenticated ? { title: "Sign in to add a model provider" } : {})}
      >
        {showAddForm ? "Cancel" : view.addAction.label}
      </button>

      {!authenticated ? (
        <p className="wfx-row__reason" data-wfx-byom-anonymous-note>
          Model providers belong to your account — sign in or create one to add your own provider.
        </p>
      ) : null}

      {showAddForm && authenticated ? (
        <AddProviderForm
          pending={pending !== null}
          failure={failure}
          onSubmit={(fields) => {
            void bind(fields);
          }}
        />
      ) : null}

      {failure !== null ? (
        <div className="wfx-session-form__failure" data-wfx-byom-action-error role="alert">
          <p className="wfx-detail__meta" data-wfx-byom-failure-message>
            {failure.message}
          </p>
          {failure.recoveryKind === "sign-in-again" ? (
            <a
              className="wfx-btn wfx-btn--sm"
              href="/settings?section=general"
              data-wfx-byom-recovery="sign-in-again"
            >
              {failure.recoveryLabel}
            </a>
          ) : failure.recoveryKind === "refresh-list" ? (
            <button
              type="button"
              className="wfx-btn wfx-btn--sm"
              data-wfx-byom-recovery="refresh-list"
              disabled={pending !== null}
              onClick={() => {
                if (typeof window !== "undefined") window.location.reload();
              }}
            >
              {failure.recoveryLabel}
            </button>
          ) : (
            <button
              type="button"
              className="wfx-btn wfx-btn--sm"
              data-wfx-byom-recovery={failure.recoveryKind}
              disabled={pending !== null}
              onClick={() => {
                setFailure(null);
              }}
            >
              {failure.recoveryLabel}
            </button>
          )}
        </div>
      ) : null}

      {/* The bound providers (the binding summary — secret-free by construction). */}
      {view.bound.length > 0 ? (
        <div className="wfx-detail__section" data-wfx-byom-bound-section>
          <h4>Added by you</h4>
          <ul className="wfx-queue__list" style={{ listStyle: "none", padding: 0 }} data-wfx-byom-bound-list>
            {view.bound.map((entry) => (
              <ProviderEntryRow
                key={entry.providerId}
                entry={entry}
                pending={pending !== null}
                onRemove={(providerId) => {
                  void unbind(providerId);
                }}
              />
            ))}
          </ul>
        </div>
      ) : view.emptyDetail !== null ? (
        <p className="wfx-row__reason" data-wfx-byom-empty>
          {view.emptyDetail}
        </p>
      ) : null}

      {/* The first-party providers (the local-model context — unsupported is not undiscoverable). */}
      {view.firstParty.length > 0 ? (
        <div className="wfx-detail__section" data-wfx-byom-first-party-section>
          <h4>Built-in models</h4>
          <ul
            className="wfx-queue__list"
            style={{ listStyle: "none", padding: 0 }}
            data-wfx-byom-first-party-list
          >
            {view.firstParty.map((entry) => (
              <ProviderEntryRow
                key={entry.providerId}
                entry={entry}
                pending={pending !== null}
                onRemove={() => {
                  /* First-party rows are managed by the product, not the user. */
                }}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
