/**
 * @wfx/app-web — the acquisition API route (R14).
 *
 * `GET /api/acquisition` → `{ views: […] }` — the runtime's CURRENT
 * acquisition views (the honest protocol-free fold; an empty list when
 * nothing is known — never fabricated).
 *
 * `POST /api/acquisition` `{ itemId, action }` — the typed acquisition
 * actions of the current view:
 * - fixtures mode (`WFX_DEV_FIXTURES=1`, the loud dev badge): the
 *   deterministic scripted drive (acquire/pause/resume/retry/dismiss +
 *   the clearly-labeled dev `advance` step) through the REAL runtime
 *   store — the browser-validation harness for J21-J26;
 * - service mode: the honest typed answer — native acquisition actions
 *   run in the WebFlix desktop app's platform binding; the web transport
 *   serves READS only (never a fake success, never a silent no-op).
 *
 * Deterministic: the real route handler, the runtime's own store, no
 * network in fixtures mode.
 */

import { getWebRuntimeHost } from "@/host/web-host";
import { driveAcquisitionFixture } from "@/host/acquisition-fixtures";

/** The closed action vocabulary the POST accepts. */
const ACTIONS = new Set([
  "acquire",
  "pause",
  "resume",
  "retry",
  "dismiss",
  "play-offline",
  "reverify-offline",
  "advance",
]);

export async function GET(): Promise<Response> {
  const host = await getWebRuntimeHost();
  return Response.json({ mode: host.mode, views: host.runtime.acquisition.views() });
}

export async function POST(request: Request): Promise<Response> {
  const host = await getWebRuntimeHost();
  const body: unknown = await request.json().catch(() => null);
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { itemId?: unknown }).itemId !== "string" ||
    typeof (body as { action?: unknown }).action !== "string" ||
    !ACTIONS.has((body as { action: string }).action)
  ) {
    return Response.json(
      { error: "expected { itemId: string, action: one of " + [...ACTIONS].join(" | ") + " }" },
      { status: 400 },
    );
  }
  const raw = body as { itemId: string; action: string; ref?: unknown };
  const input: { itemId: string; action: string; ref?: string } = {
    itemId: raw.itemId,
    action: raw.action,
    ...(typeof raw.ref === "string" && raw.ref.length > 0 ? { ref: raw.ref } : {}),
  };

  // The service-mode capability truth: the web transport serves reads.
  if (host.mode !== "fixtures") {
    return Response.json(
      {
        error:
          "native acquisition actions run in the WebFlix desktop app — the web transport serves reads only",
      },
      { status: 503 },
    );
  }

  // The honest typed desktop-only actions the fixture drive cannot serve.
  if (input.action === "play-offline" || input.action === "reverify-offline") {
    return Response.json(
      {
        error:
          "playing and re-checking the offline copy run in the WebFlix desktop app (the native media binding)",
      },
      { status: 503 },
    );
  }

  const outcome = driveAcquisitionFixture(host, input);
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: outcome.status });
  }
  return Response.json({ view: outcome.view });
}
