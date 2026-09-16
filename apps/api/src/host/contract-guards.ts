/**
 * @wfx/app-api — the transport-boundary guards (WFX-055A).
 *
 * MIRRORS of the frozen web client's private payload guards
 * (`apps/web/src/host/remote-ports.ts` — `isUsableRemoteSearchResult`,
 * `isUsableRemoteSourceItem`, `isUsableRemoteLibraryEntry`, and its
 * `validatePlaybackRealization` filter): the frozen client silently DROPS
 * any answer that fails these shapes, so this service filters its own
 * answers through the same shapes BEFORE answering — a drifted or
 * malformed row is skipped (and logged) at the boundary instead of
 * silently vanishing client-side. Every 200 body this service emits for
 * data-shaped endpoints therefore passes the frozen client's validators
 * by construction.
 *
 * The mirrors are deliberately verbatim (same field order, same rules) so
 * the two sides cannot drift; when the client's guards change, the frozen
 * contract changes, and this file changes with it.
 */

import type {
  LibraryEntry,
  PlaybackRealization,
  SearchResult,
  SourceItem,
} from "@wfx/domain";
import { isIso8601, isRecord, validatePlaybackRealization } from "@wfx/domain";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/** Mirror of the client's `isUsableRemoteSearchResult`. */
export function isUsableSearchResult(value: unknown): value is SearchResult {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.connectorId)) return false;
  if (!isNonEmptyString(value.externalRef)) return false;
  if (typeof value.title !== "string") return false;
  if (!isOptionalString(value.canonicalType)) return false;
  if (value.durationMs !== undefined && !isNonNegativeFinite(value.durationMs)) return false;
  if (!isOptionalString(value.orientation)) return false;
  return true;
}

/** Mirror of the client's `isUsableRemoteSourceItem`. */
export function isUsableSourceItem(value: unknown): value is SourceItem {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.connectorId)) return false;
  if (!isNonEmptyString(value.externalRef)) return false;
  if (typeof value.title !== "string") return false;
  if (!isOptionalString(value.canonicalType)) return false;
  if (value.durationMs !== undefined && !isNonNegativeFinite(value.durationMs)) return false;
  if (!isOptionalString(value.orientation)) return false;
  if (
    value.availability !== "available" &&
    value.availability !== "unknown" &&
    value.availability !== "unavailable"
  ) {
    return false;
  }
  if (!Array.isArray(value.capabilities) || !value.capabilities.every((cap) => typeof cap === "string")) {
    return false;
  }
  return true;
}

/** Mirror of the client's `isUsableRemoteLibraryEntry`. */
export function isUsableLibraryEntry(value: unknown): value is LibraryEntry {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.connectorId)) return false;
  if (!isNonEmptyString(value.externalRef)) return false;
  if (typeof value.title !== "string") return false;
  if (value.addedAt !== undefined && (typeof value.addedAt !== "string" || !isIso8601(value.addedAt))) {
    return false;
  }
  return true;
}

/**
 * Mirror of the client's realization filter: the frozen
 * `validatePlaybackRealization` from `@wfx/domain` (the exact function the
 * client applies to every resolve candidate).
 */
export function isUsableRealization(value: unknown): value is PlaybackRealization {
  return validatePlaybackRealization(value).ok;
}
