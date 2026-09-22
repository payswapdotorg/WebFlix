/**
 * @wfx/app-web — the playback command route (R24-W2 + R26-W2): POST/GET /api/playback.
 *
 * THE FAMILIAR PLAYER GRAMMAR'S REAL BACKING: the client player chrome's
 * transport commands (play / pause / seek / stop) and its state reads
 * land here and execute against the RUNTIME's own PlaybackController —
 * the same typed command surface every realization uses (provider,
 * authorized peer copy, local). Nothing is simulated:
 *
 * - POST { sessionId, command, intent? } → the controller's typed command
 *   result (ok | {kind, detail}) mapped 1:1 — a refused command renders its
 *   honest typed state, never a fabricated success; the response carries
 *   the session's post-command state snapshot (one round trip — the state
 *   read no longer needs a second GET);
 * - GET ?sessionId= → the session's TRUTHFUL state snapshot (phase,
 *   position, buffered, duration) — the only progress truth the chrome
 *   ever renders (no ticker, no fake progress — the runtime's law).
 *
 * R26-W2 — THE PRODUCTION MULTI-INSTANCE LAW (the corrective takeover's
 * root-cause fix): a serverless deployment serves the /player page render
 * and this route on DIFFERENT invocations — the module-level session cache
 * and the dev-split bridge file are both per-instance, so a session the
 * page created answers "not found on this host" here forever (the
 * reproduced production failure). The fix is STATELESS COMMAND MAPPING:
 * the chrome carries the page's exact playback INTENT (the resolve input
 * the page used, minted from the player URL's own parameters) and sends
 * it with every command; when THIS invocation knows neither the session
 * nor the dev bridge entry, the route re-resolves the SAME intent through
 * its OWN runtime (the same frozen resolve path — never a fabricated
 * controller) and caches the mapping for the session's life. The route
 * stays honest about what it cannot do: an unknown session WITHOUT an
 * intent answers the typed not-found state (the chrome offers the reload
 * path), never a synthesized snapshot.
 */

import { NextResponse } from "next/server";

import { getWebRuntimeHost } from "@/host/web-host";
import {
  controllerForSessionId,
  controllerForSessionIdWithClientIntent,
  parseClientPlaybackIntent,
  type ClientPlaybackIntent,
} from "@/host/playback-bridge";

export const dynamic = "force-dynamic";

/** One playback command from the chrome (the typed vocabulary). */
interface PlaybackRequestBody {
  readonly sessionId?: string;
  readonly command?: "play" | "pause" | "seek" | "stop";
  /** The seek target (ms) — required iff command === "seek". */
  readonly positionMs?: number;
  /**
   * R26-W2 — the page's playback intent (the exact resolve input the player
   * page used), carried by the chrome so a cold invocation can re-resolve
   * the SAME session through the frozen path. Optional; shape-validated.
   */
  readonly intent?: unknown;
}

/** The mapped command result the chrome renders (1:1 with the runtime's). */
interface CommandOutcome {
  readonly ok: boolean;
  readonly kind?: string;
  readonly detail?: string;
  /** The session's truthful post-command state (present iff a controller resolved). */
  readonly state?: PlaybackStateBody;
}

/** The session state snapshot the chrome renders (the truthful fields only). */
interface PlaybackStateBody {
  readonly sessionId: string;
  readonly itemId: string;
  readonly mode: string;
  readonly phase: string;
  readonly positionMs: number;
  readonly bufferedMs: number;
  readonly durationMs?: number;
}

/** Project the controller's state into the response body (pure). */
function stateBodyOf(state: {
  readonly sessionId: string;
  readonly itemId: string;
  readonly mode: string;
  readonly phase: string;
  readonly positionMs: number;
  readonly bufferedMs: number;
  readonly durationMs?: number;
}): PlaybackStateBody {
  return {
    sessionId: state.sessionId,
    itemId: state.itemId,
    mode: state.mode,
    phase: state.phase,
    positionMs: state.positionMs,
    bufferedMs: state.bufferedMs,
    ...(state.durationMs !== undefined ? { durationMs: state.durationMs } : {}),
  };
}

/** Execute one typed command against the session's real controller. */
async function runCommand(
  sessionId: string,
  command: "play" | "pause" | "seek" | "stop",
  positionMs: number | undefined,
  intent: ClientPlaybackIntent | null,
): Promise<CommandOutcome> {
  const host = await getWebRuntimeHost();
  // The resolution ladder (R26-W2): the direct path first; the dev-split
  // bridge re-resolves the SAME intent through THIS module's runtime when
  // the page's session is unknown here; the CLIENT-CARRIED intent answers
  // when neither knows (the production multi-instance law — the documented
  // Turbopack module-graph split generalized to the invocation split).
  // Never a fabricated controller: an unknown session with no intent keeps
  // the honest typed not-found.
  const controller =
    intent !== null
      ? await controllerForSessionIdWithClientIntent(host, sessionId, intent)
      : await controllerForSessionId(host, sessionId);
  if (controller === null) {
    return { ok: false, kind: "not-found", detail: `no playback session '${sessionId}' on this host` };
  }
  if (command === "seek") {
    if (typeof positionMs !== "number" || !Number.isFinite(positionMs) || positionMs < 0) {
      return { ok: false, kind: "invalid-input", detail: "seek.positionMs: expected a finite non-negative number" };
    }
    const result = await controller.seek(positionMs);
    return result.ok
      ? { ok: true, state: stateBodyOf(controller.state()) }
      : { ok: false, kind: result.kind, detail: result.detail };
  }
  const result =
    command === "play"
      ? await controller.play()
      : command === "pause"
        ? await controller.pause()
        : await controller.stop();
  return result.ok
    ? { ok: true, state: stateBodyOf(controller.state()) }
    : { ok: false, kind: result.kind, detail: result.detail };
}

/** POST /api/playback — execute one chrome command against the runtime. */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body: expected JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "body: expected a JSON object" }, { status: 400 });
  }
  const input = body as Partial<PlaybackRequestBody>;
  if (typeof input.sessionId !== "string" || input.sessionId.length === 0) {
    return NextResponse.json({ error: "sessionId: expected a non-empty string" }, { status: 400 });
  }
  if (input.command !== "play" && input.command !== "pause" && input.command !== "seek" && input.command !== "stop") {
    return NextResponse.json(
      { error: "command: expected 'play' | 'pause' | 'seek' | 'stop'" },
      { status: 400 },
    );
  }
  // R26-W2 — the client-carried intent (shape-validated; a malformed intent
  // is ignored, never trusted — the honest not-found answers then).
  const intent = parseClientPlaybackIntent(input.intent);
  const outcome = await runCommand(input.sessionId, input.command, input.positionMs, intent);
  return NextResponse.json(outcome, { status: 200 });
}

/**
 * GET /api/playback?sessionId= — the session's truthful state snapshot.
 *
 * R26-W2: the state read accepts the SAME client-carried intent (the flat
 * query form of the POST body's intent — `itemId`, `connector`, `ref`,
 * `resume`, `mode`, `realization`) so a cold invocation re-resolves the
 * session before answering; an unknown session with no intent answers the
 * typed not-found state (the chrome offers the reload path), never a
 * synthesized snapshot.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("sessionId");
  if (sessionId === null || sessionId.length === 0) {
    return NextResponse.json({ error: "sessionId: expected a non-empty query parameter" }, { status: 400 });
  }
  const host = await getWebRuntimeHost();
  // The flat query intent (present iff the chrome passed it).
  const itemId = params.get("itemId");
  const externalRef = params.get("ref");
  const connectorId = params.get("connector");
  const resumeRaw = params.get("resume");
  const mode = params.get("mode");
  const realization = params.get("realization");
  const intent =
    itemId !== null && itemId.length > 0 && externalRef !== null && externalRef.length > 0
      ? parseClientPlaybackIntent({
          itemId,
          externalRef,
          ...(connectorId !== null && connectorId.length > 0 ? { connectorId } : {}),
          ...(resumeRaw !== null && Number.isFinite(Number(resumeRaw)) && Number(resumeRaw) > 0
            ? { resumePositionMs: Number(resumeRaw) }
            : {}),
          ...(mode === "embed" || mode === "browser" || mode === "external" || mode === "native"
            ? { preferredMode: mode }
            : {}),
          ...(realization === "torrent" ? { preferredRealization: "torrent" } : {}),
        })
      : null;
  const controller =
    intent !== null
      ? await controllerForSessionIdWithClientIntent(host, sessionId, intent)
      : await controllerForSessionId(host, sessionId);
  if (controller === null) {
    return NextResponse.json(
      { ok: false, kind: "not-found", detail: `no playback session '${sessionId}' on this host` },
      { status: 200 },
    );
  }
  const state = controller.state();
  return NextResponse.json(
    {
      ok: true,
      state: stateBodyOf(state),
    },
    { status: 200 },
  );
}
