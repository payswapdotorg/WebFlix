/**
 * @wfx/app-web — R38-B — THE STUDIO MODERATION STORE (hold/review/pin —
 * the persisted moderation states).
 *
 * THE MODERATION LAW (the task packet): "comments management
 * (hold/review/pin/reply) operates on the SAME comments truth the watch
 * surface renders (the R28 honest comments law) — your studio actions
 * are real persisted moderation states, never cosmetic."
 *
 * THE COMPOSITION (each action's real effect, by construction):
 *
 * - HOLD moves the comment OUT of `wfx-comments-v1` (the watch surface
 *   STOPS rendering it — a real moderation effect) INTO this store's
 *   held record (the full comment + its replies carried, so the review
 *   queue can restore the whole thread).
 * - REVIEW (the held queue): Approve restores the thread into
 *   `wfx-comments-v1` (the watch surface renders it again); Remove
 *   deletes it permanently (the held record is dropped).
 * - PIN persists the pinned comment id (one pin per video — the corpus
 *   grammar); the studio renders the pinned thread first with the
 *   badge. THE HONEST DIVERGENCE (recorded in evidence/r38b/
 *   DIVERGENCES.md): the watch surface's pinned-badge slot
 *   (CommentsSection.tsx:177–178 — "never fabricated") does not read
 *   this record at this base (the R28 file is frozen for this lane);
 *   the pin is real persisted state rendered by the studio, and the
 *   watch-surface binding is the merge-time compose.
 * - REPLY rides the shared comments transport (studio-comments.ts — a
 *   REAL comment the watch surface renders).
 *
 * Persistence: `wfx-studio-moderation-v1` — the browser's own record
 * (the studio-storage seam law), reload-durable, honestly labeled.
 */

import type { LocalComment } from "./studio-comments";
import {
  defaultStudioStorage,
  readStudioRecord,
  writeStudioRecord,
  type StudioStorage,
} from "./studio-storage";

/** The moderation store's localStorage key. */
export const STUDIO_MODERATION_STORE_KEY = "wfx-studio-moderation-v1";

/** One held thread (the comment + the replies hold carried with it). */
export interface HeldCommentThread {
  readonly comment: LocalComment;
  readonly replies: readonly LocalComment[];
  /** ISO 8601 hold instant. */
  readonly heldAt: string;
}

/** One item's moderation state. */
export interface ItemModerationState {
  /** The held threads awaiting review (keyed by the parent comment id). */
  readonly held: Record<string, HeldCommentThread>;
  /** The pinned comment id (one pin per video — the corpus grammar). */
  readonly pinned: string | null;
}

/** The store's serialized shape (per-item moderation states). */
export type StudioModerationStoreShape = Record<string, ItemModerationState>;

/** Structural guards (the defensive read's filters — corrupt rows drop). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseLocalComment(value: unknown): LocalComment | null {
  if (!isRecord(value)) return null;
  const { id, parentId, body, createdAt, authorHandle, liked } = value;
  if (typeof id !== "string" || id.length === 0) return null;
  if (parentId !== null && typeof parentId !== "string") return null;
  if (typeof body !== "string" || typeof createdAt !== "string") return null;
  if (typeof authorHandle !== "string" || typeof liked !== "boolean") return null;
  return { id, parentId, body, createdAt, authorHandle, liked };
}

function parseHeldThread(value: unknown): HeldCommentThread | null {
  if (!isRecord(value)) return null;
  const comment = parseLocalComment(value.comment);
  if (comment === null) return null;
  const replies = Array.isArray(value.replies)
    ? value.replies.map(parseLocalComment).filter((c): c is LocalComment => c !== null)
    : [];
  if (typeof value.heldAt !== "string") return null;
  return { comment, replies, heldAt: value.heldAt };
}

function parseItemState(value: unknown): ItemModerationState | null {
  if (!isRecord(value)) return null;
  const held: Record<string, HeldCommentThread> = {};
  if (isRecord(value.held)) {
    for (const [key, thread] of Object.entries(value.held)) {
      const parsed = parseHeldThread(thread);
      if (parsed !== null && parsed.comment.id === key) held[key] = parsed;
    }
  }
  const pinned = value.pinned;
  if (pinned !== null && typeof pinned !== "string") return null;
  return { held, pinned };
}

/** Read the full moderation store defensively (absent/corrupt ⇒ the empty truth). */
export function readStudioModerationStore(
  storage: StudioStorage | null = defaultStudioStorage(),
): StudioModerationStoreShape {
  const raw = readStudioRecord<unknown>(storage, STUDIO_MODERATION_STORE_KEY);
  if (!isRecord(raw)) return {};
  const store: StudioModerationStoreShape = {};
  for (const [itemId, value] of Object.entries(raw)) {
    const parsed = parseItemState(value);
    if (parsed !== null) store[itemId] = parsed;
  }
  return store;
}

/** Persist the full moderation store best-effort. */
function persistStore(storage: StudioStorage | null, store: StudioModerationStoreShape): boolean {
  return writeStudioRecord(storage, STUDIO_MODERATION_STORE_KEY, store);
}

/** One item's moderation state (the empty state when none is stored). */
export function moderationStateOf(
  itemId: string,
  storage: StudioStorage | null = defaultStudioStorage(),
): ItemModerationState {
  return readStudioModerationStore(storage)[itemId] ?? { held: {}, pinned: null };
}

/** The typed outcome of a moderation action. */
export type ModerationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly problem: string };

/** Record one held thread (HOLD's moderation-side half — the store-side half lives in studio-comments). */
export function recordHeldThread(
  itemId: string,
  thread: HeldCommentThread,
  storage: StudioStorage | null = defaultStudioStorage(),
): ModerationOutcome {
  const store = readStudioModerationStore(storage);
  const state = store[itemId] ?? { held: {}, pinned: null };
  store[itemId] = { ...state, held: { ...state.held, [thread.comment.id]: thread } };
  if (!persistStore(storage, store)) {
    return { ok: false, problem: "the held record could not be written to this device's storage" };
  }
  return { ok: true };
}

/** Drop one held thread from the record (Remove's moderation-side half — the comment is deleted). */
export function dropHeldThread(
  itemId: string,
  commentId: string,
  storage: StudioStorage | null = defaultStudioStorage(),
): ModerationOutcome {
  const store = readStudioModerationStore(storage);
  const state = store[itemId];
  if (state === undefined || state.held[commentId] === undefined) {
    return { ok: false, problem: "that comment is not held on this device" };
  }
  const held = { ...state.held };
  delete held[commentId];
  store[itemId] = { ...state, held };
  if (!persistStore(storage, store)) {
    return { ok: false, problem: "the change could not be written to this device's storage" };
  }
  return { ok: true };
}

/** Set the pin (one per video — a new pin replaces the old; null unpins). */
export function setPinnedComment(
  itemId: string,
  commentId: string | null,
  storage: StudioStorage | null = defaultStudioStorage(),
): ModerationOutcome {
  const store = readStudioModerationStore(storage);
  const state = store[itemId] ?? { held: {}, pinned: null };
  store[itemId] = { ...state, pinned: commentId };
  if (!persistStore(storage, store)) {
    return { ok: false, problem: "the pin could not be written to this device's storage" };
  }
  return { ok: true };
}

/** The held threads of one item, oldest hold first (the review queue's order). */
export function heldThreadsOf(
  itemId: string,
  storage: StudioStorage | null = defaultStudioStorage(),
): HeldCommentThread[] {
  const state = moderationStateOf(itemId, storage);
  return Object.values(state.held).sort((a, b) => Date.parse(a.heldAt) - Date.parse(b.heldAt));
}
