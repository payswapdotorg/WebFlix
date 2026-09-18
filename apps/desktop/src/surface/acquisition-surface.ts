/**
 * @wfx/app-desktop — the acquisition surface projection (R14).
 *
 * The thin, UI-framework-agnostic projection the desktop webview frontend
 * renders (the R08 `desktop-surface.ts` pattern): the RUNTIME's honest
 * lifecycle views (protocol-free — the default UX) plus the GATED
 * advanced-diagnostics view the explicitly-gated disclosure renders.
 * ZERO product logic lives here: the state model, the mapper, and the
 * observation law are the runtime's (`@wfx/client-runtime`
 * `acquisition.ts`); the facts derivation is the platform source's
 * (`platform/acquisition-source.ts`); this module PROJECTS them.
 *
 * Truth laws kept here:
 * - `bound` is the honest capability truth: when the composition root did
 *   not bind the torrent-engine acquisition block, the surface says so
 *   (never a silent empty acquisition experience).
 * - `refresh()` is the ONLY reporting path — the host owns cadence (no
 *   hidden timers; the R10/R12 law).
 * - The diagnostics projection is SEPARATE and explicitly named gated —
 *   the frontend renders it ONLY inside the advanced-diagnostics
 *   disclosure (test-enforced on the web components; the same vocabulary
 *   renders there).
 */

import type {
  AcquisitionDiagnosticsView,
  AcquisitionStatusView,
  ClientRuntime,
} from "@wfx/client-runtime";
import type { Unsubscribe } from "@wfx/platform-contracts";
import type { TorrentRecoveryReport, TorrentResult } from "@wfx/torrent-engine";
import { torrentError } from "@wfx/torrent-engine";

import type { DesktopAcquisitionSource } from "../platform/acquisition-source";

/** The Desktop acquisition surface (the projection the UI renders). */
export interface DesktopAcquisitionSurface {
  /** Whether the torrent-engine acquisition block is bound (capability truth). */
  readonly bound: boolean;
  /** Every current lifecycle view (the default UX renders these ONLY). */
  acquisitionViews(): readonly AcquisitionStatusView[];
  /** One item's lifecycle view (null when nothing is known). */
  acquisitionView(itemId: string): AcquisitionStatusView | null;
  /**
   * THE GATED ADVANCED DIAGNOSTICS of one item (protocol vocabulary —
   * renders ONLY inside the explicitly gated diagnostics disclosure).
   */
  acquisitionDiagnostics(itemId: string): AcquisitionDiagnosticsView | null;
  /**
   * Re-derive + report the current facts (the host-owned cadence call;
   * optionally ingesting a fresh recovery report first — the J25 proofs).
   */
  refreshAcquisition(recovery?: TorrentRecoveryReport): TorrentResult<void>;
  /**
   * Execute the typed RETRY of one item's RECOVERABLE failure (the bound
   * recipe — the composition root's fresh re-acquisition).
   */
  attemptAcquisitionRetry(itemId: string): Promise<TorrentResult<{ readonly sessionId: string }>>;
  /**
   * R17 — execute the typed CLEAN RESTART of one item's INTERRUPTED session
   * (the bound restart recipe — discard the saved progress + a fresh
   * acquisition; the explicit resume-or-clean-restart choice).
   */
  attemptAcquisitionRestart(itemId: string): Promise<TorrentResult<{ readonly sessionId: string }>>;
  /** Observe lifecycle-view changes. */
  observeAcquisition(listener: (views: readonly AcquisitionStatusView[]) => void): Unsubscribe;
}

/** The honest UNBOUND surface (the capability truth when the block is absent). */
export function createUnboundAcquisitionSurface(
  runtime: ClientRuntime,
): DesktopAcquisitionSurface {
  return {
    bound: false,
    acquisitionViews: () => runtime.acquisition.views(),
    acquisitionView: (itemId) => runtime.acquisition.view(itemId),
    acquisitionDiagnostics: () => null, // no engine bound — no protocol detail exists
    refreshAcquisition: () => ({ ok: true, value: undefined }), // nothing to derive
    attemptAcquisitionRetry: async () =>
      torrentError("INVALID_STATE", {
        detail:
          "attemptAcquisitionRetry: the torrent-engine acquisition block is not bound in this build — the retry action is honestly unavailable (never a fixture fallback)",
      }),
    attemptAcquisitionRestart: async () =>
      torrentError("INVALID_STATE", {
        detail:
          "attemptAcquisitionRestart: the torrent-engine acquisition block is not bound in this build — the restart action is honestly unavailable (never a fixture fallback)",
      }),
    observeAcquisition: (listener) => runtime.acquisition.subscribe(listener),
  };
}

/**
 * Project the Desktop acquisition surface over the booted runtime + the
 * bound facts source. Pure projection: every read delegates (no local
 * folding, no caching theater).
 */
export function createDesktopAcquisitionSurface(
  runtime: ClientRuntime,
  source: DesktopAcquisitionSource,
): DesktopAcquisitionSurface {
  return {
    bound: true,
    acquisitionViews: () => runtime.acquisition.views(),
    acquisitionView: (itemId) => runtime.acquisition.view(itemId),
    acquisitionDiagnostics: (itemId) => source.diagnostics(itemId),
    refreshAcquisition: (recovery?: TorrentRecoveryReport) => source.refresh(recovery),
    attemptAcquisitionRetry: (itemId) => source.attemptRetry(itemId),
    attemptAcquisitionRestart: (itemId) => source.attemptRestart(itemId),
    observeAcquisition: (listener) => runtime.acquisition.subscribe(listener),
  };
}
