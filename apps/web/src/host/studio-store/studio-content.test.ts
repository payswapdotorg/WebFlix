/**
 * R38-B — THE STUDIO CONTENT STORE LANE TESTS (the drafts/scheduled
 * states + the details edits — apps/web/src/host/studio-store/
 * studio-content.ts).
 *
 * Proves the store's laws (the plan's §2/§3, evidence/r38b/plan.md):
 *
 * - THE PERSISTENCE LAW (reload-durability): every write survives a
 *   fresh read of the SAME storage (the reactions/comments seam law);
 *   a fresh storage answers the honest empty store;
 * - THE STATE DERIVATION: a draft with visibility "scheduled" AND a
 *   future instant derives "scheduled"; everything else is "draft"
 *   (the state is data, never a second truth);
 * - THE TYPED REFUSALS: empty title, over-long fields, a scheduled
 *   visibility without a future instant — field-level problems, never
 *   a fabricated success; a failed persist refuses honestly;
 * - THE EDIT RECORDS: the details editor's write keys by the canonical
 *   item id and reloads verbatim (the studio's composed truth input);
 * - THE CONCURRENT-CATALOG LAW: a draft NEVER enters the catalog — the
 *   store writes only its own records (proven by shape: no catalog
 *   seams are touched; the store's records are the only writes).
 */

import { describe, expect, it } from "bun:test";

import {
  STUDIO_CONTENT_STORE_KEY,
  type StudioDraftRecord,
  type StudioItemEditRecord,
  deleteStudioDraft,
  draftProblemsOf,
  draftStateOf,
  itemEditProblemsOf,
  readStudioContentStore,
  readStudioDraftsOf,
  readStudioItemEdit,
  writeStudioDraft,
  writeStudioItemEdit,
} from "./studio-content";
import { createInMemoryStudioStorage, type StudioStorage } from "./studio-storage";

const T0 = Date.parse("2026-09-28T12:00:00.000Z");
const now = (): Date => new Date(T0);

/** A fresh storage per test (the injectable seam — the fake-web law). */
function freshStorage(): StudioStorage {
  return createInMemoryStudioStorage();
}

const VALID_DRAFT = {
  connectorId: "fake-source",
  title: "The next rain documentary",
  description: "A plan, honestly a studio record.",
  visibility: "private" as const,
  scheduledFor: null,
};

describe("R38-B studio content store — the persistence law (reload-durable)", () => {
  it("answers the honest empty store on a fresh storage", () => {
    const storage = freshStorage();
    expect(readStudioContentStore(storage)).toEqual({ drafts: {}, edits: {} });
    expect(readStudioDraftsOf("fake-source", storage)).toEqual([]);
  });

  it("persists a draft that survives a fresh read (reload-durable)", () => {
    const storage = freshStorage();
    const outcome = writeStudioDraft(VALID_DRAFT, null, storage, now());
    expect(outcome.ok).toBe(true);
    // A FRESH read of the same storage (the reload) answers the record.
    const reloaded = readStudioContentStore(storage);
    const stored = Object.values(reloaded.drafts);
    expect(stored.length).toBe(1);
    expect(stored[0]!.title).toBe("The next rain documentary");
    expect(stored[0]!.connectorId).toBe("fake-source");
    expect(stored[0]!.visibility).toBe("private");
  });

  it("keys drafts under the studio store's own key (never the catalog's seams)", () => {
    const storage = freshStorage();
    writeStudioDraft(VALID_DRAFT, null, storage, now());
    const raw = storage.getItem(STUDIO_CONTENT_STORE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toHaveProperty("drafts");
  });

  it("scopes the channel's drafts by connectorId (a foreign channel's drafts never leak)", () => {
    const storage = freshStorage();
    writeStudioDraft(VALID_DRAFT, null, storage, now());
    writeStudioDraft({ ...VALID_DRAFT, connectorId: "another-source", title: "Theirs" }, null, storage, now());
    const mine = readStudioDraftsOf("fake-source", storage);
    expect(mine.length).toBe(1);
    expect(mine[0]!.title).toBe("The next rain documentary");
  });

  it("edits a draft in place (the same id, the new truth, the original createdAt)", () => {
    const storage = freshStorage();
    const first = writeStudioDraft(VALID_DRAFT, null, storage, now());
    expect(first.ok).toBe(true);
    const record = (first as { record: StudioDraftRecord }).record;
    const second = writeStudioDraft(
      { ...VALID_DRAFT, title: "The retitled documentary" },
      record.id,
      storage,
      new Date(T0 + 60_000),
    );
    expect(second.ok).toBe(true);
    const reloaded = readStudioContentStore(storage);
    expect(Object.keys(reloaded.drafts).length).toBe(1);
    const updated = Object.values(reloaded.drafts)[0]!;
    expect(updated.id).toBe(record.id);
    expect(updated.title).toBe("The retitled documentary");
    expect(updated.createdAt).toBe(record.createdAt);
  });

  it("deletes a draft (unknown ids refuse honestly)", () => {
    const storage = freshStorage();
    const first = writeStudioDraft(VALID_DRAFT, null, storage, now());
    const record = (first as { record: StudioDraftRecord }).record;
    expect(deleteStudioDraft(record.id, storage).ok).toBe(true);
    expect(readStudioContentStore(storage).drafts).toEqual({});
    const refused = deleteStudioDraft(record.id, storage);
    expect(refused.ok).toBe(false);
  });
});

describe("R38-B studio content store — the state derivation (the state is data)", () => {
  it("derives scheduled only for a future instant on the scheduled visibility", () => {
    const future = new Date(T0 + 86_400_000).toISOString();
    expect(draftStateOf({ ...VALID_DRAFT, visibility: "scheduled", scheduledFor: future } as StudioDraftRecord, new Date(T0))).toBe("scheduled");
    // A past instant is NOT scheduled — it is a draft again (honest data).
    const past = new Date(T0 - 86_400_000).toISOString();
    expect(draftStateOf({ ...VALID_DRAFT, visibility: "scheduled", scheduledFor: past } as StudioDraftRecord, new Date(T0))).toBe("draft");
    expect(draftStateOf({ ...VALID_DRAFT, visibility: "private" } as StudioDraftRecord, new Date(T0))).toBe("draft");
  });
});

describe("R38-B studio content store — the typed refusals (never a fabricated success)", () => {
  it("refuses an empty title with the field-level problem", () => {
    const problems = draftProblemsOf({ ...VALID_DRAFT, title: "   " });
    expect(problems.some((problem) => problem.includes("title"))).toBe(true);
    const outcome = writeStudioDraft({ ...VALID_DRAFT, title: "   " }, null, freshStorage(), now());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.problems.some((p) => p.includes("title"))).toBe(true);
  });

  it("refuses a scheduled visibility without a future instant", () => {
    const past = new Date(T0 - 1_000).toISOString();
    const problems = draftProblemsOf({ ...VALID_DRAFT, visibility: "scheduled", scheduledFor: past });
    expect(problems.some((problem) => problem.includes("future"))).toBe(true);
    const noDate = draftProblemsOf({ ...VALID_DRAFT, visibility: "scheduled", scheduledFor: null });
    expect(noDate.some((problem) => problem.includes("valid date"))).toBe(true);
  });

  it("refuses over-long fields", () => {
    const problems = draftProblemsOf({ ...VALID_DRAFT, title: "x".repeat(201) });
    expect(problems.some((problem) => problem.includes("200"))).toBe(true);
  });

  it("refuses honestly when the storage write fails (nothing is kept)", () => {
    const refusing: StudioStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => undefined,
    };
    const outcome = writeStudioDraft(VALID_DRAFT, null, refusing, now());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.problems.some((p) => p.includes("could not be written"))).toBe(true);
    }
  });
});

describe("R38-B studio content store — the details-edit records (the composed truth's input)", () => {
  const VALID_EDIT = {
    itemId: "wfxitm_00000000000000000000000001",
    connectorId: "fake-source",
    title: "Deep Field Diary — the studio cut",
    description: "The studio's own description.",
    visibility: "unlisted" as const,
    scheduledFor: null,
  };

  it("writes an edit keyed by the canonical item id and reloads it verbatim", () => {
    const storage = freshStorage();
    const outcome = writeStudioItemEdit(VALID_EDIT, storage, now());
    expect(outcome.ok).toBe(true);
    const reloaded = readStudioItemEdit(VALID_EDIT.itemId, storage);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.title).toBe("Deep Field Diary — the studio cut");
    expect(reloaded!.visibility).toBe("unlisted");
  });

  it("refuses an edit without the canonical identity (field-level problems)", () => {
    const problems = itemEditProblemsOf({ ...VALID_EDIT, itemId: "  " });
    expect(problems.some((problem) => problem.includes("itemId"))).toBe(true);
    expect(itemEditProblemsOf({ ...VALID_EDIT, title: "" }).some((p) => p.includes("title"))).toBe(true);
  });

  it("carries the schedule only on the scheduled visibility (the record's own law)", () => {
    const storage = freshStorage();
    const future = new Date(T0 + 86_400_000).toISOString();
    const outcome = writeStudioItemEdit(
      { ...VALID_EDIT, visibility: "scheduled", scheduledFor: future },
      storage,
      now(),
    );
    expect(outcome.ok).toBe(true);
    const record = outcome.ok ? (outcome.record as StudioItemEditRecord) : null;
    expect(record!.scheduledFor).toBe(future);
    const notScheduled = writeStudioItemEdit({ ...VALID_EDIT, visibility: "public" }, freshStorage(), now());
    expect((notScheduled as { record: StudioItemEditRecord }).record.scheduledFor).toBeNull();
  });
});
