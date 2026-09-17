/**
 * @wfx/app-web — the event route (R07): POST /api/events.
 *
 * The bridge the client engagement controls call (watch-state reports,
 * short-feed skips): the typed body is composed into a RUNTIME watch-state
 * command (`runtime.updateWatchState`) — the runtime folds the session
 * state AND emits the at-least-once event through its ServerPort (a
 * delivery failure keeps the event pending and THROWS the typed error —
 * the EventSink law: a lost watch-state event is never a silent success).
 *
 * Honesty laws:
 * - The user-reportable vocabulary is CLOSED: progress / complete / skip.
 *   `"start"` is emitted by the runtime's playback controller when a
 *   session first plays (a client re-sending it would duplicate watch
 *   evidence); `"like"` / `"save"` are settled by the runtime's action
 *   engine when the source answers; `"share"` is the external/social
 *   actions lane (R15) — the R01 runtime carries watch-state events only.
 *   All are rejected here with the reason, never silently accepted.
 * - A delivery failure (the runtime throws the typed RuntimeError) answers
 *   502 with the typed detail — never a silent success.
 */

import { NextResponse } from "next/server";

import { isEntertainmentItemId, isRecord } from "@wfx/domain";
import type { WatchStateCommand } from "@wfx/client-runtime";
import { isRuntimeError } from "@wfx/client-runtime";

import { getWebRuntimeHost } from "@/host/web-host";

export const dynamic = "force-dynamic";

/** The closed user-reportable watch vocabulary (see the module doc). */
const REPORTABLE_EVENT_TYPES: readonly WatchStateCommand["kind"][] = ["progress", "complete", "skip"];

const REPORTABLE_SET: ReadonlySet<string> = new Set(REPORTABLE_EVENT_TYPES as readonly string[]);

/** Validate the optional payload's known keys (defensive, typed). */
function payloadProblems(payload: unknown): string[] {
  if (payload === undefined) return [];
  if (!isRecord(payload)) return ["payload: expected an object when present"];
  const problems: string[] = [];
  if (
    payload.positionMs !== undefined &&
    (typeof payload.positionMs !== "number" || !Number.isFinite(payload.positionMs) || payload.positionMs < 0)
  ) {
    problems.push("payload.positionMs: expected a finite non-negative number when present");
  }
  if (
    payload.percent !== undefined &&
    (typeof payload.percent !== "number" ||
      !Number.isFinite(payload.percent) ||
      payload.percent < 0 ||
      payload.percent > 100)
  ) {
    problems.push("payload.percent: expected a finite number in [0, 100] when present");
  }
  if (
    payload.playbackSessionId !== undefined &&
    (typeof payload.playbackSessionId !== "string" || payload.playbackSessionId.length === 0)
  ) {
    problems.push("payload.playbackSessionId: expected a non-empty string when present");
  }
  return problems;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body: expected JSON" }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: "body: expected a JSON object" }, { status: 400 });
  }

  const problems: string[] = [];
  if (typeof body.itemId !== "string" || !isEntertainmentItemId(body.itemId)) {
    problems.push(
      "itemId: expected a canonical entertainment-item ID (wfxitm_ prefix + 26-char ULID body)",
    );
  }
  if (typeof body.type !== "string" || !REPORTABLE_SET.has(body.type)) {
    problems.push(
      `type: expected one of ${REPORTABLE_EVENT_TYPES.join(" | ")} — 'start' is emitted by the runtime's playback controller on first play, 'like'/'save' settle through the action route, and 'share' is the external/social actions lane (R15)`,
    );
  }
  problems.push(...payloadProblems(body.payload));
  if (problems.length > 0) {
    return NextResponse.json({ error: problems.join("; ") }, { status: 400 });
  }

  const itemId = body.itemId as string;
  const kind = body.type as WatchStateCommand["kind"];
  const payload = isRecord(body.payload) ? body.payload : undefined;
  const command: WatchStateCommand =
    kind === "progress"
      ? {
          kind,
          itemId,
          positionMs:
            typeof payload?.positionMs === "number" && Number.isFinite(payload.positionMs) && payload.positionMs >= 0
              ? payload.positionMs
              : 0,
          ...(typeof payload?.playbackSessionId === "string" && payload.playbackSessionId.length > 0
            ? { playbackSessionId: payload.playbackSessionId }
            : {}),
        }
      : {
          kind,
          itemId,
          ...(typeof payload?.positionMs === "number" &&
          Number.isFinite(payload.positionMs) &&
          payload.positionMs >= 0
            ? { positionMs: payload.positionMs }
            : {}),
          ...(typeof payload?.playbackSessionId === "string" && payload.playbackSessionId.length > 0
            ? { playbackSessionId: payload.playbackSessionId }
            : {}),
        };

  const host = await getWebRuntimeHost();
  try {
    // The runtime folds the session state and emits the at-least-once
    // event; a delivery failure THROWS (the EventSink law) → typed 502.
    await host.runtime.updateWatchState(command);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (thrown) {
    return NextResponse.json(
      {
        error: isRuntimeError(thrown)
          ? `the watch-state report was not delivered (${thrown.kind}): ${thrown.message}`
          : thrown instanceof Error
            ? `the watch-state report was not delivered: ${thrown.message}`
            : "the watch-state report was not delivered",
      },
      { status: 502 },
    );
  }
}
