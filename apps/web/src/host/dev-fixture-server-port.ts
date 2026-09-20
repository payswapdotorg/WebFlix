/**
 * @wfx/app-web — the DEV-ONLY fixture-backed ServerPort (R07).
 *
 * ⚠️ DEVELOPMENT FIXTURE — NEVER PRODUCTION. ⚠️
 *
 * The ServerPort adapter for the `WFX_DEV_FIXTURES=1` dev mode (the 050
 * boot law: the flag is dev-only by contract, machine-guarded against
 * production in `host/config.ts`, and this module is reachable ONLY through
 * that law — no production path constructs it). It adapts the frozen
 * deterministic fixture ports from `@wfx/experience` (`makeFixturePorts`)
 * onto the R01 `ServerPort` interface so the ENTIRE web adapter — bundle,
 * runtime wiring, surfaces — runs identically in dev-fixture and service
 * modes (the same adapter, two honest transports).
 *
 * The R01 typed-failure law applies here too: the fixture connector's
 * answers pass through the SAME payload honesty as the real transport —
 * a thrown port error answers the typed `network` failure, never a
 * degraded empty success.
 *
 * The shorts operation uses the SAME frozen short-form eligibility
 * composition as the production ServerPort (`isShortFormCandidate`) — one
 * law, two transports.
 */

import type {
  ActionReceipt,
  EntertainmentEvent,
  IntentRecord,
  LibraryCommand,
  LibraryEntry,
  ModelPolicy,
  ModelTask,
  PlaybackRealization,
  RecommendationPolicy,
  SearchResult,
  SourceItem,
  UserAction,
} from "@wfx/domain";
import type { ConnectorContext } from "@wfx/domain";
import { makeFixturePorts, type Ports } from "@wfx/experience";
import {
  bindFixtureByom,
  readModelFixtureState,
  unbindFixtureByom,
  writeModelFixtureState,
} from "@/host/model-fixtures";
import { isShortFormCandidate } from "@wfx/experience";
import type {
  ByomBindingCommand,
  ByomBindingHandle,
  ModelPolicyCommand,
  ModelProviderInfo,
  ProfileHistoryEntry,
  RecommendationPolicyCommand,
  RuntimeContext,
  ServerFailure,
  ServerPort,
  ServerResult,
  SourceInfo,
  TransformOperation,
  TransformSubmitCommand,
  UserIntentCommand,
} from "@wfx/client-runtime";

import {
  fixtureSourceInfoOf,
  fixtureSourceReadFailure,
  readFixtureSourceAuthState,
} from "./source-auth-fixtures";

/** Options for {@link createFixtureBackedServerPort}. */
export interface FixtureServerPortOptions {
  /** The fixture ports to adapt (default: `makeFixturePorts()`). */
  readonly ports?: Ports;
  /** The identity context every call is stamped with. */
  readonly context: RuntimeContext;
}

/** The service identity of the fixture binding (loudly named a fixture). */
export const FIXTURE_SERVER_SERVICE_ID = "wfx-dev-fixture-service";

/** The fixture persona's fixed clock instant (deterministic answers). */
const FIXTURE_NOW = "2026-09-18T12:00:00.000Z";

/** The fixture persona's transform target (the fixture catalog's own ref grammar). */
const FIXTURE_TRANSFORM_TARGET = "fake-source:fixture-transform-target";

/**
 * The fixture persona's first-party provider row (the registry truth the
 * Model & AI surface renders in dev — the same `ModelProviderInfo` shape
 * the production transport validates).
 */
const FIXTURE_FIRST_PARTY_PROVIDER: ModelProviderInfo = {
  id: "wfx-first-party",
  privacy: "local",
  capabilities: ["recommendation", "ranking", "summary", "translation", "transcription"],
  byomBound: false,
  costs: {
    recommendation: 0,
    ranking: 0,
    summary: 0,
    translation: 0,
    transcription: 0,
  },
  availability: "available",
};

/**
 * The fixture persona's OWN model-controls state (the same double law as
 * its library/search data: writes land in the persona's state; reads
 * answer it — the honest unset policy stays null). R22-F: the state is
 * FILE-BACKED (model-fixtures.ts) — the Turbopack dev server compiles
 * route modules and page modules as separate module graphs, so the bind
 * route and the settings page's providers read MUST share a file, never
 * an in-memory Map (the same law the acquisition and source-auth
 * fixtures follow). The journey runner deletes the file per run for
 * determinism.
 */
const transforms = new Map<string, TransformOperation>();
let transformCounter = 1;

/** Create the DEV-ONLY fixture-backed ServerPort. */
export function createFixtureBackedServerPort(options: FixtureServerPortOptions): ServerPort {
  const ports = options.ports ?? makeFixturePorts();
  const ctx = toConnectorContext(options.context);

  // R17 — the scripted source-authorization read: the fixtures' own source
  // truth (the J28 lifecycle), read fresh from the shared state per call.
  // The row answers the REAL SourceInfo shape the runtime validates.
  const readSources = async (): Promise<ServerResult<readonly SourceInfo[]>> => {
    return { ok: true, value: [fixtureSourceInfoOf(readFixtureSourceAuthState())] };
  };

  // R17 — the typed unauthorized read guard: an EXPIRED or SIGNED-OUT
  // scripted authorization refuses the source's reads with the CLASSIFIED
  // credential failure (never a silent fallback, never a fake success).
  const readGuard = (): ServerFailure | null => fixtureSourceReadFailure();

  return {
    serviceId: FIXTURE_SERVER_SERVICE_ID,
    readSources,

    async search(query: string): Promise<ServerResult<readonly SearchResult[]>> {
      const refusal = readGuard();
      if (refusal !== null) return { ok: false, failure: refusal };
      try {
        return { ok: true, value: await ports.connector.search(ctx, query) };
      } catch (thrown) {
        return { ok: false, failure: networkFailure("search", thrown) };
      }
    },

    async shorts(query?: string): Promise<ServerResult<readonly SearchResult[]>> {
      const refusal = readGuard();
      if (refusal !== null) return { ok: false, failure: refusal };
      try {
        // The same frozen short-form eligibility law as the production
        // port (one law, two transports).
        const hits = await ports.connector.search(ctx, query ?? "");
        const shortForm: SearchResult[] = [];
        for (const hit of hits) {
          if (
            isShortFormCandidate({
              id: "wfxitm_shorts_projection",
              canonicalType: hit.canonicalType ?? "video",
              ...(hit.orientation !== undefined ? { orientation: hit.orientation } : {}),
              ...(hit.durationMs !== undefined ? { durationMs: hit.durationMs } : {}),
            })
          ) {
            shortForm.push(hit);
          }
        }
        return { ok: true, value: shortForm };
      } catch (thrown) {
        return { ok: false, failure: networkFailure("shorts", thrown) };
      }
    },

    async metadata(ref: string): Promise<ServerResult<SourceItem | null>> {
      const refusal = readGuard();
      if (refusal !== null) return { ok: false, failure: refusal };
      try {
        return { ok: true, value: await ports.connector.metadata(ctx, ref) };
      } catch (thrown) {
        return { ok: false, failure: networkFailure("metadata", thrown) };
      }
    },

    async resolve(ref: string): Promise<ServerResult<readonly PlaybackRealization[]>> {
      const refusal = readGuard();
      if (refusal !== null) return { ok: false, failure: refusal };
      try {
        return { ok: true, value: await ports.connector.resolve(ctx, ref) };
      } catch (thrown) {
        return { ok: false, failure: networkFailure("resolve", thrown) };
      }
    },

    async executeAction(action: UserAction): Promise<ServerResult<ActionReceipt>> {
      try {
        return { ok: true, value: await ports.connector.executeAction(ctx, action) };
      } catch (thrown) {
        return { ok: false, failure: networkFailure("executeAction", thrown) };
      }
    },

    async readLibrary(): Promise<ServerResult<readonly LibraryEntry[]>> {
      // The frozen ConnectorPort declares the library methods OPTIONAL; a
      // fixture connector without them answers the typed unavailable —
      // never a fabricated empty library.
      if (ports.connector.readLibrary === undefined) {
        return {
          ok: false,
          failure: {
            kind: "unavailable",
            detail: "the fixture connector does not implement readLibrary (the optional frozen port)",
          },
        };
      }
      try {
        return { ok: true, value: await ports.connector.readLibrary(ctx) };
      } catch (thrown) {
        return { ok: false, failure: networkFailure("readLibrary", thrown) };
      }
    },

    async writeLibrary(command: LibraryCommand): Promise<ServerResult<ActionReceipt>> {
      if (ports.connector.writeLibrary === undefined) {
        return {
          ok: false,
          failure: {
            kind: "unavailable",
            detail: "the fixture connector does not implement writeLibrary (the optional frozen port)",
          },
        };
      }
      try {
        return { ok: true, value: await ports.connector.writeLibrary(ctx, command) };
      } catch (thrown) {
        return { ok: false, failure: networkFailure("writeLibrary", thrown) };
      }
    },

    async emitEvent(event: EntertainmentEvent): Promise<ServerResult<void>> {
      try {
        await ports.events.emit(event);
        return { ok: true, value: undefined };
      } catch (thrown) {
        // The EVENT SINK LAW: a lost watch-state event is never a silent
        // success — the failure answers and the runtime keeps it pending.
        return { ok: false, failure: networkFailure("emitEvent", thrown) };
      }
    },

    // — the R02 profile extension (ADD-ONLY): the fixture is a DOUBLE with
    // its OWN persona state (exactly like its fixture search/library data),
    // not a transport to a real service — so the honest fixture answer for
    // the profile reads is the fixture persona's own EMPTY state, and the
    // intent/policy writes are accepted into the void the fixture owns.
    // The local-first fold (the R07 surface story: saves land, watch events
    // fold into history) renders unchanged; the production port keeps the
    // 404→unavailable honesty law for the real endpoints (R04/R05 landing).

    async readHistory(): Promise<ServerResult<readonly ProfileHistoryEntry[]>> {
      return { ok: true, value: [] };
    },

    async readProfileLibrary(): Promise<ServerResult<readonly LibraryEntry[]>> {
      return { ok: true, value: [] };
    },

    async readIntents(): Promise<ServerResult<readonly IntentRecord[]>> {
      return { ok: true, value: [] };
    },

    async writeIntent(_intent: UserIntentCommand): Promise<ServerResult<void>> {
      return { ok: true, value: undefined };
    },

    async readPolicy(): Promise<ServerResult<RecommendationPolicy | null>> {
      return { ok: true, value: null };
    },

    async writePolicy(_policy: RecommendationPolicyCommand): Promise<ServerResult<void>> {
      return { ok: true, value: undefined };
    },

    // — the R06 model-controls extension (R21-B): the fixture is a DOUBLE
    // with its OWN persona state (exactly like its search/library data):
    // the first-party provider registry's truth, the persona's honest
    // unset policies, accepted writes into the persona's own state, and
    // deterministic transform operations. The SAME control paths the
    // production transport serves run against this double in dev (the
    // fixtures-boot journey harness consumes them); service mode never
    // touches this code.

    async readModelPolicy(task: ModelTask): Promise<ServerResult<ModelPolicy | null>> {
      return { ok: true, value: readModelFixtureState().policies[task] ?? null };
    },

    async writeModelPolicy(command: ModelPolicyCommand): Promise<ServerResult<void>> {
      const state = readModelFixtureState();
      writeModelFixtureState({
        ...state,
        policies: {
          ...state.policies,
          [command.task]: {
            task: command.task,
            fallbackProviders: [...command.fallbackProviders],
            privacy: command.privacy,
            ...(command.preferredProvider !== undefined ? { preferredProvider: command.preferredProvider } : {}),
            ...(command.maxCostPerOperation !== undefined ? { maxCostPerOperation: command.maxCostPerOperation } : {}),
          },
        },
      });
      return { ok: true, value: undefined };
    },

    async readModelProviders(): Promise<ServerResult<readonly ModelProviderInfo[]>> {
      // The first-party truth + the persona's BOUND BYOM rows (the file's
      // bindings projected into the REAL ModelProviderInfo shape — the
      // registry a user sees after add/remove is the honest file truth).
      const state = readModelFixtureState();
      const bound: readonly ModelProviderInfo[] = Object.entries(state.byomBindings).map(
        ([providerId, binding]) => ({
          id: providerId,
          privacy: "cloud",
          capabilities: [...binding.capabilities],
          byomBound: true,
          costs: {},
          availability: "available",
        }),
      );
      return { ok: true, value: [FIXTURE_FIRST_PARTY_PROVIDER, ...bound] };
    },

    async bindByomProvider(command: ByomBindingCommand): Promise<ServerResult<ByomBindingHandle>> {
      const { bindingId, binding } = bindFixtureByom({
        providerId: command.providerId,
        endpointUrl: command.endpointUrl,
        capabilities: command.capabilities ?? [],
        now: FIXTURE_NOW,
      });
      return {
        ok: true,
        value: {
          id: bindingId,
          providerId: command.providerId,
          endpointUrl: command.endpointUrl,
          keyId: "wfxkey_fixture",
          metadata: command.metadata ?? null,
          createdAt: binding.createdAt,
          updatedAt: binding.updatedAt,
        },
      };
    },

    async unbindByomProvider(providerId: string): Promise<ServerResult<void>> {
      if (!unbindFixtureByom(providerId)) {
        return {
          ok: false,
          failure: {
            kind: "unavailable",
            detail: `no BYOM binding for provider '${providerId}' (fixture persona)`,
          },
        };
      }
      return { ok: true, value: undefined };
    },

    async submitTransform(command: TransformSubmitCommand): Promise<ServerResult<TransformOperation>> {
      const id = `wfxtx_${String(transformCounter).padStart(26, "0")}`;
      transformCounter += 1;
      const operation: TransformOperation = {
        id,
        kind: command.kind,
        targetRef: FIXTURE_TRANSFORM_TARGET,
        options: (command.options as Record<string, unknown>) ?? {},
        state: "queued",
        progress: null,
        resultRef: null,
        errorDetail: null,
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
      };
      transforms.set(id, operation);
      return { ok: true, value: operation };
    },

    async readTransform(operationId: string): Promise<ServerResult<TransformOperation>> {
      const operation = transforms.get(operationId);
      if (operation === undefined) {
        return {
          ok: false,
          failure: { kind: "unavailable", detail: `transform '${operationId}' not found (fixture persona)` },
        };
      }
      return { ok: true, value: operation };
    },

    async cancelTransform(operationId: string): Promise<ServerResult<TransformOperation>> {
      const operation = transforms.get(operationId);
      if (operation === undefined) {
        return {
          ok: false,
          failure: { kind: "unavailable", detail: `transform '${operationId}' not found (fixture persona)` },
        };
      }
      if (operation.state === "succeeded" || operation.state === "failed" || operation.state === "cancelled") {
        return {
          ok: false,
          failure: { kind: "malformed", detail: `transform '${operationId}' is already terminal (${operation.state})` },
        };
      }
      const cancelled: TransformOperation = { ...operation, state: "cancelled", updatedAt: FIXTURE_NOW };
      transforms.set(operationId, cancelled);
      return { ok: true, value: cancelled };
    },

    async clearTransformResult(operationId: string): Promise<ServerResult<TransformOperation>> {
      const operation = transforms.get(operationId);
      if (operation === undefined) {
        return {
          ok: false,
          failure: { kind: "unavailable", detail: `transform '${operationId}' not found (fixture persona)` },
        };
      }
      if (operation.state !== "succeeded") {
        return {
          ok: false,
          failure: { kind: "malformed", detail: `transform '${operationId}' is not in the succeeded state (${operation.state})` },
        };
      }
      const cleared: TransformOperation = { ...operation, resultRef: null, updatedAt: FIXTURE_NOW };
      transforms.set(operationId, cleared);
      return { ok: true, value: cleared };
    },
  };
}

/** Map the runtime context onto the frozen connector context shape. */
function toConnectorContext(
  context: RuntimeContext,
): ConnectorContext & { readonly sessionId?: string } {
  // The frozen `ConnectorContext` is the structural subset; `sessionId`
  // rides along exactly as the HTTP transport carries it (the header law).
  return {
    userId: context.userId,
    locale: context.locale,
    ...(context.region !== undefined ? { region: context.region } : {}),
    sessionId: context.sessionId,
  };
}

/** The typed network failure of a thrown port call (the honest mapping). */
function networkFailure(operation: string, thrown: unknown): { kind: "network"; detail: string } {
  return {
    kind: "network",
    detail: `fixture transport '${operation}' failed: ${
      thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown)
    }`,
  };
}
