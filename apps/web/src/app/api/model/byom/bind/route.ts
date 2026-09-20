/**
 * @wfx/app-web — `POST /api/model/byom/bind` (R22-F): the BYOM bind route.
 *
 * THE LAW THIS ROUTE KEEPS (docs/plans/
 * 2026-09-20-webflix-major-journey-hardening-plan.md — F8): "BYOM is
 * complete only when a user can DISCOVER, CONFIGURE, VERIFY, and REMOVE
 * a provider through normal product surfaces, with secrets kept
 * server-side." The runtime operations already exist (the R21-C
 * model-controls store's `bindByomProvider` over the Experience API's
 * `PUT /experience/model-providers/byom/:providerId`); this route is
 * the Web adapter's typed transport bridge — Worker 1's R22-C
 * `ByomBindCommand` validation (the SAME rules the service enforces)
 * + the typed failure mapping (the closed recovery vocabulary, never a
 * dead end).
 *
 * HONESTY LAWS:
 * - the provider key is the SECRET on its way IN: it rides the request
 *   body ONCE, the transport seals it server-side, and the answer is
 *   the SECRET-FREE handle ONLY (the `ByomBindingHandle` — no key, no
 *   key material, never logged, never rendered);
 * - the shared R22-C `byomBindCommandProblems` runs BEFORE the runtime
 *   call (the SAME honest per-field problems the service enforces — the
 *   convergence law: Web/Desktop render identical failures);
 * - the typed failure channel (the `ServerFailure` kinds + the
 *   client-side `invalid-input`) maps through `byomManagementRecovery`
 *   to the closed recovery vocabulary (fix-and-retry / retry /
 *   sign-in-again / refresh-list — never a dead end);
 * - the per-identity host map (the request-scoped host) binds the
 *   account's runtime — a stale cookie degrades honestly to the
 *   anonymous singleton (the bind then answers `unauthorized` — the
 *   "sign in again" recovery).
 *
 * The route is the management path (Settings → Model & AI). The
 * contextual AI tray remains the place to USE AI; Settings remains the
 * place to MANAGE model providers/policies (the F8 separation).
 */

import { byomBindCommandProblems, byomManagementRecovery } from "@wfx/client-runtime";
import type { ByomBindingCommand } from "@wfx/client-runtime";
import type { ModelTask } from "@wfx/domain";
import { isByomModelTask } from "@wfx/client-runtime";

import { getWebRuntimeHostForRequest } from "@/host/web-host";
import { sessionTokenFromRequest } from "@/host/session-cookie";

export const dynamic = "force-dynamic";

interface BindBody {
  readonly providerId?: unknown;
  readonly endpointUrl?: unknown;
  readonly key?: unknown;
  readonly capabilities?: unknown;
  readonly costPerCall?: unknown;
  readonly metadata?: unknown;
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
  const record = body as BindBody;
  // The capabilities (when provided) must be the frozen ModelTask set
  // (the R22-C guard). Unknown values are filtered before reaching the
  // runtime — the same law the byomBindCommandProblems pre-flight enforces.
  const rawCapabilities = Array.isArray(record.capabilities) ? record.capabilities : [];
  const capabilities: readonly ModelTask[] = rawCapabilities.filter(isByomModelTask);
  // The wire shape the runtime expects (the typed ByomBindingCommand).
  const command: ByomBindingCommand = {
    providerId: typeof record.providerId === "string" ? record.providerId : "",
    endpointUrl: typeof record.endpointUrl === "string" ? record.endpointUrl : "",
    key: typeof record.key === "string" ? record.key : "",
    ...(capabilities.length > 0 ? { capabilities } : {}),
    ...(typeof record.costPerCall === "number" ? { costPerCall: record.costPerCall } : {}),
    ...(record.metadata !== undefined && typeof record.metadata === "object" && record.metadata !== null
      ? { metadata: record.metadata as Record<string, unknown> }
      : {}),
  };

  // The shared R22-C pre-flight: the SAME rules the service enforces,
  // collected BEFORE the round trip (the convergence law — Web/Desktop
  // render identical failures).
  const problems = byomBindCommandProblems(command);
  if (problems.length > 0) {
    return Response.json(
      {
        error: "invalid-input",
        detail: problems.map((p) => p.detail).join(" "),
        problems,
        recovery: byomManagementRecovery("bind", {
          kind: "invalid-input",
          detail: problems.map((p) => p.detail).join(" "),
        }),
      },
      { status: 400 },
    );
  }

  const host = await getWebRuntimeHostForRequest(sessionTokenFromRequest(request) ?? undefined);
  // The authenticated check: BYOM bindings belong to the account. An
  // anonymous session answers the typed `unauthorized` failure with the
  // "sign in again" recovery (never a fabricated binding).
  if (!host.session.state.signedIn) {
    return Response.json(
      {
        error: "unauthorized",
        detail: "model providers belong to your account — sign in again and retry.",
        recovery: byomManagementRecovery("bind", { kind: "unauthorized", detail: "sign in again" }),
      },
      { status: 401 },
    );
  }

  const result = await host.runtime.modelControls.bindByomProvider(command);
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
        recovery: byomManagementRecovery("bind", result.failure),
      },
      { status },
    );
  }

  // The SECRET-FREE handle (the transport's answer — never the key, never
  // key material — the R22-C secret law's API-boundary twin).
  return Response.json({ handle: result.value }, { status: 200 });
}
