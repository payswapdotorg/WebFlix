/**
 * @wfx/app-desktop — the Desktop first-run parity surface (R22-H).
 *
 * THE DESKTOP BINDING of the shared first-run semantics (the R22 plan's
 * Worker-3 lane): the SAME product semantics the Web lane surfaces
 * (R22-D/E), consumed from the FROZEN shared read models — ZERO
 * duplicated business rules:
 *
 * - ACCOUNT CREATION/SIGN-IN STATE consumes the R22-B contract
 *   (`account-creation.ts` — the journey state machine over the
 *   `AccountRegistrationPort`, the shared validation, the typed failure
 *   vocabulary with recovery next actions, the secret-free session
 *   views). The Desktop adds ONLY platform-native affordances: the
 *   one-time token stores through the OS KEYCHAIN (`auth-session-store.ts`
 *   over the shell's auth-store area), and the boot continuity probe
 *   (`restoreSession`) verifies the stored session against the service
 *   before it becomes identity truth.
 * - SOURCE CONNECTOR SELECTION consumes the R22-A contract
 *   (`source-catalog.ts` — the seven state truths, the real connector id
 *   + the typed action, the user-vocabulary connection method, the
 *   anonymous sign-in prerequisite, the honest unsupported truth). The
 *   observed rows live in the RUNTIME's own source-state store (the
 *   adapter reports through `runtime.sources.observe` — the documented
 *   law); the catalog derivation runs VERBATIM over them.
 * - SOURCE AUTHORIZATION/RECOVERY runs through the adapter-owned native
 *   connect flows (`source-connect-flow.ts` — the contained
 *   authorization surface for provider sign-in, the device instructions,
 *   the direct local/none connects — every completion VERIFIED through a
 *   fresh management read, never an assumed success).
 * - THE BYOF PREREQUISITE TRANSITION (the plan's F3 fix): Bring Your
 *   Feed stays reachable exactly when a connected source declares the
 *   `feedImport` capability — before that, the BYOF surface carries the
 *   honest prerequisite WITH its bridge into the source chooser (never
 *   the old dead end, never a fabricated import offer).
 *
 * THE PARITY LAW (machine-checked): the shared derivations render
 * VERBATIM — `sourceCatalogView` is called, never re-implemented; the
 * account-creation journey model is the R22-B model, never a fork; every
 * string this surface can project passes the frozen stale-copy sweep
 * (`firstRunCopyStrings` gathers them for the tests and the lead's
 * evidence); the secret law holds (the token lives in the keychain +
 * the transport headers ONLY — `assertAccountCreationModelSecretFree`
 * applies to every model this surface answers).
 *
 * An UNBOUND composition (no `firstRun` block) answers the honest typed
 * verdicts — identity flows and source onboarding are surfaced as not
 * wired, never silently absent (the R14/R20 optional-block doctrine).
 */

import type {
  AccountCreationModel,
  AccountCreationResult,
  AccountSessionView,
  IssuedAccountSession,
  ModelSectionStatus,
  RegisterAccountCommand,
  SourceCatalogInput,
  SourceCatalogView,
  SourceInfo,
  SourcesModel,
} from "@wfx/client-runtime";
import {
  assertAccountCreationModelSecretFree,
  createAccountCreationJourney,
  errorSection,
  isStaleCompletionCopy,
  readySection,
  sourceCatalogView,
} from "@wfx/client-runtime";

import type { ClientRuntime } from "@wfx/client-runtime";

import type {
  DesktopAuthSessionStore,
  DesktopAuthSessionStoreFailure,
  DesktopAuthStoreCapability,
} from "../platform/auth-session-store";
import type { DesktopAuthTransport, DesktopLoginInput } from "../platform/auth-transport";
import { createDesktopAccountRegistrationPort } from "../platform/auth-transport";
import type { ShellIpc } from "../platform/shell-ipc";
import type {
  DesktopSourceFlowStartResult,
  DesktopSourceFlowView,
} from "../platform/source-connect-flow";
import { createDesktopSourceConnectFlow } from "../platform/source-connect-flow";
import type { DesktopFeedSurface } from "./feed-surface";

// ---------------------------------------------------------------------------
// The typed failure envelope (every user-facing failure has a next action)
// ---------------------------------------------------------------------------

/** The closed first-run failure vocabulary. */
export type DesktopFirstRunFailureCode =
  /** The composition did not wire the first-run block (the honest truth). */
  | "unbound"
  /** The operation needs a signed-in session (the R22-A prerequisite). */
  | "anonymous"
  /** The transport did not complete. */
  | "network"
  /** The session token was not accepted. */
  | "unauthorized"
  /** Sign-in credentials were wrong (the anti-enumeration answer). */
  | "invalid-credentials"
  /** The command failed validation. */
  | "invalid-input"
  /** The service cannot serve now. */
  | "unavailable"
  /** The service answered a non-usable payload. */
  | "malformed"
  /** The OS session store failed (its typed truth rides the detail). */
  | "store";

/** One typed first-run failure + its honest recovery next action. */
export interface DesktopFirstRunFailure {
  readonly code: DesktopFirstRunFailureCode;
  readonly detail: string;
  /** The recovery next action (never absent for a user-facing failure). */
  readonly recovery: {
    readonly kind: "sign-in" | "create-account" | "retry" | "fix-and-retry";
    readonly label: string;
    readonly detail: string;
  };
}

/** The shared result envelope of the first-run operations. */
export type DesktopFirstRunResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: DesktopFirstRunFailure };

// ---------------------------------------------------------------------------
// The identity state view (R22-B parity)
// ---------------------------------------------------------------------------

/**
 * The Desktop account state: the anonymous/signed-in truth + the entry
 * points. `identityNote` carries the honest standing notes (an unwired
 * composition; a keychain that will not persist the session).
 */
export interface DesktopAccountStateView {
  readonly state: "anonymous" | "signed-in";
  /** Present iff signed-in: the secret-free session view (R22-B). */
  readonly session: AccountSessionView | null;
  /** Present iff signed-in: when the keychain stored the session (ISO). */
  readonly savedAt: string | null;
  /** The sign-in entry's control label. */
  readonly signInLabel: string;
  /** The create-account entry's control label. */
  readonly createAccountLabel: string;
  /** The honest standing note (null when none applies). */
  readonly identityNote: string | null;
  /** The profiles (signed-in) — the choose-profile downstream step's data. */
  readonly profiles: readonly AccountSessionView["profiles"][number][];
  /** The active profile id (signed-in; null when anonymous). */
  readonly activeProfileId: string | null;
}

/** The outcome of the boot continuity probe. */
export interface DesktopSessionRestoreResult {
  readonly state: DesktopAccountStateView;
  /**
   * Whether the restored session was verified against the service
   * (`GET /auth/me` answered). An offline boot keeps the stored session
   * with `verified: false` — the token stands until a read proves
   * otherwise (the honest degraded truth, never a fabricated verify).
   */
  readonly verified: boolean;
  /** Present when the keychain read itself failed (the typed recovery). */
  readonly storeFailure: DesktopAuthSessionStoreFailure | null;
}

/** The create-account/sign-in outcome (the session + the persistence truth). */
export interface DesktopIssuedSessionOutcome {
  readonly issued: IssuedAccountSession;
  /** Whether the session persisted into the OS keychain. */
  readonly persisted: boolean;
  /** Present iff persistence failed (the account IS created/signed-in — the note is the honest consequence). */
  readonly persistFailure: DesktopAuthSessionStoreFailure | null;
  /** The R22-B journey model after the attempt (secret-free — machine-checked). */
  readonly model: AccountCreationModel;
}

/**
 * The create-account result: on failure the R22-B journey MODEL is the
 * typed truth (the shared failure vocabulary + its recovery next actions
 * + the per-field problems — never re-derived, never forked).
 */
export type DesktopCreateAccountResult =
  | { readonly ok: true; readonly value: DesktopIssuedSessionOutcome }
  | { readonly ok: false; readonly model: AccountCreationModel };

// ---------------------------------------------------------------------------
// The BYOF prerequisite view (the F3 bridge)
// ---------------------------------------------------------------------------

/** The BYOF prerequisite transition view. */
export interface DesktopByofPrerequisiteView {
  /** Whether a connected source declares the feed-import capability. */
  readonly ready: boolean;
  /** The connected feed-import-capable connector ids. */
  readonly feedImportSourceIds: readonly string[];
  /** How many sources are connected overall. */
  readonly connectedCount: number;
  /**
   * The next action (the no-dead-end law): connect a source (the bridge
   * into the chooser) OR import the feed (the ready entry).
   */
  readonly nextAction: {
    readonly kind: "connect-source" | "import-feed";
    readonly label: string;
    readonly detail: string;
  };
  /** The R20-G feed block's binding truth (an unbound feed block is surfaced). */
  readonly feedBound: boolean;
  /** The honest standing note (null when none applies). */
  readonly note: string | null;
}

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

/** Options for {@link createDesktopFirstRunSurface}. */
export interface DesktopFirstRunSurfaceOptions {
  /** The shared client runtime (the source-state store's owner). */
  readonly runtime: ClientRuntime;
  /** The Desktop account/source transport (the documented routes). */
  readonly transport: DesktopAuthTransport;
  /** The OS-keychain session store (the platform storage law). */
  readonly sessionStore: DesktopAuthSessionStore;
  /** The R20-G feed surface (the import path's binding truth). */
  readonly feed: DesktopFeedSurface;
  /** The live native shell (the contained authorization surfaces). */
  readonly shell: ShellIpc;
  /** The adapter session's clock stamp (ISO "now" — the savedAt truth). */
  readonly now: () => string;
  /**
   * The adapter's platform-truth map for the source catalog (R22-A's
   * `unsupportedOnPlatform`): connectorId → the honest one-sentence reason
   * THIS platform cannot connect it. Desktop generally carries every
   * connector (it has the richest native surface) — the map stays
   * available for compositions that truthfully cannot connect one.
   */
  readonly unsupportedOnPlatform?: ReadonlyMap<string, string>;
}

/** The Desktop first-run parity surface (R22-H). */
export interface DesktopFirstRunSurface {
  /** Whether the first-run block is bound (the honest capability truth). */
  readonly bound: boolean;
  // — identity (R22-B parity) —
  /** The account state view (the anonymous/signed-in truth + entry points). */
  accountState(): DesktopAccountStateView;
  /** The R22-B journey's current model (secret-free — machine-checked). */
  accountCreationModel(): AccountCreationModel;
  /**
   * Create the account (the R22-B journey over the real register
   * transport; on success the session stores through the keychain and
   * the view turns signed-in). Profile selection stays DOWNSTREAM
   * (`choose-profile` — the adapter's existing flow owns it). On failure
   * the R22-B model carries the typed failure + recovery verbatim.
   */
  createAccount(command: RegisterAccountCommand): Promise<DesktopCreateAccountResult>;
  /** Dismiss the failed attempt / start over (the journey's reset). */
  resetAccountCreation(): AccountCreationModel;
  /** The boot continuity probe (the keychain → `GET /auth/me` verify). */
  restoreSession(): Promise<DesktopSessionRestoreResult>;
  /** Sign in (the typed failures carry their recovery next actions). */
  signIn(input: DesktopLoginInput): Promise<DesktopFirstRunResult<DesktopIssuedSessionOutcome>>;
  /** Sign out (revoke + clear; the honest anonymous state after). */
  signOut(): Promise<DesktopFirstRunResult<{ revoked: boolean }>>;
  /** Switch the active profile (the downstream choose-profile step). */
  selectProfile(profileId: string): Promise<DesktopFirstRunResult<AccountSessionView>>;
  /** The current session token (the composition's transport wiring seam). */
  currentToken(): string | null;
  /** The OS-keychain capability truth (the honest persistence consequence). */
  storeCapability(): Promise<DesktopAuthStoreCapability>;
  // — source onboarding (R22-A parity) —
  /** The first-connect catalog (the R22-A derivation, VERBATIM). */
  sourceCatalog(): SourceCatalogView;
  /**
   * Refresh the observed sources (the session-scoped `GET /sources` read;
   * the rows report into the runtime's store through the documented
   * observe path). Anonymous sessions answer the honest prerequisite
   * model (the empty catalog + the sign-in next action).
   */
  refreshSources(): Promise<SourcesModel>;
  /** Start one connect/reauthorize flow (the adapter-owned native UX). */
  connect(input: { readonly connectorId: string; readonly credential?: string }): Promise<DesktopSourceFlowStartResult | { readonly ok: false; readonly failure: DesktopFirstRunFailure }>;
  /** One device-flow poll step (the host-driven cadence). */
  pollSourceFlow(connectorId: string): Promise<DesktopSourceFlowView | { readonly ok: false; readonly failure: DesktopFirstRunFailure }>;
  /** The user's abandon of a live flow (the typed dismissed non-event). */
  cancelSourceFlow(connectorId: string): Promise<DesktopSourceFlowView | { readonly ok: false; readonly failure: DesktopFirstRunFailure }>;
  /** Disconnect a source (the typed action; the refreshed row observes into the runtime). */
  disconnectSource(connectorId: string): Promise<DesktopFirstRunResult<DesktopDisconnectOutcome>>;
  /** One connector's current flow view (null when none ran). */
  sourceFlow(connectorId: string): DesktopSourceFlowView | null;
  /** The current flow views (live and terminal). */
  sourceFlows(): readonly DesktopSourceFlowView[];
  // — the BYOF prerequisite transition (F3) —
  /** The BYOF prerequisite view (the bridge — never the old dead end). */
  byofPrerequisite(): DesktopByofPrerequisiteView;
}

/** The disconnect outcome (the service's answer + the refreshed row). */
export interface DesktopDisconnectOutcome {
  readonly connectorId: string;
  readonly hadAccount: boolean;
  /** The refreshed row (observed into the runtime — the signedOut truth). */
  readonly row: SourceInfo | null;
}

// ---------------------------------------------------------------------------
// The frozen copy (the one derivation source — user vocabulary)
// ---------------------------------------------------------------------------

const SIGN_IN_LABEL = "Sign in";
const CREATE_ACCOUNT_LABEL = "Create account";
const UNBOUND_NOTE =
  "Account sign-in isn't wired in this composition — the Desktop app boots without the account service connection.";

const BYOF_CONNECT_FIRST_LABEL = "Connect a source first";
const BYOF_CONNECT_FIRST_DETAIL =
  "Bring Your Feed imports from a connected source — choose one to connect and the import opens up here.";
const BYOF_IMPORT_READY_LABEL = "Bring Your Feed";
const BYOF_IMPORT_READY_DETAIL =
  "A connected source can import your feed — preview what it found and confirm before anything changes.";

// ---------------------------------------------------------------------------
// The copy sweep (the J35 machine check over this surface's strings)
// ---------------------------------------------------------------------------

/**
 * Gather every user-facing copy string this surface can project (the
 * stale-copy sweep the tests and the lead's evidence consume). Includes
 * the shared R22-A catalog's own strings (projected verbatim — swept
 * here so a shared drift is caught on the Desktop side too).
 */
export function firstRunCopyStrings(input: {
  readonly sources?: readonly SourceInfo[];
  readonly authenticated?: boolean;
}): readonly string[] {
  const strings: string[] = [
    SIGN_IN_LABEL,
    CREATE_ACCOUNT_LABEL,
    UNBOUND_NOTE,
    BYOF_CONNECT_FIRST_LABEL,
    BYOF_CONNECT_FIRST_DETAIL,
    BYOF_IMPORT_READY_LABEL,
    BYOF_IMPORT_READY_DETAIL,
  ];
  const catalog = sourceCatalogView({
    sources: input.sources ?? [],
    authenticated: input.authenticated ?? false,
  });
  strings.push(catalog.prerequisite?.label ?? "", catalog.prerequisite?.detail ?? "");
  if (catalog.catalogEmptyDetail !== null) strings.push(catalog.catalogEmptyDetail);
  for (const entry of catalog.entries) {
    strings.push(
      entry.stateLabel,
      entry.stateDetail,
      entry.method.label,
      entry.method.detail,
      entry.action.label,
      entry.action.detail,
      entry.unsupportedDetail ?? "",
      entry.recoveryHint ?? "",
    );
  }
  return strings.filter((text) => text.length > 0);
}

/** The Desktop first-run copy sweep primitive (the frozen R21-A law). */
export function isStaleFirstRunCopy(text: string): boolean {
  return isStaleCompletionCopy(text);
}

// ---------------------------------------------------------------------------
// The bound surface
// ---------------------------------------------------------------------------

function recoveryFor(code: DesktopFirstRunFailureCode): DesktopFirstRunFailure["recovery"] {
  switch (code) {
    case "unbound":
      return {
        kind: "retry",
        label: "Restart the app with the account service connected",
        detail: "This composition did not wire the account flows — the Desktop app needs the service connection.",
      };
    case "anonymous":
      return {
        kind: "sign-in",
        label: "Sign in or create an account",
        detail: "This action belongs to your account — sign in or create one to continue.",
      };
    case "unauthorized":
      return {
        kind: "sign-in",
        label: "Sign in again",
        detail: "Your session was not accepted — sign in again to continue.",
      };
    case "invalid-credentials":
      return {
        kind: "retry",
        label: "Try again",
        detail: "Email or password is incorrect — check them and try again.",
      };
    case "invalid-input":
      return {
        kind: "fix-and-retry",
        label: "Fix and try again",
        detail: "Check the highlighted fields and try again.",
      };
    case "network":
    case "unavailable":
    case "malformed":
      return {
        kind: "retry",
        label: "Try again",
        detail: "WebFlix couldn't reach the service — check your connection and try again.",
      };
    case "store":
      return {
        kind: "retry",
        label: "Try again",
        detail: "The device's credential store could not complete the step — nothing was lost; try again.",
      };
  }
}

function failureOf(code: DesktopFirstRunFailureCode, detail: string): DesktopFirstRunFailure {
  return { code, detail, recovery: recoveryFor(code) };
}

function transportFailureOf(
  kind: "network" | "unauthorized" | "invalid-credentials" | "invalid-input" | "unavailable" | "malformed",
  detail: string,
): DesktopFirstRunFailure {
  return failureOf(kind, detail);
}

interface SessionState {
  token: string;
  session: AccountSessionView;
  savedAt: string | null;
}

/**
 * Create the bound Desktop first-run surface (the R22-H parity binding).
 * The shared read models render VERBATIM; the platform-native
 * affordances are the keychain persistence + the contained authorization
 * surfaces + the boot continuity verify.
 */
export function createDesktopFirstRunSurface(
  options: DesktopFirstRunSurfaceOptions,
): DesktopFirstRunSurface {
  const { runtime, transport, sessionStore, feed, shell, now } = options;
  const unsupportedOnPlatform = options.unsupportedOnPlatform;

  const journey = createAccountCreationJourney(createDesktopAccountRegistrationPort(transport));
  const connectFlow = createDesktopSourceConnectFlow({ shell, transport, now });

  let session: SessionState | null = null;
  let identityNote: string | null = null;
  let sourcesStatus: ModelSectionStatus = readySection();

  // The flow's observed rows report into the runtime (the documented
  // adapter-report path — mid-flow `authorizing` rows included).
  connectFlow.subscribe((view) => {
    if (view.row !== null) runtime.sources.observe(view.row);
  });

  function accountStateView(): DesktopAccountStateView {
    if (session === null) {
      return {
        state: "anonymous",
        session: null,
        savedAt: null,
        signInLabel: SIGN_IN_LABEL,
        createAccountLabel: CREATE_ACCOUNT_LABEL,
        identityNote,
        profiles: [],
        activeProfileId: null,
      };
    }
    return {
      state: "signed-in",
      session: session.session,
      savedAt: session.savedAt,
      signInLabel: SIGN_IN_LABEL,
      createAccountLabel: CREATE_ACCOUNT_LABEL,
      identityNote,
      profiles: [...session.session.profiles],
      activeProfileId: session.session.activeProfileId,
    };
  }

  async function persistIssued(
    issued: IssuedAccountSession,
  ): Promise<{ persisted: boolean; persistFailure: DesktopAuthSessionStoreFailure | null }> {
    const stored = await sessionStore.store(issued);
    if (!stored.ok) {
      // The account IS created/signed-in (the service truth); the
      // persistence failure is the honest standing note, never a
      // fabricated failure of the sign-in itself.
      identityNote = stored.failure.recovery.detail;
      return { persisted: false, persistFailure: stored.failure };
    }
    identityNote = null;
    return { persisted: true, persistFailure: null };
  }

  return {
    bound: true,

    accountState: accountStateView,

    accountCreationModel(): AccountCreationModel {
      return journey.model();
    },

    async createAccount(command) {
      const result: AccountCreationResult = await journey.create(command);
      if (!result.ok) {
        // The R22-B model IS the failure truth (the shared vocabulary +
        // recovery + per-field problems — never re-derived here).
        return { ok: false, model: result.model };
      }
      // Created + auto-logged-in: persist per the platform law; the
      // one-time token passes to the caller ONCE through the result.
      const persistence = await persistIssued(result.issued);
      session = {
        token: result.issued.token,
        session: result.issued.session,
        savedAt: new Date(now()).toISOString(),
      };
      return {
        ok: true,
        value: {
          issued: result.issued,
          persisted: persistence.persisted,
          persistFailure: persistence.persistFailure,
          model: result.model,
        },
      };
    },

    resetAccountCreation(): AccountCreationModel {
      return journey.reset();
    },

    async restoreSession(): Promise<DesktopSessionRestoreResult> {
      const restored = await sessionStore.restore();
      if (!restored.ok) {
        // The corrupt/unsupported keychain truth: the surface stays
        // anonymous with the typed recovery (sign in again) as the note.
        identityNote = restored.failure.recovery.detail;
        return {
          state: accountStateView(),
          verified: false,
          storeFailure: restored.failure,
        };
      }
      if (restored.value.state === "anonymous") {
        identityNote = null;
        return { state: accountStateView(), verified: true, storeFailure: null };
      }
      // A stored session exists: verify it against the service before it
      // becomes identity truth (the honest continuity probe).
      const verified = await transport.readSession(restored.value.token);
      if (verified.ok) {
        session = {
          token: restored.value.token,
          session: verified.value,
          savedAt: restored.value.savedAt,
        };
        identityNote = null;
        return { state: accountStateView(), verified: true, storeFailure: null };
      }
      if (verified.failure.kind === "unauthorized") {
        // The token is dead (expired/revoked): clear the store, answer the
        // honest anonymous state — never a fabricated signed-in.
        await sessionStore.clear();
        session = null;
        identityNote = null;
        return { state: accountStateView(), verified: true, storeFailure: null };
      }
      // Offline/degraded boot: the stored session stands unverified — the
      // token keeps riding the transport; the reads that need it surface
      // their own typed failures (never a fabricated verify).
      session = {
        token: restored.value.token,
        session: restored.value.session,
        savedAt: restored.value.savedAt,
      };
      identityNote = null;
      return { state: accountStateView(), verified: false, storeFailure: null };
    },

    async signIn(input) {
      const outcome = await transport.login(input);
      if (!outcome.ok) {
        return {
          ok: false,
          failure: transportFailureOf(
            outcome.failure.kind === "invalid-credentials" ||
              outcome.failure.kind === "network" ||
              outcome.failure.kind === "unauthorized" ||
              outcome.failure.kind === "invalid-input" ||
              outcome.failure.kind === "unavailable" ||
              outcome.failure.kind === "malformed"
              ? outcome.failure.kind
              : "malformed",
            outcome.failure.detail,
          ),
        };
      }
      const persistence = await persistIssued(outcome.value);
      session = {
        token: outcome.value.token,
        session: outcome.value.session,
        savedAt: new Date(now()).toISOString(),
      };
      return {
        ok: true,
        value: {
          issued: outcome.value,
          persisted: persistence.persisted,
          persistFailure: persistence.persistFailure,
          model: journey.model(),
        },
      };
    },

    async signOut() {
      if (session === null) {
        return { ok: true, value: { revoked: false } };
      }
      const token = session.token;
      const outcome = await transport.logout(token);
      // The local truth clears regardless: a failed logout call leaves
      // the token valid server-side (honestly noted); the surface never
      // keeps a session the user asked to leave.
      await sessionStore.clear();
      session = null;
      identityNote = null;
      if (!outcome.ok) {
        return {
          ok: false,
          failure: transportFailureOf(
            outcome.failure.kind === "network" ||
              outcome.failure.kind === "unavailable" ||
              outcome.failure.kind === "malformed"
              ? outcome.failure.kind
              : "malformed",
            `${outcome.failure.detail} — you are signed out here; the service may keep the session until it expires.`,
          ),
        };
      }
      return { ok: true, value: { revoked: outcome.value.revoked } };
    },

    async selectProfile(profileId) {
      if (session === null) {
        return { ok: false, failure: failureOf("anonymous", "selecting a profile needs a signed-in session") };
      }
      const outcome = await transport.selectProfile(session.token, profileId);
      if (!outcome.ok) {
        return {
          ok: false,
          failure: transportFailureOf(
            outcome.failure.kind === "unauthorized" ||
              outcome.failure.kind === "invalid-input" ||
              outcome.failure.kind === "not-found" ||
              outcome.failure.kind === "network" ||
              outcome.failure.kind === "unavailable" ||
              outcome.failure.kind === "malformed"
              ? outcome.failure.kind === "not-found"
                ? "malformed"
                : outcome.failure.kind
              : "malformed",
            outcome.failure.detail,
          ),
        };
      }
      session = { ...session, session: outcome.value };
      // Keep the stored view fresh (the same token; the fresh view).
      await sessionStore.store({ token: session.token, session: outcome.value });
      return { ok: true, value: outcome.value };
    },

    currentToken(): string | null {
      return session === null ? null : session.token;
    },

    storeCapability() {
      return sessionStore.support();
    },

    sourceCatalog(): SourceCatalogView {
      const input: SourceCatalogInput = {
        sources: runtime.sources.list(),
        authenticated: session !== null,
        status: sourcesStatus,
        ...(unsupportedOnPlatform !== undefined ? { unsupportedOnPlatform } : {}),
      };
      return sourceCatalogView(input);
    },

    async refreshSources(): Promise<SourcesModel> {
      if (session === null) {
        // The honest anonymous truth: the R22-A prerequisite (never a
        // fabricated catalog). The runtime's own refresh (the anonymous
        // x-wfx channel) answers the same empty truth — run it so the
        // model stays coherent, then surface the prerequisite.
        const anonymous = await runtime.sources.refresh();
        sourcesStatus = anonymous.status;
        return anonymous;
      }
      const read = await transport.readSources(session.token);
      if (!read.ok) {
        // In-model degradation: the last observed rows stay visible; the
        // ERROR status rides the catalog (the R22-A law).
        const failure = read.failure;
        sourcesStatus = errorSection(
          failure.kind === "network"
            ? "network"
            : failure.kind === "unauthorized"
              ? "unauthorized"
              : failure.kind === "unavailable"
                ? "unavailable"
                : "invalid-input",
          failure.detail,
        );
        return {
          status: sourcesStatus,
          sources: runtime.sources.list(),
        };
      }
      for (const row of read.value.sources) {
        runtime.sources.observe(row);
      }
      sourcesStatus = readySection();
      return { status: sourcesStatus, sources: runtime.sources.list() };
    },

    async connect(input) {
      if (session === null) {
        return {
          ok: false,
          failure: failureOf("anonymous", "connecting a source belongs to your account"),
        };
      }
      const entry = runtime.sources
        .list()
        .find((candidate) => candidate.connectorId === input.connectorId);
      return connectFlow.start({
        token: session.token,
        connectorId: input.connectorId,
        ...(input.credential !== undefined ? { credential: input.credential } : {}),
        methodHint: entry?.authMode === "oauth"
          ? "provider-signin"
          : entry?.authMode === "device"
            ? "device-code"
            : entry?.authMode === "local"
              ? "access-key"
              : "no-signin",
      });
    },

    async pollSourceFlow(connectorId) {
      const view = connectFlow.flow(connectorId);
      if (view === null) {
        return { ok: false, failure: failureOf("invalid-input", `no connect flow ever ran for '${connectorId}'`) };
      }
      return connectFlow.poll(connectorId);
    },

    async cancelSourceFlow(connectorId) {
      const view = connectFlow.flow(connectorId);
      if (view === null) {
        return { ok: false, failure: failureOf("invalid-input", `no connect flow ever ran for '${connectorId}'`) };
      }
      return connectFlow.cancel(connectorId);
    },

    async disconnectSource(connectorId) {
      if (session === null) {
        return { ok: false, failure: failureOf("anonymous", "disconnecting a source belongs to your account") };
      }
      const outcome = await transport.disconnectSource(session.token, connectorId);
      if (!outcome.ok) {
        return {
          ok: false,
          failure: transportFailureOf(
            outcome.failure.kind === "unauthorized" ||
              outcome.failure.kind === "invalid-input" ||
              outcome.failure.kind === "network" ||
              outcome.failure.kind === "unavailable" ||
              outcome.failure.kind === "malformed"
              ? outcome.failure.kind
              : "malformed",
            outcome.failure.detail,
          ),
        };
      }
      // The refreshed row observes into the runtime (the signedOut truth).
      const read = await transport.readSources(session.token);
      const row = read.ok
        ? read.value.sources.find((candidate) => candidate.connectorId === connectorId) ?? null
        : null;
      if (row !== null) runtime.sources.observe(row);
      return {
        ok: true,
        value: {
          connectorId: outcome.value.connectorId,
          hadAccount: outcome.value.hadAccount,
          row,
        },
      };
    },

    sourceFlow(connectorId) {
      return connectFlow.flow(connectorId);
    },

    sourceFlows() {
      return connectFlow.flows();
    },

    byofPrerequisite(): DesktopByofPrerequisiteView {
      const sources = runtime.sources.list();
      const connected = sources.filter((source) => source.authState === "signedIn");
      const feedImportSources = connected.filter(
        (source) => source.capabilities.feedImport === true,
      );
      const ready = feedImportSources.length > 0;
      return {
        ready,
        feedImportSourceIds: feedImportSources.map((source) => source.connectorId),
        connectedCount: connected.length,
        nextAction: ready
          ? { kind: "import-feed", label: BYOF_IMPORT_READY_LABEL, detail: BYOF_IMPORT_READY_DETAIL }
          : { kind: "connect-source", label: BYOF_CONNECT_FIRST_LABEL, detail: BYOF_CONNECT_FIRST_DETAIL },
        feedBound: feed.bound,
        note: !feed.bound
          ? "Bring Your Feed isn't wired in this composition — the import path needs the feed service connection."
          : null,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// The unbound surface (the honest typed verdicts)
// ---------------------------------------------------------------------------

function unboundFailure(operation: string): DesktopFirstRunFailure {
  return {
    code: "unbound",
    detail: `${operation}: the first-run block is not wired in this composition (the honest unbound truth — never a silent no-op)`,
    recovery: recoveryFor("unbound"),
  };
}

/**
 * The UNBOUND first-run surface: identity flows and source onboarding
 * answer the typed unbound verdicts; the account state honestly notes
 * the unwired composition (the R14/R20 optional-block doctrine).
 */
export function createUnboundFirstRunSurface(): DesktopFirstRunSurface {
  const unboundNote = UNBOUND_NOTE;
  return {
    bound: false,

    accountState(): DesktopAccountStateView {
      return {
        state: "anonymous",
        session: null,
        savedAt: null,
        signInLabel: SIGN_IN_LABEL,
        createAccountLabel: CREATE_ACCOUNT_LABEL,
        identityNote: unboundNote,
        profiles: [],
        activeProfileId: null,
      };
    },

    accountCreationModel(): AccountCreationModel {
      // The resting idle model (the R22-B shape) — the unbound surface
      // never fakes an in-flight journey.
      return { state: "idle", nextAction: { kind: "provide-details", label: "Create your account", detail: "Enter your email and a password to create your WebFlix account." } };
    },

    async createAccount() {
      return { ok: false, model: this.accountCreationModel() };
    },

    resetAccountCreation(): AccountCreationModel {
      return this.accountCreationModel();
    },

    async restoreSession(): Promise<DesktopSessionRestoreResult> {
      return {
        state: this.accountState(),
        verified: false,
        storeFailure: null,
      };
    },

    async signIn() {
      return { ok: false, failure: unboundFailure("signIn") };
    },

    async signOut() {
      return { ok: false, failure: unboundFailure("signOut") };
    },

    async selectProfile() {
      return { ok: false, failure: unboundFailure("selectProfile") };
    },

    currentToken(): string | null {
      return null;
    },

    async storeCapability() {
      return {
        support: { available: false, detail: "the first-run block is not wired in this composition" },
        consequence: {
          kind: "will-not-persist",
          label: "Sign-in isn't available in this composition",
          detail: unboundNote,
        },
      };
    },

    sourceCatalog(): SourceCatalogView {
      // The honest empty catalog with the standing note — never a
      // fabricated connector row.
      return sourceCatalogView({ sources: [], authenticated: false });
    },

    async refreshSources(): Promise<SourcesModel> {
      return {
        status: errorSection(
          "unavailable",
          "the first-run block is not wired in this composition (the source onboarding flows need it)",
        ),
        sources: [],
      };
    },

    async connect() {
      return { ok: false, failure: unboundFailure("connect") };
    },

    async pollSourceFlow(connectorId) {
      return { ok: false, failure: unboundFailure(`pollSourceFlow('${connectorId}')`) };
    },

    async cancelSourceFlow(connectorId) {
      return { ok: false, failure: unboundFailure(`cancelSourceFlow('${connectorId}')`) };
    },

    async disconnectSource() {
      return { ok: false, failure: unboundFailure("disconnectSource") };
    },

    sourceFlow(): DesktopSourceFlowView | null {
      return null;
    },

    sourceFlows(): readonly DesktopSourceFlowView[] {
      return [];
    },

    byofPrerequisite(): DesktopByofPrerequisiteView {
      return {
        ready: false,
        feedImportSourceIds: [],
        connectedCount: 0,
        nextAction: {
          kind: "connect-source",
          label: BYOF_CONNECT_FIRST_LABEL,
          detail: BYOF_CONNECT_FIRST_DETAIL,
        },
        feedBound: false,
        note: "Bring Your Feed isn't wired in this composition — the import path needs the feed service connection.",
      };
    },
  };
}

/** The secret-law machine check (re-exported for the surface's tests). */
export { assertAccountCreationModelSecretFree };
