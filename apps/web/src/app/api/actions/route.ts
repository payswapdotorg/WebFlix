/**
 * @wfx/app-web — the action route (WFX-051): POST /api/actions.
 *
 * The bridge the client like/save controls call: the typed body → the
 * Experience API actions use-case through the 050 host boot law (fixtures
 * behind `WFX_DEV_FIXTURES=1` dev-only, the `WFX_API_BASE` remote ports in
 * service mode). The RECEIPT is the truth: the response body is the frozen
 * `ActionReceipt` verbatim (status confirmed / local-only / unsupported /
 * failed) — the client renders exactly what the source answered, never a
 * fabricated success.
 *
 * Caller-misuse (malformed body, foreign connector) answers 400 with the
 * problem text; a port that violates the plain surface answers 502 with the
 * typed detail. No secrets, no env in the response.
 */

import { NextResponse } from "next/server";

import { ExperienceError } from "@wfx/experience";

import { bootExperienceHost } from "@/host/experience";
import { runAction, type ActionRequestBody } from "@/host/views";

export const dynamic = "force-dynamic";

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

  const host = bootExperienceHost();
  try {
    const result = await runAction(host, body as ActionRequestBody);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    // The frozen ActionReceipt, verbatim — the source's own answer.
    return NextResponse.json(result.receipt, { status: 200 });
  } catch (thrown) {
    if (thrown instanceof ExperienceError) {
      return NextResponse.json({ error: thrown.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: `the action use-case failed unexpectedly: ${String(thrown)}` },
      { status: 502 },
    );
  }
}
