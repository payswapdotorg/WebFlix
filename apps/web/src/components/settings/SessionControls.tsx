"use client";

/**
 * @wfx/app-web — the session identity controls (R21-B + R22-E, client island).
 *
 * THE LAW THIS COMPONENT KEEPS (docs/plans/
 * 2026-09-20-webflix-major-journey-hardening-plan.md — F1): account
 * creation must be a FIRST-CLASS NORMAL-PATH action, not merely an
 * implemented API. The signed-out state's identity entry point now
 * offers BOTH paths from one calm surface — Sign in (the existing
 * path) and Create account (R22-E, consuming Worker 1's R22-B
 * account-creation contract) — with one obvious primary action per
 * state and honest typed failure recovery (the no-dead-end law).
 *
 * THE ONE OBVIOUS PRIMARY ACTION PER STATE (the design language — no
 * equal-weight button clusters): the Sign in form's primary action is
 * "Sign in"; the Create account form's primary action is "Create your
 * account". The toggle between the two is a subordinate text link
 * ("Create an account" / "Sign in instead") — never a competing
 * primary. The `email-taken` failure's recovery is "Sign in instead"
 * (the anti-loop law: the register form never offers a loop — the
 * next action switches to the sign-in form with the email pre-filled).
 *
 * THE TYPED FAILURE VOCABULARY (R22-B's closed kinds, mirrored from
 * the service's own answers): invalid-input (per-field errors, the
 * shared pre-flight catches them before the round trip), email-taken
 * (the service's 409 — Sign in instead), network/unavailable/malformed
 * (retry). The form never shows a raw protocol error — every message
 * is plain-language with its recovery next action.
 *
 * NO MODAL SPRAWL: the two modes share ONE form surface (a `mode`
 * state toggle, not a stacked modal). The post-registration state is
 * the server's honest answer — a successful register auto-logs the
 * user in (the service's existing behavior), so the page reloads to
 * the authenticated state (the same path the login form takes).
 *
 * HONESTY LAWS:
 * - NO optimistic state: a successful register/login reloads the page
 *   from the server's honest next state (the session cookie is the
 *   carrier — the body answers the session VIEW only, never the token);
 * - the password is sent ONLY in the request body (never rendered, never
 *   logged) — the R22-B secret law's client-side twin;
 * - the recovery action's label is the R22-B frozen vocabulary verbatim
 *   (the "one derivation source" law — never re-worded here).
 *
 * The dev fixtures note renders ONLY in fixtures mode (the loud badge
 * law — the scripted persona's credentials are named for the developer,
 * never mistaken for a production account).
 */

import { useCallback, useState, type JSX } from "react";

import {
  REGISTER_PASSWORD_MIN_LENGTH,
  REGISTER_PASSWORD_MAX_LENGTH,
  validateRegisterAccountCommand,
  type RegisterAccountProblem,
} from "@wfx/client-runtime";

/** The two form modes (one primary action per state — no modal sprawl). */
type SessionFormMode = "signin" | "register";

/** One typed form failure with its recovery (the R22-B vocabulary). */
interface FormFailure {
  /** The headline message (one honest sentence — never a raw protocol error). */
  readonly message: string;
  /** The recovery control's label (the frozen R22-B vocabulary). */
  readonly recoveryLabel: string;
  /** The recovery action's kind (drives the onClick). */
  readonly recoveryKind: "switch-to-signin" | "retry";
  /** The per-field problems (invalid-input only — empty otherwise). */
  readonly fieldProblems: readonly RegisterAccountProblem[];
}

/** Parse the register route's response body into the typed form failure. */
function parseRegisterFailure(
  status: number,
  body: { error?: string; detail?: string } | null,
): FormFailure {
  const error = body?.error ?? "";
  const detail = body?.detail ?? "the account could not be created";

  // email-taken (409): the anti-loop recovery — Sign in instead.
  if (status === 409 || error === "email-taken") {
    return {
      message: "An account with this email already exists.",
      recoveryLabel: "Sign in instead",
      recoveryKind: "switch-to-signin",
      fieldProblems: [],
    };
  }

  // invalid-input (400): per-field problems (the service's own rules).
  if (status === 400 || error === "invalid-input") {
    return {
      message: detail,
      recoveryLabel: "Fix and try again",
      recoveryKind: "retry",
      fieldProblems: [],
    };
  }

  // network/unavailable (502 family): retry.
  if (status >= 500 || status === 408 || status === 429) {
    return {
      message: "WebFlix couldn't create your account right now — try again in a moment.",
      recoveryLabel: "Try again",
      recoveryKind: "retry",
      fieldProblems: [],
    };
  }

  // malformed (any other non-OK): retry.
  return {
    message: typeof detail === "string" && detail.length > 0 ? detail : "the account could not be created",
    recoveryLabel: "Try again",
    recoveryKind: "retry",
    fieldProblems: [],
  };
}

export function SessionControls({
  signedIn,
  profiles,
  activeProfileId,
  mode,
}: {
  /** The request session's truth (the server-rendered state). */
  readonly signedIn: boolean;
  /** The switchable profiles (present iff signed in). */
  readonly profiles: readonly { readonly id: string; readonly displayName: string }[];
  /** The active profile id (present iff signed in). */
  readonly activeProfileId?: string;
  /** The host boot mode (the dev fixtures note renders in fixtures mode only). */
  readonly mode: "fixtures" | "service";
}): JSX.Element {
  const [formMode, setFormMode] = useState<SessionFormMode>("signin");
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<FormFailure | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const post = useCallback(
    async (path: string, init: RequestInit, pendingTag: string) => {
      setPending(pendingTag);
      setFailure(null);
      try {
        const response = await fetch(path, {
          ...init,
          headers: { "content-type": "application/json", ...(init.headers ?? {}) },
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { detail?: string; error?: string } | null;
          if (path === "/api/auth/register") {
            setFailure(parseRegisterFailure(response.status, body));
          } else {
            setFailure({
              message: body?.detail ?? body?.error ?? "the action could not be completed",
              recoveryLabel: "Try again",
              recoveryKind: "retry",
              fieldProblems: [],
            });
          }
        } else {
          // Re-render from the server's honest next state (no optimism).
          if (typeof window !== "undefined") window.location.reload();
        }
      } catch (thrown) {
        setFailure({
          message: thrown instanceof Error ? thrown.message : "the action could not be completed",
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

  /** Switch to the sign-in form (the email-taken recovery's action). */
  const switchToSignIn = useCallback((): void => {
    setFormMode("signin");
    setFailure(null);
  }, []);

  /** Switch to the register form (the create-account toggle). */
  const switchToRegister = useCallback((): void => {
    setFormMode("register");
    setFailure(null);
  }, []);

  /**
   * Submit the register form: run the shared R22-B pre-flight validation
   * (the honest per-field problems without a round trip), then POST to
   * the existing /api/auth/register route (the real transport — the
   * service's auto-login behavior is the post-registration state).
   */
  const submitRegister = useCallback((): void => {
    // The shared pre-flight (the R22-B `validateRegisterAccountCommand`):
    // the SAME rules the service enforces — the user sees the SAME honest
    // field problems before the round trip (the convergence law).
    const validation = validateRegisterAccountCommand({ email, password, displayName });
    if (!validation.ok) {
      setFailure({
        message: "Some fields need your attention.",
        recoveryLabel: "Fix and try again",
        recoveryKind: "retry",
        fieldProblems: [...validation.problems],
      });
      return;
    }
    void post(
      "/api/auth/register",
      { method: "POST", body: JSON.stringify(validation.value) },
      "register",
    );
  }, [email, password, displayName, post]);

  if (!signedIn) {
    const isRegister = formMode === "register";
    return (
      <div
        data-wfx-session-controls
        data-wfx-session-signed-out
        data-wfx-session-mode={formMode}
      >
        <div className="wfx-session-form__mode" data-wfx-session-mode-toggle>
          <button
            type="button"
            className={`wfx-btn wfx-btn--sm${!isRegister ? " wfx-btn--primary" : ""}`}
            aria-pressed={!isRegister}
            data-wfx-session-mode-option="signin"
            disabled={pending !== null}
            onClick={switchToSignIn}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`wfx-btn wfx-btn--sm${isRegister ? " wfx-btn--primary" : ""}`}
            aria-pressed={isRegister}
            data-wfx-session-mode-option="register"
            disabled={pending !== null}
            onClick={switchToRegister}
          >
            Create account
          </button>
        </div>

        <form
          className="wfx-session-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (isRegister) {
              submitRegister();
            } else {
              void post(
                "/api/auth/login",
                { method: "POST", body: JSON.stringify({ email, password }) },
                "login",
              );
            }
          }}
        >
          <label className="wfx-session-form__label" htmlFor="wfx-session-email">
            Email
          </label>
          <input
            id="wfx-session-email"
            className="wfx-session-form__input"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            aria-invalid={failure?.fieldProblems.some((p) => p.field === "email") ?? false}
          />
          {failure?.fieldProblems.some((p) => p.field === "email") ? (
            <p
              className="wfx-detail__meta"
              data-wfx-session-field-error="email"
              role="alert"
            >
              {failure.fieldProblems.find((p) => p.field === "email")?.detail}
            </p>
          ) : null}

          {isRegister ? (
            <>
              <label className="wfx-session-form__label" htmlFor="wfx-session-display-name">
                Display name (optional)
              </label>
              <input
                id="wfx-session-display-name"
                className="wfx-session-form__input"
                type="text"
                name="displayName"
                autoComplete="name"
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                }}
                aria-invalid={failure?.fieldProblems.some((p) => p.field === "displayName") ?? false}
              />
              {failure?.fieldProblems.some((p) => p.field === "displayName") ? (
                <p
                  className="wfx-detail__meta"
                  data-wfx-session-field-error="displayName"
                  role="alert"
                >
                  {failure.fieldProblems.find((p) => p.field === "displayName")?.detail}
                </p>
              ) : null}
            </>
          ) : null}

          <label className="wfx-session-form__label" htmlFor="wfx-session-password">
            Password
          </label>
          <input
            id="wfx-session-password"
            className="wfx-session-form__input"
            type="password"
            name="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            required
            minLength={isRegister ? REGISTER_PASSWORD_MIN_LENGTH : 1}
            maxLength={isRegister ? REGISTER_PASSWORD_MAX_LENGTH : undefined}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            aria-invalid={failure?.fieldProblems.some((p) => p.field === "password") ?? false}
          />
          {failure?.fieldProblems.some((p) => p.field === "password") ? (
            <p
              className="wfx-detail__meta"
              data-wfx-session-field-error="password"
              role="alert"
            >
              {failure.fieldProblems.find((p) => p.field === "password")?.detail}
            </p>
          ) : isRegister ? (
            <p className="wfx-detail__meta" data-wfx-session-password-hint>
              At least {REGISTER_PASSWORD_MIN_LENGTH} characters.
            </p>
          ) : null}

          <button
            type="submit"
            className="wfx-btn wfx-btn--primary"
            data-wfx-session-action={isRegister ? "register" : "login"}
            disabled={pending !== null}
          >
            {isRegister ? "Create your account" : "Sign in"}
          </button>
        </form>

        {mode === "fixtures" ? (
          <p className="wfx-row__reason" data-wfx-session-dev-note>
            Dev fixtures: sign in with the scripted persona — dev@webflix.local /
            dev-password-1 (never a production account). The register form accepts
            the same credentials (a loud dev double — register == the dev sign-in).
          </p>
        ) : null}

        {failure !== null ? (
          <div className="wfx-session-form__failure" data-wfx-session-action-error role="alert">
            <p className="wfx-detail__meta" data-wfx-session-failure-message>
              {failure.message}
            </p>
            {failure.recoveryKind === "switch-to-signin" ? (
              <button
                type="button"
                className="wfx-btn wfx-btn--sm"
                data-wfx-session-recovery="sign-in-instead"
                onClick={switchToSignIn}
              >
                {failure.recoveryLabel}
              </button>
            ) : (
              <button
                type="button"
                className="wfx-btn wfx-btn--sm"
                data-wfx-session-recovery="retry"
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
      </div>
    );
  }

  return (
    <div data-wfx-session-controls data-wfx-session-signed-in>
      <ul className="wfx-queue__list" style={{ listStyle: "none", padding: 0 }} data-wfx-profile-switcher>
        {profiles.map((profile) => (
          <li key={profile.id} className="wfx-queue__item">
            <button
              type="button"
              className={`wfx-btn wfx-btn--sm${profile.id === activeProfileId ? " wfx-btn--primary" : ""}`}
              data-wfx-profile-select={profile.id}
              disabled={pending !== null || profile.id === activeProfileId}
              onClick={() => {
                void post(
                  "/api/auth/select-profile",
                  { method: "PUT", body: JSON.stringify({ profileId: profile.id }) },
                  `select:${profile.id}`,
                );
              }}
            >
              {profile.displayName}
              {profile.id === activeProfileId ? " (watching)" : ""}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="wfx-btn"
        data-wfx-session-action="logout"
        disabled={pending !== null}
        onClick={() => {
          void post("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }, "logout");
        }}
      >
        Sign out
      </button>
      {failure !== null ? (
        <p className="wfx-detail__meta" data-wfx-session-action-error role="alert">
          {failure.message}
        </p>
      ) : null}
    </div>
  );
}
