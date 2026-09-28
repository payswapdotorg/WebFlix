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
 * - channel-profile.ts (R38-B, additive): the channel-profile EDIT seam —
 *   the creator-customized profile record (banner/avatar/handle/
 *   description), its closed vocabulary + guards, and the pure compose
 *   law. The write path for R36's derived channel identity's
 *   customizable slots; persistence lives in the adapter's studio store.
 */
export * from "./model";
export * from "./dedupe";
export * from "./store";
export * from "./channel-profile";
