/**
 * @wfx/app-web — the R37 livechat bridge STATUS (the process-global the
 * route views read — the realtime-bridge-state.ts law verbatim).
 *
 * The Turbopack dev server compiles every route as its own module graph;
 * the bridge's boot record therefore lives on `globalThis` so the /live
 * view, the watch live mode, and the boot module — separate module
 * instances — all read the ONE shared truth (the same doctrine
 * realtime-bridge-state.ts and the BYOF fixtures runtime follow).
 */

/** The livechat bridge's process-global status (the honest absent state by default). */
export interface LiveChatBridgeStatus {
  /** Whether the bridge is serving on this host. */
  readonly running: boolean;
  /** The serving port (null when not running). */
  readonly port: number | null;
  /** The chat session seam's identity (the dev double in the fixtures boot; null in the bridge-only boot). */
  readonly provider: { readonly id: string; readonly detail: string } | null;
}

/** The globalThis key every module-graph copy agrees on (the one-boot law). */
const LIVECHAT_BRIDGE_STATE_KEY = "__wfxLiveChatBridgeStatus";

type LiveChatBridgeGlobal = typeof globalThis & {
  [LIVECHAT_BRIDGE_STATE_KEY]?: LiveChatBridgeStatus;
};

/** Read the livechat bridge's status (the honest absent state by default). */
export function readLiveChatBridgeStatus(): LiveChatBridgeStatus {
  const globals = globalThis as LiveChatBridgeGlobal;
  return (
    globals[LIVECHAT_BRIDGE_STATE_KEY] ?? { running: false, port: null, provider: null }
  );
}

/** Set the livechat bridge's status (the boot + stop paths only). */
export function setLiveChatBridgeStatus(status: LiveChatBridgeStatus): void {
  (globalThis as LiveChatBridgeGlobal)[LIVECHAT_BRIDGE_STATE_KEY] = status;
}
