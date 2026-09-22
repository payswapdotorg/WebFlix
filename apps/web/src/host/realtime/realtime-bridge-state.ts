/**
 * @wfx/app-web — the R25 realtime-bridge STATUS STATE (R25-D).
 *
 * The bridge's capability truth, shared between the boot path that starts
 * it (instrumentation.ts / the capability route's lazy boot) and the route
 * views that READ it (the player's realtime route view). The state lives
 * on `globalThis` — the documented Turbopack dev-boot doctrine (per-route
 * module graphs mint separate module instances; the one process shares
 * exactly one global object). In the service boot without the bridge the
 * status is the honest absent truth (never a claimed capability).
 */

/** One declared target language (the provider's direction truth). */
interface BridgeTargetLanguage {
  readonly code: string;
  readonly label: string;
}

/** The bridge's process-wide status (the route view's read). */
export interface RealtimeBridgeStatus {
  /** Whether the bridge is serving on this process. */
  readonly running: boolean;
  /** The bridge's port (the client island's ws:// URL derivation). */
  readonly port: number | null;
  /** The registered provider seam's identity (null when none registered). */
  readonly provider: { readonly id: string; readonly detail: string } | null;
  /** The provider's declared target languages. */
  readonly targetLanguages: readonly BridgeTargetLanguage[];
  /** The honest reason when the bridge is not running (a failed boot; the gated-off boot). */
  readonly note?: string;
}

/** The globalThis key (one process, one bridge truth). */
const BRIDGE_STATE_KEY = "__wfxRealtimeBridgeStatus";

type BridgeGlobal = typeof globalThis & {
  [BRIDGE_STATE_KEY]?: RealtimeBridgeStatus;
};

/** Read the bridge's current status (the honest absent default). */
export function readRealtimeBridgeStatus(): RealtimeBridgeStatus {
  const status = (globalThis as BridgeGlobal)[BRIDGE_STATE_KEY];
  if (status === undefined) {
    return { running: false, port: null, provider: null, targetLanguages: [] };
  }
  return status;
}

/** Record the bridge's running status (the boot path's write). */
export function setRealtimeBridgeStatus(status: RealtimeBridgeStatus): void {
  (globalThis as BridgeGlobal)[BRIDGE_STATE_KEY] = status;
}
