/**
 * @wfx/app-web — the transform API route (R21-E).
 *
 * The bridge the AI action tray calls — the RUNTIME's model-controls
 * seam (R21-C over the R06 ServerPort extension) is the one owner; this
 * route is its typed transport. Both web transports implement the
 * transform ops (the fixtures persona's deterministic operations; the
 * service port's `/experience/transforms` mapping) — a failure answers
 * the typed error, never a fake success.
 *
 * - `POST /api/transform` `{ kind, target: { connectorId, externalRef,
 *   title, durationMs? }, input }` → submit one explicit operation; the
 *   answer is the typed operation (queued — explicit states only, never
 *   fabricated progress). The tray's per-kind input truth is enforced
 *   here: kinds whose input the title cannot satisfy answer the typed
 *   400 naming the precondition (the honest "discoverable + explained"
 *   state — never a button that lies).
 * - `POST /api/transform` `{ kind: "cancel", operationId }` → cancel a
 *   queued/running operation (the recovery path).
 * - `POST /api/transform` `{ kind: "clear-result", operationId }` →
 *   DELETE a succeeded operation's result (the recovery path).
 * - `GET /api/transform?operationId=…` → one operation's current typed
 *   state (the tray's read).
 */

import { NextResponse } from "next/server";

import { getWebRuntimeHostForRequest } from "@/host/web-host";
import { sessionTokenFromRequest } from "@/host/session-cookie";

export const dynamic = "force-dynamic";

/** The closed submit vocabulary (the fabric's task kinds the tray offers). */
const SUBMIT_KINDS = new Set(["transcript", "translation", "subtitle", "dubbing", "commentary"]);

/** The closed recovery vocabulary. */
const CONTROL_KINDS = new Set(["cancel", "clear-result"]);

export async function GET(request: Request): Promise<NextResponse> {
  const operationId = new URL(request.url).searchParams.get("operationId");
  if (operationId === null || operationId.length === 0) {
    return NextResponse.json({ error: "operationId: expected the operation to read" }, { status: 400 });
  }
  const host = await getWebRuntimeHostForRequest(sessionTokenFromRequest(request) ?? undefined);
  const result = await host.runtime.modelControls.readTransform(operationId);
  if (!result.ok) {
    return NextResponse.json({ error: result.failure.detail }, { status: 404 });
  }
  return NextResponse.json(result.value);
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

  if (kind !== undefined && CONTROL_KINDS.has(kind)) {
    const operationId = typeof record.operationId === "string" ? record.operationId : "";
    if (operationId.length === 0) {
      return NextResponse.json(
        { error: "operationId: expected the operation to recover" },
        { status: 400 },
      );
    }
    const host = await getWebRuntimeHostForRequest(sessionTokenFromRequest(request) ?? undefined);
    const result =
      kind === "cancel"
        ? await host.runtime.modelControls.cancelTransform(operationId)
        : await host.runtime.modelControls.clearTransformResult(operationId);
    if (!result.ok) {
      // A recovery on a terminal/unknown operation answers the typed
      // failure verbatim (never a fabricated cancelled/cleared state).
      return NextResponse.json({ error: result.failure.detail }, { status: 409 });
    }
    return NextResponse.json(result.value);
  }

  if (kind === undefined || !SUBMIT_KINDS.has(kind)) {
    return NextResponse.json(
      { error: `kind: expected one of ${[...SUBMIT_KINDS].join(" | ")} (or cancel | clear-result)` },
      { status: 400 },
    );
  }

  // The target identity the operation runs against (the tray carries it).
  const target =
    typeof record.target === "object" && record.target !== null
      ? (record.target as Record<string, unknown>)
      : {};
  const externalRef = typeof target.externalRef === "string" ? target.externalRef.trim() : "";
  const title = typeof target.title === "string" ? target.title.trim() : "";
  const durationMs = typeof target.durationMs === "number" ? target.durationMs : undefined;
  if (externalRef.length === 0 || title.length === 0) {
    return NextResponse.json(
      { error: "target: expected the title's externalRef and title" },
      { status: 400 },
    );
  }

  // The per-kind input truth (the fabric's own validators' requirements —
  // the honest precondition named BEFORE submission, at the seam the
  // service would enforce it):
  // - transcript/commentary need a positive durationMs;
  // - subtitle/dubbing compose from transcript SEGMENTS (the tray does
  //   not have them without a succeeded transcript — the precondition).
  if (kind === "transcript" || kind === "commentary") {
    if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) {
      return NextResponse.json(
        { error: "durationMs: this action needs the title's duration — the source did not declare one" },
        { status: 400 },
      );
    }
  }
  if (kind === "subtitle" || kind === "dubbing") {
    return NextResponse.json(
      {
        error:
          "input: subtitles and dubbing compose from a transcript — transcribe this title first, then run this action from its result",
      },
      { status: 400 },
    );
  }

  const input =
    typeof record.input === "object" && record.input !== null
      ? (record.input as Record<string, unknown>)
      : {};
  // The per-kind input composition over the title's real data.
  let commandInput: Record<string, unknown>;
  if (kind === "transcript") {
    commandInput = { mediaRef: externalRef, durationMs };
  } else if (kind === "commentary") {
    const style = typeof input.style === "string" ? input.style : "insightful";
    commandInput = { mediaRef: externalRef, durationMs, style };
  } else {
    // translation: the title's text (the honest translate-what-you-have).
    const text = typeof input.text === "string" && input.text.trim().length > 0 ? input.text.trim() : title;
    const targetLanguage =
      typeof input.targetLanguage === "string" && input.targetLanguage.trim().length > 0
        ? input.targetLanguage.trim()
        : "";
    if (targetLanguage.length === 0) {
      return NextResponse.json(
        { error: "targetLanguage: expected the language to translate into (e.g. en, es, fr)" },
        { status: 400 },
      );
    }
    commandInput = { text, targetLanguage };
  }

  const host = await getWebRuntimeHostForRequest(sessionTokenFromRequest(request) ?? undefined);
  const result = await host.runtime.modelControls.submitTransform({
    kind,
    input: commandInput,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.failure.detail }, { status: 502 });
  }
  return NextResponse.json(result.value);
}
