/**
 * @wfx/app-web — the playback-telemetry route (R24-E): POST/GET/DELETE
 * /api/playback/telemetry.
 *
 * THE RETENTION SEAM of the performance contract: the product's client
 * surfaces flush their real startup traces here; the benchmark harness
 * and the journeys read them back over HTTP from the RUNNING product.
 * Nothing is synthesized — this route stores what the real surfaces
 * recorded, validates every marker against the shared frozen
 * vocabulary, and answers the typed rejection otherwise.
 *
 * - POST {traceId, itemId, realization?, markers[]} → {ok, stored} or
 *   {ok: false, reason} (a 400 for a malformed body, a 200-with-reason
 *   for a well-formed trace the contract vocabulary rejects — both are
 *   honest typed answers, never a silent drop);
 * - GET ?itemId= → the retained traces (the raw observations);
 * - DELETE → reset (the harness's between-passes determinism).
 */

import { NextResponse } from "next/server";

import {
  resetPlaybackTelemetryStore,
  retainedPlaybackTraces,
  storePlaybackTrace,
} from "@/host/playback-telemetry-store";

export const dynamic = "force-dynamic";

/** POST /api/playback/telemetry — validate + retain one flushed trace. */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "body: expected JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ ok: false, reason: "body: expected a JSON object" }, { status: 400 });
  }
  const outcome = storePlaybackTrace(body as Record<string, unknown>);
  if (!outcome.ok) {
    // A well-formed request whose markers fall outside the frozen
    // vocabulary: the typed rejection (200 + reason — the harness reads
    // the answer; never a silent store, never a crash).
    return NextResponse.json(outcome, { status: 200 });
  }
  return NextResponse.json(outcome, { status: 200 });
}

/** GET /api/playback/telemetry?itemId= — the retained raw observations. */
export async function GET(request: Request): Promise<NextResponse> {
  const itemId = new URL(request.url).searchParams.get("itemId") ?? undefined;
  const traces = retainedPlaybackTraces(
    itemId !== undefined && itemId.length > 0 ? itemId : undefined,
  );
  return NextResponse.json(
    { ok: true, count: traces.length, traces },
    { status: 200 },
  );
}

/** DELETE /api/playback/telemetry — reset the retention store. */
export async function DELETE(): Promise<NextResponse> {
  resetPlaybackTelemetryStore();
  return NextResponse.json({ ok: true }, { status: 200 });
}
