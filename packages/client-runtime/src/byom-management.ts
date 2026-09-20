/**
 * @wfx/client-runtime — the BYOM management contract (R22-C).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-major-journey-hardening-plan.md — F8): "BYOM is
 * complete only when a user can DISCOVER, CONFIGURE, VERIFY, and REMOVE a
 * provider through normal product surfaces, with secrets kept
 * server-side." The runtime operations already exist (the R21-C
 * model-controls store: `readModelProviders` / `bindByomProvider` /
 * `unbindByomProvider` / `writeModelPolicy` over the Experience API's
 * `/experience/model-providers/**` routes); what F8 found missing is the
 * UI-READY SHARED MANAGEMENT MODEL over them. This module is that model —
 * the seam Worker 2 (R22-F) extends Settings → Model & AI with and
 * Worker 3 (R22-I) mirrors in the Desktop management surface. NO new
 * provider SDK, no new runtime operation, no architecture dashboard: the
 * contextual AI tray stays the place to USE AI; Settings stays the place
 * to MANAGE model providers and policies.
 *
 * WHAT THE VIEW CARRIES (the plan's enumeration, typed):
 *
 * - PROVIDER BINDING SUMMARY — {@link ByomManagementView.bound}: one
 *   secret-free entry per BYOM-bound provider (the registry's `byomBound`
 *   rows), with supported task capabilities, declared costs, privacy
 *   mode, availability truth, and the REMOVE action.
 * - SUPPORTED TASK CAPABILITIES — per entry, the frozen `ModelTask` set
 *   the binding declares (the "see actual capabilities" law applied to
 *   models: no capability is claimed without the provider row declaring
 *   it).
 * - PRIVACY MODE — per entry (`local` | `cloud`, user-labeled) AND per
 *   task ({@link ByomTaskPolicyView}: the stored policy's privacy class
 *   or the HONEST null when unset, with the fail-closed effective class —
 *   the fabric's law: an unset policy behaves `local-only`, so user media
 *   never leaves the machine unless explicitly allowed).
 * - PROVIDER AVAILABILITY — the registry row's `available | unsupported`
 *   truth (never guessed, never fabricated as available).
 * - ADD/BIND — the typed {@link ByomBindCommand} validation
 *   ({@link byomBindCommandProblems}, mirroring the service's own rules)
 *   + the view's single primary ADD action; the command's key is the
 *   secret ON ITS WAY IN (the transport seals it server-side — plaintext
 *   never at rest; the answer is the secret-free handle ONLY).
 * - VERIFY/USABLE — {@link ByomProviderEntry.taskUsability}: per declared
 *   task, whether the provider can actually serve it HERE (capability
 *   declared + provider available + privacy compatible with the task's
 *   effective policy class). A bound-but-unusable provider names WHY
 *   (e.g. "your policy for this task only uses local models") — the
 *   verify truth after `refreshProviders()`, never a fabricated "works".
 * - REMOVE/UNBIND — the per-entry typed REMOVE action over the existing
 *   `unbindByomProvider` operation (the vault's delete discipline).
 * - TYPED ERRORS/RECOVERY — {@link byomManagementRecovery}: the closed
 *   mapping from the transport's typed failures (and the client-side
 *   validation) to the honest recovery next action — never a dead end.
 *
 * THE SECRET LAW (machine-checked): the provider key exists ONLY in the
 * bind command; the management view is built from the registry rows +
 * policies (both secret-free by construction) and
 * {@link assertByomManagementSecretFree} is the belt-and-suspenders proof
 * (the client-side twin of the API boundary's
 * `assertNoCredentialMaterial`).
 *
 * DETERMINISM: pure validation + pure derivations (the control-views.ts
 * law — plain serializable data; adapters render, never re-derive). No
 * clock, no ids, no fetching.
 */

import type { ModelPolicy, ModelTask } from "@wfx/domain";
import { isRecord } from "@wfx/domain";

import type { ModelSectionStatus, SemanticStateTone } from "./models";
import { readySection } from "./models";
import type {
  ByomBindingCommand,
  ModelProviderInfo,
  ServerFailure,
} from "./server-port";
import { assertNoSecretMaterial } from "./secret-guard";

// ---------------------------------------------------------------------------
// The frozen ModelTask mirror (the domain exports the type; this is the
// runtime-side runtime-checkable list — the fabric's `satisfies` discipline)
// ---------------------------------------------------------------------------

/** Every frozen ModelTask, in frozen-contract order (compile-covered). */
export const BYOM_MODEL_TASKS = [
  "recommendation",
  "ranking",
  "summary",
  "translation",
  "transcription",
  "speechToText",
  "textToSpeech",
  "dubbing",
  "commentary",
] as const satisfies readonly ModelTask[];

/** Runtime membership check against the frozen ModelTask union. */
export function isByomModelTask(x: unknown): x is ModelTask {
  return typeof x === "string" && (BYOM_MODEL_TASKS as readonly string[]).includes(x);
}

// ---------------------------------------------------------------------------
// The provider-row structural guard (garbage never becomes a provider entry)
// ---------------------------------------------------------------------------

/**
 * Structural guard for a claimed provider-registry row (the port's
 * `readModelProviders` answer): a malformed row is skipped by the view
 * derivation (the same documented law the sources store keeps for broken
 * /sources rows) — never rendered, never a fabricated capability.
 */
export function isUsableModelProviderRow(value: unknown): value is ModelProviderInfo {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (value.privacy !== "local" && value.privacy !== "cloud") return false;
  if (!Array.isArray(value.capabilities) || !value.capabilities.every(isByomModelTask)) {
    return false;
  }
  if (typeof value.byomBound !== "boolean") return false;
  if (!isRecord(value.costs)) return false;
  for (const cost of Object.values(value.costs)) {
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return false;
  }
  if (value.availability !== "available" && value.availability !== "unsupported") {
    return false;
  }
  // The privacy law at this boundary too: a row carrying key material is
  // unusable, never a provider entry.
  if ("key" in value || "secret" in value || "apiKey" in value) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The bind command + the shared validation (mirrors the service's rules)
// ---------------------------------------------------------------------------

/**
 * The BYOM bind command (the wire shape `PUT /experience/model-providers/
 * byom/:providerId` takes — structurally the runtime's existing
 * `ByomBindingCommand`). The `key` is the SECRET on its way IN; the
 * transport seals it and answers the secret-free handle ONLY.
 */
export type ByomBindCommand = ByomBindingCommand;

/**
 * The typed problems of a bind command (every problem collected — the
 * 400 channel's body, mirrored client-side so the form renders the SAME
 * honest field errors before the round trip). Mirrors the service's own
 * `byomBindingCommandProblems` rules exactly, plus the providerId path
 * segment's rule.
 */
export interface ByomBindProblem {
  readonly field: "providerId" | "endpointUrl" | "key" | "capabilities" | "costPerCall";
  readonly detail: string;
}

/**
 * Validate one BYOM bind command (PURE; the service's own rules — an
 * absolute http(s) endpointUrl of at most 2048 characters, a non-empty
 * key, capabilities within the frozen ModelTask set when present, a
 * finite non-negative costPerCall when present, and a non-empty
 * providerId). Never invents a stricter policy than the service enforces.
 */
export function byomBindCommandProblems(command: ByomBindCommand): readonly ByomBindProblem[] {
  const problems: ByomBindProblem[] = [];
  if (
    typeof command?.providerId !== "string" ||
    command.providerId.trim().length === 0
  ) {
    problems.push({
      field: "providerId",
      detail: "Name your provider — a short label you'll recognize.",
    });
  }
  if (
    typeof command?.endpointUrl !== "string" ||
    !/^https?:\/\//i.test(command.endpointUrl) ||
    command.endpointUrl.length > 2048
  ) {
    problems.push({
      field: "endpointUrl",
      detail: "Enter the provider's full web address (starting with http:// or https://).",
    });
  }
  if (typeof command?.key !== "string" || command.key.trim().length === 0) {
    problems.push({
      field: "key",
      detail: "Paste your provider key — it is stored encrypted and never shown again.",
    });
  }
  if (
    command?.capabilities !== undefined &&
    (!Array.isArray(command.capabilities) ||
      !command.capabilities.every((task) => isByomModelTask(task)))
  ) {
    problems.push({
      field: "capabilities",
      detail: "Capabilities, when chosen, must be tasks from the supported list.",
    });
  }
  if (
    command?.costPerCall !== undefined &&
    (typeof command.costPerCall !== "number" ||
      !Number.isFinite(command.costPerCall) ||
      command.costPerCall < 0)
  ) {
    problems.push({
      field: "costPerCall",
      detail: "Cost per call, when provided, must be a non-negative number.",
    });
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The typed recovery mapping (bind/unbind failures — never a dead end)
// ---------------------------------------------------------------------------

/** The BYOM management operation a failure recovery refers to. */
export type ByomManagementOperation = "bind" | "unbind";

/** The typed recovery next action of a BYOM management failure. */
export interface ByomManagementRecovery {
  readonly kind: "fix-and-retry" | "retry" | "sign-in-again" | "refresh-list";
  /** The recovery control's label (user vocabulary). */
  readonly label: string;
  /** One honest sentence naming the next step. */
  readonly detail: string;
}

/**
 * The frozen recovery mapping for a transport failure of bind/unbind
 * (PURE; total over the `ServerFailure` kinds + the client-side
 * `invalid-input`): a network loss answers RETRY; an unauthorized
 * answers SIGN IN AGAIN (BYOM bindings belong to the account); an
 * unavailable/malformed answer answers RETRY with the honest
 * nothing-was-saved truth.
 */
export function byomManagementRecovery(
  operation: ByomManagementOperation,
  failure: ServerFailure | { readonly kind: "invalid-input"; readonly detail: string },
): ByomManagementRecovery {
  const what =
    operation === "bind"
      ? "The provider wasn't added"
      : "The provider wasn't removed";
  switch (failure.kind) {
    case "invalid-input":
      return {
        kind: "fix-and-retry",
        label: "Fix and try again",
        detail: `${what} — check the highlighted fields and try again.`,
      };
    case "network":
      return {
        kind: "retry",
        label: "Try again",
        detail: `${what} — WebFlix couldn't reach the service; check your connection and try again.`,
      };
    case "unauthorized":
      return {
        kind: "sign-in-again",
        label: "Sign in again",
        detail: `${what} — model providers belong to your account; sign in again and retry.`,
      };
    case "unavailable":
      return {
        kind: "retry",
        label: "Try again",
        detail: `${what} — the service can't save model providers right now; try again in a moment.`,
      };
    case "malformed":
      return {
        kind: "retry",
        label: "Try again",
        detail: `${what} — the service answered unexpectedly; nothing was saved.`,
      };
  }
}

// ---------------------------------------------------------------------------
// The management view (the UI-ready read model)
// ---------------------------------------------------------------------------

/** The semantic tone of a BYOM management state (the shared vocabulary). */
export type ByomManagementTone = SemanticStateTone;

/** One task's usability truth on one provider (the verify/usable seam). */
export interface ByomTaskUsability {
  readonly task: ModelTask;
  /** Whether the provider can actually serve this task HERE. */
  readonly usable: boolean;
  /** Present iff unusable: the honest reason (never a fabricated "works"). */
  readonly unusableReason?: string;
}

/** The typed action kinds a BYOM entry or the panel offers. */
export type ByomManagementActionKind =
  /** Add/bind a provider (the panel's single primary action). */
  | "add"
  /** Remove/unbind a bound provider (the per-entry action). */
  | "remove"
  /** No action (first-party rows: managed by the product, not the user). */
  | "none";

/** One typed management action + its honest user-language control text. */
export interface ByomManagementAction {
  readonly kind: ByomManagementActionKind;
  readonly label: string;
  readonly detail: string;
}

/**
 * One provider entry in the management view — the binding summary (when
 * BYOM-bound) or the first-party context row (the local model every
 * deployment has). SECRET-FREE by construction (built from the registry
 * row; the key never appears — machine-checked).
 */
export interface ByomProviderEntry {
  readonly providerId: string;
  /** Whether this is a user-bound BYOM provider (true) or first-party (false). */
  readonly bound: boolean;
  /** Where the provider runs (the privacy mode truth). */
  readonly privacy: "local" | "cloud";
  /** The privacy mode's user label. */
  readonly privacyLabel: string;
  /** The frozen ModelTask set the provider declares (supported capabilities). */
  readonly capabilities: readonly ModelTask[];
  /** The declared cost per operation, per task (absent tasks not in the map). */
  readonly costs: Readonly<Record<string, number>>;
  /** The availability truth (available | unsupported — never guessed). */
  readonly availability: "available" | "unsupported";
  /** The entry's state label (user vocabulary). */
  readonly stateLabel: string;
  /** One honest sentence about the entry's state. */
  readonly stateDetail: string;
  /** The semantic tone (the frozen design-language state-color hint). */
  readonly tone: ByomManagementTone;
  /** Per declared task: whether the provider can actually serve it here + why not. */
  readonly taskUsability: readonly ByomTaskUsability[];
  /** The typed action this entry offers (remove for bound; none for first-party). */
  readonly action: ByomManagementAction;
}

/**
 * One task's privacy-mode truth: the stored policy's class (the HONEST
 * null when unset) + the fail-closed EFFECTIVE class (the fabric's law:
 * unset behaves local-only) + the preferred provider. The surface renders
 * this as the per-task privacy control's current truth.
 */
export interface ByomTaskPolicyView {
  readonly task: ModelTask;
  /** The stored policy's privacy class, or null when unset (never a fabricated default). */
  readonly policyPrivacy: ModelPolicy["privacy"] | null;
  /** The effective class: the stored one, or local-only when unset (fail-closed). */
  readonly effectivePrivacy: ModelPolicy["privacy"];
  /** The stored policy's preferred provider (null when unset/none). */
  readonly preferredProvider: string | null;
}

/** The BYOM management view (the Settings → Model & AI panel's complete data). */
export interface ByomManagementView {
  /** The providers read's status (in-model degradation: an error keeps entries visible). */
  readonly status: ModelSectionStatus;
  /** The panel's single primary action: add/bind your own model provider. */
  readonly addAction: ByomManagementAction;
  /** The BYOM-bound providers (the binding summary). */
  readonly bound: readonly ByomProviderEntry[];
  /** The first-party providers (the local-model context every deployment has). */
  readonly firstParty: readonly ByomProviderEntry[];
  /** The per-task privacy-mode truth (every frozen task, in frozen order). */
  readonly taskPolicies: readonly ByomTaskPolicyView[];
  /**
   * Present iff the read is ready and NO BYOM provider is bound yet: the
   * honest empty-state sentence (present tense — never a stale "arrives
   * later" claim).
   */
  readonly emptyDetail: string | null;
}

/** The frozen user-language privacy-mode labels (the one derivation source). */
export const BYOM_PRIVACY_LABELS: Readonly<Record<"local" | "cloud", string>> = {
  local: "Runs on this device",
  cloud: "Runs at your provider (cloud)",
};

/** The frozen user-language privacy-class labels (the policy classes). */
export const BYOM_POLICY_PRIVACY_LABELS: Readonly<
  Record<ModelPolicy["privacy"], string>
> = {
  "local-only": "Local models only",
  "trusted-cloud": "Local and trusted cloud models",
  "any-cloud": "Any cloud model",
};

/** The panel's single primary action (the design language: one obvious primary action). */
export const BYOM_ADD_ACTION: ByomManagementAction = {
  kind: "add",
  label: "Add your model provider",
  detail:
    "Bring your own model: paste your provider's web address and key — the key is stored encrypted and never shown again.",
};

/** The honest empty-state sentence (no BYOM provider bound yet). */
export const BYOM_EMPTY_DETAIL =
  "No model provider of your own is added yet — WebFlix's built-in local model keeps working, and you can add your own provider anytime.";

/** The frozen task-capability user labels (the one derivation source). */
export const BYOM_TASK_LABELS: Readonly<Record<ModelTask, string>> = {
  recommendation: "Recommendations",
  ranking: "Ranking",
  summary: "Summaries",
  translation: "Translation",
  transcription: "Transcription",
  speechToText: "Speech to text",
  textToSpeech: "Text to speech",
  dubbing: "Dubbing",
  commentary: "Commentary",
};

function byProviderId(a: ByomProviderEntry, b: ByomProviderEntry): number {
  return a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0;
}

/**
 * Derive one provider's per-task usability (PURE — the verify/usable
 * truth): a task is usable iff the provider declares it, the provider is
 * available, and the task's EFFECTIVE policy class admits the provider's
 * privacy mode (a local-only task — the fail-closed default when unset —
 * never routes to a cloud provider). An unusable row names WHY.
 */
function taskUsabilityOf(
  provider: ModelProviderInfo,
  effectivePrivacy: (task: ModelTask) => ModelPolicy["privacy"],
): readonly ByomTaskUsability[] {
  return provider.capabilities.map((task) => {
    if (provider.availability !== "available") {
      return {
        task,
        usable: false,
        unusableReason: "This provider isn't available right now.",
      };
    }
    const policyPrivacy = effectivePrivacy(task);
    if (policyPrivacy === "local-only" && provider.privacy === "cloud") {
      return {
        task,
        usable: false,
        unusableReason: `Your ${BYOM_TASK_LABELS[task].toLowerCase()} policy only uses local models — allow a cloud model there to use this provider.`,
      };
    }
    return { task, usable: true };
  });
}

function entryOf(
  provider: ModelProviderInfo,
  effectivePrivacy: (task: ModelTask) => ModelPolicy["privacy"],
): ByomProviderEntry {
  const taskUsability = taskUsabilityOf(provider, effectivePrivacy);
  const usableCount = taskUsability.filter((row) => row.usable).length;
  const stateLabel =
    provider.byomBound !== true
      ? provider.availability === "available"
        ? "Built-in"
        : "Unavailable"
      : provider.availability !== "available"
        ? "Unavailable"
        : usableCount === 0
          ? "Added — not in use"
          : "Added";
  const stateDetail =
    provider.byomBound !== true
      ? provider.availability === "available"
        ? "WebFlix's built-in model — always available, no setup."
        : "This built-in model isn't available in this deployment."
      : provider.availability !== "available"
        ? "This provider was added but isn't available right now — you can remove it or try again later."
        : usableCount === 0
          ? "This provider is added, but no task can use it under your current policies — check the per-task privacy settings below."
          : `This provider is added and can serve ${usableCount} of ${taskUsability.length} task${taskUsability.length === 1 ? "" : "s"} it declares.`;
  const tone: ByomManagementTone =
    provider.availability !== "available"
      ? "negative"
      : provider.byomBound === true
        ? usableCount === 0
          ? "attention"
          : "positive"
        : "neutral";
  return {
    providerId: provider.id,
    bound: provider.byomBound === true,
    privacy: provider.privacy,
    privacyLabel: BYOM_PRIVACY_LABELS[provider.privacy],
    capabilities: [...provider.capabilities],
    costs: { ...provider.costs },
    availability: provider.availability,
    stateLabel,
    stateDetail,
    tone,
    taskUsability,
    action:
      provider.byomBound === true
        ? {
            kind: "remove",
            label: "Remove",
            detail: "Remove this provider and its stored key — WebFlix's built-in model takes over.",
          }
        : { kind: "none", label: "", detail: "This model is part of WebFlix." },
  };
}

/** The input of {@link byomManagementView}. */
export interface ByomManagementInput {
  /** The observed provider-registry rows (`readModelProviders` / `refreshProviders`). */
  readonly providers: readonly ModelProviderInfo[];
  /** The per-task observed policies (`readModelPolicy` / `refreshPolicy`) — absent task = unset. */
  readonly policies?: Readonly<Partial<Record<ModelTask, ModelPolicy | null>>>;
  /** The providers read's status (defaults to ready; errors keep entries visible). */
  readonly status?: ModelSectionStatus;
}

/**
 * Derive the BYOM management view (PURE — the Settings → Model & AI
 * panel's complete data). Laws kept:
 * - garbage registry rows are skipped (never a fabricated provider);
 * - bound/first-party rows both render (the built-in model stays visible
 *   context — unsupported is not undiscoverable);
 * - usability is DERIVED truth (capability + availability + the task's
 *   fail-closed effective privacy class), never a fabricated "works";
 * - an unset policy is the honest null + the local-only effective class
 *   (the fabric's fail-closed law, surfaced);
 * - the view is SECRET-FREE (assert-able — the machine-checked law).
 */
export function byomManagementView(input: ByomManagementInput): ByomManagementView {
  const status = input.status ?? readySection();
  const policies = input.policies ?? {};

  const effectivePrivacy = (task: ModelTask): ModelPolicy["privacy"] =>
    policies[task]?.privacy ?? "local-only";

  const usable = input.providers.filter(isUsableModelProviderRow);
  const bound: ByomProviderEntry[] = [];
  const firstParty: ByomProviderEntry[] = [];
  for (const provider of usable) {
    const entry = entryOf(provider, effectivePrivacy);
    if (entry.bound) bound.push(entry);
    else firstParty.push(entry);
  }
  bound.sort(byProviderId);
  firstParty.sort(byProviderId);

  const taskPolicies: ByomTaskPolicyView[] = BYOM_MODEL_TASKS.map((task) => {
    const policy = policies[task] ?? null;
    return {
      task,
      policyPrivacy: policy?.privacy ?? null,
      effectivePrivacy: policy?.privacy ?? "local-only",
      preferredProvider: policy?.preferredProvider ?? null,
    };
  });

  return {
    status,
    addAction: BYOM_ADD_ACTION,
    bound,
    firstParty,
    taskPolicies,
    emptyDetail:
      status.state === "ready" && bound.length === 0 ? BYOM_EMPTY_DETAIL : null,
  };
}

// ---------------------------------------------------------------------------
// The secret-free law (machine check)
// ---------------------------------------------------------------------------

/**
 * Assert the BYOM management view carries NO secret material (the
 * machine check of the R22-C secret law — the provider key exists only
 * in the bind command; the view is registry rows + policies, both
 * secret-free by construction). Throws the typed `RuntimeError`
 * (`invalid-input`) naming every offending path.
 */
export function assertByomManagementSecretFree(view: ByomManagementView): void {
  assertNoSecretMaterial(view, "byomManagementView");
}

// ---------------------------------------------------------------------------
// Developer ergonomics (kept honest — never rendered as capability truth)
// ---------------------------------------------------------------------------

/** A short human sentence for a bind problem list (logs/diagnostics only). */
export function describeByomBindProblems(problems: readonly ByomBindProblem[]): string {
  return problems.map((problem) => `${problem.field}: ${problem.detail}`).join("; ");
}
