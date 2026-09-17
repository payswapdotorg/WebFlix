/**
 * @wfx/client-runtime — `createRuntime`, the single public entry (R01).
 *
 * Assembles the shared client runtime over ONE platform capability bundle
 * and ONE server port. The layering law (frozen):
 *
 *     Experience Core -> Shared Client Runtime -> Platform Adapter -> (Web | Desktop | Mobile)
 *
 * The runtime owns navigation, presentation state, playback commands,
 * watch state, library semantics, action state, intent submission, and
 * error-state semantics. It knows NOTHING about Web/Desktop/Mobile
 * implementation details — only the truthful capability declaration and
 * the injected ports. It never fetches (the ServerPort is the only
 * transport), never reads a wall clock, never mints randomness (injected
 * seams), and contains no React (UI-framework-agnostic).
 *
 * Construction law: the capability bundle is TRUTH-CHECKED
 * (`checkCapabilityTruth`); an incoherent bundle (declared level without
 * its port, or vice versa) throws the typed `RuntimeError` — the runtime
 * never boots on a lying adapter. A lifecycle `shutdown` hook is
 * registered to flush the at-least-once watch-event outbox (adapters
 * await async shutdown hooks before exit).
 */

import { isRecord, previewValue } from "@wfx/domain";
import type { PlaybackSession, UserAction } from "@wfx/domain";
import type { PlatformCapabilities } from "@wfx/platform-contracts";
import { checkCapabilityTruth } from "@wfx/platform-contracts";

import {
  ActionEngine,
  type ActionOperations,
  type ActionState,
} from "./actions";
import { RuntimeError } from "./errors";
import { IntentStore, type IntentOperations } from "./intent";
import {
  LibraryEngine,
  type LibraryModel,
  type LibraryOperations,
  type LibraryQuery,
} from "./library";
import {
  type HomeModel,
  type HomeQuery,
  type SearchHit,
  type SearchModel,
  type SearchQuery,
  type ShortsQuery,
  buildContinueWatching,
  errorSection,
  readySection,
} from "./models";
import {
  PlaybackSessionController,
  type PlaybackIntent,
  type PlaybackOperations,
  resolvePlaybackSession,
} from "./playback";
import { CanonicalItemRegistry } from "./registry";
import type { RuntimeClock, RuntimeIdGen } from "./runtime-seams";
import { serverFailureKind } from "./errors";
import type { RuntimeContext, ServerPort, ServerResult } from "./server-port";
import {
  assertSurfaceResolverSeam,
  type SurfaceResolverSeam,
} from "./surface-resolution";
import type { SearchResult } from "@wfx/domain";
import { createNavigationStore, type NavigationController } from "./navigation";
import { createSourceStateStore, type SourceStateOperations } from "./sources";
import {
  WatchStateEngine,
  type WatchEventRetryReport,
  type WatchStateCommand,
  type WatchStateOperations,
} from "./watch-state";

// ---------------------------------------------------------------------------
// Options + the runtime surface
// ---------------------------------------------------------------------------

/** The session bundle `createRuntime` needs beyond the two ports. */
export interface RuntimeSession {
  /** The identity context (stamps every emitted event). */
  readonly context: RuntimeContext;
  /** The clock seam (the runtime never reads a wall clock). */
  readonly clock: RuntimeClock;
  /** The id seam (the runtime never mints randomness). */
  readonly ids: RuntimeIdGen;
}

/**
 * R09: optional runtime wiring beyond the session bundle.
 *
 * `surfaceResolver` — the injected Media Surface resolution seam: the
 * ADAPTER's wiring of the FROZEN resolver (`@wfx/experience`'s
 * `resolveSurface`, whose `SurfaceResolution` satisfies the seam's
 * structural contract without any package dependency). When injected,
 * THE FROZEN PRECEDENCE (Native > Embed > Browser > External) decides
 * playback resolution — the answer's precedence trace rides on the
 * playback state so the adapters render what was chosen and why.
 * Absent ⇒ the runtime's built-in capability-filtered precedence walk
 * (the R01 default, unchanged).
 */
export interface RuntimeOptions {
  /** The Media Surface resolution seam (see the module doc). */
  readonly surfaceResolver?: SurfaceResolverSeam;
}

/** The shared client runtime (the sketch surface + the R01 operations). */
export interface ClientRuntime {
  /** The platform kind (the frozen sketch field). */
  readonly platform: PlatformCapabilities["platform"];
  /** The truthful capability bundle (adapters render honest states from it). */
  readonly capabilities: PlatformCapabilities;

  // — the frozen ClientRuntime sketch surface (contracts.md) —
  getHome(input?: HomeQuery): Promise<HomeModel>;
  search(input: SearchQuery): Promise<SearchModel>;
  resolvePlayback(input: PlaybackIntent): Promise<PlaybackSession>;
  dispatchAction(input: UserAction): Promise<ActionState>;
  updateWatchState(input: WatchStateCommand): Promise<void>;
  library(input?: LibraryQuery): Promise<LibraryModel>;
  setIntent(input: Parameters<IntentStore["set"]>[0]): Promise<void>;
  setRecommendationPolicy(input: Parameters<IntentStore["setPolicy"]>[0]): Promise<void>;

  // — the R01 operations surface (beyond the sketch; see README) —
  /** Navigation + presentation state (owned by the runtime). */
  readonly navigation: NavigationController;
  /** Playback session controllers (prepare/play/pause/seek/stop/observe). */
  readonly playback: PlaybackOperations;
  /** Action-state queries + subscription. */
  readonly actions: ActionOperations;
  /** Watch-state queries + the at-least-once outbox view. */
  readonly watchState: WatchStateOperations;
  /** Library writes (canonical-keyed save/remove) + the local view. */
  readonly libraryOps: LibraryOperations;
  /** The session intent set + attention-mode policy view. */
  readonly intents: IntentOperations;
  /** The shorts feed read (the shorts surface's server operation). */
  shorts(input?: ShortsQuery): Promise<SearchModel>;
  /** Re-attempt every pending watch event (the at-least-once retry). */
  retryPendingWatchEvents(): Promise<WatchEventRetryReport>;
  /**
   * R03: the source-state operations (the settings/sources surface's data —
   * refresh from the server + observe post-flow transitions; the flows
   * themselves run through the adapter's platform UX).
   */
  readonly sources: SourceStateOperations;
}

// ---------------------------------------------------------------------------
// createRuntime
// ---------------------------------------------------------------------------

/**
 * Build the shared client runtime over one platform bundle + one server
 * port. Throws the typed `RuntimeError` (`invalid-input`) when the session
 * bundle or capability bundle is malformed/incoherent — never boots on a
 * lying adapter (see module doc).
 */
export function createRuntime(
  platform: PlatformCapabilities,
  server: ServerPort,
  session: RuntimeSession,
  options?: RuntimeOptions,
): ClientRuntime {
  // — session validation (caller misuse — typed throw) —
  if (!isRecord(session)) {
    throw new RuntimeError("invalid-input", "session: expected a RuntimeSession object");
  }
  const problems: string[] = [];
  if (typeof session.context?.userId !== "string" || session.context.userId.length === 0) {
    problems.push(`session.context.userId: expected a non-empty string, got ${previewValue(session.context?.userId)}`);
  }
  if (typeof session.context?.sessionId !== "string" || session.context.sessionId.length === 0) {
    problems.push(`session.context.sessionId: expected a non-empty string, got ${previewValue(session.context?.sessionId)}`);
  }
  if (typeof session.context?.locale !== "string" || session.context.locale.trim().length === 0) {
    problems.push(`session.context.locale: expected a non-empty string, got ${previewValue(session.context?.locale)}`);
  }
  if (session.context?.region !== undefined && typeof session.context.region !== "string") {
    problems.push(`session.context.region: expected a string when present, got ${previewValue(session.context?.region)}`);
  }
  // R02: the active profile, when the session carries one, must be a sane
  // opaque token (adapters set it from the auth session's selected profile;
  // the runtime never fabricates profile ids).
  if (
    session.context?.profileId !== undefined &&
    (typeof session.context.profileId !== "string" || session.context.profileId.length === 0)
  ) {
    problems.push(
      `session.context.profileId: expected a non-empty string when present, got ${previewValue((session.context as { profileId?: unknown })?.profileId)}`,
    );
  }
  if (typeof session.clock?.now !== "function") {
    problems.push("session.clock: expected a RuntimeClock (a now(): number function)");
  }
  if (typeof session.ids?.next !== "function") {
    problems.push("session.ids: expected a RuntimeIdGen (a next(): string function)");
  }
  if (typeof server?.serviceId !== "string" || server.serviceId.length === 0) {
    problems.push(`server: expected a ServerPort with a non-empty serviceId, got ${previewValue((server as { serviceId?: unknown })?.serviceId)}`);
  }
  // R09: the surface seam, validated when injected (adapter wiring).
  if (options?.surfaceResolver !== undefined) {
    assertSurfaceResolverSeam(options.surfaceResolver);
  }
  if (problems.length > 0) throw new RuntimeError("invalid-input", problems.join("; "));

  // — capability truth (never boot on a lying adapter) —
  if (!isRecord(platform)) {
    throw new RuntimeError("invalid-input", `platform: expected a PlatformCapabilities object, got ${previewValue(platform)}`);
  }
  const truthIssues = checkCapabilityTruth(platform);
  if (truthIssues.length > 0) {
    throw new RuntimeError(
      "invalid-input",
      `platform capability bundle is incoherent (the truth law): ${truthIssues
        .map((issue) => issue.detail)
        .join("; ")}`,
    );
  }

  // — engines —
  const navigation = createNavigationStore();
  const registry = new CanonicalItemRegistry(session.ids);
  const watch = new WatchStateEngine(server, session.context, session.clock, session.ids);
  const playbackControllers = new Map<string, PlaybackSessionController>();
  const actions = new ActionEngine(server, platform, session.clock, session.ids);
  const libraryEngine = new LibraryEngine(server, registry, watch, session.clock);
  // R05: the intent store carries the injected ServerPort for the durable
  // write-through + boot hydration (the frozen seam's NEW backing — the
  // local R01 laws are unchanged; see intent.ts).
  const intents = new IntentStore(session.clock, session.ids, server);
  const sources = createSourceStateStore(server);

  // — the at-least-once flush hook (adapters await async shutdown hooks) —
  platform.ports.lifecycle.hook("shutdown", async () => {
    await watch.flush();
  });

  const durationOf = (itemId: string): number | undefined =>
    registry.get(itemId)?.item.durationMs;

  // R09: the canonical item record feeding the surface seam (the frozen
  // resolver validates the item's shape; the registry's own record is the
  // truthful carrier when the item is known).
  const itemOf = (itemId: string) => registry.get(itemId)?.item;

  const playbackOperations: PlaybackOperations = {
    controller: (sessionId) => playbackControllers.get(sessionId),
    active: () =>
      [...playbackControllers.values()]
        .map((controller) => controller.state())
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
  };

  const titleOf = (itemId: string): string => registry.get(itemId)?.title ?? itemId;

  async function runSearch(
    query: string,
    op: (q: string) => Promise<ServerResult<readonly SearchResult[]>>,
    options?: { readonly allowEmptyQuery?: boolean },
  ): Promise<SearchModel> {
    const allowEmpty = options?.allowEmptyQuery === true;
    if (!allowEmpty && (typeof query !== "string" || query.trim().length === 0)) {
      throw new RuntimeError("invalid-input", `query: expected a non-empty string (after trim), got ${previewValue(query)}`);
    }
    const result = await op(query);
    if (!result.ok) {
      // In-model degradation — never a fake empty result.
      return {
        query,
        status: errorSection(serverFailureKind(result.failure), result.failure.detail),
        hits: [],
      };
    }
    const hits: SearchHit[] = [];
    for (const hit of result.value) {
      if (
        typeof hit === "object" &&
        hit !== null &&
        typeof (hit as { connectorId?: unknown }).connectorId === "string" &&
        (hit as { connectorId: string }).connectorId.length > 0 &&
        typeof (hit as { externalRef?: unknown }).externalRef === "string" &&
        (hit as { externalRef: string }).externalRef.length > 0 &&
        typeof (hit as { title?: unknown }).title === "string"
      ) {
        const item = registry.register(hit);
        watch.registerItemDuration(item.id, item.durationMs);
        hits.push({ canonicalItemId: item.id, result: hit });
      }
      // Malformed hits are skipped (documented; a broken hit is never a card).
    }
    return { query, status: readySection(), hits };
  }

  const runtime: ClientRuntime = {
    platform: platform.platform,
    capabilities: platform,

    navigation,

    getHome: async (input?: HomeQuery): Promise<HomeModel> => {
      const include = input?.includeContinueWatching !== false;
      if (!include) {
        return {
          continueWatching: { status: readySection(), entries: [] },
        };
      }
      const entries = buildContinueWatching(watch.operations().all(), titleOf);
      return { continueWatching: { status: readySection(), entries } };
    },

    search: (input: SearchQuery) => runSearch(input?.query, (q) => server.search(q)),

    shorts: (input?: ShortsQuery) =>
      runSearch(input?.query ?? "", (q) => server.shorts(q), { allowEmptyQuery: true }),

    resolvePlayback: async (input: PlaybackIntent): Promise<PlaybackSession> => {
      const { session: playbackSession, controller } = await resolvePlaybackSession(
        {
          capabilities: platform,
          server,
          watch,
          clock: session.clock,
          ids: session.ids,
          context: session.context,
          durationOf,
          itemOf,
          ...(options?.surfaceResolver !== undefined
            ? { surfaceResolver: options.surfaceResolver }
            : {}),
        },
        input,
      );
      playbackControllers.set(playbackSession.id, controller);
      return playbackSession;
    },

    dispatchAction: (input: UserAction) => actions.dispatch(input),

    updateWatchState: async (input: WatchStateCommand): Promise<void> => {
      await watch.apply(input); // delivery failure throws (the EventSink law)
    },

    library: (input?: LibraryQuery) => libraryEngine.read(input),

    setIntent: async (input: Parameters<IntentStore["set"]>[0]): Promise<void> => {
      // R05: the local session set (the R01 law) + the durable write-through
      // for persistent/temporary/social scopes; a typed server failure
      // throws (never a silent success).
      await intents.syncIntent(input);
    },

    setRecommendationPolicy: async (
      input: Parameters<IntentStore["setPolicy"]>[0],
    ): Promise<void> => {
      // R05: the local policy view + the durable write-through; a typed
      // server failure throws (never a silent success).
      await intents.syncPolicy(input);
    },

    playback: playbackOperations,
    actions: actions.operations(),
    watchState: watch.operations(),
    libraryOps: libraryEngine.operations(),
    intents: intents.operations(),
    sources,

    retryPendingWatchEvents: () => watch.retryPendingWatchEvents(),
  };

  return runtime;
}
