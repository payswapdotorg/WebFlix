/**
 * @wfx/app-desktop — the DESKTOP adapter entry (R08, remediation freeze).
 *
 * The REAL native adapter over the R01 shared client runtime:
 *
 * ```text
 * Experience Core -> Shared Client Runtime (@wfx/client-runtime)
 *                          |
 *                   THIS adapter (apps/desktop)
 *                          |
 *                    ShellIpc (the native seam)
 *                          |
 *              WebFlix native shell (Tauri, apps/desktop/shell)
 *                          |
 *            window events / app-data fs / webview surfaces /
 *            OS notifications / task registry / share sheet /
 *            the native-media engine child process (R10's binary)
 * ```
 *
 * `createDesktopApp` is the composition root: it spawns/attaches the
 * native-media engine through the shell (the R10 seam — NEVER
 * `stubEngine()`, which stays a test double inside `@wfx/native-media`'s
 * fixtures module and is not referenced by any production path here),
 * assembles the truthful Desktop capability bundle, runs the capability
 * truth law at boot (fail-fast with every issue named), constructs the
 * shared runtime with the desktop bundle, and projects the desktop
 * surface. The runtime's at-least-once watch-event outbox is flushed by
 * the lifecycle shutdown drain (the adapter awaits async hooks before
 * the shell exits — the frozen adapter contract).
 *
 * This module REPLACES the pre-remediation WFX-040 entry (a thin
 * re-export of the legacy web client booting `stubEngine()` as its
 * production default — exactly what the 2026-09-16 freeze forbids).
 */

import { createRuntime, type ClientRuntime, type RuntimeSession } from "@wfx/client-runtime";
import type { EngineConfig, NativeEngineProcess } from "@wfx/native-media";
import type { ServerPort } from "@wfx/client-runtime";
import type { PlatformCapabilities } from "@wfx/platform-contracts";
import type { TorrentEngine, TorrentEngineAdapter } from "@wfx/torrent-engine";

import type { ShellIpc } from "./platform/shell-ipc";
import {
  assembleDesktopCapabilities,
  assertDesktopCapabilityTruth,
  type DesktopCapabilities,
} from "./platform/capabilities";
import { createDesktopSurfaceResolver } from "./platform/media-surface";
import {
  createNativeMediaBinding,
  type DeadlineMapper,
  type EngineRangeChannel,
  type NativeMediaBinding,
} from "./platform/native-media-binding";
import { createShellEngineProcess } from "./platform/shell-engine-process";
import type { ShellLifecyclePort } from "./platform/lifecycle";
import type { FeedPort } from "@wfx/domain";
import { createDesktopSurface, type DesktopSurface } from "./surface/desktop-surface";
import {
  createDesktopAcquisitionSurface,
  createUnboundAcquisitionSurface,
  type DesktopAcquisitionSurface,
} from "./surface/acquisition-surface";
import {
  createDesktopDiscoverabilitySurface,
  type DesktopDiscoverabilitySurface,
} from "./surface/discoverability-surface";
import {
  createOfflineDiscoverySurface,
  type DesktopOfflineDiscoverySurface,
  type DesktopAcquireRecipe,
} from "./surface/offline-discovery-surface";
import {
  createDesktopFeedSurface,
  createUnboundFeedSurface,
  type DesktopFeedSurface,
} from "./surface/feed-surface";
import {
  createDesktopFirstRunSurface,
  createUnboundFirstRunSurface,
  type DesktopFirstRunSurface,
} from "./surface/first-run-surface";
import {
  createDesktopModelManagementSurface,
  createUnboundModelManagementSurface,
  type DesktopModelManagementSurface,
} from "./surface/model-management-surface";
import { createDesktopAcquisitionSource } from "./platform/acquisition-source";
import { createDesktopAuthTransport, type DesktopAuthFetchLike } from "./platform/auth-transport";
import { createShellAuthSessionStore } from "./platform/auth-session-store";
import {
  createDesktopTorrentPlaybackBinding,
  type DesktopTorrentPlaybackBinding,
  type DesktopTorrentRealizationSource,
  type DesktopProvenanceMint,
} from "./platform/torrent-playback";
import {
  createDesktopWhereToWatchSurface,
  type DesktopWhereToWatchSurface,
} from "./surface/where-to-watch-surface";
import {
  createDesktopOpenViewingSurface,
  type DesktopOpenViewingSurface,
  type DesktopViewerSessionOf,
} from "./surface/open-viewing-surface";
import {
  createUnavailableModelRuntimeProbe,
  type DesktopModelRuntimeProbe,
} from "./platform/model-runtime";
import {
  createDesktopLocalAiSurface,
  type DesktopLocalAiSurface,
  type DesktopMediaIntelligenceSource,
} from "./surface/local-ai-surface";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** The engine binding block: the R10 seam's configuration. */
export interface DesktopEngineOptions {
  /** The engine spawn configuration (cache dir under app-data + budget). */
  readonly config: EngineConfig;
  /**
   * The engine process boundary. DEFAULT: the shell-backed production
   * wiring (`createShellEngineProcess`). Tests inject the simulated
   * engine process — production NEVER injects a fixture.
   */
  readonly process?: NativeEngineProcess;
  /** Wire-command deadline in ms (default 30 000; see the binding docs). */
  readonly callTimeoutMs?: number;
  /**
   * The R10 byte-range read channel (optional today: the v1 wire protocol
   * has no read command; the binding answers the typed honest failure
   * until R10 binds the real range gateway).
   */
  readonly rangeAccess?: EngineRangeChannel;
  /**
   * The R12 byte→piece deadline mapper (optional today: mapping byte
   * ranges to pieces needs the piece map — R12's scheduler seam).
   */
  readonly deadlineMapper?: DeadlineMapper;
}

/** Options for {@link createDesktopApp}. */
export interface DesktopAppOptions {
  /** The live native shell IPC binding (production: `createTauriShellIpc()`). */
  readonly shell: ShellIpc;
  /** The server transport (the frozen WFX_API_BASE mapping). */
  readonly server: ServerPort;
  /** The runtime session seams (identity context, clock, ids). */
  readonly session: RuntimeSession;
  /** The engine binding block (the R10 seam). */
  readonly engine: DesktopEngineOptions;
  /**
   * R14 — the torrent-engine acquisition block (OPTIONAL today, the R10
   * seam precedent): when bound, the app derives the acquisition facts
   * from the R11-R13 public surfaces and the surface projects the honest
   * lifecycle views + the gated diagnostics. Absent ⇒ the honest UNBOUND
   * capability truth (never a fixture fallback). The production spawn
   * wiring (engine + adapter over the shell's app-data + the authorized
   * source registry) is the lead's integration step — the same way R10
   * bound the range gateway after the seam landed.
   */
  readonly acquisition?: {
    readonly engine: TorrentEngine;
    readonly adapter: TorrentEngineAdapter;
  };
  /**
   * R20-G — the BYOF feed block (OPTIONAL, the R14 seam precedent): the
   * frozen shared `FeedPort` seam (contracts.md "Bring Your Own Feed" —
   * Worker 1's R20-A contract, ratified). When bound, the app composes
   * the Desktop BYOF surface (native file import + background sync +
   * the filesystem cache) over it; absent ⇒ the honest UNBOUND surface
   * (typed verdicts, never a silent empty feed). PRODUCTION WIRING: the
   * R20 API lane (`/feeds/*`) is complete and the Web adapter binds its
   * HTTP transport; the Desktop binding composes this lane's file/import
   * surfaces (R20-F/G) with the service FeedPort transport wiring in the
   * R21 Desktop lane (R21-G/H) — the frozen contract is this lane's
   * binding (the plan's "R20-F/G start against frozen contract stubs"
   * doctrine).
   */
  readonly feed?: {
    readonly port: FeedPort;
  };
  /**
   * R21-H — the offline discovery block (OPTIONAL, the R14/R20 seam
   * precedent): the composition root's acquisition-START recipe (the
   * authorized ingestion + session + `bindSession` flow — the same
   * wiring shape the acquisition source's retry/restart recipes use).
   * When bound, the item surface's "Make available offline" affordance
   * is actionable end-to-end (`executeAcquire`); absent ⇒ the honest
   * typed not-wired verdict (never a fabricated start).
   */
  readonly offlineDiscovery?: {
    readonly acquire: DesktopAcquireRecipe;
  };
  /**
   * R22-H — the first-run block (OPTIONAL, the R14/R20/R21 seam
   * precedent): the account/source onboarding parity surface. When
   * bound, the composition builds the Desktop auth transport (the
   * documented account + source-management routes over the same
   * `WFX_API_BASE` family), the OS-keychain session store, the
   * adapter-owned native connect flows, and the first-run surface that
   * consumes the R22-A/B shared read models VERBATIM. Absent ⇒ the
   * honest UNBOUND surface (typed verdicts — identity flows and source
   * onboarding are surfaced as not wired, never silently absent).
   */
  readonly firstRun?: {
    /** The validated base URL of the Experience API (the same `WFX_API_BASE` family). */
    readonly apiBase: URL;
    /** The fetch implementation (tests inject a stub). */
    readonly fetchImpl?: DesktopAuthFetchLike;
    /** Per-request timeout in ms (default 10 000; `0` disables). */
    readonly timeoutMs?: number;
    /** The adapter's platform-truth map (R22-A `unsupportedOnPlatform`). */
    readonly unsupportedOnPlatform?: ReadonlyMap<string, string>;
  };
  /**
   * R23-W3 — the first-class torrent realization block (OPTIONAL, the
   * R14 seam precedent): the composition's authorized peer-copy truth
   * (`realizationOf` — e.g. the user's media vault) + the
   * authorized-provenance mint (the authorized-source registry's own
   * `authorizeProvenance` — the ONLY lawful construction path) + the
   * acquiring identity's effective-profile key derivation (authenticated:
   * the effective profile; anonymous: the SESSION-scoped key — the R23-B
   * progress law). When bound TOGETHER with `acquisition`, the app
   * composes the R23-C binding (an authorized torrent realization
   * satisfying the NATIVE rung) and the R23-E Where-to-watch surface
   * ("Authorized peer copy" as a first-class way to watch). Absent ⇒ the
   * honest absent truth (no peer-copy entry is offered — never a fake
   * one).
   */
  readonly torrentPlayback?: {
    /** The composition's authorized-realization truth per canonical item. */
    readonly realizationOf: DesktopTorrentRealizationSource;
    /** The authorized-provenance mint (the authorized-source registry). */
    readonly mintProvenance: DesktopProvenanceMint;
    /** The acquiring identity's effective-profile key (the R04 composition). */
    readonly profileKeyOf: () => string;
  };
  /**
   * R23-W3 — the open-viewing block (OPTIONAL): the R23-A/B Desktop
   * semantics over the composition's viewer-session truth (the R22-H
   * keychain law — authenticated iff a VERIFIED session is active).
   * Absent ⇒ the honest anonymous default (the surface still renders
   * the accountless truths — public viewing never depends on this
   * block; the block only carries the composition's real session).
   */
  readonly openViewing?: {
    /** The viewer-session derivation (the keychain truth). */
    readonly viewerSessionOf: DesktopViewerSessionOf;
  };
  /**
   * R23-W3 — the local AI block (OPTIONAL): the packaged local model
   * runtime's probe (the availability truth — DEFAULT: the honestly
   * unavailable probe when this build packages no runtime, NEVER a
   * fake-ready one) + the composition's media-intelligence truth seam
   * (null = not derived — the honest absence). When bound, the app
   * composes the local AI surface (the R23-J catalog truth, the runtime
   * packaging status, the R23-G live-caption gate/routing, the R23-I
   * local-helper route, and the J39 artifacts/moment-jump consumption).
   */
  readonly localAi?: {
    /** The packaged runtime's probe (default: honestly unavailable). */
    readonly runtimeProbe?: DesktopModelRuntimeProbe;
    /** The composition's media-intelligence truth per item. */
    readonly mediaIntelligenceOf: DesktopMediaIntelligenceSource;
    /** The ASR-capable provider ids REGISTERED in Model Fabric (the registration truth). */
    readonly registeredAsrProviderIds?: () => readonly string[];
    /** The model-policy preferred ASR provider (the alternative policy choice). */
    readonly preferredAsrProviderId?: () => string | undefined;
  };
}

/** A booted Desktop application: the runtime over the native adapter. */
export interface DesktopApp {
  /** The platform kind (always `"desktop"` here). */
  readonly platform: "desktop";
  /** The truthful capability bundle the runtime booted on. */
  readonly capabilities: DesktopCapabilities;
  /** The shared client runtime (product semantics live here). */
  readonly runtime: ClientRuntime;
  /** The native shell binding (adapter-owned surface). */
  readonly shell: ShellIpc;
  /** The lifecycle port (shutdown drain observable). */
  readonly lifecycle: ShellLifecyclePort;
  /** The engine binding (the R10 seam; dispose terminates the engine). */
  readonly engine: NativeMediaBinding;
  /** The thin UI projection the webview frontend renders against. */
  readonly surface: DesktopSurface;
  /** R14: the acquisition surface (lifecycle views + gated diagnostics). */
  readonly acquisition: DesktopAcquisitionSurface;
  /** R20-G: the BYOF feed surface (import + sync + cache over the frozen FeedPort). */
  readonly feed: DesktopFeedSurface;
  /**
   * R21-G: the discoverability surface — the frozen R21-A capability
   * matrix + the R21-C shared control views bound to the Desktop
   * platform (parity-projected, with the honest standing verdicts).
   */
  readonly discoverability: DesktopDiscoverabilitySurface;
  /**
   * R21-H: the offline/feed discovery surface — the Desktop's extra
   * powers at the moment they become useful (the from-content offline
   * affordance, the player's offline truth, the Library Offline
   * section, background completion, and the BYOF import discovery).
   */
  readonly offlineDiscovery: DesktopOfflineDiscoverySurface;
  /**
   * R22-H: the first-run parity surface — the account-creation/sign-in
   * state (R22-B over the OS keychain), the first-connect source
   * catalog (R22-A), the adapter-owned native connect/recovery flows,
   * and the BYOF prerequisite transition. Unbound compositions answer
   * the honest typed verdicts.
   */
  readonly firstRun: DesktopFirstRunSurface;
  /**
   * R22-I: the Model & AI management surface — the R22-C BYOM management
   * view VERBATIM over the session-scoped provider/policy truth, the
   * add/bind + remove/unbind + per-task policy operations with the R22-C
   * recovery mapping, the local-model availability truth, and the
   * Desktop-native local-serving endpoint hints (input suggestions,
   * never capability claims). Bound with the first-run block (BYOM
   * belongs to the account); unbound compositions answer the honest
   * typed verdicts.
   */
  readonly modelManagement: DesktopModelManagementSurface;
  /**
   * R23-W3: the Where-to-watch surface — the R23-E first-class torrent
   * play surface ("Authorized peer copy" in the frozen grouping,
   * eligible for the primary play decision) over the R23-C binding.
   * Present iff BOTH the `acquisition` and `torrentPlayback` blocks are
   * bound; absent ⇒ the honest absent truth (the surface answers the
   * typed not-wired verdict — never a fake peer-copy entry).
   */
  readonly whereToWatch: DesktopWhereToWatchSurface | null;
  /**
   * R23-W3: the R23-C binding — the authorized torrent realization
   * integrated with native media (the NATIVE rung: ingest → file choice
   * → session → canonical-identity bind → native playback → recovery
   * continuity). Present iff BOTH the `acquisition` and `torrentPlayback`
   * blocks are bound.
   */
  readonly torrentPlayback: DesktopTorrentPlaybackBinding | null;
  /**
   * R23-W3: the open-viewing surface — the R23-A/B Desktop semantics
   * (accountless public viewing, the no-login-wall law, session-scoped
   * anonymous progress). ALWAYS present (public viewing is a platform
   * law, not an optional block); the optional `openViewing` block only
   * carries the composition's real viewer-session truth (absent ⇒ the
   * honest anonymous default).
   */
  readonly openViewing: DesktopOpenViewingSurface;
  /**
   * R23-W3: the local AI surface — the R23-J catalog truth, the model
   * runtime packaging status (never faked), the R23-G live-caption
   * gate/routing, the R23-I local-helper route, and the J39
   * artifacts/moment-jump consumption. Present iff the `localAi` block
   * is bound; absent ⇒ null (the Model & AI management surface stays
   * the standing truth for models).
   */
  readonly localAi: DesktopLocalAiSurface | null;
  /** Tear the adapter down (terminates the engine binding; idempotent). */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// The composition root
// ---------------------------------------------------------------------------

/**
 * Boot the Desktop application: engine binding → truthful capability
 * bundle → truth-check → shared runtime → surface projection.
 *
 * Throws (typed or explicit) when:
 * - the engine cannot be spawned (`NativeMediaPortError` — `unavailable`);
 * - the capability bundle is incoherent (the truth law — every issue
 *   named; the runtime's own `createRuntime` check is the second gate);
 * - the session/server bundle is malformed (`RuntimeError` from
 *   `createRuntime`).
 */
export function createDesktopApp(options: DesktopAppOptions): DesktopApp {
  const engineProcess = options.engine.process ?? createShellEngineProcess(options.shell);

  // THE R10 SEAM: a real binding over the spawned engine process. The
  // production default is the shell-backed process wiring; no fixture
  // path exists here (stubEngine is not imported anywhere in src/).
  const engine = createNativeMediaBinding({
    process: engineProcess,
    config: options.engine.config,
    clock: options.session.clock,
    ...(options.engine.callTimeoutMs !== undefined
      ? { callTimeoutMs: options.engine.callTimeoutMs }
      : {}),
    ...(options.engine.rangeAccess !== undefined
      ? { rangeAccess: options.engine.rangeAccess }
      : {}),
    ...(options.engine.deadlineMapper !== undefined
      ? { deadlineMapper: options.engine.deadlineMapper }
      : {}),
  });

  const capabilities = assembleDesktopCapabilities(options.shell, engine);

  // The boot truth-check: fail fast, naming every incoherence (the
  // runtime re-runs the same law — two gates, one truth).
  assertDesktopCapabilityTruth(capabilities);

  // The shared runtime over the truthful bundle (the R01 contract).
  // R09: THE FROZEN PRECEDENCE IS WIRED — the Desktop adapter's Media
  // Surface resolver seam (the frozen `resolveSurface` over THIS bundle's
  // truthful device derivation — native included, the R10 engine binding
  // backing the NATIVE rung) decides playback resolution; the answer's
  // precedence trace rides on the playback state.
  const runtime = createRuntime(
    capabilities as PlatformCapabilities,
    options.server,
    options.session,
    {
      surfaceResolver: createDesktopSurfaceResolver({
        capabilities: capabilities as PlatformCapabilities,
        clock: options.session.clock,
      }),
    },
  );

  const surface = createDesktopSurface(runtime, capabilities);

  // R14 — the acquisition facts source + surface projection. The block is
  // OPTIONAL (the R10 seam precedent): absent ⇒ the honest UNBOUND surface
  // (capability truth, never a fixture fallback); present ⇒ the real
  // derivation over the engine's public surfaces. The SOURCE is created
  // ONCE and shared with the R23-W3 torrent playback binding (the same
  // bindSession truth — one acquisition identity map, never two).
  const acquisitionSource =
    options.acquisition !== undefined
      ? createDesktopAcquisitionSource({
          engine: options.acquisition.engine,
          adapter: options.acquisition.adapter,
          runtime,
        })
      : null;
  const acquisition: DesktopAcquisitionSurface =
    acquisitionSource !== null
      ? createDesktopAcquisitionSurface(runtime, acquisitionSource)
      : createUnboundAcquisitionSurface(runtime);

  // R20-G — the BYOF feed surface over the frozen shared FeedPort. The
  // block is OPTIONAL (the R14 seam precedent): absent ⇒ the honest
  // UNBOUND surface (typed verdicts — never a fake feed); present ⇒ the
  // Desktop envelope binding (native file import, background sync
  // executor, filesystem cache) with the SHARED semantics.
  const feed: DesktopFeedSurface =
    options.feed !== undefined
      ? createDesktopFeedSurface({
          shell: options.shell,
          feedPort: options.feed.port,
          storage: capabilities.ports.storage,
          now: () => new Date(options.session.clock.now()).toISOString(),
        })
      : createUnboundFeedSurface();

  // R21-G — the Desktop discoverability surface: the frozen capability
  // matrix + the shared control views bound to THIS composition (the
  // standing verdicts derive from the bound flags above — never guessed).
  const discoverability: DesktopDiscoverabilitySurface = createDesktopDiscoverabilitySurface({
    runtime,
    capabilities: capabilities as PlatformCapabilities,
    acquisition,
    feed,
  });

  // R21-H — the offline/feed discovery surface: the Desktop's extra
  // powers at the moment of use, over the same bound surfaces (the
  // optional acquire recipe is the composition root's start wiring).
  const offlineDiscovery: DesktopOfflineDiscoverySurface = createOfflineDiscoverySurface({
    runtime,
    capabilities: capabilities as PlatformCapabilities,
    acquisition,
    feed,
    ...(options.offlineDiscovery !== undefined
      ? { acquire: options.offlineDiscovery.acquire }
      : {}),
  });

  // R22-H — the first-run parity surface: the account/source onboarding
  // semantics over the R22-A/B shared read models (the optional-block
  // doctrine — absent ⇒ the honest typed UNBOUND verdicts).
  const now = (): string => new Date(options.session.clock.now()).toISOString();
  const firstRunTransport =
    options.firstRun !== undefined
      ? createDesktopAuthTransport({
          apiBase: options.firstRun.apiBase,
          ...(options.firstRun.fetchImpl !== undefined
            ? { fetchImpl: options.firstRun.fetchImpl }
            : {}),
          ...(options.firstRun.timeoutMs !== undefined
            ? { timeoutMs: options.firstRun.timeoutMs }
            : {}),
        })
      : null;
  const firstRun: DesktopFirstRunSurface =
    firstRunTransport !== null && options.firstRun !== undefined
      ? createDesktopFirstRunSurface({
          runtime,
          transport: firstRunTransport,
          sessionStore: createShellAuthSessionStore({ shell: options.shell, now }),
          feed,
          shell: options.shell,
          now,
          ...(options.firstRun.unsupportedOnPlatform !== undefined
            ? { unsupportedOnPlatform: options.firstRun.unsupportedOnPlatform }
            : {}),
        })
      : createUnboundFirstRunSurface();

  // R22-I — the Model & AI management surface: the R22-C BYOM management
  // semantics over the same session-scoped transport (BYOM belongs to the
  // account; the surface reads the token through the first-run session).
  const modelManagement: DesktopModelManagementSurface =
    firstRunTransport !== null
      ? createDesktopModelManagementSurface({
          transport: firstRunTransport,
          token: () => firstRun.currentToken(),
        })
      : createUnboundModelManagementSurface();

  // R23-W3 — the R23-C torrent realization binding + the R23-E
  // Where-to-watch surface. The blocks are OPTIONAL (the R14 seam
  // precedent) AND composed honestly: the binding needs BOTH the
  // acquisition block (the engine + the R14 source) AND the composition's
  // authorized-realization truth; absent ⇒ null (no peer-copy entry is
  // offered — never a fake one).
  const torrentPlayback: DesktopTorrentPlaybackBinding | null =
    options.acquisition !== undefined && options.torrentPlayback !== undefined
      ? createDesktopTorrentPlaybackBinding({
          runtime,
          capabilities: capabilities as PlatformCapabilities,
          engine: options.acquisition.engine,
          adapter: options.acquisition.adapter,
          source: acquisitionSource!,
          realizationOf: options.torrentPlayback.realizationOf,
          mintProvenance: options.torrentPlayback.mintProvenance,
          profileKeyOf: options.torrentPlayback.profileKeyOf,
        })
      : null;
  const whereToWatch: DesktopWhereToWatchSurface | null =
    torrentPlayback !== null
      ? createDesktopWhereToWatchSurface({
          capabilities: capabilities as PlatformCapabilities,
          acquisition,
          torrentPlayback,
        })
      : null;

  // R23-W3 — the open-viewing surface (ALWAYS composed: public viewing is
  // a platform law; the optional block only carries the composition's
  // real viewer-session truth — absent ⇒ the honest anonymous default).
  const openViewing: DesktopOpenViewingSurface = createDesktopOpenViewingSurface({
    runtime,
    viewerSessionOf:
      options.openViewing?.viewerSessionOf ??
      (() => ({ viewer: "anonymous" as const })), // the honest default (no verified session truth was bound)
    sessionIdOf: () => options.session.context.sessionId,
    nowOf: () => new Date(options.session.clock.now()).toISOString(),
  });

  // R23-W3 — the local AI surface (OPTIONAL; the runtime probe defaults
  // to the HONESTLY-UNAVAILABLE truth — never a fake-ready runtime).
  const localAi: DesktopLocalAiSurface | null =
    options.localAi !== undefined
      ? createDesktopLocalAiSurface({
          runtime,
          runtimeProbe: options.localAi.runtimeProbe ?? createUnavailableModelRuntimeProbe(),
          mediaIntelligenceOf: options.localAi.mediaIntelligenceOf,
          ...(options.localAi.registeredAsrProviderIds !== undefined
            ? { registeredAsrProviderIds: options.localAi.registeredAsrProviderIds }
            : {}),
          ...(options.localAi.preferredAsrProviderId !== undefined
            ? { preferredAsrProviderId: options.localAi.preferredAsrProviderId }
            : {}),
        })
      : null;

  let disposed = false;
  return {
    platform: "desktop",
    capabilities,
    runtime,
    shell: options.shell,
    lifecycle: capabilities.ports.lifecycle,
    engine,
    surface,
    acquisition,
    feed,
    discoverability,
    offlineDiscovery,
    firstRun,
    modelManagement,
    whereToWatch,
    torrentPlayback,
    openViewing,
    localAi,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      engine.dispose();
    },
  };
}

// The surface re-exports the frontend consumes (the adapter's public API).
export { checkCapabilityTruth } from "@wfx/platform-contracts";
export { createDesktopSurface } from "./surface/desktop-surface";
export type { DesktopCapabilitySummary } from "./surface/desktop-surface";
export type { DesktopCapabilityPorts } from "./platform/capabilities";
export {
  createDesktopAcquisitionSurface,
  createUnboundAcquisitionSurface,
} from "./surface/acquisition-surface";
export type { DesktopAcquisitionSurface } from "./surface/acquisition-surface";
export { createDesktopDiscoverabilitySurface } from "./surface/discoverability-surface";
export type {
  DesktopDiscoverabilitySurface,
  DesktopCapabilityView,
  DesktopCapabilityStanding,
  DesktopJ34TaskView,
  DesktopPlatformDifferenceView,
  DesktopPlatformTruthProjection,
  DesktopAiActionSpec,
  DesktopAiActionView,
  DesktopAiActionTrayView,
} from "./surface/discoverability-surface";
export {
  DESKTOP_AI_ACTIONS,
  AI_TRAY_TASKS,
  desktopCapabilityParityIssues,
  discoverabilityCopyStrings,
  isStaleDesktopDiscoverabilityCopy,
} from "./surface/discoverability-surface";
export { createOfflineDiscoverySurface } from "./surface/offline-discovery-surface";
export type {
  DesktopOfflineDiscoverySurface,
  DesktopOfflineAffordanceView,
  DesktopPlayerOfflineView,
  DesktopLibraryOfflineSection,
  DesktopFeedImportDiscoveryView,
  DesktopAcquisitionActionView,
  DesktopAcquireRecipe,
} from "./surface/offline-discovery-surface";
export {
  DESKTOP_ACQUISITION_ACTION_LABELS,
  offlineDiscoveryCopyStrings,
} from "./surface/offline-discovery-surface";
export {
  createDesktopFirstRunSurface,
  createUnboundFirstRunSurface,
  firstRunCopyStrings,
  isStaleFirstRunCopy,
} from "./surface/first-run-surface";
export type {
  DesktopFirstRunSurface,
  DesktopFirstRunFailure,
  DesktopFirstRunFailureCode,
  DesktopAccountStateView,
  DesktopSessionRestoreResult,
  DesktopIssuedSessionOutcome,
  DesktopCreateAccountResult,
  DesktopByofPrerequisiteView,
  DesktopDisconnectOutcome,
} from "./surface/first-run-surface";
export { createDesktopAuthTransport, createDesktopAccountRegistrationPort } from "./platform/auth-transport";
export {
  createDesktopModelManagementSurface,
  createUnboundModelManagementSurface,
  DESKTOP_LOCAL_ENDPOINT_HINTS,
  DESKTOP_LOCAL_MODEL_PLATFORM_NOTE,
  modelManagementCopyStrings,
  isStaleModelManagementCopy,
} from "./surface/model-management-surface";
export type {
  DesktopModelManagementSurface,
  DesktopModelManagementOptions,
  DesktopByomManagementFailure,
  DesktopByomOperationResult,
  DesktopLocalModelTruth,
  DesktopLocalEndpointHint,
} from "./surface/model-management-surface";
export type {
  DesktopAuthTransport,
  DesktopAuthFailure,
  DesktopAuthFailureKind,
  DesktopAuthResult,
  DesktopConnectAnswer,
  DesktopDisconnectView,
  DesktopLoginInput,
} from "./platform/auth-transport";
export { createShellAuthSessionStore } from "./platform/auth-session-store";
export type {
  DesktopAuthSessionStore,
  DesktopAuthSessionStoreFailure,
  DesktopAuthSessionState,
  DesktopAuthStoreCapability,
} from "./platform/auth-session-store";
export {
  createDesktopSourceConnectFlow,
} from "./platform/source-connect-flow";
export type {
  DesktopSourceConnectFlow,
  DesktopSourceFlowView,
  DesktopSourceFlowState,
  DesktopSourceFlowRecovery,
  DesktopSourceFlowStartInput,
  DesktopSourceFlowStartResult,
} from "./platform/source-connect-flow";
export {
  createDesktopFeedSurface,
  createUnboundFeedSurface,
} from "./surface/feed-surface";
export type {
  DesktopFeedSurface,
  DesktopFeedView,
  DesktopFeedViewResult,
  DesktopFeedMode,
  DesktopFeedOrderSemantics,
} from "./surface/feed-surface";
export {
  createDesktopFeedImportBinding,
  FILE_FEED_IMPORT_METHODS,
} from "./platform/feed-import";
export type {
  DesktopFeedImportBinding,
  DesktopFeedImportInput,
  DesktopFeedImportResult,
  DesktopFileImportCapability,
} from "./platform/feed-import";
export {
  createDesktopFeedSyncDriver,
  feedSyncTaskId,
} from "./platform/feed-sync";
export type {
  DesktopFeedSyncDriver,
  DesktopFeedSyncOutcome,
} from "./platform/feed-sync";
export { createDesktopFeedCache, DESKTOP_FEED_MODES } from "./platform/feed-cache";
export type { DesktopFeedCache, DesktopFeedCacheEntry } from "./platform/feed-cache";
export {
  createDesktopAcquisitionSource,
  ACQUISITION_CAUSE_FOR_FAILURE_REASON,
  ACQUISITION_FAILURE_DETAILS,
} from "./platform/acquisition-source";
export type {
  AcquisitionIdentity,
  DesktopAcquisitionSource,
  DesktopAcquisitionSourceOptions,
} from "./platform/acquisition-source";

// R23-W3 — the first-class torrent realization + open viewing + local AI.
export {
  createDesktopTorrentPlaybackBinding,
  desktopTorrentRungSatisfaction,
  torrentRealizationDeclarationOf,
  peerCopyPlaybackRealization,
  torrentFileCandidates,
  resolvePeerCopySelection,
  isPlayableTorrentFilePath,
  isDesktopTorrentRealization,
  AUTHORIZED_PEER_COPY_CONNECTOR_ID,
} from "./platform/torrent-playback";
export type {
  DesktopTorrentPlaybackBinding,
  DesktopTorrentPlaybackOptions,
  DesktopTorrentRealization,
  DesktopTorrentRealizationSource,
  DesktopProvenanceMint,
  DesktopPeerCopyPlayOutcome,
  DesktopTorrentFileCandidate,
} from "./platform/torrent-playback";
export { createDesktopWhereToWatchSurface, whereToWatchCopyStrings } from "./surface/where-to-watch-surface";
export type {
  DesktopWhereToWatchSurface,
  DesktopWhereToWatchOptions,
  DesktopWhereToWatchView,
  DesktopWhereToWatchEntryView,
  DesktopWhereToWatchGroupView,
  DesktopPrimaryPlayView,
} from "./surface/where-to-watch-surface";
export { createDesktopOpenViewingSurface } from "./surface/open-viewing-surface";
export type {
  DesktopOpenViewingSurface,
  DesktopOpenViewingOptions,
  DesktopOpenViewingView,
  DesktopSurfaceOpennessView,
  DesktopViewerSessionOf,
  DesktopPlaybackAuthorizationQuery,
} from "./surface/open-viewing-surface";
export {
  createUnavailableModelRuntimeProbe,
  createScriptedModelRuntimeProbe,
  DESKTOP_MODEL_RUNTIME,
} from "./platform/model-runtime";
export type {
  DesktopModelRuntimeDescriptor,
  DesktopModelRuntimeStatus,
  DesktopModelRuntimeProbe,
} from "./platform/model-runtime";
export {
  createDesktopLocalAiSurface,
  localAiCopyStrings,
  openModelRowView,
} from "./surface/local-ai-surface";
export type {
  DesktopLocalAiSurface,
  DesktopLocalAiOptions,
  DesktopOpenModelRowView,
  DesktopLiveCaptionView,
  DesktopLocalHelperRoute,
  DesktopMediaIntelligenceView,
  DesktopMediaIntelligenceSource,
  DesktopProvenanceView,
  DesktopTranscriptSegmentView,
  DesktopChapterView,
  DesktopMomentView,
  DesktopMomentJumpOutcome,
} from "./surface/local-ai-surface";
