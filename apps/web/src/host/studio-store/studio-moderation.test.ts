/**
 * R38-B — THE STUDIO MODERATION LANE TESTS (hold/review/pin/reply over
 * the SAME comments truth the watch surface renders).
 *
 * Proves the MODERATION LAW (the task packet): "comments management
 * (hold/review/pin/reply) operates on the SAME comments truth the watch
 * surface renders (the R28 honest comments law) — your studio actions
 * are real persisted moderation states, never cosmetic."
 *
 * - THE ONE STORE: the studio's reads/writes target `wfx-comments-v1`
 *   — the watch surface's own key; a seeded record in the WATCH
 *   SURFACE'S serialized grammar renders in the studio's read (the
 *   shape pinned by writing a record in exactly CommentsSection's
 *   serialization and reading it back);
 * - HOLD really removes the comment (and its replies) from the store
 *   the watch surface renders, and records the restorable thread;
 * - APPROVE restores the whole thread (the watch surface renders it
 *   again — byte-identical comment bodies);
 * - REMOVE deletes the held thread permanently;
 * - PIN persists (one per video; a new pin replaces the old; null
 *   unpins) — the studio's own record (the watch-side binding is the
 *   recorded merge-time compose);
 * - REPLY writes a REAL comment into the same store (parentId set, the
 *   profile's own handle — the same law CommentsSection's composer
 *   keeps);
 * - THE DEFENSIVE READS: corrupt rows drop (never a throw, never a
 *   fabricated comment).
 */

import { describe, expect, it } from "bun:test";

import {
  COMMENTS_STORE_KEY,
  type LocalComment,
  readCommentsOf,
  readCommentStore,
  removeCommentFromStore,
  restoreCommentToStore,
  studioHandleOf,
  writeStudioReply,
} from "./studio-comments";
import {
  STUDIO_MODERATION_STORE_KEY,
  dropHeldThread,
  heldThreadsOf,
  moderationStateOf,
  recordHeldThread,
  setPinnedComment,
} from "./studio-moderation";
import { createInMemoryStudioStorage, type StudioStorage } from "./studio-storage";

const T0 = Date.parse("2026-09-28T12:00:00.000Z");
const now = (): Date => new Date(T0);
const ITEM = "wfxitm_00000000000000000000000001";

/** Seed the watch surface's own store with one thread (parent + reply), exactly as CommentsSection serializes it. */
function seedThread(storage: StudioStorage): { parent: LocalComment; reply: LocalComment } {
  const parent: LocalComment = {
    id: "c1",
    parentId: null,
    body: "The part where it rains is unmatched.",
    createdAt: new Date(T0 - 60_000).toISOString(),
    authorHandle: "@viewer",
    liked: false,
  };
  const reply: LocalComment = {
    id: "c2",
    parentId: "c1",
    body: "Agreed — the sound design carries it.",
    createdAt: new Date(T0 - 30_000).toISOString(),
    authorHandle: "@another",
    liked: true,
  };
  storage.setItem(COMMENTS_STORE_KEY, JSON.stringify({ [ITEM]: [parent, reply] }));
  return { parent, reply };
}

describe("R38-B moderation — the ONE store (the watch surface's own truth)", () => {
  it("reads a record seeded in the watch surface's serialized grammar", () => {
    const storage = createInMemoryStudioStorage();
    seedThread(storage);
    const comments = readCommentsOf(ITEM, storage);
    expect(comments.length).toBe(2);
    expect(comments[0]!.body).toBe("The part where it rains is unmatched.");
    expect(comments[1]!.parentId).toBe("c1");
  });

  it("drops corrupt rows defensively (never a throw, never a fabricated comment)", () => {
    const storage = createInMemoryStudioStorage();
    storage.setItem(
      COMMENTS_STORE_KEY,
      JSON.stringify({ [ITEM]: [{ id: "", parentId: null, body: "corrupt", createdAt: "x", authorHandle: "y", liked: false }, "not-a-comment"] }),
    );
    expect(readCommentsOf(ITEM, storage)).toEqual([]);
    expect(readCommentStore(storage)).toEqual({});
  });

  it("keeps the studio's own key separate from the comments store", () => {
    const storage = createInMemoryStudioStorage();
    seedThread(storage);
    setPinnedComment(ITEM, "c1", storage);
    expect(storage.getItem(COMMENTS_STORE_KEY)).not.toContain("wfx-studio-moderation");
    expect(storage.getItem(STUDIO_MODERATION_STORE_KEY)).not.toBeNull();
  });
});

describe("R38-B moderation — HOLD (a real removal from the rendered truth)", () => {
  it("removes the comment and its replies from the watch surface's store, recording the restorable thread", () => {
    const storage = createInMemoryStudioStorage();
    const { parent, reply } = seedThread(storage);
    const removal = removeCommentFromStore(ITEM, parent.id, storage);
    expect(removal.ok).toBe(true);
    // The watch surface's rendered truth no longer carries the thread.
    expect(readCommentsOf(ITEM, storage)).toEqual([]);
    // The moderation record holds the full thread (restorable).
    const recorded = recordHeldThread(
      ITEM,
      { comment: parent, replies: [reply], heldAt: now().toISOString() },
      storage,
    );
    expect(recorded.ok).toBe(true);
    const held = heldThreadsOf(ITEM, storage);
    expect(held.length).toBe(1);
    expect(held[0]!.comment.body).toBe(parent.body);
    expect(held[0]!.replies.length).toBe(1);
  });

  it("refuses to hold a comment that is not in the record (never a fabricated hold)", () => {
    const storage = createInMemoryStudioStorage();
    const removal = removeCommentFromStore(ITEM, "c-missing", storage);
    expect(removal.ok).toBe(false);
  });
});

describe("R38-B moderation — APPROVE / REMOVE (the review queue's real writes)", () => {
  it("approves: the thread returns to the watch surface's rendered truth, byte-identical", () => {
    const storage = createInMemoryStudioStorage();
    const { parent, reply } = seedThread(storage);
    removeCommentFromStore(ITEM, parent.id, storage);
    recordHeldThread(ITEM, { comment: parent, replies: [reply], heldAt: now().toISOString() }, storage);
    const restored = restoreCommentToStore(ITEM, parent, [reply], storage);
    expect(restored.ok).toBe(true);
    const comments = readCommentsOf(ITEM, storage);
    expect(comments.map((c) => c.body)).toEqual([parent.body, reply.body]);
    // The held record is dropped on approve.
    expect(dropHeldThread(ITEM, parent.id, storage).ok).toBe(true);
    expect(heldThreadsOf(ITEM, storage)).toEqual([]);
  });

  it("removes: the held thread is deleted permanently (nothing returns)", () => {
    const storage = createInMemoryStudioStorage();
    const { parent, reply } = seedThread(storage);
    removeCommentFromStore(ITEM, parent.id, storage);
    recordHeldThread(ITEM, { comment: parent, replies: [reply], heldAt: now().toISOString() }, storage);
    expect(dropHeldThread(ITEM, parent.id, storage).ok).toBe(true);
    expect(heldThreadsOf(ITEM, storage)).toEqual([]);
    expect(readCommentsOf(ITEM, storage)).toEqual([]);
    // A second remove refuses honestly.
    expect(dropHeldThread(ITEM, parent.id, storage).ok).toBe(false);
  });

  it("refuses to restore a comment that is already in the record (never a duplicate)", () => {
    const storage = createInMemoryStudioStorage();
    const { parent, reply } = seedThread(storage);
    const restored = restoreCommentToStore(ITEM, parent, [reply], storage);
    expect(restored.ok).toBe(false);
  });
});

describe("R38-B moderation — PIN (the studio's own persisted record)", () => {
  it("persists one pin per video; a new pin replaces the old; null unpins", () => {
    const storage = createInMemoryStudioStorage();
    expect(setPinnedComment(ITEM, "c1", storage).ok).toBe(true);
    expect(moderationStateOf(ITEM, storage).pinned).toBe("c1");
    expect(setPinnedComment(ITEM, "c2", storage).ok).toBe(true);
    expect(moderationStateOf(ITEM, storage).pinned).toBe("c2");
    expect(setPinnedComment(ITEM, null, storage).ok).toBe(true);
    expect(moderationStateOf(ITEM, storage).pinned).toBeNull();
  });

  it("survives a fresh read (reload-durable)", () => {
    const storage = createInMemoryStudioStorage();
    setPinnedComment(ITEM, "c1", storage);
    expect(moderationStateOf(ITEM, storage).pinned).toBe("c1");
  });
});

describe("R38-B moderation — REPLY (a real comment in the ONE store)", () => {
  it("writes a reply with the parent id and the profile's own handle (the watch surface renders it)", () => {
    const storage = createInMemoryStudioStorage();
    const { parent } = seedThread(storage);
    const outcome = writeStudioReply(ITEM, parent.id, "Thank you — the rain setup was one take.", "Dev Persona", storage, now());
    expect(outcome.ok).toBe(true);
    const comments = readCommentsOf(ITEM, storage);
    expect(comments.length).toBe(3);
    const reply = comments[2]!;
    expect(reply.parentId).toBe(parent.id);
    expect(reply.authorHandle).toBe("@devpersona");
    expect(reply.body).toBe("Thank you — the rain setup was one take.");
  });

  it("refuses an empty reply and a reply to a comment that is not in the record", () => {
    const storage = createInMemoryStudioStorage();
    const { parent } = seedThread(storage);
    expect(writeStudioReply(ITEM, parent.id, "   ", "Dev Persona", storage, now()).ok).toBe(false);
    expect(writeStudioReply(ITEM, "c-missing", "a real body", "Dev Persona", storage, now()).ok).toBe(false);
  });

  it("derives the @handle by the watch surface's own law (mirrored)", () => {
    expect(studioHandleOf("Dev Persona")).toBe("@devpersona");
    expect(studioHandleOf(undefined)).toBe("@you");
    expect(studioHandleOf("  ")).toBe("@you");
  });
});
