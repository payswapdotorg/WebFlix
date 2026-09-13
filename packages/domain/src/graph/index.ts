/**
 * Entertainment Graph module barrel (WFX-010, Lane A — intelligence).
 *
 * - model.ts: graph entities — Creator / Topic / ItemRelationship, the
 *   `wfxcre_` / `wfxtop_` id brands, GraphItem (frozen EntertainmentItem +
 *   graph bookkeeping), GraphEvent, typed GraphError.
 * - dedupe.ts: canonicalization / deduplication — normalizeTitle, dedupeKey,
 *   mergeCandidates, mergeRealizations, mergeItems.
 * - store.ts: EntertainmentGraph in-memory store (upsert / relate mutations
 *   + item / byCreator / byTopic / search / realizationsOf / neighbors
 *   queries).
 */
export * from "./model";
export * from "./dedupe";
export * from "./store";
