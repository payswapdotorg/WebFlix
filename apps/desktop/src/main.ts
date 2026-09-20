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
  createDesktopFeedSurface,
  createUnboundFeedSurface,
  type DesktopFeedSurface,
} from "./surface/feed-surface";
import { createDesktopAcquisitionSource } from "./platform/acquisition-source";

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
  // derivation over the engine's public surfaces.
  const acquisition: DesktopAcquisitionSurface =
    options.acquisition !== undefined
      ? createDesktopAcquisitionSurface(
          runtime,
          createDesktopAcquisitionSource({
            engine: options.acquisition.engine,
            adapter: options.acquisition.adapter,
            runtime,
          }),
        )
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
