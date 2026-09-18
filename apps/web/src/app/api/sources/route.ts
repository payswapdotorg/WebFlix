/**
 * @wfx/app-web — the sources API route (R17).
 *
 * `GET /api/sources` → the runtime's CURRENT sources model (the honest
 * `readSources` fold — in service mode the transport honestly does not
 * implement the read yet, and the model says so; never a fabricated list).
 *
 * `POST /api/sources` `{ connectorId, action }` — the typed source-auth
 * actions of the fixtures-mode scripted lifecycle (J28's browser-validation
 * drive):
 * - fixtures mode (`WFX_DEV_FIXTURES=1`, the loud dev badge): the
 *   deterministic scripted drive (`expire` [dev-labeled], `reauthorize`,
 *   `connect`, `disconnect`) — connect/reauthorize/disconnect round trips
 *   through the REAL runtime source-state machinery;
 * - service mode: the honest typed answer — the source-management flows
 *   run against the configured service (R03's lane); the web transport
 *   serves reads only here (never a fake success, never a silent no-op).
 *
 * Deterministic: reads never advance the script; only the typed POST moves
 * it (the acquisition-drive law).
 */

import { getWebRuntimeHost } from "@/host/web-host";
import { driveSourceAuthFixture } from "@/host/source-auth-fixtures";

/** The closed action vocabulary the POST accepts. */
const ACTIONS = new Set(["expire", "reauthorize", "connect", "disconnect"]);

export async function GET(): Promise<Response> {
  const host = await getWebRuntimeHost();
  const model = await host.runtime.sources.refresh();
  return Response.json({ mode: host.mode, status: model.status, sources: model.sources });
}

export async function POST(request: Request): Promise<Response> {
  const host = await getWebRuntimeHost();
  const body: unknown = await request.json().catch(() => null);
  const connectorId =
    typeof body === "object" && body !== null
      ? (body as { connectorId?: unknown }).connectorId
      : undefined;
  const action =
    typeof body === "object" && body !== null
      ? (body as { action?: unknown }).action
      : undefined;
  if (
    typeof connectorId !== "string" ||
    connectorId.length === 0 ||
    typeof action !== "string" ||
    !ACTIONS.has(action)
  ) {
    return Response.json(
      { error: `expected { connectorId: string, action: one of ${[...ACTIONS].join(" | ")} }` },
      { status: 400 },
    );
  }

  // The service-mode capability truth: the web transport serves reads.
  if (host.mode !== "fixtures") {
    return Response.json(
      {
        error:
          "source connect/reauthorize/disconnect run against the configured WebFlix service (R03's source-management lane) — this web transport serves reads only",
      },
      { status: 503 },
    );
  }

  const outcome = driveSourceAuthFixture({ action });
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: outcome.status });
  }
  // The honest next view: observe the post-flow state through the REAL
  // runtime source-state machinery (the adapter-owned flow's report path).
  host.runtime.sources.observe(outcome.source);
  return Response.json({ source: outcome.source });
}
