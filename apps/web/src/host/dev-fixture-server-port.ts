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
  PlaybackRealization,
  RecommendationPolicy,
  SearchResult,
  SourceItem,
  UserAction,
} from "@wfx/domain";
import type { ConnectorContext } from "@wfx/domain";
import { makeFixturePorts, type Ports } from "@wfx/experience";
import { isShortFormCandidate } from "@wfx/experience";
import type {
  ProfileHistoryEntry,
  RecommendationPolicyCommand,
  RuntimeContext,
  ServerPort,
  ServerResult,
  UserIntentCommand,
} from "@wfx/client-runtime";

/** Options for {@link createFixtureBackedServerPort}. */
export interface FixtureServerPortOptions {
  /** The fixture ports to adapt (default: `makeFixturePorts()`). */
  readonly ports?: Ports;
  /** The identity context every call is stamped with. */
  readonly context: RuntimeContext;
}

/** The service identity of the fixture binding (loudly named a fixture). */
export const FIXTURE_SERVER_SERVICE_ID = "wfx-dev-fixture-service";

/** Create the DEV-ONLY fixture-backed ServerPort. */
export function createFixtureBackedServerPort(options: FixtureServerPortOptions): ServerPort {
  const ports = options.ports ?? makeFixturePorts();
  const ctx = toConnectorContext(options.context);

  return {
    serviceId: FIXTURE_SERVER_SERVICE_ID,

    async search(query: string): Promise<ServerResult<readonly SearchResult[]>> {
      try {
        return { ok: true, value: await ports.connector.search(ctx, query) };
      } catch (thrown) {
        return { ok: false, failure: networkFailure("search", thrown) };
      }
    },

    async shorts(query?: string): Promise<ServerResult<readonly SearchResult[]>> {
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
      try {
        return { ok: true, value: await ports.connector.metadata(ctx, ref) };
      } catch (thrown) {
        return { ok: false, failure: networkFailure("metadata", thrown) };
      }
    },

    async resolve(ref: string): Promise<ServerResult<readonly PlaybackRealization[]>> {
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
