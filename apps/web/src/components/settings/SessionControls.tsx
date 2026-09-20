"use client";

/**
 * @wfx/app-web — the session identity controls (R21-B, client island).
 *
 * The REAL profile/session write path's controls: the sign-in form (the
 * signed-out state's one clear primary action), the profile switcher
 * (the signed-in state), and the sign-out action. Every action posts to
 * the typed `/api/auth/*` routes; NO optimistic state changes — the
 * honest answer is the server's (the page re-renders from the request
 * session's truth; a failure answers the typed message verbatim, never
 * a fake success).
 *
 * The dev fixtures note renders ONLY in fixtures mode (the loud badge
 * law — the scripted persona's credentials are named for the developer,
 * never mistaken for a production account).
 */

import { useCallback, useState, type JSX } from "react";

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
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

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
          setFailure(body?.detail ?? body?.error ?? "the action could not be completed");
        } else {
          // Re-render from the server's honest next state (no optimism).
          if (typeof window !== "undefined") window.location.reload();
        }
      } catch (thrown) {
        setFailure(thrown instanceof Error ? thrown.message : "the action could not be completed");
      } finally {
        setPending(null);
      }
    },
    [],
  );

  if (!signedIn) {
    return (
      <div data-wfx-session-controls data-wfx-session-signed-out>
        <form
          className="wfx-session-form"
          onSubmit={(event) => {
            event.preventDefault();
            void post(
              "/api/auth/login",
              { method: "POST", body: JSON.stringify({ email, password }) },
              "login",
            );
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
          />
          <label className="wfx-session-form__label" htmlFor="wfx-session-password">
            Password
          </label>
          <input
            id="wfx-session-password"
            className="wfx-session-form__input"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            minLength={1}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
          <button
            type="submit"
            className="wfx-btn wfx-btn--primary"
            data-wfx-session-action="login"
            disabled={pending !== null}
          >
            Sign in
          </button>
        </form>
        {mode === "fixtures" ? (
          <p className="wfx-row__reason" data-wfx-session-dev-note>
            Dev fixtures: sign in with the scripted persona — dev@webflix.local /
            dev-password-1 (never a production account).
          </p>
        ) : null}
        {failure !== null ? (
          <p className="wfx-detail__meta" data-wfx-session-action-error role="alert">
            {failure}
          </p>
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
          {failure}
        </p>
      ) : null}
    </div>
  );
}
