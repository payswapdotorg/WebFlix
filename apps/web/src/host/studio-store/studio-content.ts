/**
 * @wfx/app-web — R38-B — THE STUDIO CONTENT STORE (the drafts/scheduled
 * states + the per-video details edits).
 *
 * THE CONCURRENT-CATALOG LAW (the task packet): R38-A (upload) is
 * building the local-catalog WRITE seam concurrently — it is NOT this
 * lane's. This store therefore owns exactly TWO record kinds, and
 * neither is a catalog write:
 *
 * 1. DRAFTS — studio-owned content records the creator writes in the
 *    studio (title/description/visibility/schedule). A draft NEVER
 *    enters the catalog (no search/home/channel exposure): publishing
 *    into the real catalog is the upload wave's write seam, and the
 *    studio says so honestly (the bell-menu honest-later-wave
 *    vocabulary). A draft with visibility "scheduled" AND a future
 *    `scheduledFor` instant DERIVES the scheduled state (the state is
 *    data, never a second truth). At merge, R38-A's uploaded items
 *    compose through the SAME read seams this store's consumers use
 *    (the runtime's own search/join — never a parallel catalog).
 *
 * 2. EDITS — the details editor's writes on CATALOG items
 *    (title/description/visibility), keyed by the item's canonical id.
 *    The catalog's own read surfaces keep their truth (the catalog is
 *    not this lane's to write); the studio renders the COMPOSED truth
 *    (catalog + edit) with the provenance named. The edit record is
 *    real persisted state — reload-durable, echoed on save.
 *
 * THE PERSISTENCE LAW: the browser's own localStorage
 * (`wfx-studio-content-v1`) — the reactions/comments seam law (see
 * studio-storage.ts's module doc). Reads are defensive (corrupt ⇒ the
 * honest empty store); writes are best-effort; every surface labels the
 * transport honestly.
 */

import {
  defaultStudioStorage,
  readStudioRecord,
  writeStudioRecord,
  type StudioStorage,
} from "./studio-storage";

/** The store's localStorage key (the wfx-*-v1 grammar). */
export const STUDIO_CONTENT_STORE_KEY = "wfx-studio-content-v1";

/** The visibility vocabulary (the survey's row 29 set — the details form's own). */
export type StudioVisibility = "public" | "unlisted" | "private" | "scheduled";

export const STUDIO_VISIBILITIES: readonly StudioVisibility[] = [
  "public",
  "unlisted",
  "private",
  "scheduled",
];

/** The content state vocabulary (the survey's row 30 content list). */
export type StudioContentState = "draft" | "scheduled" | "published";

/** One studio-owned draft record (the creator's own content plan). */
export interface StudioDraftRecord {
  /** The draft's own id (`wfxdraft_` + a per-browser unique body). */
  readonly id: string;
  /** The channel (catalog source) the draft belongs to. */
  readonly connectorId: string;
  readonly title: string;
  readonly description: string;
  readonly visibility: StudioVisibility;
  /** ISO 8601 instant the creator scheduled (present iff visibility=scheduled). */
  readonly scheduledFor: string | null;
  /** ISO 8601 creation instant. */
  readonly createdAt: string;
  /** ISO 8601 last-edit instant. */
  readonly updatedAt: string;
}

/** One details-editor write on a catalog item (the studio's edit record). */
export interface StudioItemEditRecord {
  /** The catalog item's canonical id (the runtime's own identity). */
  readonly itemId: string;
  readonly connectorId: string;
  readonly title: string;
  readonly description: string;
  readonly visibility: StudioVisibility;
  readonly scheduledFor: string | null;
  /** ISO 8601 save instant. */
  readonly savedAt: string;
}

/** The store's serialized shape. */
export interface StudioContentStoreShape {
  readonly drafts: Record<string, StudioDraftRecord>;
  readonly edits: Record<string, StudioItemEditRecord>;
}

/** The typed outcome of a store write (never a fabricated success). */
export type StudioWriteOutcome =
  | { readonly ok: true; readonly record: StudioDraftRecord | StudioItemEditRecord }
  | { readonly ok: false; readonly problems: readonly string[] };

/** The draft id grammar: `wfxdraft_` + a timestamp/counter body (unique per browser). */
let draftCounter = 0;
export function newStudioDraftId(): string {
  draftCounter += 1;
  return `wfxdraft_${Date.now().toString(36)}${draftCounter.toString(36)}`;
}

/** Structural guard for the visibility vocabulary. */
export function isStudioVisibility(value: unknown): value is StudioVisibility {
  return typeof value === "string" && (STUDIO_VISIBILITIES as readonly string[]).includes(value);
}

/** Structural guard for a record-shape value (the defensive read's filter). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Coerce one unknown record into a draft defensively (invalid ⇒ dropped, never thrown). */
function parseDraft(value: unknown): StudioDraftRecord | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const connectorId = value.connectorId;
  const title = value.title;
  const description = value.description;
  const visibility = value.visibility;
  const scheduledFor = value.scheduledFor;
  const createdAt = value.createdAt;
  const updatedAt = value.updatedAt;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof connectorId !== "string" || connectorId.length === 0) return null;
  if (typeof title !== "string") return null;
  if (typeof description !== "string") return null;
  if (!isStudioVisibility(visibility)) return null;
  if (scheduledFor !== null && typeof scheduledFor !== "string") return null;
  if (typeof createdAt !== "string" || typeof updatedAt !== "string") return null;
  return {
    id,
    connectorId,
    title,
    description,
    visibility,
    scheduledFor,
    createdAt,
    updatedAt,
  };
}

/** Coerce one unknown record into an item edit defensively (invalid ⇒ dropped). */
function parseItemEdit(value: unknown): StudioItemEditRecord | null {
  if (!isRecord(value)) return null;
  const itemId = value.itemId;
  const connectorId = value.connectorId;
  const title = value.title;
  const description = value.description;
  const visibility = value.visibility;
  const scheduledFor = value.scheduledFor;
  const savedAt = value.savedAt;
  if (typeof itemId !== "string" || itemId.length === 0) return null;
  if (typeof connectorId !== "string" || connectorId.length === 0) return null;
  if (typeof title !== "string") return null;
  if (typeof description !== "string") return null;
  if (!isStudioVisibility(visibility)) return null;
  if (scheduledFor !== null && typeof scheduledFor !== "string") return null;
  if (typeof savedAt !== "string") return null;
  return {
    itemId,
    connectorId,
    title,
    description,
    visibility,
    scheduledFor,
    savedAt,
  };
}

/** Read the full store defensively (absent/corrupt ⇒ the honest empty store). */
export function readStudioContentStore(storage: StudioStorage | null = defaultStudioStorage()): StudioContentStoreShape {
  const raw = readStudioRecord<unknown>(storage, STUDIO_CONTENT_STORE_KEY);
  if (!isRecord(raw)) return { drafts: {}, edits: {} };
  const drafts: Record<string, StudioDraftRecord> = {};
  if (isRecord(raw.drafts)) {
    for (const [key, value] of Object.entries(raw.drafts)) {
      const parsed = parseDraft(value);
      if (parsed !== null && parsed.id === key) drafts[key] = parsed;
    }
  }
  const edits: Record<string, StudioItemEditRecord> = {};
  if (isRecord(raw.edits)) {
    for (const [key, value] of Object.entries(raw.edits)) {
      const parsed = parseItemEdit(value);
      if (parsed !== null && parsed.itemId === key) edits[key] = parsed;
    }
  }
  return { drafts, edits };
}

/** Persist the full store best-effort. */
function persistStore(storage: StudioStorage | null, store: StudioContentStoreShape): boolean {
  return writeStudioRecord(storage, STUDIO_CONTENT_STORE_KEY, store);
}

/** The draft state derivation: scheduled ⇔ visibility=scheduled with a future instant. */
export function draftStateOf(draft: StudioDraftRecord, now: Date = new Date()): Exclude<StudioContentState, "published"> {
  if (draft.visibility === "scheduled") {
    const scheduled = Date.parse(draft.scheduledFor ?? "");
    if (Number.isFinite(scheduled) && scheduled > now.getTime()) return "scheduled";
  }
  return "draft";
}

/** The draft input the editor submits. */
export interface StudioDraftInput {
  readonly connectorId: string;
  readonly title: string;
  readonly description: string;
  readonly visibility: StudioVisibility;
  readonly scheduledFor: string | null;
}

/** Validate a draft write (field-level problems — the typed refusal law). */
export function draftProblemsOf(input: StudioDraftInput): string[] {
  const problems: string[] = [];
  if (input.connectorId.trim().length === 0) {
    problems.push("connectorId: the draft needs its channel's identity");
  }
  if (input.title.trim().length === 0) {
    problems.push("title: a draft needs a title");
  }
  if (input.title.trim().length > 200) {
    problems.push("title: at most 200 characters");
  }
  if (input.description.length > 5000) {
    problems.push("description: at most 5000 characters");
  }
  if (input.visibility === "scheduled") {
    const scheduled = input.scheduledFor === null ? NaN : Date.parse(input.scheduledFor);
    if (!Number.isFinite(scheduled)) {
      problems.push("scheduledFor: a scheduled video needs a valid date and time");
    } else if (scheduled <= Date.now()) {
      problems.push("scheduledFor: the schedule must be in the future");
    }
  }
  return problems;
}

/**
 * Create (or replace) one draft. The typed outcome carries the stored
 * record on success and the field-level problems on refusal — never a
 * fabricated success (a failed persist is an honest refusal: the record
 * is NOT kept).
 */
export function writeStudioDraft(
  input: StudioDraftInput,
  existingId: string | null,
  storage: StudioStorage | null = defaultStudioStorage(),
  now: Date = new Date(),
): StudioWriteOutcome {
  const problems = draftProblemsOf(input);
  if (problems.length > 0) return { ok: false, problems };
  const store = readStudioContentStore(storage);
  const nowIso = now.toISOString();
  const existing = existingId !== null ? store.drafts[existingId] : undefined;
  const record: StudioDraftRecord = {
    id: existing?.id ?? newStudioDraftId(),
    connectorId: input.connectorId.trim(),
    title: input.title.trim(),
    description: input.description,
    visibility: input.visibility,
    scheduledFor: input.visibility === "scheduled" ? input.scheduledFor : null,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
  store.drafts[record.id] = record;
  if (!persistStore(storage, store)) {
    return { ok: false, problems: ["the studio record could not be written to this device's storage — nothing was saved"] };
  }
  return { ok: true, record };
}

/** Delete one draft (an honest typed outcome; unknown ids refuse). */
export function deleteStudioDraft(
  draftId: string,
  storage: StudioStorage | null = defaultStudioStorage(),
): StudioWriteOutcome {
  const store = readStudioContentStore(storage);
  const existing = store.drafts[draftId];
  if (existing === undefined) {
    return { ok: false, problems: [`no draft '${draftId.slice(0, 40)}' is stored on this device`] };
  }
  delete store.drafts[draftId];
  if (!persistStore(storage, store)) {
    return { ok: false, problems: ["the studio record could not be written to this device's storage — nothing was removed"] };
  }
  return { ok: true, record: existing };
}

/** The details-editor input on a catalog item. */
export interface StudioItemEditInput {
  readonly itemId: string;
  readonly connectorId: string;
  readonly title: string;
  readonly description: string;
  readonly visibility: StudioVisibility;
  readonly scheduledFor: string | null;
}

/** Validate an item-edit write (field-level problems). */
export function itemEditProblemsOf(input: StudioItemEditInput): string[] {
  const problems: string[] = [];
  if (input.itemId.trim().length === 0) {
    problems.push("itemId: the edit needs the video's canonical identity");
  }
  if (input.connectorId.trim().length === 0) {
    problems.push("connectorId: the edit needs the video's source identity");
  }
  if (input.title.trim().length === 0) {
    problems.push("title: the video needs a title");
  }
  if (input.title.trim().length > 200) {
    problems.push("title: at most 200 characters");
  }
  if (input.description.length > 5000) {
    problems.push("description: at most 5000 characters");
  }
  if (input.visibility === "scheduled") {
    const scheduled = input.scheduledFor === null ? NaN : Date.parse(input.scheduledFor);
    if (!Number.isFinite(scheduled)) {
      problems.push("scheduledFor: a scheduled video needs a valid date and time");
    }
  }
  return problems;
}

/**
 * Save the details-editor's write on one catalog item (the studio-owned
 * edit record — the catalog's own truth stands beside it, never
 * replaced; see the module doc's CONCURRENT-CATALOG LAW).
 */
export function writeStudioItemEdit(
  input: StudioItemEditInput,
  storage: StudioStorage | null = defaultStudioStorage(),
  now: Date = new Date(),
): StudioWriteOutcome {
  const problems = itemEditProblemsOf(input);
  if (problems.length > 0) return { ok: false, problems };
  const store = readStudioContentStore(storage);
  const record: StudioItemEditRecord = {
    itemId: input.itemId.trim(),
    connectorId: input.connectorId.trim(),
    title: input.title.trim(),
    description: input.description,
    visibility: input.visibility,
    scheduledFor: input.visibility === "scheduled" ? input.scheduledFor : null,
    savedAt: now.toISOString(),
  };
  store.edits[record.itemId] = record;
  if (!persistStore(storage, store)) {
    return { ok: false, problems: ["the studio record could not be written to this device's storage — nothing was saved"] };
  }
  return { ok: true, record };
}

/** The studio's edit record for one catalog item (null when none is stored). */
export function readStudioItemEdit(
  itemId: string,
  storage: StudioStorage | null = defaultStudioStorage(),
): StudioItemEditRecord | null {
  return readStudioContentStore(storage).edits[itemId] ?? null;
}

/** The channel's drafts (feed order: newest first — the studio list's own order). */
export function readStudioDraftsOf(
  connectorId: string,
  storage: StudioStorage | null = defaultStudioStorage(),
): StudioDraftRecord[] {
  const all = Object.values(readStudioContentStore(storage).drafts).filter(
    (draft) => draft.connectorId === connectorId,
  );
  return all.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
