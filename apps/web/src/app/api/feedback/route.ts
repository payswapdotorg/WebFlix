/**
 * @wfx/app-web — the feedback API route (R21-E).
 *
 * The bridge the item/player FEEDBACK CONTROLS call — the J15 control
 * set (`more-like-this` | `not-interested` | `dont-recommend-source` |
 * `dont-recommend-creator` | `already-watched`) as typed, reversible
 * records. The OWNER is the API service's R05 policy surface
 * (`/experience/feedback`); this route is the web adapter's typed
 * transport to it:
 *
 * - **service mode** → the REAL proxy: `POST/GET/DELETE` against
 *   `{base}/experience/feedback` with the session's bearer channel (the
 *   same `Authorization` law the ServerPort stamps — identity never in
 *   URLs) — a typed service failure answers the typed error status,
 *   never a fake success;
 * - **fixtures mode** → the deterministic feedback persona
 *   (`host/feedback-fixtures.ts`) — real records, real undo, the same
 *   closed vocabulary (the SAME law the model-controls persona kept:
 *   the fixtures boot renders real controls, never fake dead buttons).
 *
 * - `GET /api/feedback?target=<canonical item id>` → the recorded
 *   controls for one target (the reversibility read — you cannot undo
 *   what you cannot see).
 * - `POST /api/feedback` `{ kind, target, note? }` → record one control
 *   (idempotent per (profile, kind, target) — the service's own law).
 * - `DELETE /api/feedback?id=<record id>` → undo one control (a REAL
 *   delete — the record and its composition effect vanish together).
 */

import { NextResponse } from "next/server";

import { getWebRuntimeHostForRequest } from "@/host/web-host";
import { sessionTokenFromRequest } from "@/host/session-cookie";
import {
  fixtureFeedbackProblems,
  listFixtureFeedback,
  submitFixtureFeedback,
  undoFixtureFeedback,
} from "@/host/feedback-fixtures";

export const dynamic = "force-dynamic";

/** The service-mode proxy's typed failure mapping (deterministic). */
function serviceErrorStatus(status: number): number {
  if (status === 400) return 400;
  if (status === 401 || status === 404) return status;
  return 502; // the service answered but cannot serve right now
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const target = url.searchParams.get("target");
  const host = await getWebRuntimeHostForRequest(sessionTokenFromRequest(request) ?? undefined);

  if (host.config.mode === "fixtures") {
    return NextResponse.json({ controls: listFixtureFeedback(target ?? undefined) });
  }

  // Service mode: the REAL read (the profile's controls, oldest first).
  const query = target !== null ? `?target=${encodeURIComponent(target)}` : "";
  const response = await serviceFetch(request, "GET", `/experience/feedback${query}`);
  if (response === null) {
    return NextResponse.json(
      { error: "the feedback controls could not be read right now — retry in a moment" },
      { status: 502 },
    );
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return NextResponse.json(
      { error: detail.length > 0 ? detail : "the feedback read failed" },
      { status: serviceErrorStatus(response.status) },
    );
  }
  const body = (await response.json().catch(() => null)) as unknown[] | null;
  if (body === null || !Array.isArray(body)) {
    return NextResponse.json(
      { error: "the feedback read answered a shape this surface cannot use" },
      { status: 502 },
    );
  }
  // The target filter rides the client query (the service lists the
  // profile's whole set; the surface asked for one target's truth).
  const controls = target !== null ? body.filter(isControlFor(target)) : body;
  return NextResponse.json({ controls });
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
  const target = typeof record.target === "string" ? record.target : undefined;
  const note = record.note;
  const problems = fixtureFeedbackProblems({ kind, target, note });
  if (problems.length > 0) {
    return NextResponse.json({ error: problems.join("; ") }, { status: 400 });
  }

  const host = await getWebRuntimeHostForRequest(sessionTokenFromRequest(request) ?? undefined);
  if (host.config.mode === "fixtures") {
    const control = submitFixtureFeedback({
      kind: kind as string,
      target: target as string,
      ...(typeof note === "string" ? { note } : {}),
    });
    return NextResponse.json(control, { status: 201 });
  }

  // Service mode: the REAL write (idempotent per (profile, kind, target)).
  const response = await serviceFetch(request, "POST", "/experience/feedback", JSON.stringify({
    kind,
    target,
    ...(typeof note === "string" ? { note } : {}),
  }));
  if (response === null) {
    return NextResponse.json(
      { error: "the feedback control could not be saved right now — retry in a moment" },
      { status: 502 },
    );
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return NextResponse.json(
      { error: detail.length > 0 ? detail : "the feedback write failed" },
      { status: serviceErrorStatus(response.status) },
    );
  }
  const control = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (control === null) {
    return NextResponse.json(
      { error: "the feedback write answered a shape this surface cannot use" },
      { status: 502 },
    );
  }
  return NextResponse.json(control, { status: 201 });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const id = new URL(request.url).searchParams.get("id");
  if (id === null || id.length === 0) {
    return NextResponse.json({ error: "id: expected the feedback control to undo" }, { status: 400 });
  }

  const host = await getWebRuntimeHostForRequest(sessionTokenFromRequest(request) ?? undefined);
  if (host.config.mode === "fixtures") {
    const undone = undoFixtureFeedback(id);
    if (undone === null) {
      return NextResponse.json(
        { error: `feedback control '${id}' is not recorded (nothing to undo)` },
        { status: 404 },
      );
    }
    return NextResponse.json({ undone: true, control: undone });
  }

  // Service mode: the REAL undo (a real delete — the composition effect
  // vanishes with the record).
  const response = await serviceFetch(
    request,
    "DELETE",
    `/experience/feedback/${encodeURIComponent(id)}`,
  );
  if (response === null) {
    return NextResponse.json(
      { error: "the undo could not reach the service right now — retry in a moment" },
      { status: 502 },
    );
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return NextResponse.json(
      { error: detail.length > 0 ? detail : "the undo failed" },
      { status: serviceErrorStatus(response.status) },
    );
  }
  return NextResponse.json({ undone: true });
}

/** The one service call (the connector-context + bearer header law). */
async function serviceFetch(
  request: Request,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: string,
): Promise<Response | null> {
  const host = await getWebRuntimeHostForRequest(sessionTokenFromRequest(request) ?? undefined);
  if (host.config.mode !== "service") {
    // The fixtures branch handles its own persona; this helper is the
    // service transport only (never reached in fixtures mode).
    return null;
  }
  const base = (host.config as { readonly apiBase: URL }).apiBase;
  const url = new URL(`${base.pathname === "/" ? "" : base.pathname}${path}`, base);
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  const token = sessionTokenFromRequest(request);
  if (token !== null) headers.authorization = `Bearer ${token}`;
  try {
    return await fetch(url.toString(), {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
    });
  } catch {
    return null; // the typed transport failure (offline/DNS/timeout)
  }
}

/** The target filter over the service's control records. */
function isControlFor(target: string): (control: unknown) => boolean {
  return (control) => {
    if (typeof control !== "object" || control === null) return false;
    return (control as { target?: unknown }).target === target;
  };
}
