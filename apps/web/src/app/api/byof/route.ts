/**
 * @wfx/app-web — the BYOF API route (R20-D + R20-H).
 *
 * `GET /api/byof` → the current BYOF panel state (the importable sources
 * with their authorization truth, the import trail, the staged preview):
 * the honest view loaders' answer for this boot mode — in service mode
 * the panel composed over the Experience API's feed-import routes (the
 * R20-H seam swap), in fixtures mode the fixtures runtime's own panel.
 *
 * `POST /api/byof` `{ action, connectorId?, importId? }` — the typed
 * actions of the Bring Your Own Feed flow (the same law the R17 sources
 * route follows). ONE client surface, TWO transports: both boot modes
 * answer the IDENTICAL body shapes (the fixtures runtime and the service
 * transport implement the same operation surface) — the client
 * components are untouched:
 * - `preview`           — capture + stage the preview (the connect/import step);
 * - `confirm`           — promote the staged preview the user saw;
 * - `sync`              — incrementally synchronize one confirmed import;
 * - `disconnect`        — NON-destructive disconnect (records retained);
 * - `delete-records`    — the EXPLICIT destructive deletion (separate action,
 *                         armed behind the client's two-step confirmation);
 * - `discard-preview`   — discard a staged preview (presentation lifecycle).
 *
 * Fixtures-mode-only dev drives (the scripted source lifecycle the J33
 * journey and the dev badge consume — the R17/R14 drive precedent,
 * clearly dev-labeled): `dev-reset`, `connect` (the fixture OAuth
 * stand-in), `expire-auth`, `advance-source`. In service mode they answer
 * the typed 400 — the dev drives are the fixtures harness's own controls,
 * never a service capability.
 *
 * Determinism: reads never advance the scripted source; only the typed
 * POST actions (and the dev drives) move it.
 */

import { getWebRuntimeHost } from "@/host/web-host";
import { byofServiceTransportFor, getByofFixturesRuntime } from "@/host/byof/byof-host";
import type { ByofFailure, ByofFailureKind } from "@/host/byof/byof-view";

/** The closed action vocabulary the POST accepts. */
const ACTIONS = new Set([
  "preview",
  "confirm",
  "sync",
  "disconnect",
  "delete-records",
  "discard-preview",
  // The fixtures-mode-only dev drives (the scripted source lifecycle).
  "dev-reset",
  "connect",
  "expire-auth",
  "advance-source",
]);

/** The dev drives (fixtures-mode-only — the clearly-labeled harness). */
const DEV_DRIVES = new Set(["dev-reset", "connect", "expire-auth", "advance-source"]);

/** The HTTP status of one typed failure kind (deterministic mapping). */
function statusForFailure(kind: ByofFailureKind): number {
  switch (kind) {
    case "invalid-input":
      return 400;
    case "unauthorized":
      return 401;
    case "not-found":
      return 404;
    case "unsupported":
      return 409;
    case "transport":
    case "provider":
      return 502;
    case "unavailable":
      return 503;
  }
}

/** The failure response body + status (the typed channel — never a fake success). */
function failureResponse(failure: ByofFailure): Response {
  return Response.json({ ok: false, failure }, { status: statusForFailure(failure.kind) });
}

export async function GET(): Promise<Response> {
  const host = await getWebRuntimeHost();
  if (host.mode !== "fixtures") {
    // Service mode: the panel composed over the service's feed-import
    // routes (the R20-H seam swap — one honest transport, never a
    // fabricated source or import; a transport failure is the typed
    // unavailable state).
    const transport = byofServiceTransportFor(host);
    const view = await transport.panelView();
    return Response.json({ mode: host.mode, ...view });
  }
  const runtime = await getByofFixturesRuntime();
  const view = await runtime.panelView();
  return Response.json({ mode: host.mode, ...view });
}

export async function POST(request: Request): Promise<Response> {
  const host = await getWebRuntimeHost();
  const body: unknown = await request.json().catch(() => null);
  const action =
    typeof body === "object" && body !== null ? (body as { action?: unknown }).action : undefined;
  const connectorId =
    typeof body === "object" && body !== null ? (body as { connectorId?: unknown }).connectorId : undefined;
  const importId =
    typeof body === "object" && body !== null ? (body as { importId?: unknown }).importId : undefined;
  if (typeof action !== "string" || !ACTIONS.has(action)) {
    return Response.json(
      {
        ok: false,
        failure: {
          kind: "invalid-input",
          detail: `expected { action: one of ${[...ACTIONS].join(" | ")}, connectorId?, importId? }`,
        },
      },
      { status: 400 },
    );
  }

  // The transport binding for this boot mode (the fixtures runtime or the
  // service transport — the SAME operation surface, so the action mapping
  // below is mode-blind: one client surface, two transports).
  const runtime = host.mode === "fixtures" ? await getByofFixturesRuntime() : byofServiceTransportFor(host);

  if (DEV_DRIVES.has(action)) {
    // The dev drives are the fixtures harness's own controls — a service
    // boot honestly refuses them (never a fake script step).
    if (host.mode !== "fixtures") {
      return failureResponse({
        kind: "invalid-input",
        detail: `'${action}' is a fixtures-mode dev drive — the scripted source lifecycle does not exist in a service boot`,
      });
    }
    const fixtures = runtime as Awaited<ReturnType<typeof getByofFixturesRuntime>>;
    const result = await fixtures.drive(
      action as "dev-reset" | "connect" | "expire-auth" | "advance-source",
    );
    if (!result.ok) return failureResponse(result.failure);
    return Response.json({ ok: true, action: result.value.action });
  }

  switch (action) {
    case "preview": {
      if (typeof connectorId !== "string" || connectorId.length === 0) {
        return failureResponse({
          kind: "invalid-input",
          detail: "preview: expected a non-empty connectorId (the source to import from)",
        });
      }
      const result = await runtime.startPreview({ connectorId });
      if (!result.ok) return failureResponse(result.failure);
      return Response.json({ ok: true, ...result.value });
    }
    case "confirm": {
      if (typeof importId !== "string" || importId.length === 0) {
        return failureResponse({
          kind: "invalid-input",
          detail: "confirm: expected a non-empty importId (the staged preview to promote)",
        });
      }
      const result = await runtime.confirm(importId);
      if (!result.ok) return failureResponse(result.failure);
      return Response.json({ ok: true, ...result.value });
    }
    case "sync": {
      if (typeof importId !== "string" || importId.length === 0) {
        return failureResponse({
          kind: "invalid-input",
          detail: "sync: expected a non-empty importId (the confirmed import to synchronize)",
        });
      }
      const result = await runtime.sync(importId);
      if (!result.ok) return failureResponse(result.failure);
      return Response.json({ ok: true, report: result.value });
    }
    case "disconnect": {
      if (typeof importId !== "string" || importId.length === 0) {
        return failureResponse({
          kind: "invalid-input",
          detail: "disconnect: expected a non-empty importId (the import to disconnect)",
        });
      }
      const result = await runtime.disconnect(importId);
      if (!result.ok) return failureResponse(result.failure);
      return Response.json({ ok: true, ...result.value });
    }
    case "delete-records": {
      if (typeof importId !== "string" || importId.length === 0) {
        return failureResponse({
          kind: "invalid-input",
          detail: "delete-records: expected a non-empty importId (the import whose records are deleted)",
        });
      }
      const result = await runtime.deleteRecords(importId);
      if (!result.ok) return failureResponse(result.failure);
      return Response.json({ ok: true, ...result.value });
    }
    case "discard-preview": {
      if (typeof importId !== "string" || importId.length === 0) {
        return failureResponse({
          kind: "invalid-input",
          detail: "discard-preview: expected a non-empty importId (the staged preview to discard)",
        });
      }
      const result = await runtime.discardPreview(importId);
      if (!result.ok) return failureResponse(result.failure);
      return Response.json({ ok: true, ...result.value });
    }
    default:
      return failureResponse({
        kind: "invalid-input",
        detail: `unknown action '${String(action)}'`,
      });
  }
}
