/**
 * @wfx/app-web — the playback command route (R24-W2): POST/GET /api/playback.
 *
 * THE FAMILIAR PLAYER GRAMMAR'S REAL BACKING: the client player chrome's
 * transport commands (play / pause / seek / stop) and its state reads
 * land here and execute against the RUNTIME's own PlaybackController —
 * the same typed command surface every realization uses (provider,
 * authorized peer copy, local). Nothing is simulated:
 *
 * - POST { sessionId, command } → the controller's typed command result
 *   (ok | {kind, detail}) mapped 1:1 — a refused command renders its
 *   honest typed state, never a fabricated success;
 * - GET ?sessionId= → the session's TRUTHFUL state snapshot (phase,
 *   position, buffered, duration) — the only progress truth the chrome
 *   ever renders (no ticker, no fake progress — the runtime's law).
 *
 * The route is honest about session lifetime: a session id the runtime
 * no longer knows answers the typed not-found state (the chrome offers
 * the reload path), never a synthesized snapshot.
 */

import { NextResponse } from "next/server";

import { getWebRuntimeHost } from "@/host/web-host";
import { controllerForSessionId } from "@/host/playback-bridge";

export const dynamic = "force-dynamic";

/** One playback command from the chrome (the typed vocabulary). */
interface PlaybackRequestBody {
  readonly sessionId?: string;
  readonly command?: "play" | "pause" | "seek" | "stop";
  /** The seek target (ms) — required iff command === "seek". */
  readonly positionMs?: number;
}

/** The mapped command result the chrome renders (1:1 with the runtime's). */
interface CommandOutcome {
  readonly ok: boolean;
  readonly kind?: string;
  readonly detail?: string;
}

/** Execute one typed command against the session's real controller. */
async function runCommand(
  sessionId: string,
  command: "play" | "pause" | "seek" | "stop",
  positionMs?: number,
): Promise<CommandOutcome> {
  const host = await getWebRuntimeHost();
  // The direct path first; the dev-split bridge re-resolves the SAME
  // intent through THIS module's runtime when the page's session is
  // unknown here (the documented Turbopack module-graph split — never a
  // fabricated controller).
  const controller = await controllerForSessionId(host, sessionId);
  if (controller === null) {
    return { ok: false, kind: "not-found", detail: `no playback session '${sessionId}' on this host` };
  }
  if (command === "seek") {
    if (typeof positionMs !== "number" || !Number.isFinite(positionMs) || positionMs < 0) {
      return { ok: false, kind: "invalid-input", detail: "seek.positionMs: expected a finite non-negative number" };
    }
    const result = await controller.seek(positionMs);
    return result.ok
      ? { ok: true }
      : { ok: false, kind: result.kind, detail: result.detail };
  }
  const result =
    command === "play"
      ? await controller.play()
      : command === "pause"
        ? await controller.pause()
        : await controller.stop();
  return result.ok ? { ok: true } : { ok: false, kind: result.kind, detail: result.detail };
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
  const outcome = await runCommand(input.sessionId, input.command, input.positionMs);
  return NextResponse.json(outcome, { status: 200 });
}

/** GET /api/playback?sessionId= — the session's truthful state snapshot. */
export async function GET(request: Request): Promise<NextResponse> {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (sessionId === null || sessionId.length === 0) {
    return NextResponse.json({ error: "sessionId: expected a non-empty query parameter" }, { status: 400 });
  }
  const host = await getWebRuntimeHost();
  const controller = await controllerForSessionId(host, sessionId);
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
      state: {
        sessionId: state.sessionId,
        itemId: state.itemId,
        mode: state.mode,
        phase: state.phase,
        positionMs: state.positionMs,
        bufferedMs: state.bufferedMs,
        ...(state.durationMs !== undefined ? { durationMs: state.durationMs } : {}),
      },
    },
    { status: 200 },
  );
}
