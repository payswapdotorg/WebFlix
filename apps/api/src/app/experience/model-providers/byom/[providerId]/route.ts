/**
 * @wfx/app-api — `PUT`/`DELETE /experience/model-providers/byom/:providerId`
 * (R06 transport contract).
 *
 * The BYOM provider binding lifecycle:
 *
 * - `PUT` — store a binding: `{ endpointUrl, key, metadata?, capabilities?,
 *   costPerCall? }`. The key is SEALED via the envelope-encrypted
 *   account-store pattern (the 0005 connector-accounts discipline verbatim
 *   — plaintext NEVER at rest). The response answers a HANDLE + metadata
 *   ONLY (the response NEVER contains key material — the R06 privacy law).
 *   A re-PUT (same providerId) REPLACES the key (rotation) and keeps the
 *   canonical binding id + created_at stable (the rotation law, verbatim
 *   from connector-accounts).
 * - `DELETE` — remove the binding (the vault's delete discipline — the
 *   sealed material is destroyed). Returns 204 on success, 404 when the
 *   binding does not exist (the honest miss).
 *
 * Degradation law: a LOUD boot failure answers the typed 500; the
 * degradation family (DB down) answers the typed 502.
 */

import { isRecord, previewValue } from "@wfx/domain";

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
import {
  byomBindingCommandProblems,
  type ByomBindingCommandWire,
} from "@api/host/model-controls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function validateProviderId(id: string): boolean {
  return (
    typeof id === "string" &&
    id.trim().length > 0 &&
    id.length <= 128 &&
    !/[\u0000-\u001F\u007F]/.test(id)
  );
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ providerId: string }> },
): Promise<Response> {
  const { providerId } = await context.params;
  if (!validateProviderId(providerId)) {
    return badRequest(
      `providerId: expected 1..128 characters without control characters, got ${previewValue(providerId)}`,
    );
  }

  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  const body = await readJsonBody(request);
  if (!body.ok) return badRequest(body.detail);
  if (!isRecord(body.value)) {
    return badRequest("body: expected a ByomBindingCommandWire object");
  }
  const command = body.value as unknown as ByomBindingCommandWire;
  const problems = [...byomBindingCommandProblems(command)];
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
      const record = await boot.modelControls.bindByomProvider(
        resolved.identity.ctx.userId,
        resolved.identity.profileId,
        providerId,
        command,
      );
      // THE PRIVACY LAW: the response carries the HANDLE + metadata ONLY.
      // The binding record is structurally secret-free (no `key`, `ciphertext`,
      // `iv`, `authTag` field on the response). Verified by tests.
      return Response.json(record);
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const record = await boot.modelControls.bindByomProvider(
      anonymous.ctx.userId,
      profileKey,
      providerId,
      command,
    );
    return Response.json(record);
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
  if (!validateProviderId(providerId)) {
    return badRequest(
      `providerId: expected 1..128 characters without control characters, got ${previewValue(providerId)}`,
    );
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
    logDegradation("byom-bind.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    let removed: boolean;
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
      removed = await boot.modelControls.unbindByomProvider(
        resolved.identity.ctx.userId,
        resolved.identity.profileId,
        providerId,
      );
    } else {
      if (anonymous === null || !anonymous.ok) {
        return badRequest("x-wfx-user-id: required identity header is absent");
      }
      const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
      removed = await boot.modelControls.unbindByomProvider(
        anonymous.ctx.userId,
        profileKey,
        providerId,
      );
    }
    if (!removed) {
      return Response.json(
        { error: "not-found", detail: `no BYOM binding for provider '${providerId}'` },
        { status: 404 },
      );
    }
    return new Response(null, { status: 204 });
  } catch (thrown) {
    logDegradation("byom-bind.delete", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
