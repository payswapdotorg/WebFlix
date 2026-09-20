/**
 * @wfx/app-desktop — the Desktop account session store (R22-H).
 *
 * THE ADAPTER'S PLATFORM STORAGE LAW for the one-time session token the
 * R22-B account-creation contract issues: the OS credential store (the
 * shell's auth-store area — macOS Keychain / Windows Credential Manager /
 * the Linux Secret Service), NEVER plaintext adapter files. This module
 * owns the stored payload's SHAPE and every transition of the Desktop's
 * session truth:
 *
 * - `store(issued)` — the adapter's post-issuance step (the R22-B law:
 *   the token passes to the caller ONCE; the model never retains it).
 *   The token + the secret-free account view serialize into ONE opaque
 *   payload the shell carries verbatim; `savedAt` stamps the freshness.
 * - `restore()` — the boot continuity probe: the stored entry (when the
 *   keychain has one) is validated structurally (the payload guard
 *   rejects garbage AND any view carrying secret material) and answered
 *   as the typed `signed-in` state; a corrupt entry is the typed
 *   `corrupt` failure (the adapter's recovery: sign in again — the
 *   surface carries that next action, never a dead end).
 * - `clear()` — the sign-out step (idempotent).
 * - `support()` — the honest keychain capability truth. A platform with
 *   no credential service answers `unsupported` with its typed recovery:
 *   sign-in still works, but the session cannot persist across restarts
 *   — surfaced honestly, NEVER a silent downgrade to plaintext storage.
 *
 * The stored payload shape (adapter-owned; the shell treats it as
 * opaque bytes):
 *
 * ```json
 * { "token": "wfxsess_…", "session": { "user": …, "profiles": …, "activeProfileId": … } }
 * ```
 *
 * The token rides the keychain (the secret); the session view is the
 * secret-free projection the surfaces render (the R22-B structural
 * guard applies at THIS boundary too — a payload smuggling password or
 * key material is rejected, never restored as identity data).
 *
 * Determinism: no clock of its own (the caller stamps `savedAt`); no
 * fetching (the `/auth/me` continuity refresh belongs to the first-run
 * surface over the transport).
 */

import type {
  AccountSessionView,
  IssuedAccountSession,
} from "@wfx/client-runtime";
import { isUsableAccountSessionView } from "@wfx/client-runtime";
import { isRecord } from "@wfx/domain";

import { isShellIpcError, type ShellAuthStoreSupport, type ShellIpc } from "./shell-ipc";

// ---------------------------------------------------------------------------
// The typed failures + outcomes
// ---------------------------------------------------------------------------

/** The closed session-store failure vocabulary. */
export type DesktopAuthSessionStoreFailureKind =
  /** The platform has no OS credential service (the typed capability truth). */
  | "unsupported"
  /** The stored entry could not be read or is not the stored-payload shape. */
  | "corrupt"
  /** The credential service refused the write. */
  | "write-failed";

/** One typed session-store failure with its honest recovery next step. */
export interface DesktopAuthSessionStoreFailure {
  readonly kind: DesktopAuthSessionStoreFailureKind;
  readonly detail: string;
  /**
   * The typed recovery next action (never a dead end):
   * `unsupported` ⇒ the session won't persist (sign-in still works);
   * `corrupt` ⇒ sign in again; `write-failed` ⇒ try signing in again.
   */
  readonly recovery: {
    readonly kind: "session-will-not-persist" | "sign-in-again" | "retry-sign-in";
    readonly label: string;
    readonly detail: string;
  };
}

/** The session state the store answers. */
export type DesktopAuthSessionState =
  | { readonly state: "anonymous" }
  | {
      readonly state: "signed-in";
      readonly token: string;
      readonly session: AccountSessionView;
      readonly savedAt: string;
    };

/** The outcome of one session-store operation. */
export type DesktopAuthSessionStoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: DesktopAuthSessionStoreFailure };

/** The keychain capability truth + its honest consequence. */
export interface DesktopAuthStoreCapability {
  /** The shell's own support answer, verbatim. */
  readonly support: ShellAuthStoreSupport;
  /** The typed consequence the surface renders. */
  readonly consequence:
    | { readonly kind: "persists" }
    | {
        readonly kind: "will-not-persist";
        readonly label: string;
        readonly detail: string;
      };
}

// ---------------------------------------------------------------------------
// The payload shape (adapter-owned; structurally validated on restore)
// ---------------------------------------------------------------------------

/** The serialized session payload: the token + the secret-free view. */
interface StoredSessionPayload {
  readonly token: string;
  readonly session: AccountSessionView;
}

function isStoredPayload(value: unknown): value is StoredSessionPayload {
  if (!isRecord(value)) return false;
  if (typeof value.token !== "string" || value.token.length === 0) return false;
  if (!isUsableAccountSessionView(value.session)) return false;
  // The payload must not carry anything BEYOND the token + the view (a
  // smuggled extra field is a shape drift — rejected, never guessed at).
  const keys = Object.keys(value).sort();
  return keys.length === 2 && keys[0] === "session" && keys[1] === "token";
}

function recoveryOf(
  kind: DesktopAuthSessionStoreFailureKind,
): DesktopAuthSessionStoreFailure["recovery"] {
  switch (kind) {
    case "unsupported":
      return {
        kind: "session-will-not-persist",
        label: "Continue without saving the session",
        detail:
          "This device has no OS credential store for the session secret — you can sign in, but you'll sign in again after each restart.",
      };
    case "corrupt":
      return {
        kind: "sign-in-again",
        label: "Sign in again",
        detail:
          "The saved sign-in could not be read back from this device's credential store — sign in again to continue.",
      };
    case "write-failed":
      return {
        kind: "retry-sign-in",
        label: "Try signing in again",
        detail:
          "The credential store refused to save the session — nothing was saved; you can try signing in again.",
      };
  }
}

function failureOf(
  kind: DesktopAuthSessionStoreFailureKind,
  detail: string,
): DesktopAuthSessionStoreFailure {
  return { kind, detail, recovery: recoveryOf(kind) };
}

function mapShellFailure(
  thrown: unknown,
  fallback: string,
): DesktopAuthSessionStoreFailure {
  if (isShellIpcError(thrown)) {
    if (thrown.code === "unavailable") {
      return failureOf("unsupported", thrown.detail);
    }
    if (thrown.code === "corrupt") {
      return failureOf("corrupt", thrown.detail);
    }
    return failureOf("write-failed", `${fallback}: ${thrown.detail}`);
  }
  const detail = thrown instanceof Error ? thrown.message : String(thrown);
  return failureOf("write-failed", `${fallback}: ${detail}`);
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** Options for {@link createShellAuthSessionStore}. */
export interface DesktopAuthSessionStoreOptions {
  /** The live native shell IPC binding (the keychain area's owner). */
  readonly shell: ShellIpc;
  /**
   * The clock stamp for `savedAt` (ISO instant). The adapter's session
   * clock — the same seam the composition root's clock feeds.
   */
  readonly now: () => string;
}

/**
 * The Desktop account session store over the shell's OS-keychain area.
 * Created by the composition root; every operation is a typed round trip
 * (no caching — the keychain IS the persistence).
 */
export interface DesktopAuthSessionStore {
  /** The honest keychain capability truth + its typed consequence. */
  support(): Promise<DesktopAuthStoreCapability>;
  /** The current session state (the boot/refresh probe). */
  restore(): Promise<DesktopAuthSessionStoreResult<DesktopAuthSessionState>>;
  /** Store one issued session (REPLACES any prior entry). */
  store(issued: IssuedAccountSession): Promise<DesktopAuthSessionStoreResult<void>>;
  /** Clear the stored session (the sign-out step; idempotent). */
  clear(): Promise<DesktopAuthSessionStoreResult<void>>;
}

/**
 * Create the Desktop session store over the shell's keychain area. The
 * payload shape is validated on BOTH ends (store rejects a non-usable
 * view; restore rejects a non-payload shape) — the secret law and the
 * no-fabricated-identity law both hold at this boundary.
 */
export function createShellAuthSessionStore(
  options: DesktopAuthSessionStoreOptions,
): DesktopAuthSessionStore {
  const { shell, now } = options;

  return {
    async support(): Promise<DesktopAuthStoreCapability> {
      const support = await shell.authStoreSupport();
      if (support.available) {
        return { support, consequence: { kind: "persists" } };
      }
      return {
        support,
        consequence: {
          kind: "will-not-persist",
          label: "Sign-in won't be remembered on this device",
          detail: support.detail,
        },
      };
    },

    async restore(): Promise<DesktopAuthSessionStoreResult<DesktopAuthSessionState>> {
      let entry: { payload: string; savedAt: string } | null;
      try {
        entry = await shell.authStoreGet();
      } catch (thrown) {
        return { ok: false, failure: mapShellFailure(thrown, "authStoreGet") };
      }
      if (entry === null) return { ok: true, value: { state: "anonymous" } };
      if (typeof entry.savedAt !== "string" || entry.savedAt.length === 0) {
        return {
          ok: false,
          failure: failureOf("corrupt", "the stored entry carries no savedAt instant"),
        };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(entry.payload);
      } catch {
        return {
          ok: false,
          failure: failureOf("corrupt", "the stored payload is not the session-payload shape"),
        };
      }
      if (!isStoredPayload(parsed)) {
        return {
          ok: false,
          failure: failureOf(
            "corrupt",
            "the stored payload failed the session-payload guard (the structural secret law)",
          ),
        };
      }
      return {
        ok: true,
        value: {
          state: "signed-in",
          token: parsed.token,
          session: parsed.session,
          savedAt: entry.savedAt,
        },
      };
    },

    async store(issued): Promise<DesktopAuthSessionStoreResult<void>> {
      if (!isUsableAccountSessionView(issued.session)) {
        return {
          ok: false,
          failure: failureOf(
            "corrupt",
            "the issued session view failed the structural guard (the secret law at this boundary)",
          ),
        };
      }
      const payload: StoredSessionPayload = { token: issued.token, session: issued.session };
      try {
        await shell.authStoreSet({ payload: JSON.stringify(payload), savedAt: now() });
      } catch (thrown) {
        return { ok: false, failure: mapShellFailure(thrown, "authStoreSet") };
      }
      return { ok: true, value: undefined };
    },

    async clear(): Promise<DesktopAuthSessionStoreResult<void>> {
      try {
        await shell.authStoreClear();
      } catch (thrown) {
        return { ok: false, failure: mapShellFailure(thrown, "authStoreClear") };
      }
      return { ok: true, value: undefined };
    },
  };
}
