/**
 * @wfx/app-web — the event route (WFX-051): POST /api/events.
 *
 * The bridge the client engagement controls call (watch-state reports,
 * short-feed skip/share): the typed body is composed into a frozen
 * `EntertainmentEvent` through the ports (identity from the fixed
 * experience context, `occurredAt` from the injected Clock — the same seam
 * law as every use-case) and emitted through the WRAPPED EventSink
 * (`host/watch-state.ts`: recorded for continue-watching AND forwarded to
 * the real sink — nothing is swallowed).
 *
 * Honesty laws:
 * - The user-reportable vocabulary is CLOSED: progress / complete / skip /
 *   share. `"start"` is emitted by the playback use-case when a session
 *   begins (a client re-sending it would duplicate watch evidence), and
 *   `"like"` / `"save"` are MIRRORED by the action use-case when the source
 *   confirms them (a client cannot fabricate engagement the source never
 *   confirmed). Both are rejected here with the reason.
 * - A sink failure (service mode: the remote sink throws the typed
 *   `HostTransportError`) answers 502 with the typed detail — a lost
 *   watch-state event is never a silent success.
 */

import { NextResponse } from "next/server";

import { isEntertainmentItemId, isRecord } from "@wfx/domain";
import type { EntertainmentEvent } from "@wfx/domain";
import { composeExperienceEvent } from "@wfx/experience";

import { bootExperienceHost, EXPERIENCE_CONTEXT } from "@/host/experience";

export const dynamic = "force-dynamic";

/** The closed user-reportable vocabulary (see the module doc). */
const REPORTABLE_EVENT_TYPES: readonly EntertainmentEvent["type"][] = [
  "progress",
  "complete",
  "skip",
  "share",
];

const REPORTABLE_SET: ReadonlySet<string> = new Set(REPORTABLE_EVENT_TYPES as readonly string[]);

/** Validate the optional payload's known keys (defensive, typed). */
function payloadProblems(payload: unknown): string[] {
  if (payload === undefined) return [];
  if (!isRecord(payload)) return ["payload: expected an object when present"];
  const problems: string[] = [];
  if (
    payload.positionMs !== undefined &&
    (typeof payload.positionMs !== "number" ||
      !Number.isFinite(payload.positionMs) ||
      payload.positionMs < 0)
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
      `type: expected one of ${REPORTABLE_EVENT_TYPES.join(" | ")} — 'start' is emitted by the playback use-case, 'like'/'save' are mirrored by the action use-case when the source confirms them`,
    );
  }
  problems.push(...payloadProblems(body.payload));
  if (problems.length > 0) {
    return NextResponse.json({ error: problems.join("; ") }, { status: 400 });
  }

  const itemId = body.itemId as string;
  const type = body.type as (typeof REPORTABLE_EVENT_TYPES)[number];
  const payload =
    isRecord(body.payload) && Object.keys(body.payload).length > 0
      ? (body.payload as Record<string, unknown>)
      : undefined;

  const host = bootExperienceHost();
  try {
    const event = composeExperienceEvent(host.client.runtime.ports.clock, EXPERIENCE_CONTEXT, {
      itemId,
      type,
      ...(payload !== undefined ? { payload } : {}),
    });
    // The WRAPPED sink: recorded for continue-watching AND forwarded.
    await host.client.runtime.ports.events.emit(event);
    return NextResponse.json({ ok: true, occurredAt: event.occurredAt }, { status: 200 });
  } catch (thrown) {
    // A lost watch-state event is never a silent success — typed 502.
    return NextResponse.json(
      {
        error:
          thrown instanceof Error
            ? `the event sink rejected the report: ${thrown.message}`
            : "the event sink rejected the report",
      },
      { status: 502 },
    );
  }
}
