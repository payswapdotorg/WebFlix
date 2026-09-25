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
  /**
   * The item's SOURCE identity (the dev-boot bridge's input — see the
   * bridge note below; the client controls already carry it).
   */
  readonly title?: string;
  readonly connectorId?: string;
  readonly externalRef?: string;
}

/**
 * R24-W2 — THE DEV-BOOT BRIDGE (the documented per-route module-graph
 * doctrine — the same law the playback session bridge records): the
 * PAGE's runtime learned this item through the viewer's own
 * browse/search; THIS module's runtime instance resolves the item
 * through the SAME seam (the runtime's own search, matched by the
 * source key) so the canonical write lands in a runtime that knows the
 * item. In the single-bundle production boot the runtimes are ONE —
 * the resolution finds the same registered item (the registry is
 * idempotent), never a second code path.
 */
async function resolveItemIdForThisRuntime(
  host: Awaited<ReturnType<typeof getWebRuntimeHost>>,
  input: Partial<LibraryRequestBody>,
): Promise<string> {
  const posted = input.itemId ?? "";
  if (
    typeof input.connectorId !== "string" ||
    input.connectorId.length === 0 ||
    typeof input.externalRef !== "string" ||
    input.externalRef.length === 0 ||
    typeof input.title !== "string" ||
    input.title.length === 0
  ) {
    // No source identity: the posted id is the truth (the in-process
    // consumers whose host already knows the item).
    return posted;
  }
  try {
    const model = await host.runtime.search({ query: input.title });
    for (const hit of model.hits) {
      if (
        hit.result.connectorId === input.connectorId &&
        hit.result.externalRef === input.externalRef
      ) {
        return hit.canonicalItemId;
      }
    }
  } catch {
    // The resolution failed: fall through to the posted id (the save's
    // own typed refusal names the truth — never a fabricated success).
  }
  return posted;
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
  // R30 — THE RELOAD-DURABILITY HYDRATION, caller side: the runtime's
  // library fold hydrates from the STORED profile library BEFORE the
  // dev-boot bridge resolves the posted id through this runtime's search.
  // The ordering is the law (hydrate → resolve → act): a stored row that
  // carries a server-sourced canonical id is ADOPTED by the registry
  // first, so the bridge's search then resolves the item to the SAME
  // post-adoption id the fold was seeded under — the remove finds it. In
  // the single-bundle production boot this is one runtime; in the dev
  // split-graph boot the bridge law already applied (the resolution is
  // the same seam, never a second code path).
  await host.runtime.libraryOps.hydrate();
  // R24-W2 — the dev-boot bridge: resolve the item through THIS
  // module's runtime before the canonical write (see the bridge note
  // at resolveItemIdForThisRuntime).
  const itemId = await resolveItemIdForThisRuntime(host, input);
  const result =
    input.op === "save"
      ? await host.runtime.libraryOps.save({
          itemId,
          ...(input.listName !== undefined ? { listName: input.listName } : {}),
        })
      : await host.runtime.libraryOps.remove(itemId);
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
