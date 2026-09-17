/**
 * @wfx/client-runtime — the Media Surface resolution seam (R09).
 *
 * THE PRECEDENCE, WIRED END-TO-END. The frozen Media Surface resolver lives
 * in the Experience Core (`@wfx/experience`'s `resolveSurface` — the pure
 * decision engine behind Native > Embed > Browser > External). The layering
 * law keeps the runtime free of Experience-Core imports (Experience Core ->
 * Shared Client Runtime -> Platform Adapter), so the resolver crosses into
 * the runtime through THIS injectable seam:
 *
 * - The ADAPTER constructs the wiring: it derives the device-capability
 *   truth from its own truthful `PlatformCapabilities` bundle, closes over
 *   its surface permissions, and supplies the decision instant from its
 *   clock. It hands the runtime a `SurfaceResolverSeam`.
 * - The RUNTIME calls the seam inside `resolvePlayback` with the candidate
 *   realizations it resolved through the `ServerPort`, and adopts the
 *   seam's answer as THE precedence decision — re-checked against the
 *   runtime's own capability truth (a seam that picks a mode this platform
 *   truthfully cannot realize is an incoherent wiring and fails LOUDLY,
 *   typed `unsupported-capability`, never a silent fallback).
 * - The chosen realization's `precedenceTrace` rides on the playback state
 *   (`PlaybackState.precedenceTrace`) so the adapters render WHAT WAS
 *   CHOSEN AND WHY — the answer names it; capability truth, never
 *   aspiration.
 *
 * The seam types are STRUCTURAL views of the frozen resolver's
 * `SurfaceResolution` (structural typing is this repo's forward-compatibility
 * law — see `@wfx/experience`'s `surface/request.ts`): a real
 * `SurfaceResolution` satisfies `SurfaceResolutionView` without any package
 * dependency, which is exactly how the adapters inject the frozen resolver
 * without the runtime importing it.
 *
 * HONESTY LAWS (verbatim from the frozen resolver, kept at this seam):
 * - the seam is PURE and SYNCHRONOUS (no clock reads, no probes, no
 *   network): the same input answers the identical resolution;
 * - `ok: false` is the typed `unresolvable` dead end carrying EVERY reason
 *   (per-realization exclusions + per-mode rejections) — never a fake
 *   success;
 * - a malformed seam (not an object with a `resolve` function) is caller
 *   misuse and throws the typed `RuntimeError` at runtime construction.
 */

import type { EntertainmentItem, PlaybackMode, PlaybackRealization } from "@wfx/domain";

import type { RuntimeClock } from "./runtime-seams";
import { isRecord } from "@wfx/domain";
import { RuntimeError } from "./errors";

// ---------------------------------------------------------------------------
// The structural resolution view
// ---------------------------------------------------------------------------

/**
 * The runtime's structural view of the frozen resolver's SUCCESSFUL
 * `SurfaceResolution` (no package dependency — structural typing).
 */
export interface SurfaceResolutionView {
  readonly ok: true;
  /** The canonical item of the request (echoed by the resolver). */
  readonly itemId: string;
  /** The winning realization (the frozen `PlaybackRealization`). */
  readonly chosen: PlaybackRealization;
  /** The chosen realization's mode (always equal to `chosen.mode`). */
  readonly mode: PlaybackMode;
  /**
   * The auditable precedence trace: one line per rung in frozen precedence
   * order — the answer NAMES what was chosen and why.
   */
  readonly precedenceTrace: readonly string[];
}

/** The structural view of the frozen resolver's UNRESOLVABLE dead end. */
export interface SurfaceUnresolvableView {
  readonly ok: false;
  /** EVERY reason (per-realization exclusions + per-mode rejections). */
  readonly reasons: readonly string[];
}

/** The seam's answer (structural `SurfaceResolution`). */
export type SurfaceResolutionOutcome = SurfaceResolutionView | SurfaceUnresolvableView;

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/** The input the runtime hands the seam for ONE playback resolution. */
export interface SurfaceResolverInput {
  /** The canonical item being played. */
  readonly itemId: string;
  /**
   * The canonical item when the runtime knows it (the registry's own
   * record); absent for items resolved before registration. The frozen
   * resolver validates the item's SHAPE only — the canonicalType never
   * influences the precedence walk.
   */
  readonly item?: EntertainmentItem;
  /** The candidate realizations (the ServerPort's resolve answer). */
  readonly realizations: readonly PlaybackRealization[];
}

/**
 * The injectable Media Surface resolution seam (R09): the adapter's wiring
 * of the FROZEN resolver. Synchronous and pure by contract — the adapter
 * closes over its device truth, permissions, and clock.
 */
export interface SurfaceResolverSeam {
  /**
   * Resolve one playback request by the frozen precedence. Must never
   * throw for per-realization conditions (those are typed exclusions
   * inside the outcome); MAY throw only for seam misuse.
   */
  resolve(input: SurfaceResolverInput): SurfaceResolutionOutcome;
}

/**
 * Whether a value satisfies the seam contract (defensive — the seam crosses
 * adapter boundaries, so the runtime validates it at construction).
 */
export function isSurfaceResolverSeam(value: unknown): value is SurfaceResolverSeam {
  return isRecord(value) && typeof (value as { resolve?: unknown }).resolve === "function";
}

/** Assert the seam is well-formed (typed `RuntimeError` — caller misuse). */
export function assertSurfaceResolverSeam(
  seam: SurfaceResolverSeam,
): void {
  if (!isSurfaceResolverSeam(seam)) {
    throw new RuntimeError(
      "invalid-input",
      "surfaceResolver: expected a SurfaceResolverSeam (an object with a resolve(input) function)",
    );
  }
}

/**
 * The ISO 8601 decision instant for a resolution call — stamped from the
 * injected clock seam (never a hidden wall clock; the same law the runtime
 * keeps everywhere). Returned with explicit `Z` offset.
 */
export function surfaceDecisionInstant(clock: RuntimeClock): string {
  return new Date(clock.now()).toISOString();
}
