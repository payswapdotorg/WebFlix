/**
 * @wfx/app-api — `PUT`/`DELETE /experience/model-providers/byom/:providerId`
 * (R06 transport contract).
 *
 * The BYOM bind/unbind surface. The provider id rides the PATH; the body of
 * the PUT is `{ endpoint, tasks, privacy, apiKey }`.
 *
 * - `PUT` — stores the binding: endpoint + key SEALED via the
 *   envelope-encrypted account-store pattern (AES-256-GCM; plaintext NEVER
 *   at rest; one binding per profile+provider — a re-bind REPLACES the
 *   sealed material). THE ANSWER IS A HANDLE + METADATA ONLY: key material
 *   NEVER appears in any response (the doubled privacy law — BYOM keys
 *   never enter logs, URLs, or model prompts; the sealed key is opened only
 *   for the provider transport lane).
 * - `DELETE` — removes the binding: the sealed envelope row is DESTROYED
 *   (the vault's delete discipline — nothing salvageable remains). An
 *   unknown binding answers the honest 404.
 *
 * Validation is TOTAL: the typed 400 names EVERY problem (provider id
 * shape, endpoint URL, tasks vocabulary, privacy class, key presence —
 * never the key VALUE).
 */

import { isRecord } from "@wfx/domain";

import { getApiBoot } from "@api/host/boot";
import {
  badRequest,
  bootFailure,
  isLoudFailure,
  logDegradation,
  readJsonBody,
  unauthorized,
} from "@api/host/http";
import { readBearerToken, readConnectorContext } from "@api/host/identity";
import { resolveScopedIdentity } from "@api/host/session-identity";
import { byomBindingCommandProblems } from "@api/host/model-controls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(
  request: Request,
  context: { params: Promise<{ providerId: string }> },
): Promise<Response> {
  const { providerId } = await context.params;
  if (
    typeof providerId !== "string" ||
    providerId.trim().length === 0 ||
    providerId.length > 128
  ) {
    return badRequest(
      `providerId: expected 1..128 characters in the path, got ${JSON.stringify(providerId)}`,
    );
  }

  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  const body = await readJsonBody(request);
  if (!body.ok) return badRequest(body.detail);
  if (!isRecord(body.value)) {
    return badRequest("body: expected { endpoint, tasks, privacy, apiKey }");
  }
  const command = { ...(body.value as Record<string, unknown>), providerId } as {
    providerId: string;
    endpoint?: unknown;
    tasks?: unknown;
    privacy?: unknown;
    apiKey?: unknown;
  };
  const problems = byomBindingCommandProblems(command as never);
  if (problems.length > 0) {
    return badRequest(problems.join("; "));
  }

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("byom-bind.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("byom-bind.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      // The answer: handle + metadata ONLY — never key material.
      const binding = await boot.modelControls.bindByomProvider(
        resolved.identity.profileId,
        command as never,
      );
      return Response.json(binding);
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const binding = await boot.modelControls.bindByomProvider(profileKey, command as never);
    return Response.json(binding);
  } catch (thrown) {
    logDegradation("byom-bind.put", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ providerId: string }> },
): Promise<Response> {
  const { providerId } = await context.params;
  if (typeof providerId !== "string" || providerId.trim().length === 0) {
    return badRequest("providerId: expected a non-empty provider id in the path");
  }

  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("byom-unbind.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("byom-unbind.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const removed = await boot.modelControls.unbindByomProvider(
        resolved.identity.profileId,
        providerId,
      );
      if (!removed) {
        return Response.json(
          {
            error: "unknown-binding",
            detail: `no BYOM binding for provider '${providerId}' in this profile`,
          },
          { status: 404 },
        );
      }
      return Response.json({ ok: true, providerId });
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const removed = await boot.modelControls.unbindByomProvider(profileKey, providerId);
    if (!removed) {
      return Response.json(
        {
          error: "unknown-binding",
          detail: `no BYOM binding for provider '${providerId}' in this profile`,
        },
        { status: 404 },
      );
    }
    return Response.json({ ok: true, providerId });
  } catch (thrown) {
    logDegradation("byom-unbind.delete", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
