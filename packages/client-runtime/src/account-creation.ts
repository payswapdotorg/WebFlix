/**
 * @wfx/client-runtime — the account-creation journey contract (R22-B).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-major-journey-hardening-plan.md — F1): account
 * creation must be a FIRST-CLASS NORMAL-PATH action, not merely an
 * implemented API. The real transport already exists — the Experience
 * API's `POST /auth/register` (auto-login: the first `wfxsess_` session
 * token is minted and answered EXACTLY ONCE; the account's default
 * profile is created eagerly) and the Web adapter's `authRegister`
 * client. This module promotes that EXISTING transport into a SHARED
 * product flow — the typed register command, the shared validation
 * (mirroring the service's own rules, so Web/Desktop render identical
 * honest failures), the typed failure vocabulary with recovery next
 * actions, and the journey read model — WITHOUT inventing a second
 * authentication system:
 *
 * - the RUNTIME owns the journey CONTRACT only: the command shape, the
 *   validation, the failure/next-action vocabulary, and the state
 *   machine. It never fetches, never stores sessions, never mints
 *   tokens — the ADAPTER binds its EXISTING transport to
 *   {@link AccountRegistrationPort} (Web: `authRegister` over
 *   `POST /auth/register`; Desktop: the same endpoint through its own
 *   transport — the platform rule).
 * - AUTO-LOGIN/SESSION CONTINUITY is the SERVICE's existing behavior:
 *   a successful register answers an ALREADY-SIGNED-IN session. The
 *   one-time token passes through {@link IssuedAccountSession} to the
 *   caller ONCE; the adapter stores it per its platform storage law
 *   (Web: the httpOnly session cookie; Desktop: the OS keychain) and
 *   rebinds its session/runtime to the account. The journey MODEL never
 *   retains the token (the secret law — machine-tested).
 * - PROFILE SELECTION REMAINS DOWNSTREAM: the created model carries the
 *   account's profiles + the active profile id and names
 *   `choose-profile` as the next action — the adapter's EXISTING
 *   profile-selection flow (the session machinery / `PUT /profiles/:id/
 *   select` transport) owns that step. This contract adds no profile
 *   operations.
 * - NO SECRET EXPOSURE: the password lives only in the command (its way
 *   IN, over the adapter's transport); the token lives only in the
 *   one-time issuance (its way OUT, to the adapter's storage). The
 *   read model is structurally secret-free —
 *   {@link assertAccountCreationModelSecretFree} is the machine check.
 *
 * THE HONEST FAILURE STATES (closed vocabulary, each with its recovery
 * next action — never a dead end):
 * - `invalid-input`  — the command failed validation (client pre-flight
 *   OR the service's 400). Recovery: fix the named fields and retry.
 * - `email-taken`    — the service's 409: an account with this email
 *   exists. Recovery: SIGN IN INSTEAD (the typed next action — the
 *   register form must not offer a loop).
 * - `network`        — the transport did not complete. Recovery: retry.
 * - `unavailable`    — the service cannot serve now (5xx/408/429).
 *   Recovery: retry in a moment.
 * - `malformed`      — the service answered a non-usable payload.
 *   Recovery: retry (the journey never fabricates a session).
 *
 * Validation mirrors the SERVICE's own rules exactly (no invented
 * client-side policy): email `^[^\s@]+@[^\s@]+\.[^\s@]+$` ≤ 254 chars
 * (normalized: trimmed + lowercased), password 10–1000 chars (the scrypt
 * policy + DoS guard), displayName optional non-empty ≤ 128 chars
 * (normalized: trimmed). The service re-validates — the shared
 * pre-flight exists so the user sees the SAME honest field problems
 * before the round trip.
 *
 * Determinism: pure validation + a thin state machine over the injected
 * port — no clock, no ids, no fetching.
 */

import { isIso8601, isRecord } from "@wfx/domain";

import { RuntimeError } from "./errors";

// ---------------------------------------------------------------------------
// The typed register command + the shared validation (mirrors the service)
// ---------------------------------------------------------------------------

/** The account-creation command (the wire shape `POST /auth/register` takes). */
export interface RegisterAccountCommand {
  readonly email: string;
  readonly password: string;
  readonly displayName?: string;
}

/** The service's own validation bounds (mirrored — never invented policy). */
export const REGISTER_EMAIL_MAX_LENGTH = 254; // RFC 5321 practical bound
export const REGISTER_PASSWORD_MIN_LENGTH = 10; // the scrypt policy
export const REGISTER_PASSWORD_MAX_LENGTH = 1_000; // the scrypt DoS guard
export const REGISTER_DISPLAY_NAME_MAX_LENGTH = 128; // the route's bound

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The form fields a validation problem can name (typed for per-field errors). */
export type RegisterAccountField = "email" | "password" | "displayName";

/** One typed validation problem (the honest per-field error the form renders). */
export interface RegisterAccountProblem {
  readonly field: RegisterAccountField;
  /** One honest sentence naming the rule the field broke. */
  readonly detail: string;
}

/** The normalized, ready-to-send command (the service's own normalization). */
export type NormalizedRegisterAccountCommand = RegisterAccountCommand;

/** The validation answer: the normalized command or every problem found. */
export type RegisterAccountValidation =
  | { readonly ok: true; readonly value: NormalizedRegisterAccountCommand }
  | { readonly ok: false; readonly problems: readonly RegisterAccountProblem[] };

/**
 * Validate + normalize one register command (PURE; mirrors the service's
 * `parseRegisterBody` rules exactly — email trimmed + lowercased,
 * displayName trimmed, every problem collected, never one at a time).
 */
export function validateRegisterAccountCommand(
  command: RegisterAccountCommand,
): RegisterAccountValidation {
  const problems: RegisterAccountProblem[] = [];
  const email = typeof command?.email === "string" ? command.email : "";
  if (!EMAIL_RE.test(email.trim().toLowerCase())) {
    problems.push({ field: "email", detail: "Enter a valid email address." });
  } else if (email.trim().length > REGISTER_EMAIL_MAX_LENGTH) {
    problems.push({
      field: "email",
      detail: `Email must be at most ${REGISTER_EMAIL_MAX_LENGTH} characters.`,
    });
  }
  const password = typeof command?.password === "string" ? command.password : "";
  if (
    password.length < REGISTER_PASSWORD_MIN_LENGTH ||
    password.length > REGISTER_PASSWORD_MAX_LENGTH
  ) {
    problems.push({
      field: "password",
      detail: `Password must be between ${REGISTER_PASSWORD_MIN_LENGTH} and ${REGISTER_PASSWORD_MAX_LENGTH} characters.`,
    });
  }
  const rawDisplayName =
    command?.displayName !== undefined && typeof command.displayName === "string"
      ? command.displayName
      : undefined;
  if (rawDisplayName !== undefined) {
    if (rawDisplayName.trim().length === 0) {
      problems.push({
        field: "displayName",
        detail: "Display name, when provided, cannot be blank.",
      });
    } else if (rawDisplayName.trim().length > REGISTER_DISPLAY_NAME_MAX_LENGTH) {
      problems.push({
        field: "displayName",
        detail: `Display name must be at most ${REGISTER_DISPLAY_NAME_MAX_LENGTH} characters.`,
      });
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      email: email.trim().toLowerCase(),
      password,
      ...(rawDisplayName !== undefined && rawDisplayName.trim().length > 0
        ? { displayName: rawDisplayName.trim() }
        : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// The typed failure vocabulary (each with its recovery next action)
// ---------------------------------------------------------------------------

/** The closed account-creation failure vocabulary. */
export type AccountCreationFailureKind =
  /** The command failed validation (client pre-flight or the service's 400). */
  | "invalid-input"
  /** The service's 409: an account with this email already exists. */
  | "email-taken"
  /** The transport did not complete (offline, DNS, timeout). */
  | "network"
  /** The service cannot serve right now (5xx/408/429). */
  | "unavailable"
  /** The service answered a non-usable payload — never a fabricated session. */
  | "malformed";

/** Every value of {@link AccountCreationFailureKind}, in vocabulary order. */
export const ACCOUNT_CREATION_FAILURE_KINDS: readonly AccountCreationFailureKind[] = [
  "invalid-input",
  "email-taken",
  "network",
  "unavailable",
  "malformed",
] as const;

/** Runtime membership check against the failure union. */
export function isAccountCreationFailureKind(
  x: unknown,
): x is AccountCreationFailureKind {
  return (
    typeof x === "string" &&
    (ACCOUNT_CREATION_FAILURE_KINDS as readonly string[]).includes(x)
  );
}

/**
 * The typed recovery next action of a failure — every important failure
 * has one (the J36 law); the register form renders it as the affordance.
 */
export interface AccountCreationRecovery {
  readonly kind: AccountCreationNextActionKind;
  /** The recovery control's label (user vocabulary). */
  readonly label: string;
  /** One honest sentence naming the next step. */
  readonly detail: string;
}

/** One typed account-creation failure + its recovery. */
export interface AccountCreationFailure {
  readonly kind: AccountCreationFailureKind;
  /** Non-empty human-readable detail (what exactly failed). */
  readonly detail: string;
  /** The recovery next action (never absent — never a dead end). */
  readonly recovery: AccountCreationRecovery;
}

/**
 * The frozen recovery mapping (the one derivation source — the register
 * form renders THESE words): `email-taken` answers SIGN IN INSTEAD (the
 * honest anti-loop law), transport failures answer RETRY, and validation
 * answers FIX-AND-RETRY.
 */
export function accountCreationFailure(
  kind: AccountCreationFailureKind,
  detail: string,
): AccountCreationFailure {
  const recovery: AccountCreationRecovery = (() => {
    switch (kind) {
      case "invalid-input":
        return {
          kind: "fix-and-retry",
          label: "Fix and try again",
          detail: "Check the highlighted fields and create your account again.",
        };
      case "email-taken":
        return {
          kind: "sign-in-instead",
          label: "Sign in instead",
          detail: "An account with this email already exists — sign in to continue.",
        };
      case "network":
        return {
          kind: "retry",
          label: "Try again",
          detail: "WebFlix couldn't reach the service — check your connection and try again.",
        };
      case "unavailable":
        return {
          kind: "retry",
          label: "Try again",
          detail: "The service can't create accounts right now — try again in a moment.",
        };
      case "malformed":
        return {
          kind: "retry",
          label: "Try again",
          detail: "The service answered unexpectedly — no account was created; try again.",
        };
    }
  })();
  return { kind, detail, recovery };
}

// ---------------------------------------------------------------------------
// The secret-free session views (what the service actually answers)
// ---------------------------------------------------------------------------

/** The account's user view (the API's user projection — never secrets). */
export interface AccountUserView {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One profile of the account (the API's profile projection). */
export interface AccountProfileView {
  readonly id: string;
  readonly userId: string;
  readonly displayName: string;
  readonly avatarSeed: string;
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * The authenticated session view: the account + its profiles + the active
 * one. STRUCTURALLY SECRET-FREE (the guard below rejects a view carrying
 * password material — the privacy law at this boundary too).
 */
export interface AccountSessionView {
  readonly user: AccountUserView;
  readonly profiles: readonly AccountProfileView[];
  readonly activeProfileId: string;
}

function isUsableUserView(value: unknown): value is AccountUserView {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (typeof value.email !== "string" || value.email.length === 0) return false;
  if (typeof value.displayName !== "string") return false;
  if (typeof value.createdAt !== "string" || !isIso8601(value.createdAt)) return false;
  if (typeof value.updatedAt !== "string" || !isIso8601(value.updatedAt)) return false;
  // The password (hash) must NEVER ride the user view — the privacy law.
  if ("password" in value || "passwordHash" in value) return false;
  return true;
}

function isUsableProfileView(value: unknown): value is AccountProfileView {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (typeof value.userId !== "string" || value.userId.length === 0) return false;
  if (typeof value.displayName !== "string") return false;
  if (typeof value.avatarSeed !== "string") return false;
  if (typeof value.isDefault !== "boolean") return false;
  if (typeof value.createdAt !== "string" || !isIso8601(value.createdAt)) return false;
  if (typeof value.updatedAt !== "string" || !isIso8601(value.updatedAt)) return false;
  return true;
}

/**
 * Structural guard for a claimed session view (the port implementer's
 * belt — a malformed service answer never becomes identity data). Rejects
 * non-usable shapes AND any view carrying password material.
 */
export function isUsableAccountSessionView(value: unknown): value is AccountSessionView {
  if (!isRecord(value)) return false;
  if (!isUsableUserView(value.user)) return false;
  if (!Array.isArray(value.profiles) || !value.profiles.every(isUsableProfileView)) {
    return false;
  }
  if (typeof value.activeProfileId !== "string" || value.activeProfileId.length === 0) {
    return false;
  }
  return value.profiles.some((profile) => profile.id === value.activeProfileId);
}

/**
 * The freshly issued session a successful register answers: the ONE-TIME
 * session token (the secret — shown exactly once, stored by the adapter
 * per its platform storage law, never rendered, never logged) + the
 * secret-free session view.
 */
export interface IssuedAccountSession {
  /** ⚠️ THE ONE-TIME SECRET — passes to the caller ONCE; the model never retains it. */
  readonly token: string;
  readonly session: AccountSessionView;
}

// ---------------------------------------------------------------------------
// The port (the EXISTING transport, typed — no second auth system)
// ---------------------------------------------------------------------------

/** The outcome of one register call through the port. */
export type AccountRegistrationOutcome =
  | { readonly ok: true; readonly value: IssuedAccountSession }
  | { readonly ok: false; readonly failure: AccountCreationFailure };

/**
 * The adapter seam the EXISTING authRegister transport binds to. The
 * adapter maps its transport's typed failures onto
 * {@link AccountCreationFailure} (Web: `auth-transport.ts`'s closed
 * kinds — `email-taken` verbatim, 400 ⇒ `invalid-input`, transport loss ⇒
 * `network`, 5xx/408/429 ⇒ `unavailable`, non-usable payload ⇒
 * `malformed`); Desktop implements the same endpoint through its own
 * transport with the SAME mapping (the parity law).
 */
export interface AccountRegistrationPort {
  /**
   * Create the account (the real `POST /auth/register`): on success the
   * service has ALREADY signed the user in — the answer carries the
   * one-time token + the account session view.
   */
  register(command: NormalizedRegisterAccountCommand): Promise<AccountRegistrationOutcome>;
}

// ---------------------------------------------------------------------------
// The journey read model (the state machine)
// ---------------------------------------------------------------------------

/** The account-creation journey's states. */
export type AccountCreationState =
  /** Nothing in flight (the form's resting state). */
  | "idle"
  /** The register call is in flight. */
  | "creating"
  /** The account exists and the session was issued (auto-login happened). */
  | "created"
  /** The attempt failed (the typed failure + recovery are on the model). */
  | "failed";

/** Every value of {@link AccountCreationState}, in journey order. */
export const ACCOUNT_CREATION_STATES: readonly AccountCreationState[] = [
  "idle",
  "creating",
  "created",
  "failed",
] as const;

/** Runtime membership check against the state union. */
export function isAccountCreationState(x: unknown): x is AccountCreationState {
  return (
    typeof x === "string" &&
    (ACCOUNT_CREATION_STATES as readonly string[]).includes(x)
  );
}

/**
 * The typed next action of the journey's current state (the no-dead-end
 * law): every state names the one obvious next action. Profile selection
 * is DOWNSTREAM of successful registration (`choose-profile`) — this
 * contract adds no profile operations (the adapter's existing
 * profile-selection flow owns that step).
 */
export type AccountCreationNextActionKind =
  /** idle — fill in the create-account details. */
  | "provide-details"
  /** creating — wait for the answer (no duplicate submits). */
  | "wait"
  /** created — choose/confirm the profile (the downstream step). */
  | "choose-profile"
  /** failed(invalid-input) — fix the named fields and retry. */
  | "fix-and-retry"
  /** failed(email-taken) — sign in instead (the anti-loop law). */
  | "sign-in-instead"
  /** failed(network/unavailable/malformed) — retry. */
  | "retry";

/** The user-facing label + detail of each next action (the one derivation source). */
export const ACCOUNT_CREATION_NEXT_ACTION_VIEWS: Readonly<
  Record<AccountCreationNextActionKind, { readonly label: string; readonly detail: string }>
> = {
  "provide-details": {
    label: "Create your account",
    detail: "Enter your email and a password to create your WebFlix account.",
  },
  wait: {
    label: "Creating your account…",
    detail: "Your account is being created — this takes a moment.",
  },
  "choose-profile": {
    label: "Choose your profile",
    detail: "Your account is ready and you're signed in — choose the profile to watch with.",
  },
  "fix-and-retry": {
    label: "Fix and try again",
    detail: "Check the highlighted fields and create your account again.",
  },
  "sign-in-instead": {
    label: "Sign in instead",
    detail: "An account with this email already exists — sign in to continue.",
  },
  retry: {
    label: "Try again",
    detail: "No account was created — you can safely try again.",
  },
};

/** One next-action descriptor (kind + the frozen user words). */
export interface AccountCreationNextAction {
  readonly kind: AccountCreationNextActionKind;
  readonly label: string;
  readonly detail: string;
}

/**
 * The account-creation journey read model: the state, the typed failure
 * (with per-field problems for the form), the secret-free session view
 * (iff created), and the typed next action. STRUCTURALLY SECRET-FREE —
 * the token and password never appear on it (machine-tested).
 */
export interface AccountCreationModel {
  readonly state: AccountCreationState;
  /** Present iff `state === "failed"`: the typed failure + recovery. */
  readonly failure?: AccountCreationFailure;
  /**
   * Present iff `state === "failed"` and the failure is `invalid-input`:
   * the per-field problems the form renders inline.
   */
  readonly problems?: readonly RegisterAccountProblem[];
  /** Present iff `state === "created"`: the signed-in account view (no token). */
  readonly session?: AccountSessionView;
  /** The typed next action (never absent — the no-dead-end law). */
  readonly nextAction: AccountCreationNextAction;
}

// ---------------------------------------------------------------------------
// The secret-free law (machine check)
// ---------------------------------------------------------------------------

/** Field names that must NEVER appear on the journey model (the secret law). */
const FORBIDDEN_SECRET_FIELDS: readonly string[] = [
  "password",
  "passwordHash",
  "token",
  "secret",
  "apiKey",
  "credential",
];

function walkSecretFree(value: unknown, path: string, problems: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkSecretFree(item, `${path}[${index}]`, problems));
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_SECRET_FIELDS.includes(key)) {
        problems.push(`${path}.${key}: secret material on the account-creation model`);
      }
      walkSecretFree(child, `${path}.${key}`, problems);
    }
  }
}

/**
 * Assert the journey model (or any claimed view) carries NO secret
 * material (the machine check of the R22-B secret law — the token lives
 * only in the one-time {@link IssuedAccountSession}, the password only in
 * the command). Throws the typed `RuntimeError` (`invalid-input`) naming
 * every offending path.
 */
export function assertAccountCreationModelSecretFree(model: AccountCreationModel): void {
  const problems: string[] = [];
  walkSecretFree(model, "model", problems);
  if (problems.length > 0) {
    throw new RuntimeError("invalid-input", problems.join("; "));
  }
}

// ---------------------------------------------------------------------------
// The journey (the thin state machine over the injected port)
// ---------------------------------------------------------------------------

/** The answer of {@link AccountCreationJourney.create}. */
export type AccountCreationResult =
  | {
      readonly ok: true;
      /** The one-time issuance — the caller stores the token NOW (the model never retains it). */
      readonly issued: IssuedAccountSession;
      readonly model: AccountCreationModel;
    }
  | { readonly ok: false; readonly model: AccountCreationModel };

/** The account-creation journey operations (the shared seam surfaces consume). */
export interface AccountCreationJourney {
  /** The current journey model (never fetched — the state view). */
  model(): AccountCreationModel;
  /**
   * Create the account: validate (the shared pre-flight — the honest
   * per-field problems without a round trip), call the port once, and
   * transition the model. A call while `creating` answers the unchanged
   * in-flight model (no duplicate submissions). The one-time token rides
   * the RESULT only — the model stays secret-free.
   */
  create(command: RegisterAccountCommand): Promise<AccountCreationResult>;
  /** Return to idle (dismiss the failure / start over after the adapter consumed the session). */
  reset(): AccountCreationModel;
}

function nextActionOf(model: Omit<AccountCreationModel, "nextAction">): AccountCreationNextAction {
  const kind: AccountCreationNextActionKind =
    model.state === "idle"
      ? "provide-details"
      : model.state === "creating"
        ? "wait"
        : model.state === "created"
          ? "choose-profile"
          : model.failure?.kind === "email-taken"
            ? "sign-in-instead"
            : model.failure?.kind === "invalid-input"
              ? "fix-and-retry"
              : "retry";
  const view = ACCOUNT_CREATION_NEXT_ACTION_VIEWS[kind];
  return { kind, label: view.label, detail: view.detail };
}

/**
 * Create the account-creation journey over one port (the EXISTING
 * transport, typed). Pure bookkeeping: no clock, no ids, no fetching
 * beyond the port's own call. Created by the adapter's composition root;
 * usable standalone in tests.
 */
export function createAccountCreationJourney(
  port: AccountRegistrationPort,
): AccountCreationJourney {
  let current: Omit<AccountCreationModel, "nextAction"> = { state: "idle" };

  function model(): AccountCreationModel {
    return { ...current, nextAction: nextActionOf(current) };
  }

  return {
    model,

    async create(command: RegisterAccountCommand): Promise<AccountCreationResult> {
      if (current.state === "creating") {
        // A duplicate submit while in flight: the FIRST attempt stands
        // (documented; the port is never called twice).
        return { ok: false, model: model() };
      }
      const validation = validateRegisterAccountCommand(command);
      if (!validation.ok) {
        current = {
          state: "failed",
          failure: accountCreationFailure(
            "invalid-input",
            validation.problems.map((problem) => problem.detail).join(" "),
          ),
          problems: [...validation.problems],
        };
        return { ok: false, model: model() };
      }
      current = { state: "creating" };
      const outcome = await port.register(validation.value);
      if (!outcome.ok) {
        current = { state: "failed", failure: outcome.failure };
        return { ok: false, model: model() };
      }
      // Created + auto-logged-in: the session VIEW joins the model; the
      // one-time token rides the result to the caller ONCE (the secret
      // law — the model never retains it).
      current = { state: "created", session: outcome.value.session };
      return { ok: true, issued: outcome.value, model: model() };
    },

    reset(): AccountCreationModel {
      current = { state: "idle" };
      return model();
    },
  };
}
