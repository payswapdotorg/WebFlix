/**
 * @wfx/client-runtime — the read models (R01).
 *
 * The presentation models `getHome`/`search`/`shorts` answer with. The
 * honesty law throughout: DEGRADATION LIVES IN THE MODEL — a failing
 * server read produces an ERROR section with the typed failure detail,
 * never a fake empty section (the frozen "a fixture/empty answer is never
 * silently presented as success" law). `ready` sections carry real data
 * only.
 *
 * R01 scope honesty (documented for the lead): the HOME model assembles
 * what the runtime itself owns — Continue Watching from the session
 * watch-state fold. The server-backed recommendation feed is R05's lane;
 * when it lands, its section joins this model without changing the laws.
 */

import type { SearchResult } from "@wfx/domain";

import type { SessionWatchState } from "./watch-state";
import type { RuntimeErrorKind } from "./errors";

// ---------------------------------------------------------------------------
// Shared section status (in-model degradation)
// ---------------------------------------------------------------------------

/** The typed status of one model section. */
export interface ModelSectionStatus {
  readonly state: "ready" | "error";
  /** Present iff `state === "error"`: the typed failure detail. */
  readonly error?: { readonly kind: RuntimeErrorKind; readonly detail: string };
}

/** A ready section (carries data). */
export function readySection(): ModelSectionStatus {
  return { state: "ready" };
}

/** An error section (carries the typed failure — never fake emptiness). */
export function errorSection(kind: RuntimeErrorKind, detail: string): ModelSectionStatus {
  return { state: "error", error: { kind, detail } };
}

// ---------------------------------------------------------------------------
// Search / shorts models
// ---------------------------------------------------------------------------

/**
 * One search hit joined to its CANONICAL identity: the source-keyed
 * `SearchResult` plus the canonical `wfxitm_` item id the runtime assigned
 * (the canonical registry's stable mapping) — the key library, watch
 * state, and navigation use.
 */
export interface SearchHit {
  readonly canonicalItemId: string;
  readonly result: SearchResult;
}

/** The search read model (the sketch's `SearchModel`). */
export interface SearchModel {
  /** The query the model answers (echoed verbatim). */
  readonly query: string;
  readonly status: ModelSectionStatus;
  /** Present iff `status.state === "ready"`: the hits (canonical-joined). */
  readonly hits: readonly SearchHit[];
}

/** The search query (the sketch's `SearchQuery`). */
export interface SearchQuery {
  readonly query: string;
}

/** The shorts feed query. */
export interface ShortsQuery {
  /** Optional query (the server's shorts curation rides on it). */
  readonly query?: string;
}

// ---------------------------------------------------------------------------
// Home model
// ---------------------------------------------------------------------------

/** One Continue Watching entry (resumable, from the session fold). */
export interface ContinueWatchingEntry {
  readonly itemId: string;
  /** Display title (the registered source title; the id when unknown). */
  readonly title: string;
  readonly positionMs: number;
  readonly completionRatio: number | null;
  readonly lastWatchedAt: string;
  readonly status: SessionWatchState["status"];
}

/** The home read model (the sketch's `HomeModel`). */
export interface HomeModel {
  readonly continueWatching: {
    readonly status: ModelSectionStatus;
    /** Resumable entries (in-progress + skipped), most recent first. */
    readonly entries: readonly ContinueWatchingEntry[];
  };
}

/** The home query (section inclusion; Continue Watching by default). */
export interface HomeQuery {
  readonly includeContinueWatching?: boolean;
}

// ---------------------------------------------------------------------------
// Assembly helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Build the Continue Watching entries from the session fold: in-progress
 * and skipped items are RESUMABLE (skipped-but-resumable — the WFX-029
 * law); completed items are excluded. Pure; ordering is the fold's.
 */
export function buildContinueWatching(
  watchStates: readonly SessionWatchState[],
  titleOf: (itemId: string) => string,
): readonly ContinueWatchingEntry[] {
  return watchStates
    .filter((state) => state.status !== "completed")
    .map((state) => ({
      itemId: state.itemId,
      title: titleOf(state.itemId),
      positionMs: state.lastPositionMs,
      completionRatio: state.completionRatio,
      lastWatchedAt: state.lastWatchedAt,
      status: state.status,
    }));
}
