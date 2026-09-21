/**
 * @wfx/app-web — the library write route (R24-W2): POST /api/library.
 *
 * THE WATCH-LATER ROW'S REAL BACKING: the WebFlix-native watchlist save —
 * the runtime's own LibraryOperations.save({ itemId, listName }) (the
 * canonical-keyed, local-first write with typed sync states), offered
 * on cards, the item hub and the player REGARDLESS of any provider's
 * like/save capability (the audit's finding: the only previous save
 * path rode the provider's own save action — a source without it left
 * NO way to save). The provider's own save action stays a separate
 * truth beside this one (J10's action-sync law is untouched).
 *
 * The playlist write is the same seam with a list name (the runtime's
 * one write path — the Library's playlists section renders the lists).
 *
 * Honesty laws:
 * - the typed result maps 1:1 (a refused write renders its kind +
 *   detail, never a fabricated success);
 * - remove answers the runtime's own typed refusal for an unsaved item;
 * - anonymous sessions save into the session's LOCAL-FIRST canonical
 *   entries (no login wall; the durable cross-device save is the
 *   sign-in upgrade the progress-scope sentence already names).
 */

import { NextResponse } from "next/server";

import { getWebRuntimeHost } from "@/host/web-host";

export const dynamic = "force-dynamic";

/** One library write from the client controls (the typed vocabulary). */
interface LibraryRequestBody {
  readonly op?: "save" | "remove";
  readonly itemId?: string;
  /** The list name (optional; the default watchlist when absent). */
  readonly listName?: string;
}

/** POST /api/library — the WebFlix-native watchlist/playlist write. */
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
  const input = body as Partial<LibraryRequestBody>;
  if (input.op !== "save" && input.op !== "remove") {
    return NextResponse.json({ error: "op: expected 'save' | 'remove'" }, { status: 400 });
  }
  if (typeof input.itemId !== "string" || input.itemId.length === 0) {
    return NextResponse.json({ error: "itemId: expected a non-empty string" }, { status: 400 });
  }
  if (
    input.listName !== undefined &&
    (typeof input.listName !== "string" || input.listName.length === 0)
  ) {
    return NextResponse.json({ error: "listName: expected a non-empty string when provided" }, { status: 400 });
  }

  const host = await getWebRuntimeHost();
  const result =
    input.op === "save"
      ? await host.runtime.libraryOps.save({
          itemId: input.itemId,
          ...(input.listName !== undefined ? { listName: input.listName } : {}),
        })
      : await host.runtime.libraryOps.remove(input.itemId);
  if (result.ok) {
    return NextResponse.json(
      {
        ok: true,
        entry: {
          itemId: result.entry.itemId,
          title: result.entry.title,
          listName: result.entry.listName,
          sync: result.entry.sync,
          savedAt: result.entry.savedAt,
          ...(result.entry.detail !== undefined ? { detail: result.entry.detail } : {}),
        },
      },
      { status: 200 },
    );
  }
  return NextResponse.json({ ok: false, kind: result.kind, detail: result.detail }, { status: 200 });
}
