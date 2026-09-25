"use client";

/**
 * @wfx/app-web — THE REACTIONS LOCAL TRANSPORT (R29-B, the watch page's
 * second act — the like/dislike split pill's honest backing).
 *
 * THE R28 COMMENTS LAW, APPLIED TO REACTIONS: WebFlix never fabricates a
 * social surface. The like/dislike state is the USER'S OWN REAL ACTION on
 * the browser's own localStorage record (`wfx-reactions-v1`, keyed per
 * canonical item) — exactly the honest local transport the comments
 * section established. The count the pill renders counts ONLY what this
 * browser actually did (a fresh browser shows no count, never a plausible
 * one); a dislike NEVER renders a count (the corpus's own truth); the
 * provider's like capability — when the source declares one — is a SECOND
 * truth the pill dispatches in parallel (the receipt never fabricates the
 * local state; it only names the sync outcome, per the J10 law).
 */

/** The store's shape (localStorage `wfx-reactions-v1`): itemId → reaction. */
type ReactionStore = Record<string, "like" | "dislike">;

const STORE_KEY = "wfx-reactions-v1";

/** Read the full local store (defensive — a corrupt record reads empty). */
function readStore(): ReactionStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const store: ReactionStore = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === "like" || value === "dislike") store[key] = value;
    }
    return store;
  } catch {
    return {};
  }
}

/** Write the full local store (best-effort — private mode keeps the view-local state). */
function writeStore(store: ReactionStore): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // The persistence seam is unavailable — this view's state stands.
  }
}

/** This browser's own reaction on one item (null = none recorded). */
export function readReaction(itemId: string): "like" | "dislike" | null {
  return readStore()[itemId] ?? null;
}

/**
 * Record this browser's own reaction on one item (mutually exclusive —
 * a like replaces a dislike and vice versa; the same reaction toggles
 * off). Answers the recorded state after the write.
 */
export function writeReaction(
  itemId: string,
  reaction: "like" | "dislike",
): "like" | "dislike" | null {
  const store = readStore();
  if (store[itemId] === reaction) {
    delete store[itemId];
  } else {
    store[itemId] = reaction;
  }
  writeStore(store);
  return store[itemId] ?? null;
}
