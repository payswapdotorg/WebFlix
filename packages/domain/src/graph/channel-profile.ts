/**
 * Entertainment Graph — the channel-profile EDIT seam (WFX R38-B, studio).
 *
 * ADDITIVE EXTENSION (the R38-B lane law): this module adds the WRITE-PATH
 * entity for a catalog channel's creator-customized profile. It never
 * modifies, renames, or weakens an existing type, function, or test — the
 * R36 channel READ surfaces (apps/web/src/host/channel-views.ts — the
 * `ChannelIdentity` derivation law) stay byte-compatible.
 *
 * WHY THIS SEAM EXISTS (the honest gap it closes): R36's channel identity
 * is a DERIVATION over the sources model's own truth + the channel's
 * items — its description/avatar/banner slots render TYPED ABSENCES
 * because no source on this host declares them. The creator studio
 * (R38-B) is the honest WRITE path for exactly those fields: the
 * creator's OWN declared edits, persisted as real state, never a
 * fabricated value. The record follows the graph's boundary law
 * (store.ts: "pure data operations only — no I/O, no persistence"):
 * validation + the pure compose live HERE; persistence lives in the
 * adapter's studio store.
 *
 * THE RECORD LAW (the derivation law's write-side twin):
 * - Every field is NULLABLE: `null` means "not customized" — the base
 *   derivation's truth stands. The record NEVER fabricates a value the
 *   creator did not declare.
 * - `connectorId` is the channel's stable identity (the same key the R36
 *   derivation, the sources model, and the studio's channel resolution
 *   use — one key, never a second channel identity).
 * - A customized HANDLE follows the SAME slug grammar as R36's
 *   `channelHandleOf` (the pure href law): lowercase, runs outside
 *   [a-z0-9] collapse to "-", leading/trailing "-" trim — so a
 *   creator-chosen handle is routable, never a fabricated "@name" form.
 * - The banner/avatar edits are the creator's declared artwork URLs
 *   (http/https); the description is the creator's declared text.
 * - `editedAt` is a full ISO 8601 instant supplied by the writer (the
 *   store's own caller-supplied-timestamp law).
 *
 * THE COMPOSE LAW (`composeChannelProfile`): the base identity's fields
 * with the edit's declared fields winning, field by field — the pure
 * overlay the studio's customized preview renders and the merge-time
 * channel-page binding consumes. Absent edit ⇒ the base verbatim.
 */

import { isIso8601, isRecord } from "../validation";
import { GraphError } from "./model";

// ---------------------------------------------------------------------------
// The closed vocabulary (the Covers pattern — model.ts's own law)
// ---------------------------------------------------------------------------

/**
 * The creator-customizable profile fields (the survey's row 30
 * channel-customization set — the closed vocabulary).
 */
export type ChannelProfileField = "banner" | "avatar" | "handle" | "description";

export const CHANNEL_PROFILE_FIELDS = [
  "banner",
  "avatar",
  "handle",
  "description",
] as const satisfies readonly ChannelProfileField[];

/** Compile-time check that the vocabulary list covers every field kind. */
type _CoversChannelProfileFields = [ChannelProfileField] extends [
  typeof CHANNEL_PROFILE_FIELDS[number],
]
  ? unknown
  : never;
const _coversChannelProfileFields: _CoversChannelProfileFields = null;

// ---------------------------------------------------------------------------
// The handle grammar (the pure href law, mirrored — href.ts is app-side)
// ---------------------------------------------------------------------------

/** The customized-handle grammar: 1–64 chars of [a-z0-9-], no edge hyphens. */
export const CHANNEL_PROFILE_HANDLE_MAX_LENGTH = 64;

/**
 * Structural guard for a creator-choosable channel handle — the SAME slug
 * grammar `channelHandleOf` derives (lowercase; every run of characters
 * outside [a-z0-9] collapses to one "-"; leading/trailing "-" trim; at
 * least one character). Kept here so the domain seam validates without an
 * app-side import (the lane law: packages never import from apps).
 */
export function isChannelProfileHandle(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > CHANNEL_PROFILE_HANDLE_MAX_LENGTH) return false;
  if (value.startsWith("-") || value.endsWith("-")) return false;
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
}

/** Structural guard for a creator-declared artwork URL (http/https only). */
export function isChannelProfileArtworkUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The edit record
// ---------------------------------------------------------------------------

/**
 * One channel's creator-customized profile state — the WRITE-side truth
 * for the R36 identity's customizable slots. Keyed by the channel's
 * stable connectorId; every field nullable (null = not customized, the
 * base derivation's truth stands).
 */
export interface ChannelProfileEdit {
  /** The channel's stable connector id (the sources model's own key). */
  readonly connectorId: string;
  /** The creator-chosen handle (the slug grammar), or null. */
  readonly handle: string | null;
  /** The creator-declared description, or null. */
  readonly description: string | null;
  /** The creator-declared banner artwork URL, or null. */
  readonly bannerUrl: string | null;
  /** The creator-declared avatar artwork URL, or null. */
  readonly avatarUrl: string | null;
  /** ISO 8601 instant of the last edit (caller-supplied). */
  readonly editedAt: string;
}

/** The minimal base-identity shape the compose overlays (structural). */
export interface ChannelProfileBase {
  /** The channel's stable connector id (the edit's own key must match). */
  readonly connectorId: string;
  /** The base handle (R36's slugified stable connector id). */
  readonly handle: string;
  /** The base description text (R36's declared text or absence sentence). */
  readonly description: string;
}

/** The composed profile truth: the base with the edit's declared fields winning. */
export interface ComposedChannelProfile {
  /** The effective handle (the edit's when declared, else the base's). */
  readonly handle: string;
  /** The effective description (the edit's when declared, else the base's). */
  readonly description: string;
  /** The creator-declared banner artwork URL, or null (the base banner stands). */
  readonly bannerUrl: string | null;
  /** The creator-declared avatar artwork URL, or null (the base avatar stands). */
  readonly avatarUrl: string | null;
  /** Which of the closed vocabulary's fields the edit declares. */
  readonly customizedFields: readonly ChannelProfileField[];
  /** The edit's own instant when one exists, else null. */
  readonly editedAt: string | null;
}

/** Read one optional string field from an unknown record (trim; empty → null). */
function optionalDeclaredText(record: Record<string, unknown>, field: string): string | null | undefined {
  const raw = record[field];
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return undefined; // present but not a string — invalid
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The validating constructor (the GraphError law): builds a
 * {@link ChannelProfileEdit} from unknown input, or throws the typed
 * graph error with field-level details — never a silent coercion.
 *
 * Accepted input shape: every customizable field may be absent, null, or
 * a string (a string of only whitespace normalizes to null — "cleared");
 * `connectorId` is required non-empty; `editedAt` is required ISO 8601.
 */
export function channelProfileEditOf(input: unknown): ChannelProfileEdit {
  if (!isRecord(input)) {
    throw new GraphError("channel profile edit: expected an object");
  }
  const details: string[] = [];

  const connectorIdRaw = input.connectorId;
  if (typeof connectorIdRaw !== "string" || connectorIdRaw.trim().length === 0) {
    details.push("connectorId: expected a non-empty string (the channel's stable connector id)");
  }

  const handle = optionalDeclaredText(input, "handle");
  if (handle === undefined) {
    details.push("handle: expected a string or null (the creator-chosen handle)");
  } else if (handle !== null && !isChannelProfileHandle(handle)) {
    details.push(
      `handle: expected the handle grammar (1–${CHANNEL_PROFILE_HANDLE_MAX_LENGTH} chars of lowercase letters, digits, single inner hyphens — the same slug grammar the channel route derives), got '${handle.slice(0, 40)}'`,
    );
  }

  const description = optionalDeclaredText(input, "description");
  if (description === undefined) {
    details.push("description: expected a string or null (the creator-declared description)");
  } else if (description !== null && description.length > 2000) {
    details.push("description: expected at most 2000 characters");
  }

  const bannerUrl = optionalDeclaredText(input, "bannerUrl");
  if (bannerUrl === undefined) {
    details.push("bannerUrl: expected a string or null (the creator-declared banner artwork URL)");
  } else if (bannerUrl !== null && !isChannelProfileArtworkUrl(bannerUrl)) {
    details.push(`bannerUrl: expected an http(s) URL, got '${bannerUrl.slice(0, 60)}'`);
  }

  const avatarUrl = optionalDeclaredText(input, "avatarUrl");
  if (avatarUrl === undefined) {
    details.push("avatarUrl: expected a string or null (the creator-declared avatar artwork URL)");
  } else if (avatarUrl !== null && !isChannelProfileArtworkUrl(avatarUrl)) {
    details.push(`avatarUrl: expected an http(s) URL, got '${avatarUrl.slice(0, 60)}'`);
  }

  const editedAtRaw = input.editedAt;
  if (!isIso8601(editedAtRaw)) {
    details.push("editedAt: expected a full ISO 8601 instant (the writer's own clock)");
  }

  if (details.length > 0) throw new GraphError(details);

  return {
    connectorId: (connectorIdRaw as string).trim(),
    handle: handle as string | null,
    description: description as string | null,
    bannerUrl: bannerUrl as string | null,
    avatarUrl: avatarUrl as string | null,
    editedAt: editedAtRaw as string,
  };
}

/** Parse a persisted edit record defensively (invalid/corrupt ⇒ null, never a throw). */
export function parseChannelProfileEdit(input: unknown): ChannelProfileEdit | null {
  try {
    return channelProfileEditOf(input);
  } catch {
    return null;
  }
}

/**
 * THE COMPOSE LAW: the base identity's fields with the edit's declared
 * fields winning (field by field, over the closed vocabulary). A null
 * edit — or an edit keyed to a DIFFERENT channel — answers the base
 * verbatim: the overlay never invents a value the creator did not
 * declare, and never applies another channel's edit.
 */
export function composeChannelProfile(
  base: ChannelProfileBase,
  edit: ChannelProfileEdit | null,
): ComposedChannelProfile {
  if (edit === null || edit.connectorId !== base.connectorId) {
    return {
      handle: base.handle,
      description: base.description,
      bannerUrl: null,
      avatarUrl: null,
      customizedFields: [],
      editedAt: null,
    };
  }
  const customized: ChannelProfileField[] = [];
  if (edit.handle !== null) customized.push("handle");
  if (edit.description !== null) customized.push("description");
  if (edit.bannerUrl !== null) customized.push("banner");
  if (edit.avatarUrl !== null) customized.push("avatar");
  return {
    handle: edit.handle ?? base.handle,
    description: edit.description ?? base.description,
    bannerUrl: edit.bannerUrl,
    avatarUrl: edit.avatarUrl,
    customizedFields: customized,
    editedAt: edit.editedAt,
  };
}
