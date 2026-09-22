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

/**
 * R26-W2 — the CLIENT-CARRIED playback intent (the production multi-instance
 * law): the exact same shape as a bridged intent, carried by the PLAYER
 * PAGE'S URL itself (the chrome holds it as a serialized prop and sends it
 * with every command). The page render creates the session in ONE
 * serverless invocation's memory; the client's /api/playback calls land on
 * OTHER invocations — the module cache and the dev-split bridge file are
 * both per-instance, so the intent the CLIENT carries is the only channel
 * that survives the invocation boundary. It is the SAME frozen resolve
 * input the page used (never a different session, never a fabricated
 * controller): the route re-resolves it through its OWN runtime exactly as
 * the dev bridge does, and caches the mapping for the session's life.
 */
export interface ClientPlaybackIntent {
  readonly itemId: string;
  readonly externalRef: string;
  readonly connectorId?: string;
  readonly resumePositionMs?: number;
  readonly preferredMode?: PlaybackRealization["mode"];
  readonly preferredRealization?: "torrent";
}

/**
 * R26-W2 — validate an untrusted client-carried intent (the route's body
 * guard): shape-checked field by field, exactly the typed vocabulary the
 * page mints. A malformed intent answers null — the route then keeps its
 * honest not-found path (never a guessed resolve).
 */
export function parseClientPlaybackIntent(
  raw: unknown,
): ClientPlaybackIntent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.itemId !== "string" || record.itemId.length === 0) return null;
  if (typeof record.externalRef !== "string" || record.externalRef.length === 0) return null;
  if (record.connectorId !== undefined && typeof record.connectorId !== "string") return null;
  if (
    record.resumePositionMs !== undefined &&
    (typeof record.resumePositionMs !== "number" ||
      !Number.isFinite(record.resumePositionMs) ||
      record.resumePositionMs < 0)
  ) {
    return null;
  }
  if (
    record.preferredMode !== undefined &&
    record.preferredMode !== "embed" &&
    record.preferredMode !== "browser" &&
    record.preferredMode !== "external" &&
    record.preferredMode !== "native"
  ) {
    return null;
  }
  if (record.preferredRealization !== undefined && record.preferredRealization !== "torrent") {
    return null;
  }
  return {
    itemId: record.itemId,
    externalRef: record.externalRef,
    ...(record.connectorId !== undefined ? { connectorId: record.connectorId } : {}),
    ...(record.resumePositionMs !== undefined ? { resumePositionMs: record.resumePositionMs } : {}),
    ...(record.preferredMode !== undefined
      ? { preferredMode: record.preferredMode }
      : {}),
    ...(record.preferredRealization !== undefined
      ? { preferredRealization: record.preferredRealization }
      : {}),
  };
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
 * R26-W2 — re-resolve one intent through THIS module's runtime (the ONE
 * shared re-resolution body): the SAME frozen resolve path the page ran,
 * preferred-realization handling included, prepare() engaged exactly as the
 * page engaged it. Never a fabricated controller — a re-resolution that
 * cannot complete answers null (the caller keeps its honest typed state).
 */
async function reResolveIntent(
  host: WebRuntimeHost,
  intent: ClientPlaybackIntent,
): Promise<PlaybackController | null> {
  // The preferred realization resolves exactly as the page did (the same
  // preferred-mode lookup over the same transport).
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
    return controller;
  } catch {
    return null;
  }
}

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

  const controller = await reResolveIntent(host, intent);
  if (controller === null) return null;
  controllerCache.set(sessionId, controller);
  return controller;
}

/**
 * R26-W2 — the CLIENT-CARRIED intent path (the production multi-instance
 * law): the page's session id is unknown here AND the dev-split bridge
 * file does not carry it (another invocation's container), but the CLIENT
 * carried the exact resolve intent with its command. Re-resolve the SAME
 * intent through THIS module's runtime (the frozen path — the same body
 * the dev bridge uses) and cache it under the PAGE's session id so the
 * session's life keeps answering on this instance. Never a fabricated
 * controller: a re-resolution that fails answers null and the route keeps
 * its honest typed not-found.
 */
export async function controllerForSessionIdWithClientIntent(
  host: WebRuntimeHost,
  sessionId: string,
  clientIntent: ClientPlaybackIntent,
): Promise<PlaybackController | null> {
  const direct = await controllerForSessionId(host, sessionId);
  if (direct !== null) return direct;
  const controller = await reResolveIntent(host, clientIntent);
  if (controller === null) return null;
  controllerCache.set(sessionId, controller);
  return controller;
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
