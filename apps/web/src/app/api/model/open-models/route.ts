/**
 * @wfx/app-web — `POST /api/model/open-models` (R23-J consumption): the
 * open-model registration route (the fixtures persona's typed drive).
 *
 * `{ providerId, action: "register" | "unregister" }` — the R23-J law:
 * a catalog row is NOT a provider until an adapter binds an executor and
 * registers it. In FIXTURES mode the typed drive moves the file-backed
 * registration truth (the same law as the BYOM bind route's persona); in
 * SERVICE mode the honest typed answer is that open-model registration
 * is served by the platform's model runtime (the service lane / the
 * Desktop model runtime) — never a fabricated registration.
 */

import { getWebRuntimeHost } from "@/host/web-host";
import {
  FIXTURE_OPEN_MODEL_IDS,
  registerFixtureOpenModel,
  unregisterFixtureOpenModel,
} from "@/host/model-fixtures";

export const dynamic = "force-dynamic";

const ACTIONS = new Set(["register", "unregister"]);

export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const providerId =
    typeof body === "object" && body !== null
      ? (body as { providerId?: unknown }).providerId
      : undefined;
  const action =
    typeof body === "object" && body !== null
      ? (body as { action?: unknown }).action
      : undefined;
  if (typeof providerId !== "string" || providerId.length === 0) {
    return Response.json({ error: "providerId: expected a non-empty string" }, { status: 400 });
  }
  if (typeof action !== "string" || !ACTIONS.has(action)) {
    return Response.json(
      { error: "action: expected register | unregister" },
      { status: 400 },
    );
  }
  const host = await getWebRuntimeHost();
  if (host.mode !== "fixtures") {
    return Response.json(
      {
        error: "unavailable",
        detail:
          "Open-model registration is served by the platform's model runtime (the service lane / the Desktop model runtime) — the web transport serves the registry reads only.",
      },
      { status: 503 },
    );
  }
  if (!FIXTURE_OPEN_MODEL_IDS.includes(providerId)) {
    return Response.json(
      { error: "invalid-input", detail: `unknown open-model id '${providerId}'` },
      { status: 400 },
    );
  }
  const ok =
    action === "register"
      ? registerFixtureOpenModel(providerId)
      : unregisterFixtureOpenModel(providerId);
  if (!ok) {
    return Response.json({ error: "invalid-input", detail: "the drive refused" }, { status: 400 });
  }
  return Response.json({ ok: true, providerId, action });
}
