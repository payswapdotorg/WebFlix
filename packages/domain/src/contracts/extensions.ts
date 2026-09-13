/**
 * Lane-owned extension types referenced by the frozen contracts.
 *
 * These types are NOT frozen: they are refined by the owning lanes
 * (connectors lane for source-facing types, intelligence lane for
 * candidate types). Structural changes that would alter frozen
 * contract semantics require lead review (see contracts.md).
 */

// ===== Connector-facing extension types (Lane B owned) =====

/** A single search hit from a connector catalog query. */
export interface SearchResult {
  connectorId: string;
  externalRef: string;
  title: string;
  canonicalType?:
    | "movie"
    | "series"
    | "episode"
    | "video"
    | "short"
    | "post"
    | "audio";
  durationMs?: number;
  orientation?: "horizontal" | "vertical" | "square" | "unknown";
  metadata?: Record<string, unknown>;
}

/** Full metadata for one external reference, as reported by a connector. */
export interface SourceItem {
  connectorId: string;
  externalRef: string;
  title: string;
  canonicalType?:
    | "movie"
    | "series"
    | "episode"
    | "video"
    | "short"
    | "post"
    | "audio";
  durationMs?: number;
  orientation?: "horizontal" | "vertical" | "square" | "unknown";
  availability: "available" | "unknown" | "unavailable";
  capabilities: string[];
  metadata?: Record<string, unknown>;
}

/** A user-initiated action to execute on a source. */
export interface UserAction {
  type: "like" | "save" | "follow" | "comment" | "download" | "transform";
  connectorId: string;
  externalRef: string;
  payload?: Record<string, unknown>;
}

/** Outcome of executing a user action. */
export interface ActionReceipt {
  status: "confirmed" | "local-only" | "unsupported" | "failed";
  externalId?: string;
  detail?: string;
  occurredAt: string;
}

/** One entry of a connector-side library. */
export interface LibraryEntry {
  connectorId: string;
  externalRef: string;
  title: string;
  addedAt?: string;
  metadata?: Record<string, unknown>;
}

/** A mutation command against a connector-side library. */
export interface LibraryCommand {
  op: "add" | "remove";
  externalRef: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

// ===== Intelligence-facing extension types (Lane A owned) =====

/** A retrieval candidate with the context needed for scoring. */
export interface EntertainmentCandidate {
  itemId: string;
  realization: {
    connectorId: string;
    externalRef: string;
    capabilities: string[];
    availability: "available" | "unknown" | "unavailable";
  };
  features: Record<string, number | string | boolean>;
}
