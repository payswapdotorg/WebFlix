/**
 * @wfx/app-web — the session queue store (R24-W2, the queue row of the
 * R24-C pairing matrix).
 *
 * THE LAW THIS STORE KEEPS (the plan's pairing: "Session queue + save
 * queue to Library/playlist where supported" — the taxonomy's
 * session-affordance backing): the queue is SESSION-SCOPED ORDERING
 * ONLY. It composes the runtime's own item identity (the same canonical
 * ids every surface uses); it never writes a hidden profile, never
 * persists itself beyond the session, and never becomes a second
 * recommendation engine. The queue's single durable act is the EXPLICIT
 * save-to-playlist write (the runtime's LibraryOperations.save with a
 * list name — the same canonical-keyed write the watchlist uses).
 *
 * HONESTY LAWS:
 * - one queue per session (the web host's per-boot store — the same
 *   lifetime the session-scoped watch state uses in the fixtures boot);
 * - entries are the card targets' own fields (never a fabricated
 *   realization claim — playback happens through the same player route
 *   every card uses);
 * - add/remove/reorder are typed with honest bounds (duplicate adds are
 *   idempotent MOVES to the tail — the familiar queue semantics);
 * - the autoplay choice rides beside the queue as the session's own
 *   state, DERIVED from the attention policy's vocabulary (never a raw
 *   always-on switch divorced from it).
 */

/** One queued item (the card target's own fields — the player route's input). */
export interface QueueEntry {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly durationMs?: number;
}

/** The session's queue state (the store's typed snapshot). */
export interface SessionQueueState {
  readonly entries: readonly QueueEntry[];
  /** The session's autoplay choice (the attention-policy-derived toggle). */
  readonly autoplay: boolean;
}

/** The typed result of one queue mutation. */
export type QueueMutationResult =
  | { readonly ok: true; readonly state: SessionQueueState }
  | { readonly ok: false; readonly kind: "invalid-input" | "not-found"; readonly detail: string };

/**
 * The session queue store. One instance per web host boot (the same
 * lifetime discipline the host's other session-scoped stores follow).
 */
export class SessionQueueStore {
  private readonly entries: QueueEntry[] = [];
  private autoplay = true;

  /** The current snapshot (the honest state — never a cached lie). */
  state(): SessionQueueState {
    return { entries: [...this.entries], autoplay: this.autoplay };
  }

  /** Add one item to the queue's tail (an idempotent move-to-tail). */
  add(entry: QueueEntry): QueueMutationResult {
    if (
      typeof entry.itemId !== "string" ||
      entry.itemId.length === 0 ||
      typeof entry.connectorId !== "string" ||
      entry.connectorId.length === 0 ||
      typeof entry.externalRef !== "string" ||
      entry.externalRef.length === 0 ||
      typeof entry.title !== "string" ||
      entry.title.length === 0
    ) {
      return { ok: false, kind: "invalid-input", detail: "queue entry: expected the card target's own fields" };
    }
    const existing = this.entries.findIndex((queued) => queued.itemId === entry.itemId);
    if (existing >= 0) {
      // The familiar queue semantics: adding an already-queued item
      // moves it to the tail (one entry per canonical item — the same
      // canonical-key discipline the watchlist follows).
      this.entries.splice(existing, 1);
    }
    this.entries.push(entry);
    return { ok: true, state: this.state() };
  }

  /** Remove one canonical item's queue entry. */
  remove(itemId: string): QueueMutationResult {
    const existing = this.entries.findIndex((queued) => queued.itemId === itemId);
    if (existing < 0) {
      return { ok: false, kind: "not-found", detail: `item '${itemId}' is not in this session's queue` };
    }
    this.entries.splice(existing, 1);
    return { ok: true, state: this.state() };
  }

  /** Move one entry up (toward the head) or down (toward the tail). */
  move(itemId: string, direction: "up" | "down"): QueueMutationResult {
    const index = this.entries.findIndex((queued) => queued.itemId === itemId);
    if (index < 0) {
      return { ok: false, kind: "not-found", detail: `item '${itemId}' is not in this session's queue` };
    }
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= this.entries.length) {
      return { ok: false, kind: "invalid-input", detail: `cannot move the ${direction === "up" ? "first" : "last"} queue entry further` };
    }
    const [moved] = this.entries.splice(index, 1);
    if (moved === undefined) {
      return { ok: false, kind: "not-found", detail: `item '${itemId}' is not in this session's queue` };
    }
    this.entries.splice(target, 0, moved);
    return { ok: true, state: this.state() };
  }

  /** Clear the session queue (the explicit act — never a hidden expiry). */
  clear(): QueueMutationResult {
    this.entries.length = 0;
    return { ok: true, state: this.state() };
  }

  /** Set the session's autoplay choice (the Up-next card's toggle). */
  setAutoplay(enabled: boolean): QueueMutationResult {
    this.autoplay = enabled === true;
    return { ok: true, state: this.state() };
  }
}

// ---------------------------------------------------------------------------
// The per-boot store (the web host's module-singleton lifetime)
// ---------------------------------------------------------------------------

/** The per-boot store (module scope — the same lifetime discipline the web host's own singletons follow). */
let store: SessionQueueStore | null = null;

/** The per-boot session queue store (created lazily; one per module boot). */
export function sessionQueue(): SessionQueueStore {
  if (store === null) {
    store = new SessionQueueStore();
  }
  return store;
}

/** Reset the session queue (the test seam's hook; production never calls this). */
export function resetSessionQueueForTests(): void {
  store = null;
}
