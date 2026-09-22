/**
 * @wfx/model-fabric — the realtime specialist registration table
 * (R25-C: the factory registration into the router's specialist
 * table).
 *
 * THE LAW THIS MODULE FREEZES: registration TRUTH — a realtime
 * provider descriptor that was never bound to a session factory and
 * registered is NOT available (the routeAsr law: capability claims
 * without a real adapter path are drift). The router
 * (`routeRealtimeTranslation`) consumes this table's truth through
 * its `RealtimeRoutingInput` (availableRealtimeProviderIds + the
 * capability profiles); the bridge (R25-D, another lane) resolves
 * the winning provider's factory through this table and opens the
 * session.
 *
 * The table validates every registration (the managed-descriptor
 * law, the specialist-lane law) and rejects duplicate provider ids —
 * the Model Fabric registry precedent. It holds NO protocol
 * knowledge: the Qwen protocol lives in the adapter boundary
 * (`qwen-protocol.ts`); this table is provider-neutral mechanics.
 */

import type { RealtimeTranslationSessionFactory } from "@wfx/domain";

import { validateManagedRealtimeModelDescriptor } from "./provider";
import { routeRealtimeTranslation, type RealtimeRoutingInput } from "./router";
import type { RealtimeTranslationCapabilityProfile } from "./task";

// ---------------------------------------------------------------------------
// The registration entry + the table
// ---------------------------------------------------------------------------

/**
 * One registered realtime specialist: the provider descriptor (the
 * registered-provider record — provenance, capabilities, the rate
 * card) BOUND to its session factory (the adapter's seam). A
 * descriptor without a factory is NOT registrable — registration is
 * the binding, by law.
 */
export interface RealtimeSpecialistRegistration {
  /** The Model Fabric provider id (must match the descriptor's). */
  readonly providerId: string;
  /** The validated managed-provider record. */
  readonly descriptor: import("./provider").ManagedRealtimeModelDescriptor;
  /** The bound session factory (the adapter seam). */
  readonly factory: RealtimeTranslationSessionFactory;
}

/** The typed outcome of registering one specialist. */
export type RealtimeSpecialistRegistrationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Validate one registration entry (pure, fail-closed): a real
 * descriptor object passing the managed-model laws, a providerId
 * that AGREES with the descriptor's, and a callable factory. Drift
 * is rejected with named problems, never coerced.
 */
export function validateRealtimeSpecialistRegistration(
  entry: unknown,
): RealtimeSpecialistRegistrationResult {
  const problems: string[] = [];
  if (
    typeof entry !== "object" ||
    entry === null ||
    !("providerId" in entry) ||
    !("descriptor" in entry) ||
    !("factory" in entry)
  ) {
    return {
      ok: false,
      problems: ["expected { providerId, descriptor, factory } — a registration binds all three"],
    };
  }
  const candidate = entry as {
    providerId: unknown;
    descriptor: unknown;
    factory: unknown;
  };
  if (typeof candidate.providerId !== "string" || candidate.providerId.length === 0) {
    problems.push("providerId: expected a non-empty Model Fabric provider id");
  }
  const descriptorValidation = validateManagedRealtimeModelDescriptor(candidate.descriptor);
  if (!descriptorValidation.ok) {
    problems.push(...descriptorValidation.problems.map((problem) => `descriptor: ${problem}`));
  } else if (
    typeof candidate.providerId === "string" &&
    candidate.providerId !== (candidate.descriptor as { providerId: string }).providerId
  ) {
    problems.push(
      "providerId: must agree with the descriptor's providerId (one identity, one truth)",
    );
  }
  if (
    typeof candidate.factory !== "object" ||
    candidate.factory === null ||
    typeof (candidate.factory as { open?: unknown }).open !== "function"
  ) {
    problems.push("factory: expected a RealtimeTranslationSessionFactory with a callable open()");
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

/**
 * The realtime specialist table — the registration truth the router
 * and the bridge consult. Register entries (validated, duplicate-id
 * rejected); read the provider ids, the capability profiles, and the
 * bound factories. In-memory, no I/O — the Model Fabric registry
 * precedent.
 */
export class RealtimeSpecialistTable {
  private readonly entries = new Map<string, RealtimeSpecialistRegistration>();

  /**
   * Register one specialist. Validation is fail-closed (the entry
   * must pass {@link validateRealtimeSpecialistRegistration}) and
   * duplicate provider ids are REJECTED — re-registration is drift,
   * never a silent overwrite.
   */
  register(entry: RealtimeSpecialistRegistration): RealtimeSpecialistRegistrationResult {
    const validation = validateRealtimeSpecialistRegistration(entry);
    if (!validation.ok) return validation;
    if (this.entries.has(entry.providerId)) {
      return {
        ok: false,
        problems: [
          `providerId '${entry.providerId}' is already registered — re-registration is drift, never a silent overwrite`,
        ],
      };
    }
    this.entries.set(entry.providerId, entry);
    return { ok: true };
  }

  /** The registered provider ids, in registration order (the router's registration truth). */
  providerIds(): readonly string[] {
    return [...this.entries.keys()];
  }

  /** The registered capability profiles, by provider id (the router's capability truth). */
  capabilityProfiles(): Readonly<Record<string, RealtimeTranslationCapabilityProfile>> {
    const profiles: Record<string, RealtimeTranslationCapabilityProfile> = {};
    for (const [providerId, entry] of this.entries) {
      profiles[providerId] = entry.descriptor.capabilityProfile;
    }
    return profiles;
  }

  /** The bound factory for a provider id (undefined = not registered). */
  factoryFor(providerId: string): RealtimeTranslationSessionFactory | undefined {
    return this.entries.get(providerId)?.factory;
  }

  /** The registration entry for a provider id (undefined = not registered). */
  registrationFor(providerId: string): RealtimeSpecialistRegistration | undefined {
    return this.entries.get(providerId);
  }

  /** The registration count (observability). */
  get size(): number {
    return this.entries.size;
  }
}

/** Create an empty realtime specialist table. */
export function createRealtimeSpecialistTable(): RealtimeSpecialistTable {
  return new RealtimeSpecialistTable();
}

// ---------------------------------------------------------------------------
// The routing wiring (the table → the router's input)
// ---------------------------------------------------------------------------

/**
 * Assemble the router's `RealtimeRoutingInput` registration truth
 * from the specialist table plus the live-ASR registration truth the
 * caller supplies (the R23-G lane's own registry) — the one wiring
 * helper the bridge needs to route an realtime request against the
 * REGISTERED truth.
 */
export function realtimeRoutingInputFromSpecialists(
  table: RealtimeSpecialistTable,
  input: {
    readonly workload: "realtime" | "batch";
    readonly request: import("./router").RealtimeRequestProfile;
    readonly availableLiveAsrProviderIds: readonly string[];
    readonly preferredProviderId?: string;
  },
): RealtimeRoutingInput {
  return {
    workload: input.workload,
    request: input.request,
    availableRealtimeProviderIds: table.providerIds(),
    availableLiveAsrProviderIds: input.availableLiveAsrProviderIds,
    ...(input.preferredProviderId !== undefined
      ? { preferredProviderId: input.preferredProviderId }
      : {}),
    realtimeCapabilityProfiles: table.capabilityProfiles(),
  };
}

/**
 * Route one realtime request against the table and resolve the
 * winning provider's factory — the bridge's one-call seam: the typed
 * routing decision (the router's own honest gaps when nothing can
 * serve) plus the bound factory when a realtime provider WON. The
 * factory resolves ONLY for winning decisions — a gap decision may
 * name a provider id for context, but the router just said that
 * provider cannot serve, so it is never resolved (never a
 * half-service).
 */
export function routeRealtimeTranslationAgainstSpecialists(
  table: RealtimeSpecialistTable,
  input: {
    readonly workload: "realtime" | "batch";
    readonly request: import("./router").RealtimeRequestProfile;
    readonly availableLiveAsrProviderIds: readonly string[];
    readonly preferredProviderId?: string;
  },
): ReturnType<typeof routeRealtimeTranslation> & {
  /** The bound factory when the decision names a REGISTERED realtime provider that WON. */
  readonly factory: RealtimeTranslationSessionFactory | undefined;
} {
  const decision = routeRealtimeTranslation(
    realtimeRoutingInputFromSpecialists(table, input),
  );
  const isWinningRealtimeDecision =
    decision.kind === "realtime-translation-specialist" ||
    decision.kind === "realtime-translation-provider" ||
    decision.kind === "provider-policy-choice";
  const providerId = "providerId" in decision ? decision.providerId : undefined;
  const factory =
    isWinningRealtimeDecision && providerId !== undefined ? table.factoryFor(providerId) : undefined;
  return { ...decision, factory };
}
