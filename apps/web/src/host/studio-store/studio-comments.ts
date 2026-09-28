/**
 * @wfx/app-web — R38-B — THE STUDIO'S COMMENTS TRANSPORT ACCESS.
 *
 * THE MODERATION LAW (the task packet): comments management
 * (hold/review/pin/reply) "operates on the SAME comments truth the watch
 * surface renders (the R28 honest comments law) — your studio actions
 * are real persisted moderation states, never cosmetic."
 *
 * This module is the studio's access to that ONE store: the watch
 * surface's `wfx-comments-v1` record (apps/web/src/components/comments/
 * CommentsSection.tsx — the LocalComment shape, :49–57), read and
 * written through the same key with the same defensive laws. NEVER a
 * second comments store: a studio reply IS a comment (the watch surface
 * renders it); a hold REMOVES the comment from the rendered truth (the
 * watch surface stops rendering it); an approve restores it. The watch
 * surface's own module stays untouched (this lane's ownership) — the
 * store's shape is mirrored here structurally, and the lane test
 * (studio-moderation.test.ts) pins the shape to CommentsSection's
 * serialized grammar so a drift on either side fails loudly.
 */

import {
  defaultStudioStorage,
  readStudioRecord,
  writeStudioRecord,
  type StudioStorage,
} from "./studio-storage";

/** The watch surface's own store key (CommentsSection.tsx — the ONE comments truth). */
export const COMMENTS_STORE_KEY = "wfx-comments-v1";

/** One locally-stored comment (CommentsSection's own shape, mirrored structurally). */
export interface LocalComment {
  readonly id: string;
  readonly parentId: string | null;
  readonly body: string;
  readonly createdAt: string;
  readonly authorHandle: string;
  readonly liked: boolean;
}

/** The comments store's shape (per-item arrays). */
export type CommentStore = Record<string, LocalComment[]>;

/** Structural guard for one comment record (the defensive read's filter). */
function parseComment(value: unknown): LocalComment | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { id, parentId, body, createdAt, authorHandle, liked } = record;
  if (typeof id !== "string" || id.length === 0) return null;
  if (parentId !== null && typeof parentId !== "string") return null;
  if (typeof body !== "string") return null;
  if (typeof createdAt !== "string") return null;
  if (typeof authorHandle !== "string") return null;
  if (typeof liked !== "boolean") return null;
  return { id, parentId, body, createdAt, authorHandle, liked };
}

/** Read the full comments store defensively (absent/corrupt ⇒ the empty truth). */
export function readCommentStore(storage: StudioStorage | null = defaultStudioStorage()): CommentStore {
  const raw = readStudioRecord<unknown>(storage, COMMENTS_STORE_KEY);
  if (typeof raw !== "object" || raw === null) return {};
  const store: CommentStore = {};
  for (const [itemId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const comments = value.map(parseComment).filter((c): c is LocalComment => c !== null);
    if (comments.length > 0) store[itemId] = comments;
  }
  return store;
}

/** Persist the full comments store best-effort (the watch surface's own law). */
function persistCommentStore(storage: StudioStorage | null, store: CommentStore): boolean {
  return writeStudioRecord(storage, COMMENTS_STORE_KEY, store);
}

/** One item's comments (the same array the watch surface renders). */
export function readCommentsOf(itemId: string, storage: StudioStorage | null = defaultStudioStorage()): LocalComment[] {
  return readCommentStore(storage)[itemId] ?? [];
}

/** The @handle of the signed-in profile (CommentsSection's own law, mirrored). */
export function studioHandleOf(profileName: string | undefined): string {
  const base = (profileName ?? "you").trim();
  if (base.length === 0) return "@you";
  const normalized = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
  return `@${normalized.length > 0 ? normalized : "you"}`;
}

/** One comment id (the watch surface's own grammar: timestamp + counter). */
let commentCounter = 0;
function newCommentId(): string {
  commentCounter += 1;
  return `c${Date.now().toString(36)}${commentCounter.toString(36)}`;
}

/**
 * The studio's REPLY: a REAL comment write into the SAME store the watch
 * surface renders (parentId set to the parent comment) — one store, one
 * write path, the signed-in profile's own handle.
 */
export function writeStudioReply(
  itemId: string,
  parentId: string,
  body: string,
  profileName: string | undefined,
  storage: StudioStorage | null = defaultStudioStorage(),
  now: Date = new Date(),
): { ok: boolean; comment: LocalComment | null; problem: string | null } {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return { ok: false, comment: null, problem: "a reply needs text" };
  }
  const store = readCommentStore(storage);
  const itemComments = store[itemId] ?? [];
  if (!itemComments.some((comment) => comment.id === parentId)) {
    return { ok: false, comment: null, problem: "the parent comment is not in this device's record" };
  }
  const comment: LocalComment = {
    id: newCommentId(),
    parentId,
    body: trimmed,
    createdAt: now.toISOString(),
    authorHandle: studioHandleOf(profileName),
    liked: false,
  };
  store[itemId] = [...itemComments, comment];
  if (!persistCommentStore(storage, store)) {
    return { ok: false, comment: null, problem: "the reply could not be written to this device's storage" };
  }
  return { ok: true, comment, problem: null };
}

/**
 * Remove one comment from the item's rendered truth (HOLD's store-side
 * half: the watch surface stops rendering the comment). The full record
 * is returned so the moderation store can keep it restorable.
 */
export function removeCommentFromStore(
  itemId: string,
  commentId: string,
  storage: StudioStorage | null = defaultStudioStorage(),
): { ok: boolean; comment: LocalComment | null; problem: string | null } {
  const store = readCommentStore(storage);
  const itemComments = store[itemId] ?? [];
  const target = itemComments.find((comment) => comment.id === commentId);
  if (target === undefined) {
    return { ok: false, comment: null, problem: "the comment is not in this device's record" };
  }
  // A parent's replies go with it (the thread grammar — a reply without
  // its parent never renders on the watch surface).
  const next = itemComments.filter(
    (comment) => comment.id !== commentId && comment.parentId !== commentId,
  );
  if (next.length > 0) store[itemId] = next;
  else delete store[itemId];
  if (!persistCommentStore(storage, store)) {
    return { ok: false, comment: null, problem: "the change could not be written to this device's storage" };
  }
  return { ok: true, comment: target, problem: null };
}

/**
 * Restore one comment (APPROVE's store-side half): the record returns
 * to the item's rendered truth — the watch surface renders it again.
 * Replies are restored with their parent (the thread grammar).
 */
export function restoreCommentToStore(
  itemId: string,
  comment: LocalComment,
  replies: readonly LocalComment[],
  storage: StudioStorage | null = defaultStudioStorage(),
): { ok: boolean; problem: string | null } {
  const store = readCommentStore(storage);
  const itemComments = store[itemId] ?? [];
  if (itemComments.some((existing) => existing.id === comment.id)) {
    return { ok: false, problem: "the comment is already in this device's record" };
  }
  store[itemId] = [...itemComments, comment, ...replies];
  if (!persistCommentStore(storage, store)) {
    return { ok: false, problem: "the restore could not be written to this device's storage" };
  }
  return { ok: true, problem: null };
}
