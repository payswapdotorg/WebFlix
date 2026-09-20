/**
 * @wfx/app-web — the personalize API route (R21-D).
 *
 * The bridge the Personalize control calls — the RUNTIME's intent +
 * policy seams (R01/R05) are the one owner; this route is their typed
 * transport over the existing ServerPort write-through (both web
 * transports implement `writeIntent`/`writePolicy` — a server failure
 * answers the typed 502, never a fake success).
 *
 * - `GET /api/personalize` → the current policy view + the active
 *   session intents (the runtime's own read).
 * - `POST /api/personalize` `{ kind: "intent", objective }` → a
 *   SESSION-SCOPED intent (`scope: "session"` — cleared when the session
 *   ends, never persisted as long-term preference by the IntentStore
 *   law). Empty/garbage objectives answer the typed 400.
 * - `POST /api/personalize` `{ kind: "clear-intent" }` → the honest
 *   clear: `intents.endSession()` (the runtime's own law — session and
 *   momentary intents are cleared; nothing durable is touched).
 * - `POST /api/personalize` `{ kind: "attention", attentionMode }` → the
 *   attention-mode policy (the frozen ATTENTION_MODES vocabulary; a
 *   non-vocabulary mode answers the typed 400).
 * - `POST /api/personalize` `{ kind: "exploration", value }` → the
 *   exploration dial in [0,1] (the current attention mode is retained —
 *   the runtime's policy view keeps unset dials).
 */

import { NextResponse } from "next/server";

import { ATTENTION_MODES } from "@wfx/domain";
import type { AttentionMode } from "@wfx/client-runtime";
import { isRuntimeError } from "@wfx/client-runtime";

import { getWebRuntimeHostForRequest } from "@/host/web-host";
import { sessionTokenFromRequest } from "@/host/session-cookie";
import { loadPersonalizeView } from "@/host/discoverability";

export const dynamic = "force-dynamic";

/**
 * R22-G fix: the route resolves the REQUEST-SCOPED host (the session law
 * the R22-D/F routes follow). Before, `getWebRuntimeHost()` wrote the
 * ANONYMOUS singleton's runtime — an authenticated session's intent /
 * attention-mode changes landed in the wrong host and the page (which
 * resolves the identity's host) never observed them.
 */
async function hostFor(request: Request) {
  return getWebRuntimeHostForRequest(sessionTokenFromRequest(request) ?? undefined);
}

/** The closed action vocabulary the POST accepts. */
const KINDS = new Set(["intent", "clear-intent", "attention", "exploration"]);

export async function GET(request: Request): Promise<NextResponse> {
  const host = await hostFor(request);
  return NextResponse.json(loadPersonalizeView(host));
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body: expected JSON" }, { status: 400 });
  }
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const kind = typeof record.kind === "string" ? record.kind : undefined;
  if (kind === undefined || !KINDS.has(kind)) {
    return NextResponse.json(
      { error: `kind: expected one of ${[...KINDS].join(" | ")}` },
      { status: 400 },
    );
  }

  const host = await hostFor(request);
  const runtime = host.runtime;
  try {
    if (kind === "intent") {
      const objective = typeof record.objective === "string" ? record.objective.trim() : "";
      if (objective.length === 0) {
        return NextResponse.json(
          { error: "objective: expected a non-empty description of what you're in the mood for" },
          { status: 400 },
        );
      }
      // SESSION-SCOPED by design: the Personalize control states a mood
      // for THIS session — the IntentStore law keeps session intents out
      // of the durable profile (they never corrupt long-term preference).
      await runtime.setIntent({ objective, scope: "session" });
      return NextResponse.json(loadPersonalizeView(host));
    }
    if (kind === "clear-intent") {
      // The honest clear path: the runtime's own end-session law (session
      // + momentary intents are cleared; durable scopes are untouched).
      runtime.intents.endSession();
      return NextResponse.json(loadPersonalizeView(host));
    }
    if (kind === "attention") {
      const mode = typeof record.attentionMode === "string" ? record.attentionMode : undefined;
      if (mode === undefined || !(ATTENTION_MODES as readonly string[]).includes(mode)) {
        return NextResponse.json(
          { error: `attentionMode: expected one of ${ATTENTION_MODES.join(" | ")}` },
          { status: 400 },
        );
      }
      await runtime.setRecommendationPolicy({ attentionMode: mode as AttentionMode });
      return NextResponse.json(loadPersonalizeView(host));
    }
    // kind === "exploration"
    const value = record.value;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      return NextResponse.json(
        { error: "value: expected a number between 0 and 1" },
        { status: 400 },
      );
    }
    // The current attention mode is retained (the runtime keeps unset
    // dials — a dial change never silently switches modes).
    const current = runtime.intents.policy();
    await runtime.setRecommendationPolicy({
      attentionMode: current.attentionMode,
      exploration: value,
    });
    return NextResponse.json(loadPersonalizeView(host));
  } catch (thrown) {
    if (isRuntimeError(thrown)) {
      return NextResponse.json({ error: thrown.message }, { status: 400 });
    }
    // A typed write-through failure (the server seam's mapped error) —
    // never a fake success.
    return NextResponse.json(
      { error: thrown instanceof Error ? thrown.message : String(thrown) },
      { status: 502 },
    );
  }
}
