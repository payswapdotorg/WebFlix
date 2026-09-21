/**
 * @wfx/app-web — the session queue route (R24-W2): GET/POST /api/queue.
 *
 * THE QUEUE ROW'S REAL BACKING: the session-scoped queue store
 * (`host/queue.ts` — ordering only, never a hidden profile write) plus
 * the ONE durable act the plan's pairing names: SAVE QUEUE TO A PLAYLIST
 * — each queued item written through the runtime's own
 * LibraryOperations.save({ itemId, listName }) (the same canonical-keyed
 * write the watchlist uses; the Library's playlists section renders the
 * named lists).
 *
 * Honesty laws:
 * - the queue's state is the store's own snapshot (never a cached lie);
 * - a mutation the store refuses answers its typed result verbatim;
 * - the save action answers the per-item typed outcomes (one item's
 *   failed write is named, never silently dropped);
 * - anonymous sessions queue freely (the session affordance — no login
 *   wall; the durable save writes the LOCAL-FIRST canonical entries the
 *   runtime already owns for this session).
 */

import { NextResponse } from "next/server";

import { getWebRuntimeHost } from "@/host/web-host";
import { sessionQueue, type QueueEntry } from "@/host/queue";

export const dynamic = "force-dynamic";

/** One queue mutation from the client controls (the typed vocabulary). */
interface QueueRequestBody {
  readonly action?: "add" | "remove" | "move" | "clear" | "autoplay" | "save-playlist";
  /** The entry to add (required iff action === "add"). */
  readonly entry?: Partial<QueueEntry>;
  /** The canonical item id (remove/move). */
  readonly itemId?: string;
  /** The move direction (iff action === "move"). */
  readonly direction?: "up" | "down";
  /** The autoplay choice (iff action === "autoplay"). */
  readonly enabled?: boolean;
  /** The playlist name (iff action === "save-playlist"; default "Queue"). */
  readonly listName?: string;
}

/** Parse one entry input into a QueueEntry (or the typed invalid reason). */
function entryOf(input: Partial<QueueEntry> | undefined): QueueEntry | { error: string } {
  if (typeof input !== "object" || input === null) {
    return { error: "entry: expected the card target's fields" };
  }
  if (typeof input.itemId !== "string" || input.itemId.length === 0) {
    return { error: "entry.itemId: expected a non-empty string" };
  }
  if (typeof input.connectorId !== "string" || input.connectorId.length === 0) {
    return { error: "entry.connectorId: expected a non-empty string" };
  }
  if (typeof input.externalRef !== "string" || input.externalRef.length === 0) {
    return { error: "entry.externalRef: expected a non-empty string" };
  }
  if (typeof input.title !== "string" || input.title.length === 0) {
    return { error: "entry.title: expected a non-empty string" };
  }
  if (typeof input.canonicalType !== "string" || input.canonicalType.length === 0) {
    return { error: "entry.canonicalType: expected a non-empty string" };
  }
  return {
    itemId: input.itemId,
    connectorId: input.connectorId,
    externalRef: input.externalRef,
    title: input.title,
    canonicalType: input.canonicalType,
    ...(input.durationMs !== undefined && Number.isFinite(input.durationMs) && input.durationMs > 0
      ? { durationMs: input.durationMs }
      : {}),
  };
}

/** GET /api/queue — the session queue's honest snapshot. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, ...sessionQueue().state() }, { status: 200 });
}

/** POST /api/queue — one typed queue mutation (or the save-to-playlist act). */
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
  const input = body as Partial<QueueRequestBody>;
  const store = sessionQueue();

  if (input.action === "add") {
    const entry = entryOf(input.entry);
    if ("error" in entry) {
      return NextResponse.json({ error: entry.error }, { status: 400 });
    }
    const result = store.add(entry);
    return NextResponse.json(result, { status: 200 });
  }
  if (input.action === "remove" || input.action === "move") {
    if (typeof input.itemId !== "string" || input.itemId.length === 0) {
      return NextResponse.json({ error: "itemId: expected a non-empty string" }, { status: 400 });
    }
    const result =
      input.action === "remove"
        ? store.remove(input.itemId)
        : input.direction === "up" || input.direction === "down"
          ? store.move(input.itemId, input.direction)
          : { ok: false as const, kind: "invalid-input" as const, detail: "direction: expected 'up' | 'down'" };
    return NextResponse.json(result, { status: 200 });
  }
  if (input.action === "clear") {
    return NextResponse.json(store.clear(), { status: 200 });
  }
  if (input.action === "autoplay") {
    return NextResponse.json(store.setAutoplay(input.enabled === true), { status: 200 });
  }
  if (input.action === "save-playlist") {
    // The plan's save-queue pairing: EVERY queued item written through
    // the runtime's own library save with the list name — the per-item
    // typed outcomes answer honestly (a failed write is named).
    const listName =
      typeof input.listName === "string" && input.listName.trim().length > 0
        ? input.listName.trim()
        : "Queue";
    const { entries } = store.state();
    if (entries.length === 0) {
      return NextResponse.json(
        { ok: false, kind: "not-found", detail: "the session queue is empty — add something to it first" },
        { status: 200 },
      );
    }
    const host = await getWebRuntimeHost();
    const outcomes: { itemId: string; ok: boolean; detail?: string }[] = [];
    for (const entry of entries) {
      // R24-W2 — THE DEV-BOOT BRIDGE (the documented per-route
      // module-graph doctrine): THIS module's runtime instance resolves
      // the entry through the same search seam the page's runtime
      // learned it from, matched by the entry's own source key (the
      // single-bundle production boot shares one runtime — the
      // resolution is an idempotent no-op there).
      let itemId = entry.itemId;
      try {
        const model = await host.runtime.search({ query: entry.title });
        const hit = model.hits.find(
          (candidate) =>
            candidate.result.connectorId === entry.connectorId &&
            candidate.result.externalRef === entry.externalRef,
        );
        if (hit !== undefined) itemId = hit.canonicalItemId;
      } catch {
        // The resolution failed: the entry's own id stands (the save's
        // typed refusal names the truth — never a fabricated success).
      }
      const result = await host.runtime.libraryOps.save({ itemId, listName });
      outcomes.push(
        result.ok
          ? { itemId: entry.itemId, ok: true }
          : { itemId: entry.itemId, ok: false, detail: `${result.kind}: ${result.detail}` },
      );
    }
    const failed = outcomes.filter((outcome) => !outcome.ok);
    return NextResponse.json(
      {
        ok: failed.length === 0,
        listName,
        saved: outcomes.length - failed.length,
        ...(failed.length > 0 ? { kind: "unavailable", detail: `${failed.length} of ${outcomes.length} writes failed`, failures: failed } : {}),
      },
      { status: 200 },
    );
  }
  return NextResponse.json(
    { error: "action: expected 'add' | 'remove' | 'move' | 'clear' | 'autoplay' | 'save-playlist'" },
    { status: 400 },
  );
}
