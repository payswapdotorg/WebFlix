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
 *   session intents (the runtime's own read, hydrated from the durable
 *   store + merged with the request-carried session objectives — see the
 *   R35 note below).
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
 *
 * R35 (C2) — THE SESSION-INTENT COOKIE: on the service-mode boot each
 * route/page render is a COLD runtime, so a session intent written here
 * never reached the pages' SSR discovery reads (the R34-A ledger's C2:
 * this route's own GET read the intents back — same instance — while the
 * watch page rendered no intent mark). The IntentStore law keeps session
 * scopes out of the server's durable records (they end with the session
 * by law), so the web adapter's own SESSION-SCOPED carrier is the
 * `wfx_session_intent` cookie (`host/session-intent-cookie.ts` — a
 * session cookie that dies with the browser session, exactly the
 * intent's scope): the intent write sets it to the merged active set,
 * the clear-intent empties it, and every answer composes the
 * request-carried objectives into the view (local entries win per
 * objective — the same merge law the IntentStore's hydrate follows).
 * Never a fabricated state: the cookie carries only objectives that were
 * actually submitted this session.
 */

import { NextResponse } from "next/server";

import { ATTENTION_MODES } from "@wfx/domain";
import type { AttentionMode } from "@wfx/client-runtime";
import { isRuntimeError } from "@wfx/client-runtime";

import { getWebRuntimeHost } from "@/host/web-host";
import { loadPersonalizeView } from "@/host/discoverability";
import {
  clearedSessionIntentCookie,
  mergeSessionIntentObjectives,
  sessionIntentCookieFor,
  sessionIntentObjectivesFromCookieHeader,
} from "@/host/session-intent-cookie";

export const dynamic = "force-dynamic";

/** The closed action vocabulary the POST accepts. */
const KINDS = new Set(["intent", "clear-intent", "attention", "exploration"]);

/** The request's carried session-intent objectives (the cookie's payload). */
function carriedIntentsOf(request: Request | undefined): readonly string[] {
  return sessionIntentObjectivesFromCookieHeader(request?.headers?.get("cookie") ?? null);
}

/**
 * The runtime's active SESSION-CLASS objectives (session + momentary —
 * the scopes `endSession` clears; the cookie carries exactly this class).
 */
function activeSessionObjectivesOf(runtime: {
  readonly intents: {
    readonly intents: () => readonly { readonly scope: string; readonly objective: string }[];
  };
}): readonly string[] {
  return runtime.intents
    .intents()
    .filter((intent) => intent.scope === "session" || intent.scope === "momentary")
    .map((intent) => intent.objective);
}

/** One view answer with the carried objectives merged + the cookie set. */
async function viewWithCookie(
  host: Awaited<ReturnType<typeof getWebRuntimeHost>>,
  carried: readonly string[],
  cookieValue: string,
): Promise<NextResponse> {
  const view = await loadPersonalizeView(host, carried);
  const response = NextResponse.json(view);
  response.headers.append("set-cookie", cookieValue);
  return response;
}

export async function GET(request?: Request): Promise<NextResponse> {
  const host = await getWebRuntimeHost();
  return NextResponse.json(await loadPersonalizeView(host, carriedIntentsOf(request)));
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

  const host = await getWebRuntimeHost();
  const runtime = host.runtime;
  const carried = carriedIntentsOf(request);
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
      // R35 (C2): the session-intent cookie carries the merged active
      // session set (this write + whatever the request carried — the
      // service-mode split means an earlier write may have landed on
      // another instance whose runtime this one never saw).
      const merged = mergeSessionIntentObjectives(activeSessionObjectivesOf(runtime), carried);
      return await viewWithCookie(host, carried, sessionIntentCookieFor(merged));
    }
    if (kind === "clear-intent") {
      // The honest clear path: the runtime's own end-session law (session
      // + momentary intents are cleared; durable scopes are untouched)
      // + the carrier cookie emptied with it (one truth, both stores).
      runtime.intents.endSession();
      return await viewWithCookie(host, [], clearedSessionIntentCookie());
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
      return NextResponse.json(await loadPersonalizeView(host, carried));
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
    return NextResponse.json(await loadPersonalizeView(host, carried));
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
