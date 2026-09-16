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

import type { ShellIpc } from "./platform/shell-ipc";
import {
  assembleDesktopCapabilities,
  assertDesktopCapabilityTruth,
  type DesktopCapabilities,
} from "./platform/capabilities";
import {
  createNativeMediaBinding,
  type DeadlineMapper,
  type EngineRangeChannel,
  type NativeMediaBinding,
} from "./platform/native-media-binding";
import { createShellEngineProcess } from "./platform/shell-engine-process";
import type { ShellLifecyclePort } from "./platform/lifecycle";
import { createDesktopSurface, type DesktopSurface } from "./surface/desktop-surface";

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
  const runtime = createRuntime(capabilities as PlatformCapabilities, options.server, options.session);

  const surface = createDesktopSurface(runtime, capabilities);

  let disposed = false;
  return {
    platform: "desktop",
    capabilities,
    runtime,
    shell: options.shell,
    lifecycle: capabilities.ports.lifecycle,
    engine,
    surface,
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
