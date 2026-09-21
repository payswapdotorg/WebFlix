/**
 * @wfx/app-web — the playback session bridge (R24-W2).
 *
 * THE DEV-SERVER SPLIT-MODULE REALITY (the documented doctrine — the same
 * law `acquisition-fixtures.ts` keeps): the Turbopack dev server compiles
 * every route as its own module graph — the /player page's runtime and the
 * /api/playback route's runtime are SEPARATE module instances with
 * separate controllers. A session the PAGE resolved is invisible to the
 * ROUTE in that boot. Production (one server bundle) and the in-process
 * tests share ONE module — the direct path works unchanged there.
 *
 * THE BRIDGE (dev-boot truth, never a second playback system): the page
 * records the resolved session's INTENT (the exact resolvePlayback input
 * + the page's session id) into a small shared JSON file; the route, on a
 * session id its own runtime does not know, re-resolves the SAME intent
 * through its OWN runtime (the same frozen resolve path — never a
 * fabricated controller) and caches the mapping for the session's life.
 * The watch-state folds land in the issuing module's runtime — the same
 * dev-mode split the /api/events route documents; the single-bundle
 * production boot folds everything into one runtime.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WebRuntimeHost } from "./web-host";
import type { PlaybackController } from "@wfx/client-runtime";
import type { PlaybackRealization } from "@wfx/domain";

/** The shared bridge state file (the page + route modules agree on the path). */
const BRIDGE_STATE_FILE = join(tmpdir(), "wfx-dev-playback-bridge.json");

/** One bridged session intent (the exact resolve input + the page's id). */
export interface BridgedSessionIntent {
  /** The PAGE's session id (the chrome's own handle). */
  readonly sessionId: string;
  readonly itemId: string;
  readonly externalRef: string;
  readonly connectorId?: string;
  readonly resumePositionMs?: number;
  readonly preferredMode?: PlaybackRealization["mode"];
  readonly preferredRealization?: "torrent";
}

/** The bridge file's shape (a bounded map, newest last). */
interface BridgeState {
  readonly sessions: readonly BridgedSessionIntent[];
}

/** The bound on remembered intents (the honest dev-boot window). */
const MAX_BRIDGED_SESSIONS = 24;

/** Read the bridge state (an absent file is pristine). */
function readBridge(): BridgeState {
  try {
    if (!existsSync(BRIDGE_STATE_FILE)) return { sessions: [] };
    const parsed = JSON.parse(readFileSync(BRIDGE_STATE_FILE, "utf-8")) as Partial<BridgeState>;
    if (!Array.isArray(parsed.sessions)) return { sessions: [] };
    return { sessions: parsed.sessions.filter((entry) => typeof entry?.sessionId === "string") };
  } catch {
    return { sessions: [] };
  }
}

/** Write the bridge state (best-effort — a dev-boot aid, never a gate). */
function writeBridge(state: BridgeState): void {
  try {
    writeFileSync(BRIDGE_STATE_FILE, JSON.stringify(state), "utf-8");
  } catch {
    // The bridge is a dev-boot aid; a failed write degrades to the direct
    // path (the route answers its own runtime's honest not-found).
  }
}

/** Record one resolved session's intent (the page module's side). */
export function recordPlaybackSession(intent: BridgedSessionIntent): void {
  const state = readBridge();
  const sessions = state.sessions.filter((entry) => entry.sessionId !== intent.sessionId);
  while (sessions.length >= MAX_BRIDGED_SESSIONS) {
    sessions.shift();
  }
  sessions.push(intent);
  writeBridge({ sessions });
}

/** Look up one bridged intent (the route module's side). */
export function bridgedIntentOf(sessionId: string): BridgedSessionIntent | null {
  return readBridge().sessions.find((entry) => entry.sessionId === sessionId) ?? null;
}

/** The per-module controller cache (page session id → this module's controller). */
const controllerCache = new Map<string, PlaybackController>();

/**
 * Resolve the controller for one session id in THIS module's runtime:
 * the direct path when the runtime knows the session, the bridged
 * re-resolution when only the dev-split bridge does (never a fabricated
 * controller — a session nobody knows answers null).
 */
export async function controllerForSessionId(
  host: WebRuntimeHost,
  sessionId: string,
): Promise<PlaybackController | null> {
  const direct = host.runtime.playback.controller(sessionId);
  if (direct !== undefined) return direct;

  const cached = controllerCache.get(sessionId);
  if (cached !== undefined) return cached;

  const intent = bridgedIntentOf(sessionId);
  if (intent === null) return null;

  // The SAME frozen resolve path, through THIS module's runtime (the
  // preferred realization resolves exactly as the page did).
  let preferredRealization: PlaybackRealization | undefined;
  if (intent.preferredMode !== undefined) {
    const resolved = await host.serverPort.resolve(intent.externalRef);
    if (resolved.ok && Array.isArray(resolved.value)) {
      preferredRealization = resolved.value.find(
        (realization) => realization.mode === intent.preferredMode,
      );
    }
  }
  try {
    const session = await host.runtime.resolvePlayback({
      itemId: intent.itemId,
      externalRef: intent.externalRef,
      ...(intent.connectorId !== undefined ? { connectorId: intent.connectorId } : {}),
      ...(preferredRealization !== undefined ? { realization: preferredRealization } : {}),
      ...(intent.resumePositionMs !== undefined && intent.resumePositionMs > 0
        ? { resumePositionMs: intent.resumePositionMs }
        : {}),
    });
    const controller = host.runtime.playback.controller(session.id);
    if (controller === undefined) return null;
    // Engage the surface exactly as the page did (the same prepare law).
    const prepared = await controller.prepare();
    if (!prepared.ok) return null;
    controllerCache.set(sessionId, controller);
    return controller;
  } catch {
    return null;
  }
}

/** Reset the bridge + cache (the test seam's hook). */
export function resetPlaybackBridgeForTests(): void {
  controllerCache.clear();
  try {
    rmSync(BRIDGE_STATE_FILE, { force: true });
  } catch {
    // An absent file is already pristine.
  }
}
