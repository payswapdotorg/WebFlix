/**
 * @wfx/app-web — the action route (R07): POST /api/actions.
 *
 * The bridge the client like/save controls call: the typed body → the
 * RUNTIME's action engine (`runtime.dispatchAction`) — platform capability
 * gating BEFORE dispatch, the server receipt mapped 1:1, and the settled
 * ACTION STATE as the truth. The response body carries the settled status
 * in the receipt vocabulary the client renders (confirmed / local-only /
 * unsupported / failed) — never a fabricated success: an `unsupported` or
 * `failed` action renders exactly that.
 *
 * Caller misuse (malformed body) answers 400 with the problem text; a
 * transport failure settles the action `failed` and is answered 200 with
 * the failed status (the action WAS dispatched and DID settle — the
 * client renders the honest failure) — the runtime's law 3.
 */

import { NextResponse } from "next/server";

import { isRuntimeError } from "@wfx/client-runtime";

import { getWebRuntimeHost } from "@/host/web-host";

export const dynamic = "force-dynamic";

/** The action input the client controls send (mirrors ActionButtons). */
interface ActionRequestBody {
  readonly type: "like" | "save";
  readonly connectorId: string;
  readonly externalRef: string;
  readonly itemId: string;
}

/** Map the runtime's settled action status to the receipt vocabulary. */
function receiptStatusOf(status: string): "confirmed" | "local-only" | "unsupported" | "failed" {
  switch (status) {
    case "confirmed-by-provider":
      return "confirmed";
    case "confirmed-locally":
      return "local-only";
    case "unsupported":
      return "unsupported";
    default:
      return "failed";
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body: expected JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "body: expected a JSON object" }, { status: 400 });
  }
  const action = body as Partial<ActionRequestBody>;
  if (action.type !== "like" && action.type !== "save") {
    return NextResponse.json({ error: "type: expected 'like' or 'save'" }, { status: 400 });
  }
  if (typeof action.connectorId !== "string" || action.connectorId.length === 0) {
    return NextResponse.json({ error: "connectorId: expected a non-empty string" }, { status: 400 });
  }
  if (typeof action.externalRef !== "string" || action.externalRef.length === 0) {
    return NextResponse.json({ error: "externalRef: expected a non-empty string" }, { status: 400 });
  }

  const host = await getWebRuntimeHost();
  try {
    const state = await host.runtime.dispatchAction({
      type: action.type,
      connectorId: action.connectorId,
      externalRef: action.externalRef,
    });
    if (action.type === "save" && typeof action.itemId === "string" && action.itemId.length > 0) {
      // The save control is ALSO the watchlist write (the R01 library
      // semantics: canonical-keyed, local-first, typed sync states) — the
      // same composition the frozen use-case performed. The watchlist
      // entry settles independently of the action receipt (both truths
      // render: the button shows the receipt, the Library shows the sync).
      await host.runtime.libraryOps.save({ itemId: action.itemId });
    }
    // The settled state, mapped to the receipt vocabulary — verbatim truth.
    return NextResponse.json(
      {
        status: receiptStatusOf(state.status),
        ...(state.detail !== undefined ? { detail: state.detail } : {}),
        occurredAt: state.settledAt ?? state.requestedAt,
      },
      { status: 200 },
    );
  } catch (thrown) {
    if (isRuntimeError(thrown)) {
      return NextResponse.json({ error: thrown.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: `the action dispatch failed unexpectedly: ${String(thrown)}` },
      { status: 502 },
    );
  }
}
