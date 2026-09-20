/**
 * @wfx/app-desktop — the Desktop Model & AI management surface (R22-I).
 *
 * THE DESKTOP BINDING of the shared BYOM management semantics (the R22
 * plan's Worker-3 lane): the SAME product semantics the Web lane's
 * Settings → Model & AI panel surfaces (R22-F), consumed from the FROZEN
 * R22-C contract — ZERO duplicated business rules:
 *
 * - THE MANAGEMENT VIEW is the R22-C `byomManagementView` derivation
 *   VERBATIM (the binding summary with supported task capabilities,
 *   declared costs, privacy mode, availability truth, and the REMOVE
 *   action; the first-party rows rendered as context; the per-task
 *   privacy-mode truth with the honest null and the fail-closed
 *   effective class; the DERIVED verify/usable truth that names WHY a
 *   bound provider is not in use — never a fabricated "works"; the
 *   single frozen ADD action; the honest empty-state sentence).
 * - ADD/BIND runs the R22-C `byomBindCommandProblems` pre-flight (the
 *   service's own rules, mirrored client-side so the form renders the
 *   SAME honest field errors before the round trip), then the existing
 *   `bindByomProvider` operation through the Desktop's session-scoped
 *   transport. The key is the SECRET ON ITS WAY IN (the transport seals
 *   it server-side; the answer is the secret-free handle ONLY) — after
 *   submission the key NEVER appears in any view this surface can answer
 *   (the machine-checked R22-C secret law applies).
 * - REMOVE/UNBIND runs the existing `unbindByomProvider` operation (the
 *   vault's delete discipline) with the R22-C `byomManagementRecovery`
 *   mapping on every transport failure — never a dead end.
 * - THE PER-TASK PRIVACY CONTROL writes the existing `writeModelPolicy`
 *   operation (the effective class the R22-C view already derived).
 * - LOCAL-MODEL AVAILABILITY is the registry's own truth (the
 *   first-party local rows — "Runs on this device"), carried with the
 *   frozen platform note (Desktop carries local-model execution; the
 *   Web app serves the same actions through its service providers).
 *   The Desktop NATIVE AFFORDANCE is the ADD form's local-serving
 *   endpoint hints: well-known local serving addresses offered as INPUT
 *   SUGGESTIONS (clearly labeled suggestions — the user edits/confirms;
 *   the capability truth stays in the registry's availability, never a
 *   fabricated claim from a hint).
 *
 * SESSION TRUTH: BYOM bindings and policies belong to the account — the
 * surface reads/writes through the session-scoped transport (the token
 * supplier the composition wires to the first-run surface's session). An
 * anonymous composition answers the typed sign-in-again recovery (the
 * same law the connect flows keep), never a silent no-op.
 *
 * An UNBOUND composition answers the honest typed verdicts (the
 * optional-block doctrine).
 */

import type {
  ByomBindCommand,
  ByomManagementRecovery,
  ByomManagementView,
  ModelPolicyCommand,
} from "@wfx/client-runtime";
import type { ModelTask } from "@wfx/domain";
import {
  assertByomManagementSecretFree,
  byomBindCommandProblems,
  byomManagementRecovery,
  byomManagementView,
  isStaleCompletionCopy,
} from "@wfx/client-runtime";

import type { DesktopAuthTransport } from "../platform/auth-transport";

// ---------------------------------------------------------------------------
// The typed operation envelope (every failure has its R22-C recovery)
// ---------------------------------------------------------------------------

/** One typed BYOM management operation failure + its R22-C recovery. */
export interface DesktopByomManagementFailure {
  /** The transport failure family (or the client-side validation). */
  readonly kind:
    | "invalid-input"
    | "network"
    | "unauthorized"
    | "unavailable"
    | "malformed"
    | "anonymous"
    | "unbound";
  readonly detail: string;
  /** The R22-C recovery derivation (the one derivation source). */
  readonly recovery: ByomManagementRecovery;
}

/** The outcome of one add/remove/policy operation. */
export type DesktopByomOperationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: DesktopByomManagementFailure };

// ---------------------------------------------------------------------------
// The local-model truth + the native affordance
// ---------------------------------------------------------------------------

/**
 * The Desktop's local-model availability truth: the registry's own
 * first-party local rows (never a probe, never a fabricated runtime
 * claim) + the frozen platform note.
 */
export interface DesktopLocalModelTruth {
  /** Whether a first-party local model is available in this deployment. */
  readonly available: boolean;
  /** The first-party local provider rows (the R22-C entries, verbatim). */
  readonly rows: readonly ByomManagementView["firstParty"][number][];
  /** The frozen platform note (Desktop carries local-model execution). */
  readonly platformNote: string;
}

/**
 * One local-serving endpoint hint — the Desktop-native ADD-form
 * affordance. A hint is an INPUT SUGGESTION (the user edits/confirms);
 * it is NEVER a capability claim: the actual availability truth lives in
 * the provider registry's rows, and binding against a hint that no local
 * runtime serves fails honestly through the service's own verification.
 */
export interface DesktopLocalEndpointHint {
  /** The suggested endpoint URL (a well-known local serving address). */
  readonly url: string;
  /** The serving runtime's plain name (what the user would have installed). */
  readonly label: string;
  /** One honest sentence naming what this suggestion is (never a claim). */
  readonly detail: string;
}

/** The frozen local-serving hints (suggestions, never capability claims). */
export const DESKTOP_LOCAL_ENDPOINT_HINTS: readonly DesktopLocalEndpointHint[] = [
  {
    url: "http://localhost:11434",
    label: "A local serving app",
    detail:
      "A common address for local model serving apps — edit it if yours listens elsewhere; WebFlix checks what actually answers when the provider is used.",
  },
  {
    url: "http://127.0.0.1:1234",
    label: "Another local serving app",
    detail:
      "Another common local serving address — edit it if yours listens elsewhere; WebFlix checks what actually answers when the provider is used.",
  },
];

/** The frozen platform note (the R21-A matrix's own wording, verbatim). */
export const DESKTOP_LOCAL_MODEL_PLATFORM_NOTE =
  "Local-model execution runs on this Desktop app; the Web app serves the same actions through its service providers.";

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

/** Options for {@link createDesktopModelManagementSurface}. */
export interface DesktopModelManagementOptions {
  /** The Desktop account/source transport (the session-scoped routes). */
  readonly transport: DesktopAuthTransport;
  /** The session token supplier (the composition wires the first-run session). */
  readonly token: () => string | null;
}

/** The Desktop Model & AI management surface (R22-I). */
export interface DesktopModelManagementSurface {
  /** Whether the management block is bound (the honest capability truth). */
  readonly bound: boolean;
  /** The R22-C management view over the CURRENT cached truth (never fetched). */
  managementView(): ByomManagementView;
  /**
   * Refresh the session-scoped truth (the provider registry + every task's
   * policy) and answer the derived R22-C view. An anonymous session
   * answers the view over the honest first-party-only truth (the service
   * law) — the typed recovery rides the operations, not the read.
   */
  refreshManagement(): Promise<ByomManagementView>;
  /**
   * Add/bind your own model provider (the R22-C pre-flight + the existing
   * bindByomProvider operation; the key is the secret ON ITS WAY IN — the
   * answer is the secret-free handle only). Refreshes the view on success.
   */
  addProvider(command: ByomBindCommand): Promise<DesktopByomOperationResult<{ providerId: string }>>;
  /**
   * Remove/unbind one provider (the vault's delete discipline). The
   * imported-feed/library survival laws are unaffected (a model provider
   * owns no content). Refreshes the view on success.
   */
  removeProvider(providerId: string): Promise<DesktopByomOperationResult<{ providerId: string }>>;
  /**
   * Write one task's policy (the per-task privacy control — the effective
   * class the R22-C view derived). Refreshes that task's truth on success.
   */
  setTaskPolicy(task: ModelTask, command: ModelPolicyCommand): Promise<DesktopByomOperationResult<ModelTask>>;
  /** The local-model availability truth (the registry's own rows + the platform note). */
  localModelTruth(): DesktopLocalModelTruth;
  /** The ADD form's local-serving endpoint hints (input suggestions, never claims). */
  localEndpointHints(): readonly DesktopLocalEndpointHint[];
}

function recoveryForOperation(
  operation: "bind" | "unbind",
  kind: DesktopByomManagementFailure["kind"],
): ByomManagementRecovery {
  if (kind === "anonymous") {
    // The session law: BYOM bindings belong to the account — the honest
    // recovery is signing in again (the R22-C unauthorized recovery's
    // family, surfaced before the round trip).
    return {
      kind: "sign-in-again",
      label: "Sign in again",
      detail: "Model providers belong to your account — sign in again and retry.",
    };
  }
  if (kind === "unbound") {
    return {
      kind: "retry",
      label: "Restart the app with the account service connected",
      detail: "This composition did not wire the account flows — the Desktop app needs the service connection.",
    };
  }
  return byomManagementRecovery(operation, { kind, detail: "" });
}

function failureOf(
  operation: "bind" | "unbind",
  kind: DesktopByomManagementFailure["kind"],
  detail: string,
): DesktopByomManagementFailure {
  // The recovery's own detail is the R22-C user copy (the one derivation
  // source — never forked); the transport's raw detail rides the
  // failure's own field for the diagnostics tier (progressive disclosure).
  return { kind, detail, recovery: recoveryForOperation(operation, kind) };
}

function transportKindOf(
  kind: "network" | "unauthorized" | "invalid-input" | "unavailable" | "malformed" | "not-found" | "email-taken" | "invalid-credentials",
): DesktopByomManagementFailure["kind"] {
  switch (kind) {
    case "network":
      return "network";
    case "unauthorized":
      return "unauthorized";
    case "invalid-input":
      return "invalid-input";
    case "unavailable":
    case "not-found":
      return "unavailable";
    default:
      return "malformed";
  }
}

/**
 * Create the bound Desktop Model & AI management surface (the R22-I
 * parity binding). The R22-C derivations render VERBATIM; the
 * Desktop-native affordances are the local-serving endpoint hints ONLY.
 */
export function createDesktopModelManagementSurface(
  options: DesktopModelManagementOptions,
): DesktopModelManagementSurface {
  const { transport, token } = options;

  let providerRows: Parameters<typeof byomManagementView>[0]["providers"] = [];
  let policies: NonNullable<Parameters<typeof byomManagementView>[0]["policies"]> = {};

  function view(): ByomManagementView {
    return byomManagementView({ providers: providerRows, policies: { ...policies } });
  }

  async function refresh(): Promise<ByomManagementView> {
    const current = token();
    if (current === null) {
      // The honest anonymous truth: the service answers first-party
      // providers for anonymous sessions (the BYOM list is empty —
      // never a fabricated one). The view stays over the cached truth.
      return view();
    }
    const read = await transport.readModelProviders(current);
    if (!read.ok) {
      // In-model degradation: the R22-C error status keeps entries
      // visible; the surface caches nothing new.
      return byomManagementView({
        providers: providerRows,
        policies: { ...policies },
        status: {
          state: "error",
          error: {
            kind: transportKindOf(read.failure.kind) === "network" ? "network" : "unavailable",
            detail: read.failure.detail,
          },
        },
      });
    }
    providerRows = read.value;
    // Refresh every task's policy (the per-task privacy truth).
    const tasks = view().taskPolicies.map((policy) => policy.task);
    for (const task of tasks) {
      const policy = await transport.readModelPolicy(current, task);
      if (policy.ok) {
        policies = { ...policies, [task]: policy.value };
      }
      // A failed policy read keeps the cached truth (the honest null
      // stays null until a read proves otherwise).
    }
    return view();
  }

  return {
    bound: true,

    managementView(): ByomManagementView {
      return view();
    },

    async refreshManagement(): Promise<ByomManagementView> {
      return refresh();
    },

    async addProvider(command) {
      const current = token();
      if (current === null) {
        return { ok: false, failure: failureOf("bind", "anonymous", "adding a model provider belongs to your account") };
      }
      // The R22-C pre-flight: the service's own rules, mirrored client-side
      // (the SAME honest field errors before the round trip).
      const problems = byomBindCommandProblems(command);
      if (problems.length > 0) {
        return {
          ok: false,
          failure: failureOf(
            "bind",
            "invalid-input",
            problems.map((problem) => problem.detail).join(" "),
          ),
        };
      }
      const outcome = await transport.bindByomProvider(current, command);
      if (!outcome.ok) {
        return {
          ok: false,
          failure: failureOf("bind", transportKindOf(outcome.failure.kind), outcome.failure.detail),
        };
      }
      // The answer is the secret-free handle ONLY; refresh the view.
      await refresh();
      return { ok: true, value: { providerId: outcome.value.providerId } };
    },

    async removeProvider(providerId) {
      const current = token();
      if (current === null) {
        return { ok: false, failure: failureOf("unbind", "anonymous", "removing a model provider belongs to your account") };
      }
      if (typeof providerId !== "string" || providerId.trim().length === 0) {
        return {
          ok: false,
          failure: failureOf("unbind", "invalid-input", "providerId: expected a non-empty provider id"),
        };
      }
      const outcome = await transport.unbindByomProvider(current, providerId);
      if (!outcome.ok) {
        return {
          ok: false,
          failure: failureOf("unbind", transportKindOf(outcome.failure.kind), outcome.failure.detail),
        };
      }
      await refresh();
      return { ok: true, value: { providerId } };
    },

    async setTaskPolicy(task, command) {
      const current = token();
      if (current === null) {
        return { ok: false, failure: failureOf("bind", "anonymous", "model policies belong to your account") };
      }
      const outcome = await transport.writeModelPolicy(current, command);
      if (!outcome.ok) {
        return {
          ok: false,
          failure: failureOf("bind", transportKindOf(outcome.failure.kind), outcome.failure.detail),
        };
      }
      const refreshed = await transport.readModelPolicy(current, task);
      if (refreshed.ok) {
        policies = { ...policies, [task]: refreshed.value };
      }
      return { ok: true, value: task };
    },

    localModelTruth(): DesktopLocalModelTruth {
      const localRows = view().firstParty.filter((entry) => entry.privacy === "local");
      return {
        available: localRows.some((entry) => entry.availability === "available"),
        rows: localRows,
        platformNote: DESKTOP_LOCAL_MODEL_PLATFORM_NOTE,
      };
    },

    localEndpointHints(): readonly DesktopLocalEndpointHint[] {
      return [...DESKTOP_LOCAL_ENDPOINT_HINTS];
    },
  };
}

// ---------------------------------------------------------------------------
// The unbound surface (the honest typed verdicts)
// ---------------------------------------------------------------------------

/**
 * The UNBOUND management surface: every operation answers the typed
 * unbound verdict; the view is the honest empty R22-C derivation (the
 * built-in model row renders only when the registry actually answered).
 */
export function createUnboundModelManagementSurface(): DesktopModelManagementSurface {
  return {
    bound: false,

    managementView(): ByomManagementView {
      // The honest empty derivation (no fabricated registry rows).
      return byomManagementView({ providers: [] });
    },

    async refreshManagement(): Promise<ByomManagementView> {
      return this.managementView();
    },

    async addProvider() {
      return {
        ok: false,
        failure: failureOf("bind", "unbound", "the first-run block is not wired in this composition (the model-management flows need it)"),
      };
    },

    async removeProvider() {
      return {
        ok: false,
        failure: failureOf("unbind", "unbound", "the first-run block is not wired in this composition (the model-management flows need it)"),
      };
    },

    async setTaskPolicy() {
      return {
        ok: false,
        failure: failureOf("bind", "unbound", "the first-run block is not wired in this composition (the model-management flows need it)"),
      };
    },

    localModelTruth(): DesktopLocalModelTruth {
      return {
        available: false,
        rows: [],
        platformNote: DESKTOP_LOCAL_MODEL_PLATFORM_NOTE,
      };
    },

    localEndpointHints(): readonly DesktopLocalEndpointHint[] {
      return [];
    },
  };
}

// ---------------------------------------------------------------------------
// The copy sweep + the secret-law re-exports (the tests + the evidence)
// ---------------------------------------------------------------------------

/**
 * Gather every user-facing copy string this surface can project (the
 * stale-copy sweep): the R22-C view's own strings over a representative
 * input (the shared derivations' copy — swept here so a shared drift is
 * caught on the Desktop side) + this surface's own frozen strings.
 */
export function modelManagementCopyStrings(input: {
  readonly providers?: Parameters<typeof byomManagementView>[0]["providers"];
  readonly policies?: Parameters<typeof byomManagementView>[0]["policies"];
}): readonly string[] {
  const strings: string[] = [DESKTOP_LOCAL_MODEL_PLATFORM_NOTE];
  for (const hint of DESKTOP_LOCAL_ENDPOINT_HINTS) {
    strings.push(hint.label, hint.detail);
  }
  const derived = byomManagementView({
    providers: input.providers ?? [],
    ...(input.policies !== undefined ? { policies: input.policies } : {}),
  });
  strings.push(derived.addAction.label, derived.addAction.detail);
  if (derived.emptyDetail !== null) strings.push(derived.emptyDetail);
  for (const entry of [...derived.bound, ...derived.firstParty]) {
    strings.push(entry.stateLabel, entry.stateDetail, entry.privacyLabel, entry.action.label, entry.action.detail);
    for (const usability of entry.taskUsability) {
      if (usability.unusableReason !== undefined) strings.push(usability.unusableReason);
    }
  }
  return strings.filter((text) => text.length > 0);
}

/** The Desktop model-management copy sweep primitive (the frozen law). */
export function isStaleModelManagementCopy(text: string): boolean {
  return isStaleCompletionCopy(text);
}

/** The secret-law machine check (re-exported for the surface's tests). */
export { assertByomManagementSecretFree };
