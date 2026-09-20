/**
 * @wfx/app-web — `POST /api/model/byom/unbind` (R22-F): the BYOM unbind route.
 *
 * THE LAW THIS ROUTE KEEPS (docs/plans/
 * 2026-09-20-webflix-major-journey-hardening-plan.md — F8): the BYOM
 * management journey's REMOVE step. The runtime operation already
 * exists (the R21-C model-controls store's `unbindByomProvider` over the
 * Experience API's `DELETE /experience/model-providers/byom/:providerId`);
 * this route is the Web adapter's typed transport bridge — Worker 1's
 * R22-C recovery vocabulary (the closed `byomManagementRecovery` mapping
 * — never a dead end).
 *
 * HONESTY LAWS (mirrored from the bind route):
 * - the per-identity host map binds the account's runtime — an
 *   anonymous session answers `unauthorized` with the "sign in again"
 *   recovery;
 * - the typed failure channel maps through `byomManagementRecovery`
 *   to the closed recovery vocabulary (fix-and-retry / retry /
 *   sign-in-again / refresh-list);
 * - the unbind NEVER fabricates success: a transport failure answers
 *   the typed detail verbatim; the provider stays bound until the
 *   service confirms the removal (the runtime's `refreshProviders`
 *   read observes the truth).
 */

import { byomManagementRecovery } from "@wfx/client-runtime";

import { getWebRuntimeHostForRequest } from "@/host/web-host";
import { sessionTokenFromRequest } from "@/host/session-cookie";

export const dynamic = "force-dynamic";

interface UnbindBody {
  readonly providerId?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "body: expected JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "body: expected a JSON object" }, { status: 400 });
  }
  const record = body as UnbindBody;
  if (typeof record.providerId !== "string" || record.providerId.trim().length === 0) {
    return Response.json(
      {
        error: "invalid-input",
        detail: "providerId: expected a non-empty string",
        recovery: byomManagementRecovery("unbind", {
          kind: "invalid-input",
          detail: "providerId: expected a non-empty string",
        }),
      },
      { status: 400 },
    );
  }

  const host = await getWebRuntimeHostForRequest(sessionTokenFromRequest(request) ?? undefined);
  if (!host.session.state.signedIn) {
    return Response.json(
      {
        error: "unauthorized",
        detail: "model providers belong to your account — sign in again and retry.",
        recovery: byomManagementRecovery("unbind", { kind: "unauthorized", detail: "sign in again" }),
      },
      { status: 401 },
    );
  }

  const result = await host.runtime.modelControls.unbindByomProvider(record.providerId);
  if (!result.ok) {
    const status =
      result.failure.kind === "unauthorized" ? 401 :
      result.failure.kind === "network" ? 502 :
      result.failure.kind === "unavailable" ? 503 :
      400;
    return Response.json(
      {
        error: result.failure.kind,
        detail: result.failure.detail,
        recovery: byomManagementRecovery("unbind", result.failure),
      },
      { status },
    );
  }

  // The honest empty answer (the secret-free void — never a fabricated
  // "removed" payload). The provider stays in the registry until the
  // next refresh observes the truth (the runtime's read model).
  return Response.json({ ok: true }, { status: 200 });
}
