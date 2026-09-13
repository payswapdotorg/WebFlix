/**
 * The retrieval unit (WFX-020, Lane A — intelligence).
 *
 * `EntertainmentCandidate` is the Lane-A-owned extension type defined in
 * `packages/domain/src/contracts/extensions.ts` (exported through the public
 * `@wfx/domain` entry). It is IMPORTED here, never redefined: one candidate =
 * one (canonical item, source realization) pair plus the feature surface the
 * Recommendation OS needs for scoring.
 *
 * `RetrievedCandidate` enriches that unit with the retrieval context the
 * query stage is responsible for:
 *
 * - `sourceRealizations` — EVERY realization of the item known to the index,
 *   verbatim, including each realization's declared `capabilities` and
 *   `availability`. This is the "preserving capabilities" law: retrieval never
 *   flattens, merges, or drops capability data — the downstream policy stage
 *   (WFX-021) sees the full truth about how a canonical item can be realized.
 * - `matchedObjectives` — the objectives of the intents this candidate
 *   matched, filled by `rankForIntents` (intent-filter.ts). Empty on fresh
 *   query output; enriched additively, never destructively.
 * - `retrievedAt` — the deterministic instant stamped by the index at query
 *   time. The index never reads a hidden clock (`Date.now()` is forbidden in
 *   this package): the instant is supplied once at index construction
 *   (see `CandidateIndexOptions.retrievedAt`), so identical index state plus
 *   identical query always yields identical output.
 */

import type { EntertainmentCandidate, SourceRealization } from "@wfx/domain";

export type { EntertainmentCandidate };

/**
 * A retrieval result: one `EntertainmentCandidate` plus the retrieval context.
 *
 * The embedded `candidate.realization` is THE realization this candidate is
 * materialized from (the one that satisfied the query's realization-level
 * filters); `sourceRealizations` preserves every realization of the same
 * canonical item verbatim ("one content identity, many realizations").
 */
export interface RetrievedCandidate {
  /** The (item, realization) pair plus scoring features. */
  candidate: EntertainmentCandidate;
  /** All realizations of the item known to the index, capability data verbatim. */
  sourceRealizations: SourceRealization[];
  /** Objectives of intents matched by this candidate (filled by rankForIntents). */
  matchedObjectives: string[];
  /** Deterministic ISO 8601 instant stamped by the index (never a hidden clock). */
  retrievedAt: string;
}
